import { CONTEXT_KEY_MAX_CHARS } from './types.ts'

export function normalizeCacheToken(word: string): string {
  return word.normalize('NFC').toLocaleLowerCase()
}

export function relevantContext(
  word: string,
  context?: string,
): string | undefined {
  if ([...word].length > CONTEXT_KEY_MAX_CHARS) return undefined
  const parts = (context ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
  if (!parts.length) return undefined
  return parts.join(' ').toLocaleLowerCase()
}

export function classificationCacheKey(
  word: string,
  sourceLayout: string,
  candidateLayouts: readonly string[],
  context?: string,
): string {
  const candidates = [...candidateLayouts].sort().join(',')
  const base = `${normalizeCacheToken(word)}|${sourceLayout}|${candidates}`
  const ctx = relevantContext(word, context)
  return ctx ? `${base}|ctx:${ctx}` : base
}

export function cacheKeyHasLicense(key: string): boolean {
  return /license|lsq_/i.test(key)
}
