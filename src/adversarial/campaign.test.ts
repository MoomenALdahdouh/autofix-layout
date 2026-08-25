/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import {
  classificationCacheKey,
  createClassificationStore,
  toCacheRecord,
  WORD_CACHE_MAX_MEMORY,
} from '../cache/index.ts'
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
  convertManualText,
  converterChoices,
  defaultConverterPair,
  resolveConverterPair,
  swapConverterPair,
} from '../layouts/convert.ts'
import {
  canCommitMismatch,
  localClassificationHint,
} from '../layouts/heuristics.ts'
import { DEFAULT_PROFILE, normalizeProfile } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'
import { mapLayout } from '../layouts/registry.ts'
import type { LayoutId, UserLayoutProfile } from '../layouts/types.ts'
import {
  DEFAULT_USER_PROFILE,
  isCorrectionActive,
  isDirectShortcutEnabled,
  isManualConversionEnabled,
  normalizeUserProfile,
} from '../profile/index.ts'
import { skipReasonForToken, tokenizeText } from '../safety/index.ts'
import { oracleMap, oracleMapText } from './independentOracle.ts'

const AR_EN: UserLayoutProfile = DEFAULT_PROFILE
const EN_ONLY = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty'],
})
const AR_EN_RU = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'ar-101', 'ru-standard'],
})

const VERIFIED_PAIRS: Array<readonly [LayoutId, LayoutId]> = [
  ['en-US-qwerty', 'ar-101'],
  ['ar-101', 'en-US-qwerty'],
  ['en-US-qwerty', 'ru-standard'],
  ['ru-standard', 'en-US-qwerty'],
]

const UNSUPPORTED_TARGETS = ['zh-pinyin', 'ja-ime', 'ko-ime', 'xx-fake']

const KEEP_ENGLISH = [
  'hello',
  'how',
  'are',
  'you',
  'React',
  'API',
  'HTTP',
  'JSON',
  'Laravel',
  'the',
  'and',
  'this',
  'that',
  'with',
  'from',
  'please',
  'thanks',
  'today',
  'working',
  'project',
]

const KEEP_ARABIC = [
  'مرحبا',
  'هذا',
  'انا',
  'كيف',
  'التصميم',
  'استخدمت',
  'في',
  'من',
  'على',
  'حالك',
]

const TECHNICAL = [
  'getUserById',
  'useState',
  'MyComponent',
  'my_variable',
  'apiResponse',
  'API_V2',
  'v1.2.3',
  'https://example.com',
  'test@example.com',
  'R2D2',
  'v2',
  'API2',
]

const ALREADY_CORRECT_MIXED = [
  'مرحبا this is React',
  'كيف are you',
  'API جديد',
  'Laravel يعمل',
  'مرحبا هذا انا how are you',
  'how are you كيف حالك',
  'كيف حالك I am fine',
  'مرحبا React is working',
  'I use Laravel في المشروع',
  'هذا API جديد',
  'React يعمل بشكل جيد today',
]

type Outcome =
  | 'CORRECT_CONVERSION'
  | 'CORRECT_NO_OP'
  | 'CORRECT_REJECTION'
  | 'FALSE_POSITIVE'
  | 'FALSE_NEGATIVE'
  | 'INCORRECT_CONVERSION'
  | 'CRASH'

const tallies: Record<Outcome, number> = {
  CORRECT_CONVERSION: 0,
  CORRECT_NO_OP: 0,
  CORRECT_REJECTION: 0,
  FALSE_POSITIVE: 0,
  FALSE_NEGATIVE: 0,
  INCORRECT_CONVERSION: 0,
  CRASH: 0,
}

const falsePositives: string[] = []
const falseNegatives: string[] = []
const incorrect: string[] = []

function record(kind: Outcome, detail?: string): void {
  tallies[kind] += 1
  if (kind === 'FALSE_POSITIVE' && detail) falsePositives.push(detail)
  if (kind === 'FALSE_NEGATIVE' && detail) falseNegatives.push(detail)
  if (kind === 'INCORRECT_CONVERSION' && detail) incorrect.push(detail)
}

function autoFix(text: string, profile: UserLayoutProfile = AR_EN): string {
  return applyFixesToText(text, planFieldFixes(text, profile, { finalizeAll: true }))
}

function classifyKeep(input: string, output: string, label: string): void {
  if (output === input) record('CORRECT_NO_OP')
  else {
    record('FALSE_POSITIVE', `${label}: ${JSON.stringify(input)} → ${JSON.stringify(output)}`)
  }
}

