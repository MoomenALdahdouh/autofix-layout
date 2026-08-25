import type { ClassificationResult, LayoutId } from '../layouts/types.ts'

export const WORD_CACHE_STORAGE_KEY = 'wordCacheV2'
export const WORD_CACHE_MAX_MEMORY = 2_000
export const WORD_CACHE_MAX_PERSIST = 5_000
export const WORD_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const CONTEXT_KEY_MAX_CHARS = 3

export type CacheRecord = {
  result: ClassificationResult
  targetLayout?: LayoutId
  corrected?: string
  ts: number
}

export type CacheLookup = {
  record: CacheRecord
  source: 'memory' | 'persist'
}

export type TimingName =
  | 'cacheHit'
  | 'cacheMiss'
  | 'domReplace'
  | 'swMessage'
