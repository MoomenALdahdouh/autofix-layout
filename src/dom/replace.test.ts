/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest'
import { measureSync, resetTimings, cacheTimings } from '../cache/metrics.ts'
import {
  bumpGeneration,
  captureSnapshot,
  commitReplacement,
  mappingStillValid,
  readFieldText,
  setNativeValue,
  verifyReplacement,
} from './index.ts'
import { currentGeneration } from './verify.ts'

function generations(): WeakMap<Element, number> {
  return new WeakMap()
}

function valueField(value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  document.body.append(input)
  setNativeValue(input, value)
  input.setSelectionRange(value.length, value.length)
  return input
}

function areaField(value: string): HTMLTextAreaElement {
  const area = document.createElement('textarea')
  document.body.append(area)
  setNativeValue(area, value)
  area.setSelectionRange(value.length, value.length)
  return area
}

describe('value replacement', () => {
  it('uses the native setter and insertReplacementText', () => {
    const input = valueField('hsjo]lj ')
    const events: string[] = []
    input.addEventListener('input', (event) => {
      events.push((event as InputEvent).inputType)
    })
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('written')
    expect(input.value).toBe('استخدمت ')
    expect(events).toEqual(['insertReplacementText'])
    expect(input.selectionStart).toBe(8)
  })

  it('keeps DOM replacement on the local hot path', () => {
    resetTimings()
    const input = valueField('hsjo]lj ')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    for (let i = 0; i < 20; i += 1) {
      setNativeValue(input, 'hsjo]lj ')
      measureSync('domReplace', () => commitReplacement(snapshot, 'استخدمت'))
    }
    expect(cacheTimings().domReplace.p95).toBeLessThan(5)
  })

  it('restores the caret after a shorter or longer replacement', () => {
    const input = valueField('td React')
    input.setSelectionRange(8, 8)
    const snapshot = captureSnapshot(input, 'value', 'td', 0, 2, 8)
    expect(commitReplacement(snapshot, 'في')).toBe('written')
    expect(input.value).toBe('في React')
    expect(input.selectionStart).toBe(8)
  })

  it('notifies a React/Vue-style controlled listener', () => {
    const input = valueField('hsjo]lj ')
    let state = input.value
    input.addEventListener('input', () => {
      state = input.value
    })
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    commitReplacement(snapshot, 'استخدمت')
    expect(state).toBe('استخدمت ')
  })
})

describe('pre-write verification', () => {
  it('discards when the original word is gone', () => {
    const input = valueField('hsjo]lj more')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    setNativeValue(input, 'more')
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('more')
  })

  it('does not apply a stale response after word A is deleted', () => {
    const input = valueField('hsjo]lj ')
    const snapshotA = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    setNativeValue(input, 'hgjwldl ')
    bumpGeneration(input, 'insertText')
    expect(commitReplacement(snapshotA, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('hgjwldl ')
  })

  it('discards when the caret is inside the original word', () => {
    const input = valueField('hsjo]lj')
    input.setSelectionRange(3, 3)
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 3)
    expect(
      verifyReplacement(snapshot, 'استخدمت', generations()),
    ).toBe('caret-inside-word')
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('hsjo]lj')
  })

  it('discards a disconnected or replaced node', () => {
    const input = valueField('hsjo]lj ')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    input.remove()
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')

    const first = valueField('hsjo]lj ')
    const snap = captureSnapshot(first, 'value', 'hsjo]lj', 0, 7, 8)
    const second = valueField('hsjo]lj ')
    first.replaceWith(second)
    expect(commitReplacement(snap, 'استخدمت', true, first)).toBe('discarded')
    expect(second.value).toBe('hsjo]lj ')
  })

  it('discards an invalid or stale mapping', () => {
    const input = valueField('hsjo]lj ')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    expect(commitReplacement(snapshot, 'استخدمت', false)).toBe('discarded')
    expect(mappingStillValid('hsjo]lj', 'استخدمت', () => 'nope')).toBe(false)
    expect(mappingStillValid('hsjo]lj', 'استخدمت', () => 'استخدمت')).toBe(true)
    expect(input.value).toBe('hsjo]lj ')
  })
})

describe('races and boundaries', () => {
  it('keeps later text when the first word is still intact', () => {
    const input = valueField('hsjo]lj React')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 13)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('written')
    expect(input.value).toBe('استخدمت React')
  })

  it('tolerates duplicate spaces, Enter, and punctuation', () => {
    const input = valueField('hsjo]lj  ')
    expect(
      commitReplacement(captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 9), 'استخدمت'),
    ).toBe('written')
    expect(input.value).toBe('استخدمت  ')

    const area = areaField('hsjo]lj\nnext')
    expect(
      commitReplacement(captureSnapshot(area, 'value', 'hsjo]lj', 0, 7, 8), 'استخدمت'),
    ).toBe('written')
    expect(area.value).toBe('استخدمت\nnext')

    const punct = valueField('hsjo]lj.')
    expect(
      commitReplacement(captureSnapshot(punct, 'value', 'hsjo]lj', 0, 7, 8), 'استخدمت'),
    ).toBe('written')
    expect(punct.value).toBe('استخدمت.')
  })

  it('discards when the user selects the original word', () => {
    const input = valueField('hsjo]lj React')
    input.setSelectionRange(0, 7)
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 7)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('discarded')
    expect(input.value).toBe('hsjo]lj React')
  })

  it('still writes after blur if the snapshot is valid', () => {
    const input = valueField('hsjo]lj ')
    const snapshot = captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8)
    input.blur()
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('written')
    expect(input.value).toBe('استخدمت ')
  })
})

describe('contenteditable', () => {
  it('replaces across multiple text nodes', () => {
    const root = document.createElement('div')
    root.contentEditable = 'true'
    root.append('he', document.createTextNode('llo '), document.createTextNode('hsjo]lj'))
    document.body.append(root)
    expect(readFieldText(root)).toBe('hello hsjo]lj')
    const snapshot = captureSnapshot(root, 'contenteditable', 'hsjo]lj', 6, 13, 13)
    expect(commitReplacement(snapshot, 'استخدمت')).toBe('written')
    expect(readFieldText(root)).toBe('hello استخدمت')
  })
})

describe('undo contract', () => {
  it('records a single insertReplacementText step and does not use a custom stack', () => {
    const input = valueField('hsjo]lj ')
    let inputType = ''
    input.addEventListener('input', (event) => {
      inputType = (event as InputEvent).inputType
    })
    commitReplacement(captureSnapshot(input, 'value', 'hsjo]lj', 0, 7, 8), 'استخدمت')
    expect(inputType).toBe('insertReplacementText')
    expect(currentGeneration(new WeakMap(), input)).toBe(0)
  })
})
