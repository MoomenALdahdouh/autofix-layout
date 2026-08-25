import { describe, expect, it } from 'vitest'
import { convertManualText } from '../layouts/convert.ts'
import {
  ACTIVE_IDLE_TIMEOUT_MS,
  FREE_MAX_BALANCE_MS,
  LICENSE_CACHE_TTL_MS,
  REFILL_AMOUNT_MS,
  REFILL_INTERVAL_MS,
  TRIAL_DURATION_MS,
} from './config.ts'
import { createEntitlementEngine } from './engine.ts'
import { formatDuration, formatTrialRemaining } from './format.ts'
import { createMemoryEntitlementStore } from './memoryStore.ts'
import {
  applyRefills,
  clampBalance,
  createInitialUsageState,
  isInTrial,
  normalizeUsageState,
  resolveEntitlement,
} from './usage.ts'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

function clock(start = 1_700_000_000_000) {
  let now = start
  return {
    now: () => now,
    set: (value: number) => {
      now = value
    },
    add: (ms: number) => {
      now += ms
    },
    origin: start,
  }
}

function engine(time: ReturnType<typeof clock>, store = createMemoryEntitlementStore()) {
  return {
    store,
    api: createEntitlementEngine({
      now: time.now,
      isOnline: () => true,
      store,
    }),
  }
}

async function activeUse(
  api: ReturnType<typeof createEntitlementEngine>,
  time: ReturnType<typeof clock>,
  durationMs: number,
  stepMs = 30 * 1000,
): Promise<void> {
  let left = durationMs
  while (left > 0) {
    const chunk = Math.min(stepMs, left)
    time.add(chunk)
    await api.noteActivity()
    left -= chunk
  }
}

async function useUntilEmpty(
  api: ReturnType<typeof createEntitlementEngine>,
  time: ReturnType<typeof clock>,
): Promise<void> {
  await api.noteActivity()
  for (let i = 0; i < 400; i++) {
    const view = await api.snapshot()
    if (view.remainingMs <= 0) return
    time.add(Math.min(30_000, view.remainingMs))
    await api.noteActivity()
  }
}

describe('new installation and trial', () => {
  it('starts TRIAL on first activation and lasts exactly 7 days', async () => {
    const time = clock()
    const { api } = engine(time)
    const first = await api.ensureActivated()
    expect(first.state).toBe('TRIAL')
    expect(first.decision).toBe('ALLOW')
    expect(first.limitReached).toBe(false)
    expect(first.trialRemainingMs).toBe(TRIAL_DURATION_MS)

    time.add(3 * DAY)
    expect((await api.snapshot()).state).toBe('TRIAL')
    expect((await api.snapshot()).decision).toBe('ALLOW')

    time.set(time.origin + TRIAL_DURATION_MS - 1)
    expect((await api.snapshot()).state).toBe('TRIAL')

    time.set(time.origin + TRIAL_DURATION_MS)
    const after = await api.snapshot()
    expect(after.state).toBe('FREE')
    expect(after.remainingMs).toBe(FREE_MAX_BALANCE_MS)
    expect(after.decision).toBe('ALLOW')
  })

  it('does not reset the trial on popup reopen or service-worker restart', async () => {
    const time = clock()
    const store = createMemoryEntitlementStore()
    const first = engine(time, store)
    await first.api.ensureActivated()
    time.add(2 * DAY)
    const again = await first.api.snapshot()

    const restarted = engine(time, store)
    const afterRestart = await restarted.api.ensureActivated()
    expect(afterRestart.state).toBe('TRIAL')
    expect(afterRestart.trialRemainingMs).toBe(again.trialRemainingMs)
    expect(afterRestart.trialRemainingMs).toBe(5 * DAY)
  })

  it('does not reset the trial when only the sync install stamp survives reinstall', async () => {
    const time = clock()
    const store = createMemoryEntitlementStore({ trialAnchor: time.origin })
    time.add(8 * DAY)
    const { api } = engine(time, store)
    const view = await api.ensureActivated()
    expect(view.state).toBe('FREE')
    expect(view.remainingMs).toBe(FREE_MAX_BALANCE_MS)
  })
})

