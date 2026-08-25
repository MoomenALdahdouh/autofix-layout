/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import {
  bumpGeneration,
  captureSnapshot,
  commitReplacement,
  setNativeValue,
} from '../dom/index.ts'
import { measureSync, resetTimings, cacheTimings } from '../cache/metrics.ts'
import {
  canCommitMismatch,
  inferSourceLayout,
  localClassificationHint,
  mapLayout,
} from '../layouts/index.ts'
import { DEFAULT_PROFILE } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'
import { isArabicWord } from '../layouts/lexicons/ar-words.ts'
import { isEnglishWord } from '../layouts/lexicons/en-words.ts'
import { tokenizeText } from '../safety/index.ts'

const SENTENCE = 'اثممخ بقهثىي اخص شقث غخع'
const EXPECTED = 'hello friend how are you'
const TOKENS = SENTENCE.split(' ')
const INTENDED = EXPECTED.split(' ')

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index] ?? 0
}

describe('realtime audit — token lifecycle (no architecture change)', () => {
  it('prints the actual local decision for each token', () => {
    const rows = TOKENS.map((word, index) => {
      const start = performance.now()
      const source = inferSourceLayout(word, DEFAULT_PROFILE)
      const mapped = source
        ? mapLayout(word, source, 'en-US-qwerty')
        : null
      const hint = localClassificationHint(word, DEFAULT_PROFILE, SENTENCE)
      const commit = canCommitMismatch(
        DEFAULT_PROFILE,
        word,
        'en-US-qwerty',
        mapped ?? undefined,
        SENTENCE,
      )
      const ms = performance.now() - start
      return {
        word,
        intended: INTENDED[index],
        source,
        mapped,
        arabicLexicon: isArabicWord(word),
        mappedIsEnglish: mapped ? isEnglishWord(mapped) : false,
        hint,
        commit,
        ms,
      }
    })

    const planned = planFieldFixes(SENTENCE, DEFAULT_PROFILE, { finalizeAll: true })
    const rewritten = applyFixesToText(SENTENCE, planned)

    // Evidence for the report — keep the assertion on the real planner result.
    console.log('AUDIT_TOKEN_ROWS', JSON.stringify(rows, null, 2))
    console.log('AUDIT_PLANNED', JSON.stringify(planned, null, 2))
    console.log('AUDIT_REWRITTEN', rewritten)

    expect(rows).toHaveLength(5)
    expect(rewritten).toBe(EXPECTED)
  })

  it('measures local CPU cost of the sentence (not network)', () => {
    const tokenizeMs: number[] = []
    const planMs: number[] = []
    const hintMs: number[] = []
    for (let i = 0; i < 200; i += 1) {
      tokenizeMs.push(
        measureSync('cacheHit', () => {
          tokenizeText(SENTENCE)
          return 0
        }) as unknown as number,
      )
    }
    resetTimings()
    for (let i = 0; i < 200; i += 1) {
      const t0 = performance.now()
      tokenizeText(SENTENCE)
      tokenizeMs.push(performance.now() - t0)
      const t1 = performance.now()
      planFieldFixes(SENTENCE, DEFAULT_PROFILE, { finalizeAll: true })
      planMs.push(performance.now() - t1)
      const t2 = performance.now()
      for (const word of TOKENS) localClassificationHint(word, DEFAULT_PROFILE, SENTENCE)
      hintMs.push(performance.now() - t2)
    }
    const summary = {
      tokenize: {
        p50: percentile(tokenizeMs.slice(-200), 50),
        p95: percentile(tokenizeMs.slice(-200), 95),
        p99: percentile(tokenizeMs.slice(-200), 99),
      },
      plan: {
        p50: percentile(planMs, 50),
        p95: percentile(planMs, 95),
        p99: percentile(planMs, 99),
      },
      hints: {
        p50: percentile(hintMs, 50),
        p95: percentile(hintMs, 95),
        p99: percentile(hintMs, 99),
      },
    }
    console.log('AUDIT_LOCAL_CPU_MS', JSON.stringify(summary))
    expect(summary.plan.p95).toBeLessThan(20)
    expect(summary.tokenize.p95).toBeLessThan(5)
  })
})

