import { isSafeToken } from './tokenKind.ts'

export const ANALYZE_WORD_FIELDS = [
  'license_key',
  'word',
  'context',
  'source_layout',
  'candidate_layouts',
] as const

export type AnalyzeWordPayload = {
  license_key?: string
  word: string
  context?: string
  source_layout: string
  candidate_layouts: string[]
}

const FORBIDDEN = /html|url|href|history|password|keystroke|document|page/i

export function safeContext(context?: string): string | undefined {
  if (!context) return undefined
  const parts = context
    .trim()
    .split(/\s+/)
    .filter((part) => part && isSafeToken(part))
    .slice(-4)
  if (!parts.length) return undefined
  return parts.join(' ').slice(0, 200)
}

export function buildAnalyzeWordPayload(
  input: AnalyzeWordPayload,
): AnalyzeWordPayload {
  const payload: AnalyzeWordPayload = {
    word: input.word,
    source_layout: input.source_layout,
    candidate_layouts: [...input.candidate_layouts],
  }
  if (input.license_key) payload.license_key = input.license_key
  const context = safeContext(input.context)
  if (context) payload.context = context
  return payload
}

export function payloadIsPrivacySafe(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) =>
    (ANALYZE_WORD_FIELDS as readonly string[]).includes(key),
  )
}

export function looksLikeForbiddenField(key: string): boolean {
  return FORBIDDEN.test(key)
}