function classifyRecover(
  input: string,
  output: string,
  expected: string,
  label: string,
): void {
  if (output === expected) record('CORRECT_CONVERSION')
  else if (output === input) {
    record('FALSE_NEGATIVE', `${label}: ${input} stayed (expected ${expected})`)
  } else {
    record('INCORRECT_CONVERSION', `${label}: ${input} → ${output} (expected ${expected})`)
  }
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!
}

function latinRun(rand: () => number, length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(rand() * alphabet.length)]
  }
  return out
}

describe('campaign — oracle vs production mapper', () => {
  it('agrees with the independent oracle on verified pairs', () => {
    const samples = [
      'hsjo]lj',
      'td',
      'hgjwldl',
      'lvpfh',
      'i`h',
      'hkh',
      'hello',
      'React',
      'ghbdtn',
      'اثممخ',
      'اخص',
      '90',
      '()',
      'Hello',
    ]
    let disagreements = 0
    for (const [source, target] of VERIFIED_PAIRS) {
      for (const sample of samples) {
        const production = mapLayout(sample, source, target)
        const oracle = oracleMap(sample, source, target)
        if (production !== oracle) {
          disagreements += 1
          incorrect.push(`oracle ${source}→${target} ${sample}: prod=${production} oracle=${oracle}`)
        }
      }
    }
    expect(disagreements).toBe(0)
  })

  it('round-trips reversible Latin and Cyrillic where the tables allow it', () => {
    const reversible = ['hello', 'how', 'are', 'you', 'test', 'qwerty', 'asdf', 'ghbdtn']
    for (const word of reversible) {
      const ru = oracleMap(word, 'en-US-qwerty', 'ru-standard')
      expect(ru).not.toBeNull()
      expect(mapLayout(ru!, 'ru-standard', 'en-US-qwerty')).toBe(word)
    }
    const arabic = ['اثممخ', 'اخص', 'شقث', 'غخع']
    for (const word of arabic) {
      const typed = oracleMap(word, 'ar-101', 'en-US-qwerty')
      expect(typed).not.toBeNull()
      expect(mapLayout(typed!, 'en-US-qwerty', 'ar-101')).toBe(word)
    }
  })

  it('rejects unsupported pairs without inventing output', () => {
    for (const target of UNSUPPORTED_TARGETS) {
      expect(mapLayout('hello', 'en-US-qwerty', target)).toBeNull()
      expect(oracleMap('hello', 'en-US-qwerty', target)).toBeNull()
      expect(convertManualText('hello', 'en-US-qwerty', target).ok).toBe(false)
      record('CORRECT_REJECTION')
    }
  })
})

describe('campaign — generated wrong-layout recovery', () => {
  it('recovers independently generated Arabic-on-QWERTY words', () => {
    for (const intended of KEEP_ARABIC) {
      const typed = oracleMap(intended, 'ar-101', 'en-US-qwerty')
      if (!typed || typed === intended) continue
      const output = autoFix(typed)
      classifyRecover(typed, output, intended, 'ar-lexicon')
    }
    expect(tallies.INCORRECT_CONVERSION).toBe(0)
  })

  it('recovers generated multi-word Arabic sentences token-by-token', () => {
    const intended = 'مرحبا هذا انا'
    const typed = oracleMapText(intended, 'ar-101', 'en-US-qwerty')
    expect(typed).toBeTruthy()
    expect(typed).not.toBe(intended)
    const output = autoFix(typed!)
    classifyRecover(typed!, output, intended, 'ar-sentence')
    expect(output).toBe(intended)
  })

  it('generates hundreds of length-varied QWERTY tokens and never crashes', () => {
    const rand = seeded(20260822)
    const lengths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30]
    let ran = 0
    for (const length of lengths) {
      for (let i = 0; i < 40; i += 1) {
        const token = latinRun(rand, length)
        try {
          const output = autoFix(token)
          if (output !== token && output !== mapLayout(token, 'en-US-qwerty', 'ar-101')) {
            record('INCORRECT_CONVERSION', `len${length} ${token} → ${output}`)
          } else if (output === token) {
            record('CORRECT_NO_OP')
          } else {
            record('CORRECT_CONVERSION')
          }
          ran += 1
        } catch (error) {
          record('CRASH', `len${length} ${token}: ${String(error)}`)
        }
      }
    }
    expect(ran).toBe(lengths.length * 40)
    expect(tallies.CRASH).toBe(0)
  })
})

