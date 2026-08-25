import type { EditableElement } from './types.ts'

/** Email and URL inputs are never read — they are protected contexts. */
const TEXTUAL_INPUT_TYPES = new Set(['text', 'search', 'tel', ''])

export function isValueEditable(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly && !element.disabled
  }
  if (element instanceof HTMLInputElement) {
    return (
      !element.readOnly &&
      !element.disabled &&
      TEXTUAL_INPUT_TYPES.has(element.type)
    )
  }
  return false
}

export function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current: Node | null
  while ((current = walker.nextNode())) {
    nodes.push(current as Text)
  }
  return nodes
}

export function readFieldText(element: EditableElement): string {
  if (isValueEditable(element)) return element.value
  return collectTextNodes(element)
    .map((node) => node.data)
    .join('')
}

function offsetFromPoint(
  element: EditableElement,
  container: Node,
  offset: number,
): number | null {
  if (!element.contains(container)) return null
  const before = document.createRange()
  before.selectNodeContents(element)
  before.setEnd(container, offset)
  return before.toString().length
}

export function readCaret(element: EditableElement): number | null {
  if (isValueEditable(element)) return element.selectionStart

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const caretRange = selection.getRangeAt(0)
  return offsetFromPoint(element, caretRange.startContainer, caretRange.startOffset)
}

export function readSelectionRange(
  element: EditableElement,
): { start: number; end: number } | null {
  if (isValueEditable(element)) {
    const start = element.selectionStart
    const end = element.selectionEnd
    if (start == null || end == null) return null
    return { start: Math.min(start, end), end: Math.max(start, end) }
  }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const start = offsetFromPoint(element, range.startContainer, range.startOffset)
  const end = offsetFromPoint(element, range.endContainer, range.endOffset)
  if (start == null || end == null) return null
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

export function selectionOverlaps(
  element: EditableElement,
  start: number,
  end: number,
): boolean {
  if (isValueEditable(element)) {
    const from = element.selectionStart
    const to = element.selectionEnd
    if (from === null || to === null || from === to) return false
    return from < end && to > start
  }

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer) && !element.contains(range.endContainer)) {
    return false
  }
  const caret = readCaret(element)
  if (caret === null) return true
  return caret >= start && caret <= end
}

export function mapOffsetToNode(
  element: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  let remaining = offset
  const nodes = collectTextNodes(element)
  for (const node of nodes) {
    if (remaining <= node.data.length) return { node, offset: remaining }
    remaining -= node.data.length
  }
  const last = nodes.at(-1)
  if (!last) return null
  return { node: last, offset: last.data.length }
}
