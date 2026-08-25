import { getSupportedLayouts } from './registry.ts'
import type { LayoutId } from './types.ts'

const LANGUAGE_TO_LAYOUT: Record<string, LayoutId> = {
  en: 'en-US-qwerty',
  ar: 'ar-101',
  ru: 'ru-standard',
  de: 'de-qwertz',
  fr: 'fr-azerty',
  tr: 'tr-q',
  he: 'he-standard',
  el: 'el-standard',
  es: 'es-latam',
  it: 'it-standard',
  pt: 'pt-abnt',
  uk: 'uk-standard',
  fa: 'fa-standard',
}

export function layoutsFromLanguages(languages: string[]): LayoutId[] {
  const implemented = new Set(getSupportedLayouts().map((layout) => layout.id))
  const found = new Set<LayoutId>()
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0] ?? ''
    const layoutId = LANGUAGE_TO_LAYOUT[base]
    if (layoutId && implemented.has(layoutId)) found.add(layoutId)
  }
  if (!found.has('en-US-qwerty')) found.add('en-US-qwerty')
  return [...found]
}
