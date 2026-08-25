import type { UserLayoutProfile } from '../layouts/types.ts'

export const PROFILE_VERSION = 1
export const PROFILE_STORAGE_KEY = 'autofixProfile'
export const EVENTS_STORAGE_KEY = 'autofixEvents'
export const MAX_EXCEPTIONS = 200
export const MAX_EXCEPTION_LENGTH = 64
export const MAX_EVENTS = 200
export const MAX_HISTORY = 40
export const HISTORY_STORAGE_KEY = 'autofixHistory'
export const TEMPORARY_PAUSE_MS = 60 * 60 * 1000
export const REVERT_EXCEPTION_THRESHOLD = 2

export type CorrectionEventKind = 'accepted' | 'ignored' | 'reverted'

export type CorrectionEvent = {
  kind: CorrectionEventKind
  token: string
  replacement?: string
  ts: number
}

export type CorrectionHistoryItem = {
  token: string
  replacement: string
  ts: number
}

export type UserProfile = UserLayoutProfile & {
  enabled: boolean
  manualConversionEnabled: boolean
  directShortcutEnabled: boolean
  excludedDomains: string[]
  personalExceptions: string[]
  pausedUntil: number
}

export type LegacySettings = {
  enabled?: unknown
  layoutProfile?: unknown
  excludedDomains?: unknown
  personalExceptions?: unknown
}

export type HydratedProfile = {
  profile: UserProfile
  migrated: boolean
  recovered: boolean
}
