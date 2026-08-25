import { describe, expect, it } from 'vitest'
import {
  evaluableSpan,
  inferSourceLayout,
  localClassificationHint,
  looksLikeEnglish,
  shouldEvaluateToken,
} from './heuristics.ts'
import { layoutsFromLanguages } from './languages.ts'
import {
  classificationCacheKey,
  DEFAULT_PROFILE,
  normalizeProfile,
} from './profile.ts'
import { applyFixesToText, planFieldFixes } from './sentence.ts'
import {
  ARABIC_GOLDEN,
  ARABIC_REVERSE_GOLDEN,
  RUSSIAN_GOLDEN,
  WORLD_GOLDEN,
  getLayout,
  getLayoutsForLanguage,
  getSupportedLayouts,
  isSupportedLayout,
  isValidClassification,
  mapLayout,
} from './registry.ts'

describe('layout registry', () => {
  it('exposes implemented layouts as data', () => {
    const ids = getSupportedLayouts().map((layout) => layout.id)
    expect(ids).toContain('en-US-qwerty')
    expect(ids).toContain('fr-azerty')
    expect(ids).toContain('de-qwertz')
    expect(ids).not.toContain('zh-pinyin')
    expect(getLayout('ar-101')?.language).toBe('ar')
    expect(getLayoutsForLanguage('ru')[0]?.id).toBe('ru-standard')
    expect(isSupportedLayout('zh-pinyin')).toBe(false)
    expect(isSupportedLayout('fr-azerty')).toBe(true)
    expect(getLayout('ar-101')?.metadata.direction).toBe('rtl')
    expect(getLayout('en-US-qwerty')?.metadata.hasAltGr).toBe(false)
  })
})

describe('Arabic 101 regression', () => {
  it.each(ARABIC_GOLDEN)('maps %s → %s', (typed, expected) => {
    expect(mapLayout(typed, 'en-US-qwerty', 'ar-101')).toBe(expected)
  })

  it('leaves the space outside the mapping', () => {
    expect(mapLayout('hgjwldl', 'en-US-qwerty', 'ar-101')).toBe('التصميم')
  })

  it.each(ARABIC_REVERSE_GOLDEN)('reverse-maps %s → %s', (typed, expected) => {
    expect(mapLayout(typed, 'ar-101', 'en-US-qwerty')).toBe(expected)
  })
})

describe('world layout goldens', () => {
  it.each(WORLD_GOLDEN)('%s → %s (%s → %s)', (typed, expected, source, target) => {
    expect(mapLayout(typed, source, target)).toBe(expected)
  })

  it('round-trips French AZERTY letter rows', () => {
    expect(mapLayout('azerty', 'fr-azerty', 'en-US-qwerty')).toBe('qwerty')
  })
})

describe('Russian ЙЦУКЕН proof layout', () => {
  it.each(RUSSIAN_GOLDEN)('maps %s → %s', (typed, expected) => {
    expect(mapLayout(typed, 'en-US-qwerty', 'ru-standard')).toBe(expected)
  })

  it('round-trips reversible Latin letters', () => {
    const forward = mapLayout('hello', 'en-US-qwerty', 'ru-standard')
    expect(forward).toBe('руддщ')
    expect(mapLayout(forward!, 'ru-standard', 'en-US-qwerty')).toBe('hello')
  })
})

describe('fail-safe mapping', () => {
  it('returns null for an unknown layout', () => {
    expect(mapLayout('hello', 'en-US-qwerty', 'zh-pinyin')).toBeNull()
    expect(mapLayout('hello', 'ja-ime', 'ar-101')).toBeNull()
  })

  it('returns null for an incomplete or unknown glyph', () => {
    expect(mapLayout('©hello', 'en-US-qwerty', 'ar-101')).toBeNull()
    expect(mapLayout('', 'en-US-qwerty', 'ar-101')).toBeNull()
  })

  it('maps the verified number row, including Arabic 101 () swap', () => {
    expect(mapLayout('90', 'en-US-qwerty', 'ar-101')).toBe('90')
    expect(mapLayout('()', 'en-US-qwerty', 'ar-101')).toBe(')(')
    expect(mapLayout('#', 'en-US-qwerty', 'ru-standard')).toBe('№')
  })

  it('is a no-op when source and target are the same implemented layout', () => {
    expect(mapLayout('React', 'en-US-qwerty', 'en-US-qwerty')).toBe('React')
  })
})

