import {
  WORD_CACHE_STORAGE_KEY,
  cacheKeyForToken,
  createClassificationStore,
  createCoalescer,
  decideHotPath,
  measureAsync,
  measureSync,
  toCacheRecord,
} from './cache/index.ts'
import {
  DEFAULT_PROFILE,
  canCommitMismatch,
  inferSourceLayout,
  localClassificationHint,
  mapLayout,
  normalizeProfile,
  planFieldFixes,
} from './layouts/index.ts'
import type { UserLayoutProfile } from './layouts/types.ts'
import {
  ACTIVITY_HEARTBEAT_MS,
  USAGE_STORAGE_KEY,
} from './entitlement/index.ts'
import type {
  CheckWordError,
  CheckWordResult,
  FixCurrentTextResult,
  InterveneDecisionResult,
} from './messaging.ts'
import {
  PROFILE_STORAGE_KEY,
  isCorrectionActive,
  isExceptedToken,
  migrateToUserProfile,
  type UserProfile,
} from './profile/index.ts'
import {
  beginComposition,
  bumpGeneration,
  captureSnapshot,
  commitReplacement,
  endComposition,
  isComposing,
  isValueEditable,
  mappingStillValid,
  readCaret,
  readFieldText,
  type CommitOptions,
} from './dom/index.ts'
import type { EditableElement, ReplacementSnapshot } from './dom/index.ts'
import { createSpeedBox } from './content/speedBox.ts'
import { evaluateGate } from './content/evaluateGate.ts'
import {
  fixCurrentText,
  isFixCurrentTextShortcut,
  rememberFocusedEditable,
} from './content/fixCurrentText.ts'
import { isContextInvalidated, isExtensionAlive } from './runtime.ts'
import {
  MAX_FIELD_CHARS,
  MAX_FIELD_TOKENS,
  isExcludedHost,
  isInsideMarkdownCode,
  isSafeToken,
  lastCompletedToken,
  normalizeExcludedDomains,
  probeElement,
  skipReasonForField,
  tokenizeText,
} from './safety/index.ts'

document.documentElement.dataset.autofixLayout = 'active'

const TRIGGER_KEYS = new Set([' ', 'Enter', 'Tab'])

let enabled = true
let pausedUntil = 0
let manualConversionEnabled = true
let directShortcutEnabled = true
let canIntervene = true
let lastActivitySentAt = 0
let profile: UserLayoutProfile = DEFAULT_PROFILE
let excludedDomains: string[] = []
let personalExceptions: string[] = []
const hotCache = createClassificationStore()
const coalesceCheck = createCoalescer<CheckWordResult | CheckWordError | undefined>()
const speedBox = createSpeedBox({
  getProfile: () => ({
    manualConversionEnabled,
    sourceLayout: profile.sourceLayout,
    enabledLayouts: profile.enabledLayouts,
  }),
})

function applyUserProfile(next: UserProfile): void {
  enabled = next.enabled
  pausedUntil = next.pausedUntil
  manualConversionEnabled = next.manualConversionEnabled
  directShortcutEnabled = next.directShortcutEnabled !== false
  profile = { sourceLayout: next.sourceLayout, enabledLayouts: next.enabledLayouts }
  excludedDomains = next.excludedDomains
  personalExceptions = next.personalExceptions
  speedBox.sync()
}

function skipPageIntervention(event: Event): boolean {
  return speedBox.isOpen() || speedBox.ownsEvent(event)
}

function live(): boolean {
  return isCorrectionActive({ enabled, pausedUntil })
}

function readStoredIntervention(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  if ('canIntervene' in raw) canIntervene = (raw as { canIntervene?: boolean }).canIntervene !== false
}

function noteAutomaticActivity(element: EditableElement | null): void {
  if (!element || !live() || !isExtensionAlive()) return
  if (pageBlocked() || fieldBlocked(element) || speedBox.isOpen()) return
  const now = Date.now()
  if (now - lastActivitySentAt < ACTIVITY_HEARTBEAT_MS) return
  lastActivitySentAt = now
  void chrome.runtime.sendMessage({ type: 'NOTE_USAGE_ACTIVITY' }).then((response) => {
    const result = response as InterveneDecisionResult | undefined
    if (result?.type === 'INTERVENE_DECISION') canIntervene = result.canIntervene
  }).catch(() => {
    /* fail closed on the next boundary check */
  })
}

