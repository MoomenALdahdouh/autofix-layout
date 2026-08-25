import {
  FREE_MAX_BALANCE_MS,
  REFILL_AMOUNT_MS,
  REFILL_INTERVAL_MS,
  TRIAL_DURATION_MS,
  USAGE_STATE_VERSION,
} from './config.ts'
import { clampTimestamp, elapsedMs, isValidTimestamp } from './clock.ts'
import { isVerifiedPro } from './license.ts'
import type {
  EntitlementKind,
  EntitlementSnapshot,
  LicenseCache,
  UsageState,
} from './types.ts'

export function createInitialUsageState(now: number): UsageState {
  const activated = isValidTimestamp(now) ? now : 1
  return {
    version: USAGE_STATE_VERSION,
    firstActivatedAt: activated,
    trialEndsAt: activated + TRIAL_DURATION_MS,
    usageBalanceMs: FREE_MAX_BALANCE_MS,
    lastUsageUpdateAt: activated,
    lastActivityAt: 0,
    lastRefillAt: activated,
  }
}

export function normalizeUsageState(raw: unknown, now: number): UsageState {
  const fallback = createInitialUsageState(now)
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Partial<UsageState>
  const firstActivatedAt = clampTimestamp(value.firstActivatedAt, 0)
  if (!firstActivatedAt) return fallback
  const trialEndsAt = Math.min(
    clampTimestamp(value.trialEndsAt, firstActivatedAt + TRIAL_DURATION_MS),
    firstActivatedAt + TRIAL_DURATION_MS,
  )
  return {
    version: USAGE_STATE_VERSION,
    firstActivatedAt,
    trialEndsAt,
    usageBalanceMs: clampBalance(value.usageBalanceMs),
    lastUsageUpdateAt: clampTimestamp(value.lastUsageUpdateAt, firstActivatedAt),
    lastActivityAt: isValidTimestamp(value.lastActivityAt) ? value.lastActivityAt : 0,
    lastRefillAt: clampTimestamp(value.lastRefillAt, firstActivatedAt),
  }
}

export function clampBalance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return FREE_MAX_BALANCE_MS
  if (value < 0) return 0
  if (value > FREE_MAX_BALANCE_MS) return FREE_MAX_BALANCE_MS
  return Math.floor(value)
}

export function isInTrial(state: UsageState, now: number): boolean {
  if (!isValidTimestamp(state.firstActivatedAt) || !isValidTimestamp(state.trialEndsAt)) {
    return false
  }
  if (state.firstActivatedAt > now) return false
  const ends = Math.min(state.trialEndsAt, state.firstActivatedAt + TRIAL_DURATION_MS)
  return now < ends
}

export function applyRefills(state: UsageState, now: number): UsageState {
  if (isVerifiedClockRollback(state.lastRefillAt, now)) {
    return { ...state, lastRefillAt: now }
  }
  const elapsed = elapsedMs(state.lastRefillAt, now)
  const intervals = Math.floor(elapsed / REFILL_INTERVAL_MS)
  if (intervals <= 0) return state
  return {
    ...state,
    usageBalanceMs: clampBalance(state.usageBalanceMs + intervals * REFILL_AMOUNT_MS),
    lastRefillAt: state.lastRefillAt + intervals * REFILL_INTERVAL_MS,
  }
}

export function consumeActiveMs(state: UsageState, durationMs: number): UsageState {
  if (durationMs <= 0) return state
  return {
    ...state,
    usageBalanceMs: clampBalance(state.usageBalanceMs - durationMs),
  }
}

export function settleActiveSession(
  state: UsageState,
  now: number,
  idleTimeoutMs: number,
): UsageState {
  if (!isValidTimestamp(state.lastActivityAt) || state.lastActivityAt === 0) {
    return { ...state, lastUsageUpdateAt: now }
  }
  if (elapsedMs(state.lastActivityAt, now) > idleTimeoutMs) {
    return { ...state, lastUsageUpdateAt: now }
  }
  const consumed = elapsedMs(state.lastUsageUpdateAt, now)
  return {
    ...consumeActiveMs(state, consumed),
    lastUsageUpdateAt: now,
  }
}

export function noteActiveUsage(
  state: UsageState,
  now: number,
  idleTimeoutMs: number,
): UsageState {
  const settled = settleActiveSession(state, now, idleTimeoutMs)
  return {
    ...settled,
    lastActivityAt: now,
    lastUsageUpdateAt: now,
  }
}

export function nextRefillInMs(state: UsageState, now: number): number | null {
  if (state.usageBalanceMs >= FREE_MAX_BALANCE_MS) return null
  if (!isValidTimestamp(state.lastRefillAt)) return REFILL_INTERVAL_MS
  const elapsed = elapsedMs(state.lastRefillAt, now)
  const remaining = REFILL_INTERVAL_MS - (elapsed % REFILL_INTERVAL_MS)
  return remaining === 0 ? REFILL_INTERVAL_MS : remaining
}

export function resolveEntitlement(
  state: UsageState,
  license: LicenseCache,
  now: number,
  online: boolean,
): EntitlementSnapshot {
  if (isVerifiedPro(license, now, online)) {
    return {
      state: 'PRO',
      decision: 'ALLOW',
      remainingMs: 0,
      nextRefillInMs: null,
      trialRemainingMs: null,
      limitReached: false,
    }
  }
  if (isInTrial(state, now)) {
    return {
      state: 'TRIAL',
      decision: 'ALLOW',
      remainingMs: 0,
      nextRefillInMs: null,
      trialRemainingMs: Math.max(0, state.trialEndsAt - now),
      limitReached: false,
    }
  }
  const remainingMs = clampBalance(state.usageBalanceMs)
  const limitReached = remainingMs <= 0
  return {
    state: 'FREE',
    decision: limitReached ? 'DENY' : 'ALLOW',
    remainingMs,
    nextRefillInMs: nextRefillInMs(state, now),
    trialRemainingMs: null,
    limitReached,
  }
}

export function projectUsage(
  state: UsageState,
  license: LicenseCache,
  now: number,
  online: boolean,
  options: { consumeActive: boolean; idleTimeoutMs: number },
): { state: UsageState; snapshot: EntitlementSnapshot } {
  let next = applyRefills(state, now)
  const kindBeforeConsume = entitlementKind(next, license, now, online)
  if (options.consumeActive && kindBeforeConsume === 'FREE') {
    next = settleActiveSession(next, now, options.idleTimeoutMs)
  } else {
    next = { ...next, lastUsageUpdateAt: now }
  }
  return {
    state: next,
    snapshot: resolveEntitlement(next, license, now, online),
  }
}

export function adoptTrialAnchor(state: UsageState, anchor: number): UsageState {
  if (!isValidTimestamp(anchor)) return state
  if (anchor >= state.firstActivatedAt) return state
  return {
    ...state,
    firstActivatedAt: anchor,
    trialEndsAt: anchor + TRIAL_DURATION_MS,
  }
}

function entitlementKind(
  state: UsageState,
  license: LicenseCache,
  now: number,
  online: boolean,
): EntitlementKind {
  return resolveEntitlement(state, license, now, online).state
}

function isVerifiedClockRollback(lastRefillAt: number, now: number): boolean {
  return isValidTimestamp(lastRefillAt) && now < lastRefillAt
}
