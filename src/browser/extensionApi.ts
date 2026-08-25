/**
 * Chrome and Microsoft Edge both expose the Chromium `chrome.*` namespace.
 * Do not branch product logic on browser name. Call this only when a
 * missing API should be treated as "extension context unavailable".
 */
export function extensionApi(): typeof chrome {
  const api = globalThis.chrome
  if (!api?.runtime) {
    throw new Error('Chromium extension API is not available')
  }
  return api
}

/** APIs this product actually uses. Edge desktop implements each of these. */
export const REQUIRED_CHROMIUM_EXTENSION_APIS = [
  'runtime.sendMessage',
  'runtime.onMessage',
  'runtime.onInstalled',
  'runtime.onStartup',
  'runtime.onConnect',
  'runtime.connect',
  'runtime.openOptionsPage',
  'runtime.id',
  'storage.local',
  'storage.sync',
  'storage.onChanged',
  'tabs.query',
  'tabs.create',
  'tabs.sendMessage',
  'commands.getAll',
  'commands.onCommand',
] as const