describe('campaign — false positives on already-correct text', () => {
  it('leaves verified English, Arabic, mixed, and technical tokens alone', () => {
    for (const word of KEEP_ENGLISH) classifyKeep(word, autoFix(word), 'en')
    for (const word of KEEP_ARABIC) classifyKeep(word, autoFix(word), 'ar')
    for (const sentence of ALREADY_CORRECT_MIXED) {
      classifyKeep(sentence, autoFix(sentence), 'mixed')
    }
    for (const token of TECHNICAL) classifyKeep(token, autoFix(token), 'tech')
    for (const number of ['0', '1', '42', '2026', '123456789', '3.14', '2026-08-22']) {
      classifyKeep(number, autoFix(number), 'num')
    }

    const possessive = autoFix("user's")
    classifyKeep("user's", possessive, 'possessive')
    const dotted = autoFix('foo.bar')
    classifyKeep('foo.bar', dotted, 'dotted')
    const commaJoin = autoFix('hello,world')
    classifyKeep('hello,world', commaJoin, 'comma-join')

    const rand = seeded(42)
    for (let i = 0; i < 300; i += 1) {
      const word = pick(rand, KEEP_ENGLISH)
      const neighbor = pick(rand, [...KEEP_ENGLISH, ...KEEP_ARABIC])
      const sentence = `${word} ${neighbor}`
      classifyKeep(sentence, autoFix(sentence), 'gen-keep')
    }

    expect(falsePositives, falsePositives.join('\n')).toEqual([])
  })

  it('keeps isolated ambiguous 1–2 letter tokens', () => {
    for (const token of ['a', 'I', 'in', 'to', 'is', 'of', 'as', 'td', 'gh', 'ig']) {
      classifyKeep(token, autoFix(token), 'short')
    }
    const rand = seeded(7)
    for (let i = 0; i < 200; i += 1) {
      const token = latinRun(rand, 2)
      if (autoFix(token) !== token) {
        record('FALSE_POSITIVE', `rand2 ${token} → ${autoFix(token)}`)
      } else {
        record('CORRECT_NO_OP')
      }
    }
    expect(falsePositives.filter((item) => item.startsWith('short') || item.startsWith('rand2'))).toEqual(
      [],
    )
  })
})

describe('campaign — mixed language is token-level', () => {
  it('does not lock a sentence to one language', () => {
    const typed = `${oracleMap('مرحبا', 'ar-101', 'en-US-qwerty')} React ${oracleMap('في', 'ar-101', 'en-US-qwerty')} Laravel`
    const output = autoFix(typed!)
    expect(output).toContain('React')
    expect(output).toContain('Laravel')
    expect(output).toContain('مرحبا')
    expect(planFieldFixes(typed!, AR_EN, { finalizeAll: true }).every((fix) => fix.word !== 'React')).toBe(
      true,
    )
  })

  it('does not propose Russian when it is disabled', () => {
    const fixes = planFieldFixes('ghbdtn hsjo]lj', AR_EN, { finalizeAll: true })
    expect(fixes.some((fix) => fix.targetLayout === 'ru-standard')).toBe(false)
    expect(autoFix('ghbdtn')).toBe('ghbdtn')
    expect(autoFix('ghbdtn', AR_EN_RU)).toBe('привет')
  })
})

describe('campaign — punctuation, whitespace, capitalization', () => {
  it('keeps trailing English punctuation outside the remap', () => {
    expect(tokenizeText('hello.').tokens.map((item) => item.token)).toEqual(['hello'])
    expect(autoFix('hello.')).toBe('hello.')
    expect(autoFix('hello!')).toBe('hello!')
  })

  it('keeps ] inside an Arabic-on-QWERTY token', () => {
    expect(tokenizeText('hsjo]lj').tokens.map((item) => item.token)).toEqual(['hsjo]lj'])
    expect(autoFix('hsjo]lj')).toBe('استخدمت')
  })

  it('treats QWERTY semicolon as kaf when that completes an Arabic word', () => {
    expect(skipReasonForToken(';dt')).toBeNull()
    classifyRecover(';dt', autoFix(';dt'), 'كيف', 'semi-kaf')
    classifyRecover('phg;', autoFix('phg;'), 'حالك', 'semi-kaf')
    expect(autoFix('hsjo]lj;')).toBe('استخدمت;')
  })

  it('preserves spaces, tabs, and blank lines in the manual converter', () => {
    const input = 'hsjo]lj  td\n\nhgjwldl'
    const result = convertManualText(input, 'en-US-qwerty', 'ar-101')
    expect(result).toEqual({ ok: true, text: 'استخدمت  في\n\nالتصميم' })
    expect(convertManualText('', 'en-US-qwerty', 'ar-101')).toEqual({ ok: true, text: '' })
    expect(convertManualText('hello', 'en-US-qwerty', 'en-US-qwerty')).toEqual({
      ok: true,
      text: 'hello',
    })
  })

  it('maps Shift independently and does not fold case', () => {
    expect(mapLayout('h', 'en-US-qwerty', 'ar-101')).toBe('ا')
    expect(mapLayout('H', 'en-US-qwerty', 'ar-101')).toBe('أ')
    expect(mapLayout('Hello', 'en-US-qwerty', 'ar-101')).not.toBe(
      mapLayout('hello', 'en-US-qwerty', 'ar-101'),
    )
  })
})

