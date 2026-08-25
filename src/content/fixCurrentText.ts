import {
  canCommitMismatch,
  localClassificationHint,
  planFieldFixes,
  type FieldFix,
  type UserLayoutProfile,
} from '../layouts/index.ts'
import type { FixCurrentTextResult } from '../messaging.ts'
import { isExceptedToken } from '../profile/index.ts'
import {
  captureSnapshot,
  isValueEditable,
  readFieldText,
  readSelectionRange,
  snapshotGeneration,
  type EditableElement,
  type ReplacementSnapshot,
} from '../dom/index.ts'
import {
  isInsideMarkdownCode,
  isSafeToken,
  tokenizeText,
  type TokenSpan,
} from '../safety/index.ts'

export type FixTarget = {
  start: number
  end: number
  text: string
  mode: 'selection' | 'token' | 'field'
}

let lastFocusedEditable: EditableElement | null = null

export function rememberFocusedEditable(element: EditableElement | null): void {
  if (element) lastFocusedEditable = element
}

export function isFixCurrentTextShortcut(event: KeyboardEvent): boolean {
  if (event.isComposing || event.repeat || event.key === 'Process') return false
  if (event.code !== 'KeyP') return false
  return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey
}

export type ShortcutSession = {
  element: EditableElement
  text: string
  start: number
  end: number
  generation: number
  sourceLayout: string
  enabledLayouts: readonly string[]
}

export type FixCurrentTextHost = {
  profile: UserLayoutProfile
  personalExceptions: readonly string[]
  directShortcutEnabled: boolean
  composing: boolean
  pageBlocked: boolean
  fieldBlocked: (element: Element) => boolean
  usageAllowed: () => Promise<boolean>
  requestVerdict: (
    snapshot: ReplacementSnapshot,
    explicit: boolean,
  ) => Promise<boolean>
  writeFix: (
    snapshot: ReplacementSnapshot,
    corrected: string,
    sourceLayout: UserLayoutProfile['sourceLayout'],
    targetLayout: UserLayoutProfile['sourceLayout'],
  ) => boolean
}

export function getFocusedEditable(root: Document = document): EditableElement | null {
  let node: Element | null = root.activeElement
  while (node) {
    const editable = closestEditable(node)
    if (editable) {
      rememberFocusedEditable(editable)
      return editable
    }
    node = node.shadowRoot?.activeElement ?? null
  }
  if (lastFocusedEditable?.isConnected) return lastFocusedEditable
  return null
}

function closestEditable(start: Element): EditableElement | null {
  let node: Element | null = start
  while (node) {
    if (isValueEditable(node)) return node
    if (node instanceof HTMLElement && node.isContentEditable) return node
    node = node.parentElement
  }
  return null
}

export function tokenAtCaret(text: string, caret: number): FixTarget | null {
  if (caret < 0 || caret > text.length) return null
  const { tokens } = tokenizeText(text)
  for (const span of tokens) {
    if (caret >= span.start && caret <= span.end) {
      if (!span.token) return null
      return { start: span.start, end: span.end, text: span.token, mode: 'token' }
    }
  }
  return null
}

export function resolveFixTarget(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): FixTarget | null {
  const from = Math.min(selectionStart, selectionEnd)
  const to = Math.max(selectionStart, selectionEnd)
  if (from !== to) {
    const slice = text.slice(from, to)
    if (!slice.trim()) return null
    return { start: from, end: to, text: slice, mode: 'selection' }
  }
  return fieldTarget(text)
}

function fieldTarget(text: string): FixTarget | null {
  if (!text.trim()) return null
  return { start: 0, end: text.length, text, mode: 'field' }
}

export function planShortcutFixes(
  text: string,
  profile: UserLayoutProfile,
  target: FixTarget,
  personalExceptions: readonly string[] = [],
): FieldFix[] {
  return planFieldFixes(text, profile, {
    finalizeAll: true,
    personalExceptions,
  }).filter((fix) => fix.start >= target.start && fix.end <= target.end)
}

