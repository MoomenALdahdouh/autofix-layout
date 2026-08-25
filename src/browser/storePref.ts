export type StoreButton = 'chrome' | 'edge'

export type UserAgentBrand = {
  brand: string
}

/**
 * Prefer Client Hints brands over the User-Agent string.
 * Edge typically reports "Microsoft Edge"; Chrome reports "Google Chrome".
 * Unknown or missing brands → show both store buttons.
 */
export function preferredStoreButtons(
  brands: readonly UserAgentBrand[] | undefined,
): StoreButton[] {
  const names = (brands ?? []).map((item) => item.brand)
  const isEdge = names.some((name) => /Microsoft Edge/i.test(name))
  const isChrome = names.some((name) => name === 'Google Chrome')
  if (isEdge) return ['edge', 'chrome']
  if (isChrome) return ['chrome', 'edge']
  return ['chrome', 'edge']
}
