import { readCaret, readFieldText, selectionOverlaps } from './read.ts'
import type { DiscardReason, EditableElement, ReplacementSnapshot } from './types.ts'

export function currentGeneration(
  generations: WeakMap<Element, number>,
  element: Element,
): number {
  return generations.get(element) ?? 0
}

export type VerifyOptions = {
  /** Explicit shortcut: the caret/selection may sit on the target token. */
  allowActiveEdit?: boolean
}

export function verifyReplacement(
  snapshot: ReplacementSnapshot,
  replacement: string,
  generations: WeakMap<Element, number>,
  expectedElement?: EditableElement,
  options?: VerifyOptions,
): DiscardReason | null {
  if (!replacement || replacement === snapshot.originalWord) return 'invalid-replacement'
  if (!snapshot.element.isConnected) return 'disconnected'
  if (expectedElement && snapshot.element !== expectedElement) return 'wrong-node'

  const text = readFieldText(snapshot.element)
  if (
    snapshot.wordStart < 0 ||
    snapshot.wordEnd < snapshot.wordStart ||
    snapshot.wordEnd > text.length
  ) {
    return 'missing-range'
  }

  const slice = text.slice(snapshot.wordStart, snapshot.wordEnd)
  if (slice !== snapshot.originalWord) return 'text-mismatch'

  const liveGeneration = currentGeneration(generations, snapshot.element)
  if (liveGeneration !== snapshot.generation && slice !== snapshot.originalWord) {
    return 'region-edited'
  }

  if (!options?.allowActiveEdit) {
    const caret = readCaret(snapshot.element)
    if (caret !== null && caret > snapshot.wordStart && caret < snapshot.wordEnd) {
      return 'caret-inside-word'
    }

    if (selectionOverlaps(snapshot.element, snapshot.wordStart, snapshot.wordEnd)) {
      return 'selection-overlap'
    }
  }

  return null
}
