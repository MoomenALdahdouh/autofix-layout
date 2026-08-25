import { isArabicWord } from '../layouts/lexicons/ar-words.ts'
import { isEnglishWord } from '../layouts/lexicons/en-words.ts'
import { DEFAULT_PROFILE, normalizeProfile } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'
import { inferSourceLayout, localClassificationHint } from '../layouts/heuristics.ts'
import { mapLayout } from '../layouts/registry.ts'
import type { LayoutId, UserLayoutProfile } from '../layouts/types.ts'
import { isSafeToken, skipReasonForToken } from '../safety/tokenKind.ts'
import { tokenizeText } from '../safety/tokenize.ts'
import { remapToken, remapWords, runPlanner } from './realWorldCorpus.ts'

export const AR_OS_PROFILE = normalizeProfile({
  sourceLayout: 'ar-101',
  enabledLayouts: ['ar-101', 'en-US-qwerty'],
})

export type MixedKind = 'must_keep' | 'must_fix' | 'partial_fix' | 'safety_keep'
export type MixedCategory =
  | 'A_ar_en'
  | 'B_en_ar'
  | 'C_ar_en_ar'
  | 'D_en_ar_en'
  | 'E_punct'
  | 'F_symbol'
  | 'G_wrong_en'
  | 'H_wrong_ar'
  | 'I_rapid'
  | 'J_long'
  | 'os_vs_intent'
  | 'short'
  | 'contraction'
  | 'case'
  | 'number'
  | 'email'
  | 'url'
  | 'tech'
  | 'name'
  | 'protected'
  | 'adjacent_symbol'
  | 'segment'
  | 'partial'
  | 'trigger'
  | 'correct_mixed'

export type MixedCase = {
  id: string
  category: MixedCategory
  kind: MixedKind
  input: string
  expected: string
  notes?: string
}

export type MixedClass =
  | 'PASS'
  | 'FALSE_POSITIVE'
  | 'FALSE_NEGATIVE'
  | 'CORRUPTION'
  | 'PARTIAL_OK'
  | 'EXPECTED_NOOP'

export type TokenAnalysisRow = {
  token: string
  actualText: string
  script: string
  unicode: string
  arabicWord: boolean
  englishWord: boolean
  reverseArToEn: string | null
  candidateLanguage: string
  sourceDefault: string | null
  sourceArabicOs: string | null
  protected: boolean
  context: string
  expectedAction: string
  confidence: string
}

const AR_PHRASES = [
  'مرحبا',
  'كيف حالك',
  'أنا بخير',
  'هذا أنا',
  'هل يمكن',
  'نعم يمكن',
  'شكرا',
  'أهلا',
  'السلام عليكم',
  'في التصميم',
  'استخدمت هذا',
  'كيف هذا',
  'هو بخير',
  'نحن بخير',
  'نعم أنا بخير',
  'هذا نص صحيح',
] as const

const EN_PHRASES = [
  'hello',
  'how are you',
  'this is a test',
  'i am here',
  'thank you',
  'see you',
  'good morning',
  'i can help',
  'please wait',
  'the file is ready',
  'today',
  'and you',
  'i am fine',
  'this is good',
  'we are here',
  'how are you today',
] as const

const TECH = ['React', 'Laravel', 'Python', 'Git', 'Docker'] as const
const NAMES = ['John', 'محمد', 'OpenAI'] as const
const NUMBERS = ['123', '2026', '10:30'] as const
const SYMBOLS = ['÷', '+', '-', '=', '/', '*', '&', '@', '#', '%'] as const
const SHORT_EN = ['I', 'am', 'in', 'to', 'of', 'and', 'or'] as const
const SHORT_AR = ['في', 'من', 'أنا', 'هو'] as const
const CONTRACTIONS = ["I'm", "I've", "I'll", "don't", "can't", "we're", "you're"] as const
const CASE_WORDS = ['Hello', 'HELLO', 'hello', 'Friend', 'FRIEND', 'friend'] as const
const PROTECTED = [
  'test@example.com',
  'https://example.com',
  'github.com/user/project',
  'sk-not-a-real-key-value-xxxxx',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '550e8400-e29b-41d4-a716-446655440000',
  '/usr/bin/env',
  'getUserById',
  'API_ENDPOINT',
  '4111111111111111',
] as const

const OOV_ENGLISH = ['xyzzy', 'qwertyfoo', 'blorple'] as const

