import { DIRECT_SHORTCUT_COMMAND } from '../brand.ts'
import { extensionApi } from '../browser/extensionApi.ts'

export { DIRECT_SHORTCUT_COMMAND }

export type CommandDispatch = 'sent' | 'noop'

/**
 * Browser Commands API → active tab. The service worker never receives
 * field text. A missing tab or content script is a silent no-op.
 */
export async function sendFixCurrentTextToActiveTab(
  api: Pick<typeof chrome, 'tabs'> = extensionApi(),
): Promise<CommandDispatch> {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true })
    const tabId = tabs[0]?.id
    if (tabId == null) return 'noop'
    await api.tabs.sendMessage(tabId, { type: 'FIX_CURRENT_TEXT' })
    return 'sent'
  } catch {
    return 'noop'
  }
}

export function isFixCurrentTextCommand(command: string): boolean {
  return command === DIRECT_SHORTCUT_COMMAND
}

export function readAssignedShortcut(
  commands: Array<{ name?: string; shortcut?: string }>,
  name = DIRECT_SHORTCUT_COMMAND,
): string {
  return commands.find((item) => item.name === name)?.shortcut ?? ''
}

export function displayCommandShortcut(shortcut: string): string {
  if (!shortcut) return ''
  return shortcut.replace(/Period/g, '.').replace(/Comma/g, ',')
}

export function extensionShortcutsPage(userAgent = ''): string {
  return /Edg\//i.test(userAgent) ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts'
}

export function shouldClassifyForShortcut(input: {
  automaticActive: boolean
  explicit: boolean
  excepted: boolean
}): boolean {
  if (input.excepted) return false
  return input.automaticActive || input.explicit
}
