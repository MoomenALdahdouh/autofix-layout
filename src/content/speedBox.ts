import { LAYOUT_COPY, MANUAL_CONVERTER_SHORTCUT } from '../brand.ts'
import { copyText } from '../copyText.ts'
import {
  convertManualText,
  allConverterLayouts,
  resolveConverterPair,
  swapConverterPair,
  type ConverterPair,
} from '../layouts/convert.ts'
import { getLayout } from '../layouts/registry.ts'
import type { LayoutId, UserLayoutProfile } from '../layouts/types.ts'
import styles from './speedBox.css?raw'

export const SPEED_BOX_HOST_ID = 'autofix-speed-box'
export const SPEED_BOX_SHORTCUT = MANUAL_CONVERTER_SHORTCUT

export type SpeedBoxProfile = UserLayoutProfile & {
  manualConversionEnabled: boolean
}

export type SpeedBox = {
  isOpen(): boolean
  ownsEvent(event: Event): boolean
  open(): boolean
  close(): void
  toggle(): boolean
  sync(): void
  destroy(): void
}

type RestoredFocus = {
  element: HTMLElement
  start: number | null
  end: number | null
}

export function isSpeedBoxShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat || event.key === 'Process') return false
  if (event.code !== 'KeyL') return false
  const modifier = event.metaKey || event.ctrlKey
  return modifier && event.shiftKey && !event.altKey
}

export function speedBoxShortcutHint(platform = navigator.platform): string {
  return /mac/i.test(platform) ? '⌘⇧L' : 'Ctrl+Shift+L'
}

function optionLabel(id: LayoutId): string {
  const layout = getLayout(id)
  const copy = LAYOUT_COPY[id]
  const language = copy?.title ?? layout?.language ?? id
  const name = layout?.name ?? id
  return `${language} — ${name}`
}

function asLayoutId(value: string): LayoutId {
  return value as LayoutId
}