function scriptOf(token: string): string {
  if (/^[\u0600-\u06FF]+$/u.test(token)) return 'Arabic'
  if (/^[A-Za-z]+$/u.test(token)) return 'Latin'
  if (/^\d+$/u.test(token)) return 'Number'
  if (/^[^\p{L}\p{N}]+$/u.test(token)) return 'Symbol/Punct'
  return 'Mixed'
}

function recoverableEnglish(word: string): boolean {
  const mapped = mapLayout(word, 'en-US-qwerty', 'ar-101')
  if (!mapped) return false
  return mapLayout(mapped, 'ar-101', 'en-US-qwerty') === word && isEnglishWord(word)
}

function recoverableArabic(word: string): boolean {
  const mapped = mapLayout(word, 'ar-101', 'en-US-qwerty')
  if (!mapped) return false
  return mapLayout(mapped, 'en-US-qwerty', 'ar-101') === word && isArabicWord(word)
}

function remapEnglishWords(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part
      const word = part.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '')
      if (word && recoverableEnglish(word)) return remapToken(part, 'en-US-qwerty', 'ar-101')
      return part
    })
    .join('')
}

function remapArabicWords(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part
      const word = part.replace(/^[^\u0600-\u06FF]+|[^\u0600-\u06FF]+$/g, '')
      if (word && recoverableArabic(word)) return remapToken(part, 'ar-101', 'en-US-qwerty')
      return part
    })
    .join('')
}

function remapSelected(
  text: string,
  predicate: (word: string, index: number, words: string[]) => boolean,
  from: LayoutId,
  to: LayoutId,
): string {
  const parts = text.split(/(\s+)/)
  let wordIndex = -1
  const words = parts.filter((part) => !/^\s+$/.test(part))
  return parts
    .map((part) => {
      if (/^\s+$/.test(part)) return part
      wordIndex += 1
      return predicate(part, wordIndex, words) ? remapToken(part, from, to) : part
    })
    .join('')
}

function keep(id: string, category: MixedCategory, input: string, notes?: string): MixedCase {
  return { id, category, kind: 'must_keep', input, expected: input, notes }
}

function fix(
  id: string,
  category: MixedCategory,
  intended: string,
  input: string,
  notes?: string,
): MixedCase {
  return { id, category, kind: 'must_fix', input, expected: intended, notes }
}

function partial(
  id: string,
  category: MixedCategory,
  input: string,
  expected: string,
  notes?: string,
): MixedCase {
  return { id, category, kind: 'partial_fix', input, expected, notes }
}

function safety(id: string, input: string): MixedCase {
  return {
    id,
    category: 'protected',
    kind: 'safety_keep',
    input,
    expected: input,
    notes: skipReasonForToken(input) ?? 'keep',
  }
}

export function analyzeTriggerExample(): TokenAnalysisRow[] {
  const text = 'مرحبا كيف حالك hello how are you ÷ am بهىث and you'
  const { tokens, pieces } = tokenizeText(text)
  const rows = tokens.map((span) => {
    const token = span.token
    const reverseArToEn = mapLayout(token, 'ar-101', 'en-US-qwerty')
    const arabicWord = isArabicWord(token)
    const englishWord = isEnglishWord(token)
    const sourceDefault = inferSourceLayout(token, DEFAULT_PROFILE)
    const sourceArabicOs = inferSourceLayout(token, AR_OS_PROFILE)
    const mappedEnglish = reverseArToEn && isEnglishWord(reverseArToEn)
    let expectedAction = 'KEEP'
    let confidence = 'high'
    let candidateLanguage = scriptOf(token) === 'Arabic' ? 'ar' : scriptOf(token) === 'Latin' ? 'en' : 'none'
    if (token === '÷') {
      expectedAction = 'NO-OP'
      confidence = 'symbol'
      candidateLanguage = 'symbol (Shift+I → I if treated as a letter)'
    } else if (arabicWord) {
      expectedAction = 'KEEP'
      candidateLanguage = 'ar'
    } else if (englishWord) {
      expectedAction = 'KEEP'
      candidateLanguage = 'en'
    } else if (mappedEnglish) {
      expectedAction = 'CONVERT'
      candidateLanguage = 'en'
      confidence = 'high'
    } else if (reverseArToEn && !englishWord && scriptOf(token) === 'Arabic') {
      expectedAction = 'NO-OP'
      candidateLanguage = 'unknown / possible en'
      confidence = 'low'
    }
    return {
      token,
      actualText: token,
      script: scriptOf(token),
      unicode: [...token]
        .map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
        .join(' '),
      arabicWord,
      englishWord,
      reverseArToEn,
      candidateLanguage,
      sourceDefault,
      sourceArabicOs,
      protected: !isSafeToken(token, '', span.raw),
      context: span.context,
      expectedAction,
      confidence,
    }
  })
  const symbolPieces = pieces.filter(
    (piece) => piece.kind === 'delimiter' && /[÷×]/.test(piece.value),
  )
  for (const piece of symbolPieces) {
    const token = piece.value
    rows.splice(
      tokens.findIndex((span) => span.start > piece.start) === -1
        ? rows.length
        : tokens.findIndex((span) => span.start > piece.start),
      0,
      {
        token,
        actualText: token,
        script: 'Symbol/Punct',
        unicode: [...token]
          .map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
          .join(' '),
        arabicWord: false,
        englishWord: false,
        reverseArToEn: mapLayout(token, 'ar-101', 'en-US-qwerty'),
        candidateLanguage: 'symbol (Arabic 101 Shift+I → I if treated as a letter)',
        sourceDefault: inferSourceLayout(token, DEFAULT_PROFILE),
        sourceArabicOs: inferSourceLayout(token, AR_OS_PROFILE),
        protected: true,
        context: text.slice(0, piece.start).trim(),
        expectedAction: 'NO-OP',
        confidence: 'symbol',
      },
    )
  }
  return rows
}

