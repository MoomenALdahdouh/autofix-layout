export { cacheKeyForToken, decideHotPath } from './hotPath.ts'
export type { HotPathDecision } from './hotPath.ts'
export {
  cacheKeyHasLicense,
  classificationCacheKey,
  normalizeCacheToken,
  relevantContext,
} from './key.ts'
export { TtlLruCache } from './lru.ts'
export { createCoalescer } from './coalesce.ts'
export {
  isCacheableRecord,
  parseCacheRecord,
  toCacheRecord,
} from './record.ts'
export {
  ClassificationStore,
  chromeCachePersistence,
  createClassificationStore,
} from './store.ts'
export {
  cacheTimings,
  measureAsync,
  measureSync,
  recordTiming,
  resetTimings,
} from './metrics.ts'
export {
  CONTEXT_KEY_MAX_CHARS,
  WORD_CACHE_MAX_MEMORY,
  WORD_CACHE_MAX_PERSIST,
  WORD_CACHE_STORAGE_KEY,
  WORD_CACHE_TTL_MS,
} from './types.ts'
export type { CacheLookup, CacheRecord, TimingName } from './types.ts'
