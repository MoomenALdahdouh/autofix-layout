import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json' with { type: 'json' }
import { DIRECT_SHORTCUT_COMMAND, MANUAL_CONVERTER_SHORTCUT } from '../brand.ts'
import {
  displayCommandShortcut,
  extensionShortcutsPage,
  isFixCurrentTextCommand,
  readAssignedShortcut,
  sendFixCurrentTextToActiveTab,
  shouldClassifyForShortcut,
} from './commands.ts'

describe('command registration', () => {
  it('registers FIX_CURRENT_TEXT in the shared Manifest V3 commands block', () => {
    const command = manifest.commands.FIX_CURRENT_TEXT
    expect(command.suggested_key.default).toBe('Ctrl+Shift+P')
    expect(command.suggested_key.mac).toBe('Command+Shift+P')
    expect(command.description).toMatch(/Fix selected or current text/)
    expect(DIRECT_SHORTCUT_COMMAND).toBe('FIX_CURRENT_TEXT')
  })

  it('does not reuse the manual converter KeyL shortcut', () => {
    expect(MANUAL_CONVERTER_SHORTCUT).toMatch(/Shift\+L/)
    expect(manifest.commands.FIX_CURRENT_TEXT.suggested_key.default).not.toMatch(/L$/)
    expect(manifest.commands.FIX_CURRENT_TEXT.suggested_key.default).toBe(
      'Ctrl+Shift+P',
    )
  })
})

describe('service-worker command dispatch', () => {
  it('sends FIX_CURRENT_TEXT to the active tab and no field text', async () => {
    const sent: unknown[] = []
    const api = {
      tabs: {
        query: async () => [{ id: 9 }],
        sendMessage: async (tabId: number, message: unknown) => {
          sent.push({ tabId, message })
        },
      },
    }
    await expect(
      sendFixCurrentTextToActiveTab(api as unknown as typeof chrome),
    ).resolves.toBe('sent')
    expect(sent).toEqual([{ tabId: 9, message: { type: 'FIX_CURRENT_TEXT' } }])
  })

  it('is a no-op when there is no tab or the content script is missing', async () => {
    await expect(
      sendFixCurrentTextToActiveTab({
        tabs: {
          query: async () => [],
          sendMessage: async () => undefined,
        },
      } as unknown as typeof chrome),
    ).resolves.toBe('noop')

    await expect(
      sendFixCurrentTextToActiveTab({
        tabs: {
          query: async () => [{ id: 3 }],
          sendMessage: async () => {
            throw new Error('Receiving end does not exist')
          },
        },
      } as unknown as typeof chrome),
    ).resolves.toBe('noop')
  })

  it('ignores other command names', () => {
    expect(isFixCurrentTextCommand('FIX_CURRENT_TEXT')).toBe(true)
    expect(isFixCurrentTextCommand('open-popup')).toBe(false)
  })
})

describe('shortcut assignment states', () => {
  it('reads assigned, empty, and missing commands', () => {
    expect(
      readAssignedShortcut([{ name: 'FIX_CURRENT_TEXT', shortcut: 'Ctrl+Shift+P' }]),
    ).toBe('Ctrl+Shift+P')
    expect(readAssignedShortcut([{ name: 'FIX_CURRENT_TEXT', shortcut: '' }])).toBe('')
    expect(readAssignedShortcut([])).toBe('')
    expect(displayCommandShortcut('Ctrl+Shift+P')).toBe('Ctrl+Shift+P')
    expect(displayCommandShortcut('Ctrl+Shift+Period')).toBe('Ctrl+Shift+.')
  })

  it('points Chrome and Edge at the official shortcut settings page', () => {
    expect(extensionShortcutsPage('Mozilla/5.0 Chrome/120')).toBe(
      'chrome://extensions/shortcuts',
    )
    expect(extensionShortcutsPage('Mozilla/5.0 Edg/14.0')).toBe(
      'edge://extensions/shortcuts',
    )
  })
})

describe('CHECK_WORD independence', () => {
  it('allows an explicit shortcut classify when automatic correction is off', () => {
    expect(
      shouldClassifyForShortcut({
        automaticActive: false,
        explicit: true,
        excepted: false,
      }),
    ).toBe(true)
    expect(
      shouldClassifyForShortcut({
        automaticActive: false,
        explicit: false,
        excepted: false,
      }),
    ).toBe(false)
    expect(
      shouldClassifyForShortcut({
        automaticActive: true,
        explicit: false,
        excepted: true,
      }),
    ).toBe(false)
  })
})
