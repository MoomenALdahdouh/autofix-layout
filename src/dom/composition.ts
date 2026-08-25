let depth = 0

export function beginComposition(): void {
  depth += 1
}

export function endComposition(): void {
  depth = Math.max(0, depth - 1)
}

export function resetComposition(): void {
  depth = 0
}

export function isComposing(): boolean {
  return depth > 0
}
