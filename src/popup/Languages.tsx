import { useState } from 'react'
import { LAYOUT_COPY } from '../brand.ts'
import type { LayoutId } from '../layouts/types.ts'
import type { ExtensionStatus } from '../messaging.ts'

type Props = {
  status: ExtensionStatus
  onToggle: (id: LayoutId) => void
}

export function Languages({ status, onToggle }: Props) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const selected = status.profile.enabledLayouts
    .map((id) => status.layouts.find((layout) => layout.id === id))
    .filter((layout): layout is ExtensionStatus['layouts'][number] => layout != null)
  const available = status.layouts.filter((layout) => !selected.some((item) => item.id === layout.id))
  const filtered = available.filter((layout) => {
    const copy = LAYOUT_COPY[layout.id]
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [copy?.title, copy?.native, layout.name, layout.language]
      .filter(Boolean)
      .some((part) => String(part).toLowerCase().includes(q))
  })
  const needsSecond = status.profile.enabledLayouts.length < 2

  return (
    <section className="block card-block">
      <div className="card-head">
        <h2>Your keyboards</h2>
        <p>
          {needsSecond
            ? 'Add the other layout you type with. Convert and auto-fix need two.'
            : 'These are the layouts Convert and auto-fix switch between.'}
        </p>
      </div>
      <ul className="lang-list">
        {selected.map((layout) => {
          const copy = LAYOUT_COPY[layout.id]
          const source = layout.id === status.profile.sourceLayout
          return (
            <li key={layout.id} className={`lang ${source ? 'locked' : ''}`}>
              <span className="lang-copy">
                <strong>{copy?.title ?? layout.name}</strong>
                <span dir="auto">{copy?.native ?? layout.language}</span>
              </span>
              {source ? (
                <span className="lang-lock">Always on</span>
              ) : (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${copy?.title ?? layout.name}`}
                  onClick={() => onToggle(layout.id)}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {available.length ? (
        adding ? (
          <div className="add-panel">
            <input
              className="field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search keyboards"
              aria-label="Search keyboards"
              autoComplete="off"
            />
            <ul className="add-list" role="listbox" aria-label="Add a keyboard">
              {filtered.map((layout) => {
                const copy = LAYOUT_COPY[layout.id]
                return (
                  <li key={layout.id}>
                    <button
                      type="button"
                      className="add-option"
                      onClick={() => {
                        onToggle(layout.id)
                        setAdding(false)
                        setQuery('')
                      }}
                    >
                      <strong>{copy?.title ?? layout.name}</strong>
                      <span dir="auto">{copy?.native ?? layout.language}</span>
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 ? <li className="hint">No matching keyboard.</li> : null}
            </ul>
            <button type="button" className="quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="quiet" onClick={() => setAdding(true)}>
            + Add keyboard
          </button>
        )
      ) : null}
    </section>
  )
}