export function createSpeedBox(options: {
  getProfile: () => SpeedBoxProfile
}): SpeedBox {
  let host: HTMLElement | null = null
  let shadow: ShadowRoot | null = null
  let open = false
  let pair: ConverterPair | null = null
  let restored: RestoredFocus | null = null

  function profile(): SpeedBoxProfile {
    return options.getProfile()
  }

  function layoutProfile(): UserLayoutProfile {
    const current = profile()
    return {
      sourceLayout: current.sourceLayout,
      enabledLayouts: current.enabledLayouts,
    }
  }

  function resolved(): ConverterPair {
    return resolveConverterPair(layoutProfile(), pair ?? undefined)
  }

  function inputEl(): HTMLTextAreaElement | null {
    return shadow?.querySelector<HTMLTextAreaElement>('[data-autofix="speed-input"]') ?? null
  }

  function outputEl(): HTMLButtonElement | null {
    return shadow?.querySelector<HTMLButtonElement>('[data-autofix="speed-output"]') ?? null
  }

  function outputTextEl(): HTMLElement | null {
    return shadow?.querySelector<HTMLElement>('[data-autofix="speed-result-text"]') ?? null
  }

  function outputHintEl(): HTMLElement | null {
    return shadow?.querySelector<HTMLElement>('[data-autofix="speed-result-hint"]') ?? null
  }

  function sourceEl(): HTMLSelectElement | null {
    return shadow?.querySelector<HTMLSelectElement>('[data-autofix="speed-source"]') ?? null
  }

  function targetEl(): HTMLSelectElement | null {
    return shadow?.querySelector<HTMLSelectElement>('[data-autofix="speed-target"]') ?? null
  }

  function unavailableEl(): HTMLElement | null {
    return shadow?.querySelector<HTMLElement>('[data-autofix="speed-unavailable"]') ?? null
  }

  function captureFocus(): RestoredFocus | null {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active === host) return null
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return { element: active, start: active.selectionStart, end: active.selectionEnd }
    }
    return { element: active, start: null, end: null }
  }

  function restoreFocus(): void {
    const saved = restored
    restored = null
    if (!saved || !saved.element.isConnected) return
    saved.element.focus()
    if (
      saved.start != null &&
      saved.end != null &&
      (saved.element instanceof HTMLInputElement ||
        saved.element instanceof HTMLTextAreaElement)
    ) {
      try {
        saved.element.setSelectionRange(saved.start, saved.end)
      } catch {
        // Some input types reject selection ranges.
      }
    }
  }

  function ensureHost(): ShadowRoot {
    if (host && shadow && host.isConnected) return shadow
    host = document.createElement('div')
    host.id = SPEED_BOX_HOST_ID
    host.setAttribute('data-autofix-speed-box', '')
    shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = `<style>${styles}</style>
      <div class="backdrop" data-autofix="speed-backdrop"></div>
      <div
        class="panel"
        data-autofix="speed-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="autofix-speed-title"
        aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
      >
        <div class="header">
          <p class="title" id="autofix-speed-title">Manual conversion</p>
          <p class="shortcut">${speedBoxShortcutHint()} · Esc</p>
        </div>
        <p class="hint">Same physical keys, chosen layouts. Not a translator.</p>
        <div class="pair">
          <label class="select">
            <span>Source keyboard layout</span>
            <select data-autofix="speed-source" id="autofix-speed-source"></select>
          </label>
          <button type="button" class="swap" data-autofix="speed-swap" aria-label="Swap keyboard layouts">⇄</button>
          <label class="select">
            <span>Target keyboard layout</span>
            <select data-autofix="speed-target" id="autofix-speed-target"></select>
          </label>
        </div>
        <label class="field">
          <span>Text to convert</span>
          <textarea
            data-autofix="speed-input"
            id="autofix-speed-input"
            rows="3"
            spellcheck="false"
            autocomplete="off"
            dir="auto"
            placeholder="Paste or type wrong-layout text"
          ></textarea>
        </label>
        <button
          type="button"
          class="result"
          data-autofix="speed-output"
          hidden
          title="Click to copy"
          aria-label="Copy converted text"
        >
          <span class="result-text" data-autofix="speed-result-text" dir="auto"></span>
          <span class="result-hint" data-autofix="speed-result-hint">Click to copy</span>
        </button>
        <p class="unavailable" data-autofix="speed-unavailable" hidden>
          Conversion unavailable for this layout pair.
        </p>
      </div>
    `
    shadow.querySelector('[data-autofix="speed-backdrop"]')?.addEventListener('pointerdown', () => {
      close()
    })
    sourceEl()?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      pair = resolveConverterPair(layoutProfile(), {
        ...resolved(),
        sourceLayout: asLayoutId(value),
      })
      refresh()
    })
    targetEl()?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value
      pair = resolveConverterPair(layoutProfile(), {
        ...resolved(),
        targetLayout: asLayoutId(value),
      })
      refresh()
    })
    shadow.querySelector('[data-autofix="speed-swap"]')?.addEventListener('click', () => {
      pair = swapConverterPair(resolved())
      refresh()
    })
    inputEl()?.addEventListener('input', () => {
      refreshOutput()
    })
    outputEl()?.addEventListener('click', () => {
      void copyCurrentResult()
    })
    const root = document.body ?? document.documentElement
    root.append(host)
    return shadow
  }

  function fillSelect(select: HTMLSelectElement | null, selected: LayoutId): void {
    if (!select) return
    const choices = allConverterLayouts()
    select.replaceChildren()
    for (const id of choices) {
      const option = document.createElement('option')
      option.value = id
      option.textContent = optionLabel(id)
      select.append(option)
    }
    select.value = choices.includes(selected) ? selected : (choices[0] ?? '')
  }

  function setResultHint(text: string): void {
    const hint = outputHintEl()
    if (hint) hint.textContent = text
  }

  async function copyCurrentResult(): Promise<void> {
    const text = outputTextEl()?.textContent ?? ''
    if (!text) return
    const ok = await copyText(text)
    if (!ok) return
    setResultHint('Copied')
    window.setTimeout(() => setResultHint('Click to copy'), 1500)
  }

  function refreshOutput(): void {
    const input = inputEl()
    const output = outputEl()
    const textEl = outputTextEl()
    const notice = unavailableEl()
    if (!input || !output || !textEl || !notice) return
    const current = resolved()
    const result = convertManualText(input.value, current.sourceLayout, current.targetLayout)
    const converted = result.ok ? result.text : ''
    const show = input.value.trim().length > 0 && converted.length > 0
    textEl.textContent = converted
    output.hidden = !show
    setResultHint('Click to copy')
    notice.hidden = result.ok
  }

  function refresh(): void {
    const current = resolved()
    pair = current
    fillSelect(sourceEl(), current.sourceLayout)
    fillSelect(targetEl(), current.targetLayout)
    refreshOutput()
  }

  function openBox(): boolean {
    if (!profile().manualConversionEnabled) return false
    ensureHost()
    if (!open) {
      restored = captureFocus()
      pair = resolveConverterPair(layoutProfile())
      const input = inputEl()
      if (input) input.value = ''
      refresh()
      host!.hidden = false
      open = true
    } else {
      refresh()
    }
    queueMicrotask(() => inputEl()?.focus())
    return true
  }

  function close(): void {
    if (!open) return
    open = false
    const input = inputEl()
    const output = outputEl()
    if (input) input.value = ''
    if (output) {
      output.hidden = true
      const textEl = outputTextEl()
      if (textEl) textEl.textContent = ''
      setResultHint('Click to copy')
    }
    pair = null
    if (host) host.hidden = true
    restoreFocus()
  }

  function toggle(): boolean {
    if (open) {
      close()
      return false
    }
    return openBox()
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.key === 'Process') return
    if (isSpeedBoxShortcut(event)) {
      if (!profile().manualConversionEnabled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      toggle()
      return
    }
    if (open && event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
  }

  window.addEventListener('keydown', onWindowKeyDown, true)

  return {
    isOpen(): boolean {
      return open
    },
    ownsEvent(event: Event): boolean {
      return host != null && event.composedPath().includes(host)
    },
    open: openBox,
    close,
    toggle,
    sync(): void {
      if (!profile().manualConversionEnabled) {
        close()
        return
      }
      if (open) refresh()
    },
    destroy(): void {
      window.removeEventListener('keydown', onWindowKeyDown, true)
      close()
      host?.remove()
      host = null
      shadow = null
    },
  }
}
