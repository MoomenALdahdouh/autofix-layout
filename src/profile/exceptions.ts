import { MAX_EXCEPTION_LENGTH, MAX_EXCEPTIONS } from './types.ts'

export function normalizeExceptionToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const token = raw.trim()
  if (!token) return null
  if (token.length > MAX_EXCEPTION_LENGTH) return null
  if (/\s/.test(token)) return null
  return token
}

export function normalizeExceptions(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[\s,]+/)
      : []
  const unique: string[] = []
  for (const item of values) {
    const token = normalizeExceptionToken(item)
    if (!token || unique.includes(token)) continue
    unique.push(token)
    if (unique.length >= MAX_EXCEPTIONS) break
  }
  return unique
}

export function isExceptedToken(
  token: string,
  exceptions: readonly string[],
): boolean {
  return exceptions.includes(token)
}

export function addException(
  exceptions: readonly string[],
  token: string,
): string[] {
  return normalizeExceptions([...exceptions, token])
}

export function removeException(
  exceptions: readonly string[],
  token: string,
): string[] {
  return exceptions.filter((item) => item !== token)
}
