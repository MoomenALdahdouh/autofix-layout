import { parseCacheRecord } from './record.ts'
import type { CacheRecord } from './types.ts'

export class TtlLruCache {
  private readonly entries = new Map<string, CacheRecord>()
  private readonly maxSize: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(maxSize: number, ttlMs: number, now: () => number = () => Date.now()) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
    this.now = now
  }

  get size(): number {
    return this.entries.size
  }

  peek(key: string): CacheRecord | undefined {
    const record = this.entries.get(key)
    if (!record) return undefined
    if (this.now() - record.ts > this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    return record
  }

  get(key: string): CacheRecord | undefined {
    const record = this.peek(key)
    if (!record) return undefined
    this.entries.delete(key)
    this.entries.set(key, record)
    return record
  }

  set(key: string, record: CacheRecord): void {
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, record)
    this.evict()
  }

  hydrate(raw: unknown): void {
    this.entries.clear()
    if (!raw || typeof raw !== 'object') return
    const rows = Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => {
        const record = parseCacheRecord(value)
        return record ? ([key, record] as const) : null
      })
      .filter((row): row is readonly [string, CacheRecord] => row !== null)
      .sort((a, b) => a[1].ts - b[1].ts)

    for (const [key, record] of rows) {
      if (this.now() - record.ts > this.ttlMs) continue
      this.entries.set(key, record)
    }
    this.evict()
  }

  dump(limit = this.maxSize): Record<string, CacheRecord> {
    const out: Record<string, CacheRecord> = {}
    const rows = [...this.entries.entries()].slice(-limit)
    for (const [key, record] of rows) {
      if (this.now() - record.ts > this.ttlMs) continue
      out[key] = record
    }
    return out
  }

  private evict(): void {
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}
