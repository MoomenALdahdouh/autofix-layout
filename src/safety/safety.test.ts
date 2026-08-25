import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from '../layouts/profile.ts'
import { applyFixesToText, planFieldFixes } from '../layouts/sentence.ts'
import { shouldEvaluateToken } from '../layouts/heuristics.ts'
import { isExcludedHost, normalizeExcludedDomains } from './domains.ts'
import { skipReasonForField } from './fields.ts'
import { isInsideMarkdownCode } from './markdown.ts'
import { skipReasonForToken } from './tokenKind.ts'
import { lastCompletedToken, tokenizeText } from './tokenize.ts'

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'

describe('tokenizer', () => {
  it('keeps letters, hyphens, apostrophes, underscores, and inner brackets', () => {
    const { tokens } = tokenizeText("don't state-of-the-art foo_bar hsjo]lj")
    expect(tokens.map((item) => item.token)).toEqual([
      "don't",
      'state-of-the-art',
      'foo_bar',
      'hsjo]lj',
    ])
  })

  it('treats Arabic 101 math symbols as delimiters, not word characters', () => {
    expect(tokenizeText('hello÷world').tokens.map((item) => item.token)).toEqual([
      'hello',
      'world',
    ])
    expect(tokenizeText('hello ÷ world').tokens.map((item) => item.token)).toEqual([
      'hello',
      'world',
    ])
  })

  it('separates token, delimiter, and context', () => {
    const { tokens } = tokenizeText('hello, world')
    expect(tokens[0]).toMatchObject({
      token: 'hello',
      delimiter: ',',
      context: '',
    })
    expect(tokens[1]).toMatchObject({
      token: 'world',
      context: 'hello',
    })
    expect(tokens[0]!.delimiter).not.toBe('hello')
  })

  it('keeps combining marks on the letter', () => {
    const word = 'e\u0301lite'
    expect(tokenizeText(word).tokens[0]?.token).toBe(word)
  })

  it('requires a boundary for the last completed token', () => {
    expect(lastCompletedToken('hsjo]lj', 7, true)).toBeNull()
    expect(lastCompletedToken('hsjo]lj ', 8, true)?.token).toBe('hsjo]lj')
  })
})

describe('secret and technical tokens', () => {
  it('skips URLs and emails', () => {
    expect(skipReasonForToken('https://example.com/path')).toBe('url')
    expect(skipReasonForToken('www.example.com/x')).toBe('url')
    expect(skipReasonForToken('user@example.com')).toBe('email')
    expect(shouldEvaluateToken('user@example.com', DEFAULT_PROFILE)).toBe(false)
  })

  it('skips JWTs, UUIDs, hashes, and cards', () => {
    expect(skipReasonForToken(JWT)).toBe('jwt')
    expect(skipReasonForToken('550e8400-e29b-41d4-a716-446655440000')).toBe('uuid')
    expect(skipReasonForToken('a'.repeat(40))).toBe('hash')
    expect(skipReasonForToken('4111 1111 1111 1111')).toBe('credit-card')
    expect(skipReasonForToken('4111111111111111')).toBe('digits')
  })

  it('skips API keys, tokens, env secrets, and private keys', () => {
    expect(skipReasonForToken('sk-abcdefghijklmnopqrstuvwxyz')).toBe('api-key')
    expect(skipReasonForToken('ghp_abcdefghijklmnopqrstuv')).toBe('api-key')
    expect(skipReasonForToken('Bearer abcdefghijklmnop')).toBe('access-token')
    expect(skipReasonForToken('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI')).toBe('env-secret')
    expect(skipReasonForToken('abcdefghijklmnop', 'Authorization')).toBe(
      'auth-header',
    )
    expect(skipReasonForToken('BEGIN', '-----BEGIN PRIVATE KEY-----')).toBe('private-key')
    expect(skipReasonForToken('hunter2!!xx', 'password field')).toBe('password')
  })

  it('skips paths, shell, and obvious code identifiers', () => {
    expect(skipReasonForToken('/usr/bin/env')).toBe('file-path')
    expect(skipReasonForToken('~/secrets/id_rsa')).toBe('file-path')
    expect(skipReasonForToken('sudo')).toBe('shell')
    expect(skipReasonForToken('rm')).toBe('shell')
    expect(skipReasonForToken(';')).toBe('shell')
    expect(skipReasonForToken(';rm')).toBe('shell')
    expect(skipReasonForToken(';sudo')).toBe('shell')
    expect(skipReasonForToken(';dt')).toBeNull()
    expect(skipReasonForToken('phg;')).toBeNull()
    expect(skipReasonForToken('foo && bar')).toBe('shell')
    expect(skipReasonForToken('`code`')).toBe('shell')
    expect(skipReasonForToken('`g;')).toBeNull()
    expect(skipReasonForToken('foo.bar.baz')).toBe('code-identifier')
    expect(skipReasonForToken('foo.bar')).toBe('code-identifier')
    expect(skipReasonForToken('getElementById')).toBe('code-identifier')
    expect(skipReasonForToken('__init__')).toBe('code-identifier')
    expect(skipReasonForToken('index.ts')).toBe('code-identifier')
    expect(skipReasonForToken('API')).toBe('code-identifier')
    expect(skipReasonForToken('v2')).toBe('code-identifier')
    expect(skipReasonForToken('2026')).toBe('digits')
  })

  it('still evaluates normal multilingual layout tokens', () => {
    for (const word of [
      'hsjo]lj',
      'hgjwldl',
      'td',
      'lvpfh',
      'i`h',
      '`g;',
      'hkh',
      ';dt',
      'phg;',
      'React',
      'اثممخ',
      'التصميم',
      'hello',
    ]) {
      expect(skipReasonForToken(word)).toBeNull()
      expect(shouldEvaluateToken(word, DEFAULT_PROFILE)).toBe(true)
    }
  })
})

