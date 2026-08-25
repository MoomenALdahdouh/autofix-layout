import { getSupportedLayouts, isSupportedLayout, mapLayoutText } from './registry.ts'
import type { LayoutId, UserLayoutProfile } from './types.ts'

export type ConverterPair = {
  sourceLayout: LayoutId
  targetLayout: LayoutId
}

export type ManualConversion =
  | { ok: true; text: string }
  | { ok: false; text: ''; reason: 'unavailable' }

export function converterChoices(
  enabledLayouts: readonly string[],
): LayoutId[] {
  const seen = new Set<LayoutId>()
  const choices: LayoutId[] = []
  for (const id of enabledLayouts) {
    if (!isSupportedLayout(id) || seen.has(id)) continue
    seen.add(id)
    choices.push(id)
  }
  return choices
}

/** Every implemented keyboard. Convert is not limited to auto-correct layouts. */
export function allConverterLayouts(): LayoutId[] {
  return converterChoices(getSupportedLayouts().map((layout) => layout.id))
}

export function defaultConverterPair(
  profile: UserLayoutProfile,
): ConverterPair {
  const enabled = converterChoices(profile.enabledLayouts)
  const catalog = allConverterLayouts()
  const source = enabled.includes(profile.sourceLayout)
    ? profile.sourceLayout
    : (enabled[0] ?? catalog[0] ?? profile.sourceLayout)
  const target =
    enabled.find((id) => id !== source) ??
    catalog.find((id) => id !== source) ??
    source
  return { sourceLayout: source, targetLayout: target }
}

export function resolveConverterPair(
  profile: UserLayoutProfile,
  current?: { sourceLayout: string; targetLayout: string },
): ConverterPair {
  const catalog = allConverterLayouts()
  const defaults = defaultConverterPair(profile)
  if (!current || catalog.length === 0) return defaults

  const source =
    isSupportedLayout(current.sourceLayout) && catalog.includes(current.sourceLayout)
      ? current.sourceLayout
      : defaults.sourceLayout
  const target =
    isSupportedLayout(current.targetLayout) &&
    catalog.includes(current.targetLayout) &&
    current.targetLayout !== source
      ? current.targetLayout
      : (catalog.find((id) => id !== source) ?? defaults.targetLayout)
  return { sourceLayout: source, targetLayout: target }
}

export function swapConverterPair(pair: ConverterPair): ConverterPair {
  return {
    sourceLayout: pair.targetLayout,
    targetLayout: pair.sourceLayout,
  }
}

export function convertManualText(
  text: string,
  sourceLayout: string,
  targetLayout: string,
): ManualConversion {
  if (text.length === 0) return { ok: true, text: '' }
  if (sourceLayout === targetLayout) return { ok: true, text }
  if (!isSupportedLayout(sourceLayout) || !isSupportedLayout(targetLayout)) {
    return { ok: false, text: '', reason: 'unavailable' }
  }
  const mapped = mapLayoutText(text, sourceLayout, targetLayout)
  if (mapped == null) return { ok: false, text: '', reason: 'unavailable' }
  return { ok: true, text: mapped }
}
