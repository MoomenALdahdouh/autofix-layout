import { isSafeToken, tokenizeText } from '../safety/index.ts'
import { isArabicWord } from './lexicons/ar-words.ts'
import { isEnglishWord } from './lexicons/en-words.ts'
import { candidateTargets, isEnabledLayout } from './profile.ts'
import { layoutCharSet, mapLayout } from './registry.ts'
import type { ClassificationResult, LayoutId, UserLayoutProfile } from './types.ts'

/** Keys that produce letters on Arabic 101 but punctuation on US QWERTY. */
export const AR_LETTER_PUNCT = /[[\]';,./`]/

/** 1–2 letter QWERTY tokens that may remap only with extra field evidence. */
export const HIGH_CONFIDENCE_QWERTY_RU = new Set(['ghbdtn'])
const MIN_LEXICON_MISMATCH_CHARS = 3

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text)
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text)
}

function hasCyrillic(text: string): boolean {
  return /[\u0400-\u04FF]/.test(text)
}

function hasLatinLetter(text: string): boolean {
  return /[A-Za-z]/.test(text)
}

export function looksLikeEnglish(word: string): boolean {
  return isEnglishWord(word)
}

export function sameGlyphs(left: string, right: string): boolean {
  return left.normalize('NFC') === right.normalize('NFC')
}

export function contextSuggestsTarget(context: string, target: LayoutId): boolean {
  if (!context) return false
  if (target === 'ar-101') {
    if (hasArabic(context)) return true
    for (const span of tokenizeText(context).tokens) {
      const token = span.token
      if (AR_LETTER_PUNCT.test(token)) return true
      if ([...token].length < MIN_LEXICON_MISMATCH_CHARS || isEnglishWord(token)) {
        continue
      }
      const mapped = mapLayout(token, 'en-US-qwerty', 'ar-101')
      if (mapped && isArabicWord(mapped)) return true
    }
    return false
  }
  if (target === 'ru-standard') return hasCyrillic(context)
  return false
}

export function inferSourceLayout(
  word: string,
  profile: UserLayoutProfile,
): LayoutId | null {
  const chars = [...word]
  if (chars.length === 0 || !hasLetter(word)) return null

  if (
    chars.every((char) => /[\u0590-\u05FF]/.test(char)) &&
    isEnabledLayout(profile, 'he-standard')
  ) {
    return 'he-standard'
  }

  if (
    chars.every((char) => /[\u0370-\u03FF]/.test(char)) &&
    isEnabledLayout(profile, 'el-standard')
  ) {
    return 'el-standard'
  }

  if (
    chars.every((char) => /[\u0600-\u06FF]/.test(char)) &&
    isEnabledLayout(profile, 'ar-101')
  ) {
    return 'ar-101'
  }

  if (
    chars.every((char) => /[\u0600-\u06FF\u06F0-\u06F9]/.test(char)) &&
    isEnabledLayout(profile, 'fa-standard') &&
    !isEnabledLayout(profile, 'ar-101')
  ) {
    return 'fa-standard'
  }

  if (chars.every((char) => /[\u0400-\u04FF]/.test(char))) {
    if (
      isEnabledLayout(profile, 'uk-standard') &&
      /[іїєґІЇЄҐ]/.test(word)
    ) {
      return 'uk-standard'
    }
    if (isEnabledLayout(profile, 'ru-standard')) return 'ru-standard'
    if (isEnabledLayout(profile, 'uk-standard')) return 'uk-standard'
  }

  if (
    isEnabledLayout(profile, 'en-US-qwerty') &&
    chars.every((char) => layoutCharSet('en-US-qwerty').has(char))
  ) {
    return 'en-US-qwerty'
  }

  if (chars.every((char) => layoutCharSet(profile.sourceLayout).has(char))) {
    return profile.sourceLayout
  }

  return null
}

export function evaluableSpan(
  token: string,
  profile: UserLayoutProfile,
): { word: string; offset: number } | null {
  if (!token) return null

  if (
    !hasLatinLetter(token) &&
    (hasArabic(token) || hasCyrillic(token)) &&
    shouldEvaluateToken(token, profile)
  ) {
    return { word: token, offset: 0 }
  }

  const sourceChars = layoutCharSet('en-US-qwerty')
  let start = token.length
  while (start > 0 && sourceChars.has(token[start - 1]!)) {
    start -= 1
  }
  const word = token.slice(start)
  if (!shouldEvaluateToken(word, profile)) return null
  return { word, offset: start }
}

