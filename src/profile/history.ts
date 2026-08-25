import { normalizeExceptionToken } from './exceptions.ts'
import { HISTORY_STORAGE_KEY, MAX_HISTORY, type CorrectionHistoryItem } from './types.ts'

export { HISTORY_STORAGE_KEY, MAX_HISTORY }

export function normalizeHistory(raw: unknown): CorrectionHistoryItem[] {
  if (!Array.isArray(raw)) return []
  const items: CorrectionHistoryItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Partial<CorrectionHistoryItem>
    const token = normalizeExceptionToken(value.token)
    const replacement =
      typeof value.replacement === 'string' ? value.replacement.trim() : ''
    if (!token || !replacement || token === replacement) continue
    const ts =
      typeof value.ts === 'number' && Number.isFinite(value.ts) ? value.ts : Date.now()
    items.push({ token, replacement, ts })
  }
  return items.slice(-MAX_HISTORY)
}

export function appendHistory(
  items: readonly CorrectionHistoryItem[],
  token: string,
  replacement: string,
): CorrectionHistoryItem[] {
  const normalized = normalizeExceptionToken(token)
  const next = replacement.trim()
  if (!normalized || !next || normalized === next) return [...items]
  const withoutDup = items.filter(
    (item) => !(item.token === normalized && item.replacement === next),
  )
  return normalizeHistory([...withoutDup, { token: normalized, replacement: next, ts: Date.now() }])
}

export function historyPayloadSafe(items: readonly CorrectionHistoryItem[]): boolean {
  return items.every((item) => item.token && item.replacement && !('url' in item) && !('html' in item))
}
