/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import {
  captureSnapshot,
  commitReplacement,
  setNativeValue,
} from '../dom/index.ts'
import { evaluateGate } from '../content/evaluateGate.ts'
import { DEFAULT_PROFILE } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'

const SENTENCE = 'اثممخ بقهثىي اخص شقث غخع'
const EXPECTED = 'hello friend how are you'

function wpmCharDelayMs(wpm: number): number {
  return 60_000 / (wpm * 5)
}

function applyCatchUp(text: string, caret: number): string {
  return applyFixesToText(
    text,
    planFieldFixes(text, DEFAULT_PROFILE, { finalizeAll: false, caret }),
  )
}

describe('rapid typing catch-up', () => {
  it.each([30, 50, 70, 90, 110, 130])(
    'corrects completed tokens at %s WPM without waiting for usage refresh',
    (wpm) => {
      const delay = wpmCharDelayMs(wpm)
      let text = ''
      const latencies: number[] = []
      for (const char of [...`${SENTENCE} `]) {
        text += char
        if (char !== ' ') continue
        const gate = evaluateGate({
          live: true,
          composing: false,
          pageBlocked: false,
          canIntervene: true,
        })
        expect(gate).toBe('local-now')
        const before = performance.now()
        text = applyCatchUp(text, text.length)
        latencies.push(performance.now() - before)
      }
      expect(text.trim()).toBe(EXPECTED)
      expect(Math.max(...latencies)).toBeLessThan(delay)
    },
  )

  it('still reaches the full sentence after a burst with no per-word pause', () => {
    const burst = SENTENCE
    const next = applyCatchUp(burst + ' ', (burst + ' ').length)
    expect(next.trim()).toBe(EXPECTED)
  })

  it('keeps typing responsive when a usage refresh is artificially late', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    document.body.append(input)
    setNativeValue(input, 'اثممخ ')
    input.setSelectionRange(6, 6)

    const snapshot = captureSnapshot(input, 'value', 'اثممخ', 0, 5, 6)
    setNativeValue(input, 'اثممخ بقهثىي')
    input.setSelectionRange(input.value.length, input.value.length)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(commitReplacement(snapshot, 'hello')).toBe('written')
    expect(input.value.startsWith('hello')).toBe(true)
    expect(input.selectionStart).toBeGreaterThan(5)
  })
})