describe('free active usage and idle', () => {
  it('consumes only active time and never goes negative or above the max', async () => {
    const time = clock()
    const { api } = engine(time)
    await api.ensureActivated()
    time.set(time.origin + TRIAL_DURATION_MS)
    expect((await api.snapshot()).remainingMs).toBe(FREE_MAX_BALANCE_MS)

    await api.noteActivity()
    await activeUse(api, time, 20 * MINUTE)
    const afterWork = await api.snapshot()
    expect(afterWork.state).toBe('FREE')
    expect(afterWork.remainingMs).toBe(FREE_MAX_BALANCE_MS - 20 * MINUTE)

    time.add(5 * MINUTE)
    const afterIdle = await api.snapshot()
    expect(afterIdle.remainingMs).toBe(afterWork.remainingMs)

    time.add(ACTIVE_IDLE_TIMEOUT_MS + 10 * MINUTE)
    const stillIdle = await api.noteActivity()
    expect(stillIdle.remainingMs).toBe(afterWork.remainingMs)

    const overflow = clampBalance(FREE_MAX_BALANCE_MS + HOUR)
    const underflow = clampBalance(-12)
    expect(overflow).toBe(FREE_MAX_BALANCE_MS)
    expect(underflow).toBe(0)
  })

  it('reaches zero, denies automatic intervention, and keeps typing/manual conversion available', async () => {
    const time = clock()
    const { api } = engine(time)
    await api.ensureActivated()
    time.set(time.origin + TRIAL_DURATION_MS)
    await useUntilEmpty(api, time)
    const empty = await api.snapshot()
    expect(empty.remainingMs).toBe(0)
    expect(empty.decision).toBe('DENY')
    expect(empty.limitReached).toBe(true)
    expect(empty.canIntervene).toBe(false)
    expect(await api.canIntervene()).toBe('DENY')

    time.add(30 * MINUTE)
    expect((await api.snapshot()).decision).toBe('DENY')
    expect(convertManualText('hsjo]lj', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: 'استخدمت',
    })
  })
})

describe('refill', () => {
  it('restores 30 minutes every 5 hours and applies skipped intervals after a long sleep', async () => {
    const time = clock()
    const { api } = engine(time)
    await api.ensureActivated()
    time.set(time.origin + TRIAL_DURATION_MS)
    await useUntilEmpty(api, time)
    expect((await api.snapshot()).remainingMs).toBe(0)

    time.add(REFILL_INTERVAL_MS)
    const one = await api.snapshot()
    expect(one.remainingMs).toBe(REFILL_AMOUNT_MS)
    expect(one.decision).toBe('ALLOW')

    time.add(3 * REFILL_INTERVAL_MS)
    const four = await api.snapshot()
    expect(four.remainingMs).toBe(4 * REFILL_AMOUNT_MS)

    time.add(REFILL_INTERVAL_MS)
    expect((await api.snapshot()).remainingMs).toBe(FREE_MAX_BALANCE_MS)

    time.add(REFILL_INTERVAL_MS)
    expect((await api.snapshot()).remainingMs).toBe(FREE_MAX_BALANCE_MS)
  })

  it('survives a service-worker restart before the next refill is due', async () => {
    const time = clock()
    const store = createMemoryEntitlementStore()
    const first = engine(time, store)
    await first.api.ensureActivated()
    time.set(time.origin + TRIAL_DURATION_MS)
    await useUntilEmpty(first.api, time)

    time.add(REFILL_INTERVAL_MS)
    const restarted = engine(time, store)
    expect((await restarted.api.ensureActivated()).remainingMs).toBe(REFILL_AMOUNT_MS)
  })
})

describe('pro entitlement', () => {
  it('is unlimited, does not consume Free balance, and uses verified license state', async () => {
    const time = clock()
    const { api } = engine(time)
    await api.ensureActivated()
    time.set(time.origin + TRIAL_DURATION_MS)
    await api.noteActivity()
    await activeUse(api, time, 10 * MINUTE)
    const before = await api.snapshot()
    expect(before.state).toBe('FREE')

    const upgraded = await api.rememberLicense(true, 'active')
    expect(upgraded.state).toBe('PRO')
    expect(upgraded.decision).toBe('ALLOW')
    expect(upgraded.limitReached).toBe(false)

    await activeUse(api, time, 10 * MINUTE)
    const stillPro = await api.snapshot()
    expect(stillPro.state).toBe('PRO')
    expect(stillPro.decision).toBe('ALLOW')

    time.add(LICENSE_CACHE_TTL_MS + 1)
    const afterExpiry = await api.snapshot()
    expect(afterExpiry.state).toBe('FREE')
    expect(afterExpiry.remainingMs).toBe(before.remainingMs)

    const rejected = resolveEntitlement(
      createInitialUsageState(time.now()),
      { valid: true, status: 'active', verifiedAt: time.now() },
      time.now(),
      true,
    )
    expect(rejected.state).toBe('PRO')
    const fakeFlag = resolveEntitlement(
      createInitialUsageState(time.now()),
      { valid: false, status: 'unknown', verifiedAt: 0 },
      time.now(),
      true,
    )
    expect(fakeFlag.state).not.toBe('PRO')
  })

  it('does not treat an expired online cache as Pro', async () => {
    const time = clock()
    const store = createMemoryEntitlementStore({
      usage: createInitialUsageState(time.origin),
      license: {
        valid: true,
        status: 'active',
        verifiedAt: time.origin - LICENSE_CACHE_TTL_MS - 1,
      },
    })
    time.set(time.origin + TRIAL_DURATION_MS)
    const { api } = engine(time, store)
    expect((await api.ensureActivated()).state).toBe('FREE')
  })
})

