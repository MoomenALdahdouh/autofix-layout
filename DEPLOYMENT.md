# Layfix API — Deployment

This is the procedure for hosting the existing FastAPI service. It does not invent extra infrastructure. Domains below are placeholders until they are purchased and confirmed.

Placeholders:

- API: `https://[API_PRODUCTION_DOMAIN]`
- Website: `https://[WEB_PRODUCTION_DOMAIN]`

Nothing in this file is a live credential. Do not paste real API keys here.

---

## 1. Required server

One Linux VM or one container on a small PaaS (Render, Fly, Railway, or equivalent).

- One application process
- No PostgreSQL
- No Redis
- No queue workers
- No Kubernetes

The marketing site in `site/` is static files. Host it separately on any static HTTPS host, or the same reverse proxy as a file root. It does not need the Python process.

## 2. Runtime

- Python 3.11
- `uvicorn` serving `backend/main.py:app`
- Single worker for the first launch (in-memory cache and rate limits are per process)

## 3. Required environment variables

Copy `backend/.env.example` to a server-side secret store or `backend/.env` that is never committed.

Required in production:

| Variable | Purpose |
| --- | --- |
| `APP_ENV=production` | Disables docs, forbids `DEV_SKIP_LICENSE`, rejects `CORS_ORIGINS=*` |
| `DEBUG=false` | Must stay false in production |
| `GROQ_API_KEY` | Server-only classifier key |
| `LEMON_SQUEEZY_API_KEY` | Server-only license validation |
| `CORS_ORIGINS` | Production website origin, if the site calls the API. Leave empty for extension-only. |

Recommended:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GROQ_MODEL` | `allam-2-7b` | Classifier model |
| `GROQ_TIMEOUT_SECONDS` | `5` | Groq timeout |
| `CLASSIFIER_VERSION` | `v1` | Cache key prefix |
| `LICENSE_CACHE_TTL` | `900` | Valid license cache (seconds) |
| `INVALID_LICENSE_TTL_SECONDS` | `90` | Invalid license cache |
| `WORD_TTL_SECONDS` | `86400` | Classification cache |
| `RATE_LIMIT_ANALYZE_PER_MINUTE` | `120` | `/api/analyze-word` per IP |
| `RATE_LIMIT_LICENSE_PER_MINUTE` | `20` | `/api/license/activate` per IP |
| `EXTENSION_IDS` | empty | Pin published Chrome **and** Edge 32-character IDs |
| `TRUST_PROXY` | `false` | Set true only behind a trusted reverse proxy |

`LEMON_SQUEEZY_STORE_ID` and `LEMON_SQUEEZY_PRODUCT_ID` are unused by the current validate-only flow. Leave them empty.

`DATABASE_URL` is not used. Do not set it.

Extension production build (not a server secret):

```bash
VITE_API_BASE_URL=https://[API_PRODUCTION_DOMAIN] npm run build:all
```

## 4. Installation

```bash
git clone [REPO_URL]
cd autofix-layout
python3.11 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# edit backend/.env on the server only
```

Optional container (same one service, no compose stack):

```bash
docker build -t layfix-api .
docker run --env-file /secure/layfix.env -p 8000:8000 layfix-api
```

Do not copy `.env` into the image.

## 5. Build

API: no compile step. `pip install` is sufficient.

Extension (separate artifact, not served by FastAPI):

```bash
npm ci
npm test
npm run lint
VITE_API_BASE_URL=https://[API_PRODUCTION_DOMAIN] npm run build:all
```

Load or pack `dist/`. Confirm the bundle does not contain `GROQ_API_KEY` or `LEMON_SQUEEZY_API_KEY`.

## 6. Migrations

None. There is no application database.

## 7. Start

From `backend/`:

```bash
APP_ENV=production uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers
```

Put a reverse proxy in front that terminates TLS and forwards to port 8000. systemd, the container restart policy, or the PaaS process manager should restart the process on failure.

Local development remains:

```bash
uvicorn main:app --host 127.0.0.1 --port 8003
```

## 8. Health check

```bash
curl -fsS https://[API_PRODUCTION_DOMAIN]/health
# {"status":"ok"}
```

`GET /api/health` remains for the extension (model, `license_required`, layouts). Do not expose it as a public status page if you want to hide the model name; `/health` is enough for uptime probes.

## 9. SSL assumptions

REQUIRES MANUAL SETUP. This repository does not provision certificates.

Assumptions after you configure the proxy:

- Valid certificate for `[API_PRODUCTION_DOMAIN]`
- HTTP → HTTPS redirect
- TLS 1.2+
- Application `APP_ENV=production` adds `Strict-Transport-Security` on API responses

The website host needs its own certificate for `[WEB_PRODUCTION_DOMAIN]`.

## 10. DNS

REQUIRES MANUAL SETUP. These records are not configured from this repository.

```text
[API_PRODUCTION_DOMAIN]   A/AAAA  →  API server or load balancer
[WEB_PRODUCTION_DOMAIN]   A/AAAA or CNAME → static site host
```

Optional: `www.[WEB_PRODUCTION_DOMAIN]` CNAME to the apex website.

## 11. Log locations

- Process stdout / stderr (systemd journal, Docker logs, or PaaS logs)
- Format: `rid=… method=… path=… status=… latency_ms=…`
- Cache: `cache=hit` / `cache=miss`
- License: `license_result=valid|invalid` or `license_cache=…`
- Rate limit: `rate_limited=1`

Logs must never contain analyzed tokens, context, license keys, or Groq/Lemon secrets. If a log sink is added later, keep that allowlist.

## 12. Restart

```bash
# systemd example
sudo systemctl restart layfix-api