async function refreshUsageAllowed(): Promise<boolean> {
  if (!isExtensionAlive()) return false
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'CAN_INTERVENE',
    })) as InterveneDecisionResult | undefined
    if (response?.type === 'INTERVENE_DECISION') {
      canIntervene = response.canIntervene
      return response.decision === 'ALLOW'
    }
  } catch {
    return false
  }
  return canIntervene
}

async function interventionAllowed(): Promise<boolean> {
  if (!live() || !canIntervene) return false
  return refreshUsageAllowed()
}

function syncSettings(): void {
  if (!isExtensionAlive()) return
  void chrome.storage.local.get({ [PROFILE_STORAGE_KEY]: null }, (local) => {
    if (chrome.runtime.lastError) return
    if (local[PROFILE_STORAGE_KEY]) {
      applyUserProfile(migrateToUserProfile({ current: local[PROFILE_STORAGE_KEY] }).profile)
      return
    }
    chrome.storage.sync.get(
      { enabled: true, layoutProfile: null, excludedDomains: [] },
      (stored) => {
        if (chrome.runtime.lastError) return
        applyUserProfile(
          migrateToUserProfile({
            legacy: {
              enabled: stored.enabled,
              layoutProfile: stored.layoutProfile,
              excludedDomains: stored.excludedDomains,
            },
          }).profile,
        )
      },
    )
  })
}

function hydrateHotCache(raw: unknown): void {
  hotCache.memory.hydrate(raw)
}

function cacheKeyFor(word: string, context?: string): string {
  const source = inferSourceLayout(word, profile) ?? profile.sourceLayout
  return cacheKeyForToken(word, source, profile.enabledLayouts, context)
}

syncSettings()
if (isExtensionAlive()) {
  void chrome.storage.local.get({ [USAGE_STORAGE_KEY]: null }, (stored) => {
    if (chrome.runtime.lastError) return
    readStoredIntervention(stored[USAGE_STORAGE_KEY])
  })
  void chrome.storage.local.get({ [WORD_CACHE_STORAGE_KEY]: null }, (stored) => {
    if (chrome.runtime.lastError) return
    hydrateHotCache(stored[WORD_CACHE_STORAGE_KEY])
  })
}
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[WORD_CACHE_STORAGE_KEY]) {
      hydrateHotCache(changes[WORD_CACHE_STORAGE_KEY].newValue)
    }
    if (area === 'local' && changes[USAGE_STORAGE_KEY]) {
      readStoredIntervention(changes[USAGE_STORAGE_KEY].newValue)
    }
    if (area === 'local' && changes[PROFILE_STORAGE_KEY]) {
      applyUserProfile(
        migrateToUserProfile({ current: changes[PROFILE_STORAGE_KEY].newValue }).profile,
      )
      return
    }
    if (area !== 'sync') return
    if (changes.enabled) enabled = changes.enabled.newValue !== false
    if (changes.layoutProfile) profile = normalizeProfile(changes.layoutProfile.newValue)
    if (changes.excludedDomains) {
      excludedDomains = normalizeExcludedDomains(changes.excludedDomains.newValue)
    }
  })
} catch {
  // Extension was reloaded while this tab stayed open.
}

function pageBlocked(): boolean {
  return isExcludedHost(location.hostname, excludedDomains)
}

function fieldBlocked(element: Element): boolean {
  return skipReasonForField(probeElement(element)) !== null
}

function getEditableTarget(event: Event): EditableElement | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue
    if (isValueEditable(node) || (node instanceof HTMLElement && node.isContentEditable)) {
      rememberFocusedEditable(node)
      return node
    }
  }
  return null
}

function extractEvaluableWords(
  text: string,
): Array<{ word: string; start: number; end: number }> {
  return tokenizeText(text).tokens.flatMap((span) => {
    if (!isSafeToken(span.token, span.context, span.raw)) return []
    if (isExceptedToken(span.token, personalExceptions)) return []
    if (isInsideMarkdownCode(text, span.start)) return []
    return [{ word: span.token, start: span.start, end: span.end }]
  })
}

