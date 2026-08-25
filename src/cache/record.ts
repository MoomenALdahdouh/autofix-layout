import { isSupportedLayout } from '../layouts/registry.ts'
import type { ClassificationResult, LayoutId } from '../layouts/types.ts'
import type { CacheRecord } from './types.ts'

function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === 'string' && isSupportedLayout(value)
}

export function toCacheRecord(
  result: ClassificationResult,
  extras: { corrected?: string; ts?: number } = {},
): CacheRecord {
  return {
    result,
    targetLayout: result.kind === 'LAYOUT_MISMATCH' ? result.targetLayout : undefined,
    corrected: extras.corrected,
    ts: extras.ts ?? Date.now(),
  }
}

export function parseCacheRecord(raw: unknown): CacheRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>

  if (value.result && typeof value.result === 'object') {
    const result = value.result as ClassificationResult
    if (result.kind === 'VALID') {
      return {
        result: { kind: 'VALID' },
        corrected: typeof value.corrected === 'string' ? value.corrected : undefined,
        ts: typeof value.ts === 'number' ? value.ts : Date.now(),
      }
    }
    if (result.kind === 'LAYOUT_MISMATCH' && isLayoutId(result.targetLayout)) {
      return {
        result: { kind: 'LAYOUT_MISMATCH', targetLayout: result.targetLayout },
        targetLayout: result.targetLayout,
        corrected: typeof value.corrected === 'string' ? value.corrected : undefined,
        ts: typeof value.ts === 'number' ? value.ts : Date.now(),
      }
    }
    return null
  }

  if (value.kind === 'VALID') {
    return {
      result: { kind: 'VALID' },
      corrected: typeof value.corrected === 'string' ? value.corrected : undefined,
      ts: typeof value.ts === 'number' ? value.ts : Date.now(),
    }
  }
  if (value.kind === 'LAYOUT_MISMATCH' && isLayoutId(value.targetLayout)) {
    return {
      result: { kind: 'LAYOUT_MISMATCH', targetLayout: value.targetLayout },
      targetLayout: value.targetLayout,
      corrected: typeof value.corrected === 'string' ? value.corrected : undefined,
      ts: typeof value.ts === 'number' ? value.ts : Date.now(),
    }
  }
  return null
}

export function isCacheableRecord(record: CacheRecord | null): record is CacheRecord {
  if (!record) return false
  if (record.result.kind === 'VALID') return true
  return record.result.kind === 'LAYOUT_MISMATCH' && isLayoutId(record.result.targetLayout)
}
