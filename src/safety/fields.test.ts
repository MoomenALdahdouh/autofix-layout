/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import { isValueEditable } from '../dom/read.ts'
import { planFieldFixes } from '../layouts/sentence.ts'
import { DEFAULT_PROFILE } from '../layouts/profile.ts'
import { probeElement, skipReasonForField } from './fields.ts'

function input(attrs: Record<string, string>): HTMLInputElement {
  const el = document.createElement('input')
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'type') el.type = value
    else el.setAttribute(key, value)
  }
  document.body.append(el)
  return el
}

describe('field probe uses only the active element', () => {
  it('reads placeholder and labelled-by text without walking the page', () => {
    const label = document.createElement('label')
    label.htmlFor = 'cvv'
    label.textContent = 'CVV'
    const el = input({ id: 'cvv', type: 'text', name: 'cvc' })
    document.body.append(label)
    const probe = probeElement(el)
    expect(probe.placeholder).toBe('')
    expect(probe.label).toMatch(/CVV/)
    expect(skipReasonForField(probe)).toBe('payment-field')
  })

  it('protects password, confirm password, and new-password autocomplete', () => {
    expect(skipReasonForField(probeElement(input({ type: 'password' })))).toBe(
      'password-field',
    )
    expect(
      skipReasonForField(probeElement(input({ type: 'text', autocomplete: 'new-password' }))),
    ).toBe('password-field')
    expect(
      skipReasonForField(
        probeElement(input({ type: 'text', name: 'confirmPassword', placeholder: 'Confirm password' })),
      ),
    ).toBe('password-field')
  })
})

describe('editable gate does not inspect email, URL, password, or file inputs', () => {
  it('treats only ordinary text-like controls as value-editable', () => {
    expect(isValueEditable(input({ type: 'text' }))).toBe(true)
    expect(isValueEditable(input({ type: 'search' }))).toBe(true)
    expect(isValueEditable(input({ type: 'tel' }))).toBe(true)
    expect(isValueEditable(input({ type: 'password' }))).toBe(false)
    expect(isValueEditable(input({ type: 'email' }))).toBe(false)
    expect(isValueEditable(input({ type: 'url' }))).toBe(false)
    expect(isValueEditable(input({ type: 'file' }))).toBe(false)
    expect(isValueEditable(input({ type: 'hidden' }))).toBe(false)
  })
})

describe('protected fields never reach the planner', () => {
  it('does not plan a password-named text control even if the value looks like layout text', () => {
    const el = input({ type: 'text', name: 'password', value: 'hsjo]lj' })
    expect(skipReasonForField(probeElement(el))).toBe('password-field')
    expect(planFieldFixes('hsjo]lj', DEFAULT_PROFILE, { finalizeAll: true }).length).toBeGreaterThan(
      0,
    )
  })
})
