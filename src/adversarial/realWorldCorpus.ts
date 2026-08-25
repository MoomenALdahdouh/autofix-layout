import { convertManualText } from '../layouts/convert.ts'
import { isArabicWord } from '../layouts/lexicons/ar-words.ts'
import { isEnglishWord } from '../layouts/lexicons/en-words.ts'
import { DEFAULT_PROFILE, normalizeProfile } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'
import { mapLayout, mapLayoutText } from '../layouts/registry.ts'
import type { LayoutId, UserLayoutProfile } from '../layouts/types.ts'
import { skipReasonForToken } from '../safety/tokenKind.ts'
import { peelBoundary } from '../safety/tokenize.ts'

export type CaseClass =
  | 'PASS'
  | 'FALSE_POSITIVE'
  | 'FALSE_NEGATIVE'
  | 'CORRUPTION'
  | 'EXPECTED_NOOP'

export type CaseKind =
  | 'must_keep'
  | 'must_fix'
  | 'manual_map'
  | 'safety_keep'
  | 'whitespace_keep'

export type CorpusCase = {
  id: string
  pair: string
  kind: CaseKind
  input: string
  expected: string
  website: string
  inputType: string
  notes?: string
}

export const AR_EN = DEFAULT_PROFILE
export const EN_RU = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'ru-standard'],
})
export const EN_TR = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'tr-q'],
})
export const EN_HE = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'he-standard'],
})
export const EN_AR_RU = normalizeProfile({
  sourceLayout: 'en-US-qwerty',
  enabledLayouts: ['en-US-qwerty', 'ar-101', 'ru-standard'],
})

export function runPlanner(
  text: string,
  profile: UserLayoutProfile = AR_EN,
): string {
  return applyFixesToText(text, planFieldFixes(text, profile, { finalizeAll: true }))
}

export function remapToken(token: string, from: LayoutId, to: LayoutId): string {
  const { lead, token: word, trail } = peelBoundary(token)
  const mapped = word ? mapLayout(word, from, to) : null
  return lead + (mapped ?? word) + trail
}

export function remapWords(text: string, from: LayoutId, to: LayoutId): string {
  return text
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : remapToken(part, from, to)))
    .join('')
}

function keep(
  id: string,
  pair: string,
  input: string,
  notes?: string,
): CorpusCase {
  return {
    id,
    pair,
    kind: 'must_keep',
    input,
    expected: input,
    website: 'planner',
    inputType: 'text',
    notes,
  }
}

function fix(
  id: string,
  pair: string,
  intended: string,
  from: LayoutId,
  to: LayoutId,
): CorpusCase {
  const input = remapWords(intended, to, from)
  return {
    id,
    pair,
    kind: 'must_fix',
    input,
    expected: intended,
    website: 'planner',
    inputType: 'text',
    notes: `${from} → ${to} via mapLayout`,
  }
}

const AR_LEXICON_SENTENCES = [
  'مرحبا',
  'هذا أنا',
  'هذا انا',
  'كيف حالك',
  'أنا بخير',
  'انا بخير',
  'هل يمكن',
  'نعم يمكن',
  'هذا التصميم',
  'استخدمت التصميم',
  'في التصميم',
  'من هذا',
  'على هذا',
  'بعد هذا',
  'قبل هذا',
  'مع هذا',
  'كيف هذا',
  'ماذا بعد',
  'أين هذا',
  'متى يمكن',
  'شكرا مرحبا',
  'أهلا مرحبا',
  'السلام عليكم',
  'نعم هذا يمكن',
  'لا هذا يمكن',
  'كل هذا',
  'بعض هذا',
  'غير هذا',
  'جدا بخير',
  'هو بخير',
  'هي بخير',
  'نحن بخير',
  'أنا في التصميم',
  'استخدمت هذا',
  'هل هذا يمكن',
  'نعم أنا بخير',
  'كيف يمكن',
  'هذا بعد ذلك',
  'من قبل',
  'بين هذا',
]

const EN_KEEP = [
  'Please review the pull request when you can.',
  'See you at the meeting tomorrow morning.',
  'The server is running on localhost.',
  'I pushed the commit to the main branch.',
  'Could you share the document with the team?',
  'Thanks for the update.',
  'Let me know if you need anything else.',
  'The build failed on the last step.',
  'We should write a test for this case.',
  'This is not a translator.',
  'Keep typing and do not switch the layout.',
  'The file is ready for download.',
  'Call me after 5.',
  'Good morning.',
  'Good night.',
  'Hello, how are you today?',
  'I am working on the project.',
  'Can you send me the file today?',
  'this is a test.',
  'Hello World',
  'HELLO',
  'hello',
  'React',
  'Laravel',
  'API',
  'HTTP',
  'JSON',
  'REST',
  'FastAPI',
  'Groq',
  'OpenAI',
  'GitHub',
  'Git',
  'TypeScript',
  'JavaScript',
  'PostgreSQL',
  'Docker',
  'Python',
  'PHP',
  'ChatGPT',
  'www.example.com',
  'https://example.com',
  'https://github.com/example/project',
  'example.com/path?q=test',
  'test@example.com',
  'user123@gmail.com',
  'name.surname@company.com',
  '12345',
  '2026-08-23',
  '1,000',
  '99.99',
  '10:30',
  'Version 1.2.3',
  'React/Vite',
  'const user = await fetch(url);',
  'function test() {}',
  'API_ENDPOINT',
  'user_id',
  'getUserById',
  'I have 3 projects',
  'hello world',
  'hello  world',
  '  hello',
  'hello  ',
]

