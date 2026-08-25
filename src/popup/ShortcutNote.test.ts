import { describe, expect, it } from 'vitest'
import { shortcutChord, usesCommandKey } from './shortcutLabels.ts'

describe('shortcut note labels', () => {
  it('uses Command on macOS and Ctrl elsewhere', () => {
    expect(usesCommandKey('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel')).toBe(
      true,
    )
    expect(usesCommandKey('Mozilla/5.0 Chrome/120', 'Win32')).toBe(false)
    expect(shortcutChord('⌘⇧P', 'Ctrl+Shift+P', true)).toBe('⌘⇧P')
    expect(shortcutChord('⌘⇧P', 'Ctrl+Shift+P', false)).toBe('Ctrl+Shift+P')
  })
})
