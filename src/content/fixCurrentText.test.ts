/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from '../layouts/profile.ts'
import { applyFixesToText } from '../layouts/sentence.ts'
import { captureSnapshot, commitReplacement, setNativeValue } from '../dom/index.ts'
import {
  captureShortcutSession,
  fixCurrentText,
  isFixCurrentTextShortcut,
  planShortcutFixes,
  resolveFixTarget,
  shortcutSessionStillValid,
  tokenAtCaret,
  tokensNeedingClassifier,
  type FixCurrentTextHost,
} from './fixCurrentText.ts'

const MIXED_CORRECT = 'مرحبا هذا انا how are you'
const MIXED_WRONG = 'مرحبا hsjo]lj how are you'

function host(
  overrides: Partial<FixCurrentTextHost> = {},
): FixCurrentTextHost {
  return {
    profile: DEFAULT_PROFILE,
    personalExceptions: [],
    directShortcutEnabled: true,
    composing: false,
    pageBlocked: false,
    fieldBlocked: () => false,
    usageAllowed: async () => true,
    requestVerdict: async () => false,
    writeFix: (snapshot, corrected, source, target) => {
      void source
      void target
      return (
        commitReplacement(snapshot, corrected, true, snapshot.element, {
          allowActiveEdit: true,
          placeCaretAfter: true,
        }) === 'written'
      )
    },
    ...overrides,
  }
}

function textField(value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  document.body.append(input)
  setNativeValue(input, value)
  input.focus()
  input.setSelectionRange(value.length, value.length)
  return input
}

describe('shortcut targeting', () => {
  it('prefers the selection over the caret token', () => {
    const text = MIXED_WRONG
    const start = text.indexOf('hsjo]lj')
    const target = resolveFixTarget(text, start, start + 7)
    expect(target).toEqual({
      start,
      end: start + 7,
      text: 'hsjo]lj',
      mode: 'selection',
    })
  })

  it('uses the token around the caret when nothing is selected', () => {
    const text = MIXED_WRONG
    const start = text.indexOf('hsjo]lj')
    const target = tokenAtCaret(text, start + 3)
    expect(target?.text).toBe('hsjo]lj')
    expect(target?.mode).toBe('token')
  })

  it('is a no-op on empty selection or empty field', () => {
    expect(resolveFixTarget('hello  world', 5, 7)).toBeNull()
    expect(tokenAtCaret('hello  world', 6)).toBeNull()
    expect(resolveFixTarget('', 0, 0)).toBeNull()
  })

  it('uses the whole field when nothing is selected', () => {
    const text = 'اثممخ بقهثىي'
    const target = resolveFixTarget(text, text.length, text.length)
    expect(target?.mode).toBe('field')
    expect(target?.text).toBe(text)
  })

  it('does not pull in adjacent words', () => {
    const text = 'aaa hsjo]lj bbb'
    const caret = text.indexOf('hsjo]lj') + 2
    expect(tokenAtCaret(text, caret)?.text).toBe('hsjo]lj')
  })
})

describe('shortcut planning', () => {
  it('leaves correct mixed-language text unchanged', () => {
    const target = resolveFixTarget(MIXED_CORRECT, 0, MIXED_CORRECT.length)
    expect(target).not.toBeNull()
    expect(planShortcutFixes(MIXED_CORRECT, DEFAULT_PROFILE, target!)).toEqual([])
  })

  it('fixes only the wrong-layout token in a mixed sentence', () => {
    const start = MIXED_WRONG.indexOf('hsjo]lj')
    const target = tokenAtCaret(MIXED_WRONG, start + 1)!
    const fixes = planShortcutFixes(MIXED_WRONG, DEFAULT_PROFILE, target)
    expect(fixes).toHaveLength(1)
    expect(fixes[0]?.corrected).toBe('استخدمت')
    expect(applyFixesToText(MIXED_WRONG, fixes)).toBe('مرحبا استخدمت how are you')
  })

  it('does not convert every word in a mixed selection', () => {
    const target = resolveFixTarget(MIXED_WRONG, 0, MIXED_WRONG.length)!
    const next = applyFixesToText(
      MIXED_WRONG,
      planShortcutFixes(MIXED_WRONG, DEFAULT_PROFILE, target),
    )
    expect(next).toBe('مرحبا استخدمت how are you')
  })

  it('preserves trailing punctuation on a selected token', () => {
    const text = 'hsjo]lj,'
    const target = resolveFixTarget(text, 0, text.length)!
    const next = applyFixesToText(text, planShortcutFixes(text, DEFAULT_PROFILE, target))
    expect(next).toBe('استخدمت,')
  })

  it('does not plan URL, email, number, or technical tokens', () => {
    for (const text of [
      'https://example.com',
      'test@example.com',
      '123',
      '2026-08-23',
      'React',
      'API',
      'Laravel',
    ]) {
      const target = resolveFixTarget(text, 0, text.length)!
      expect(planShortcutFixes(text, DEFAULT_PROFILE, target)).toEqual([])
      expect(tokensNeedingClassifier(text, DEFAULT_PROFILE, target)).toEqual([])
    }
  })
})

