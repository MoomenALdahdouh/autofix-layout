import type {
  ClassificationResult,
  LayoutId,
  UserLayoutProfile,
} from './layouts/types.ts'
import type { EntitlementView } from './entitlement/types.ts'
import type {
  CorrectionEventKind,
  CorrectionHistoryItem,
} from './profile/types.ts'

export type CheckWordRequest = {
  type: 'CHECK_WORD'
  word: string
  context?: string
  /** Explicit shortcut. Allowed even when automatic correction is off. */
  explicit?: boolean
}

export type CheckWordResult = {
  type: 'CHECK_WORD_RESULT'
  word: string
  result: ClassificationResult
  corrected?: string
  sourceLayout: LayoutId
  source: 'cache' | 'api'
}

export type CheckWordError = {
  type: 'CHECK_WORD_ERROR'
  word: string
  code: 'LICENSE_INVALID' | 'NETWORK' | 'UPSTREAM'
}

export type ActivateLicenseRequest = {
  type: 'ACTIVATE_LICENSE'
  licenseKey: string
}

export type ActivateLicenseResult = {
  type: 'ACTIVATE_LICENSE_RESULT'
  ok: boolean
  licenseRequired: boolean
  status: string
  error?: string
}

export type GetStatusRequest = {
  type: 'GET_STATUS'
}

export type ExtensionStatus = {
  type: 'STATUS'
  enabled: boolean
  manualConversionEnabled: boolean
  directShortcutEnabled: boolean
  commandShortcut: string
  licenseKey: string
  licenseRequired: boolean
  apiBaseUrl: string
  apiReachable: boolean
  profile: UserLayoutProfile
  excludedDomains: string[]
  personalExceptions: string[]
  pausedUntil: number
  recentCorrections: CorrectionHistoryItem[]
  layouts: Array<{ id: LayoutId; name: string; language: string }>
  entitlement: EntitlementView
}

export type SetExcludedDomainsRequest = {
  type: 'SET_EXCLUDED_DOMAINS'
  domains: string[]
}

export type SetEnabledRequest = {
  type: 'SET_ENABLED'
  enabled: boolean
}

export type SetManualConversionRequest = {
  type: 'SET_MANUAL_CONVERSION'
  enabled: boolean
}

export type SetDirectShortcutRequest = {
  type: 'SET_DIRECT_SHORTCUT'
  enabled: boolean
}

export type FixCurrentTextRequest = {
  type: 'FIX_CURRENT_TEXT'
}

export type FixCurrentTextResult = {
  type: 'FIX_CURRENT_TEXT_RESULT'
  applied: boolean
  reason?:
    | 'disabled'
    | 'composing'
    | 'blocked'
    | 'usage'
    | 'no-target'
    | 'unsupported'
    | 'noop'
    | 'stale'
}

export type SetProfileRequest = {
  type: 'SET_PROFILE'
  profile: UserLayoutProfile
}

export type AddExceptionRequest = {
  type: 'ADD_EXCEPTION'
  token: string
}

export type RemoveExceptionRequest = {
  type: 'REMOVE_EXCEPTION'
  token: string
}

export type RecordCorrectionRequest = {
  type: 'RECORD_CORRECTION'
  kind: CorrectionEventKind
  token: string
  replacement?: string
}

export type PauseTemporarilyRequest = {
  type: 'PAUSE_TEMPORARILY'
  ms?: number
}

export type AddExcludedDomainRequest = {
  type: 'ADD_EXCLUDED_DOMAIN'
  domain: string
}

export type RemoveExcludedDomainRequest = {
  type: 'REMOVE_EXCLUDED_DOMAIN'
  domain: string
}

export type ClearHistoryRequest = {
  type: 'CLEAR_HISTORY'
}

export type NoteUsageActivityRequest = {
  type: 'NOTE_USAGE_ACTIVITY'
}

export type CanInterveneRequest = {
  type: 'CAN_INTERVENE'
}

export type InterveneDecisionResult = {
  type: 'INTERVENE_DECISION'
  decision: 'ALLOW' | 'DENY'
  canIntervene: boolean
}

export type ExtensionRequest =
  | CheckWordRequest
  | ActivateLicenseRequest
  | GetStatusRequest
  | SetEnabledRequest
  | SetManualConversionRequest
  | SetDirectShortcutRequest
  | FixCurrentTextRequest
  | SetProfileRequest
  | SetExcludedDomainsRequest
  | AddExceptionRequest
  | RemoveExceptionRequest
  | RecordCorrectionRequest
  | PauseTemporarilyRequest
  | AddExcludedDomainRequest
  | RemoveExcludedDomainRequest
  | ClearHistoryRequest
  | NoteUsageActivityRequest
  | CanInterveneRequest

export type ExtensionResponse =
  | CheckWordResult
  | CheckWordError
  | ActivateLicenseResult
  | ExtensionStatus
  | InterveneDecisionResult
  | FixCurrentTextResult