export function triggerExpected(): { typed: string; expected: string; friendKeys: string } {
  return {
    typed: 'مرحبا كيف حالك hello how are you ÷ am بهىث and you',
    expected: 'مرحبا كيف حالك hello how are you ÷ am fine and you',
    friendKeys: mapLayout('friend', 'en-US-qwerty', 'ar-101') ?? '',
  }
}

function cartesianKeep(): MixedCase[] {
  const cases: MixedCase[] = []
  AR_PHRASES.forEach((ar, arIndex) => {
    EN_PHRASES.forEach((en, enIndex) => {
      cases.push(keep(`A-${arIndex}-${enIndex}`, 'A_ar_en', `${ar} ${en}`))
      cases.push(keep(`B-${arIndex}-${enIndex}`, 'B_en_ar', `${en} ${ar}`))
    })
  })
  return cases
}

function transitionKeeps(): MixedCase[] {
  const cases: MixedCase[] = []
  const ar = AR_PHRASES
  const en = EN_PHRASES
  for (let i = 0; i < ar.length; i += 1) {
    const a = ar[i]!
    const e = en[i]!
    const a2 = ar[(i + 1) % ar.length]!
    const e2 = en[(i + 1) % en.length]!
    cases.push(keep(`C-${i}`, 'C_ar_en_ar', `${a} ${e} ${a2}`))
    cases.push(keep(`D-${i}`, 'D_en_ar_en', `${e} ${a} ${e2}`))
    cases.push(keep(`E-comma-${i}`, 'E_punct', `${a}، ${e}، ${a2}؟`))
    cases.push(keep(`E-bang-${i}`, 'E_punct', `${e}! ${a}! ${e2}?`))
    cases.push(keep(`E-dash-${i}`, 'E_punct', `${a} — ${e} — ${a2}؟`))
    cases.push(keep(`F-div-${i}`, 'F_symbol', `${a} ${e} ÷ ${e2}`))
    cases.push(keep(`I-${i}`, 'I_rapid', `${a} ${e.split(' ')[0]} ${a2} ${e2.split(' ')[0]}`))
    cases.push(
      keep(
        `J-${i}`,
        'J_long',
        `${a} ${e} ${a2} ${e2} this is a test ${ar[(i + 2) % ar.length]} today`,
      ),
    )
  }
  return cases
}

