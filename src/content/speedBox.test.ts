/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MANUAL_CONVERTER_SHORTCUT } from '../brand.ts'
import { convertManualText } from '../layouts/convert.ts'
import { DEFAULT_USER_PROFILE } from '../profile/index.ts'
import {
  SPEED_BOX_HOST_ID,
  SPEED_BOX_SHORTCUT,
  createSpeedBox,
  isSpeedBoxShortcut,
  speedBoxShortcutHint,
  type SpeedBox,
  type SpeedBoxProfile,
} from './speedBox.ts'

function shortcutEvent(
  init: KeyboardEventInit & { isComposing?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'l',
    code: 'KeyL',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  })
}

function pageField(value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value
  document.body.append(input)
  input.focus()
  input.setSelectionRange(value.length, value.length)
  return input
}

function profile(overrides: Partial<SpeedBoxProfile> = {}): SpeedBoxProfile {
  return {
    sourceLayout: DEFAULT_USER_PROFILE.sourceLayout,
    enabledLayouts: [...DEFAULT_USER_PROFILE.enabledLayouts],
    manualConversionEnabled: true,
    ...overrides,
  }
}

function host(): HTMLElement | null {
  return document.getElementById(SPEED_BOX_HOST_ID)
}

function shadowPart<T extends Element>(selector: string): T | null {
  return host()?.shadowRoot?.querySelector<T>(selector) ?? null
}

describe('speed box shortcut', () => {
  it('matches Ctrl/⌘+Shift+L on the physical L key, including other layouts', () => {
    expect(isSpeedBoxShortcut(shortcutEvent())).toBe(true)
    expect(isSpeedBoxShortcut(shortcutEvent({ metaKey: true, ctrlKey: false }))).toBe(
      true,
    )
    expect(isSpeedBoxShortcut(shortcutEvent({ key: 'م' }))).toBe(true)
    expect(isSpeedBoxShortcut(shortcutEvent({ key: 'д' }))).toBe(true)
    expect(SPEED_BOX_SHORTCUT).toBe(MANUAL_CONVERTER_SHORTCUT)
    expect(speedBoxShortcutHint('MacIntel')).toBe('⌘⇧L')
    expect(speedBoxShortcutHint('Win32')).toBe('Ctrl+Shift+L')
  })

  it('does not steal ordinary typing or IME composition', () => {
    expect(
      isSpeedBoxShortcut(
        new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true }),
      ),
    ).toBe(false)
    expect(isSpeedBoxShortcut(shortcutEvent({ shiftKey: false }))).toBe(false)
    expect(isSpeedBoxShortcut(shortcutEvent({ altKey: true }))).toBe(false)
    expect(isSpeedBoxShortcut(shortcutEvent({ isComposing: true }))).toBe(false)
    expect(isSpeedBoxShortcut(shortcutEvent({ repeat: true }))).toBe(false)
  })
})

describe('speed box overlay', () => {
  let box: SpeedBox | undefined

  afterEach(() => {
    box?.destroy()
    box = undefined
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('does not open when manual conversion is off', () => {
    box = createSpeedBox({
      getProfile: () => profile({ manualConversionEnabled: false }),
    })
    expect(box.open()).toBe(false)
    expect(box.isOpen()).toBe(false)
    window.dispatchEvent(shortcutEvent())
    expect(box.isOpen()).toBe(false)
    expect(host()).toBeNull()
  })

  it('opens from the shortcut and converts with the same deterministic engine', async () => {
    box = createSpeedBox({ getProfile: () => profile() })
    window.dispatchEvent(shortcutEvent())
    expect(box.isOpen()).toBe(true)

    const input = shadowPart<HTMLTextAreaElement>('[data-autofix="speed-input"]')
    const output = shadowPart<HTMLButtonElement>('[data-autofix="speed-output"]')
    const outputText = shadowPart<HTMLElement>('[data-autofix="speed-result-text"]')
    expect(input).toBeTruthy()
    expect(output).toBeTruthy()
    expect(input?.getAttribute('placeholder')).toBe('Paste or type wrong-layout text')
    expect(output?.hidden).toBe(true)

    input!.value = 'hsjo]lj'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    const expected = convertManualText('hsjo]lj', 'en-US-qwerty', 'ar-101')
    expect(expected).toEqual({ ok: true, text: 'استخدمت' })
    expect(output!.hidden).toBe(false)
    expect(outputText!.textContent).toBe(expected.text)
    expect(outputText!.textContent).not.toBe('مرحبا')

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    output!.click()
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('استخدمت')
      expect(shadowPart<HTMLElement>('[data-autofix="speed-result-hint"]')!.textContent).toBe(
        'Copied',
      )
    })
  })

  it('does not write the page field when opened or used', () => {
    const page = pageField('hsjo]lj ')
    box = createSpeedBox({ getProfile: () => profile() })
    expect(box.open()).toBe(true)

    const input = shadowPart<HTMLTextAreaElement>('[data-autofix="speed-input"]')
    input!.value = 'hsjo]lj'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(shadowPart<HTMLElement>('[data-autofix="speed-result-text"]')!.textContent).toBe(
      'استخدمت',
    )
    expect(page.value).toBe('hsjo]lj ')

    box.close()
    expect(page.value).toBe('hsjo]lj ')
    expect(document.activeElement).toBe(page)
  })

  it('closes on Escape and discards ephemeral text', () => {
    box = createSpeedBox({ getProfile: () => profile() })
    box.open()
    const input = shadowPart<HTMLTextAreaElement>('[data-autofix="speed-input"]')
    input!.value = 'hsjo]lj'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    expect(box.isOpen()).toBe(false)
    box.open()
    expect(shadowPart<HTMLTextAreaElement>('[data-autofix="speed-input"]')!.value).toBe(
      '',
    )
    expect(shadowPart<HTMLButtonElement>('[data-autofix="speed-output"]')!.hidden).toBe(
      true,
    )
    expect(shadowPart<HTMLElement>('[data-autofix="speed-result-text"]')!.textContent).toBe(
      '',
    )
  })

  it('closes when the profile turns manual conversion off', () => {
    let enabled = true
    box = createSpeedBox({
      getProfile: () => profile({ manualConversionEnabled: enabled }),
    })
    box.open()
    expect(box.isOpen()).toBe(true)
    enabled = false
    box.sync()
    expect(box.isOpen()).toBe(false)
  })
})