# docker example
docker restart [container]
```

Restart clears in-memory classification cache, license cache, and rate-limit counters. That is expected. Users are not logged out of the extension; the extension keeps its own license TTL (`900s`) and word cache.

## 13. Backup

No database backup is required. The API does not persist analyzed text, licenses, or payments.

Back up only:

- The server `.env` / secret store (offline, encrypted)
- The git revision you deployed

Lemon Squeezy remains the system of record for purchases.

## 14. Rollback

1. Check out the previous known-good git tag or commit.
2. Reinstall requirements if they changed: `pip install -r backend/requirements.txt`
3. Restart `uvicorn` with the same production environment.
4. `curl` `/health`
5. If the extension build also changed, ship the previous `dist/` that points at the same API host.

There is no zero-downtime requirement. A short restart is acceptable.

## 15. After-deploy checks

Use synthetic tokens only (`React`, `hsjo]lj`). Do not send real private text.

- [ ] DNS resolves for `[API_PRODUCTION_DOMAIN]`
- [ ] `https://[API_PRODUCTION_DOMAIN]/health` returns `{"status":"ok"}`
- [ ] Certificate is valid
- [ ] HTTP redirects to HTTPS
- [ ] `POST /api/analyze-word` with a valid synthetic body returns `VALID` or `LAYOUT_MISMATCH`
- [ ] Oversized / extra fields return `422 {"detail":"invalid_request"}` and do not echo the token
- [ ] Rapid requests eventually return `429 {"detail":"rate_limited"}`
- [ ] Groq outage / bad key returns `502 {"detail":"groq_failed"}` and the extension does not rewrite
- [ ] License activate: valid / invalid / expired / missing behave as documented
- [ ] A cached valid license does not call Lemon Squeezy again within `LICENSE_CACHE_TTL`
- [ ] Browser origin not in `CORS_ORIGINS` is rejected
- [ ] Chrome extension built with `VITE_API_BASE_URL=https://[API_PRODUCTION_DOMAIN]` can call the API
- [ ] Manual converter still works with the API stopped
- [ ] Free/trial logic still works locally

## 16. Alerts

REQUIRES MANUAL SETUP. Point an uptime check at `GET /health`.

Useful later (not shipped as code):

- API down
- Elevated 5xx
- Repeated `groq_failed`
- Repeated `license_upstream`

Do not alert on individual `UNCERTAIN` classifications.

## 17. Environments

Use separate Groq and Lemon keys for development and production. `DEV_SKIP_LICENSE=true` is local only. Never point a development server at production secrets unless you are deliberately debugging payments.

## 18. What this document does not do

It does not claim DNS, TLS, domains, Lemon products, or hosting accounts are already configured. Those steps remain manual.
