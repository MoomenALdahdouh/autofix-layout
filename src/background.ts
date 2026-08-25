import {
  WORD_CACHE_STORAGE_KEY,
  chromeCachePersistence,
  createClassificationStore,
  createCoalescer,
  measureAsync,
  measureSync,
  toCacheRecord,
} from './cache/index.ts'
import {
  assertGoldenLayouts,
  classificationCacheKey,
  getSupportedLayouts,
  inferSourceLayout,
  isEnabledLayout,
  isSupportedLayout,
  localClassificationHint,
  mapLayout,
  canCommitMismatch,
  normalizeProfile,
} from './layouts/index.ts'
import type { ClassificationResult } from './layouts/types.ts'
import {
  createChromeEntitlementStore,
  createEntitlementEngine,
} from './entitlement/index.ts'
import type {
  ActivateLicenseRequest,
  ActivateLicenseResult,
  AddExceptionRequest,
  AddExcludedDomainRequest,
  ClearHistoryRequest,
  PauseTemporarilyRequest,
  CheckWordError,
  CheckWordRequest,
  CheckWordResult,
  ExtensionRequest,
  ExtensionStatus,
  FixCurrentTextResult,
  InterveneDecisionResult,
  RecordCorrectionRequest,
  RemoveExceptionRequest,
  RemoveExcludedDomainRequest,
  SetDirectShortcutRequest,
  SetEnabledRequest,
  SetExcludedDomainsRequest,
  SetManualConversionRequest,
  SetProfileRequest,
} from './messaging.ts'
import {
  isFixCurrentTextCommand,
  readAssignedShortcut,
  sendFixCurrentTextToActiveTab,
  shouldClassifyForShortcut,
} from './background/commands.ts'
import {
  EVENTS_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  TEMPORARY_PAUSE_MS,
  appendHistory,
  applyCorrectionEvent,
  isCorrectionActive,
  isExceptedToken,
  migrateToUserProfile,
  normalizeEvents,
  normalizeHistory,
  normalizeUserProfile,
  removeException,
  toLayoutProfile,
  type UserProfile,
} from './profile/index.ts'
import {
  addExcludedDomain,
  buildAnalyzeWordPayload,
  normalizeExcludedDomains,
  removeExcludedDomain,
  skipReasonForToken,
} from './safety/index.ts'

assertGoldenLayouts()

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8003'
const wordCache = createClassificationStore({
  persistence: chromeCachePersistence(WORD_CACHE_STORAGE_KEY),
})
const coalesceClassify = createCoalescer<CheckWordResult | CheckWordError>()
const entitlement = createEntitlementEngine({
  store: createChromeEntitlementStore(),
  isOnline: () => apiOnline,
})
let cachedProfile: UserProfile | null = null
let cachedLicenseKey: string | null = null
let apiOnline = false

async function getLicenseKey(): Promise<string> {
  if (cachedLicenseKey !== null) return cachedLicenseKey
  const stored = await chrome.storage.sync.get({ licenseKey: '' })
  cachedLicenseKey = String(stored.licenseKey ?? '')
  return cachedLicenseKey
}

async function loadUserProfile(): Promise<UserProfile> {
  if (cachedProfile) return cachedProfile
  const [local, sync] = await Promise.all([
    chrome.storage.local.get({ [PROFILE_STORAGE_KEY]: null }),
    chrome.storage.sync.get({
      enabled: true,
      layoutProfile: null,
      excludedDomains: [],
    }),
  ])
  const hydrated = migrateToUserProfile({
    current: local[PROFILE_STORAGE_KEY],
    legacy: {
      enabled: sync.enabled,
      layoutProfile: sync.layoutProfile,
      excludedDomains: sync.excludedDomains,
    },
  })
  if (hydrated.migrated || hydrated.recovered || local[PROFILE_STORAGE_KEY] == null) {
    await persistUserProfile(hydrated.profile)
  } else {
    cachedProfile = hydrated.profile
  }
  return hydrated.profile
}

async function persistUserProfile(profile: UserProfile): Promise<UserProfile> {
  const next = normalizeUserProfile(profile)
  cachedProfile = next
  await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: next })
  await chrome.storage.sync.set({
    enabled: next.enabled,
    layoutProfile: toLayoutProfile(next),
    excludedDomains: next.excludedDomains,
  })
  return next
}

