import { describe, expect, it } from 'vitest'
import {
  addExcludedDomain,
  buildAnalyzeWordPayload,
  payloadIsPrivacySafe,
  removeExcludedDomain,
  safeContext,
  skipReasonForToken,
} from '../safety/index.ts'
import {
  DEFAULT_USER_PROFILE,
  TEMPORARY_PAUSE_MS,
  appendHistory,
  historyPayloadSafe,
  isCorrectionActive,
  isManualConversionEnabled,
  normalizeHistory,
  normalizeUserProfile,
} from './index.ts'

describe('privacy boundary', () => {
  it('sends only token, short safe context, license, and layout ids', () => {
    const payload = buildAnalyzeWordPayload({
      license_key: 'lsq_test',
      word: 'hsjo]lj',
      context: 'React eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb https://evil.example',
      source_layout: 'en-US-qwerty',
      candidate_layouts: ['en-US-qwerty', 'ar-101'],
    })
    expect(payloadIsPrivacySafe(payload)).toBe(true)
    expect(payload.context).toBe('React')
    expect(JSON.stringify(payload)).not.toMatch(/html|history|password|http/i)
  })

  it('drops unsafe context instead of sending it', () => {
    expect(safeContext('sk-abcdefghijklmnopqrstuvwxyz')).toBeUndefined()
    expect(safeContext('hello world')).toBe('hello world')
  })
})

describe('sensitive tokens', () => {
  it('does not send passwords, keys, or cards', () => {
    expect(skipReasonForToken('hunter2!!', 'password')).toBe('password')
    expect(skipReasonForToken('sk-abcdefghijklmnopqrstuvwxyz')).toBe('api-key')
    expect(skipReasonForToken('4111 1111 1111 1111')).toBe('credit-card')
  })
})

describe('pause and domains', () => {
  it('disables correction while temporarily paused', () => {
    const now = 1_000_000
    expect(isCorrectionActive({ enabled: true, pausedUntil: 0 }, now)).toBe(true)
    expect(
      isCorrectionActive({ enabled: true, pausedUntil: now + TEMPORARY_PAUSE_MS }, now),
    ).toBe(false)
    expect(isCorrectionActive({ enabled: false, pausedUntil: 0 }, now)).toBe(false)
  })

  it('keeps manual conversion independent of page intervention and pause', () => {
    const now = 1_000_000
    const paused = normalizeUserProfile({
      enabled: true,
      manualConversionEnabled: true,
      pausedUntil: now + TEMPORARY_PAUSE_MS,
    })
    expect(isCorrectionActive(paused, now)).toBe(false)
    expect(isManualConversionEnabled(paused)).toBe(true)

    const interventionOff = normalizeUserProfile({
      enabled: false,
      manualConversionEnabled: true,
    })
    expect(isCorrectionActive(interventionOff, now)).toBe(false)
    expect(isManualConversionEnabled(interventionOff)).toBe(true)
  })

  it('adds and removes excluded domains', () => {
    const added = addExcludedDomain(['gmail.com'], 'https://www.bank.example/app')
    expect(added).toEqual(['gmail.com', 'bank.example'])
    expect(removeExcludedDomain(added, 'gmail.com')).toEqual(['bank.example'])
  })
})

describe('local correction history', () => {
  it('keeps recent remaps on-device and never looks like an upload payload', () => {
    const history = appendHistory(
      appendHistory([], 'hsjo]lj', 'استخدمت'),
      'hgjwldl',
      'التصميم',
    )
    expect(history.map((item) => `${item.token} → ${item.replacement}`)).toEqual([
      'hsjo]lj → استخدمت',
      'hgjwldl → التصميم',
    ])
    expect(historyPayloadSafe(history)).toBe(true)
    expect(normalizeHistory([{ token: 'x' }])).toEqual([])
    expect(normalizeUserProfile(null).pausedUntil).toBe(0)
    expect(DEFAULT_USER_PROFILE.pausedUntil).toBe(0)
  })
})