describe('campaign — manual converter', () => {
  it('is an explicit source→target remap, not inference', () => {
    const react = mapLayout('React', 'en-US-qwerty', 'ar-101')
    expect(
      convertManualText('hsjo]lj React td hgjwldl', 'en-US-qwerty', 'ar-101'),
    ).toEqual({
      ok: true,
      text: `استخدمت ${react} في التصميم`,
    })
  })

  it('updates when the pair is swapped', () => {
    const pair = defaultConverterPair(AR_EN)
    expect(pair).toEqual({ sourceLayout: 'en-US-qwerty', targetLayout: 'ar-101' })
    const swapped = swapConverterPair(pair)
    expect(swapped).toEqual({ sourceLayout: 'ar-101', targetLayout: 'en-US-qwerty' })
    expect(convertManualText('اثممخ', swapped.sourceLayout, swapped.targetLayout)).toEqual({
      ok: true,
      text: 'hello',
    })
  })

  it('exposes only enabled implemented layouts', () => {
    expect(converterChoices(['en-US-qwerty', 'ar-101', 'zh-pinyin'])).toEqual([
      'en-US-qwerty',
      'ar-101',
    ])
    expect(
      resolveConverterPair(AR_EN, { sourceLayout: 'zh-pinyin', targetLayout: 'ja-ime' }),
    ).toEqual(pairDefaults())
  })
})

function pairDefaults() {
  return defaultConverterPair(AR_EN)
}

describe('campaign — feature toggles and settings', () => {
  it('keeps intervention and manual conversion independent', () => {
    const bothOn = normalizeUserProfile({ enabled: true, manualConversionEnabled: true })
    const pagesOnly = normalizeUserProfile({ enabled: true, manualConversionEnabled: false })
    const manualOnly = normalizeUserProfile({ enabled: false, manualConversionEnabled: true })
    const bothOff = normalizeUserProfile({ enabled: false, manualConversionEnabled: false })

    expect(isCorrectionActive(bothOn) && isManualConversionEnabled(bothOn)).toBe(true)
    expect(isCorrectionActive(pagesOnly) && !isManualConversionEnabled(pagesOnly)).toBe(true)
    expect(!isCorrectionActive(manualOnly) && isManualConversionEnabled(manualOnly)).toBe(true)
    expect(!isCorrectionActive(bothOff) && !isManualConversionEnabled(bothOff)).toBe(true)

    expect(convertManualText('hsjo]lj', 'en-US-qwerty', 'ar-101').text).toBe('استخدمت')
    expect(isCorrectionActive(manualOnly)).toBe(false)

    const shortcutOnly = normalizeUserProfile({
      enabled: false,
      manualConversionEnabled: false,
      directShortcutEnabled: true,
    })
    expect(isDirectShortcutEnabled(shortcutOnly)).toBe(true)
    expect(isCorrectionActive(shortcutOnly)).toBe(false)
    expect(isManualConversionEnabled(shortcutOnly)).toBe(false)
  })

  it('persists toggles and drops invalid layouts', () => {
    const stored = normalizeUserProfile({
      enabled: false,
      manualConversionEnabled: true,
      enabledLayouts: ['en-US-qwerty', 'ar-101', 'zh-pinyin', 'en-US-qwerty'],
    })
    const revived = normalizeUserProfile(JSON.parse(JSON.stringify(stored)))
    expect(revived).toEqual(stored)
    expect(revived.enabledLayouts).toEqual(['en-US-qwerty', 'ar-101'])
    expect(normalizeProfile({ enabledLayouts: [] }).enabledLayouts).toEqual([
      'en-US-qwerty',
    ])
    expect(normalizeUserProfile({ enabledLayouts: 'nope' })).toEqual(DEFAULT_USER_PROFILE)
  })

  it('does not evaluate when only one layout is enabled', () => {
    expect(autoFix('hsjo]lj', EN_ONLY)).toBe('hsjo]lj')
    expect(localClassificationHint('hsjo]lj', EN_ONLY)).toBeNull()
  })
})

