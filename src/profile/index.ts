export {
  DEFAULT_USER_PROFILE,
  isCorrectionActive,
  isManualConversionEnabled,
  isDirectShortcutEnabled,
  isCorruptedProfile,
  migrateToUserProfile,
  normalizeUserProfile,
  toLayoutProfile,
  toggleEnabledLayout,
} from './normalize.ts'
export { appendHistory, historyPayloadSafe, normalizeHistory } from './history.ts'
export {
  addException,
  isExceptedToken,
  normalizeExceptionToken,
  normalizeExceptions,
  removeException,
} from './exceptions.ts'
export {
  applyCorrectionEvent,
  normalizeEvents,
  recordEvent,
  revertCount,
} from './learn.ts'
export {
  EVENTS_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  MAX_EVENTS,
  MAX_HISTORY,
  TEMPORARY_PAUSE_MS,
  MAX_EXCEPTION_LENGTH,
  MAX_EXCEPTIONS,
  PROFILE_STORAGE_KEY,
  PROFILE_VERSION,
  REVERT_EXCEPTION_THRESHOLD,
} from './types.ts'
export type {
  CorrectionEvent,
  CorrectionEventKind,
  CorrectionHistoryItem,
  HydratedProfile,
  LegacySettings,
  UserProfile,
} from './types.ts'