const AR_KEEP = [
  'مرحبا، كيف حالك اليوم؟',
  'مرحبا this is a test.',
  'أنا أعمل الآن على المشروع.',
  'I am working on the project الآن.',
  'هذا هو React component',
  'المشكلة موجودة في API endpoint',
  'لدي 3 مشاريع',
  'الاجتماع الساعة 10:30',
  'مرحبا هذا انا how are you',
  'هل وصلت؟ نعم!',
]

const MIXED_MUST_KEEP = [
  'مرحبا هذا انا how are you',
  'أنا الآن working on the project',
  'هذا هو React',
  'API endpoint',
  'VS Code',
]

const SAFETY = [
  'test@example.com',
  'user123@gmail.com',
  'https://example.com',
  'www.google.com',
  '12345',
  '2026-08-23',
  'sk-not-a-real-key-value-xxxxx',
  'getUserById',
  'API_ENDPOINT',
]

const MANUAL_AR = [
  'نسيت تغيير لوحة المفاتيح مرة أخرى.',
  'أريد أن أذهب إلى الجامعة غدًا.',
  'هذا الاختبار مهم جدًا.',
  'سأتواصل معك لاحقًا.',
  'أحتاج إلى بعض الوقت لإنهاء العمل.',
  'سأرسل التقرير عندما أنتهي.',
  'هل يمكنك مراجعة المشروع؟',
  'أنا أعمل على تطبيق جديد.',
]

const RU_WORDS = ['привет']

function expandKeeps(items: string[], pair: string, prefix: string): CorpusCase[] {
  return items.map((input, index) =>
    keep(`${prefix}-${index + 1}`, pair, input, 'correct text must stay'),
  )
}

export function buildCorpus(): CorpusCase[] {
  const cases: CorpusCase[] = []

  AR_LEXICON_SENTENCES.forEach((sentence, index) => {
    cases.push(
      fix(`ar-en-fix-${index + 1}`, 'en-US-qwerty↔ar-101', sentence, 'en-US-qwerty', 'ar-101'),
    )
    cases.push(keep(`ar-keep-lex-${index + 1}`, 'en-US-qwerty↔ar-101', sentence))
  })

  cases.push(...expandKeeps(EN_KEEP, 'en-US-qwerty↔ar-101', 'en-keep'))
  cases.push(...expandKeeps(AR_KEEP, 'en-US-qwerty↔ar-101', 'ar-natural-keep'))
  cases.push(...expandKeeps(MIXED_MUST_KEEP, 'en-US-qwerty↔ar-101', 'mixed-keep'))

  SAFETY.forEach((input, index) => {
    cases.push({
      id: `safety-${index + 1}`,
      pair: 'en-US-qwerty↔ar-101',
      kind: 'safety_keep',
      input,
      expected: input,
      website: 'planner',
      inputType: 'text',
      notes: skipReasonForToken(input) ?? 'keep',
    })
  })

  cases.push(
    fix('canon-1', 'en-US-qwerty↔ar-101', 'استخدمت', 'en-US-qwerty', 'ar-101'),
    fix('canon-2', 'en-US-qwerty↔ar-101', 'التصميم', 'en-US-qwerty', 'ar-101'),
    {
      id: 'canon-mixed',
      pair: 'en-US-qwerty↔ar-101',
      kind: 'must_fix',
      input: remapWords('استخدمت React في التصميم', 'ar-101', 'en-US-qwerty'),
      expected: 'استخدمت React في التصميم',
      website: 'planner',
      inputType: 'text',
    },
    {
      id: 'short-td-isolated',
      pair: 'en-US-qwerty↔ar-101',
      kind: 'must_keep',
      input: 'td',
      expected: 'td',
      website: 'planner',
      inputType: 'text',
      notes: 'isolated short token stays',
    },
    {
      id: 'ru-ghbdtn',
      pair: 'en-US-qwerty↔ru-standard',
      kind: 'must_fix',
      input: 'ghbdtn',
      expected: 'привет',
      website: 'planner',
      inputType: 'text',
    },
    keep('ru-keep-hello', 'en-US-qwerty↔ru-standard', 'hello'),
    keep('tr-keep-hello', 'en-US-qwerty↔tr-q', 'hello'),
    keep('he-keep-hello', 'en-US-qwerty↔he-standard', 'hello'),
  )

  RU_WORDS.forEach((word, index) => {
    cases.push(keep(`ru-cyrillic-keep-${index + 1}`, 'en-US-qwerty↔ru-standard', word))
  })

  MANUAL_AR.forEach((sentence, index) => {
    const input = remapWords(sentence, 'ar-101', 'en-US-qwerty')
    cases.push({
      id: `manual-ar-${index + 1}`,
      pair: 'en-US-qwerty→ar-101',
      kind: 'manual_map',
      input,
      expected: mapLayoutText(input, 'en-US-qwerty', 'ar-101') ?? input,
      website: 'manual-converter',
      inputType: 'popup',
    })
  })

  const trHello = mapLayoutText('hello', 'en-US-qwerty', 'tr-q')
  if (trHello) {
    cases.push({
      id: 'manual-tr-hello',
      pair: 'en-US-qwerty→tr-q',
      kind: 'manual_map',
      input: 'hello',
      expected: trHello,
      website: 'manual-converter',
      inputType: 'popup',
    })
  }
  const heHello = mapLayoutText('hello', 'en-US-qwerty', 'he-standard')
  if (heHello) {
    cases.push({
      id: 'manual-he-hello',
      pair: 'en-US-qwerty→he-standard',
      kind: 'manual_map',
      input: 'hello',
      expected: heHello,
      website: 'manual-converter',
      inputType: 'popup',
    })
  }

  const punctVariants = ['مرحبا', 'كيف', 'حالك', 'استخدمت', 'التصميم']
  punctVariants.forEach((word, index) => {
    const wrong = remapWords(word, 'ar-101', 'en-US-qwerty')
    cases.push({
      id: `punct-q-${index + 1}`,
      pair: 'en-US-qwerty↔ar-101',
      kind: 'must_fix',
      input: `${wrong}?`,
      expected: `${word}?`,
      website: 'planner',
      inputType: 'text',
    })
    cases.push({
      id: `punct-bang-${index + 1}`,
      pair: 'en-US-qwerty↔ar-101',
      kind: 'must_fix',
      input: `${wrong}!`,
      expected: `${word}!`,
      website: 'planner',
      inputType: 'text',
    })
  })

  cases.push(
    keep('ws-double', 'en-US-qwerty↔ar-101', 'hello  world'),
    keep('ws-lead', 'en-US-qwerty↔ar-101', '  hello'),
    keep('ws-trail', 'en-US-qwerty↔ar-101', 'hello  '),
    keep('ws-newline', 'en-US-qwerty↔ar-101', 'hello\nworld'),
    keep('ws-para', 'en-US-qwerty↔ar-101', 'مرحبا\n\nأنا بخير'),
  )

  return cases
}

