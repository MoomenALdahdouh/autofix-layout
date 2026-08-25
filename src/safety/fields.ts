export type FieldProbe = {
  tag: string
  type?: string
  name?: string
  id?: string
  autocomplete?: string
  inputMode?: string
  maxLength?: number
  hidden?: boolean
  className?: string
  role?: string
  ariaLabel?: string
  placeholder?: string
  label?: string
  ancestorTags?: string[]
  ancestorClasses?: string[]
}

export type FieldSkipReason =
  | 'password-field'
  | 'otp-field'
  | 'payment-field'
  | 'username-field'
  | 'email-field'
  | 'url-field'
  | 'file-field'
  | 'hidden-field'
  | 'code-region'
  | 'console'
  | null

const SENSITIVE_NAME =
  /password|passwd|passcode|secret|otp|totp|2fa|two-?factor|one-?time|cvc|cvv|card[-_]?number|cc[-_]?num|api[-_]?key|access[-_]?token|verif(?:y|ication)[-_ ]?code|security[-_ ]?code/i
const USERNAME_CONTROL = /^(user[-_]?name|login|handle)$/i
const PIN_SIGNAL = /(?:^|[^a-z])pin(?:[^a-z]|$)/i
const CODE_CLASS =
  /\b(?:hljs|chroma|highlight|prettyprint|prism|language-|cm-editor|cm-content|monaco|ace_|CodeMirror|blob-code|js-file-line)\b/i
const CONSOLE_CLASS = /\b(?:xterm|terminal|console|repl|stdin)\b/i
const CODE_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP'])

function blob(probe: FieldProbe): string {
  return [
    probe.name,
    probe.id,
    probe.ariaLabel,
    probe.placeholder,
    probe.label,
    probe.autocomplete,
    probe.className,
  ]
    .filter(Boolean)
    .join(' ')
}

function autoTokens(value: string): string[] {
  return value.toLowerCase().split(/\s+/).filter(Boolean)
}

function isNumericMode(probe: FieldProbe): boolean {
  const mode = (probe.inputMode ?? '').toLowerCase()
  const type = (probe.type ?? '').toLowerCase()
  const max = probe.maxLength ?? 0
  return (
    mode === 'numeric' ||
    mode === 'decimal' ||
    type === 'tel' ||
    type === 'number' ||
    (max > 0 && max <= 8)
  )
}

export function skipReasonForField(probe: FieldProbe): FieldSkipReason {
  const type = (probe.type ?? '').toLowerCase()
  const tokens = autoTokens(probe.autocomplete ?? '')

  if (type === 'hidden' || probe.hidden) return 'hidden-field'
  if (type === 'file') return 'file-field'
  if (type === 'password') return 'password-field'
  if (type === 'email' || tokens.includes('email')) return 'email-field'
  if (type === 'url' || tokens.includes('url')) return 'url-field'
  if (tokens.includes('current-password') || tokens.includes('new-password')) {
    return 'password-field'
  }
  if (tokens.includes('one-time-code')) return 'otp-field'
  if (tokens.some((token) => token.startsWith('cc-'))) return 'payment-field'
  if (
    tokens.includes('username') ||
    USERNAME_CONTROL.test((probe.name ?? '').trim()) ||
    USERNAME_CONTROL.test((probe.id ?? '').trim())
  ) {
    return 'username-field'
  }

  const text = blob(probe)
  if (SENSITIVE_NAME.test(text)) {
    if (/otp|totp|2fa|one-?time|verif(?:y|ication)[-_ ]?code|security[-_ ]?code/i.test(text)) {
      return 'otp-field'
    }
    if (/cvc|cvv|card[-_]?number|cc[-_]?num/i.test(text)) return 'payment-field'
    return 'password-field'
  }
  if (PIN_SIGNAL.test(text) && isNumericMode(probe)) return 'otp-field'
  if (
    (probe.inputMode === 'numeric' || probe.inputMode === 'decimal') &&
    (probe.maxLength ?? 0) > 0 &&
    (probe.maxLength ?? 0) <= 8 &&
    SENSITIVE_NAME.test(text)
  ) {
    return 'otp-field'
  }

  const tags = (probe.ancestorTags ?? []).map((tag) => tag.toUpperCase())
  if (CODE_TAGS.has(probe.tag.toUpperCase()) || tags.some((tag) => CODE_TAGS.has(tag))) {
    return 'code-region'
  }
  const classes = [probe.className, ...(probe.ancestorClasses ?? [])].join(' ')
  if (CODE_CLASS.test(classes)) return 'code-region'
  if (CONSOLE_CLASS.test(classes)) return 'console'
  return null
}

function associatedLabel(element: Element): string {
  if (!(element instanceof HTMLElement) || !element.ownerDocument) return ''
  const chunks: string[] = []
  if (element.id) {
    const labelled = element.ownerDocument.querySelector(
      `label[for="${cssEscape(element.id)}"]`,
    )
    if (labelled?.textContent) chunks.push(labelled.textContent)
  }
  const wrapped = element.closest('label')
  if (wrapped?.textContent) chunks.push(wrapped.textContent)
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const id = labelledBy.trim().split(/\s+/)[0]
    const node = id ? element.ownerDocument.getElementById(id) : null
    if (node?.textContent) chunks.push(node.textContent)
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function probeElement(element: Element): FieldProbe {
  const ancestorTags: string[] = []
  const ancestorClasses: string[] = []
  let current: Element | null = element
  while (current) {
    ancestorTags.push(current.tagName)
    if (typeof current.className === 'string') ancestorClasses.push(current.className)
    current = current.parentElement
  }

  const input = element as HTMLInputElement
  return {
    tag: element.tagName,
    type: 'type' in input ? String(input.type ?? '') : '',
    name: 'name' in input ? String(input.name ?? '') : '',
    id: element.id,
    autocomplete: 'autocomplete' in input ? String(input.autocomplete ?? '') : '',
    inputMode: 'inputMode' in input ? String(input.inputMode ?? '') : '',
    maxLength: 'maxLength' in input ? Number(input.maxLength) : undefined,
    hidden:
      element instanceof HTMLElement &&
      (Boolean(element.hidden) || element.getAttribute('type') === 'hidden'),
    className: typeof element.className === 'string' ? element.className : '',
    role: element.getAttribute('role') ?? '',
    ariaLabel: element.getAttribute('aria-label') ?? '',
    placeholder: 'placeholder' in input ? String(input.placeholder ?? '') : '',
    label: associatedLabel(element),
    ancestorTags,
    ancestorClasses,
  }
}
