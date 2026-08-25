import { displayCommandShortcut } from '../background/commands.ts'
import { DIRECT_SHORTCUT_DEFAULT_HINT } from '../brand.ts'

export function usesCommandKey(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): boolean {
  return /Mac|iPhone|iPad/i.test(platform) || /Mac OS X/i.test(userAgent)
}

export function shortcutChord(mac: string, windows: string, command = false): string {
  return command ? mac : windows
}

export function popupShortcutLabels(assignedShortcut = ''): {
  auto: readonly string[]
  fix: string
  converter: string
  fixAssigned: boolean
  suggested: string
} {
  const command = usesCommandKey()
  const assigned = displayCommandShortcut(assignedShortcut)
  return {
    auto: ['Space', 'Enter', 'Tab'],
    fix: assigned || shortcutChord('⌘⇧P', 'Ctrl+Shift+P', command),
    converter: shortcutChord('⌘⇧L', 'Ctrl+Shift+L', command),
    fixAssigned: Boolean(assigned),
    suggested: DIRECT_SHORTCUT_DEFAULT_HINT,
  }
}
