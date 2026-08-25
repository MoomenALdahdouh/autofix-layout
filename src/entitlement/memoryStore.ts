import { isValidTimestamp } from './clock.ts'
import type { EntitlementStore, StoredUsage } from './engine.ts'
import type { LicenseCache } from './types.ts'

export function createMemoryEntitlementStore(seed?: {
  usage?: unknown
  license?: unknown
  trialAnchor?: number | null
}): EntitlementStore {
  let usage: unknown = seed?.usage ?? null
  let license: unknown = seed?.license ?? null
  let trialAnchor: number | null =
    seed?.trialAnchor != null && isValidTimestamp(seed.trialAnchor) ? seed.trialAnchor : null

  return {
    async loadUsage() {
      return usage
    },
    async saveUsage(state: StoredUsage) {
      usage = state
    },
    async loadTrialAnchor() {
      return trialAnchor
    },
    async saveTrialAnchor(ts: number) {
      trialAnchor = ts
    },
    async loadLicense() {
      return license
    },
    async saveLicense(cache: LicenseCache) {
      license = cache
    },
  }
}
