export type PieceKind = 'token' | 'delimiter'

export type TextPiece = {
  kind: PieceKind
  value: string
  start: number
  end: number
}

export type TokenSpan = {
  token: string
  delimiter: string
  context: string
  start: number
  end: number
  raw: string
  rawStart: number
  rawEnd: number
}

const LEAD_PUNCT = /^[[({'"«“]+/u
const TRAIL_PUNCT = /[\])}'"»”,.!?;:؟،؛]+$/u
const TRUE_TRAIL = /[)}'"»”!?؟:،؛]+$/u
/** Arabic 101 shifted letters that surface as math/dash glyphs, not words. */
const LAYOUT_SYMBOL_BREAK = /[÷×—–]/u

export function splitTrueTrail(raw: string): { core: string; trail: string } {
  const trail = raw.match(TRUE_TRAIL)?.[0] ?? ''
  return { core: raw.slice(0, raw.length - trail.length), trail }
}
const WHITESPACE = /\s/u

export function peelBoundary(raw: string): {
  lead: string
  token: string
  trail: string
} {
  const lead = raw.match(LEAD_PUNCT)?.[0] ?? ''
  const body = raw.slice(lead.length)
  const trail = body.match(TRAIL_PUNCT)?.[0] ?? ''
  return {
    lead,
    token: body.slice(0, body.length - trail.length),
    trail,
  }
}

export function isBoundaryChar(char: string | undefined): boolean {
  if (!char) return false
  return (
    WHITESPACE.test(char) ||
    TRAIL_PUNCT.test(char) ||
    LAYOUT_SYMBOL_BREAK.test(char)
  )
}

export function tokenizeText(text: string): { pieces: TextPiece[]; tokens: TokenSpan[] } {
  const pieces: TextPiece[] = []
  let index = 0
  while (index < text.length) {
    if (WHITESPACE.test(text[index]!)) {
      let end = index + 1
      while (end < text.length && WHITESPACE.test(text[end]!)) end += 1
      pieces.push({ kind: 'delimiter', value: text.slice(index, end), start: index, end })
      index = end
      continue
    }
    if (LAYOUT_SYMBOL_BREAK.test(text[index]!)) {
      pieces.push({
        kind: 'delimiter',
        value: text[index]!,
        start: index,
        end: index + 1,
      })
      index += 1
      continue
    }
    let end = index + 1
    while (
      end < text.length &&
      !WHITESPACE.test(text[end]!) &&
      !LAYOUT_SYMBOL_BREAK.test(text[end]!)
    ) {
      end += 1
    }
    const raw = text.slice(index, end)
    const { lead, token, trail } = peelBoundary(raw)
    if (lead) {
      pieces.push({
        kind: 'delimiter',
        value: lead,
        start: index,
        end: index + lead.length,
      })
    }
    if (token) {
      pieces.push({
        kind: 'token',
        value: token,
        start: index + lead.length,
        end: index + lead.length + token.length,
      })
    }
    if (trail) {
      pieces.push({
        kind: 'delimiter',
        value: trail,
        start: end - trail.length,
        end,
      })
    }
    index = end
  }

  const tokens: TokenSpan[] = []
  const seen: string[] = []
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i]!
    if (piece.kind !== 'token') continue
    let delimiter = ''
    const next = pieces[i + 1]
    if (next?.kind === 'delimiter') delimiter = next.value
    const rawStart = pieces[i - 1]?.kind === 'delimiter' && !WHITESPACE.test(pieces[i - 1]!.value[0] ?? '')
      ? pieces[i - 1]!.start
      : piece.start
    const rawEnd =
      next?.kind === 'delimiter' && !WHITESPACE.test(next.value[0] ?? '')
        ? next.end
        : piece.end
    tokens.push({
      token: piece.value,
      delimiter,
      context: seen.join(' '),
      start: piece.start,
      end: piece.end,
      raw: text.slice(rawStart, rawEnd),
      rawStart,
      rawEnd,
    })
    seen.push(piece.value)
  }

  return { pieces, tokens }
}

export function lastCompletedToken(
  text: string,
  caret: number,
  requireBoundary: boolean,
): TokenSpan | null {
  const before = text.slice(0, caret)
  const { tokens } = tokenizeText(before)
  const last = tokens.at(-1)
  if (!last) return null
  if (requireBoundary && !last.delimiter && !isBoundaryChar(text[last.end])) {
    return null
  }
  return last
}