function contextBefore(text: string, wordStart: number): string | undefined {
  const parts = text
    .slice(0, wordStart)
    .trimEnd()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-4)
  return parts.length ? parts.join(' ') : undefined
}

function liveCaret(element: EditableElement, fallback: number): number {
  return readCaret(element) ?? fallback
}

type PendingCorrection = {
  element: EditableElement
  originalWord: string
  replacement: string
  wordStart: number
}

let pendingCorrection: PendingCorrection | null = null

function recordCorrection(
  kind: 'accepted' | 'ignored' | 'reverted',
  token: string,
  replacement?: string,
): void {
  if (!isExtensionAlive()) return
  void chrome.runtime.sendMessage({
    type: 'RECORD_CORRECTION',
    kind,
    token,
    replacement,
  })
}

function settlePending(
  element: EditableElement,
  inputType?: string,
): void {
  const pending = pendingCorrection
  if (!pending || pending.element !== element) return
  const text = readFieldText(element)
  const at = text.slice(pending.wordStart, pending.wordStart + pending.replacement.length)
  const original = text.slice(
    pending.wordStart,
    pending.wordStart + pending.originalWord.length,
  )
  if (inputType === 'historyUndo' || original === pending.originalWord) {
    recordCorrection('reverted', pending.originalWord, pending.replacement)
    pendingCorrection = null
    return
  }
  if (at === pending.replacement && inputType !== 'insertReplacementText') {
    recordCorrection('accepted', pending.originalWord, pending.replacement)
    pendingCorrection = null
  }
}

function snapshotOf(
  element: EditableElement,
  word: string,
  start: number,
  end: number,
): ReplacementSnapshot {
  return captureSnapshot(
    element,
    isValueEditable(element) ? 'value' : 'contenteditable',
    word,
    start,
    end,
    liveCaret(element, end),
  )
}

function writeCorrection(
  snapshot: ReplacementSnapshot,
  corrected: string,
  sourceLayout: typeof profile.sourceLayout,
  targetLayout: typeof profile.sourceLayout,
  options?: CommitOptions,
): boolean {
  if (!canIntervene) return false
  if (isExceptedToken(snapshot.originalWord, personalExceptions)) return false
  const stillValid = mappingStillValid(snapshot.originalWord, corrected, (word) =>
    mapLayout(word, sourceLayout, targetLayout),
  )
  const written = measureSync('domReplace', () =>
    commitReplacement(snapshot, corrected, stillValid, snapshot.element, options),
  )
  if (written === 'written') {
    pendingCorrection = {
      element: snapshot.element,
      originalWord: snapshot.originalWord,
      replacement: corrected,
      wordStart: snapshot.wordStart,
    }
    recordCorrection('accepted', snapshot.originalWord, corrected)
    return true
  }
  return false
}

function applyCachedHit(
  snapshot: ReplacementSnapshot,
  context?: string,
  options?: CommitOptions,
): boolean {
  const key = cacheKeyFor(snapshot.originalWord, context)
  const decision = decideHotPath(hotCache, key)
  if (decision.kind === 'miss') return false
  if (decision.kind === 'valid') return true
  const sourceLayout =
    inferSourceLayout(snapshot.originalWord, profile) ?? profile.sourceLayout
  const targetLayout = decision.record.targetLayout ?? sourceLayout
  if (
    !canCommitMismatch(
      profile,
      snapshot.originalWord,
      targetLayout,
      decision.corrected,
      context,
    )
  ) {
    return true
  }
  writeCorrection(snapshot, decision.corrected, sourceLayout, targetLayout, options)
  return true
}

