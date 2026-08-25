import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from '../layouts/profile.ts'
import { tokenizeText } from '../safety/tokenize.ts'
import {
  AR_OS_PROFILE,
  analyzeTriggerExample,
  applyCatchUp,
  buildMixedLanguageCorpus,
  executeMixed,
  executeMixedBothProfiles,
  triggerExpected,
  type MixedCategory,
  type MixedClass,
  type MixedKind,
} from './mixedLanguageCorpus.ts'

const FAILURES: MixedClass[] = ['FALSE_POSITIVE', 'CORRUPTION']

describe('mixed-language corpus against the live planner', () => {
  const cases = buildMixedLanguageCorpus()
  const tallies: Record<MixedClass, number> = {
    PASS: 0,
    FALSE_POSITIVE: 0,
    FALSE_NEGATIVE: 0,
    CORRUPTION: 0,
    PARTIAL_OK: 0,
    EXPECTED_NOOP: 0,
  }
  const byKind: Record<MixedKind, number> = {
    must_keep: 0,
    must_fix: 0,
    partial_fix: 0,
    safety_keep: 0,
  }
  const byCategory: Partial<Record<MixedCategory, number>> = {}
  const failures: string[] = []
  const falseNegatives: string[] = []
  let totalMs = 0
  let maxMs = 0
  let fixPass = 0
  let keepPass = 0

  for (const item of cases) {
    byKind[item.kind] += 1
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1
    const both = executeMixedBothProfiles(item)
    const started = performance.now()
    const primary = executeMixed(item, DEFAULT_PROFILE)
    totalMs += performance.now() - started
    if (primary.ms > maxMs) maxMs = primary.ms
    tallies[primary.result] += 1
    if (item.kind === 'must_fix' && primary.result === 'PASS') fixPass += 1
    if (
      (item.kind === 'must_keep' || item.kind === 'safety_keep') &&
      primary.result === 'PASS'
    ) {
      keepPass += 1
    }
    const bad =
      FAILURES.includes(primary.result) ||
      FAILURES.includes(both.arOsResult) ||
      (item.kind === 'must_keep' && both.arOsResult !== 'PASS') ||
      (item.kind === 'safety_keep' && both.arOsResult !== 'PASS')
    if (bad) {
      failures.push(
        `${primary.result}/${both.arOsResult} ${item.id}: in=${JSON.stringify(item.input)} expected=${JSON.stringify(item.expected)} default=${JSON.stringify(both.defaultActual)} arOs=${JSON.stringify(both.arOsActual)}`,
      )
    }
    if (primary.result === 'FALSE_NEGATIVE' && item.kind === 'must_fix') {
      falseNegatives.push(
        `${item.id}: in=${JSON.stringify(item.input)} expected=${JSON.stringify(item.expected)}`,
      )
    }
  }

  const keepCount = byKind.must_keep + byKind.safety_keep
  const fixCount = byKind.must_fix
  const fpRate = keepCount === 0 ? 0 : (keepCount - keepPass) / keepCount
  const recoveryRate = fixCount === 0 ? 0 : fixPass / fixCount

  it('builds at least 200 keep, 200 wrong-layout, and 200 partial mixed sentences', () => {
    expect(keepCount).toBeGreaterThanOrEqual(200)
    expect(fixCount).toBeGreaterThanOrEqual(200)
    expect(byKind.partial_fix).toBeGreaterThanOrEqual(200)
    expect(cases.length).toBeGreaterThanOrEqual(600)
  })

  it('does not modify correct mixed-language text on either OS-layout profile', () => {
    expect(tallies.FALSE_POSITIVE, failures.join('\n')).toBe(0)
    expect(
      failures.filter((line) => line.includes('FALSE_POSITIVE')).join('\n'),
    ).toBe('')
  })

  it('does not corrupt tokens it changes', () => {
    expect(tallies.CORRUPTION, failures.join('\n')).toBe(0)
  })

  it('recovers high-confidence wrong-layout segments', () => {
    expect(fpRate).toBe(0)
    expect(recoveryRate, falseNegatives.slice(0, 20).join('\n')).toBeGreaterThan(0.85)
    expect(tallies.FALSE_NEGATIVE, falseNegatives.slice(0, 20).join('\n')).toBeLessThan(
      fixCount * 0.15,
    )
  })

  it('records executed counts for the report', () => {
    mkdirSync('e2e', { recursive: true })
    const trigger = triggerExpected()
    writeFileSync(
      'e2e/mixed-language-summary.json',
      JSON.stringify(
        {
          total: cases.length,
          byKind,
          byCategory,
          tallies,
          fpRate,
          recoveryRate,
          avgMs: totalMs / cases.length,
          maxMs,
          trigger,
          tokenAnalysis: analyzeTriggerExample(),
          failureCount: failures.length,
          failures: failures.slice(0, 40),
          falseNegatives: falseNegatives.slice(0, 40),
        },
        null,
        2,
      ),
    )
    expect(tallies.PASS + tallies.PARTIAL_OK + tallies.EXPECTED_NOOP).toBeGreaterThan(0)
  })
})