describe('clock and persistence safety', () => {
  it('does not grant unlimited usage on clock rollback or invalid timestamps', async () => {
    const time = clock()
    const { api } = engine(time)
    await api.ensureActivated()
    time.set(time.origin + TRIAL_DURATION_MS)
    await api.noteActivity()
    time.add(30 * MINUTE)
    const remaining = (await api.noteActivity()).remainingMs

    time.add(-2 * HOUR)
    const rolled = await api.snapshot()
    expect(rolled.state).toBe('FREE')
    expect(rolled.remainingMs).toBe(remaining)
    expect(rolled.decision).toBe('ALLOW')

    expect(() => normalizeUsageState({ firstActivatedAt: 'nope' }, time.now())).not.toThrow()
    expect(() => normalizeUsageState(null, Number.NaN)).not.toThrow()
    expect(isInTrial(normalizeUsageState({ firstActivatedAt: time.now() + DAY }, time.now()), time.now())).toBe(
      false,
    )
    expect(applyRefills(createInitialUsageState(time.now()), Number.NaN).usageBalanceMs).toBe(
      FREE_MAX_BALANCE_MS,
    )
  })

  it('does not double-count overlapping tab activity', async () => {
    const time = clock()
    const { api } = engine(time)
    await api.ensureActivated()
    time.set(time.origin + TRIAL_DURATION_MS)
    await api.noteActivity()
    await api.noteActivity()
    await api.noteActivity()
    expect((await api.snapshot()).remainingMs).toBe(FREE_MAX_BALANCE_MS)

    time.add(MINUTE)
    await api.noteActivity()
    expect((await api.snapshot()).remainingMs).toBe(FREE_MAX_BALANCE_MS - MINUTE)
  })
})

describe('popup presentation', () => {
  it('formats remaining usage and next refill without sub-second noise', async () => {
    expect(formatDuration(1 * HOUR + 24 * MINUTE + 29_827)).toBe('1h 24m')
    expect(formatDuration(43 * MINUTE)).toBe('43m')
    expect(formatDuration(12_000)).toBe('Less than 1 minute')
    expect(formatTrialRemaining(6 * DAY)).toBe('6 days remaining')

    const time = clock()
    const { api } = engine(time)
    const trial = await api.ensureActivated()
    expect(trial.state).toBe('TRIAL')
    expect(formatTrialRemaining(trial.trialRemainingMs ?? 0)).toBe('7 days remaining')

    time.set(time.origin + TRIAL_DURATION_MS)
    const free = await api.snapshot()
    expect(formatDuration(free.remainingMs)).toBe('2h')
    expect(free.nextRefillInMs).toBeNull()

    await useUntilEmpty(api, time)
    const empty = await api.snapshot()
    expect(empty.nextRefillInMs).toBeGreaterThan(0)
    expect(empty.nextRefillInMs).toBeLessThanOrEqual(REFILL_INTERVAL_MS)
    expect(formatDuration(REFILL_INTERVAL_MS)).toBe('5h')
    expect(formatDuration(empty.nextRefillInMs ?? 0)).toMatch(/^\d+h/)
  })
})

describe('end-to-end entitlement journey', () => {
  it('follows install → trial → free allowance → idle → zero → refill → pro', async () => {
    const time = clock()
    const store = createMemoryEntitlementStore()
    let { api } = engine(time, store)

    expect((await api.ensureActivated()).state).toBe('TRIAL')
    await api.noteActivity()
    time.add(DAY)
    expect((await api.snapshot()).state).toBe('TRIAL')

    time.add(2 * DAY)
    expect((await api.snapshot()).decision).toBe('ALLOW')

    time.set(time.origin + TRIAL_DURATION_MS - 1)
    expect((await api.snapshot()).state).toBe('TRIAL')

    time.add(1)
    const free = await api.snapshot()
    expect(free.state).toBe('FREE')
    expect(free.remainingMs).toBe(FREE_MAX_BALANCE_MS)

    await api.noteActivity()
    await activeUse(api, time, 40 * MINUTE)
    expect((await api.snapshot()).remainingMs).toBe(FREE_MAX_BALANCE_MS - 40 * MINUTE)

    time.add(ACTIVE_IDLE_TIMEOUT_MS + HOUR)
    expect((await api.snapshot()).remainingMs).toBe(FREE_MAX_BALANCE_MS - 40 * MINUTE)

    await useUntilEmpty(api, time)
    expect((await api.snapshot()).decision).toBe('DENY')
    expect(convertManualText('lvpfh', 'en-US-qwerty', 'ar-101').text).toBe('مرحبا')

    time.add(REFILL_INTERVAL_MS)
    api = engine(time, store).api
    const refilled = await api.ensureActivated()
    expect(refilled.remainingMs).toBe(REFILL_AMOUNT_MS)
    expect(refilled.decision).toBe('ALLOW')

    expect((await api.rememberLicense(true, 'active')).state).toBe('PRO')
    time.add(MINUTE)
    expect((await api.noteActivity()).state).toBe('PRO')
    expect((await api.noteActivity()).decision).toBe('ALLOW')
  })
})
