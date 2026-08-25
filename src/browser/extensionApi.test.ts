import { describe, expect, it } from 'vitest'
import { REQUIRED_CHROMIUM_EXTENSION_APIS, extensionApi } from './extensionApi.ts'

describe('extension API compatibility', () => {
  it('lists only Chromium APIs that Edge desktop also implements', () => {
    expect(REQUIRED_CHROMIUM_EXTENSION_APIS.length).toBeGreaterThan(0)
    expect(REQUIRED_CHROMIUM_EXTENSION_APIS.join(' ')).not.toMatch(
      /sidePanel|offscreen|debugger|userAgent/,
    )
  })

  it('resolves chrome.* when the test environment provides it', () => {
    const previous = globalThis.chrome
    globalThis.chrome = { runtime: { id: 'test' } } as typeof chrome
    try {
      expect(extensionApi().runtime.id).toBe('test')
    } finally {
      globalThis.chrome = previous
    }
  })

  it('fails closed when the extension API is missing', () => {
    const previous = globalThis.chrome
    globalThis.chrome = undefined as unknown as typeof chrome
    try {
      expect(() => extensionApi()).toThrow(/not available/)
    } finally {
      globalThis.chrome = previous
    }
  })
})