describe('shortcut DOM replacement', () => {
  it('replaces the current token in an input and leaves the caret after it', async () => {
    const input = textField(MIXED_WRONG)
    const start = MIXED_WRONG.indexOf('hsjo]lj')
    input.setSelectionRange(start + 3, start + 3)
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(true)
    expect(input.value).toBe('مرحبا استخدمت how are you')
    expect(input.selectionStart).toBe(start + 'استخدمت'.length)
    expect(document.activeElement).toBe(input)
  })

  it('replaces only the selected token', async () => {
    const input = textField(MIXED_WRONG)
    const start = MIXED_WRONG.indexOf('hsjo]lj')
    input.setSelectionRange(start, start + 7)
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(true)
    expect(input.value).toBe('مرحبا استخدمت how are you')
  })

  it('does not change already-correct text', async () => {
    const input = textField(MIXED_CORRECT)
    input.setSelectionRange(0, MIXED_CORRECT.length)
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(false)
    expect(input.value).toBe(MIXED_CORRECT)
  })

  it('is a no-op without a focused field', async () => {
    document.body.replaceChildren()
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('unsupported')
  })

  it('corrects the whole input when the caret is after the text', async () => {
    const input = textField('اثممخ بقهثىي')
    input.setSelectionRange(input.value.length, input.value.length)
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(true)
    expect(input.value).toBe('hello friend')
  })

  it('still works when automatic correction is conceptually off', async () => {
    const input = textField('hsjo]lj')
    input.setSelectionRange(3, 3)
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(true)
    expect(input.value).toBe('استخدمت')
  })

  it('does not run when the direct shortcut toggle is off', async () => {
    const input = textField('hsjo]lj')
    const result = await fixCurrentText(host({ directShortcutEnabled: false }))
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('disabled')
    expect(input.value).toBe('hsjo]lj')
  })

  it('does not run on a protected field', async () => {
    const input = textField('hsjo]lj')
    input.autocomplete = 'current-password'
    const result = await fixCurrentText(
      host({
        fieldBlocked: () => true,
      }),
    )
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('unsupported')
    expect(input.value).toBe('hsjo]lj')
  })

  it('does not run when usage is denied', async () => {
    const input = textField('hsjo]lj')
    const result = await fixCurrentText(host({ usageAllowed: async () => false }))
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('usage')
    expect(input.value).toBe('hsjo]lj')
  })

  it('replaces a textarea token', async () => {
    const area = document.createElement('textarea')
    document.body.append(area)
    setNativeValue(area, 'hsjo]lj')
    area.focus()
    area.setSelectionRange(0, 7)
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(true)
    expect(area.value).toBe('استخدمت')
  })

  it('replaces a contenteditable token without rewriting the whole tree', async () => {
    const root = document.createElement('div')
    root.contentEditable = 'true'
    const bold = document.createElement('strong')
    bold.textContent = 'hsjo]lj'
    root.append('hello ', bold)
    document.body.append(root)
    root.focus()
    const range = document.createRange()
    range.selectNodeContents(bold)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const result = await fixCurrentText(host())
    expect(result.applied).toBe(true)
    expect(root.textContent).toBe('hello استخدمت')
    expect(root.querySelector('strong')).not.toBeNull()
  })

  it('does not apply a stale classifier result after the field changes', async () => {
    const input = textField('zzzzzz')
    input.setSelectionRange(2, 2)
    const result = await fixCurrentText(
      host({
        requestVerdict: async (snapshot) => {
          setNativeValue(input, 'changed')
          expect(
            commitReplacement(snapshot, 'استخدمت', true, snapshot.element, {
              allowActiveEdit: true,
            }),
          ).toBe('discarded')
          return false
        },
      }),
    )
    expect(input.value).toBe('changed')
    expect(result.applied).toBe(false)
  })

  it('treats a changed selection as stale before classifying', async () => {
    const input = textField('zzzzzz')
    input.setSelectionRange(2, 2)
    const session = captureShortcutSession(input, DEFAULT_PROFILE, { start: 2, end: 2 })
    input.setSelectionRange(0, 6)
    expect(shortcutSessionStillValid(session, DEFAULT_PROFILE, input)).toBe(false)
  })
})

describe('page shortcut chord', () => {
  it('matches Ctrl/⌘+Shift+P only', () => {
    const match = new KeyboardEvent('keydown', {
      code: 'KeyP',
      key: 'p',
      metaKey: true,
      shiftKey: true,
    })
    const other = new KeyboardEvent('keydown', {
      code: 'KeyL',
      key: 'l',
      metaKey: true,
      shiftKey: true,
    })
    expect(isFixCurrentTextShortcut(match)).toBe(true)
    expect(isFixCurrentTextShortcut(other)).toBe(false)
  })
})

describe('explicit write options', () => {
  it('writes while the caret is inside the token when allowActiveEdit is set', () => {
    const input = textField('hsjo]lj')
    input.setSelectionRange(3, 3)
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 3)
    expect(
      commitReplacement(snapshot, 'استخدمت', true, input, {
        allowActiveEdit: true,
        placeCaretAfter: true,
      }),
    ).toBe('written')
    expect(input.value).toBe('استخدمت')
    expect(input.selectionStart).toBe('استخدمت'.length)
  })
})
