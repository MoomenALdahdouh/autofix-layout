import { useEffect, useState } from 'react'
import { BRAND } from '../brand.ts'
import { KeyChips } from './KeyChips.tsx'
import { popupShortcutLabels } from './shortcutLabels.ts'
import type { LayoutId } from '../layouts/types.ts'
import type { ActivateLicenseResult, ExtensionStatus } from '../messaging.ts'
import { MARKETING_SITE_URL } from '../pricing.ts'
import { isCorrectionActive } from '../profile/index.ts'
import { Mark } from '../ui/Mark.tsx'
import { Switch } from '../ui/Switch.tsx'
import { EntitlementCard } from './EntitlementCard.tsx'
import { Languages } from './Languages.tsx'
import { ManualConverter } from './ManualConverter.tsx'
import { SettingsPanel, friendlyActivateMessage } from './SettingsPanel.tsx'

const EMPTY_STATUS: ExtensionStatus = {
  type: 'STATUS',
  enabled: true,
  manualConversionEnabled: true,
  directShortcutEnabled: true,
  commandShortcut: '',
  licenseKey: '',
  licenseRequired: false,
  apiBaseUrl: 'http://127.0.0.1:8003',
  apiReachable: false,
  profile: { sourceLayout: 'en-US-qwerty', enabledLayouts: ['en-US-qwerty', 'ar-101'] },
  excludedDomains: [],
  personalExceptions: [],
  pausedUntil: 0,
  recentCorrections: [],
  layouts: [],
  entitlement: {
    state: 'TRIAL',
    decision: 'ALLOW',
    remainingMs: 0,
    nextRefillInMs: null,
    trialRemainingMs: null,
    limitReached: false,
    canIntervene: true,
  },
}

