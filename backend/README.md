# AutoFix Layout API

FastAPI classifier for the Chrome extension. It decides `VALID` vs `LAYOUT_MISMATCH` for a token. It never remaps characters and never translates.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Put your Groq key in `.env` as `GROQ_API_KEY`. Never commit `.env`.

`DEV_SKIP_LICENSE=true` is local-only. Production must set `APP_ENV=production`, `LEMON_SQUEEZY_API_KEY`, and leave that flag false — a missing Lemon key refuses to start in production and returns `503` in other environments. Do not set `CORS_ORIGINS=*`.

Default model is `allam-2-7b`. Override with `GROQ_MODEL` if needed.

See [`.env.example`](.env.example) for rate limits, license TTL, and classifier cache version. Production hosting: [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

## Run

The extension default is `http://127.0.0.1:8003`. Use that port, or build the extension with `VITE_API_BASE_URL` pointing at yours.

```bash
source .venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8003
```

`POST /api/analyze-word` accepts:

```json
{
  "license_key": "optional-in-dev",
  "word": "hsjo]lj",
  "context": "hsjo]lj React",
  "source_layout": "en-US-qwerty",
  "candidate_layouts": ["en-US-qwerty", "ar-101"]
}
```

Missing `candidate_layouts` defaults to English + Arabic.

Response:

```json
{ "result": { "kind": "VALID" } }
```

```json
{ "result": { "kind": "UNCERTAIN" } }
```

```json
{ "result": { "kind": "LAYOUT_MISMATCH", "target_layout": "ar-101" } }
```

`UNCERTAIN` is treated as `VALID` (no remap). The target must be in the request’s `candidate_layouts` and in `catalog.json`.

`GET /health` is a simple liveness probe (`{"status":"ok"}`).  
`GET /api/health` lists implemented layouts from `src/layouts/catalog.json`.

`POST /api/analyze-word` and `POST /api/license/activate` return `429 {"detail":"rate_limited"}` when the per-IP window is exceeded. The extension must treat that as a no-op.
