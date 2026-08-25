import { ACTIVE_IDLE_TIMEOUT_MS } from './config.ts'
import { isValidTimestamp, safeNow } from './clock.ts'
import { usageDebug } from './debug.ts'
import {
  emptyLicenseCache,
  licenseCacheFromActivation,
  normalizeLicenseCache,
} from './license.ts'
import type { LicenseCache, UsageState } from './types.ts'
import type { EntitlementSnapshot, EntitlementView, InterveneDecision } from './types.ts'
import {
  adoptTrialAnchor,
  applyRefills,
  createInitialUsageState,
  noteActiveUsage,
  normalizeUsageState,
  projectUsage,
  resolveEntitlement,
} from './usage.ts'

export type EntitlementStore = {
  loadUsage(): Promise<unknown>
  saveUsage(state: StoredUsage): Promise<void>
  loadTrialAnchor(): Promise<number | null>
  saveTrialAnchor(ts: number): Promise<void>
  loadLicense(): Promise<unknown>
  saveLicense(cache: LicenseCache): Promise<void>
}

export type StoredUsage = UsageState & {
  canIntervene: boolean
}

export function createEntitlementEngine(options: {
  now?: () => number
  isOnline?: () => boolean
  store: EntitlementStore
  idleTimeoutMs?: number
}) {
  const idleTimeoutMs = options.idleTimeoutMs ?? ACTIVE_IDLE_TIMEOUT_MS
  let usage: UsageState | null = null
  let license = emptyLicenseCache()
  let ready: Promise<void> | null = null
  let chain = Promise.resolve()

  function rawNow(): number {
    return options.now?.() ?? Date.now()
  }

  function now(): number {
    const lastSeen = Math.max(
      usage?.lastUsageUpdateAt ?? 0,
      usage?.lastRefillAt ?? 0,
      license.verifiedAt,
    )
    return safeNow(rawNow(), lastSeen)
  }

  function online(): boolean {
    return options.isOnline?.() ?? true
  }

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function view(snapshot: EntitlementSnapshot): EntitlementView {
    return { ...snapshot, canIntervene: snapshot.decision === 'ALLOW' }
  }

  function stored(state: UsageState, snapshot: EntitlementSnapshot): StoredUsage {
    return { ...state, canIntervene: snapshot.decision === 'ALLOW' }
  }

  async function persist(state: UsageState, snapshot: EntitlementSnapshot): Promise<void> {
    usage = state
    await options.store.saveUsage(stored(state, snapshot))
  }

  async function hydrate(): Promise<void> {
    if (ready) return ready
    ready = (async () => {
      const [rawUsage, rawLicense, anchor] = await Promise.all([
        options.store.loadUsage(),
        options.store.loadLicense(),
        options.store.loadTrialAnchor(),
      ])
      license = normalizeLicenseCache(rawLicense)
      const t = now()
      const existing =
        rawUsage &&
        typeof rawUsage === 'object' &&
        isValidTimestamp((rawUsage as UsageState).firstActivatedAt)
      let state = existing ? normalizeUsageState(rawUsage, t) : createInitialUsageState(t)
      if (isValidTimestamp(anchor)) {
        state = adoptTrialAnchor(state, anchor)
      } else {
        await options.store.saveTrialAnchor(state.firstActivatedAt)
      }
      const projected = projectUsage(state, license, t, online(), {
        consumeActive: true,
        idleTimeoutMs,
      })
      await persist(projected.state, projected.snapshot)
      usageDebug('activated', {
        state: projected.snapshot.state,
        remainingMs: projected.snapshot.remainingMs,
        firstActivatedAt: projected.state.firstActivatedAt,
      })
    })()
    return ready
  }

  async function current(): Promise<{ state: UsageState; snapshot: EntitlementSnapshot }> {
    await hydrate()
    const t = now()
    const projected = projectUsage(usage ?? createInitialUsageState(t), license, t, online(), {
      consumeActive: true,
      idleTimeoutMs,
    })
    await persist(projected.state, projected.snapshot)
    return projected
  }

  return {
    ensureActivated(): Promise<EntitlementView> {
      return exclusive(async () => view((await current()).snapshot))
    },

    snapshot(): Promise<EntitlementView> {
      return exclusive(async () => view((await current()).snapshot))
    },

    canIntervene(): Promise<InterveneDecision> {
      return exclusive(async () => (await current()).snapshot.decision)
    },

    noteActivity(): Promise<EntitlementView> {
      return exclusive(async () => {
        await hydrate()
        const t = now()
        let state = applyRefills(usage ?? createInitialUsageState(t), t)
        const before = resolveEntitlement(state, license, t, online())
        if (before.state === 'FREE') {
          state = noteActiveUsage(state, t, idleTimeoutMs)
        } else {
          state = { ...state, lastActivityAt: t, lastUsageUpdateAt: t }
        }
        const snapshot = resolveEntitlement(state, license, t, online())
        await persist(state, snapshot)
        if (snapshot.limitReached) {
          usageDebug('limit-reached', { remainingMs: snapshot.remainingMs })
        }
        return view(snapshot)
      })
    },

    rememberLicense(valid: boolean, status: string): Promise<EntitlementView> {
      return exclusive(async () => {
        await hydrate()
        license = licenseCacheFromActivation(valid, status, now())
        await options.store.saveLicense(license)
        usageDebug('license', { valid, status })
        return view((await current()).snapshot)
      })
    },

    async peekCanIntervene(): Promise<boolean> {
      const snapshot = await this.snapshot()
      return snapshot.canIntervene
    },
  }
}

export type EntitlementEngine = ReturnType<typeof createEntitlementEngine>
