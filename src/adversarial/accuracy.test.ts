/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import { classificationCacheKey } from '../cache/key.ts'
import {
  beginComposition,
  bumpGeneration,
  captureSnapshot,
  commitReplacement,
  endComposition,
  isComposing,
  resetComposition,
  setNativeValue,
} from '../dom/index.ts'
import {
  inferSourceLayout,
  localClassificationHint,
  shouldCommitMismatch,
} from '../layouts/heuristics.ts'
import { isArabicWord } from '../layouts/lexicons/ar-words.ts'
import { DEFAULT_PROFILE, normalizeProfile } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'
import { isSupportedLayout, mapLayout } from '../layouts/registry.ts'
import type { UserLayoutProfile } from '../layouts/types.ts'
import { skipReasonForToken } from '../safety/tokenKind.ts'
import { tokenizeText } from '../safety/tokenize.ts'

const AR_EN = DEFAULT_PROFILE
const EN_ONLY = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty'],
})
const AR_EN_RU = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'ar-101', 'ru-standard'],
})

function corrected(text: string, profile: UserLayoutProfile = AR_EN): string {
  return applyFixesToText(text, planFieldFixes(text, profile, { finalizeAll: true }))
}

function valueField(value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  document.body.append(input)
  setNativeValue(input, value)
  input.setSelectionRange(value.length, value.length)
  return input
}

