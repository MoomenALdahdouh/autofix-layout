import {
  LICENSE_CACHE_STORAGE_KEY,
  TRIAL_SYNC_KEY,
  USAGE_STORAGE_KEY,
} from './config.ts'
import { isValidTimestamp } from './clock.ts'
import type { EntitlementStore, StoredUsage } from './engine.ts'
import type { LicenseCache } from './types.ts'

export function createChromeEntitlementStore(): EntitlementStore {
  return {
    async loadUsage(): Promise<unknown> {
      const stored = await chrome.storage.local.get({ [USAGE_STORAGE_KEY]: null })
      return stored[USAGE_STORAGE_KEY]
    },
    async saveUsage(state: StoredUsage): Promise<void> {
      await chrome.storage.local.set({ [USAGE_STORAGE_KEY]: state })
    },
    async loadTrialAnchor(): Promise<number | null> {
      const stored = await chrome.storage.sync.get({ [TRIAL_SYNC_KEY]: 0 })
      const value = Number(stored[TRIAL_SYNC_KEY] ?? 0)
      return isValidTimestamp(value) ? value : null
    },
    async saveTrialAnchor(ts: number): Promise<void> {
      await chrome.storage.sync.set({ [TRIAL_SYNC_KEY]: ts })
    },
    async loadLicense(): Promise<unknown> {
      const stored = await chrome.storage.local.get({ [LICENSE_CACHE_STORAGE_KEY]: null })
      return stored[LICENSE_CACHE_STORAGE_KEY]
    },
    async saveLicense(cache: LicenseCache): Promise<void> {
      await chrome.storage.local.set({ [LICENSE_CACHE_STORAGE_KEY]: cache })
    },
  }
}
