import { classificationCacheKey } from './key.ts'
import { measureSync } from './metrics.ts'
import type { ClassificationStore } from './store.ts'
import type { CacheRecord } from './types.ts'

export type HotPathDecision =
  | { kind: 'correct'; record: CacheRecord; corrected: string }
  | { kind: 'valid' }
  | { kind: 'miss' }

export function cacheKeyForToken(
  word: string,
  sourceLayout: string,
  candidateLayouts: readonly string[],
  context?: string,
): string {
  return classificationCacheKey(word, sourceLayout, candidateLayouts, context)
}

export function decideHotPath(
  store: ClassificationStore,
  key: string,
): HotPathDecision {
  const record = measureSync('cacheHit', () => store.get(key))
  if (!record) {
    measureSync('cacheMiss', () => undefined)
    return { kind: 'miss' }
  }
  if (record.result.kind !== 'LAYOUT_MISMATCH') return { kind: 'valid' }
  const corrected = record.corrected
  if (!corrected) return { kind: 'valid' }
  return { kind: 'correct', record, corrected }
}
