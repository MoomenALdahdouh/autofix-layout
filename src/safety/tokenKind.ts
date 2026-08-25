export type SkipReason =
  | 'email'
  | 'url'
  | 'jwt'
  | 'uuid'
  | 'hash'
  | 'credit-card'
  | 'api-key'
  | 'access-token'
  | 'private-key'
  | 'auth-header'
  | 'password'
  | 'env-secret'
  | 'file-path'
  | 'shell'
  | 'code-identifier'
  | 'digits'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL = /^(https?:\/\/|www\.)/i
const HOST_PATH = /^[a-z0-9.-]+\.[a-z]{2,}\/+\S+/i
const JWT =
  /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX_HASH = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})$/i
const CARD_DIGITS = /[0-9]/g
const API_KEY =
  /^(sk|pk|rk|ghp|gho|github_pat|xox[baprs]|AKIA|AIza|ya29|xoxe)[-_]|^(sk-|pk-|rk-)/i
const BEARERISH = /^(Bearer|Basic)\s+\S+/i
const ENV_ASSIGN =
  /^(?:[A-Z][A-Z0-9_]*)?(SECRET|TOKEN|PASSWORD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH)[A-Z0-9_]*=/i
const FILE_PATH = /^(?:~|\.{1,2})?(?:\/|\\)|^[A-Za-z]:[\\/]/
const SHELL_TOKEN =
  /^(sudo|chmod|chown|rm|curl|wget|ssh|kubectl|docker|systemctl)$/i
const SHELL_META = /(?:&&|\|\||[|><]|\$\(|^\.\/)/
const SHELL_TICK_COMMAND = /^`[^`]*`$/
const SEMI_SHELL =
  /^;?(?:sudo|chmod|chown|rm|curl|wget|ssh|kubectl|docker|systemctl);?$/i
const CODE_PATH = /^(?:[A-Za-z_][\w$]*\.){2,}[A-Za-z_][\w$]*$/
const CODE_NS = /::|->/
const DUNDER = /^__\w+__$/
const CAMEL_HUMPS = /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/
const PASCAL_CASE = /^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/
const SNAKE_CASE = /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/
const FILE_EXT = /\.(?:js|ts|tsx|jsx|py|rb|go|rs|java|kt|cs|php|json|ya?ml|toml|md|sh)$/i
const DOTTED_IDENT = /^[A-Za-z][\w$]*\.[A-Za-z][\w$]+$/
const ALL_CAPS = /^[A-Z]{2,}$/
const VERSIONISH = /^(?:v)?\d+[A-Za-z0-9._-]*$|^[A-Za-z]+[._-]?\d+[A-Za-z0-9._-]*$/

function digitCount(value: string): number {
  return (value.match(CARD_DIGITS) ?? []).length
}

function looksLikeCard(value: string): boolean {
  if (!/^[\d][\d\s-]{11,22}[\d]$/.test(value)) return false
  const digits = digitCount(value)
  return digits >= 13 && digits <= 19
}

export function skipReasonForToken(
  token: string,
  context = '',
  raw = token,
): SkipReason | null {
  const value = token.trim()
  const blob = `${context} ${raw}`.trim()
  if (!value) return null

  if (/^\d+$/.test(value)) return 'digits'
  if (EMAIL.test(value) || (value.includes('@') && value.includes('.'))) return 'email'
  if (URL.test(value) || value.includes('://') || HOST_PATH.test(value)) return 'url'
  if (value.startsWith('eyJ') || JWT.test(value)) return 'jwt'
  if (UUID.test(value)) return 'uuid'
  if (HEX_HASH.test(value)) return 'hash'
  if (looksLikeCard(value)) return 'credit-card'
  if (API_KEY.test(value) || /^(sk|pk)-[A-Za-z0-9]{16,}$/.test(value)) return 'api-key'
  if (BEARERISH.test(raw) || /^(ghp_|github_pat_|xox[baprs]-)/.test(value)) {
    return 'access-token'
  }
  if (
    /-----BEGIN/.test(raw) ||
    /PRIVATE KEY/.test(blob) ||
    (value.includes('BEGIN') && value.includes('PRIVATE'))
  ) {
    return 'private-key'
  }
  if (
    /^(authorization|bearer|basic)$/i.test(value) ||
    (/\b(authorization|bearer)\b/i.test(context) && /[A-Za-z0-9_-]{12,}/.test(value))
  ) {
    return 'auth-header'
  }
  if (
    /\b(password|passwd|pwd)\b/i.test(context) &&
    /[A-Za-z0-9!@#$%^&*]{8,}/.test(value)
  ) {
    return 'password'
  }
  if (ENV_ASSIGN.test(value) || ENV_ASSIGN.test(raw)) return 'env-secret'
  if (FILE_PATH.test(value) && /[\\/]/.test(value)) return 'file-path'
  if (
    value === ';' ||
    SEMI_SHELL.test(value) ||
    SHELL_META.test(value) ||
    SHELL_TICK_COMMAND.test(value) ||
    SHELL_TOKEN.test(value) ||
    /^-[a-z]{1,10}$/.test(value)
  ) {
    return 'shell'
  }
  if (
    CODE_PATH.test(value) ||
    CODE_NS.test(value) ||
    DUNDER.test(value) ||
    CAMEL_HUMPS.test(value) ||
    PASCAL_CASE.test(value) ||
    SNAKE_CASE.test(value) ||
    FILE_EXT.test(value) ||
    DOTTED_IDENT.test(value) ||
    ALL_CAPS.test(value) ||
    VERSIONISH.test(value)
  ) {
    return 'code-identifier'
  }
  return null
}

export function isSafeToken(token: string, context = '', raw = token): boolean {
  return skipReasonForToken(token, context, raw) === null
}
