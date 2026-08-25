# Real-Time Architecture Audit

**Product:** Layfix  
**Date:** 2026-08-23  
**Method:** Read the running source, then measure the real engines. No generic “real-time typing” redesign.

This document is evidence-first. If a number was not measured in a live Chrome/Edge session, it is marked **NOT MEASURED**.

---

## 1. Current architecture

Implemented model (code, not an ideal):

```text
keydown / keyup / input / focusout
        ↓
void evaluateEditable()          ← never blocks the keystroke
        ↓
evaluateGate()
  cached canIntervene ALLOW  → applyLocalFixes() in this turn
  cached DENY                → await CAN_INTERVENE, then maybe apply
        ↓
async evaluateRemote()
  refresh CAN_INTERVENE
  for unknown tokens: void requestVerdict() → SW CHECK_WORD
        ↓
  cache / localClassificationHint / FastAPI / Groq
        ↓
  snapshot + verifyReplacement → commitReplacement or discard
```

Popup / React is not on the typing path. The content script does not `fetch`. The service worker owns network and entitlement.

---

## 2. Actual typing pipeline

| Question | Actual implementation |
| --- | --- |
| How is input captured? | Capture-phase `keydown`, `keyup`, `input`, `focusout`, `compositionstart` / `compositionend` on `document` (`src/content_script.ts`). |
| Which events evaluate? | Space (`keyup` + `input` insertText/lineBreak), Enter/Tab (`keydown` + `keyup`), blur (`focusout`). **Not per keystroke.** Paste/drop ignored. |
| When is a token evaluated? | After a boundary, and only if `isComplete`: followed by a boundary, or `finalizeAll` (Enter/Tab/blur). Caret **inside** a token → that token is skipped this turn. |
| Tokenization | `tokenizeText` — whitespace split, peel lead/trail punct. Sync. |
| Conversion | `mapLayout` / `planFieldFixes`. Sync. Same engine as Manual Converter. |
| Language / layout detection | `inferSourceLayout` from glyphs + `enabledLayouts`. Not a translator. |
| Context | `canCommitMismatch` / `contextSuggestsTarget` for short QWERTY→Arabic (`td`, `ig`). Reverse English uses the English lexicon on the mapped word. |
| Groq | Only after local hint is `null` **and** cache miss. One `POST /api/analyze-word` per unknown token. |
| FastAPI | Service worker only. Content script never calls it. |
| Cache | Content-script hot store + SW `wordCacheV2` + in-process FastAPI cache. Coalesce in-flight by key. |
| Messaging | `CAN_INTERVENE`, `NOTE_USAGE_ACTIVITY` (5s heartbeat), `CHECK_WORD`. |
| DOM write | `commitReplacement`: native value setter + `insertReplacementText`, or contenteditable Range. Surgical offsets. |
| Caret | `adjustCaret` after automatic writes. |
| Multiple tokens | Planned together, applied **right-to-left**. Remote unknowns fired in parallel (`void requestVerdict`). |
| Sequential / parallel | Local: sync batch. Remote: parallel, no queue. Same key coalesced. |
| Debounce | **None.** |
| Cancel | **None.** Stale results discarded by snapshot / generation / text-mismatch / caret-inside-word. |
| Content script wait | Keystrokes are never awaited. **Before this change**, local writes **did** wait on `await interventionAllowed()`. |
| SW on hot path | Yes for usage refresh and unknown-token classify. **No longer** required before a cached-ALLOW local write. |
| Storage on hot path | `canIntervene()` → entitlement `current()` **persists usage on every call** (exclusive chain). `NOTE_USAGE_ACTIVITY` shares that chain. |
| React / Popup | Not involved. |

---

## 3. Exact token lifecycle — `اثممخ`

