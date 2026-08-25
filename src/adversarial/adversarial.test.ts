import { describe, expect, it } from 'vitest'
import {
  createClassificationStore,
  createCoalescer,
  parseCacheRecord,
  toCacheRecord,
} from '../cache/index.ts'
import {
  canCommitMismatch,
  inferSourceLayout,
  localClassificationHint,
  shouldCommitMismatch,
} from '../layouts/heuristics.ts'
import { isEnglishWord } from '../layouts/lexicons/en-words.ts'
import { DEFAULT_PROFILE, normalizeProfile } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'
import type { UserLayoutProfile } from '../layouts/types.ts'
import {
  ANALYZE_WORD_FIELDS,
  buildAnalyzeWordPayload,
  isSafeToken,
  payloadIsPrivacySafe,
  skipReasonForToken,
} from '../safety/index.ts'

const AR_EN: UserLayoutProfile = DEFAULT_PROFILE
const RU_EN: UserLayoutProfile = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'ru-standard'],
})
const ALL: UserLayoutProfile = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'ar-101', 'ru-standard'],
})
const EN_ONLY: UserLayoutProfile = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty'],
})

function corrected(text: string, profile = AR_EN): string {
  return applyFixesToText(text, planFieldFixes(text, profile, { finalizeAll: true }))
}

function mustNotChange(text: string, profile: UserLayoutProfile = AR_EN): void {
  expect(corrected(text, profile), `corrupted: ${text}`).toBe(text)
}

describe('A. implemented multilingual text', () => {
  it('keeps real Arabic, English, and Russian as typed', () => {
    mustNotChange('الاداة يجب ان تكون دقيقة')
    mustNotChange('hello how are you')
    mustNotChange('привет', RU_EN)
    mustNotChange('hello привет React', ALL)
  })

  it('does not invent remaps for unimplemented Latin/Hebrew text', () => {
    for (const text of [
      'ich bin hier und nicht dort',
      'je suis ici et pas là',
      'merhaba nasılsın bir ve bu',
      'שלום עולם',
      'Guten Tag zusammen',
      'Bonjour le monde',
    ]) {
      mustNotChange(text, ALL)
    }
  })

  it('still applies verified goldens', () => {
    expect(corrected('hsjo]lj React td hgjwldl')).toBe('استخدمت React في التصميم')
    expect(corrected('اثممخ اخص شقث غخع')).toBe('hello how are you')
    expect(corrected('ghbdtn', RU_EN)).toBe('привет')
  })

  it('only searches layouts the user enabled', () => {
    for (const text of ['hsjo]lj', 'lvpfh', 'td', 'hgjwldl', 'ghbdtn']) {
      mustNotChange(text, EN_ONLY)
    }
    mustNotChange('hsjo]lj React td lvpfh', RU_EN)
    expect(corrected('hello ghbdtn', RU_EN)).toBe('hello привет')
    expect(inferSourceLayout('اثممخ', EN_ONLY)).toBeNull()
    expect(inferSourceLayout('привет', EN_ONLY)).toBeNull()
    expect(
      canCommitMismatch(EN_ONLY, 'hsjo]lj', 'ar-101', 'استخدمت'),
    ).toBe(false)
    expect(
      canCommitMismatch(RU_EN, 'hsjo]lj', 'ar-101', 'استخدمت'),
    ).toBe(false)
    expect(normalizeProfile({
      sourceLayout: 'en-US-qwerty',
      enabledLayouts: ['en-US-qwerty', 'zh-pinyin' as never],
    }).enabledLayouts).toEqual(['en-US-qwerty'])
  })
})

describe('B. mixed-language sentences', () => {
  it('evaluates each token independently', () => {
    expect(corrected('hello اخص شقث غخع')).toBe('hello how are you')
    expect(corrected('كيف حالك merhaba', ALL)).toBe('كيف حالك merhaba')
    expect(corrected('hello ghbdtn React', RU_EN)).toBe('hello привет React')
    expect(corrected('hsjo]lj React привет td', ALL)).toBe('استخدمت React привет في')
  })

  it('restores Arabic typed on QWERTY and leaves intended English', () => {
    expect(corrected('lvpfh i`h hkh how are you')).toBe('مرحبا هذا انا how are you')
    expect(corrected('lvpfh how are you')).toBe('مرحبا how are you')
    expect(corrected('hkh')).toBe('انا')
    expect(corrected('lvpfh')).toBe('مرحبا')
  })

  it('never translates or unifies an already-correct mixed sentence', () => {
    mustNotChange('مرحبا هذا انا how are you')
    mustNotChange('مرحبا React هذا المشروع is working')
    mustNotChange('أنا أستخدم React to build this')
    mustNotChange('كيف حالك today I am fine')
    mustNotChange('مرحبا React هذا project يعمل well')
    mustNotChange('مرحبا React API v2 هذا يعمل')
  })

  it('fixes only mismatched tokens beside already-correct Arabic and English', () => {
    expect(corrected('مرحبا hsjo]lj React td كيف')).toBe(
      'مرحبا استخدمت React في كيف',
    )
    expect(corrected('how lvpfh are you')).toBe('how مرحبا are you')
  })
})