describe('code and markdown context', () => {
  it('detects markdown fences and inline ticks', () => {
    const fenced = '```\nhsjo]lj\n```'
    expect(isInsideMarkdownCode(fenced, fenced.indexOf('hsjo'))).toBe(true)
    const inline = 'say `hsjo]lj` please'
    expect(isInsideMarkdownCode(inline, inline.indexOf('hsjo'))).toBe(true)
    expect(isInsideMarkdownCode('hsjo]lj React', 0)).toBe(false)
  })

  it('detects password, OTP, hidden, code, and console fields', () => {
    expect(skipReasonForField({ tag: 'INPUT', type: 'password' })).toBe('password-field')
    expect(skipReasonForField({ tag: 'INPUT', type: 'hidden' })).toBe('hidden-field')
    expect(
      skipReasonForField({ tag: 'INPUT', type: 'text', autocomplete: 'one-time-code' }),
    ).toBe('otp-field')
    expect(skipReasonForField({ tag: 'INPUT', type: 'text', name: 'cardNumber' })).toBe(
      'payment-field',
    )
    expect(skipReasonForField({ tag: 'TEXTAREA', ancestorTags: ['PRE'] })).toBe('code-region')
    expect(skipReasonForField({ tag: 'DIV', className: 'xterm' })).toBe('console')
    expect(skipReasonForField({ tag: 'INPUT', type: 'text', name: 'query' })).toBeNull()
  })

  it('protects payment, username, email, URL, file, and PIN signals', () => {
    expect(skipReasonForField({ tag: 'INPUT', type: 'text', autocomplete: 'cc-number' })).toBe(
      'payment-field',
    )
    expect(
      skipReasonForField({ tag: 'INPUT', type: 'text', autocomplete: 'cc-exp-month' }),
    ).toBe('payment-field')
    expect(skipReasonForField({ tag: 'INPUT', type: 'text', autocomplete: 'username' })).toBe(
      'username-field',
    )
    expect(skipReasonForField({ tag: 'INPUT', type: 'text', name: 'login' })).toBe(
      'username-field',
    )
    expect(skipReasonForField({ tag: 'INPUT', type: 'email' })).toBe('email-field')
    expect(skipReasonForField({ tag: 'INPUT', type: 'url' })).toBe('url-field')
    expect(skipReasonForField({ tag: 'INPUT', type: 'file' })).toBe('file-field')
    expect(
      skipReasonForField({
        tag: 'INPUT',
        type: 'tel',
        name: 'pin',
        inputMode: 'numeric',
        maxLength: 6,
      }),
    ).toBe('otp-field')
    expect(
      skipReasonForField({ tag: 'INPUT', type: 'text', placeholder: 'Current password' }),
    ).toBe('password-field')
    expect(
      skipReasonForField({ tag: 'INPUT', type: 'text', ariaLabel: 'Verification code' }),
    ).toBe('otp-field')
  })

  it('does not treat normal chat, search, or comment fields as protected', () => {
    expect(skipReasonForField({ tag: 'INPUT', type: 'search', name: 'q' })).toBeNull()
    expect(skipReasonForField({ tag: 'TEXTAREA', name: 'comment' })).toBeNull()
    expect(skipReasonForField({ tag: 'DIV', role: 'textbox', className: 'chat' })).toBeNull()
    expect(skipReasonForField({ tag: 'INPUT', type: 'text', name: 'message' })).toBeNull()
    expect(skipReasonForField({ tag: 'INPUT', type: 'text', placeholder: 'Search' })).toBeNull()
  })
})

describe('excluded domains', () => {
  it('is off by default and matches hosts when configured', () => {
    expect(normalizeExcludedDomains([])).toEqual([])
    expect(isExcludedHost('mail.google.com', [])).toBe(false)
    const excluded = normalizeExcludedDomains(['gmail.com', 'https://www.bank.example/app'])
    expect(excluded).toEqual(['gmail.com', 'bank.example'])
    expect(isExcludedHost('mail.gmail.com', excluded)).toBe(true)
    expect(isExcludedHost('bank.example', excluded)).toBe(true)
    expect(isExcludedHost('news.example', excluded)).toBe(false)
  })
})

describe('planner does not rewrite secrets', () => {
  it('leaves JWTs and URLs alone next to normal words', () => {
    const text = `hello ${JWT} https://example.com/x`
    expect(planFieldFixes(text, DEFAULT_PROFILE, { finalizeAll: true })).toEqual([])
  })

  it('still remaps ordinary Arabic-on-QWERTY sentences', () => {
    expect(
      applyFixesToText(
        'hsjo]lj React td hgjwldl',
        planFieldFixes('hsjo]lj React td hgjwldl', DEFAULT_PROFILE, {
          finalizeAll: true,
        }),
      ),
    ).toBe('استخدمت React في التصميم')
    expect(
      applyFixesToText(
        'اثممخ اخص شقث غخع',
        planFieldFixes('اثممخ اخص شقث غخع', DEFAULT_PROFILE, { finalizeAll: true }),
      ),
    ).toBe('hello how are you')
  })
})
