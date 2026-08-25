export type EntitlementKind = 'TRIAL' | 'FREE' | 'PRO'
export type InterveneDecision = 'ALLOW' | 'DENY'

export type UsageState = {
  version: number
  firstActivatedAt: number
  trialEndsAt: number
  usageBalanceMs: number
  lastUsageUpdateAt: number
  lastActivityAt: number
  lastRefillAt: number
}

export type LicenseCache = {
  valid: boolean
  status: string
  verifiedAt: number
}

export type EntitlementSnapshot = {
  state: EntitlementKind
  decision: InterveneDecision
  remainingMs: number
  nextRefillInMs: number | null
  trialRemainingMs: number | null
  limitReached: boolean
}

export type EntitlementView = EntitlementSnapshot & {
  canIntervene: boolean
}