describe('trigger sentence and symbol boundaries', () => {
  const { typed, expected, friendKeys } = triggerExpected()

  it('maps بهىث to fine and friend to بقهثىي', () => {
    expect(friendKeys).toBe('بقهثىي')
    expect(executeMixed({
      id: 'unit-fine',
      category: 'trigger',
      kind: 'must_fix',
      input: 'بهىث',
      expected: 'fine',
    }).actual).toBe('fine')
  })

  it('corrects the trigger sentence without turning ÷ into I', () => {
    expect(executeMixed({
      id: 'unit-trigger',
      category: 'trigger',
      kind: 'must_fix',
      input: typed,
      expected,
    }).actual).toBe(expected)
    expect(executeMixed({
      id: 'unit-trigger-aros',
      category: 'trigger',
      kind: 'must_fix',
      input: typed,
      expected,
    }, AR_OS_PROFILE).actual).toBe(expected)
  })

  it('splits hello÷world and leaves the symbol in place', () => {
    expect(tokenizeText('hello÷world').tokens.map((item) => item.token)).toEqual([
      'hello',
      'world',
    ])
    expect(executeMixed({
      id: 'unit-adj',
      category: 'adjacent_symbol',
      kind: 'must_keep',
      input: 'hello÷world',
      expected: 'hello÷world',
    }).actual).toBe('hello÷world')
  })

  it('does not treat a lone ÷ as a word on an Arabic OS profile', () => {
    expect(executeMixed({
      id: 'unit-div',
      category: 'F_symbol',
      kind: 'must_keep',
      input: 'hello ÷ world',
      expected: 'hello ÷ world',
    }, AR_OS_PROFILE).actual).toBe('hello ÷ world')
  })
})

describe('character-by-character mixed-language typing', () => {
  it('recovers English typed through Arabic 101 as spaces arrive', () => {
    const typed = 'اثممخ بقهثىي اخص شقث غخع '
    let text = ''
    for (const char of [...typed]) {
      text += char
      text = applyCatchUp(text, text.length)
    }
    expect(text.trim()).toBe('hello friend how are you')
  })

  it('leaves a correct mixed sentence unchanged while typing', () => {
    const typed = 'مرحبا كيف حالك hello how are you '
    let text = ''
    for (const char of [...typed]) {
      text += char
      text = applyCatchUp(text, text.length)
    }
    expect(text.trim()).toBe('مرحبا كيف حالك hello how are you')
  })

  it('recovers the trigger line incrementally except the ÷ symbol', () => {
    const { typed, expected } = triggerExpected()
    let text = ''
    for (const char of [...`${typed} `]) {
      text += char
      text = applyCatchUp(text, text.length, DEFAULT_PROFILE)
    }
    expect(text.trim()).toBe(expected)
  })
})
