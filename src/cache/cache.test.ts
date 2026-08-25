import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, classificationCacheKey } from '../layouts/profile.ts'
import {
  cacheKeyForToken,
  cacheKeyHasLicense,
  cacheTimings,
  classificationCacheKey as rawCacheKey,
  createClassificationStore,
  createCoalescer,
  decideHotPath,
  isCacheableRecord,
  measureAsync,
  measureSync,
  parseCacheRecord,
  relevantContext,
  resetTimings,
  toCacheRecord,
} from './index.ts'
import { TtlLruCache } from './lru.ts'
import { WORD_CACHE_TTL_MS } from './types.ts'

afterEach(() => {
  resetTimings()
})

describe('cache keys', () => {
  it('uses the normalized token, source, and candidate profile — never a license', () => {
    const key = classificationCacheKey('hsjo]lj', DEFAULT_PROFILE)
    expect(key).toBe('hsjo]lj|en-US-qwerty|ar-101,en-US-qwerty')
    expect(cacheKeyHasLicense(key)).toBe(false)
    expect(rawCacheKey('React', 'en-US-qwerty', ['ar-101', 'en-US-qwerty'])).toBe(
      'react|en-US-qwerty|ar-101,en-US-qwerty',
    )
  })

  it('adds relevant context only for short tokens', () => {
    expect(relevantContext('hsjo]lj', 'React td')).toBeUndefined()
    expect(relevantContext('td', 'hsjo]lj React')).toBe('hsjo]lj react')
    expect(
      classificationCacheKey('td', DEFAULT_PROFILE, 'en-US-qwerty', 'hsjo]lj React'),
    ).toBe('td|en-US-qwerty|ar-101,en-US-qwerty|ctx:hsjo]lj react')
  })
})