async function loadEvents() {
  const stored = await chrome.storage.local.get({ [EVENTS_STORAGE_KEY]: [] })
  return normalizeEvents(stored[EVENTS_STORAGE_KEY])
}

async function persistEvents(events: ReturnType<typeof normalizeEvents>): Promise<void> {
  await chrome.storage.local.set({ [EVENTS_STORAGE_KEY]: events })
}

async function loadHistory() {
  const stored = await chrome.storage.local.get({ [HISTORY_STORAGE_KEY]: [] })
  return normalizeHistory(stored[HISTORY_STORAGE_KEY])
}

async function persistHistory(items: ReturnType<typeof normalizeHistory>): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: items })
}

async function getSettings(): Promise<{
  enabled: boolean
  licenseKey: string
  profile: UserProfile
  excludedDomains: string[]
}> {
  const [licenseKey, profile] = await Promise.all([getLicenseKey(), loadUserProfile()])
  return {
    enabled: profile.enabled,
    licenseKey,
    profile,
    excludedDomains: profile.excludedDomains,
  }
}

async function fetchJson<T>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | undefined }> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: T | undefined
  try {
    data = (await response.json()) as T
  } catch {
    data = undefined
  }
  return { ok: response.ok, status: response.status, data }
}

function parseApiResult(
  data: unknown,
  allowed: readonly string[],
): ClassificationResult | null {
  if (!data || typeof data !== 'object' || !('result' in data)) return null
  const result = (data as { result?: { kind?: string; target_layout?: string } }).result
  if (result?.kind === 'VALID') return { kind: 'VALID' }
  if (
    result?.kind === 'LAYOUT_MISMATCH' &&
    result.target_layout &&
    isSupportedLayout(result.target_layout) &&
    allowed.includes(result.target_layout)
  ) {
    return { kind: 'LAYOUT_MISMATCH', targetLayout: result.target_layout }
  }
  return null
}

function validResponse(
  word: string,
  sourceLayout: UserProfile['sourceLayout'],
): CheckWordResult {
  return {
    type: 'CHECK_WORD_RESULT',
    word,
    result: { kind: 'VALID' },
    sourceLayout,
    source: 'cache',
  }
}

