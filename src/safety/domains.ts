export function normalizeExcludedDomains(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[\s,]+/)
      : []
  const unique: string[] = []
  for (const item of values) {
    if (typeof item !== 'string') continue
    const domain = item
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      ?.replace(/\.$/, '')
    if (!domain || !domain.includes('.')) continue
    if (!unique.includes(domain)) unique.push(domain)
  }
  return unique
}

export function addExcludedDomain(
  excluded: readonly string[],
  domain: string,
): string[] {
  return normalizeExcludedDomains([...excluded, domain])
}

export function removeExcludedDomain(
  excluded: readonly string[],
  domain: string,
): string[] {
  const normalized = normalizeExcludedDomains([domain])[0]
  if (!normalized) return [...excluded]
  return excluded.filter((item) => item !== normalized)
}

export function isExcludedHost(hostname: string, excluded: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  return excluded.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )
}
