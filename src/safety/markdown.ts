export function isInsideMarkdownCode(text: string, offset: number): boolean {
  const before = text.slice(0, Math.max(0, offset))
  const fences = before.match(/^ {0,3}```/gm)
  if (fences && fences.length % 2 === 1) return true

  let ticks = 0
  let escaped = false
  for (const char of before) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '`') ticks += 1
  }
  return ticks % 2 === 1
}
