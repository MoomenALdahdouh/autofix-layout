# Protected Context Security Report

**Product:** Layfix  
**Date:** 2026-08-23  
**Approach:** Audit first. Extend the existing field + token gates. No new classifier, API, or keyword encyclopedia.

---

## 1. Existing architecture

Layfix already had **two** protection boundaries. Both run before Groq / FastAPI / cache write.

```text
Focused element
      ↓
isValueEditable?          (input type allowlist — never reads password/file/hidden)
      ↓
skipReasonForField()      (DOM semantics on THIS element only)
      ↓  protected → NO-OP (no tokenize, no CHECK_WORD)
Normal pipeline
      ↓
tokenize → skipReasonForToken() / isSafeToken()
      ↓  secret/machine token → skip (no CHECK_WORD, no cache, no write)
planFieldFixes / local hint / CHECK_WORD
```

Automatic correction (`evaluateEditable`) and Direct Shortcut (`fixCurrentText`) both call `fieldBlocked` **before** planning.

The Manual Converter (`convertManualText` / `mapLayoutText`) is **local and deterministic**. It does not call FastAPI or Groq. That behavior is unchanged: the user pasted the text on purpose.

The browser address bar is not a page field. The content script never receives it.

---

## 2. Existing sensitive-context handling

**Already implemented before this pass**

| Layer | What it blocked |
| --- | --- |
| `isValueEditable` | `type=password`, `file`, `hidden`, `number`, checkboxes, … |
| `skipReasonForField` | `type=password`, `autocomplete` current/new-password / one-time-code / cc-*, name/id secrets, code/console ancestors |
| `skipReasonForToken` | email, URL, JWT, UUID, hash, card digits, API keys, tokens, private keys, env assigns, file paths, shell, code identifiers, all-digit tokens |
| `safeContext` | strips unsafe neighbor tokens before any analyze payload |
| Backend logs | request id + cache hit/miss — **not** the word |

Password **type** was already unreadable: it is not in the textual input allowlist.

---

## 3. Newly identified gaps

| Gap | Risk |
| --- | --- |
| `type=email` and `type=url` were in the textual allowlist | Field value was read and could be tokenized |
| `autocomplete=username` / `name=login` | Login identifiers could be remapped |
| Card fields classified as `password-field` | Correct no-op, unclear reason |
| Placeholder / `<label>` / `aria-labelledby` ignored | “Current password” on a text input could slip through |
| PIN only if `SENSITIVE_NAME` already matched | `name=pin` + numeric mode was incomplete |
| `type=file` only skipped via allowlist | No explicit field reason |

No evidence that a large multilingual dictionary or ML model was required.

---

## 4. Protection rules

**Field (early, no value read for email/url/password/file)**

| Signal | Reason |
| --- | --- |
| `type=password`, `autocomplete` current/new-password, name/placeholder/label “password” | `password-field` |
| `autocomplete=one-time-code`, OTP/TOTP/2FA/verification-code labels, PIN + numeric/tel/short maxLength | `otp-field` |
| `autocomplete` `cc-*`, card/CVV names | `payment-field` |
| `autocomplete=username`, `name`/`id` `username` / `login` / `handle` | `username-field` |
| `type=email` or `autocomplete=email` | `email-field` |
| `type=url` or `autocomplete=url` | `url-field` |
| `type=file` | `file-field` |
| `PRE`/`CODE` ancestors, Monaco / CodeMirror / Ace / highlight classes | `code-region` |
| xterm / terminal / console / repl | `console` |

**Token (after field is allowed)**

Unchanged structural checks: emails, URLs, JWTs, UUIDs, hashes, cards, keys, paths, code-shaped tokens, digits.

**Scope:** only the focused element. A password in a login form does not disable a comment box on the same page.

---

## 5. Why each rule exists

- **Password / OTP / payment:** modifying them locks users out or corrupts money movement. HTML `autocomplete` is the standard signal.
- **Username:** not a secret, but not prose. Remapping a handle is worse than a miss.
- **Email / URL fields:** the entire value is a machine identifier. Do not inspect (`type` removed from the editable allowlist).
- **Email / URL tokens in a chat box:** keep the rest of the sentence; skip only that token.
- **Code / console:** unsupported editors. Guessing is unsafe.
- **Manual converter:** user-initiated local remap; no remote call to add.