| Step | Sync/async | Cost (measured unless noted) | Network | Messages | Storage |
| --- | --- | --- | --- | --- | --- |
| Key events | sync | browser | no | no | no |
| Space boundary | sync | — | no | no | no |
| `evaluateGate` | sync | ~0 | no | no | no |
| `planFieldFixes` + `mapLayout` | sync | p50 **0.53ms**, p95 **3.3ms** (200 runs, this machine) | no | no | no |
| `commitReplacement` | sync | p95 **1.1ms** in this audit run | no | no | no |
| `CAN_INTERVENE` refresh | async, after local write | **NOT MEASURED** in Chrome (SW + `chrome.storage` write) | no | yes | **yes** (entitlement persist) |
| Groq | not used for this token | — | — | — | — |

`localClassificationHint('اثممخ')` = `LAYOUT_MISMATCH → en-US-qwerty`. `mapLayout` → `hello`. `canCommitMismatch` true.

---

## 4. Current performance measurements

Local CPU for `اثممخ بقهثىي اخص شقث غخع` (happy-dom / this host, 200 samples):

| Stage | P50 | P95 | P99 |
| --- | --- | --- | --- |
| Tokenize | 0.01ms | 0.03ms | 0.09ms |
| Plan + map | 0.53ms | 3.26ms | 7.14ms |
| Five local hints | 0.24ms | 0.75ms | 3.22ms |
| DOM replace (20 writes) | — | 1.12ms | — |

Live Chrome/Edge:

| Metric | Result |
| --- | --- |
| Input → analysis start | **NOT MEASURED** in a real tab |
| SW `CAN_INTERVENE` RTT | **NOT MEASURED** (code: message + exclusive persist) |
| Groq P50 / P95 / P99 | **NOT MEASURED** (timeout configured at **5s**, no retry) |
| FastAPI overhead vs Groq wait | **NOT MEASURED** |

These local numbers already show tokenization, mapping, and DOM are not the reason a fast typist outruns visible correction.

---

## 5. Actual bottleneck

**Ranked**

### 1. Local correction waited on `CAN_INTERVENE`

**Evidence:** `evaluateEditable` used to `await interventionAllowed()` **before** `applyLocalFixes`. `interventionAllowed` always `sendMessage({ type: 'CAN_INTERVENE' })` even when the in-memory flag was already ALLOW. SW `canIntervene()` runs `exclusive(current)` which **writes `chrome.storage` every time** and shares a lock with `NOTE_USAGE_ACTIVITY`.

**Measured cost:** local work < 5ms p95. The forced wait is a full extension message + storage write (typically tens of ms, sometimes more under contention). Not measured in live Chrome this session.

**Impact:** High-confidence remaps (`hello`, `friend`, …) were delayed until usage bookkeeping finished. The user could already be in the next word. Typing stayed responsive (`void evaluateEditable`); **correction** was late.

**Possible solutions considered:** queue, debounce, worker, Groq change, extra cache, batching. Rejected — they do not address a cached-ALLOW local write waiting on storage.

**Selected:** if cached `canIntervene` is ALLOW, write locally in the same event turn; refresh usage and Groq **after**.

### 2. Groq / FastAPI for unknown tokens only

**Evidence:** `requestVerdict` is already `void` (non-blocking). Fired only when `localClassificationHint === null`. Timeout 5s. No retry. One word per request. Parallel per token. Coalesced by key.

**Measured cost:** **NOT MEASURED** live.

**Impact:** Real for tokens the local engine cannot commit (short / uncertain). **Zero** for the example sentence — all five tokens are local `LAYOUT_MISMATCH`.

**Action:** none. Do not remove or batch Groq without live P95.

### 3. Last token waits for a boundary

**Evidence:** `finalizeAll === false` on Space; a token with no trailing boundary and caret at end of field is complete only if `isBoundaryChar(text[end])`. The last word of a sentence is **not** rewritten until Space, Enter, Tab, or blur.

**Impact:** `... غخع` stays until the next boundary. This is product policy (ARCHITECTURE §2), not a race.

### 4. Tokenization / mapLayout / DOM / React

**Evidence:** measurements above. React is popup-only.

**Impact:** negligible on this path.

---

## 6. Evidence