function extraKeeps(): MixedCase[] {
  const cases: MixedCase[] = []
  NUMBERS.forEach((num, i) => {
    cases.push(keep(`num-ar-en-${i}`, 'number', `مرحبا ${num} hello`))
    cases.push(keep(`num-en-ar-${i}`, 'number', `hello ${num} مرحبا`))
  })
  cases.push(keep('num-time', 'number', 'hello 10:30 كيف حالك'))
  cases.push(keep('email-ar', 'email', 'مرحبا test@example.com كيف حالك'))
  cases.push(keep('email-en', 'email', 'hello user@example.com مرحبا'))
  cases.push(keep('url-ar', 'url', 'مرحبا https://example.com كيف حالك'))
  cases.push(keep('url-en', 'url', 'hello github.com/user/project مرحبا'))
  TECH.forEach((term, i) => {
    cases.push(keep(`tech-${i}-a`, 'tech', `مرحبا ${term} component جديد`))
    cases.push(keep(`tech-${i}-b`, 'tech', `أنا أستخدم ${term} today`))
    cases.push(keep(`tech-${i}-c`, 'tech', `hello ${term} في المشروع`))
  })
  NAMES.forEach((name, i) => {
    cases.push(keep(`name-${i}-a`, 'name', `مرحبا ${name} كيف حالك`))
    cases.push(keep(`name-${i}-b`, 'name', `hello ${name} how are you`))
  })
  SHORT_EN.forEach((word, i) => {
    cases.push(keep(`short-en-${i}`, 'short', `مرحبا ${word} you`))
  })
  SHORT_AR.forEach((word, i) => {
    cases.push(keep(`short-ar-${i}`, 'short', `hello ${word} today`))
  })
  CONTRACTIONS.forEach((word, i) => {
    cases.push(keep(`contr-ar-${i}`, 'contraction', `مرحبا ${word} here`))
    cases.push(keep(`contr-mid-${i}`, 'contraction', `أنا ${word} know`))
    cases.push(keep(`contr-en-${i}`, 'contraction', `hello ${word} هنا`))
  })
  CASE_WORDS.forEach((word, i) => {
    cases.push(keep(`case-${i}`, 'case', `مرحبا ${word} how are you`))
  })
  SYMBOLS.forEach((sym, i) => {
    cases.push(keep(`sym-space-${i}`, 'F_symbol', `مرحبا hello ${sym} how are you`))
  })
  cases.push(
    keep('adj-hyphen', 'adjacent_symbol', 'hello-world'),
    keep('adj-under', 'adjacent_symbol', 'hello_world'),
    keep('adj-plus', 'adjacent_symbol', 'hello+world'),
    keep('adj-eq', 'adjacent_symbol', 'hello=world'),
    keep('adj-slash', 'adjacent_symbol', 'hello / world'),
    keep('adj-div-space', 'adjacent_symbol', 'hello ÷ world'),
    keep('correct-mixed-1', 'correct_mixed', 'مرحبا هذا نص عربي صحيح hello this is English'),
    keep('correct-mixed-2', 'correct_mixed', 'مرحبا كيف حالك hello how are you'),
    keep('correct-mixed-3', 'correct_mixed', 'أنا working on the project الآن'),
    keep('correct-mixed-4', 'correct_mixed', 'hello API في المشروع'),
    keep('correct-mixed-5', 'correct_mixed', 'Python code يعمل الآن'),
  )
  return cases
}

function wrongLayoutFixes(): MixedCase[] {
  const cases: MixedCase[] = []
  AR_PHRASES.forEach((ar, arIndex) => {
    EN_PHRASES.forEach((en, enIndex) => {
      const intendedA = `${ar} ${en}`
      cases.push(
        fix(
          `G-${arIndex}-${enIndex}`,
          'G_wrong_en',
          intendedA,
          `${ar} ${remapEnglishWords(en)}`,
          'OS Arabic; English typed through Arabic 101',
        ),
      )
      const intendedB = `${en} ${ar}`
      cases.push(
        fix(
          `H-${arIndex}-${enIndex}`,
          'H_wrong_ar',
          intendedB,
          `${en} ${remapArabicWords(ar)}`,
          'OS English; Arabic typed through US QWERTY',
        ),
      )
    })
  })
  EN_PHRASES.forEach((en, i) => {
    const ar = AR_PHRASES[i % AR_PHRASES.length]!
    const ar2 = AR_PHRASES[(i + 3) % AR_PHRASES.length]!
    const intended = `${ar} ${en} ${ar2}`
    cases.push(
      fix(
        `C-fix-${i}`,
        'C_ar_en_ar',
        intended,
        `${ar} ${remapEnglishWords(en)} ${ar2}`,
        'middle English segment through Arabic 101',
      ),
    )
    const intendedD = `${en} ${ar} ${EN_PHRASES[(i + 1) % EN_PHRASES.length]}`
    cases.push(
      fix(
        `D-fix-${i}`,
        'D_en_ar_en',
        intendedD,
        `${en} ${remapArabicWords(ar)} ${EN_PHRASES[(i + 1) % EN_PHRASES.length]}`,
        'middle Arabic segment through US QWERTY',
      ),
    )
  })
  return cases
}

