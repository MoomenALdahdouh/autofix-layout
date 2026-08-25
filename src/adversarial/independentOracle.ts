import { ar101 } from '../layouts/ar-101.ts'
import { enUsQwerty } from '../layouts/en-US-qwerty.ts'
import { ruStandard } from '../layouts/ru-standard.ts'
import { WORLD_LAYOUTS } from '../layouts/world.ts'
import type { KeyboardLayout, KeyLevel, PhysicalKeyId } from '../layouts/types.ts'

/**
 * Independent physical-key remapper used only as campaign ground truth.
 * It reads the same layout tables as production but does not call mapLayout.
 */
const TABLES: Record<string, KeyboardLayout> = {
  'en-US-qwerty': enUsQwerty,
  'ar-101': ar101,
  'ru-standard': ruStandard,
  ...Object.fromEntries(WORLD_LAYOUTS.map((layout) => [layout.id, layout])),
}

type Hit = { keyId: PhysicalKeyId; level: KeyLevel; consumed: number }

function piece(layout: KeyboardLayout, keyId: PhysicalKeyId, level: KeyLevel): string {
  const output = layout.keys[keyId]
  if (!output) return ''
  if (level === 'unshifted') return output.unshifted
  if (level === 'shifted') return output.shifted
  return output.altGr ?? ''
}

function inventory(layout: KeyboardLayout): Hit[] {
  const hits: Hit[] = []
  for (const keyId of Object.keys(layout.keys) as PhysicalKeyId[]) {
    for (const level of ['unshifted', 'shifted', 'altGr'] as const) {
      const text = piece(layout, keyId, level)
      if (!text) continue
      hits.push({ keyId, level, consumed: text.length })
    }
  }
  return hits.sort((left, right) => right.consumed - left.consumed)
}

export function oracleMap(
  text: string,
  sourceId: string,
  targetId: string,
): string | null {
  if (sourceId === targetId) return text
  const source = TABLES[sourceId]
  const target = TABLES[targetId]
  if (!source || !target) return null
  if (text.length === 0) return ''

  const hits = inventory(source)
  let offset = 0
  let out = ''
  while (offset < text.length) {
    const rest = text.slice(offset)
    const hit = hits.find((item) => {
      const expected = piece(source, item.keyId, item.level)
      return expected.length > 0 && rest.startsWith(expected)
    })
    if (!hit) return null
    const produced = piece(target, hit.keyId, hit.level)
    if (!produced) return null
    out += produced
    offset += hit.consumed
  }
  return out
}

export function oracleMapText(
  text: string,
  sourceId: string,
  targetId: string,
): string | null {
  if (sourceId === targetId) return text
  if (!TABLES[sourceId] || !TABLES[targetId]) return null
  return text.replace(/[^\s]+/g, (token) => {
    const mapped = oracleMap(token, sourceId, targetId)
    return mapped ?? token
  })
}

export const ORACLE_LAYOUT_IDS = Object.keys(TABLES)
