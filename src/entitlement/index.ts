export {
  ACTIVE_IDLE_TIMEOUT_MS,
  ACTIVITY_HEARTBEAT_MS,
  FREE_DAILY_ALLOWANCE_SECONDS,
  FREE_MAX_BALANCE_MS,
  LICENSE_CACHE_STORAGE_KEY,
  LICENSE_CACHE_TTL_MS,
  PRO_CHECKOUT_URL,
  REFILL_AMOUNT_MS,
  REFILL_INTERVAL_MS,
  TRIAL_DURATION_MS,
  TRIAL_SYNC_KEY,
  USAGE_STORAGE_KEY,
} from './config.ts'
export { formatDuration, formatTrialRemaining } from './format.ts'
export { createEntitlementEngine, type EntitlementEngine } from './engine.ts'
export { createChromeEntitlementStore } from './chromeStore.ts'
export { emptyLicenseCache, isVerifiedPro, normalizeLicenseCache } from './license.ts'
export {
  applyRefills,
  clampBalance,
  createInitialUsageState,
  isInTrial,
  noteActiveUsage,
  normalizeUsageState,
  projectUsage,
  resolveEntitlement,
} from './usage.ts'
export type {
  EntitlementKind,
  EntitlementSnapshot,
  EntitlementView,
  InterveneDecision,
  LicenseCache,
  UsageState,
} from './types.ts'
