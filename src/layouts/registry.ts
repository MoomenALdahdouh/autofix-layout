import { ar101 } from './ar-101.ts'
import { enUsQwerty } from './en-US-qwerty.ts'
import { ruStandard } from './ru-standard.ts'
import { WORLD_LAYOUTS } from './world.ts'
import type {
  ClassificationResult,
  KeyLevel,
  KeyOutput,
  KeyboardLayout,
  LayoutId,
  PhysicalKeyId,
} from './types.ts'
import { LAYOUT_IDS } from './types.ts'

const LAYOUTS: Record<LayoutId, KeyboardLayout> = {
  'en-US-qwerty': enUsQwerty,
  'ar-101': ar101,
  'ru-standard': ruStandard,
  ...Object.fromEntries(WORLD_LAYOUTS.map((layout) => [layout.id, layout])),
} as Record<LayoutId, KeyboardLayout>

const IMPLEMENTED_IDS = Object.keys(LAYOUTS) as LayoutId[]

type OutputHit = {
  keyId: PhysicalKeyId
  level: KeyLevel
  consumed: number
}

function pieceFor(output: KeyOutput, level: KeyLevel): string {
  if (level === 'unshifted') return output.unshifted
  if (level === 'shifted') return output.shifted
  return output.altGr ?? ''
}

function outputIndex(layout: KeyboardLayout): OutputHit[] {
  const hits: OutputHit[] = []
  for (const [keyId, output] of Object.entries(layout.keys)) {
    if (!output) continue
    for (const level of ['unshifted', 'shifted', 'altGr'] as const) {
      const piece = pieceFor(output, level)
      if (!piece) continue
      hits.push({
        keyId: keyId as PhysicalKeyId,
        level,
        consumed: piece.length,
      })
    }
  }
  return hits.sort((a, b) => b.consumed - a.consumed)
}

function matchOutput(
  layout: KeyboardLayout,
  token: string,
  index: number,
): OutputHit | null {
  const remaining = token.slice(index)
  for (const hit of outputIndex(layout)) {
    const expected = pieceFor(layout.keys[hit.keyId]!, hit.level)
    if (expected && remaining.startsWith(expected)) return hit
  }
  return null
}

export function getLayout(layoutId: string): KeyboardLayout | undefined {
  return isSupportedLayout(layoutId) ? LAYOUTS[layoutId] : undefined
}

export function getSupportedLayouts(): KeyboardLayout[] {
  return IMPLEMENTED_IDS.map((id) => LAYOUTS[id])
}

export function getLayoutsForLanguage(language: string): KeyboardLayout[] {
  return getSupportedLayouts().filter((layout) => layout.language === language)
}

export function isSupportedLayout(layoutId: string): layoutId is LayoutId {
  return Object.hasOwn(LAYOUTS, layoutId)
}

export function layoutCharSet(layoutId: LayoutId): Set<string> {
  const layout = LAYOUTS[layoutId]
  const chars = new Set<string>()
  for (const output of Object.values(layout.keys)) {
    if (!output) continue
    for (const piece of [output.unshifted, output.shifted, output.altGr ?? '']) {
      for (const char of piece) chars.add(char)
    }
  }
  return chars
}

