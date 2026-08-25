import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildCorpus,
  executeCase,
  remapWords,
  runPlanner,
  type CaseClass,
} from './realWorldCorpus.ts'
import { adjustCaret } from '../layouts/sentence.ts'
import { convertManualText, swapConverterPair } from '../layouts/convert.ts'
import { DEFAULT_PROFILE } from '../layouts/profile.ts'

describe('real-world corpus against the live planner', () => {
  const cases = buildCorpus()
  const tallies: Record<CaseClass, number> = {
    PASS: 0,
    FALSE_POSITIVE: 0,
    FALSE_NEGATIVE: 0,
    CORRUPTION: 0,
    EXPECTED_NOOP: 0,
  }
  const failures: string[] = []

  for (const item of cases) {
    const { actual, result } = executeCase(item)
    tallies[result] += 1
    if (result === 'FALSE_POSITIVE' || result === 'CORRUPTION') {
      failures.push(`${result} ${item.id}: in=${JSON.stringify(item.input)} expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(actual)}`)
    }
    if (result === 'FALSE_NEGATIVE' && item.kind === 'must_fix') {
      failures.push(`${result} ${item.id}: in=${JSON.stringify(item.input)} expected=${JSON.stringify(item.expected)} actual=${JSON.stringify(actual)}`)
    }
  }

  it('builds a large realistic corpus from the actual keyboard maps', () => {
    expect(cases.length).toBeGreaterThanOrEqual(180)
  })

  it('does not modify correct text, safety tokens, or whitespace', () => {
    expect(tallies.FALSE_POSITIVE, failures.join('\n')).toBe(0)
  })

  it('does not corrupt tokens it does change', () => {
    expect(tallies.CORRUPTION, failures.join('\n')).toBe(0)
  })

  it('repairs lexicon-backed wrong-layout Arabic and the Russian golden', () => {
    expect(tallies.FALSE_NEGATIVE, failures.join('\n')).toBe(0)
  })

  it('records a summary for the report', () => {
    writeFileSync(
      'e2e/corpus-summary.json',
      JSON.stringify({ total: cases.length, tallies }, null, 2),
    )
    expect(tallies.PASS + tallies.EXPECTED_NOOP).toBeGreaterThan(0)
  })
})

describe('mixed language and cursor invariants', () => {
  it('fixes only the wrong-layout Arabic token in a mixed sentence', () => {
    const input = `${remapWords('مرحبا', 'ar-101', 'en-US-qwerty')} this is a test.`
    expect(runPlanner(input)).toBe('مرحبا this is a test.')
  })

  it('keeps correct Arabic next to correct English', () => {
    expect(runPlanner('مرحبا this is a test.')).toBe('مرحبا this is a test.')
  })

  it('does not translate English in an Arabic field', () => {
    expect(runPlanner('أنا working on React')).toBe('أنا working on React')
  })

  it('adjusts caret after a replacement without jumping earlier text', () => {
    expect(adjustCaret(7, 0, 6, 5)).toBe(6)
    expect(adjustCaret(0, 2, 6, 5)).toBe(0)
    expect(adjustCaret(3, 2, 6, 8)).toBe(10)
  })

  it('swaps the manual converter pair without touching the page planner', () => {
    const pair = { sourceLayout: 'en-US-qwerty' as const, targetLayout: 'ar-101' as const }
    const swapped = swapConverterPair(pair)
    expect(swapped).toEqual({ sourceLayout: 'ar-101', targetLayout: 'en-US-qwerty' })
    const mapped = convertManualText('hello', swapped.sourceLayout, swapped.targetLayout)
    expect(mapped.ok).toBe(true)
    expect(runPlanner('hello', DEFAULT_PROFILE)).toBe('hello')
  })
})
