/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './copyText.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('copyText', () => {
  it('writes through the clipboard API on a user gesture path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('استخدمت')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('استخدمت')
  })

  it('falls back to a hidden selection copy when the clipboard API is blocked', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('blocked')),
      },
    })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: exec,
    })
    await expect(copyText('hsjo]lj')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('does not copy empty text', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