- `src/adversarial/realtime.audit.test.ts` — per-token decisions, local CPU, space prefixes, delayed write, stale discard.
- `src/content/evaluateGate.ts` + tests — gate behavior.
- `src/entitlement/engine.ts` `canIntervene()` → `current()` → `persist()`.
- `src/content_script.ts` before: `await interventionAllowed()` then `applyLocalFixes`.
- Existing `dom-races.test.ts` — stale writes discarded.

---

## 7. Why the user can outrun the system

Typing is already non-blocking. The user outruns **visible correction** when:

1. **(Was) local write waited on usage IPC/storage.** Fixed for cached ALLOW.
2. **Unknown tokens wait on Groq (up to 5s).** Catch-up is async; stale apply is discarded.
3. **The current word is incomplete** until Space/Enter/Tab/blur.
4. **Several `evaluateEditable` calls can overlap** (no debounce). Writes are snapshot-checked; they do not cancel each other.

The system is allowed to catch up. It must not corrupt newer text. That part already existed.

---

## 8. Partial-correction behavior — `hello بقهثىي how are you`

**This is not a conversion miss in the current engine.**

| Token | Map | Local hint | Commit |
| --- | --- | --- | --- |
| اثممخ | hello | LAYOUT_MISMATCH | yes |
| **بقهثىي** | **friend** | **LAYOUT_MISMATCH** | **yes** |
| اخص | how | LAYOUT_MISMATCH | yes |
| شقث | are | LAYOUT_MISMATCH | yes |
| غخع | you | LAYOUT_MISMATCH | yes |

`planFieldFixes` on the full sentence returns all five fixes. Rewritten text is `hello friend how are you`.

`friend` is in `en-words.ts`. `بقهثىي` is **not** in the Arabic lexicon (`isArabicWord` false), so it is not treated as correct Arabic.

**Why the docs looked like a miss:** ARCHITECTURE and older goldens used `اثممخ اخص شقث غخع` (no `friend`). That is a documentation gap, not a planner gap.

If a user still saw `hello بقهثىي how are you` in a browser, the plausible code causes are:

- `applyLocalFixes` had not run yet (usage await — the measured hot-path bug).
- Caret was **inside** `بقهثىي` that turn (`isComplete` false + `caret-inside-word` discard). A later Space should retry.
- Last-word rule does **not** explain a middle-token miss.

It is **not** because Groq skipped `بقهثىي`. Groq is not consulted when the local hint is `LAYOUT_MISMATCH`.

---

## 9. Race-condition analysis

| Scenario | Actual behavior |
| --- | --- |
| User edits the token before the response | `commitReplacement` discarded (`text-mismatch`). `hello` is not replaced by a late `friend`. **Not a correctness bug.** |
| Out-of-order CHECK_WORD (A=1000ms, B=100ms) | Each snapshot carries its own offsets + original word. Apply is independent. No global “latest wins” clobber. |
| Overlapping evaluates | Both may plan the same tokens. Second write hits `text-mismatch` if the first already remapped. Safe. |
| Artificial network 0–2000ms | Local path does not use the network. Remote path: user keeps typing; late VALID/ERROR → no write; late MISMATCH → write only if snapshot still matches. |
| Requests cancelled? | No. Discard is the cancel. |

---

## 10. Candidate solutions (only those justified)

| Option | Fits measured bottleneck? |
| --- | --- |
| **Skip usage await when cached ALLOW** | **Yes — selected** |
| Queue | No — would delay local writes further |
| Debounce | No — later corrections |
| Web Worker | No — CPU p95 is milliseconds |
| Remove Groq | No — not on this sentence; still needed for uncertain tokens |
| New cache | No — cache already exists; this sentence is local |
| Batch analyze-word | No evidence of request storms on this path |
| Speculative per-keystroke analyze | Violates product rule (boundary only) and would increase Groq load |
| Token versioning / extra anchors | Snapshot already binds element + offsets + original word |

---

## 11. Selected solution

`evaluateGate`:

- `skip` — automatic off, composing, excluded page.
- `local-now` — cached `canIntervene === true` → `applyLocalFixes` in this turn, then async usage refresh + `CHECK_WORD`.
- `await-usage` — cached deny → keep fail-closed; await `CAN_INTERVENE` before any write.