async function requestVerdict(
  snapshot: ReplacementSnapshot,
  explicit = false,
): Promise<boolean> {
  if (!isExtensionAlive()) return false
  const context = contextBefore(readFieldText(snapshot.element), snapshot.wordStart)
  const options = explicit
    ? { allowActiveEdit: true, placeCaretAfter: true }
    : undefined
  if (applyCachedHit(snapshot, context, options)) {
    return (
      readFieldText(snapshot.element).slice(snapshot.wordStart, snapshot.wordEnd) !==
      snapshot.originalWord
    )
  }

  try {
    const key = cacheKeyFor(snapshot.originalWord, context)
    const response = await coalesceCheck(key, () =>
      measureAsync('swMessage', () =>
        chrome.runtime.sendMessage({
          type: 'CHECK_WORD',
          word: snapshot.originalWord,
          context,
          explicit,
        }) as Promise<CheckWordResult | CheckWordError | undefined>,
      ),
    )

    if (!response || response.type !== 'CHECK_WORD_RESULT') return false
    if (response.result.kind !== 'LAYOUT_MISMATCH') {
      hotCache.set(key, toCacheRecord(response.result, { corrected: response.corrected }))
      return false
    }
    const targetLayout = response.result.targetLayout
    const corrected =
      response.corrected ??
      mapLayout(snapshot.originalWord, response.sourceLayout, targetLayout)
    if (
      !corrected ||
      !canCommitMismatch(profile, snapshot.originalWord, targetLayout, corrected, context)
    ) {
      hotCache.set(key, toCacheRecord({ kind: 'VALID' }))
      return false
    }
    hotCache.set(key, toCacheRecord(response.result, { corrected }))
    return writeCorrection(snapshot, corrected, response.sourceLayout, targetLayout, options)
  } catch (error) {
    if (isContextInvalidated(error)) return false
    return false
  }
}

function applyLocalFixes(element: EditableElement, finalizeAll: boolean): void {
  const text = readFieldText(element)
  const caret = liveCaret(element, text.length)
  const oversized =
    text.length > MAX_FIELD_CHARS || tokenizeText(text).tokens.length > MAX_FIELD_TOKENS
  let fixes = planFieldFixes(text, profile, {
    finalizeAll: finalizeAll && !oversized,
    caret,
    personalExceptions,
  })
  if (oversized) {
    const last = lastCompletedToken(text, caret, !finalizeAll)
    fixes = last
      ? planFieldFixes(text, profile, {
          finalizeAll: true,
          caret,
          personalExceptions,
        }).filter((fix) => fix.start === last.start)
      : []
  }
  for (const fix of [...fixes].sort((a, b) => b.start - a.start)) {
    if (
      !canCommitMismatch(profile, fix.word, fix.targetLayout, fix.corrected, text)
    ) {
      continue
    }
    const snapshot = snapshotOf(element, fix.word, fix.start, fix.end)
    writeCorrection(snapshot, fix.corrected, fix.sourceLayout, fix.targetLayout)
  }
}

async function evaluateRemote(
  element: EditableElement,
  finalizeAll: boolean,
): Promise<void> {
  if (!(await refreshUsageAllowed())) return

  const text = readFieldText(element)
  const oversized =
    text.length > MAX_FIELD_CHARS || tokenizeText(text).tokens.length > MAX_FIELD_TOKENS
  const last = lastCompletedToken(text, liveCaret(element, text.length), !finalizeAll)
  const remaining = extractEvaluableWords(text).filter((item) => {
    const closed = finalizeAll || /\s/.test(text.slice(item.end, item.end + 1))
    if (!closed) return false
    if (oversized && last && item.start !== last.start) return false
    return localClassificationHint(item.word, profile, text) === null
  })

  for (const extracted of [...remaining].reverse()) {
    const snapshot = snapshotOf(element, extracted.word, extracted.start, extracted.end)
    const context = contextBefore(text, extracted.start)
    if (applyCachedHit(snapshot, context)) continue
    void requestVerdict(snapshot)
  }
}

function evaluateEditable(element: EditableElement, finalizeAll: boolean): void {
  if (fieldBlocked(element)) return
  const gate = evaluateGate({
    live: live(),
    composing: isComposing(),
    pageBlocked: pageBlocked(),
    canIntervene,
  })
  if (gate === 'skip') return
  if (gate === 'local-now') {
    applyLocalFixes(element, finalizeAll)
    void evaluateRemote(element, finalizeAll)
    return
  }
  void (async () => {
    if (!(await interventionAllowed())) return
    applyLocalFixes(element, finalizeAll)
    await evaluateRemote(element, finalizeAll)
  })()
}