describe('classification and cache contracts', () => {
  it('accepts only VALID or a candidate layout mismatch', () => {
    expect(isValidClassification({ kind: 'VALID' })).toBe(true)
    expect(
      isValidClassification({ kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' }),
    ).toBe(true)
    expect(
      isValidClassification({
        kind: 'LAYOUT_MISMATCH',
        targetLayout: 'zh-pinyin' as never,
      }),
    ).toBe(false)
  })

  it('keys the cache by word, source, and candidates — never a license', () => {
    const key = classificationCacheKey('hsjo]lj', DEFAULT_PROFILE)
    expect(key).toBe('hsjo]lj|en-US-qwerty|ar-101,en-US-qwerty')
    expect(key).not.toMatch(/license|lsq_/i)
  })

  it('defaults the user profile to English + Arabic', () => {
    expect(normalizeProfile(null)).toEqual(DEFAULT_PROFILE)
    expect(
      normalizeProfile({
        sourceLayout: 'en-US-qwerty',
        enabledLayouts: ['en-US-qwerty'],
      }).enabledLayouts,
    ).toEqual(['en-US-qwerty'])
    expect(
      normalizeProfile({
        sourceLayout: 'en-US-qwerty',
        enabledLayouts: ['en-US-qwerty', 'ru-standard'],
      }).enabledLayouts,
    ).toEqual(['en-US-qwerty', 'ru-standard'])
  })
})

describe('local heuristics', () => {
  it('evaluates Arabic tokens so English-on-Arabic can be reversed', () => {
    expect(shouldEvaluateToken('التصميم', DEFAULT_PROFILE)).toBe(true)
    expect(shouldEvaluateToken('اثممخ', DEFAULT_PROFILE)).toBe(true)
    expect(localClassificationHint('التصميم', DEFAULT_PROFILE)).toEqual({
      kind: 'VALID',
    })
  })

  it('accepts QWERTY tokens including Arabic-layout punctuation keys', () => {
    expect(shouldEvaluateToken('hsjo]lj', DEFAULT_PROFILE)).toBe(true)
    expect(shouldEvaluateToken('React', DEFAULT_PROFILE)).toBe(true)
  })

  it('skips emails and digits', () => {
    expect(shouldEvaluateToken('a@b.com', DEFAULT_PROFILE)).toBe(false)
    expect(shouldEvaluateToken('42', DEFAULT_PROFILE)).toBe(false)
  })

  it('peels a QWERTY suffix off mixed Arabic+Latin tokens', () => {
    const span = evaluableSpan('مدى]rjih', DEFAULT_PROFILE)
    expect(span).toEqual({ word: ']rjih', offset: 3 })
    expect(mapLayout(span!.word, 'en-US-qwerty', 'ar-101')).toBe('دقتها')
  })

  it('reverse-maps English typed on an Arabic layout', () => {
    expect(mapLayout('اثممخ', 'ar-101', 'en-US-qwerty')).toBe('hello')
    expect(mapLayout('اخص', 'ar-101', 'en-US-qwerty')).toBe('how')
    expect(mapLayout('شقث', 'ar-101', 'en-US-qwerty')).toBe('are')
    expect(mapLayout('غخع', 'ar-101', 'en-US-qwerty')).toBe('you')
    expect(inferSourceLayout('اثممخ', DEFAULT_PROFILE)).toBe('ar-101')
    expect(shouldEvaluateToken('اثممخ', DEFAULT_PROFILE)).toBe(true)
    expect(looksLikeEnglish('hello')).toBe(true)
    expect(localClassificationHint('اثممخ', DEFAULT_PROFILE)).toEqual({
      kind: 'LAYOUT_MISMATCH',
      targetLayout: 'en-US-qwerty',
    })
    expect(localClassificationHint('تستهلك', DEFAULT_PROFILE)).toEqual({
      kind: 'VALID',
    })
  })

  it('keeps real Arabic in a mixed sentence and only remaps English-on-Arabic', () => {
    const sentence =
      'الاداة يجب ان تكون دقيقة وتدعم جميع اللغات التي يستخدمها المستخدم في جهازه كول خرة يا معفن اثممخ اخص شقث غخع hello كيف حالك انا بخير شىي غخع صشاف شقث غخع يخهىل انا لا افعل شيئ'
    const remap: Record<string, string> = {
      اثممخ: 'hello',
      اخص: 'how',
      شقث: 'are',
      غخع: 'you',
      شىي: 'and',
      يخهىل: 'doing',
    }

    for (const word of sentence.split(/\s+/)) {
      const hint = localClassificationHint(word, DEFAULT_PROFILE, sentence)
      if (remap[word]) {
        expect(hint).toEqual({
          kind: 'LAYOUT_MISMATCH',
          targetLayout: 'en-US-qwerty',
        })
        expect(mapLayout(word, 'ar-101', 'en-US-qwerty')).toBe(remap[word])
        continue
      }
      expect(hint?.kind ?? 'VALID').toBe('VALID')
    }
  })

  it('rewrites every English-on-Arabic token in the field, not only the last word', () => {
    const broken = 'hello اخص شقث غخع'
    const fixes = planFieldFixes(broken, DEFAULT_PROFILE, { finalizeAll: true })
    expect(applyFixesToText(broken, fixes)).toBe('hello how are you')
    expect(
      applyFixesToText(
        'اثممخ اخص شقث غخع',
        planFieldFixes('اثممخ اخص شقث غخع', DEFAULT_PROFILE, {
          finalizeAll: true,
        }),
      ),
    ).toBe('hello how are you')
    expect(
      applyFixesToText(
        'اثممخ بقهثىي اخص شقث غخع',
        planFieldFixes('اثممخ بقهثىي اخص شقث غخع', DEFAULT_PROFILE, {
          finalizeAll: true,
        }),
      ),
    ).toBe('hello friend how are you')
    expect(
      applyFixesToText(
        'hsjo]lj React td hgjwldl',
        planFieldFixes('hsjo]lj React td hgjwldl', DEFAULT_PROFILE, {
          finalizeAll: true,
        }),
      ),
    ).toBe('استخدمت React في التصميم')
  })

  it('leaves a finished Arabic sentence alone', () => {
    const arabic = 'الاداة يجب ان تكون دقيقة'
    expect(
      planFieldFixes(arabic, DEFAULT_PROFILE, { finalizeAll: true }),
    ).toEqual([])
  })

  it('enables implemented layouts from the device languages', () => {
    expect(layoutsFromLanguages(['en-US', 'ar-SA', 'ru-RU'])).toEqual([
      'en-US-qwerty',
      'ar-101',
      'ru-standard',
    ])
    expect(layoutsFromLanguages(['fr-FR', 'de-DE'])).toEqual([
      'fr-azerty',
      'de-qwertz',
      'en-US-qwerty',
    ])
  })

  it('fixes the live mixed sentence fragments locally', () => {
    expect(mapLayout('ig', 'en-US-qwerty', 'ar-101')).toBe('هل')
    expect(mapLayout('s,t', 'en-US-qwerty', 'ar-101')).toBe('سوف')
    expect(localClassificationHint('s,t', DEFAULT_PROFILE)).toEqual({
      kind: 'LAYOUT_MISMATCH',
      targetLayout: 'ar-101',
    })
    expect(localClassificationHint('ig', DEFAULT_PROFILE)).toBeNull()
    expect(localClassificationHint('ig', DEFAULT_PROFILE, 'hsjo]lj')).toEqual({
      kind: 'LAYOUT_MISMATCH',
      targetLayout: 'ar-101',
    })
    expect(localClassificationHint('React', DEFAULT_PROFILE)).toEqual({
      kind: 'VALID',
    })
    expect(localClassificationHint('lvpfh', DEFAULT_PROFILE)).toEqual({
      kind: 'LAYOUT_MISMATCH',
      targetLayout: 'ar-101',
    })
    expect(localClassificationHint('hkh', DEFAULT_PROFILE)).toEqual({
      kind: 'LAYOUT_MISMATCH',
      targetLayout: 'ar-101',
    })
    expect(localClassificationHint('مرحبا', DEFAULT_PROFILE)).toEqual({
      kind: 'VALID',
    })
    expect(localClassificationHint('gh', DEFAULT_PROFILE)).toBeNull()
  })
})
