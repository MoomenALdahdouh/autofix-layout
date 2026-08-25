export type EditableKind = 'value' | 'contenteditable'

export type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement

export type ReplacementSnapshot = {
  element: EditableElement
  kind: EditableKind
  originalWord: string
  wordStart: number
  wordEnd: number
  caret: number
  timestamp: number
  generation: number
}

export type WriteVerdict = 'written' | 'discarded'

export type DiscardReason =
  | 'disconnected'
  | 'wrong-node'
  | 'missing-range'
  | 'text-mismatch'
  | 'region-edited'
  | 'caret-inside-word'
  | 'selection-overlap'
  | 'invalid-replacement'
  | 'mapping-stale'
