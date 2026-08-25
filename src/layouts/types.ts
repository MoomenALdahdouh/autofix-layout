export type PhysicalKeyId =
  | 'Backquote'
  | 'Digit1'
  | 'Digit2'
  | 'Digit3'
  | 'Digit4'
  | 'Digit5'
  | 'Digit6'
  | 'Digit7'
  | 'Digit8'
  | 'Digit9'
  | 'Digit0'
  | 'Minus'
  | 'Equal'
  | 'KeyQ'
  | 'KeyW'
  | 'KeyE'
  | 'KeyR'
  | 'KeyT'
  | 'KeyY'
  | 'KeyU'
  | 'KeyI'
  | 'KeyO'
  | 'KeyP'
  | 'BracketLeft'
  | 'BracketRight'
  | 'KeyA'
  | 'KeyS'
  | 'KeyD'
  | 'KeyF'
  | 'KeyG'
  | 'KeyH'
  | 'KeyJ'
  | 'KeyK'
  | 'KeyL'
  | 'Semicolon'
  | 'Quote'
  | 'KeyZ'
  | 'KeyX'
  | 'KeyC'
  | 'KeyV'
  | 'KeyB'
  | 'KeyN'
  | 'KeyM'
  | 'Comma'
  | 'Period'
  | 'Slash'

export type KeyLevel = 'unshifted' | 'shifted' | 'altGr'

export type KeyOutput = {
  unshifted: string
  shifted: string
  altGr?: string
}

export const LAYOUT_IDS = [
  'en-US-qwerty',
  'ar-101',
  'ru-standard',
  'de-qwertz',
  'fr-azerty',
  'tr-q',
  'he-standard',
  'el-standard',
  'es-latam',
  'it-standard',
  'pt-abnt',
  'uk-standard',
  'fa-standard',
] as const

export type LayoutId = (typeof LAYOUT_IDS)[number]

export type LayoutMetadata = {
  direction: 'ltr' | 'rtl'
  hasAltGr: boolean
  variant?: string
}

export type KeyboardLayout = {
  id: LayoutId
  language: string
  name: string
  metadata: LayoutMetadata
  keys: Partial<Record<PhysicalKeyId, KeyOutput>>
}

export type UserLayoutProfile = {
  sourceLayout: LayoutId
  enabledLayouts: LayoutId[]
}

export type ClassificationResult =
  | { kind: 'VALID' }
  | { kind: 'LAYOUT_MISMATCH'; targetLayout: LayoutId }

export type CachedClassification = {
  result: ClassificationResult
  targetLayout?: LayoutId
  corrected?: string
  ts: number
}