describe('C. technical writing', () => {
  it('never rewrites brands, protocols, or identifiers', () => {
    const block = [
      'React',
      'Laravel',
      'FastAPI',
      'PostgreSQL',
      'OpenAI',
      'ChatGPT',
      'GitHub',
      'API',
      'JSON',
      'HTTP',
      'camelCase',
      'snake_case',
      'PascalCase',
      'foo()',
      'getUserById',
    ].join(' ')
    mustNotChange(block, ALL)
    for (const token of ['camelCase', 'snake_case', 'PascalCase', 'getUserById']) {
      expect(isSafeToken(token)).toBe(false)
    }
  })
})

describe('D. URLs and emails', () => {
  it('never transforms URLs or emails', () => {
    for (const token of [
      'https://example.com',
      'user@example.com',
      'https://example.com/path?q=test',
    ]) {
      expect(skipReasonForToken(token)).toMatch(/url|email/)
      mustNotChange(token)
      mustNotChange(`see ${token} please`)
    }
  })
})

describe('E. sensitive data never reaches the backend', () => {
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'

  it('filters secrets locally and keeps the field unchanged', () => {
    const secrets = [
      ['sk-abcdefghijklmnopqrstuvwxyz', 'api-key'],
      [JWT, 'jwt'],
      ['ghp_abcdefghijklmnopqrstuv', 'api-key'],
      ['Bearer abcdefghijklmnop', 'access-token'],
      ['4111 1111 1111 1111', 'credit-card'],
      ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI', 'env-secret'],
    ] as const
    for (const [token, reason] of secrets) {
      expect(skipReasonForToken(token), token).toBe(reason)
      expect(isSafeToken(token)).toBe(false)
      mustNotChange(`note ${token} here`)
    }
    expect(skipReasonForToken('BEGIN', '-----BEGIN PRIVATE KEY-----')).toBe(
      'private-key',
    )
  })

  it('backend payloads only carry the allowed privacy fields', () => {
    const payload = buildAnalyzeWordPayload({
      license_key: 'lsq_test',
      word: 'hsjo]lj',
      context: 'React td',
      source_layout: 'en-US-qwerty',
      candidate_layouts: ['en-US-qwerty', 'ar-101'],
    })
    expect(payloadIsPrivacySafe(payload)).toBe(true)
    expect(Object.keys(payload).sort()).toEqual([...ANALYZE_WORD_FIELDS].sort())
    expect(payload).not.toHaveProperty('url')
    expect(payload).not.toHaveProperty('html')
    expect(JSON.stringify(payload)).not.toMatch(/password|history|keystroke/i)
  })
})

describe('J. false positives / uncertain → no-op', () => {
  it('leaves a large short-token English corpus untouched', () => {
    const words = [
      'to', 'in', 'or', 'if', 'at', 'is', 'on', 'an', 'of', 'it', 'be',
      'we', 'he', 'me', 'my', 'do', 'so', 'up', 'no', 'us', 'am', 'as',
      'by', 'go', 'ok', 'hi', 'the', 'and', 'for', 'you', 'are', 'was',
      'not', 'but', 'all', 'can', 'had', 'her', 'him', 'his', 'how',
      'its', 'let', 'may', 'our', 'out', 'own', 'say', 'she', 'too',
      'use', 'who', 'why', 'yes', 'yet',
    ]
    for (const word of words) {
      expect(isEnglishWord(word), word).toBe(true)
      mustNotChange(word, ALL)
      expect(localClassificationHint(word, ALL)?.kind ?? 'VALID').toBe('VALID')
    }
  })

  it('rejects an uncertain API mismatch so it cannot write the DOM', () => {
    expect(
      shouldCommitMismatch('Laravel', 'ar-101', 'لارفيل', ''),
    ).toBe(false)
    expect(shouldCommitMismatch('hsjo]lj', 'ar-101', 'استخدمت', '')).toBe(true)
    expect(shouldCommitMismatch('td', 'ar-101', 'في', '')).toBe(false)
    expect(shouldCommitMismatch('td', 'ar-101', 'في', 'hsjo]lj React')).toBe(true)
    expect(shouldCommitMismatch('ghbdtn', 'ru-standard', 'привет', '')).toBe(true)
    expect(shouldCommitMismatch('zzzz', 'ru-standard', 'яяяя', '')).toBe(false)
    expect(shouldCommitMismatch('lvpfh', 'ar-101', 'مرحبا', '')).toBe(true)
    expect(shouldCommitMismatch('hkh', 'ar-101', 'انا', '')).toBe(true)
    expect(shouldCommitMismatch('gh', 'ar-101', 'لا', '')).toBe(false)
    expect(shouldCommitMismatch('asdf', 'ar-101', 'شسيب', '')).toBe(false)
    expect(shouldCommitMismatch('foo', 'ru-standard', 'ащщ', 'привет')).toBe(false)
    expect(shouldCommitMismatch('rfr', 'ru-standard', 'как', 'привет')).toBe(false)
    expect(localClassificationHint('foo', RU_EN, 'привет')?.kind ?? 'VALID').toBe(
      'VALID',
    )
  })

  it('does not randomly remap unknown Latin when intent is unclear', () => {
    for (const word of ['foo', 'zzzz', 'qqqq', 'Laravel', 'und', 'nicht', 'bonjour', 'asdf', 'gh']) {
      mustNotChange(word, ALL)
      mustNotChange(`${word} ${word}`, ALL)
      mustNotChange(`привет ${word}`, RU_EN)
      expect(corrected(`ghbdtn ${word}`, RU_EN)).toBe(`привет ${word}`)
    }
  })
})