async function handleCheckWord(
  message: CheckWordRequest,
): Promise<CheckWordResult | CheckWordError> {
  const { licenseKey, profile } = await getSettings()
  if ((await entitlement.canIntervene()) === 'DENY') {
    return validResponse(message.word, profile.sourceLayout)
  }
  if (skipReasonForToken(message.word, message.context ?? '')) {
    return validResponse(message.word, profile.sourceLayout)
  }

  if (
    !shouldClassifyForShortcut({
      automaticActive: isCorrectionActive(profile),
      explicit: message.explicit === true,
      excepted: isExceptedToken(message.word, profile.personalExceptions),
    })
  ) {
    return validResponse(message.word, profile.sourceLayout)
  }
  const sourceLayout =
    inferSourceLayout(message.word, profile) ?? profile.sourceLayout
  const key = classificationCacheKey(
    message.word,
    profile,
    sourceLayout,
    message.context,
  )
  await wordCache.ready()
  const cached = measureSync('cacheHit', () => wordCache.get(key))
  const localHint = localClassificationHint(
    message.word,
    profile,
    message.context ?? '',
  )
  if (cached) {
    const cachedTarget =
      cached.result.kind === 'LAYOUT_MISMATCH' ? cached.result.targetLayout : null
    if (!cachedTarget || isEnabledLayout(profile, cachedTarget)) {
      return {
        type: 'CHECK_WORD_RESULT',
        word: message.word,
        result: cached.result,
        corrected: cached.corrected,
        sourceLayout,
        source: 'cache',
      }
    }
  }

  if (localHint) {
    const corrected =
      localHint.kind === 'LAYOUT_MISMATCH'
        ? mapLayout(message.word, sourceLayout, localHint.targetLayout) ??
          undefined
        : undefined
    if (
      localHint.kind === 'LAYOUT_MISMATCH' &&
      !canCommitMismatch(
        profile,
        message.word,
        localHint.targetLayout,
        corrected,
        message.context ?? '',
      )
    ) {
      return {
        type: 'CHECK_WORD_RESULT',
        word: message.word,
        result: { kind: 'VALID' },
        sourceLayout,
        source: 'cache',
      }
    }
    wordCache.set(key, toCacheRecord(localHint, { corrected }))
    return {
      type: 'CHECK_WORD_RESULT',
      word: message.word,
      result: localHint,
      corrected,
      sourceLayout,
      source: 'cache',
    }
  }

  return coalesceClassify(key, () =>
    measureAsync('cacheMiss', async () => {
      const again = wordCache.get(key)
      if (again) {
        return {
          type: 'CHECK_WORD_RESULT' as const,
          word: message.word,
          result: again.result,
          corrected: again.corrected,
          sourceLayout,
          source: 'cache' as const,
        }
      }

      try {
        const { ok, status, data } = await fetchJson<unknown>(
          '/api/analyze-word',
          buildAnalyzeWordPayload({
            license_key: licenseKey || undefined,
            word: message.word,
            context: message.context,
            source_layout: sourceLayout,
            candidate_layouts: profile.enabledLayouts,
          }),
        )

        if (status === 401 || status === 403) {
          apiOnline = true
          void entitlement.rememberLicense(false, 'invalid')
          return {
            type: 'CHECK_WORD_ERROR' as const,
            word: message.word,
            code: 'LICENSE_INVALID' as const,
          }
        }

        const result = ok ? parseApiResult(data, profile.enabledLayouts) : null
        if (!result) {
          return {
            type: 'CHECK_WORD_ERROR' as const,
            word: message.word,
            code: 'UPSTREAM' as const,
          }
        }

        const corrected =
          result.kind === 'LAYOUT_MISMATCH'
            ? mapLayout(message.word, sourceLayout, result.targetLayout) ??
              undefined
            : undefined

        if (
          result.kind === 'LAYOUT_MISMATCH' &&
          !canCommitMismatch(
            profile,
            message.word,
            result.targetLayout,
            corrected,
            message.context ?? '',
          )
        ) {
          return {
            type: 'CHECK_WORD_RESULT' as const,
            word: message.word,
            result: { kind: 'VALID' },
            sourceLayout,
            source: 'api' as const,
          }
        }

        wordCache.set(key, toCacheRecord(result, { corrected }))
        apiOnline = true
        if (licenseKey) void entitlement.rememberLicense(true, 'active')
        return {
          type: 'CHECK_WORD_RESULT' as const,
          word: message.word,
          result,
          corrected,
          sourceLayout,
          source: 'api' as const,
        }
      } catch {
        apiOnline = false
        return {
          type: 'CHECK_WORD_ERROR' as const,
          word: message.word,
          code: 'NETWORK' as const,
        }
      }
    }),
  )
}

async function handleActivate(
  message: ActivateLicenseRequest,
): Promise<ActivateLicenseResult> {
  try {
    const { ok, data } = await fetchJson<{
      valid?: boolean
      status?: string
      license_required?: boolean
      detail?: string
    }>('/api/license/activate', { license_key: message.licenseKey })

    if (ok && data?.valid) {
      apiOnline = true
      cachedLicenseKey = message.licenseKey
      await chrome.storage.sync.set({ licenseKey: message.licenseKey })
      await entitlement.rememberLicense(true, data.status ?? 'active')
      return {
        type: 'ACTIVATE_LICENSE_RESULT',
        ok: true,
        licenseRequired: data.license_required !== false,
        status: data.status ?? 'active',
      }
    }

    if (ok) {
      apiOnline = true
      await entitlement.rememberLicense(false, data?.status ?? 'invalid')
    }
    return {
      type: 'ACTIVATE_LICENSE_RESULT',
      ok: false,
      licenseRequired: data?.license_required !== false,
      status: data?.status ?? 'invalid',
      error: data?.detail ?? 'license_invalid',
    }
  } catch {
    apiOnline = false
    return {
      type: 'ACTIVATE_LICENSE_RESULT',
      ok: false,
      licenseRequired: true,
      status: 'network',
      error: 'network',
    }
  }
}

async function refreshLicenseCache(licenseKey: string): Promise<void> {
  if (!licenseKey) return
  try {
    const { ok, data } = await fetchJson<{ valid?: boolean; status?: string }>(
      '/api/license/activate',
      { license_key: licenseKey },
    )
    if (!ok || data?.valid == null) return
    apiOnline = true
    await entitlement.rememberLicense(data.valid === true, data.status ?? 'unknown')
  } catch {
    apiOnline = false
  }
}