export function profileForPair(pair: string): UserLayoutProfile {
  if (pair.includes('ru-standard')) return pair.includes('ar-101') ? EN_AR_RU : EN_RU
  if (pair.includes('tr-q')) return EN_TR
  if (pair.includes('he-standard')) return EN_HE
  return AR_EN
}

export function classifyCase(item: CorpusCase, actual: string): CaseClass {
  if (item.kind === 'must_keep' || item.kind === 'safety_keep' || item.kind === 'whitespace_keep') {
    if (actual === item.input) return 'PASS'
    return actual === item.expected ? 'PASS' : 'FALSE_POSITIVE'
  }
  if (item.kind === 'manual_map') {
    if (actual === item.expected) return 'PASS'
    if (actual === item.input) return 'FALSE_NEGATIVE'
    return 'CORRUPTION'
  }
  if (actual === item.expected) return 'PASS'
  if (actual === item.input) {
    return looksLexiconFixable(item.expected) ? 'FALSE_NEGATIVE' : 'EXPECTED_NOOP'
  }
  if (isConservativePartial(item.input, item.expected, actual)) {
    return 'EXPECTED_NOOP'
  }
  return 'CORRUPTION'
}

function looksLexiconFixable(expected: string): boolean {
  const tokens = expected.split(/\s+/).filter(Boolean)
  return tokens.every((token) => {
    const word = peelBoundary(token).token
    if (!word) return true
    if (isArabicWord(word) && [...word].length >= 3) return true
    if (isEnglishWord(word)) return true
    if (/^[A-Za-z][A-Za-z0-9+/.-]*$/.test(word)) return true
    return false
  })
}

function isConservativePartial(input: string, expected: string, actual: string): boolean {
  const inputParts = input.split(/(\s+)/)
  const expectedParts = expected.split(/(\s+)/)
  const actualParts = actual.split(/(\s+)/)
  if (inputParts.length !== expectedParts.length || actualParts.length !== expectedParts.length) {
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

export function executeCase(item: CorpusCase): {
  actual: string
  result: CaseClass
} {
  if (item.kind === 'manual_map') {
    const [source, target] = item.pair.split('→')
    const converted = convertManualText(item.input, source, target)
    const actual = converted.ok ? converted.text : item.input
    return { actual, result: classifyCase(item, actual) }
  }
  const actual = runPlanner(item.input, profileForPair(item.pair))
  return { actual, result: classifyCase(item, actual) }
}
