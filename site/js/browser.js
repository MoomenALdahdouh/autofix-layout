/**
 * Store-button preference from User-Agent Client Hints brands.
 * Keep in sync with src/browser/storePref.ts
 */
export function preferredStoreButtons(brands) {
  const names = (brands ?? []).map((item) => item.brand)
  const isEdge = names.some((name) => /Microsoft Edge/i.test(name))
  const isChrome = names.some((name) => name === 'Google Chrome')
  if (isEdge) return ['edge', 'chrome']
  if (isChrome) return ['chrome', 'edge']
  return ['chrome', 'edge']
}

export function clientHintBrands() {
  return navigator.userAgentData?.brands
}