function isPreservedStructure(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

export function mapLayout(
  token: string,
  sourceLayout: string,
  targetLayout: string,
): string | null {
  const source = getLayout(sourceLayout)
  const target = getLayout(targetLayout)
  if (!source || !target || token.length === 0) return null

  let offset = 0
  let out = ''
  while (offset < token.length) {
    const hit = matchOutput(source, token, offset)
    if (!hit) return null
    const produced = target.keys[hit.keyId]
    if (!produced) return null
    const piece = pieceFor(produced, hit.level)
    if (!piece) return null
    out += piece
    offset += hit.consumed
  }
  return out
}

/** Same physical-key remap as `mapLayout`, for multi-word / multi-line text. */
export function mapLayoutText(
  text: string,
  sourceLayout: string,
  targetLayout: string,
): string | null {
  if (sourceLayout === targetLayout) return text
  const source = getLayout(sourceLayout)
  const target = getLayout(targetLayout)
  if (!source || !target) return null
  if (text.length === 0) return ''

  let offset = 0
  let out = ''
  while (offset < text.length) {
    const char = text[offset] ?? ''
    if (isPreservedStructure(char)) {
      out += char
      offset += 1
      continue
    }
    const hit = matchOutput(source, text, offset)
    if (!hit) {
      out += char
      offset += 1
      continue
    }
    const produced = target.keys[hit.keyId]
    const piece = produced ? pieceFor(produced, hit.level) : ''
    if (!produced || !piece) {
      out += text.slice(offset, offset + hit.consumed)
      offset += hit.consumed
      continue
    }
    out += piece
    offset += hit.consumed
  }
  return out
}

export function isValidClassification(
  value: ClassificationResult,
): value is ClassificationResult {
  if (value.kind === 'VALID') return true
  return value.kind === 'LAYOUT_MISMATCH' && isSupportedLayout(value.targetLayout)
}

export const ARABIC_GOLDEN: ReadonlyArray<readonly [string, string]> = [
  ['hsjo]lj', 'استخدمت'],
  ['hgjwldl', 'التصميم'],
  ['td', 'في'],
  ['lvpfh', 'مرحبا'],
  ['i`h', 'هذا'],
  ['hkh', 'انا'],
]

export const ARABIC_REVERSE_GOLDEN: ReadonlyArray<readonly [string, string]> = [
  ['اثممخ', 'hello'],
  ['بهىث', 'fine'],
  ['اخص', 'how'],
  ['اخصس', 'hows'],
  ['شقث', 'are'],
  ['غخع', 'you'],
  ['شىي', 'and'],
  ['يخهىل', 'doing'],
]

export const RUSSIAN_GOLDEN: ReadonlyArray<readonly [string, string]> = [
  ['ghbdtn', 'привет'],
]

export const WORLD_GOLDEN: ReadonlyArray<
  readonly [string, string, string, string]
> = [
  ['qwerty', 'azerty', 'en-US-qwerty', 'fr-azerty'],
  ['azerty', 'qwerty', 'en-US-qwerty', 'fr-azerty'],
  ['yes', 'zes', 'en-US-qwerty', 'de-qwertz'],
  ['quiz', 'quiy', 'en-US-qwerty', 'de-qwertz'],
  ['hello', 'ηελλο', 'en-US-qwerty', 'el-standard'],
  ['hello', 'יקךךם', 'en-US-qwerty', 'he-standard'],
  [';', 'ñ', 'en-US-qwerty', 'es-latam'],
  [';', 'ç', 'en-US-qwerty', 'pt-abnt'],
  ['i', 'ı', 'en-US-qwerty', 'tr-q'],
]

export function assertGoldenLayouts(): void {
  for (const [typed, expected] of ARABIC_GOLDEN) {
    const got = mapLayout(typed, 'en-US-qwerty', 'ar-101')
    if (got !== expected) {
      throw new Error(`ar-101 map failed: ${typed} → ${got} (expected ${expected})`)
    }
  }
  for (const [typed, expected] of ARABIC_REVERSE_GOLDEN) {
    const got = mapLayout(typed, 'ar-101', 'en-US-qwerty')
    if (got !== expected) {
      throw new Error(`ar-101 reverse map failed: ${typed} → ${got} (expected ${expected})`)
    }
  }
  for (const [typed, expected] of RUSSIAN_GOLDEN) {
    const got = mapLayout(typed, 'en-US-qwerty', 'ru-standard')
    if (got !== expected) {
      throw new Error(`ru-standard map failed: ${typed} → ${got} (expected ${expected})`)
    }
  }
  for (const [typed, expected, source, target] of WORLD_GOLDEN) {
    const got = mapLayout(typed, source, target)
    if (got !== expected) {
      throw new Error(`${target} map failed: ${typed} → ${got} (expected ${expected})`)
    }
  }
  for (const id of LAYOUT_IDS) {
    if (!LAYOUTS[id]) throw new Error(`missing layout table: ${id}`)
  }
}
