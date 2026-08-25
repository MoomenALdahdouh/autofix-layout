/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import {
  bumpGeneration,
  captureSnapshot,
  commitReplacement,
  readFieldText,
  setNativeValue,
} from '../dom/index.ts'

function valueField(value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  document.body.append(input)
  setNativeValue(input, value)
  input.setSelectionRange(value.length, value.length)
  return input
}

describe('F. race conditions — no stale DOM writes', () => {
  it('discards a delayed response after rapid typing and deletion', () => {
    const input = valueField('hsjo]lj ')
    const delayed = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    setNativeValue(input, 'hsjo]lj more')
    bumpGeneration(input, 'insertText')
    setNativeValue(input, 'more')
    bumpGeneration(input, 'deleteContentBackward')
    expect(commitReplacement(delayed, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('more')
  })

  it('discards after a selection change covering the original word', () => {
    const input = valueField('hsjo]lj React')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 13)
    input.setSelectionRange(0, 7)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('hsjo]lj React')
  })

  it('discards after the field node is replaced', () => {
    const first = valueField('hsjo]lj ')
    const snapshot = captureSnapshot(first, 'value', 'hsjo]lj', 0, 7, 8)
    const second = valueField('hsjo]lj ')
    first.replaceWith(second)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(second.value).toBe('hsjo]lj ')
  })
})

describe('G. contenteditable', () => {
  it('replaces across nested spans and keeps surrounding text', () => {
    const root = document.createElement('div')
    root.contentEditable = 'true'
    const bold = document.createElement('strong')
    bold.textContent = 'hsjo]lj'
    root.append('hello ', bold, ' React')
    document.body.append(root)
    expect(readFieldText(root)).toBe('hello hsjo]lj React')
    const snapshot = captureSnapshot(root, 'contenteditable', 'hsjo]lj', 6, 13, 19)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('written')
    expect(readFieldText(root)).toBe('hello استخدمت React')
  })

  it('does not write after the user deletes the original text node', () => {
    const root = document.createElement('div')
    root.contentEditable = 'true'
    root.append('hsjo]lj more')
    document.body.append(root)
    const snapshot = captureSnapshot(root, 'contenteditable', 'hsjo]lj', 0, 7, 12)
    root.textContent = 'more'
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(readFieldText(root)).toBe('more')
  })
})

describe('L. selection and caret', () => {
  it('writes when the caret is past the word and not when it is inside', () => {
    const end = valueField('hsjo]lj React')
    end.setSelectionRange(13, 13)
    expect(
      commitReplacement(captureSnapshot(end, 'value', 'hsjo]lj', 0, 7, 13), 'استخدمت'),
    ).toBe('written')
    expect(end.value).toBe('استخدمت React')

    const mid = valueField('hsjo]lj')
    mid.setSelectionRange(3, 3)
    expect(
      commitReplacement(captureSnapshot(mid, 'value', 'hsjo]lj', 0, 7, 3), 'استخدمت'),
    ).toBe('discarded')
    expect(mid.value).toBe('hsjo]lj')
  })

  it('does not overwrite a user selection replacement', () => {
    const input = valueField('aaaa hsjo]lj')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 5, 12, 12)
    setNativeValue(input, 'aaaa gone')
    input.setSelectionRange(5, 9)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('aaaa gone')
  })

  it('still writes after blur if the snapshot is intact', () => {
    const input = valueField('hsjo]lj ')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    input.blur()
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('written')
    expect(input.value).toBe('استخدمت ')
  })
})