export function shouldEvaluateToken(
  word: string,
  profile: UserLayoutProfile,
): boolean {
  if (!word || !hasLetter(word)) return false
  if (!isSafeToken(word)) return false
  return inferSourceLayout(word, profile) !== null
}

function reverseIfEnglish(
  word: string,
  source: LayoutId,
  targets: LayoutId[],
): ClassificationResult | null {
  if (!targets.includes('en-US-qwerty')) return null
  const mapped = mapLayout(word, source, 'en-US-qwerty')
  if (mapped && isEnglishWord(mapped)) {
    return { kind: 'LAYOUT_MISMATCH', targetLayout: 'en-US-qwerty' }
  }
  return { kind: 'VALID' }
}

export function localClassificationHint(
  word: string,
  profile: UserLayoutProfile,
  context = '',
): ClassificationResult | null {
  const source = inferSourceLayout(word, profile)
  if (!source) return null
  const targets = candidateTargets(profile, source)

  if (source === 'ar-101') {
    if (isArabicWord(word)) return { kind: 'VALID' }
    return reverseIfEnglish(word, source, targets)
  }
  if (source === 'ru-standard') {
    return reverseIfEnglish(word, source, targets)
  }

  if (isEnglishWord(word)) {
    return { kind: 'VALID' }
  }

  if (targets.includes('ar-101')) {
    const mapped = mapLayout(word, source, 'ar-101')
    if (confidentArabicMismatch(word, mapped, context)) {
      return { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' }
    }
  }

  if (
    targets.includes('ru-standard') &&
    HIGH_CONFIDENCE_QWERTY_RU.has(word.toLocaleLowerCase())
  ) {
    return { kind: 'LAYOUT_MISMATCH', targetLayout: 'ru-standard' }
  }

  return null
}

export function shouldCommitMismatch(
  word: string,
  target: LayoutId,
  corrected: string | undefined,
  context = '',
  allowed?: readonly string[],
): boolean {
  if (allowed && !allowed.includes(target)) return false
  if (!corrected || sameGlyphs(corrected, word)) return false
  if (target === 'en-US-qwerty') return hasLetter(word) && isEnglishWord(corrected)
  if (target === 'ar-101') {
    return confidentArabicMismatch(word, corrected, context)
  }
  if (target === 'ru-standard') {
    return (
      hasCyrillic(corrected) &&
      HIGH_CONFIDENCE_QWERTY_RU.has(word.toLocaleLowerCase())
    )
  }
  return false
}

export function canCommitMismatch(
  profile: UserLayoutProfile,
  word: string,
  target: LayoutId,
  corrected: string | undefined,
  context = '',
): boolean {
  return shouldCommitMismatch(
    word,
    target,
    corrected,
    context,
    profile.enabledLayouts,
  )
}

export function preferredTarget(profile: UserLayoutProfile): LayoutId | null {
  return candidateTargets(profile)[0] ?? null
}

/**
 * Layout-mismatch evidence for QWERTY → Arabic 101.
 * Punctuation that is a letter on Arabic 101 stays inside the token
 * (`hsjo]lj`, `i`h`, `;dt`, `phg;`) — it is not permission to write.
 * A trailing semicolon after an already-committing token stays
 * punctuation (`hsjo]lj;` → `استخدمت;`). Commit only when the physical
 * remap is a known Arabic word and the typed token is not English.
 * Tokens of 1–2 letters stay put unless local context already
 * points at Arabic (`td` / `lk` / `kw` isolated stay; `td` next to
 * Arabic remaps to `في`). QWERTY punctuation that is a letter on
 * Arabic 101 (`i,` → `هو`) is decided from the raw key sequence.
 */
export function confidentArabicMismatch(
  word: string,
  mapped: string | null | undefined,
  context = '',
): boolean {
  if (!mapped || sameGlyphs(mapped, word)) return false
  if (isEnglishWord(word) || !isArabicWord(mapped)) return false
  const letters = [...word].length
  if (letters <= 2) {
    return contextSuggestsTarget(context, 'ar-101')
  }
  return letters >= MIN_LEXICON_MISMATCH_CHARS
}
