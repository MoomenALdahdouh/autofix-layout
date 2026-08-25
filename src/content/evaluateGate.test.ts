import { describe, expect, it } from 'vitest'
import { evaluateGate } from './evaluateGate.ts'

describe('evaluate gate', () => {
  it('applies local fixes immediately when usage is already allowed', () => {
    expect(
      evaluateGate({
        live: true,
        composing: false,
        pageBlocked: false,
        canIntervene: true,
      }),
    ).toBe('local-now')
  })

  it('waits for a usage refresh only when the cached decision is deny', () => {
    expect(
      evaluateGate({
        live: true,
        composing: false,
        pageBlocked: false,
        canIntervene: false,
      }),
    ).toBe('await-usage')
  })

  it('never evaluates while automatic mode is off, composing, or blocked', () => {
    expect(
      evaluateGate({
        live: false,
        composing: false,
        pageBlocked: false,
        canIntervene: true,
      }),
    ).toBe('skip')
    expect(
      evaluateGate({
        live: true,
        composing: true,
        pageBlocked: false,
        canIntervene: true,
      }),
    ).toBe('skip')
    expect(
      evaluateGate({
        live: true,
        composing: false,
        pageBlocked: true,
        canIntervene: true,
      }),
    ).toBe('skip')
  })
})
