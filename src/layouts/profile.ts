import { classificationCacheKey as layoutCacheKey } from '../cache/key.ts'
import { isSupportedLayout } from './registry.ts'
import type { LayoutId, UserLayoutProfile } from './types.ts'

export const DEFAULT_PROFILE: UserLayoutProfile = {
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'ar-101'],
}

export function normalizeProfile(raw: unknown): UserLayoutProfile {
  if (!raw || typeof raw !== 'object') return DEFAULT_PROFILE
  const value = raw as Partial<UserLayoutProfile>
  const rawSource = value.sourceLayout
  const sourceLayout: LayoutId =
    rawSource && isSupportedLayout(rawSource)
      ? rawSource
      : DEFAULT_PROFILE.sourceLayout
  const enabled = (value.enabledLayouts ?? []).filter((id) =>
    isSupportedLayout(id),
  )
  const unique = [...new Set<LayoutId>([sourceLayout, ...enabled])]
  if (unique.length < 1) return DEFAULT_PROFILE
  return { sourceLayout, enabledLayouts: unique }
}

export function candidateTargets(
  profile: UserLayoutProfile,
  inferredSource: LayoutId = profile.sourceLayout,
): LayoutId[] {
  return profile.enabledLayouts.filter((id) => id !== inferredSource)
}

export function isEnabledLayout(
  profile: UserLayoutProfile,
  layoutId: string,
): layoutId is LayoutId {
  return profile.enabledLayouts.includes(layoutId as LayoutId)
}

export function classificationCacheKey(
  word: string,
  profile: UserLayoutProfile,
  inferredSource: LayoutId = profile.sourceLayout,
  context?: string,
): string {
  return layoutCacheKey(word, inferredSource, profile.enabledLayouts, context)
}