function App() {
  const [status, setStatus] = useState<ExtensionStatus>(EMPTY_STATUS)
  const [licenseInput, setLicenseInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [exceptionDraft, setExceptionDraft] = useState('')
  const [domainDraft, setDomainDraft] = useState('')
  const [tabHost, setTabHost] = useState('')
  const [showLicense, setShowLicense] = useState(false)

  const live = isCorrectionActive({
    enabled: status.enabled,
    pausedUntil: status.pausedUntil,
  })
  const automaticLive = live && status.entitlement.canIntervene
  const liveLabel = !status.enabled
    ? 'Off'
    : !live
      ? 'Paused'
      : status.entitlement.limitReached
        ? 'Paused'
        : automaticLive
          ? 'Active'
          : 'Paused'

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then((next) => {
      const value = next as ExtensionStatus
      setStatus(value)
      setLicenseInput(value.licenseKey)
    })
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      try {
        const host = new URL(tabs[0]?.url ?? '').hostname
        if (host && host !== 'null') setTabHost(host)
      } catch {
        setTabHost('')
      }
    })
  }, [])

  async function activate(): Promise<void> {
    setBusy(true)
    setMessage('')
    const result = (await chrome.runtime.sendMessage({
      type: 'ACTIVATE_LICENSE',
      licenseKey: licenseInput.trim(),
    })) as ActivateLicenseResult
    setBusy(false)
    setMessage(friendlyActivateMessage(result))
    const next = (await chrome.runtime.sendMessage({
      type: 'GET_STATUS',
    })) as ExtensionStatus
    setStatus(next)
  }

  async function toggleEnabled(): Promise<void> {
    const next = (await chrome.runtime.sendMessage({
      type: 'SET_ENABLED',
      enabled: !status.enabled,
    })) as ExtensionStatus
    setStatus(next)
  }

  async function toggleManualConversion(): Promise<void> {
    const next = (await chrome.runtime.sendMessage({
      type: 'SET_MANUAL_CONVERSION',
      enabled: !status.manualConversionEnabled,
    })) as ExtensionStatus
    setStatus(next)
  }

  async function toggleDirectShortcut(): Promise<void> {
    const next = (await chrome.runtime.sendMessage({
      type: 'SET_DIRECT_SHORTCUT',
      enabled: !status.directShortcutEnabled,
    })) as ExtensionStatus
    setStatus(next)
  }

  async function pauseTemporarily(): Promise<void> {
    const next = (await chrome.runtime.sendMessage({
      type: 'PAUSE_TEMPORARILY',
    })) as ExtensionStatus
    setStatus(next)
  }

  async function toggleLayout(id: LayoutId): Promise<void> {
    if (id === status.profile.sourceLayout) return
    const enabled = status.profile.enabledLayouts.includes(id)
      ? status.profile.enabledLayouts.filter((item) => item !== id)
      : [...status.profile.enabledLayouts, id]
    const next = (await chrome.runtime.sendMessage({
      type: 'SET_PROFILE',
      profile: { ...status.profile, enabledLayouts: enabled },
    })) as ExtensionStatus
    setStatus(next)
  }

  async function addException(token = exceptionDraft): Promise<void> {
    const value = token.trim()
    if (!value) return
    const next = (await chrome.runtime.sendMessage({
      type: 'ADD_EXCEPTION',
      token: value,
    })) as ExtensionStatus
    setStatus(next)
    setExceptionDraft('')
  }

  async function removeException(token: string): Promise<void> {
    const next = (await chrome.runtime.sendMessage({
      type: 'REMOVE_EXCEPTION',
      token,
    })) as ExtensionStatus
    setStatus(next)
  }

  async function addDomain(domain = domainDraft): Promise<void> {
    const value = domain.trim()
    if (!value) return
    const next = (await chrome.runtime.sendMessage({
      type: 'ADD_EXCLUDED_DOMAIN',
      domain: value,
    })) as ExtensionStatus
    setStatus(next)
    setDomainDraft('')
  }

  async function removeDomain(domain: string): Promise<void> {
    const next = (await chrome.runtime.sendMessage({
      type: 'REMOVE_EXCLUDED_DOMAIN',
      domain,
    })) as ExtensionStatus
    setStatus(next)
  }

  async function clearHistory(): Promise<void> {
    const next = (await chrome.runtime.sendMessage({
      type: 'CLEAR_HISTORY',
    })) as ExtensionStatus
    setStatus(next)
  }

  function openPrivacy(): void {
    if (MARKETING_SITE_URL) {
      void chrome.tabs.create({ url: `${MARKETING_SITE_URL.replace(/\/$/, '')}/privacy.html` })
    }
  }

  const shortcuts = popupShortcutLabels(status.commandShortcut)

  return (
    <main className="popup">
      <header className="brand">
        <Mark size={32} />
        <div className="brand-copy">
          <h1>{BRAND.name}</h1>
          <p className="lede">Forgot your keyboard layout? Keep typing.</p>
        </div>
        <span className={`live ${automaticLive ? 'on' : ''}`}>
          <i />
          {liveLabel}
        </span>
      </header>

      {status.profile.enabledLayouts.length < 2 ? (
        <Languages status={status} onToggle={(id) => void toggleLayout(id)} />
      ) : null}

      <ManualConverter
        profile={status.profile}
        layouts={status.layouts}
        enabled={status.manualConversionEnabled}
        shortcutHint={shortcuts.converter}
        onToggle={() => void toggleManualConversion()}
      />

      {status.profile.enabledLayouts.length >= 2 ? (
        <Languages status={status} onToggle={(id) => void toggleLayout(id)} />
      ) : null}

      <section className="page-card">
        <div className="card-head">
          <h2>Fix on pages</h2>
          <p>Correct the field you are typing in — without opening this popup.</p>
        </div>
        <div className="page-row">
          <div>
            <strong>While typing</strong>
            <p>
              {!status.enabled
                ? 'Off'
                : status.entitlement.limitReached
                  ? 'Paused until free usage refills'
                  : live
                    ? 'Fixes the last word after Space, Enter, or Tab'
                    : 'Paused for an hour'}
            </p>
            <KeyChips keys={shortcuts.auto} />
          </div>
          <Switch
            checked={status.enabled}
            label="Automatic correction"
            onToggle={() => void toggleEnabled()}
          />
        </div>
        <div className="page-row">
          <div>
            <strong>Fix now</strong>
            <p>Corrects the whole field at once</p>
            <KeyChips keys={[shortcuts.fix]} />
          </div>
          <Switch
            checked={status.directShortcutEnabled}
            label="Keyboard shortcut"
            onToggle={() => void toggleDirectShortcut()}
          />
        </div>
        {status.enabled && live ? (
          <button type="button" className="quiet" onClick={() => void pauseTemporarily()}>
            Pause auto-correct for 1 hour
          </button>
        ) : null}
      </section>

      <EntitlementCard
        entitlement={status.entitlement}
        onUpgrade={() => setShowLicense(true)}
      />

      <SettingsPanel
        status={status}
        licenseInput={licenseInput}
        busy={busy}
        message={message}
        exceptionDraft={exceptionDraft}
        domainDraft={domainDraft}
        tabHost={tabHost}
        showLicense={showLicense}
        onLicenseInput={setLicenseInput}
        onActivate={() => void activate()}
        onExceptionDraft={setExceptionDraft}
        onAddException={(token) => void addException(token)}
        onRemoveException={(token) => void removeException(token)}
        onDomainDraft={setDomainDraft}
        onAddDomain={(domain) => void addDomain(domain)}
        onRemoveDomain={(domain) => void removeDomain(domain)}
        onClearHistory={() => void clearHistory()}
        onPlayground={() => void chrome.runtime.openOptionsPage()}
      />

      <footer className="foot">
        {MARKETING_SITE_URL ? (
          <button type="button" className="linkish" onClick={openPrivacy}>
            Privacy
          </button>
        ) : (
          <p>Privacy: manual text stays on this device. Automatic mode may send a word to classify it.</p>
        )}
      </footer>
    </main>
  )
}

export default App
