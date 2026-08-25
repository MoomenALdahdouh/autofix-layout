import { extensionApi } from './browser/extensionApi.ts'

export function isExtensionAlive(): boolean {
  try {
    return Boolean(extensionApi().runtime?.id)
  } catch {
    return false
  }
}

export function isContextInvalidated(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Extension context invalidated')
}
