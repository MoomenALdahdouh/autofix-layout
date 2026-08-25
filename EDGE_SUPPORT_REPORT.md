# Layfix — Edge support report

Chrome and Edge are two distribution channels for **one** product. This pass does not claim a live Edge Add-ons listing or that every website was tested in Edge desktop.

## 1. Edge compatibility status

Microsoft Edge desktop uses Chromium Manifest V3 and the `chrome.*` API. The APIs Layfix already uses (`runtime`, `storage.local`, `storage.sync`, `tabs`) are the same on Edge.

Status: **IMPLEMENTED** in the build. **TESTED** as automated unit/build checks. End-to-end on Edge desktop: **REQUIRES MANUAL ACTION**.

## 2. Files changed

| Area | Files |
| --- | --- |
| Build targets | `build/target.ts`, `build/chrome/README.md`, `build/edge/README.md`, `vite.config.ts`, `package.json` |
| Thin API helper | `src/browser/extensionApi.ts`, `src/runtime.ts` (alive check only) |
| Website install | `site/js/browser.js`, `site/js/site.js`, `site/js/config.js`, `site/index.html`, `site/pricing.html`, `site/privacy.html` |
| CORS comments | `backend/settings.py`, `backend/.env.example` |
| Docs | `EDGE_DEVELOPMENT.md`, `EDGE_RELEASE.md`, `site/STORE_LISTING.md`, `store/README.md`, README / ARCHITECTURE |
| CI | `.github/workflows/check.yml` builds both targets |

Not duplicated: layouts, conversion, popup, entitlement, content script, background classify path, backend routes.

## 3. Shared code reused

**IMPLEMENTED.** One `src/` tree. Both packages compile the same service worker, content script, popup, entitlement, and `mapLayout` engine.

## 4. Browser-specific code added

**IMPLEMENTED**, kept small:

- `LAYFIX_BROWSER=chrome|edge` selects `dist/chrome` or `dist/edge`
- Website store-button order from Client Hints brands (not product logic)
- `extensionApi()` resolves `chrome.*` (Edge provides the same global)

No `if (isEdge) { different engine }` paths.

## 5. Manifest differences

**NOT APPLICABLE** as a product fork. Both builds are Manifest V3, name **Layfix**, same permissions, host permissions, content scripts, service worker, action, icons, popup, and options page.

## 6. API differences

**NOT APPLICABLE** for the APIs this extension uses. Edge implements `chrome.runtime`, `chrome.storage`, and `chrome.tabs`. The code still calls `chrome.*` (Chromium standard). No `browser.*` polyfill was added.

## 7. Permission differences

**NOT APPLICABLE.** Edge uses the same `storage`, `activeTab`, `clipboardWrite`, and API host permissions. None were added for Edge.

## 8. CORS changes

**IMPLEMENTED** (documentation + tests only). Chromium Edge origins are `chrome-extension://` + 32-character IDs — the same scheme Chrome uses. The existing regex already allows that. `EXTENSION_IDS` can list the published Chrome ID and Edge ID. `CORS_ORIGINS=*` is still rejected in production.

Pinning both store IDs after publish: **REQUIRES MANUAL ACTION**.

## 9. Build commands

```bash
npm run build          # Chrome → dist/chrome
npm run build:chrome   # same
npm run build:edge     # Edge → dist/edge
npm run build:all      # both
npm run pack:edge      # store/layfix-edge.zip
```

**IMPLEMENTED.**

## 10. Test results

Recorded in this workspace:

| Check | Result | Class |
| --- | --- | --- |
| Shared Vitest (including new browser/target tests) | 228 passed | TESTED |
| Chrome production-shaped build | `dist/chrome`, Manifest V3, name Layfix | TESTED |
| Edge production-shaped build | `dist/edge`, Manifest V3, name Layfix, same version 0.1.0 | TESTED |
| Backend CORS / origin regex | pytest (Chromium Edge origin covered) | TESTED |
| Secret scan of both packages | no Groq/Lemon keys in shipped JS | TESTED |
| Fresh Edge install, Gmail, Docs, … | Not run here | REQUIRES MANUAL ACTION |
| Edge Add-ons upload | Not performed | REQUIRES MANUAL ACTION |

## 11. Real Edge limitations

Only differences that follow from the architecture (not invented Edge bugs):

- License key and trial stamp live in **that browser profile’s** `chrome.storage`. Chrome and Edge do not share storage. The same Lemon key can be pasted on both. No account sync was added.
- Published Chrome ID and Edge ID are different. Pin both in `EXTENSION_IDS` if you stop allowing every `chrome-extension://` origin.
- Store screenshots that show browser chrome must be recaptured in Edge.
- This environment did not drive Edge desktop against Gmail, Docs, Notion, etc. Those results are unknown until someone runs the matrix in `EDGE_DEVELOPMENT.md`.

## 12. Store preparation status

| Item | Class |
| --- | --- |
| Listing copy | IMPLEMENTED in `site/STORE_LISTING.md` |
| 300×300 icon | IMPLEMENTED as `store/icon-300.png` |
| Screenshots | REQUIRES MANUAL ACTION |
| Partner Center account / upload | REQUIRES MANUAL ACTION |
| `[EDGE_ADDONS_URL]` | REQUIRES MANUAL ACTION (placeholder) |

## 13. Manual steps still required

1. Load `dist/edge` in Edge and run the acceptance matrix
2. Capture Edge screenshots
3. Publish on Edge Add-ons
4. Put the real listing URL in `site/js/config.js` as `edgeStoreUrl`
5. Add the published Edge extension ID to `EXTENSION_IDS` together with the Chrome ID
6. Repeat website / privacy URL placeholders when the domain exists

## License association

The license is a Lemon Squeezy key. The extension stores it in `chrome.storage.sync` on the current profile and asks the **same** `/api/license/activate` endpoint. There is no Edge-specific license, no second payment system, and no new sync service.

Limitation: a Pro activation in Chrome does not appear in Edge until the user activates the same key there.

## Production acceptance (this pass)

| Criterion | Class |
| --- | --- |
| Edge build exists (MV3) | IMPLEMENTED / TESTED (build) |
| Chrome build remains functional | IMPLEMENTED / TESTED (build + shared tests) |
| Shared engines / popup / license / usage | IMPLEMENTED |
| Edge service worker / content / popup / storage / API | IMPLEMENTED; device TESTED only via shared tests |
| CORS not `*` | IMPLEMENTED |
| No secrets bundled | Same as Chrome build path |
| Edge docs | IMPLEMENTED |
| Store metadata prepared | IMPLEMENTED |
| Live Edge listing + site matrix | REQUIRES MANUAL ACTION |
