import { describe, expect, it } from 'vitest'
import { isExcludedHost } from '../safety/domains.ts'
import { planFieldFixes } from '../layouts/sentence.ts'
import {
  DEFAULT_USER_PROFILE,
  addException,
  applyCorrectionEvent,
  isCorrectionActive,
  isDirectShortcutEnabled,
  isCorruptedProfile,
  isExceptedToken,
  isManualConversionEnabled,
  migrateToUserProfile,
  normalizeEvents,
  normalizeExceptions,
  normalizeUserProfile,
  removeException,
  toggleEnabledLayout,
} from './index.ts'

describe('user profile defaults', () => {
  it('round-trips through JSON the way chrome.storage persists it', () => {
    const stored = normalizeUserProfile({
      enabled: false,
      enabledLayouts: ['en-US-qwerty', 'ru-standard'],
      excludedDomains: ['mail.example.com'],
      personalExceptions: ['td', 'API'],
    })
    const revived = normalizeUserProfile(JSON.parse(JSON.stringify(stored)))
    expect(revived).toEqual(stored)
  })

  it('starts enabled with English and Arabic, no setup required', () => {
    expect(normalizeUserProfile(null)).toEqual(DEFAULT_USER_PROFILE)
    expect(DEFAULT_USER_PROFILE.enabled).toBe(true)
    expect(DEFAULT_USER_PROFILE.manualConversionEnabled).toBe(true)
    expect(DEFAULT_USER_PROFILE.directShortcutEnabled).toBe(true)
    expect(DEFAULT_USER_PROFILE.enabledLayouts).toEqual(['en-US-qwerty', 'ar-101'])
    expect(DEFAULT_USER_PROFILE.excludedDomains).toEqual([])
    expect(DEFAULT_USER_PROFILE.personalExceptions).toEqual([])
  })

  it('persists independent feature toggles', () => {
    const stored = normalizeUserProfile({
      enabled: false,
      manualConversionEnabled: true,
    })
    expect(isCorrectionActive(stored)).toBe(false)
    expect(isManualConversionEnabled(stored)).toBe(true)

    const revived = normalizeUserProfile(JSON.parse(JSON.stringify(stored)))
    expect(revived.enabled).toBe(false)
    expect(revived.manualConversionEnabled).toBe(true)

    const manualOff = normalizeUserProfile({
      enabled: true,
      manualConversionEnabled: false,
    })
    expect(isCorrectionActive(manualOff)).toBe(true)
    expect(isManualConversionEnabled(manualOff)).toBe(false)

    const bothOff = normalizeUserProfile({
      enabled: false,
      manualConversionEnabled: false,
    })
    expect(isCorrectionActive(bothOff)).toBe(false)
    expect(isManualConversionEnabled(bothOff)).toBe(false)

    const bothOn = normalizeUserProfile({
      enabled: true,
      manualConversionEnabled: true,
    })
    expect(isCorrectionActive(bothOn)).toBe(true)
    expect(isManualConversionEnabled(bothOn)).toBe(true)
  })

  it('keeps the direct shortcut independent of automatic and manual conversion', () => {
    const shortcutOnly = normalizeUserProfile({
      enabled: false,
      manualConversionEnabled: false,
      directShortcutEnabled: true,
    })
    expect(isCorrectionActive(shortcutOnly)).toBe(false)
    expect(isManualConversionEnabled(shortcutOnly)).toBe(false)
    expect(isDirectShortcutEnabled(shortcutOnly)).toBe(true)

    const shortcutOff = normalizeUserProfile({
      enabled: true,
      manualConversionEnabled: true,
      directShortcutEnabled: false,
    })
    expect(isCorrectionActive(shortcutOff)).toBe(true)
    expect(isManualConversionEnabled(shortcutOff)).toBe(true)
    expect(isDirectShortcutEnabled(shortcutOff)).toBe(false)

    const legacy = normalizeUserProfile({
      enabled: true,
      manualConversionEnabled: true,
    })
    expect(isDirectShortcutEnabled(legacy)).toBe(true)
  })

  it('persists layout selection and disabled mode', () => {
    const selected = normalizeUserProfile({
      enabled: false,
      sourceLayout: 'en-US-qwerty',
      enabledLayouts: ['en-US-qwerty', 'ru-standard'],
    })
    expect(selected.enabled).toBe(false)
    expect(selected.enabledLayouts).toEqual(['en-US-qwerty', 'ru-standard'])
    expect(toggleEnabledLayout(DEFAULT_USER_PROFILE, 'ru-standard').enabledLayouts).toEqual([
      'en-US-qwerty',
      'ar-101',
      'ru-standard',
    ])
    expect(toggleEnabledLayout(DEFAULT_USER_PROFILE, 'ar-101').enabledLayouts).toEqual([
      'en-US-qwerty',
    ])
    expect(toggleEnabledLayout(DEFAULT_USER_PROFILE, 'en-US-qwerty')).toEqual(
      DEFAULT_USER_PROFILE,
    )
  })
})

