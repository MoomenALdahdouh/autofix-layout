import { DEFAULT_PROFILE, normalizeProfile } from '../layouts/profile.ts'
import { isSupportedLayout } from '../layouts/registry.ts'
import type { LayoutId } from '../layouts/types.ts'
import { normalizeExcludedDomains } from '../safety/domains.ts'
import { normalizeExceptions } from './exceptions.ts'
import type { HydratedProfile, LegacySettings, UserProfile } from './types.ts'
import { PROFILE_VERSION } from './types.ts'

export const DEFAULT_USER_PROFILE: UserProfile = {
  enabled: true,
  manualConversionEnabled: true,
  directShortcutEnabled: true,
  sourceLayout: DEFAULT_PROFILE.sourceLayout,
  enabledLayouts: [...DEFAULT_PROFILE.enabledLayouts],
  excludedDomains: [],
  personalExceptions: [],
  pausedUntil: 0,
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

export function isCorruptedProfile(raw: unknown): boolean {
  if (raw == null) return false
  if (typeof raw !== 'object' || Array.isArray(raw)) return true
  const value = raw as Record<string, unknown>
  if ('version' in value && value.version !== PROFILE_VERSION && value.version !== undefined) {
    if (typeof value.version !== 'number') return true
  }
  if ('enabled' in value && typeof value.enabled !== 'boolean' && value.enabled !== undefined) {
    return true
  }
  if (
    'manualConversionEnabled' in value &&
    typeof value.manualConversionEnabled !== 'boolean' &&
    value.manualConversionEnabled !== undefined
  ) {
    return true
  }
  if (
    'directShortcutEnabled' in value &&
    typeof value.directShortcutEnabled !== 'boolean' &&
    value.directShortcutEnabled !== undefined
  ) {
    return true
  }
  if ('enabledLayouts' in value && value.enabledLayouts != null && !Array.isArray(value.enabledLayouts)) {
    return true
  }
  if (
    'personalExceptions' in value &&
    value.personalExceptions != null &&
    !Array.isArray(value.personalExceptions) &&
    typeof value.personalExceptions !== 'string'
  ) {
    return true
  }
  return false
}

export function normalizeUserProfile(raw: unknown): UserProfile {
  if (isCorruptedProfile(raw)) return { ...DEFAULT_USER_PROFILE }
  const value = asRecord(raw)
  if (!value) return { ...DEFAULT_USER_PROFILE }

  const layouts = normalizeProfile({
    sourceLayout: value.sourceLayout,
    enabledLayouts: value.enabledLayouts,
  })

  const pausedUntil =
    typeof value.pausedUntil === 'number' && Number.isFinite(value.pausedUntil)
      ? Math.max(0, value.pausedUntil)
      : 0

  return {
    enabled: value.enabled !== false,
    manualConversionEnabled: value.manualConversionEnabled !== false,
    directShortcutEnabled: value.directShortcutEnabled !== false,
    sourceLayout: layouts.sourceLayout,
    enabledLayouts: layouts.enabledLayouts,
    excludedDomains: normalizeExcludedDomains(value.excludedDomains),
    personalExceptions: normalizeExceptions(value.personalExceptions),
    pausedUntil,
  }
}

export function isCorrectionActive(
  profile: Pick<UserProfile, 'enabled' | 'pausedUntil'>,
  now = Date.now(),
): boolean {
  return profile.enabled && now >= (profile.pausedUntil || 0)
}

export function isManualConversionEnabled(
  profile: Pick<UserProfile, 'manualConversionEnabled'>,
): boolean {
  return profile.manualConversionEnabled !== false
}

export function isDirectShortcutEnabled(
  profile: Pick<UserProfile, 'directShortcutEnabled'>,
): boolean {
  return profile.directShortcutEnabled !== false
}

export function migrateToUserProfile(input: {
  current?: unknown
  legacy?: LegacySettings
}): HydratedProfile {
  const current = input.current
  const legacy = input.legacy ?? {}

  if (current != null && !isCorruptedProfile(current) && asRecord(current)) {
    const profile = normalizeUserProfile({
      ...asRecord(current),
      excludedDomains:
        asRecord(current)?.excludedDomains ?? legacy.excludedDomains,
      personalExceptions:
        asRecord(current)?.personalExceptions ?? legacy.personalExceptions,
    })
    return { profile, migrated: false, recovered: false }
  }

  if (current != null && isCorruptedProfile(current)) {
    const recovered = normalizeUserProfile({
      enabled: legacy.enabled,
      ...(asRecord(legacy.layoutProfile) ?? {}),
      excludedDomains: legacy.excludedDomains,
      personalExceptions: legacy.personalExceptions,
    })
    return { profile: recovered, migrated: true, recovered: true }
  }

  const hasLegacy =
    legacy.enabled !== undefined ||
    legacy.layoutProfile != null ||
    (Array.isArray(legacy.excludedDomains) && legacy.excludedDomains.length > 0) ||
    (Array.isArray(legacy.personalExceptions) &&
      legacy.personalExceptions.length > 0)

  if (!hasLegacy) {
    return { profile: { ...DEFAULT_USER_PROFILE }, migrated: false, recovered: false }
  }

  const profile = normalizeUserProfile({
    enabled: legacy.enabled,
    ...(asRecord(legacy.layoutProfile) ?? {}),
    excludedDomains: legacy.excludedDomains,
    personalExceptions: legacy.personalExceptions,
  })
  return { profile, migrated: true, recovered: false }
}

export function toggleEnabledLayout(
  profile: UserProfile,
  id: LayoutId,
): UserProfile {
  if (!isSupportedLayout(id) || id === profile.sourceLayout) return profile
  const enabled = profile.enabledLayouts.includes(id)
    ? profile.enabledLayouts.filter((item) => item !== id)
    : [...profile.enabledLayouts, id]
  return normalizeUserProfile({ ...profile, enabledLayouts: enabled })
}

export function toLayoutProfile(profile: UserProfile) {
  return {
    sourceLayout: profile.sourceLayout,
    enabledLayouts: profile.enabledLayouts,
  }
}
