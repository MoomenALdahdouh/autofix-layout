# Layfix — Edge development

The Edge package is the same Manifest V3 extension as Chrome. Product behavior is not forked.

## 1. Build the Edge version

```bash
npm install
npm test
npm run build:edge
```

Output: `dist/edge`

Optional watch (Chrome HMR target; for Edge, rebuild and reload unpacked):

```bash
npm run build:edge
```

## 2. Open Microsoft Edge

Use current Microsoft Edge desktop (Chromium).

## 3. Open extensions management

In the address bar:

```text
edge://extensions
```

Or: **⋯ → Extensions → Manage extensions**.

## 4. Enable developer mode

Turn on **Developer mode** (top of `edge://extensions`).

## 5. Load unpacked

Choose **Load unpacked**.

## 6. Select the Edge output folder

Select:

```text
dist/edge
```

Do not load `dist/chrome` into Edge if you are testing the Edge package, and do not load `dist/edge` as a substitute for a Chrome store build. Both folders come from the same source.

## 7. Test

Confirm at least:

- Popup opens and matches Chrome
- Automatic correction after Space on a synthetic token (`hsjo]lj`)
- Manual converter in the popup
- Settings persist after closing the popup
- Trial / Free copy appears for a fresh profile
- Backend `POST /api/analyze-word` works when the local API is running

Use synthetic text only.

## 8. Reload after changes

After `npm run build:edge`:

1. Open `edge://extensions`
2. Click **Reload** on Layfix
3. Reload any test tabs so the content script updates

Service workers stop when idle. A reload after rebuild is the reliable way to pick up background changes.

## Same API as Chrome

Edge talks to the same Layfix API:

- `POST /api/analyze-word`
- `POST /api/license/activate`
- `GET /api/health`

Build with a production host when needed:

```bash
VITE_API_BASE_URL=https://[API_PRODUCTION_DOMAIN] npm run build:edge
```

## Chrome remains the default local workflow

```bash
npm run build:chrome
# chrome://extensions → Load unpacked → dist/chrome
```
