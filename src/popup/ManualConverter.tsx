import { useState } from 'react'
import { LAYOUT_COPY } from '../brand.ts'
import { copyText } from '../copyText.ts'
import {
  convertManualText,
  resolveConverterPair,
  swapConverterPair,
  type ConverterPair,
} from '../layouts/convert.ts'
import { getSupportedLayouts } from '../layouts/registry.ts'
import type { LayoutId, UserLayoutProfile } from '../layouts/types.ts'
import { Switch } from '../ui/Switch.tsx'
import { KeyChips } from './KeyChips.tsx'

type LayoutOption = {
  id: LayoutId
  name: string
  language: string
}

type Props = {
  profile: UserLayoutProfile
  layouts: LayoutOption[]
  enabled: boolean
  shortcutHint: string
  onToggle: () => void
}

function optionLabel(layout: LayoutOption): string {
  const copy = LAYOUT_COPY[layout.id]
  return copy?.title ?? copy?.native ?? layout.language
}

export function ManualConverter({
  profile,
  layouts,
  enabled,
  shortcutHint,
  onToggle,
}: Props) {
  const [pair, setPair] = useState<ConverterPair | null>(null)
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState(false)
  const resolved = resolveConverterPair(profile, pair ?? undefined)

  const catalog = layouts.length
    ? layouts
    : getSupportedLayouts().map((layout) => ({
        id: layout.id,
        name: layout.name,
        language: layout.language,
      }))

  const choices = catalog

  const result = convertManualText(input, resolved.sourceLayout, resolved.targetLayout)
  const converted = result.ok ? result.text : ''
  const showResult = input.trim().length > 0 && converted.length > 0
  const ready = choices.length >= 2

  function onSource(id: LayoutId): void {
    setPair(resolveConverterPair(profile, { ...resolved, sourceLayout: id }))
  }

  function onTarget(id: LayoutId): void {
    setPair(resolveConverterPair(profile, { ...resolved, targetLayout: id }))
  }

  async function onCopyResult(): Promise<void> {
    if (!converted) return
    const ok = await copyText(converted)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="converter converter-hero">
      <div className="converter-head">
        <div>
          <h2>Convert text</h2>
          <p>Paste text typed on the wrong keyboard. Click the result to copy.</p>
        </div>
        <Switch checked={enabled} label="Manual converter" onToggle={onToggle} />
      </div>

      {enabled ? (
        ready ? (
          <>
            <div className="converter-pair">
              <label className="converter-select" htmlFor="converter-source">
                <span>Typed on</span>
                <select
                  id="converter-source"
                  value={resolved.sourceLayout}
                  onChange={(event) => onSource(event.target.value as LayoutId)}
                >
                  {choices.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {optionLabel(layout)}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="converter-swap"
                aria-label="Swap keyboard layouts"
                title="Swap"
                onClick={() => setPair(swapConverterPair(resolved))}
              >
                ⇄
              </button>

              <label className="converter-select" htmlFor="converter-target">
                <span>Read as</span>
                <select
                  id="converter-target"
                  value={resolved.targetLayout}
                  onChange={(event) => onTarget(event.target.value as LayoutId)}
                >
                  {choices
                    .filter((layout) => layout.id !== resolved.sourceLayout)
                    .map((layout) => (
                      <option key={layout.id} value={layout.id}>
                        {optionLabel(layout)}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <label className="converter-field" htmlFor="converter-input">
              <span className="sr-only">Text to convert</span>
              <textarea
                id="converter-input"
                value={input}
                onChange={(event) => {
                  setCopied(false)
                  setInput(event.target.value)
                }}
                placeholder="Type or paste here"
                rows={3}
                spellCheck={false}
                autoComplete="off"
                autoFocus
                dir="auto"
              />
            </label>

            {showResult ? (
              <button
                type="button"
                className="converter-result"
                onClick={() => void onCopyResult()}
                title="Click to copy"
                aria-label="Converted text, click to copy"
              >
                <span className="converter-result-text" dir="auto">
                  {converted}
                </span>
                <span className="converter-result-hint">{copied ? 'Copied' : 'Click to copy'}</span>
              </button>
            ) : null}

            {!result.ok ? <p className="error">This keyboard pair can’t be converted.</p> : null}

            <p className="converter-shortcut">
              Same convert on a page
              <KeyChips keys={[shortcutHint]} />
            </p>
          </>
        ) : (
          <p className="converter-off">
            Add a second keyboard below, then convert between them here.
          </p>
        )
      ) : (
        <p className="converter-off">
          Turn on to convert here or on a page with <KeyChips keys={[shortcutHint]} />
        </p>
      )}
    </section>
  )
}