---

## 6. False-positive protection

These stay **unprotected** (normal Layfix):

- `type=text` / `search` / `textarea` / chat `contenteditable`
- `name=query`, `name=message`, `name=comment`
- placeholder “Search”
- `type=tel` without PIN/OTP/payment signals (phone in a form)

`name=user` alone is **not** treated as username. `ProseMirror` is **not** globally blocked (many chat boxes use it).

---

## 7. Network protection

If `fieldBlocked` is true:

- `evaluateEditable` returns before `applyLocalFixes` and before `requestVerdict`
- `fixCurrentText` returns `unsupported` before planning
- No `CHECK_WORD` → no FastAPI → no Groq
- `NOTE_USAGE_ACTIVITY` is also skipped when `fieldBlocked` (automatic activity helper)

Token-level skips in the service worker return a local VALID and do not fetch.

Live Chrome/Edge network inspector: **NOT RUN** this session.

---

## 8. Logging protection

| Location | Content logged? |
| --- | --- |
| Content script | No field text |
| `usageDebug` | Off unless `VITE_USAGE_DEBUG`; usage numbers only |
| FastAPI analyze | `rid`, cache hit/miss, layout count — **not** `payload.word` |
| Test `console.log` in audit files | Test-only fixtures, not production |

No new logs were added.

---

## 9. Cache protection

Protected fields never tokenize, so they never hit `hotCache` / `wordCacheV2`.

Unsafe tokens fail `isSafeToken` before `CHECK_WORD` and before `wordCache.set`.

---

## 10. Test matrix

| Case | Gate | Result |
| --- | --- | --- |
| `type=password` | not editable + field | PASS |
| confirm / new-password | field | PASS |
| `one-time-code` | field | PASS |
| PIN + numeric + maxLength 6 | field | PASS |
| `cc-number` / `cc-exp-month` / CVV label | field | PASS |
| `cardNumber` | payment-field | PASS |
| `autocomplete=username` / `name=login` | field | PASS |
| `type=email` / `type=url` | not editable + field | PASS |
| `type=file` | not editable + field | PASS |
| JWT / UUID / hash / API key / path | token | PASS (existing) |
| `user@example.com` / `https://…` | token | PASS |
| Search / comment / chat / message | none | PASS |
| Shortcut + `fieldBlocked` | no-op | PASS |
| `hsjo]lj` in a normal field | still converts | PASS |

Vitest: **294 passed**.

---

## 11. Browser test results

| Surface | Result |
| --- | --- |
| Unit / happy-dom | PASS |
| Login / payment pages in Chrome or Edge | **NOT TESTED** |
| Gmail, GitHub, ChatGPT, Discord, WhatsApp | **NOT TESTED** |
| Network tab zero-request check | **NOT TESTED** |

Do not treat this report as live-site evidence.

---

## 12. Remaining limitations

- Labels are resolved via `for=id`, wrapping `<label>`, or the first `aria-labelledby` id — not a full accessibility tree.
- No extra language dictionary. Arabic “كلمة السر” as the only signal is not covered; `type=password` still is.
- Generic `contenteditable` chat is allowed. Monaco / CodeMirror / highlighted `PRE` are not. Other custom IDEs may still look like a normal editor.
- Manual Converter remains local and will remap whatever the user pastes, including a password they typed there on purpose.
- Username protection is identifier-shaped (`username`, `login`, `handle`), not every field containing “user”.

---

## Acceptance (honest)

| Criterion | Status |
| --- | --- |
| Password / OTP / PIN / payment / card never analyzed | PASS in unit tests |
| Credentials / tokens / URL / email / machine ids | PASS (field + token) |
| Unsupported code editors | PASS for known class/tag signals |
| Zero analysis requests from protected fields | PASS in control flow; live network **NOT TESTED** |
| No content logs / no cache of protected fields | PASS in architecture |
| Automatic + shortcut honor the gate | PASS |
| Chat / comment / search still work | PASS |
| No new security framework | PASS |
| Chrome / Edge live | **NOT TESTED** |
| Existing tests | **294 passed** |