export function tokensNeedingClassifier(
  text: string,
  profile: UserLayoutProfile,
  target: FixTarget,
  personalExceptions: readonly string[] = [],
  planned: readonly FieldFix[] = [],
): TokenSpan[] {
  const plannedStarts = new Set(planned.map((fix) => fix.start))
  return tokenizeText(text).tokens.filter((span) => {
    if (span.start < target.start || span.end > target.end) return false
    if (plannedStarts.has(span.start)) return false
    if (!span.token) return false
    if (isExceptedToken(span.token, personalExceptions)) return false
    if (!isSafeToken(span.token, span.context, span.raw)) return false
    if (isInsideMarkdownCode(text, span.start)) return false
    return localClassificationHint(span.token, profile, text) === null
  })
}

export function shortcutSessionStillValid(
  session: ShortcutSession,
  profile: UserLayoutProfile,
  focused: EditableElement | null,
): boolean {
  if (!session.element.isConnected) return false
  if (focused !== session.element) return false
  if (readFieldText(session.element) !== session.text) return false
  if (snapshotGeneration(session.element) !== session.generation) return false
  if (profile.sourceLayout !== session.sourceLayout) return false
  if (profile.enabledLayouts.join('\0') !== session.enabledLayouts.join('\0')) return false
  const range = readSelectionRange(session.element)
  if (!range) return false
  return range.start === session.start && range.end === session.end
}

export function captureShortcutSession(
  element: EditableElement,
  profile: UserLayoutProfile,
  selection: { start: number; end: number },
): ShortcutSession {
  return {
    element,
    text: readFieldText(element),
    start: selection.start,
    end: selection.end,
    generation: snapshotGeneration(element),
    sourceLayout: profile.sourceLayout,
    enabledLayouts: [...profile.enabledLayouts],
  }
}

export async function fixCurrentText(host: FixCurrentTextHost): Promise<FixCurrentTextResult> {
  if (!host.directShortcutEnabled) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'disabled' }
  }
  if (host.composing) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'composing' }
  }
  if (host.pageBlocked) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'blocked' }
  }

  const element = getFocusedEditable()
  if (!element || host.fieldBlocked(element)) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'unsupported' }
  }

  if (!(await host.usageAllowed())) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'usage' }
  }

  const text = readFieldText(element)
  const selection = readSelectionRange(element)
  if (!selection) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'no-target' }
  }
  const target = resolveFixTarget(text, selection.start, selection.end)
  if (!target) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'no-target' }
  }

  const session = captureShortcutSession(element, host.profile, selection)
  const local = planShortcutFixes(text, host.profile, target, host.personalExceptions)
  let applied = false

  for (const fix of [...local].sort((a, b) => b.start - a.start)) {
    if (
      !canCommitMismatch(host.profile, fix.word, fix.targetLayout, fix.corrected, text)
    ) {
      continue
    }
    const snapshot = captureSnapshot(
      element,
      isValueEditable(element) ? 'value' : 'contenteditable',
      fix.word,
      fix.start,
      fix.end,
      fix.end,
    )
    if (host.writeFix(snapshot, fix.corrected, fix.sourceLayout, fix.targetLayout)) {
      applied = true
    }
  }

  if (applied) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: true }
  }

  const remaining = tokensNeedingClassifier(
    text,
    host.profile,
    target,
    host.personalExceptions,
    local,
  )
  if (remaining.length === 0) {
    return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'noop' }
  }

  for (const span of remaining) {
    if (!shortcutSessionStillValid(session, host.profile, getFocusedEditable())) {
      return { type: 'FIX_CURRENT_TEXT_RESULT', applied: false, reason: 'stale' }
    }
    const snapshot = captureSnapshot(
      element,
      isValueEditable(element) ? 'value' : 'contenteditable',
      span.token,
      span.start,
      span.end,
      span.end,
    )
    if (await host.requestVerdict(snapshot, true)) applied = true
  }

  return {
    type: 'FIX_CURRENT_TEXT_RESULT',
    applied,
    reason: applied ? undefined : 'noop',
  }
}