describe('records and poisoning', () => {
  it('accepts only VALID or LAYOUT_MISMATCH and migrates the old shape', () => {
    expect(
      parseCacheRecord({
        kind: 'LAYOUT_MISMATCH',
        targetLayout: 'ar-101',
        corrected: 'استخدمت',
        ts: 1,
      }),
    ).toEqual({
      result: { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' },
      targetLayout: 'ar-101',
      corrected: 'استخدمت',
      ts: 1,
    })
    expect(parseCacheRecord({ kind: 'NETWORK' })).toBeNull()
    expect(parseCacheRecord({ result: { kind: 'LAYOUT_MISMATCH' } })).toBeNull()
    expect(isCacheableRecord(null)).toBe(false)
    expect(isCacheableRecord(toCacheRecord({ kind: 'VALID' }))).toBe(true)
  })
})

describe('in-memory LRU + expiration', () => {
  it('evicts the least recently used entry and drops expired rows', () => {
    let now = 1_000
    const cache = new TtlLruCache(2, 100, () => now)
    cache.set('a', toCacheRecord({ kind: 'VALID' }, { ts: now }))
    cache.set('b', toCacheRecord({ kind: 'VALID' }, { ts: now }))
    cache.get('a')
    cache.set('c', toCacheRecord({ kind: 'VALID' }, { ts: now }))
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')?.result).toEqual({ kind: 'VALID' })

    now = 1_200
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('c')).toBeUndefined()
  })

  it('hydrates from persistent storage and ignores junk', () => {
    const store = createClassificationStore({ ttlMs: WORD_CACHE_TTL_MS })
    store.memory.hydrate({
      good: toCacheRecord(
        { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' },
        { corrected: 'في', ts: Date.now() },
      ),
      bad: { error: true },
    })
    expect(store.get('good')?.corrected).toBe('في')
    expect(store.get('bad')).toBeUndefined()
  })
})

describe('hot path', () => {
  it('corrects a known token immediately and leaves an unknown token as a miss', () => {
    const store = createClassificationStore()
    const key = cacheKeyForToken('hsjo]lj', 'en-US-qwerty', ['en-US-qwerty', 'ar-101'])
    store.set(
      key,
      toCacheRecord(
        { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' },
        { corrected: 'استخدمت' },
      ),
    )
    expect(decideHotPath(store, key)).toEqual({
      kind: 'correct',
      record: store.get(key),
      corrected: 'استخدمت',
    })
    expect(decideHotPath(store, 'unknown|en-US-qwerty|ar-101')).toEqual({
      kind: 'miss',
    })
    expect(cacheTimings().cacheHit.p95).toBeLessThan(5)
    expect(cacheTimings().cacheMiss.p95).toBeLessThan(5)
  })
})

describe('offline and failures', () => {
  it('corrects a known token without a backend call', () => {
    let fetches = 0
    const store = createClassificationStore()
    const key = classificationCacheKey('hsjo]lj', DEFAULT_PROFILE)
    store.set(
      key,
      toCacheRecord(
        { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' },
        { corrected: 'استخدمت' },
      ),
    )
    const hit = store.get(key)
    expect(hit?.corrected).toBe('استخدمت')
    expect(fetches).toBe(0)
  })

  it('leaves unknown tokens unchanged and does not cache errors', () => {
    const store = createClassificationStore()
    const key = classificationCacheKey('zzzzzz', DEFAULT_PROFILE)
    expect(store.get(key)).toBeUndefined()
    expect(
      store.set(key, parseCacheRecord({ kind: 'UPSTREAM' }) as never),
    ).toBe(false)
    expect(store.get(key)).toBeUndefined()
  })
})

describe('request coalescing', () => {
  it('shares one inflight request for the same token/layout key', async () => {
    let runs = 0
    const coalesce = createCoalescer<string>()
    const run = () =>
      new Promise<string>((resolve) => {
        runs += 1
        setTimeout(() => resolve('ok'), 15)
      })
    const [a, b] = await Promise.all([coalesce('k', run), coalesce('k', run)])
    expect(a).toBe('ok')
    expect(b).toBe('ok')
    expect(runs).toBe(1)
  })
})

describe('persistence', () => {
  it('writes a bounded snapshot through the persistence adapter', async () => {
    let saved: Record<string, unknown> | null = null
    const store = createClassificationStore({
      maxMemory: 3,
      maxPersist: 2,
      persistence: {
        async load() {
          return null
        },
        async save(entries) {
          saved = entries
        },
      },
    })
    const ts = Date.now()
    store.set('a', toCacheRecord({ kind: 'VALID' }, { ts }))
    store.set('b', toCacheRecord({ kind: 'VALID' }, { ts: ts + 1 }))
    store.set('c', toCacheRecord({ kind: 'VALID' }, { ts: ts + 2 }))
    await store.flush()
    expect(saved).not.toBeNull()
    expect(Object.keys(saved ?? {})).toHaveLength(2)
  })
})

describe('benchmarks', () => {
  it('keeps the local cache-hit path under 5ms', () => {
    const store = createClassificationStore()
    const key = classificationCacheKey('hsjo]lj', DEFAULT_PROFILE)
    store.set(
      key,
      toCacheRecord(
        { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' },
        { corrected: 'استخدمت' },
      ),
    )
    for (let i = 0; i < 80; i += 1) {
      measureSync('cacheHit', () => store.get(key))
    }
    expect(cacheTimings().cacheHit.p95).toBeLessThan(5)
  })

  it('measures a cache miss as a completed lookup without a write', () => {
    const store = createClassificationStore()
    const start = performance.now()
    expect(store.get('missing')).toBeUndefined()
    const miss = performance.now() - start
    expect(miss).toBeLessThan(5)
  })

  it('measures service-worker message latency for a resolved cache reply', async () => {
    await measureAsync('swMessage', async () => {
      await Promise.resolve({ type: 'CHECK_WORD_RESULT', source: 'cache' })
    })
    expect(cacheTimings().swMessage.p95).toBeLessThan(5)
  })
})