async function handleStatus(): Promise<ExtensionStatus> {
  const settings = await getSettings()
  let apiReachable = false
  let licenseRequired = false
  await entitlement.ensureActivated()

  try {
    const response = await fetch(`${API_BASE_URL}/api/health`)
    if (response.ok) {
      const data = (await response.json()) as { license_required?: boolean }
      apiReachable = true
      apiOnline = true
      licenseRequired = data.license_required === true
      if (settings.licenseKey) await refreshLicenseCache(settings.licenseKey)
    }
  } catch {
    apiReachable = false
    apiOnline = false
  }

  return {
    type: 'STATUS',
    enabled: settings.enabled,
    manualConversionEnabled: settings.profile.manualConversionEnabled,
    directShortcutEnabled: settings.profile.directShortcutEnabled,
    commandShortcut: await readCommandShortcut(),
    licenseKey: settings.licenseKey,
    licenseRequired,
    apiBaseUrl: API_BASE_URL,
    apiReachable,
    profile: toLayoutProfile(settings.profile),
    excludedDomains: settings.profile.excludedDomains,
    personalExceptions: settings.profile.personalExceptions,
    pausedUntil: settings.profile.pausedUntil,
    recentCorrections: await loadHistory(),
    layouts: getSupportedLayouts().map((layout) => ({
      id: layout.id,
      name: layout.name,
      language: layout.language,
    })),
    entitlement: await entitlement.snapshot(),
  }
}

async function handleCanIntervene(): Promise<InterveneDecisionResult> {
  const decision = await entitlement.canIntervene()
  return {
    type: 'INTERVENE_DECISION',
    decision,
    canIntervene: decision === 'ALLOW',
  }
}

async function handleSetEnabled(message: SetEnabledRequest): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    enabled: message.enabled,
    pausedUntil: message.enabled ? 0 : current.pausedUntil,
  })
  return handleStatus()
}

async function handleSetManualConversion(
  message: SetManualConversionRequest,
): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    manualConversionEnabled: message.enabled,
  })
  return handleStatus()
}

async function handleSetDirectShortcut(
  message: SetDirectShortcutRequest,
): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    directShortcutEnabled: message.enabled,
  })
  return handleStatus()
}

async function readCommandShortcut(): Promise<string> {
  try {
    const commands = await chrome.commands.getAll()
    return readAssignedShortcut(commands)
  } catch {
    return ''
  }
}

async function handleSetProfile(message: SetProfileRequest): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  const layouts = normalizeProfile(message.profile)
  await persistUserProfile({
    ...current,
    sourceLayout: layouts.sourceLayout,
    enabledLayouts: layouts.enabledLayouts,
  })
  return handleStatus()
}

async function handleSetExcludedDomains(
  message: SetExcludedDomainsRequest,
): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    excludedDomains: normalizeExcludedDomains(message.domains),
  })
  return handleStatus()
}

async function handleAddException(message: AddExceptionRequest): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  const events = await loadEvents()
  const learned = applyCorrectionEvent(
    events,
    current.personalExceptions,
    'ignored',
    message.token,
  )
  await persistEvents(learned.events)
  await persistUserProfile({
    ...current,
    personalExceptions: learned.exceptions,
  })
  return handleStatus()
}

async function handleRemoveException(
  message: RemoveExceptionRequest,
): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    personalExceptions: removeException(current.personalExceptions, message.token),
  })
  return handleStatus()
}

async function handleRecordCorrection(message: RecordCorrectionRequest): Promise<void> {
  const current = await loadUserProfile()
  const events = await loadEvents()
  const learned = applyCorrectionEvent(
    events,
    current.personalExceptions,
    message.kind,
    message.token,
    message.replacement,
  )
  await persistEvents(learned.events)
  if (message.kind === 'accepted' && message.replacement) {
    const history = await loadHistory()
    await persistHistory(appendHistory(history, message.token, message.replacement))
  }
  if (learned.addedException) {
    await persistUserProfile({
      ...current,
      personalExceptions: learned.exceptions,
    })
  }
}

async function handlePause(message: PauseTemporarilyRequest): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    pausedUntil: Date.now() + (message.ms ?? TEMPORARY_PAUSE_MS),
  })
  return handleStatus()
}

async function handleAddExcludedDomain(
  message: AddExcludedDomainRequest,
): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    excludedDomains: addExcludedDomain(current.excludedDomains, message.domain),
  })
  return handleStatus()
}

