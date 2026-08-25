import { describe, expect, it } from 'vitest'
import {
  convertManualText,
  allConverterLayouts,
  converterChoices,
  defaultConverterPair,
  resolveConverterPair,
  swapConverterPair,
} from './convert.ts'
import { mapLayout } from './registry.ts'
import { DEFAULT_PROFILE } from './profile.ts'

describe('manual conversion — deterministic remap', () => {
  it('maps French AZERTY and German QWERTZ from the same engine', () => {
    expect(convertManualText('qwerty', 'en-US-qwerty', 'fr-azerty')).toEqual({
      ok: true,
      text: 'azerty',
    })
    expect(convertManualText('yes', 'en-US-qwerty', 'de-qwertz')).toEqual({
      ok: true,
      text: 'zes',
    })
  })

  it('maps English QWERTY to Arabic 101', () => {
    expect(convertManualText('hsjo]lj', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: 'استخدمت',
    })
    expect(convertManualText('td', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: 'في',
    })
    expect(convertManualText('hgjwldl', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: 'التصميم',
    })
  })

  it('maps Arabic 101 back to English QWERTY', () => {
    expect(convertManualText('اثممخ', 'ar-101', 'en-US-qwerty')).toEqual({
      ok: true,
      text: 'hello',
    })
  })

  it('maps a multi-word line with spaces', () => {
    expect(convertManualText('hsjo]lj td hgjwldl', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: 'استخدمت في التصميم',
    })
    expect(convertManualText('hsjo]lj  td', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: 'استخدمت  في',
    })
  })

  it('remaps mixed text with the selected pair only — no inference', () => {
    const react = mapLayout('React', 'en-US-qwerty', 'ar-101')
    expect(react).toBeTruthy()
    expect(convertManualText('hsjo]lj React td', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: `استخدمت ${react} في`,
    })
    expect(convertManualText('hello', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: 'اثممخ',
    })
  })

  it('returns empty output for empty input', () => {
    expect(convertManualText('', 'en-US-qwerty', 'ar-101')).toEqual({
      ok: true,
      text: '',
    })
  })

  it('returns the input when source and target are the same', () => {
    expect(convertManualText('hsjo]lj', 'en-US-qwerty', 'en-US-qwerty')).toEqual({
      ok: true,
      text: 'hsjo]lj',
    })
  })

  it('preserves line breaks', () => {
    expect(
      convertManualText('hsjo]lj\n\ntd\nhgjwldl', 'en-US-qwerty', 'ar-101'),
    ).toEqual({
      ok: true,
      text: 'استخدمت\n\nفي\nالتصميم',
    })
  })

  it('does not invent a mapping for an unsupported pair', () => {
    expect(convertManualText('hello', 'en-US-qwerty', 'zh-pinyin')).toEqual({
      ok: false,
      text: '',
      reason: 'unavailable',
    })
    expect(convertManualText('hello', 'ja-ime', 'ar-101')).toEqual({
      ok: false,
      text: '',
      reason: 'unavailable',
    })
  })

  it('updates when the source or target layout changes', () => {
    const forward = convertManualText('اثممخ', 'ar-101', 'en-US-qwerty')
    const reverse = convertManualText('اثممخ', 'en-US-qwerty', 'ar-101')
    expect(forward).toEqual({ ok: true, text: 'hello' })
    expect(reverse.ok).toBe(true)
    expect(reverse.text).not.toBe(forward.text)
  })
})

describe('manual conversion — selectors', () => {
  it('exposes only user-enabled implemented layouts', () => {
    expect(converterChoices(['en-US-qwerty', 'ar-101', 'zh-pinyin'])).toEqual([
      'en-US-qwerty',
      'ar-101',
    ])
    expect(converterChoices(['ru-standard'])).toEqual(['ru-standard'])
  })

  it('defaults English → Arabic from the product profile', () => {
    expect(defaultConverterPair(DEFAULT_PROFILE)).toEqual({
      sourceLayout: 'en-US-qwerty',
      targetLayout: 'ar-101',
    })
  })

  it('swaps source and target', () => {
    expect(
      swapConverterPair({
        sourceLayout: 'en-US-qwerty',
        targetLayout: 'ar-101',
      }),
    ).toEqual({
      sourceLayout: 'ar-101',
      targetLayout: 'en-US-qwerty',
    })
    const swapped = swapConverterPair({
      sourceLayout: 'ar-101',
      targetLayout: 'en-US-qwerty',
    })
    expect(convertManualText('hsjo]lj', swapped.sourceLayout, swapped.targetLayout)).toEqual({
      ok: true,
      text: 'استخدمت',
    })
  })

  it('recovers from an invalid or removed layout without crashing', () => {
    const recovered = resolveConverterPair(
      {
        sourceLayout: 'en-US-qwerty',
        enabledLayouts: ['en-US-qwerty', 'ar-101'],
      },
      { sourceLayout: 'zh-pinyin', targetLayout: 'ja-ime' },
    )
    expect(recovered).toEqual({
      sourceLayout: 'en-US-qwerty',
      targetLayout: 'ar-101',
    })
    expect(
      resolveConverterPair({
        sourceLayout: 'en-US-qwerty',
        enabledLayouts: ['en-US-qwerty'],
      }),
    ).toEqual({
      sourceLayout: 'en-US-qwerty',
      targetLayout: 'ar-101',
    })
  })

  it('lets Convert pick Arabic even when auto-correct only has English', () => {
    const profile = {
      sourceLayout: 'en-US-qwerty' as const,
      enabledLayouts: ['en-US-qwerty' as const],
    }
    expect(allConverterLayouts()).toContain('ar-101')
    expect(
      resolveConverterPair(profile, {
        sourceLayout: 'en-US-qwerty',
        targetLayout: 'ar-101',
      }),
    ).toEqual({
      sourceLayout: 'en-US-qwerty',
      targetLayout: 'ar-101',
    })
  })

  it('does not keep From and To on the same keyboard when another exists', () => {
    expect(
      resolveConverterPair(
        {
          sourceLayout: 'en-US-qwerty',
          enabledLayouts: ['en-US-qwerty', 'ar-101'],
        },
        { sourceLayout: 'en-US-qwerty', targetLayout: 'en-US-qwerty' },
      ),
    ).toEqual({
      sourceLayout: 'en-US-qwerty',
      targetLayout: 'ar-101',
    })
  })
})
