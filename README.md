# Layfix

Chromium extension (Chrome and Microsoft Edge) + FastAPI service that remaps a token typed on the wrong keyboard layout. It is not a translator, IME, or OS layout switcher.

Canonical proof:

```text
Typed:     hsjo]lj React td hgjwldl
Intended:  استخدمت React في التصميم
```

## Implemented

- Layouts with tests: US QWERTY, Arabic 101, Russian, German QWERTZ, French AZERTY, Turkish Q, Hebrew, Greek, Spanish, Italian, Portuguese, Ukrainian, Persian
- Token-level mixed sentences; `enabledLayouts` is the only candidate set (two layouts required)
- Isolated short tokens (`td`, `ig`) stay; they remap only with sibling evidence
- Groq classifies `VALID` / `UNCERTAIN` / `LAYOUT_MISMATCH`; `mapLayout` remaps locally (`UNCERTAIN` = no-op)
- Content script is DOM-only; the service worker owns network and cache
- Safety gate: passwords, secrets, URLs, emails, code identifiers, excluded domains
- IME composition lock; snapshot + race checks before any DOM write
- Local cache (memory + `chrome.storage.local`) and request coalescing
- Independent toggles: direct page intervention vs local manual conversion (popup + `Ctrl/⌘+Shift+L` page speed box; same `convertManualText` engine)
- Local profile, never-correct list, correction history, 1-hour pause
- Lemon Squeezy license check on the server; Groq/Lemon keys never ship in the extension

Layout, cache, safety, DOM, and API contracts: see the repository tree in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Planned (not claimed)

IME languages (Chinese / Japanese / Korean), more regional variants, Russian lexicon / sentence-wide Russian remap, instance-bound licenses, Docs/Notion adapters.

## Extension

```bash
npm install
npm test
npm run build:chrome   # dist/chrome
npm run build:edge     # dist/edge
```

Chrome: load `dist/chrome` in `chrome://extensions` (Developer mode → Load unpacked).  
Edge: load `dist/edge` in `edge://extensions` (Developer mode → Load unpacked). See [`EDGE_DEVELOPMENT.md`](EDGE_DEVELOPMENT.md).

`npm run build` produces the Chrome package. Both browsers share one source tree and one product version.

Marketing and legal pages live in `site/` (open `site/index.html`). Visual rules: [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md). Store listing draft: [`site/STORE_LISTING.md`](site/STORE_LISTING.md).

Local API default: `http://127.0.0.1:8003`. For a production API host, build with `VITE_API_BASE_URL=https://your-api.example` so that origin is added to `host_permissions`.

## Backend

See [`backend/README.md`](backend/README.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md). Production must set `APP_ENV=production`, `LEMON_SQUEEZY_API_KEY`, and leave `DEV_SKIP_LICENSE=false`. Do not set `CORS_ORIGINS=*`.
