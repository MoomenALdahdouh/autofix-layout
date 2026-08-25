# Direct Shortcut Test Report

**Product:** Layfix  
**Feature:** Manifest V3 command `FIX_CURRENT_TEXT` — surgical keyboard-layout correction in the focused field  
**Date:** 2026-08-23  
**Status:** Unit-tested and built. **Not accepted as complete for public launch** — live Chrome/Edge/website runs were not evidenced in this session.

This report records evidence only. A gap is a gap.

---

## 1. Shortcut configuration

| Item | Value | Evidence |
| --- | --- | --- |
| Command name | `FIX_CURRENT_TEXT` | `manifest.json` `commands` |
| Suggested default (Windows/Linux) | `Ctrl+Shift+P` | same |
| Suggested default (macOS) | `Command+Shift+P` | same |
| Display hint | `Ctrl/⌘+Shift+P` | `DIRECT_SHORTCUT_DEFAULT_HINT` |
| User-changeable | Browser extension shortcut UI | Popup link → `chrome://extensions/shortcuts` or `edge://extensions/shortcuts` |
| Custom editor | None | Popup shows assigned shortcut from `chrome.commands.getAll()` |
| Collision with Manual Converter | Avoided | Converter remains content-script `Ctrl/⌘+Shift+L` (physical `KeyL`) |
| Unassigned / conflict | Popup shows “Not assigned · suggested …” | `readAssignedShortcut` + unit tests |

Chrome and Edge share the same command declaration. The browser may still leave the shortcut empty if it conflicts on that machine. The product treats empty as unassigned; pressing nothing happens.

---

## 2. Chrome results

| Check | Result |
| --- | --- |
| `vite` Chrome build | PASS — `dist/chrome/manifest.json` contains `FIX_CURRENT_TEXT` |
| Loaded unpacked extension, live command press | **NOT TESTED** |
| `chrome.commands.getAll()` in a running Chrome profile | **NOT TESTED** |

A previous session found Chrome 151 `--load-extension` did not inject the content script. That environment was not re-proven here.

---

## 3. Edge results

| Check | Result |
| --- | --- |
| `vite` Edge build | PASS — `dist/edge/manifest.json` contains the same command |
| Loaded unpacked extension, live command press | **NOT TESTED** |

---

## 4. Windows results

**NOT TESTED.** Suggested default is the Chromium-documented `Ctrl+Shift+P` form.

---

## 5. macOS results

Host OS for this session is macOS (darwin). That only proves unit tests and Vite builds ran here.

Live Command+Shift+P in Chrome or Edge: **NOT TESTED.**

---

## 6. Selection tests

| Case | Expected | Result |
| --- | --- | --- |
| Select `hsjo]lj` in `مرحبا hsjo]lj how are you` | Only that token becomes `استخدمت` | PASS (happy-dom) |
| Select the whole mixed sentence | Same: only the wrong-layout token changes | PASS |
| Select whitespace | No-op | PASS |
| Select already-correct mixed text | No-op | PASS |

---

## 7. Current-token tests

| Case | Expected | Result |
| --- | --- | --- |
| Caret inside `hsjo]lj` | That token only | PASS |
| Caret at token end (`hello\| world`) | Targets `hello` | PASS (boundary inclusive) |
| Caret in a space gap | No-op | PASS |

---

## 8. Input tests

`input[type=text]`: replace + caret after correction + focus kept. PASS (happy-dom).

Password / hidden / OTP fields are skipped by the existing field probe. Covered by existing safety tests, not re-run against the command in a real page.

---

## 9. Textarea tests

Same writer as automatic correction. PASS (happy-dom).

---

## 10. Contenteditable tests

Nested `<strong>hsjo]lj</strong>` replaced without dropping the element. PASS (happy-dom).

Rich editors (Docs, Notion, Slack compose): **NOT TESTED**. Unsupported contexts must no-op; that was not proven on those sites.

---

## 11. Mixed-language tests

| Input | Action | Expected | Result |
| --- | --- | --- | --- |
| `مرحبا هذا انا how are you` | Shortcut | No change | PASS |
| `مرحبا hsjo]lj how are you` | Caret / selection on wrong token | `مرحبا استخدمت how are you` | PASS |
| Full-sentence selection of the mixed-wrong line | Only `hsjo]lj` changes | PASS |

---

## 12. False-positive tests

| Token | Result |
| --- | --- |
| `React` | No-op PASS |
| `API` | No-op PASS |
| `Laravel` | No-op PASS |
| `https://example.com` | No-op PASS |
| `test@example.com` | No-op PASS |
| `123` / `2026-08-23` | No-op PASS |

These use the existing tokenizer + `isSafeToken` + `planFieldFixes`. No second denylist.

---

## 13. False-negative tests

High-confidence Arabic mismatch `hsjo]lj` → `استخدمت` still converts on the shortcut path. PASS.

Tokens that only Groq can resolve were not live-tested. If the classifier is uncertain, the existing contract is no-op.

