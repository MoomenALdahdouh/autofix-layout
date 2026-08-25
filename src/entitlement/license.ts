import { LICENSE_CACHE_TTL_MS } from './config.ts'
import { isValidTimestamp } from './clock.ts'
import type { LicenseCache } from './types.ts'

export function emptyLicenseCache(): LicenseCache {
  return { valid: false, status: 'unknown', verifiedAt: 0 }
}

export function normalizeLicenseCache(raw: unknown): LicenseCache {
  if (!raw || typeof raw !== 'object') return emptyLicenseCache()
  const value = raw as Partial<LicenseCache>
  return {
    valid: value.valid === true,
    status: typeof value.status === 'string' && value.status ? value.status : 'unknown',
    verifiedAt: isValidTimestamp(value.verifiedAt) ? value.verifiedAt : 0,
  }
}

/**
 * Pro only after the existing Lemon/activate path said the key is valid.
 * A client-supplied `isPro: true` is ignored because it never enters this type.
 * Offline: a previously verified-valid cache stays Pro so local conversion is not cut off.
 */
export function isVerifiedPro(cache: LicenseCache, now: number, online: boolean): boolean {
  if (!cache.valid || !isValidTimestamp(cache.verifiedAt)) return false
  if (cache.verifiedAt > now) return false
  if (!online) return true
  return now - cache.verifiedAt <= LICENSE_CACHE_TTL_MS
}

export function licenseCacheFromActivation(
  valid: boolean,
  status: string,
  now: number,
): LicenseCache {
  return {
    valid,
    status: status || (valid ? 'active' : 'invalid'),
    verifiedAt: now,
  }
}