describe('realtime audit — space-by-space evaluate (finalizeAll=false)', () => {
  it('plans completed tokens after each space while the caret is in the next word', () => {
    const prefixes = [
      'اثممخ ',
      'اثممخ بقهثىي ',
      'اثممخ بقهثىي اخص ',
      'اثممخ بقهثىي اخص شقث ',
      'اثممخ بقهثىي اخص شقث غخع ',
    ]
    const snapshots = prefixes.map((text) => {
      const caret = text.length
      const fixes = planFieldFixes(text, DEFAULT_PROFILE, {
        finalizeAll: false,
        caret,
      })
      return { text, caret, rewritten: applyFixesToText(text, fixes) }
    })
    console.log('AUDIT_SPACE_PREFIXES', JSON.stringify(snapshots, null, 2))
    expect(snapshots.at(-1)?.rewritten.trim()).toBe(EXPECTED)
  })

  it('still plans earlier tokens when the caret is inside the next unfinished word', () => {
    const text = 'اثممخ بقه'
    const caret = text.length
    const fixes = planFieldFixes(text, DEFAULT_PROFILE, { finalizeAll: false, caret })
    console.log(
      'AUDIT_CARET_INSIDE_NEXT',
      JSON.stringify({ text, fixes, rewritten: applyFixesToText(text, fixes) }),
    )
    expect(applyFixesToText(text, fixes)).toBe('hello بقه')
  })
})

describe('realtime audit — delayed local write while user continues', () => {
  function field(value: string): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.append(input)
    setNativeValue(input, value)
    input.setSelectionRange(value.length, value.length)
    return input
  }

  it('does not block further inserts while a delayed evaluate is in flight', () => {
    const input = field('اثممخ ')
    const snapshot = captureSnapshot(input, 'value', 'اثممخ', 0, 5, 6)
    setNativeValue(input, 'اثممخ بقهثىي')
    bumpGeneration(input, 'insertText')
    input.setSelectionRange(input.value.length, input.value.length)
    const verdict = commitReplacement(snapshot, 'hello')
    console.log('AUDIT_DELAYED_WRITE', {
      verdict,
      value: input.value,
      caret: input.selectionStart,
    })
    expect(verdict).toBe('written')
    expect(input.value.startsWith('hello')).toBe(true)
  })

  it('discards a stale token write after the user edited that token', () => {
    const input = field('بقهثىي ')
    const snapshot = captureSnapshot(input, 'value', 'بقهثىي', 0, 6, 7)
    setNativeValue(input, 'hello ')
    bumpGeneration(input, 'insertText')
    expect(commitReplacement(snapshot, 'friend')).toBe('discarded')
    expect(input.value).toBe('hello ')
  })

  it('applies overlapping same-length writes from two evaluates without corrupting later tokens', () => {
    const input = field(SENTENCE)
    const first = captureSnapshot(input, 'value', 'اثممخ', 0, 5, SENTENCE.length)
    const second = captureSnapshot(input, 'value', 'بقهثىي', 6, 12, SENTENCE.length)
    expect(commitReplacement(first, 'hello')).toBe('written')
    expect(commitReplacement(second, 'friend')).toBe('written')
    expect(input.value.startsWith('hello friend')).toBe(true)
  })
})

describe('realtime audit — existing timing hooks', () => {
  it('records DOM replace well under 5ms on the local hot path', () => {
    resetTimings()
    const input = document.createElement('input')
    input.type = 'text'
    document.body.append(input)
    for (let i = 0; i < 20; i += 1) {
      setNativeValue(input, 'اثممخ ')
      const snapshot = captureSnapshot(input, 'value', 'اثممخ', 0, 5, 6)
      measureSync('domReplace', () => commitReplacement(snapshot, 'hello'))
    }
    const timings = cacheTimings()
    console.log('AUDIT_DOM_REPLACE', timings.domReplace)
    expect(timings.domReplace.p95).toBeLessThan(5)
  })
})
