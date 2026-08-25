import { isSafeToken, isBoundaryChar, splitTrueTrail, tokenizeText } from '../safety/index.ts'
import { AR_LETTER_PUNCT, canCommitMismatch, inferSourceLayout } from './heuristics.ts'
import { isArabicWord } from './lexicons/ar-words.ts'
import { isEnglishWord } from './lexicons/en-words.ts'
import { candidateTargets } from './profile.ts'
import { mapLayout } from './registry.ts'
import type { LayoutId, UserLayoutProfile } from './types.ts'

export type FieldFix = {
  start: number
  end: number
  word: string
  corrected: string
  sourceLayout: LayoutId
  targetLayout: LayoutId
}

export type PlanOptions = {
  finalizeAll?: boolean
  caret?: number
  personalExceptions?: readonly string[]
}

type Token = {
  raw: string
  word: string
  start: number
  end: number
  wordStart: number
  wordEnd: number
  complete: boolean
  source: LayoutId | null
}

function isComplete(
  text: string,
  start: number,
  end: number,
  finalizeAll: boolean,
  caret?: number,
): boolean {
  if (finalizeAll) return true
  if (caret !== undefined && caret > start && caret < end) return false
  return isBoundaryChar(text[end])
}

function tokenize(
  text: string,
  finalizeAll: boolean,
  caret?: number,
): Token[] {
  return tokenizeText(text).tokens.map((span) => ({
    raw: span.raw,
    word: span.token,
    start: span.rawStart,
    end: span.rawEnd,
    wordStart: span.start,
    wordEnd: span.end,
    complete: isComplete(text, span.start, span.end, finalizeAll, caret),
    source: null,
  }))
}

function assignSources(tokens: Token[], profile: UserLayoutProfile): void {
  for (const token of tokens) {
    token.source = token.word ? inferSourceLayout(token.word, profile) : null
  }
}

export const LOCAL_CONTEXT_RADIUS = 3

export function neighborContext(words: readonly string[], index: number): string {
  const from = Math.max(0, index - LOCAL_CONTEXT_RADIUS)
  const to = Math.min(words.length, index + LOCAL_CONTEXT_RADIUS + 1)
  return words.slice(from, to).join(' ')
}

function decideTarget(
  word: string,
  source: LayoutId,
  profile: UserLayoutProfile,
  context: string,
): LayoutId | null {
  if (source === 'ar-101' && isArabicWord(word)) return null
  if (source === 'en-US-qwerty' && isEnglishWord(word)) return null

  for (const target of candidateTargets(profile, source)) {
    const mapped = mapLayout(word, source, target)
    if (canCommitMismatch(profile, word, target, mapped ?? undefined, context)) {
      return target
    }
  }
  return null
}

function onlyArabicLetterPunctExtra(word: string, raw: string): boolean {
  if (raw === word || !raw.includes(word)) return false
  const extra = raw.replace(word, '')
  return extra.length > 0 && [...extra].every((char) => AR_LETTER_PUNCT.test(char))
}

function considerToken(
  token: Token,
  context: string,
  profile: UserLayoutProfile,
  options: PlanOptions,
): FieldFix | null {
  if (!token.complete || !token.word || !token.source) return null
  if (options.personalExceptions?.includes(token.word)) return null
  if (!isSafeToken(token.word, '', token.raw)) return null
  let word = token.word
  let start = token.wordStart
  let end = token.wordEnd
  let source = token.source
  let target = decideTarget(word, source, profile, context)
  if (!target) {
    const { core } = splitTrueTrail(token.raw)
    const candidate =
      core && core !== word
        ? core
        : onlyArabicLetterPunctExtra(word, token.raw)
          ? token.raw
          : ''
      const shortLayoutPunct =
        [...word].length <= 2 && AR_LETTER_PUNCT.test(candidate)
      if (
        candidate &&
        (!isEnglishWord(word) || shortLayoutPunct) &&
        !isArabicWord(word) &&
        !options.personalExceptions?.includes(candidate) &&
        isSafeToken(candidate, '', candidate)
      ) {
      const rawSource = inferSourceLayout(candidate, profile)
      if (rawSource) {
        const rawTarget = decideTarget(candidate, rawSource, profile, context)
        if (rawTarget) {
          word = candidate
          start = token.start + token.raw.indexOf(candidate)
          end = start + candidate.length
          source = rawSource
          target = rawTarget
        }
      }
    }
  }
  if (!target || target === source) return null
  const corrected = mapLayout(word, source, target)
  if (!corrected || corrected === word) return null
  return {
    start,
    end,
    word,
    corrected,
    sourceLayout: source,
    targetLayout: target,
  }
}

export function planFieldFixes(
  text: string,
  profile: UserLayoutProfile,
  options: PlanOptions = {},
): FieldFix[] {
  const finalizeAll = options.finalizeAll === true
  const tokens = tokenize(text, finalizeAll, options.caret)
  assignSources(tokens, profile)
  const overlay = new Map<number, string>()
  const fixes: FieldFix[] = []

  const pass = (): boolean => {
    let added = false
    const words = tokens.map((item, itemIndex) => overlay.get(itemIndex) ?? item.word)
    for (let index = 0; index < tokens.length; index += 1) {
      if (overlay.has(index)) continue
      const context = neighborContext(words, index)
      const fix = considerToken(tokens[index]!, context, profile, options)
      if (!fix) continue
      overlay.set(index, fix.corrected)
      words[index] = fix.corrected
      fixes.push(fix)
      added = true
    }
    return added
  }

  if (pass()) pass()
  return fixes
}

export function applyFixesToText(
  text: string,
  fixes: FieldFix[],
): string {
  let next = text
  for (const fix of [...fixes].sort((a, b) => b.start - a.start)) {
    if (next.slice(fix.start, fix.end) !== fix.word) continue
    next = next.slice(0, fix.start) + fix.corrected + next.slice(fix.end)
  }
  return next
}

export function adjustCaret(
  caret: number,
  start: number,
  end: number,
  replacementLength: number,
): number {
  if (caret <= start) return caret
  if (caret >= end) return caret + (replacementLength - (end - start))
  return start + replacementLength
}
