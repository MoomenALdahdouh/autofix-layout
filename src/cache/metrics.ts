import type { TimingName } from './types.ts'

const samples: Record<TimingName, number[]> = {
  cacheHit: [],
  cacheMiss: [],
  domReplace: [],
  swMessage: [],
}

const MAX_SAMPLES = 200

export function recordTiming(name: TimingName, ms: number): void {
  const list = samples[name]
  list.push(ms)
  if (list.length > MAX_SAMPLES) list.shift()
}

export function measureSync<T>(name: TimingName, fn: () => T): T {
  const start = performance.now()
  const value = fn()
  recordTiming(name, performance.now() - start)
  return value
}

export async function measureAsync<T>(
  name: TimingName,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    recordTiming(name, performance.now() - start)
  }
}

export function cacheTimings(): Record<TimingName, { count: number; p95: number }> {
  return {
    cacheHit: summarize(samples.cacheHit),
    cacheMiss: summarize(samples.cacheMiss),
    domReplace: summarize(samples.domReplace),
    swMessage: summarize(samples.swMessage),
  }
}

export function resetTimings(): void {
  for (const name of Object.keys(samples) as TimingName[]) {
    samples[name] = []
  }
}

function summarize(values: number[]): { count: number; p95: number } {
  if (!values.length) return { count: 0, p95: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return { count: sorted.length, p95: sorted[index] ?? 0 }
}