---

## 14. Cursor tests

After a shortcut write, caret is placed after the replacement (`placeCaretAfter`). PASS on input (happy-dom). Focus remained on the field.

---

## 15. Undo tests

Value writes still dispatch `insertReplacementText` (existing contract). PASS as a unit assertion.

Native Ctrl/Cmd+Z in Chrome/Edge: **NOT TESTED**. No fake undo stack was added.

Contenteditable uses the existing Range insert (not `execCommand('insertText')`). Undo there is host-dependent and unproven.

---

## 16. Race-condition tests

| Case | Result |
| --- | --- |
| Existing automatic snapshot races (`dom-races.test.ts`) | Still PASS |
| Shortcut: field text changed before apply | `commitReplacement` discarded; text stays user-edited PASS |
| Shortcut: selection changed before classify | `shortcutSessionStillValid` false PASS |

---

## 17. Network failure tests

Shortcut classify reuses `CHECK_WORD`. Network / 429 / invalid response already return VALID or `CHECK_WORD_ERROR`; the content script does not write. No new network client.

Live 429 / Groq-down while pressing the command: **NOT TESTED**.

---

## 18. Free-limit tests

`usageAllowed` / `CAN_INTERVENE` DENY → shortcut reason `usage`, field unchanged. PASS (injected host).

Live Free balance at 0 in Chrome: **NOT TESTED**.

---

## 19. Pro tests

No separate Pro code path. If `CAN_INTERVENE` is ALLOW, the shortcut uses the same writer. Live Pro license: **NOT TESTED**.

---

## 20. Website compatibility

| Site | Result |
| --- | --- |
| Google Search | **NOT TESTED** |
| Gmail | **NOT TESTED** |
| Google Docs | **NOT TESTED** — likely unsupported (canvas) |
| GitHub | **NOT TESTED** |
| Reddit | **NOT TESTED** |
| LinkedIn | **NOT TESTED** |
| X | **NOT TESTED** |
| WhatsApp Web | **NOT TESTED** |
| Discord Web | **NOT TESTED** |
| Slack Web | **NOT TESTED** |
| Notion | **NOT TESTED** |
| ChatGPT | **NOT TESTED** |
| Claude | **NOT TESTED** |
| Gemini | **NOT TESTED** |

Supported in code where the existing writer already works: `input` text-like types, `textarea`, `contenteditable` that the Range writer can update. Do not claim site compatibility from this report.

---

## 21. Known limitations

- Live Commands API assignment is browser-owned. The default may be empty on a given machine.
- Google Docs and other non-standard editors are not implemented. Shortcut no-ops if there is no supported focused field.
- Automatic commit is still conservative: Arabic lexicon + `ghbdtn` locally. Other layouts work in the Manual Converter, not as automatic/shortcut commits unless `canCommitMismatch` allows them.
- Contenteditable undo is not a custom stack and was not proven in a real browser.
- `npm run build:chrome` / `build:edge` still run `tsc -b`, which fails on a pre-existing `node:fs` typing error in `realWorldCorpus.test.ts`. `vite build` for both targets succeeded.

---

## 22. Remaining bugs / gaps

1. No live Chrome command press.
2. No live Edge command press.
3. No Windows keyboard verification.
4. No macOS-in-browser verification.
5. No website matrix.
6. No native undo verification.
7. No live Free-limit or Pro entitlement verification on the command path.

Until those are evidenced, release acceptance item “Chrome works / Edge works / websites” is **not** checked.

---

## Regression

`npx vitest run`: **268 passed** (20 files). Previous suite was 238; new coverage is command registration, dispatch, targeting, mixed-language no-op, input/textarea/contenteditable writes, usage deny, toggle independence, and stale apply.

Chrome Vite build: PASS.  
Edge Vite build: PASS.

Speed box `Ctrl/⌘+Shift+L` tests still pass. Automatic planner tests still pass.

---

## Acceptance checklist (honest)

| Criterion | Status |
| --- | --- |
| Shortcut does not open Manual Converter | PASS in code (command path never calls `speedBox.open`) — not live-tested |
| Shortcut directly modifies the active field | PASS in happy-dom |
| Selection has priority | PASS |
| No selection → current token | PASS |
| Correct text unchanged | PASS |
| Uncertain text unchanged | PASS (existing engine) |
| Mixed-language conservative | PASS |
| Surgical replace | PASS |
| Caret after correction | PASS (happy-dom input) |
| Undo natural | PARTIAL — `insertReplacementText` only |
| No full-page DOM replace | PASS |
| Network / 429 / Free limit → no-op | PASS in wiring; live API **NOT TESTED** |
| Automatic OFF does not disable shortcut | PASS (unit + `explicit` CHECK_WORD) |
| Manual Converter independent | PASS |
| Chrome / Edge / Windows / macOS live | **NOT TESTED** |
| Shortcut changeable in browser settings | PASS in UI wiring |
| Existing + new tests | PASS (268) |