describe('campaign — cache isolation', () => {
  it('does not reuse a decision across different candidate sets', () => {
    const a = classificationCacheKey('ghbdtn', 'en-US-qwerty', AR_EN.enabledLayouts)
    const b = classificationCacheKey('ghbdtn', 'en-US-qwerty', AR_EN_RU.enabledLayouts)
    expect(a).not.toBe(b)
    const store = createClassificationStore()
    store.memory.set(
      a,
      toCacheRecord({ kind: 'VALID' }, { ts: Date.now() }),
    )
    expect(store.memory.get(b)).toBeUndefined()
  })

  it('evicts when the memory bound is exceeded', () => {
    const store = createClassificationStore({ maxMemory: 8 })
    for (let i = 0; i < 40; i += 1) {
      store.memory.set(
        `k${i}`,
        toCacheRecord({ kind: 'VALID' }, { ts: Date.now() + i }),
      )
    }
    expect(store.memory.size).toBeLessThanOrEqual(8)
    expect(WORD_CACHE_MAX_MEMORY).toBe(2000)
  })
})

describe('campaign — classifier contract and commits', () => {
  it('never commits a disabled or invented target', () => {
    expect(canCommitMismatch(AR_EN, 'ghbdtn', 'ru-standard', 'привет')).toBe(false)
    expect(canCommitMismatch(AR_EN, 'hello', 'ar-101', 'مرحبا')).toBe(false)
    expect(canCommitMismatch(EN_ONLY, 'hsjo]lj', 'ar-101', 'استخدمت')).toBe(false)
  })
})

describe('campaign — IME, races, surgical DOM', () => {
  it('blocks evaluation while composing', () => {
    resetComposition()
    beginComposition()
    expect(isComposing()).toBe(true)
    endComposition()
    expect(isComposing()).toBe(false)
  })

  it('discards stale writes after later edits', () => {
    const input = document.createElement('input')
    document.body.append(input)
    setNativeValue(input, 'hsjo]lj ')
    const delayed = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    setNativeValue(input, 'newer')
    bumpGeneration(input, 'insertText')
    expect(commitReplacement(delayed, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('newer')
  })

  it('replaces only the mismatched token', () => {
    expect(autoFix('hello hsjo]lj how are you')).toBe('hello استخدمت how are you')
  })
})

describe('campaign — fuzz', () => {
  it('does not throw on mixed Unicode noise', () => {
    const rand = seeded(99)
    const alphabet = 'abcxyzABC012[]`;,.!? \n\tمرحباпривет©🎉'
    for (let i = 0; i < 400; i += 1) {
      let text = ''
      const n = 1 + Math.floor(rand() * 24)
      for (let j = 0; j < n; j += 1) text += pick(rand, [...alphabet])
      expect(() => autoFix(text)).not.toThrow()
      expect(() => convertManualText(text, 'en-US-qwerty', 'ar-101')).not.toThrow()
      expect(() => tokenizeText(text)).not.toThrow()
      expect(() => skipReasonForToken(text)).not.toThrow()
    }
  })
})

describe('campaign — performance', () => {
  it('maps normal manual text in well under 5ms', () => {
    const sample = 'hsjo]lj React td hgjwldl\n'.repeat(20)
    const start = performance.now()
    for (let i = 0; i < 200; i += 1) {
      convertManualText(sample, 'en-US-qwerty', 'ar-101')
    }
    const elapsed = performance.now() - start
    const meanMs = elapsed / 200
    expect(meanMs).toBeLessThan(5)
    // eslint-disable-next-line no-console
    console.log('CAMPAIGN_PERF', JSON.stringify({ manualMeanMs: meanMs, sampleChars: sample.length }))
  })
})

describe('campaign — summary gate', () => {
  it('has no crashes and reports collected accuracy buckets', () => {
    expect(tallies.CRASH).toBe(0)
    expect(tallies.FALSE_POSITIVE).toBe(0)
    expect(tallies.INCORRECT_CONVERSION).toBe(0)
    expect(Object.values(tallies).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(200)
    const unexpectedFn = falseNegatives.filter(
      (item) => !item.includes('td stayed') && !item.includes('lk stayed'),
    )
    expect(unexpectedFn, unexpectedFn.join('\n')).toEqual([])
    // eslint-disable-next-line no-console
    console.log('CAMPAIGN_TALLIES', JSON.stringify(tallies))
    // eslint-disable-next-line no-console
    console.log('CAMPAIGN_FN', JSON.stringify(falseNegatives))
  })
})
