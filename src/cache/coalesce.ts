export function createCoalescer<T>(): (
  key: string,
  run: () => Promise<T>,
) => Promise<T> {
  const inflight = new Map<string, Promise<T>>()
  return (key, run) => {
    const existing = inflight.get(key)
    if (existing) return existing
    const pending = run().finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, pending)
    return pending
  }
}
