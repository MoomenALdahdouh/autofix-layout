export {
  isBoundaryChar,
  lastCompletedToken,
  peelBoundary,
  splitTrueTrail,
  tokenizeText,
} from './tokenize.ts'
export type { TextPiece, TokenSpan } from './tokenize.ts'
export { isSafeToken, skipReasonForToken } from './tokenKind.ts'
export type { SkipReason } from './tokenKind.ts'
export { probeElement, skipReasonForField } from './fields.ts'
export type { FieldProbe, FieldSkipReason } from './fields.ts'
export {
  addExcludedDomain,
  isExcludedHost,
  normalizeExcludedDomains,
  removeExcludedDomain,
} from './domains.ts'
export {
  ANALYZE_WORD_FIELDS,
  buildAnalyzeWordPayload,
  payloadIsPrivacySafe,
  safeContext,
} from './privacy.ts'
export { isInsideMarkdownCode } from './markdown.ts'

export const MAX_FIELD_CHARS = 2_000
export const MAX_FIELD_TOKENS = 48
