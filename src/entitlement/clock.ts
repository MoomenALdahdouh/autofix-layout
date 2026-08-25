import { CLOCK_BACKWARD_TOLERANCE_MS } from './config.ts'

export function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function clampTimestamp(value: unknown, fallback: number): number {
  return isValidTimestamp(value) ? value : fallback
}

/**
 * Fail-safe clock: backward jumps and invalid "now" values do not invent time.
 * A huge forward jump is still a real elapsed period, but refill/trial math
 * never grants more than the configured maximums.
 */
export function safeNow(rawNow: number, lastSeenAt: number): number {
  if (!isValidTimestamp(rawNow)) return lastSeenAt > 0 ? lastSeenAt : 1
  if (lastSeenAt > 0 && rawNow + CLOCK_BACKWARD_TOLERANCE_MS < lastSeenAt) {
    return lastSeenAt
  }
  return rawNow
}

export function elapsedMs(from: number, to: number): number {
  if (!isValidTimestamp(from) || !isValidTimestamp(to)) return 0
  const delta = to - from
  return delta > 0 ? delta : 0
}