describe('K. boundaries and punctuation', () => {
  it('remaps the word and leaves adjacent punctuation in place', () => {
    expect(corrected('hsjo]lj.')).toBe('استخدمت.')
    expect(corrected('hsjo]lj!')).toBe('استخدمت!')
    expect(corrected('hsjo]lj?')).toBe('استخدمت?')
    expect(corrected('hsjo]lj;')).toBe('استخدمت;')
    expect(corrected('hsjo]lj:')).toBe('استخدمت:')
    expect(corrected('hsjo]lj,')).toBe('استخدمت,')
    expect(corrected('hsjo]lj  ')).toBe('استخدمت  ')
    expect(corrected('hsjo]lj\nnext')).toBe('استخدمت\nnext')
  })

  it('does not treat comma/period as a reason to rewrite English', () => {
    mustNotChange('hello, world.')
    mustNotChange('Wait; then: go!')
  })
})

describe('H. cache integrity', () => {
  it('serves warm hits, drops expired and corrupt rows, and hydrates after restart', async () => {
    let now = 1_000
    const disk: { current: unknown } = { current: null }
    const first = createClassificationStore({
      ttlMs: 100,
      now: () => now,
      persistence: {
        load: async () => disk.current,
        save: async (entries) => {
          disk.current = entries
        },
      },
    })
    const key = 'hsjo]lj|en-US-qwerty|ar-101,en-US-qwerty'
    first.set(
      key,
      toCacheRecord(
        { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' },
        { corrected: 'استخدمت', ts: now },
      ),
    )
    expect(first.get(key)?.corrected).toBe('استخدمت')
    await first.flush()

    const restarted = createClassificationStore({
      ttlMs: 100,
      now: () => now,
      persistence: {
        load: async () => disk.current,
        save: async (entries) => {
          disk.current = entries
        },
      },
    })
    await restarted.ready()
    expect(restarted.get(key)?.corrected).toBe('استخدمت')

    now = 1_200
    expect(restarted.get(key)).toBeUndefined()

    const tab = createClassificationStore()
    tab.memory.hydrate({
      good: toCacheRecord({ kind: 'VALID' }, { ts: Date.now() }),
      junk: { kind: 'BOOM' },
    })
    expect(tab.get('good')?.result).toEqual({ kind: 'VALID' })
    expect(tab.get('junk')).toBeUndefined()
    expect(parseCacheRecord({ html: '<p>no</p>' })).toBeNull()
  })
})

describe('I. offline behavior', () => {
  it('uses a known cache entry and leaves unknown tokens unchanged', () => {
    const store = createClassificationStore()
    const key = 'hsjo]lj|en-US-qwerty|ar-101,en-US-qwerty'
    store.set(
      key,
      toCacheRecord(
        { kind: 'LAYOUT_MISMATCH', targetLayout: 'ar-101' },
        { corrected: 'استخدمت' },
      ),
    )
    expect(store.get(key)?.corrected).toBe('استخدمت')
    expect(store.get('unknown|en-US-qwerty|ar-101')).toBeUndefined()
    mustNotChange('unknownTokenOffline')
  })
})

describe('H/I. coalesced misses do not invent writes', () => {
  it('shares one inflight classification and does not cache a failure', async () => {
    let runs = 0
    const coalesce = createCoalescer<null>()
    const failed = () => {
      runs += 1
      return Promise.resolve(null)
    }
    await Promise.all([coalesce('td', failed), coalesce('td', failed)])
    expect(runs).toBe(1)
    const store = createClassificationStore()
    expect(store.set('td', parseCacheRecord({ kind: 'NETWORK' }) as never)).toBe(false)
  })
})
