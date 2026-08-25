import { ARABIC_GOLDEN, assertGoldenLayouts, mapLayout } from './layouts/index.ts'

/** @deprecated Use mapLayout(token, 'en-US-qwerty', 'ar-101') */
export const GOLDEN_REMAPS = ARABIC_GOLDEN

/** @deprecated Use mapLayout */
export function mapEnKeysToArabic(token: string): string {
  return mapLayout(token, 'en-US-qwerty', 'ar-101') ?? token
}

export function assertGoldenRemaps(): void {
  assertGoldenLayouts()
}