Product rules unchanged: no translate, no rewrite, lexicon + `canCommitMismatch` only, user `enabledLayouts` only.

---

## 12. Why it fits this architecture

Layfix already has a local fast path (`planFieldFixes`). The defect was **scheduling**: that path sat behind a usage RPC that entitlement also uses to persist storage. The smallest change is to trust the same in-memory flag `writeCorrection` already checks, and refresh after the write.

---

## 13. Files changed

| File | Role |
| --- | --- |
| `src/content/evaluateGate.ts` | Gate |
| `src/content_script.ts` | Local write before usage refresh |
| `src/content/evaluateGate.test.ts` | Gate tests |
| `src/adversarial/realtime.audit.test.ts` | Measurement (dev/test only; no production token logs) |
| `src/adversarial/realtime.typing.test.ts` | 30–130 WPM catch-up + burst |
| `src/layouts/mapLayout.test.ts` | Golden includes `بقهثىي` → `friend` |
| `ARCHITECTURE.md` | Pipeline + reverse golden |
| `REAL_TIME_ARCHITECTURE_AUDIT.md` | This report |

No new converter, queue, worker, or Groq client.

---

## 14. Performance before

| Path | Before |
| --- | --- |
| High-confidence local remap after Space | **Blocked on** `await CAN_INTERVENE` (SW + storage persist) |
| Local CPU | < 5ms p95 (already) |
| Unknown token | Async Groq, up to 5s, already non-blocking |
| Typing | Already non-blocking |

Correction latency for `hello` / `friend` = usage IPC, not `mapLayout`.

---

## 15. Performance after

| Path | After |
| --- | --- |
| High-confidence local remap after Space (cached ALLOW) | **Same turn** as the boundary event (`local-now`) |
| Simulated 30–130 WPM + burst | Full sentence → `hello friend how are you` |
| Cached DENY | Still fail-closed (await refresh) |
| Groq / FastAPI | Unchanged |

Live Chrome/Edge P50/P95 of “Space → DOM write” remains **NOT MEASURED**.

---

## 16. Regression results

`npx vitest run`: **287 passed** (23 files).

Includes existing planner, DOM races, entitlement, converter, shortcut, and the new audit/typing/gate tests.

Live WPM in Chrome/Edge, injected network delay, and Groq P95: **NOT TESTED**.

---

## 17. Remaining limitations

- Last word still waits for Space / Enter / Tab / blur.
- Cached ALLOW can apply one extra local batch after the Free limit flips; `writeCorrection` still checks `canIntervene`, and the next boundary refreshes.
- Overlapping evaluates are still possible (by design). Safety is snapshot discard, not a queue.
- Uncertain tokens still wait on Groq (up to 5s). That is catch-up, not a typing freeze.
- Contenteditable / RTL caret in real editors: **NOT MEASURED**.
- No production telemetry (would send tokens).

---

## Processing model (explicit)

The current system is:

- **Event-driven** (boundary events)
- **Synchronous** for high-confidence local remap (after this change, on cached ALLOW)
- **Asynchronous** for usage refresh and Groq
- **Parallel** for unknown-token `CHECK_WORD` (not sequential, not queued)
- **Cached** (memory + persist + server)
- **Not debounced**
- **Not speculative**
- **Not cancelled** (stale-discard instead)

---

## Docs vs code

| ARCHITECTURE.md (before audit) | Code |
| --- | --- |
| Reverse golden omitted `بقهثىي` / `friend` | Engine already remaps it |
| Mermaid implied intervene-then-plan | Intervene was an **awaited SW+storage** call, not a cheap flag |
| “Evaluate after Space/Enter/Tab/blur” | Matches |
| “Content script is DOM-only” | Matches |

---

## Acceptance of the example sentence

Input: `اثممخ بقهثىي اخص شقث غخع`  
Expected: `hello friend how are you`

**Local engine:** already produced the expected string before the scheduling change.  
**Scheduling change:** local remaps no longer wait for usage IPC when ALLOW is cached.  
**Live typed-at-130-WPM in Chrome:** not claimed.