function osIntentMatrix(): MixedCase[] {
  return [
    keep('os-ar-intent-ar', 'os_vs_intent', 'مرحبا كيف حالك', 'OS Arabic, intent Arabic'),
    fix(
      'os-ar-intent-en',
      'os_vs_intent',
      'hello how are you',
      remapWords('hello how are you', 'en-US-qwerty', 'ar-101'),
      'OS Arabic, intent English',
    ),
    keep('os-en-intent-en', 'os_vs_intent', 'hello how are you', 'OS English, intent English'),
    fix(
      'os-en-intent-ar',
      'os_vs_intent',
      'مرحبا كيف حالك',
      remapWords('مرحبا كيف حالك', 'ar-101', 'en-US-qwerty'),
      'OS English, intent Arabic',
    ),
    fix(
      'os-ar-alternate',
      'os_vs_intent',
      'مرحبا hello كيف حالك today',
      `مرحبا ${remapEnglishWords('hello')} كيف حالك ${remapEnglishWords('today')}`,
      'OS Arabic, alternating intent',
    ),
  ]
}

function segmentCorruption(): MixedCase[] {
  const intended = 'مرحبا hello how are you كيف حالك today'
  const words = intended.split(' ')
  const cases: MixedCase[] = []
  words.forEach((word, index) => {
    if (!recoverableEnglish(word)) return
    const input = words.map((item, i) => (i === index ? remapToken(item, 'en-US-qwerty', 'ar-101') : item)).join(' ')
    cases.push(fix(`seg-one-${index}`, 'segment', intended, input, 'one English token wrong'))
  })
  const two = remapSelected(
    intended,
    (_word, index) => index === 1 || index === 6,
    'en-US-qwerty',
    'ar-101',
  )
  cases.push(fix('seg-two', 'segment', intended, two, 'two English tokens wrong'))
  const everySecond = remapSelected(
    intended,
    (word, index) => recoverableEnglish(word) && index % 2 === 1,
    'en-US-qwerty',
    'ar-101',
  )
  cases.push(fix('seg-every-second', 'segment', intended, everySecond, 'every second recoverable English token'))
  cases.push(
    fix(
      'seg-whole-en',
      'segment',
      intended,
      `مرحبا ${remapEnglishWords('hello how are you')} كيف حالك ${remapEnglishWords('today')}`,
      'entire English segments wrong',
    ),
    fix(
      'seg-begin',
      'segment',
      'hello مرحبا how are you',
      `${remapEnglishWords('hello')} مرحبا how are you`,
      'wrong-layout at beginning',
    ),
    fix(
      'seg-mid',
      'segment',
      'مرحبا hello كيف',
      `مرحبا ${remapEnglishWords('hello')} كيف`,
      'wrong-layout in middle',
    ),
    fix(
      'seg-end',
      'segment',
      'مرحبا كيف hello',
      `مرحبا كيف ${remapEnglishWords('hello')}`,
      'wrong-layout at end',
    ),
  )
  return cases
}

function partialCases(): MixedCase[] {
  const cases: MixedCase[] = []
  const easy = remapEnglishWords('hello how are you')
  OOV_ENGLISH.forEach((oov, i) => {
    const oovAr = remapWords(oov, 'en-US-qwerty', 'ar-101')
    cases.push(
      partial(
        `partial-oov-${i}`,
        'partial',
        `${easy} ${oovAr}`,
        `hello how are you ${oovAr}`,
        'recover lexicon English; leave OOV',
      ),
    )
  })
  cases.push(
    partial(
      'partial-name',
      'partial',
      `${remapEnglishWords('hello')} John ${remapEnglishWords('how are you')}`,
      'hello John how are you',
      'name stays; lexicon English recovers',
    ),
    partial(
      'partial-tech',
      'partial',
      `${remapEnglishWords('hello')} React ${remapEnglishWords('today')}`,
      'hello React today',
      'technical term stays',
    ),
    partial(
      'partial-symbol',
      'partial',
      `${remapEnglishWords('hello')} ÷ ${remapEnglishWords('how are you')}`,
      'hello ÷ how are you',
      'symbol stays; neighbors recover',
    ),
    partial(
      'partial-friend-gap',
      'partial',
      'hello بقهثىي how بهىث you',
      'hello friend how fine you',
      'both reverse-mapped English words recover independently',
    ),
    fix(
      'partial-all-wrong-en',
      'partial',
      'hello friend how are you',
      'اثممخ بقهثىي اخص شقث غخع',
      'full English run through Arabic 101',
    ),
  )
  AR_PHRASES.forEach((ar, arIndex) => {
    EN_PHRASES.forEach((en, enIndex) => {
      const oov = OOV_ENGLISH[(arIndex + enIndex) % OOV_ENGLISH.length]!
      const oovAr = remapWords(oov, 'en-US-qwerty', 'ar-101')
      cases.push(
        partial(
          `partial-grid-${arIndex}-${enIndex}`,
          'partial',
          `${ar} ${remapEnglishWords(en)} ${oovAr}`,
          `${ar} ${en} ${oovAr}`,
          'correct Arabic + recoverable English + OOV',
        ),
      )
    })
  })
  return cases
}

