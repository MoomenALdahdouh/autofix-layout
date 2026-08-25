export function usageDebug(
  event: string,
  extra: Record<string, string | number | boolean | null> = {},
): void {
  if (import.meta.env.VITE_USAGE_DEBUG !== 'true') return
  console.debug('[autofix-usage]', event, extra)
}
