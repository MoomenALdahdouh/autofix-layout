export type EvaluateGate = 'skip' | 'local-now' | 'await-usage'

/**
 * Local high-confidence writes must not wait on a usage refresh when the
 * last known decision is already ALLOW. Typing is never blocked; this only
 * decides whether applyLocalFixes runs in the same event turn.
 */
export function evaluateGate(input: {
  live: boolean
  composing: boolean
  pageBlocked: boolean
  canIntervene: boolean
}): EvaluateGate {
  if (!input.live || input.composing || input.pageBlocked) return 'skip'
  return input.canIntervene ? 'local-now' : 'await-usage'
}