describe('accuracy hardening', () => {
  it('keeps an isolated ambiguous short token', () => {
    expect(corrected('td')).toBe('td')
    expect(shouldCommitMismatch('td', 'ar-101', 'في', '')).toBe(false)
    expect(localClassificationHint('td', AR_EN)).toBeNull()
  })

  it('keeps a correct English token', () => {
    expect(corrected('how')).toBe('how')
    expect(localClassificationHint('how', AR_EN)).toEqual({ kind: 'VALID' })
  })

  it('keeps a correct Arabic token', () => {
    expect(corrected('مرحبا')).toBe('مرحبا')
    expect(localClassificationHint('مرحبا', AR_EN)).toEqual({ kind: 'VALID' })
  })

  it('does not convert a mixed sentence that is already intended', () => {
    expect(corrected('مرحبا هذا انا how are you')).toBe('مرحبا هذا انا how are you')
  })

  it('restores a wrong-layout Arabic token from the physical map', () => {
    expect(mapLayout('lvpfh', 'en-US-qwerty', 'ar-101')).toBe('مرحبا')
    expect(corrected('lvpfh')).toBe('مرحبا')
    expect(corrected('lvpf')).toBe('lvpf')
    expect(corrected('lvpfh i`h hkh how are you')).toBe('مرحبا هذا انا how are you')
  })

  it('protects technical identifiers and numbers', () => {
    expect(skipReasonForToken('getUserById')).toBe('code-identifier')
    expect(skipReasonForToken('v2')).toBe('code-identifier')
    expect(skipReasonForToken('API2')).toBe('code-identifier')
    expect(skipReasonForToken('API')).toBe('code-identifier')
    expect(skipReasonForToken('foo.bar')).toBe('code-identifier')
    expect(skipReasonForToken('2026')).toBe('digits')
    expect(corrected('getUserById 2026 v2 API')).toBe('getUserById 2026 v2 API')
  })

  it('does not remap English possessives or punctuated Latin joins', () => {
    expect(corrected("user's")).toBe("user's")
    expect(corrected('foo.bar')).toBe('foo.bar')
    expect(corrected('hello,world')).toBe('hello,world')
    expect(corrected('hsjo]lj')).toBe('استخدمت')
    expect(corrected('i`h')).toBe('هذا')
  })

  it('restores Arabic words that use QWERTY semicolon as kaf', () => {
    expect(skipReasonForToken(';dt')).toBeNull()
    expect(skipReasonForToken('phg;')).toBeNull()
    expect(mapLayout(';dt', 'en-US-qwerty', 'ar-101')).toBe('كيف')
    expect(mapLayout('phg;', 'en-US-qwerty', 'ar-101')).toBe('حالك')
    expect(corrected(';dt')).toBe('كيف')
    expect(corrected('phg;')).toBe('حالك')
    expect(corrected('phg;?')).toBe('حالك?')
    expect(corrected(';dt phg;')).toBe('كيف حالك')
    expect(corrected('hsjo]lj;')).toBe('استخدمت;')
    expect(skipReasonForToken('`g;')).toBeNull()
    expect(corrected('`g;')).toBe('ذلك')
    expect(corrected('Wait; then: go!')).toBe('Wait; then: go!')
  })

  it('rejects unsupported and disabled layouts', () => {
    expect(isSupportedLayout('fake-layout')).toBe(false)
    expect(mapLayout('hello', 'en-US-qwerty', 'fake-layout')).toBeNull()
    expect(corrected('hsjo]lj', EN_ONLY)).toBe('hsjo]lj')
    expect(inferSourceLayout('اثممخ', EN_ONLY)).toBeNull()
    const planned = normalizeProfile({
      sourceLayout: 'en-US-qwerty',
      enabledLayouts: ['en-US-qwerty', 'ar-101', 'zh-pinyin' as never],
    })
    expect(planned.enabledLayouts).toEqual(['en-US-qwerty', 'ar-101'])
    expect(corrected('ghbdtn', planned)).toBe('ghbdtn')
  })

  it('never proposes layouts outside the enabled set', () => {
    const fixes = planFieldFixes('ghbdtn hsjo]lj', AR_EN, { finalizeAll: true })
    expect(fixes.every((fix) => AR_EN.enabledLayouts.includes(fix.targetLayout))).toBe(
      true,
    )
    expect(fixes.some((fix) => fix.targetLayout === 'ru-standard')).toBe(false)
    expect(corrected('ghbdtn', AR_EN)).toBe('ghbdtn')
    expect(corrected('hello ghbdtn', AR_EN_RU)).toBe('hello привет')
  })

  it('keeps punctuation inside a wrong-layout token', () => {
    expect(tokenizeText('hsjo]lj React').tokens.map((item) => item.token)).toEqual([
      'hsjo]lj',
      'React',
    ])
    expect(corrected('hsjo]lj')).toBe('استخدمت')
  })

  it('maps shift independently of the unshifted glyph', () => {
    expect(mapLayout('h', 'en-US-qwerty', 'ar-101')).toBe('ا')
    expect(mapLayout('H', 'en-US-qwerty', 'ar-101')).toBe('أ')
    expect(mapLayout('أ', 'ar-101', 'en-US-qwerty')).toBe('H')
  })

  it('treats NFC-equivalent Arabic as the same word for confidence', () => {
    const composed = 'انا'
    const decomposed = 'ا\u064eنا'
    expect(isArabicWord(composed)).toBe(true)
    expect(isArabicWord(decomposed.normalize('NFC'))).toBe(isArabicWord(composed))
  })

  it('canonicalizes cache keys by sorted candidate layouts and NFC', () => {
    const a = classificationCacheKey('hsjo]lj', 'en-US-qwerty', [
      'ar-101',
      'en-US-qwerty',
    ])
    const b = classificationCacheKey('hsjo]lj', 'en-US-qwerty', [
      'en-US-qwerty',
      'ar-101',
    ])
    expect(a).toBe(b)
    expect(a).not.toBe(
      classificationCacheKey('hsjo]lj', 'en-US-qwerty', ['en-US-qwerty']),
    )
  })

  it('uses a new candidate set immediately after a profile change', () => {
    const before = classificationCacheKey('ghbdtn', 'en-US-qwerty', AR_EN.enabledLayouts)
    const after = classificationCacheKey(
      'ghbdtn',
      'en-US-qwerty',
      AR_EN_RU.enabledLayouts,
    )
    expect(before).not.toBe(after)
  })

  it('does not invent a target when only one layout is enabled', () => {
    expect(planFieldFixes('hsjo]lj td lvpfh', EN_ONLY, { finalizeAll: true })).toEqual(
      [],
    )
  })

  it('blocks evaluation while an IME composition is active', () => {
    resetComposition()
    expect(isComposing()).toBe(false)
    beginComposition()
    expect(isComposing()).toBe(true)
    beginComposition()
    endComposition()
    expect(isComposing()).toBe(true)
    endComposition()
    expect(isComposing()).toBe(false)
  })

  it('discards a stale write after caret enters the original token', () => {
    const input = valueField('hsjo]lj React')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 13)
    input.setSelectionRange(3, 3)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('hsjo]lj React')
  })

  it('discards after the user replaces a selection', () => {
    const input = valueField('hsjo]lj')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 7)
    setNativeValue(input, 'hello')
    bumpGeneration(input, 'insertFromPaste')
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('hello')
  })

  it('surgically replaces only the mismatched token', () => {
    expect(corrected('مرحبا hsjo]lj how')).toBe('مرحبا استخدمت how')
  })
})