async function handleRemoveExcludedDomain(
  message: RemoveExcludedDomainRequest,
): Promise<ExtensionStatus> {
  const current = await loadUserProfile()
  await persistUserProfile({
    ...current,
    excludedDomains: removeExcludedDomain(current.excludedDomains, message.domain),
  })
  return handleStatus()
}

async function handleClearHistory(_message: ClearHistoryRequest): Promise<ExtensionStatus> {
  await persistHistory([])
  return handleStatus()
}

async function detectUserLayouts(): Promise<void> {
  const stored = await chrome.storage.sync.get({ languagesAutoDetected: false })
  if (stored.languagesAutoDetected) return
  await chrome.storage.sync.set({ languagesAutoDetected: true })
}

chrome.runtime.onInstalled.addListener(() => {
  void detectUserLayouts()
  void entitlement.ensureActivated()
})

chrome.runtime.onStartup.addListener(() => {
  void entitlement.ensureActivated()
})

void wordCache.ready()
void detectUserLayouts()
void entitlement.ensureActivated()

try {
  chrome.commands.onCommand.addListener((command) => {
    if (!isFixCurrentTextCommand(command)) return
    void sendFixCurrentTextToActiveTab()
  })
} catch {
  // Commands API unavailable — popup shows an unassigned shortcut.
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive') return
})

chrome.runtime.onMessage.addListener(
  (message: ExtensionRequest, _sender, sendResponse) => {
    void (async () => {
      try {
        if (message?.type === 'CHECK_WORD') {
          sendResponse(await handleCheckWord(message))
          return
        }
        if (message?.type === 'ACTIVATE_LICENSE') {
          sendResponse(await handleActivate(message))
          return
        }
        if (message?.type === 'GET_STATUS') {
          sendResponse(await handleStatus())
          return
        }
        if (message?.type === 'SET_ENABLED') {
          sendResponse(await handleSetEnabled(message))
          return
        }
        if (message?.type === 'SET_MANUAL_CONVERSION') {
          sendResponse(await handleSetManualConversion(message))
          return
        }
        if (message?.type === 'SET_DIRECT_SHORTCUT') {
          sendResponse(await handleSetDirectShortcut(message))
          return
        }
        if (message?.type === 'SET_PROFILE') {
          sendResponse(await handleSetProfile(message))
          return
        }
        if (message?.type === 'SET_EXCLUDED_DOMAINS') {
          sendResponse(await handleSetExcludedDomains(message))
          return
        }
        if (message?.type === 'ADD_EXCEPTION') {
          sendResponse(await handleAddException(message))
          return
        }
        if (message?.type === 'REMOVE_EXCEPTION') {
          sendResponse(await handleRemoveException(message))
          return
        }
        if (message?.type === 'RECORD_CORRECTION') {
          await handleRecordCorrection(message)
          sendResponse({ ok: true })
          return
        }
        if (message?.type === 'PAUSE_TEMPORARILY') {
          sendResponse(await handlePause(message))
          return
        }
        if (message?.type === 'ADD_EXCLUDED_DOMAIN') {
          sendResponse(await handleAddExcludedDomain(message))
          return
        }
        if (message?.type === 'REMOVE_EXCLUDED_DOMAIN') {
          sendResponse(await handleRemoveExcludedDomain(message))
          return
        }
        if (message?.type === 'CLEAR_HISTORY') {
          sendResponse(await handleClearHistory(message))
          return
        }
        if (message?.type === 'NOTE_USAGE_ACTIVITY') {
          const view = await entitlement.noteActivity()
          sendResponse({
            type: 'INTERVENE_DECISION',
            decision: view.decision,
            canIntervene: view.canIntervene,
          } satisfies InterveneDecisionResult)
          return
        }
        if (message?.type === 'CAN_INTERVENE') {
          sendResponse(await handleCanIntervene())
          return
        }
        if (message?.type === 'FIX_CURRENT_TEXT') {
          const dispatched = await sendFixCurrentTextToActiveTab()
          sendResponse({
            type: 'FIX_CURRENT_TEXT_RESULT',
            applied: dispatched === 'sent',
            reason: dispatched === 'sent' ? undefined : 'unsupported',
          } satisfies FixCurrentTextResult)
        }
      } catch {
        if (message?.type === 'CHECK_WORD') {
          sendResponse({
            type: 'CHECK_WORD_ERROR',
            word: message.word,
            code: 'UPSTREAM',
          })
        }
      }
    })()
    return true
  },
)