describe('domain exclusions', () => {
  it('normalizes hosts and matches subdomains', () => {
    const profile = normalizeUserProfile({
      excludedDomains: ['https://www.Gmail.com/inbox', 'bank.example'],
    })
    expect(profile.excludedDomains).toEqual(['gmail.com', 'bank.example'])
    expect(isExcludedHost('mail.gmail.com', profile.excludedDomains)).toBe(true)
    expect(isExcludedHost('docs.google.com', profile.excludedDomains)).toBe(false)
  })
})

describe('personal exceptions', () => {
  it('never-corrects tokens locally and case-sensitively', () => {
    const exceptions = normalizeExceptions(['td', 'API', ' foo ', 'internalProject', 'a b'])
    expect(exceptions).toEqual(['td', 'API', 'foo', 'internalProject'])
    expect(isExceptedToken('td', exceptions)).toBe(true)
    expect(isExceptedToken('TD', exceptions)).toBe(false)
    expect(isExceptedToken('React', exceptions)).toBe(false)
    expect(addException(exceptions, 'React')).toContain('React')
    expect(removeException(exceptions, 'td')).toEqual(['API', 'foo', 'internalProject'])
  })

  it('skips excepted tokens in the local planner', () => {
    const text = 'hsjo]lj React td hgjwldl'
    const all = planFieldFixes(text, DEFAULT_USER_PROFILE, { finalizeAll: true })
    expect(all.map((fix) => fix.word)).toEqual(['hsjo]lj', 'td', 'hgjwldl'])
    const skipped = planFieldFixes(text, DEFAULT_USER_PROFILE, {
      finalizeAll: true,
      personalExceptions: ['td', 'API'],
    })
    expect(skipped.map((fix) => fix.word)).toEqual(['hsjo]lj', 'hgjwldl'])
  })
})

describe('local learning events', () => {
  it('records accepted, ignored, and reverted without training a model', () => {
    let events = normalizeEvents('nope')
    let exceptions: string[] = []

    const accepted = applyCorrectionEvent(events, exceptions, 'accepted', 'hsjo]lj', 'استخدمت')
    expect(accepted.addedException).toBe(false)
    events = accepted.events

    const ignored = applyCorrectionEvent(events, exceptions, 'ignored', 'td')
    expect(ignored.exceptions).toContain('td')
    events = ignored.events
    exceptions = ignored.exceptions

    const firstRevert = applyCorrectionEvent(events, exceptions, 'reverted', 'foo', 'bar')
    expect(firstRevert.addedException).toBe(false)
    const secondRevert = applyCorrectionEvent(
      firstRevert.events,
      firstRevert.exceptions,
      'reverted',
      'foo',
      'bar',
    )
    expect(secondRevert.addedException).toBe(true)
    expect(secondRevert.exceptions).toContain('foo')
    expect(secondRevert.events.every((event) => event.token !== undefined)).toBe(true)
  })
})

describe('migration and recovery', () => {
  it('migrates old sync settings into the unified profile', () => {
    const { profile, migrated, recovered } = migrateToUserProfile({
      legacy: {
        enabled: false,
        layoutProfile: {
          sourceLayout: 'en-US-qwerty',
          enabledLayouts: ['en-US-qwerty', 'ru-standard'],
        },
        excludedDomains: ['mail.example.com'],
      },
    })
    expect(migrated).toBe(true)
    expect(recovered).toBe(false)
    expect(profile.enabled).toBe(false)
    expect(profile.enabledLayouts).toEqual(['en-US-qwerty', 'ru-standard'])
    expect(profile.excludedDomains).toEqual(['mail.example.com'])
    expect(profile.personalExceptions).toEqual([])
  })

  it('recovers corrupted settings to a usable default or legacy snapshot', () => {
    expect(isCorruptedProfile([])).toBe(true)
    expect(isCorruptedProfile('boom')).toBe(true)
    expect(isCorruptedProfile({ enabledLayouts: 'ar-101' })).toBe(true)
    expect(isCorruptedProfile({ enabled: 'yes' })).toBe(true)
    expect(isCorruptedProfile(DEFAULT_USER_PROFILE)).toBe(false)

    const recovered = migrateToUserProfile({
      current: { enabledLayouts: 'nope' },
      legacy: {
        enabled: true,
        layoutProfile: {
          sourceLayout: 'en-US-qwerty',
          enabledLayouts: ['en-US-qwerty', 'ar-101'],
        },
        personalExceptions: ['API'],
      },
    })
    expect(recovered.recovered).toBe(true)
    expect(recovered.profile.enabledLayouts).toEqual(['en-US-qwerty', 'ar-101'])
    expect(recovered.profile.personalExceptions).toEqual(['API'])
    expect(normalizeUserProfile({ version: 'x', enabledLayouts: 1 })).toEqual(
      DEFAULT_USER_PROFILE,
    )
  })

  it('keeps a valid stored profile and does not force setup', () => {
    const stored = normalizeUserProfile({
      enabled: true,
      enabledLayouts: ['en-US-qwerty', 'ar-101'],
      personalExceptions: ['td'],
    })
    const hydrated = migrateToUserProfile({ current: stored })
    expect(hydrated.migrated).toBe(false)
    expect(hydrated.profile.personalExceptions).toEqual(['td'])
  })
})
