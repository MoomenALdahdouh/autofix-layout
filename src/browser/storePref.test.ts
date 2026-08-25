import { describe, expect, it } from 'vitest'
import { preferredStoreButtons } from './storePref.ts'

describe('store button preference', () => {
  it('prefers Edge when Client Hints include Microsoft Edge', () => {
    expect(
      preferredStoreButtons([
        { brand: 'Chromium' },
        { brand: 'Microsoft Edge' },
      ]),
    ).toEqual(['edge', 'chrome'])
  })

  it('prefers Chrome when Client Hints include Google Chrome', () => {
    expect(
      preferredStoreButtons([{ brand: 'Chromium' }, { brand: 'Google Chrome' }]),
    ).toEqual(['chrome', 'edge'])
  })

  it('shows both options when brands are missing or unknown', () => {
    expect(preferredStoreButtons(undefined)).toEqual(['chrome', 'edge'])
    expect(preferredStoreButtons([{ brand: 'Chromium' }])).toEqual([
      'chrome',
      'edge',
    ])
  })
})
