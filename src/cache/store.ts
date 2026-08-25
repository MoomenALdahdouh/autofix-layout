import { TtlLruCache } from './lru.ts'
import { isCacheableRecord } from './record.ts'
import {
  WORD_CACHE_MAX_MEMORY,
  WORD_CACHE_MAX_PERSIST,
  WORD_CACHE_TTL_MS,
  type CacheRecord,
} from './types.ts'

export type CachePersistence = {
  load(): Promise<unknown>
  save(entries: Record<string, CacheRecord>): Promise<void>
}

export function createClassificationStore(options?: {
  maxMemory?: number
  maxPersist?: number
  ttlMs?: number
  persistence?: CachePersistence
  now?: () => number
}): ClassificationStore {
  return new ClassificationStore(options)
}

export class ClassificationStore {
  readonly memory: TtlLruCache
  private readonly maxPersist: number
  private readonly persistence?: CachePersistence
  private hydrated = false
  private hydratePromise: Promise<void> | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options?: {
    maxMemory?: number
    maxPersist?: number
    ttlMs?: number
    persistence?: CachePersistence
    now?: () => number
  }) {
    this.memory = new TtlLruCache(
      options?.maxMemory ?? WORD_CACHE_MAX_MEMORY,
      options?.ttlMs ?? WORD_CACHE_TTL_MS,
      options?.now,
    )
    this.maxPersist = options?.maxPersist ?? WORD_CACHE_MAX_PERSIST
    this.persistence = options?.persistence
  }

  get(key: string): CacheRecord | undefined {
    return this.memory.get(key)
  }

  set(key: string, record: CacheRecord): boolean {
    if (!isCacheableRecord(record)) return false
    this.memory.set(key, record)
    this.schedulePersist()
    return true
  }

  async ready(): Promise<void> {
    if (this.hydrated || !this.persistence) {
      this.hydrated = true
      return
    }
    this.hydratePromise ??= this.persistence.load().then((raw) => {
      this.memory.hydrate(raw)
      this.hydrated = true
    })
    await this.hydratePromise
  }

  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.persistence) return
    await this.persistence.save(this.memory.dump(this.maxPersist))
  }

  private schedulePersist(): void {
    if (!this.persistence || this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistence?.save(this.memory.dump(this.maxPersist))
    }, 50)
  }
}

export function chromeCachePersistence(
  storageKey: string,
): CachePersistence {
  return {
    async load() {
      const stored = await chrome.storage.local.get(storageKey)
      return stored[storageKey]
    },
    async save(entries) {
      await chrome.storage.local.set({ [storageKey]: entries })
    },
  }
}
