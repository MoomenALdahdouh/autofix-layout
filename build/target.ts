export type ExtensionBrowser = 'chrome' | 'edge'

export type ExtensionTarget = {
  browser: ExtensionBrowser
  outDir: string
  /** Same product name on both stores. */
  name: 'Layfix'
}

const TARGETS: Record<ExtensionBrowser, ExtensionTarget> = {
  chrome: { browser: 'chrome', outDir: 'dist/chrome', name: 'Layfix' },
  edge: { browser: 'edge', outDir: 'dist/edge', name: 'Layfix' },
}

export function resolveExtensionBrowser(raw: string | undefined): ExtensionBrowser {
  const value = (raw ?? 'chrome').trim().toLowerCase()
  if (value === 'edge') return 'edge'
  if (value === 'chrome' || value === '') return 'chrome'
  throw new Error(`Unknown LAYFIX_BROWSER "${raw}". Use chrome or edge.`)
}

export function extensionTarget(raw?: string): ExtensionTarget {
  return TARGETS[resolveExtensionBrowser(raw)]
}

/**
 * Manifest stays Manifest V3 for both browsers.
 * Edge desktop uses the Chromium extension model; no MV2 and no rename.
 */
export function manifestForTarget(
  base: Record<string, unknown>,
  browser: ExtensionBrowser,
): Record<string, unknown> {
  const target = TARGETS[browser]
  return {
    ...base,
    name: target.name,
    manifest_version: 3,
  }
}