function onKeyUp(event: KeyboardEvent): void {
  if (!live() || !isExtensionAlive() || isComposing()) return
  if (event.isComposing || event.repeat || skipPageIntervention(event)) return
  const element = getEditableTarget(event)
  if (element) noteAutomaticActivity(element)
  if (!TRIGGER_KEYS.has(event.key)) return
  if (!element) return
  void evaluateEditable(element, event.key !== ' ')
}

function onKeyDown(event: KeyboardEvent): void {
  if (isFixCurrentTextShortcut(event) && isExtensionAlive() && !isComposing()) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void handleFixCurrentText()
    return
  }
  if (!live() || !isExtensionAlive() || isComposing()) return
  if (event.isComposing || event.repeat || skipPageIntervention(event)) return
  const element = getEditableTarget(event)
  if (element) noteAutomaticActivity(element)
  if (event.key !== 'Enter' && event.key !== 'Tab') return
  if (!element) return
  void evaluateEditable(element, true)
}

function onInput(event: Event): void {
  if (!enabled || !isExtensionAlive() || isComposing()) return
  if (skipPageIntervention(event)) return
  if (!(event instanceof InputEvent) || event.isComposing) return
  const element = getEditableTarget(event)
  if (element) {
    bumpGeneration(element, event.inputType)
    noteAutomaticActivity(element)
  }
  if (element && event.inputType !== 'insertReplacementText') {
    settlePending(element, event.inputType)
  }
  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
    return
  }
  const insertedSpace =
    event.inputType === 'insertLineBreak' ||
    (event.inputType === 'insertText' && event.data === ' ')
  if (!insertedSpace || !element) return
  void evaluateEditable(element, false)
}

function onCompositionStart(): void {
  beginComposition()
}

function onCompositionEnd(): void {
  endComposition()
}

function onFocusIn(event: FocusEvent): void {
  getEditableTarget(event)
}

function onFocusOut(event: FocusEvent): void {
  if (!live() || !isExtensionAlive() || isComposing()) return
  if (skipPageIntervention(event)) return
  const element = getEditableTarget(event)
  if (!element) return
  void evaluateEditable(element, true)
}

function keepServiceWorkerAlive(): void {
  if (!isExtensionAlive()) return
  try {
    const port = chrome.runtime.connect({ name: 'keepalive' })
    port.onDisconnect.addListener(() => {
      setTimeout(keepServiceWorkerAlive, 2000)
    })
  } catch {
    // Extension was reloaded while this tab stayed open.
  }
}

async function handleFixCurrentText(): Promise<FixCurrentTextResult> {
  return fixCurrentText({
    profile,
    personalExceptions,
    directShortcutEnabled,
    composing: isComposing(),
    pageBlocked: pageBlocked(),
    fieldBlocked,
    usageAllowed: refreshUsageAllowed,
    requestVerdict,
    writeFix: (snapshot, corrected, sourceLayout, targetLayout) =>
      writeCorrection(snapshot, corrected, sourceLayout, targetLayout, {
        allowActiveEdit: true,
        placeCaretAfter: true,
      }),
  })
}

document.addEventListener('keydown', onKeyDown, true)
document.addEventListener('focusin', onFocusIn, true)
document.addEventListener('keyup', onKeyUp, true)
document.addEventListener('input', onInput, true)
document.addEventListener('focusout', onFocusOut, true)
document.addEventListener('compositionstart', onCompositionStart, true)
document.addEventListener('compositionend', onCompositionEnd, true)
keepServiceWorkerAlive()
if (isExtensionAlive()) {
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'FIX_CURRENT_TEXT') return
      void handleFixCurrentText()
        .then(sendResponse)
        .catch(() =>
          sendResponse({
            type: 'FIX_CURRENT_TEXT_RESULT',
            applied: false,
            reason: 'noop',
          } satisfies FixCurrentTextResult),
        )
      return true
    })
  } catch {
    // Extension was reloaded while this tab stayed open.
  }
}