function triggerAndProtected(): MixedCase[] {
  const { typed, expected } = triggerExpected()
  const cases: MixedCase[] = [
    fix('trigger-exact', 'trigger', expected, typed, 'بهىث → fine via Arabic 101; ÷ stays a symbol'),
    keep(
      'trigger-already-correct',
      'trigger',
      expected,
      'already-correct mixed line must not change',
    ),
  ]
  PROTECTED.forEach((token, i) => {
    cases.push(safety(`prot-${i}`, token))
    cases.push(keep(`prot-mixed-${i}`, 'protected', `مرحبا ${token} how are you`))
  })
  return cases
}

export function buildMixedLanguageCorpus(): MixedCase[] {
  return [
    ...cartesianKeep(),
    ...transitionKeeps(),
    ...extraKeeps(),
    ...wrongLayoutFixes(),
    ...osIntentMatrix(),
    ...segmentCorruption(),
    ...partialCases(),
    ...triggerAndProtected(),
  ]
}

export function classifyMixed(item: MixedCase, actual: string): MixedClass {
  if (item.kind === 'must_keep' || item.kind === 'safety_keep') {
    return actual === item.input ? 'PASS' : 'FALSE_POSITIVE'
  }
  if (item.kind === 'partial_fix') {
    if (actual === item.expected) return 'PARTIAL_OK'
    if (actual === item.input) return 'FALSE_NEGATIVE'
    if (isConservativePartial(item.input, item.expected, actual)) return 'PARTIAL_OK'
    return 'CORRUPTION'
  }
  if (actual === item.expected) return 'PASS'
  if (actual === item.input) return 'FALSE_NEGATIVE'
  if (isConservativePartial(item.input, item.expected, actual)) return 'EXPECTED_NOOP'
  return 'CORRUPTION'
}

function isConservativePartial(input: string, expected: string, actual: string): boolean {
  const inputParts = input.split(/(\s+)/)
  const expectedParts = expected.split(/(\s+)/)
  const actualParts = actual.split(/(\s+)/)
  if (
    inputParts.length !== expectedParts.length ||
    actualParts.length !== expectedParts.length
  ) {
    return false
  }
  for (let index = 0; index < expectedParts.length; index += 1) {
    const got = actualParts[index] ?? ''
    const want = expectedParts[index] ?? ''
    const typed = inputParts[index] ?? ''
    if (got === want || got === typed) continue
    return false
  }
  return true
}

export function executeMixed(
  item: MixedCase,
  profile: UserLayoutProfile = DEFAULT_PROFILE,
): { actual: string; result: MixedClass; ms: number } {
  const started = performance.now()
  const actual = runPlanner(item.input, profile)
  return {
    actual,
    result: classifyMixed(item, actual),
    ms: performance.now() - started,
  }
}

export function executeMixedBothProfiles(item: MixedCase): {
  defaultResult: MixedClass
  arOsResult: MixedClass
  defaultActual: string
  arOsActual: string
} {
  const left = executeMixed(item, DEFAULT_PROFILE)
  const right = executeMixed(item, AR_OS_PROFILE)
  return {
    defaultResult: left.result,
    arOsResult: right.result,
    defaultActual: left.actual,
    arOsActual: right.actual,
  }
}

export function applyCatchUp(text: string, caret: number, profile = DEFAULT_PROFILE): string {
  return applyFixesToText(text, planFieldFixes(text, profile, { finalizeAll: false, caret }))
}

export { localClassificationHint, remapWords, runPlanner }
