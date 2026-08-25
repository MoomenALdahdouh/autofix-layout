const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Less than 1 minute'
  const hours = Math.floor(ms / HOUR_MS)
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS)
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return 'Less than 1 minute'
}

export function formatTrialRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Less than 1 day'
  const days = Math.ceil(ms / DAY_MS)
  if (days <= 1) return 'Less than 1 day'
  return `${days} days remaining`
}
