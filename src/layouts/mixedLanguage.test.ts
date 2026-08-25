import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, normalizeProfile } from './profile.ts'
import { inferSourceLayout, localClassificationHint, shouldEvaluateToken } from './heuristics.ts'
import { isEnglishWord } from './lexicons/en-words.ts'
import { mapLayout } from './registry.ts'
import { applyFixesToText, neighborContext, planFieldFixes } from './sentence.ts'
import { tokenizeText } from '../safety/tokenize.ts'

const AR_OS = normalizeProfile({
  sourceLayout: 'ar-101',
  enabledLayouts: ['ar-101', 'en-US-qwerty'],
})

function corrected(text: string, profile = DEFAULT_PROFILE): string {
  return applyFixesToText(text, planFieldFixes(text, profile, { finalizeAll: true }))
}

describe('mixed-language token decisions', () => {
  it('keeps valid Arabic and valid English in one sentence', () => {
    expect(corrected('مرحبا كيف حالك hello how are you')).toBe(
      'مرحبا كيف حالك hello how are you',
    )
  })

  it('does not assume script is intent for بهىث', () => {
    expect(mapLayout('بهىث', 'ar-101', 'en-US-qwerty')).toBe('fine')
    expect(isEnglishWord('fine')).toBe(true)
    expect(localClassificationHint('بهىث', DEFAULT_PROFILE)).toEqual({
      kind: 'LAYOUT_MISMATCH',
      targetLayout: 'en-US-qwerty',
    })
    expect(corrected('بهىث')).toBe('fine')
  })

  it('does not evaluate symbol-only tokens', () => {
    expect(shouldEvaluateToken('÷', DEFAULT_PROFILE)).toBe(false)
    expect(shouldEvaluateToken('÷', AR_OS)).toBe(false)
    expect(inferSourceLayout('÷', AR_OS)).toBeNull()
    expect(corrected('÷', AR_OS)).toBe('÷')
    expect(corrected('hello ÷ am fine', AR_OS)).toBe('hello ÷ am fine')
  })

  it('uses only a local neighbor window for context', () => {
    expect(neighborContext(['مرحبا', 'hello', 'كيف', 'are', 'حالك', 'you'], 2)).toBe(
      'مرحبا hello كيف are حالك you',
    )
    expect(neighborContext(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 0)).toBe('a b c d')
    expect(neighborContext(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 7)).toBe('e f g h')
  })

  it('reconsiders a leftover token after neighbors remapped', () => {
    expect(corrected('اثممخ بقهثىي اخص شقث غخع')).toBe('hello friend how are you')
    expect(corrected('hello بقهثىي how are you')).toBe('hello friend how are you')
    expect(corrected('hello بهىث how are you')).toBe('hello fine how are you')
  })

  it('recovers two-letter Arabic and comma-as-waw with local Arabic context', () => {
    expect(corrected('hello i, fodv')).toBe('hello هو بخير')
    expect(corrected('hello i`h kw wpdp')).toBe('hello هذا نص صحيح')
    expect(corrected('kw')).toBe('kw')
    expect(corrected('i,')).toBe('i,')
  })

  it('peels Arabic semicolon and splits layout math symbols', () => {
    expect(tokenizeText('مرحبا؛ hello').tokens.map((item) => item.token)).toEqual([
      'مرحبا',
      'hello',
    ])
    expect(tokenizeText('hello÷world').tokens.map((item) => item.token)).toEqual([
      'hello',
      'world',
    ])
  })
})
