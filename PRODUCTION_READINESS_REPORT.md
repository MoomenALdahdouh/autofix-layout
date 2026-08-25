# Layfix — Production Readiness Report

Status: **not production-ready to serve traffic**. Application controls for a small launch are implemented and tested locally. Hosting, DNS, TLS, production secrets, Lemon live keys, and the published extension ID are **not** configured in this pass.

This document distinguishes:

- **IMPLEMENTED** — code exists and is covered by local tests
- **CONFIGURED** — values are set in a real environment (none of the live hosting items are)
- **REQUIRES MANUAL SETUP** — an operator must do this
- **NOT IMPLEMENTED** — intentionally absent

---

## Infrastructure assessment (audit)

### What already existed

One FastAPI process (`backend/main.py`) talking to Groq and Lemon Squeezy. Endpoints: `POST /api/analyze-word`, `POST /api/license/activate`, `GET /api/health`. In-memory `TTLCache` for classifications (86400s) and licenses (valid 900s, invalid 90s). Groq timeout 5s, `max_retries=0`, `max_tokens=48`. Word ≤ 64, context ≤ 500. Classifier rejects unknown layouts and treats `UNCERTAIN` / malformed output as `VALID`. CORS default is not `*`; Chrome extension origins use a regex. License fails closed without `DEV_SKIP_LICENSE` and a Lemon key. Trial / Free usage stay in the extension. Deterministic `mapLayout` stays local. No database, Redis, queues, Docker, or CI existed.

### What is actually required

| Need | Decision |
| --- | --- |
| HTTPS API process | Required |
| Groq | Required (ambiguous tokens only) |
| Lemon Squeezy validate | Required for Pro |
| Persistent relational DB | **Not required** |
| Redis | **Not required** |
| Queues | **Not required** |
| Kubernetes / microservices | **Not required** |
| Webhooks | **Not required** (not in the current flow) |

### What can stay local

- Keyboard mapping (`mapLayout` / `convertManualText`)
- 7-day trial and Free active-use allowance
- Extension word cache and license cache (`LICENSE_CACHE_TTL_MS = 900000`)
- Safety gate, DOM writes, manual converter, speed box

### What must run on the server

- Groq proxy + response validation
- License validation + server license cache
- Rate limits, request validation, health, access logs

### Secrets

| Secret | Where it must live |
| --- | --- |
| `GROQ_API_KEY` | Server env only |
| `LEMON_SQUEEZY_API_KEY` | Server env only |

A local `backend/.env` exists on the developer machine and is gitignored. It is **not** in git history. Treat that Groq key as exposed to this workstation and **rotate it** before any public launch. Do not commit `.env`.

`VITE_API_BASE_URL` is a public origin, not a secret.

### Data persisted

- Extension: profile, usage timestamps, license cache, word cache, history — on the user device
- Server: nothing durable. Caches are in-process memory and die on restart

### Data that must never be persisted

- Analyzed tokens and context
- Card / payment details (Lemon Squeezy holds them)
- Groq / Lemon secrets
- Arbitrary page content

---

## 1. Current architecture

```text
Browser extension
      | HTTPS
      v
Layfix API  (one FastAPI / uvicorn process)
      |
      +--> Groq          (classify only)
      +--> Lemon Squeezy (license validate, cached)
      +--> In-memory cache + in-memory rate limits
      +--> Stdout logs
```

Manual conversion never uses this path.

## 2. Production services

| Service | Status |
| --- | --- |
| FastAPI API | IMPLEMENTED |
| Groq | IMPLEMENTED (client). CONFIGURED only when a production key is installed |
| Lemon Squeezy | IMPLEMENTED (validate). CONFIGURED only with a production key |
| Static marketing site | IMPLEMENTED as files in `site/`. Hosting REQUIRES MANUAL SETUP |
| Reverse proxy / TLS | REQUIRES MANUAL SETUP |
| Uptime monitor | REQUIRES MANUAL SETUP |

## 3. Required infrastructure

Smallest launch footprint: one Python 3.11 process + TLS proxy + two DNS names + Groq + Lemon Squeezy.

No GPU, no application database, no Redis, no second AI server.

## 4. Environment variables

See `backend/.env.example` and `.env.example`. Names and placeholders only.

Production must set `APP_ENV=production`, `DEBUG=false`, `GROQ_API_KEY`, `LEMON_SQUEEZY_API_KEY`, and must not set `DEV_SKIP_LICENSE=true` or `CORS_ORIGINS=*`.

## 5. Secrets

IMPLEMENTED: loaded from the environment; omitted from the extension build (`dist/` JS/JSON scanned after `VITE_API_BASE_URL=https://api.example.invalid npm run build` — no `GROQ_API_KEY` / `LEMON_SQUEEZY_API_KEY` / `gsk_` in shipped JS).

REQUIRES MANUAL SETUP: production secret store, key rotation of the local Groq key.

## 6. API endpoints

Unchanged names:

| Method | Path | Role |
| --- | --- | --- |
| GET | `/health` | Liveness `{ "status": "ok" }` — **added** |
| GET | `/api/health` | Extension health (model, layouts, `license_required`) |
| POST | `/api/analyze-word` | Classify one token |
| POST | `/api/license/activate` | Lemon validate |

Extension messages (`CHECK_WORD`, `ACTIVATE_LICENSE`, …) are unchanged.

No `/v1` prefix.

## 7. External providers

- Groq — inference
- Lemon Squeezy — payments + license validate
- Chrome / Edge Web Store — REQUIRES MANUAL SETUP

Webhooks: **NOT IMPLEMENTED** (not part of the current license path).

## 8. Data flow

Unknown token (after local safety + cache + entitlement):

```text
content script (no fetch)
  → CHECK_WORD
  → service worker POST /api/analyze-word
  → license cache or Lemon validate
  → classification cache or Groq
  → { kind: VALID | LAYOUT_MISMATCH }
  → local mapLayout
  → DOM write only if canCommitMismatch
```

Text is discarded after the response. Failures, `429`, `502`, `403`, and `UNCERTAIN` are no-ops.

## 9. Security controls

IMPLEMENTED:

- Server-side license check; client `isPro` is ignored
- Request schema `extra=forbid`; length limits; max 16 candidate layouts
- Unknown / disallowed target layouts rejected
- Groq output size cap + enum validation
- CORS: no `*` in production; optional `EXTENSION_IDS`
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `CSP default-src 'none'`
- HSTS header when `APP_ENV=production` (TLS still manual)
- Docs / OpenAPI disabled in production
- Safe error details (`invalid_request`, `rate_limited`, `groq_failed`, …) — no stack traces
- 422 does not echo the token
- `.gitignore` covers `.env` / `.env.*` with `.env.example` exceptions

REQUIRES MANUAL SETUP: HTTPS, `EXTENSION_IDS` after Chrome publishes the ID, production CORS website origin.

Known limitation: with empty `EXTENSION_IDS`, any `chrome-extension://` 32-character origin can call the API. License + rate limits still apply.

## 10. Rate limits

IMPLEMENTED, in-process sliding window, configurable:

| Route | Default |
| --- | --- |
| `/api/analyze-word` | 120 / minute / IP |
| `/api/license/activate` | 20 / minute / IP |

Over limit: `429 {"detail":"rate_limited"}` + `Retry-After`. The extension already treats non-OK classifier responses as `CHECK_WORD_ERROR` and does not rewrite.

Per-process: multiple workers would split counters. First launch should use one worker.

## 11. Cache

IMPLEMENTED. Key:

```text
CLASSIFIER_VERSION | token.casefold | source | sorted(candidates) [| ctx:…]
```

Default version `v1`. Bump `CLASSIFIER_VERSION` after prompt or enum changes. No license in the key. Failures are not cached. Context only for tokens ≤ 3 characters.

## 12. License TTL

Preserved from the existing design (not invented):

- Server valid: `LICENSE_CACHE_TTL` / `LICENSE_TTL_SECONDS` = **900**
- Server invalid: **90** seconds
- Extension: `LICENSE_CACHE_TTL_MS` = **900000** in `src/entitlement/config.ts`

Lemon Squeezy is not called on every Space. Analyze-word uses the server cache; the extension uses its own Pro cache for entitlement. Popup status may refresh activate; that is not a keystroke path.

## 13. Logging

IMPLEMENTED. Access logs: request ID, method, path, status, latency, cache hit/miss, license category, rate-limit events. Tests assert tokens are not present in those lines.

Do not attach a log vendor that stores request bodies.

## 14. Monitoring

IMPLEMENTED: `/health`, status codes, `latency_ms` on each request.

NOT IMPLEMENTED: hosted APM, dashboards, paging.

REQUIRES MANUAL SETUP: an external ping on `/health`.

## 15. Backup strategy

No application database. **No database backup is required.**

Back up production env files and the deployed git revision only. Lemon Squeezy is the purchase record.

## 16. Deployment procedure

Documented in [`DEPLOYMENT.md`](DEPLOYMENT.md). **Not executed** in this pass (no server, no DNS, no TLS access).

CI workflow [`.github/workflows/check.yml`](.github/workflows/check.yml) is IMPLEMENTED (test / lint / build / pytest). It does **not** deploy. GitHub Actions will run only after the workflow exists on the default remote — CONFIGURED after first push.

## 17. Rollback procedure

Redeploy the previous git revision and restart the single process. See `DEPLOYMENT.md`. Not a blue/green setup.

## 18. Cost considerations

Designed for 10–10,000 users on one small instance. Groq is the only usage-based inference cost. Cache, input limits, timeout, zero retries, and rate limits bound spend.

See the cost table below. Exact list prices: **PRICE REQUIRES CURRENT PROVIDER CHECK**.

## 19. Known limitations

- In-memory cache and rate limits reset on restart and do not sync across processes
- Groq still processes token text on a cache miss (provider-side retention is outside this app)
- Empty `EXTENSION_IDS` allows any Chrome extension origin
- `/api/health` still discloses model name and layout IDs (extension needs this)
- License key is sent on classify requests (existing contract)
- Extension production sourcemaps are generated; they do not contain server secrets
- No live Groq/Lemon latency numbers (no production calls made)
- `LEMON_SQUEEZY_STORE_ID` / `PRODUCT_ID` unused
- Checkout URL in the extension is still empty

## 20. Remaining production risks

1. No public API host or certificate yet
2. Local Groq key should be rotated before launch
3. Shared-NAT rate limits may be coarse (120/min/IP)
4. Groq outage → classifier no-op (manual converter still works)
5. Lemon outage → cached Pro continues for 900s; new activations fail
6. Published extension ID not pinned
7. Dependency CVEs were not exhaustively scanned with `pip-audit` (npm production audit: 0 vulnerabilities as of this run)

---

## What was already ready

- Classify-only Groq contract and local `mapLayout`
- Fail-closed licensing and 900s / 90s TTLs
- Restricted CORS (non-wildcard default)
- Groq timeout and no retries
- Extension no-op on API errors
- Trial / Free local entitlement
- Secrets not in extension source
- `.env` not tracked by git

## What changed

- `GET /health`
- In-process rate limits + `429`
- `X-Request-ID` and security headers
- Production refusals: `CORS_ORIGINS=*`, `DEV_SKIP_LICENSE`, missing Lemon key
- Classifier version in cache keys
- Stricter request / Groq-response validation
- Safe 422/500 bodies (no token echo, no internals)
- Privacy-conscious access logs
- `backend/.env.example` and root `.env.example`
- `.gitignore` for `.env.*`
- Optional single-service `Dockerfile`
- GitHub Actions `check` workflow
- `DEPLOYMENT.md` and this report

## What was deployed

**Nothing.** No DNS, TLS, VM, or PaaS instance was created.

## What remains manual

Domains, DNS, TLS, production env, Lemon live product, Groq production key, Chrome extension ID pin, static site host, uptime check, store listing publish, Groq key rotation.

## Tests run

| Suite | Result |
| --- | --- |
| `backend` pytest | 28 passed |
| Vitest | 219 passed |
| `npm run lint` | 1 existing React refresh warning |
| Production-shaped extension build | succeeded; no server secrets in JS |

### Local latency baseline (TestClient, this machine, fake Groq)

Not a production SLA. Groq/Lemon live latency: **not measured**.

| Path | n | median | p95 |
| --- | --- | --- | --- |
| `GET /health` | 50 | 0.68 ms | 1.49 ms |
| `POST /api/analyze-word` cache hit | 50 | 0.93 ms | 1.62 ms |
| `POST /api/analyze-word` cache miss (fake Groq) | 20 | 0.93 ms | 1.26 ms |

Production miss latency will be dominated by Groq (timeout cap 5s).

---

## Production checklist

| Item | State |
| --- | --- |
| Secrets are server-side only | IMPLEMENTED in code |
| Groq key not in extension bundle | Verified on this build |
| Lemon secrets server-side only | IMPLEMENTED in code |
| `.env` not committed | Verified |
| Production `DEBUG` disabled | IMPLEMENTED when `APP_ENV=production` |
| HTTPS works | REQUIRES MANUAL SETUP |
| CORS restricted | IMPLEMENTED; origins CONFIGURED later |
| Rate limiting | IMPLEMENTED |
| Request validation | IMPLEMENTED |
| `/health` | IMPLEMENTED |
| Groq timeout | IMPLEMENTED (5s) |
| Groq failure is safe | IMPLEMENTED + existing extension no-op |
| Model response validated | IMPLEMENTED |
| Cache + versioning | IMPLEMENTED |
| License cached | IMPLEMENTED (existing TTL preserved) |
| Lemon not called every keystroke | IMPLEMENTED |
| User text not logged | IMPLEMENTED + tested |
| User text not persisted on server | IMPLEMENTED |
| Safe error responses | IMPLEMENTED |
| Dependencies reviewed | npm audit clean; Python not upgraded |
| DB backups | N/A — no database |
| Rollback procedure | Documented, not rehearsed on a host |
| Deployment documentation | IMPLEMENTED |
| Smoke tests on a live host | REQUIRES MANUAL SETUP |
| Extension ↔ production API | REQUIRES MANUAL SETUP |
| Manual converter works offline | Already true |
| Free/trial local logic | Already true |
| Pro entitlement | Code ready; live Lemon CONFIGURED later |
| Production build clean of secrets | Verified locally |

---

## Cost report

All money figures: **PRICE REQUIRES CURRENT PROVIDER CHECK**.

| Item | 100 users | 1,000 users | 10,000 users |
| --- | --- | --- | --- |
| Compute | One small instance is enough at all three sizes until traffic is measured | Same | Same, still one process until CPU or Groq concurrency says otherwise |
| Storage | Negligible (no DB) | Negligible | Negligible |
| Database | None | None | None |
| Groq | Only cache-miss tokens; bounded by rate limits | Higher, still bounded | Main variable cost |
| Lemon Squeezy | Per successful checkout | Same | Same |
| Monitoring | Optional cheap HTTP ping | Same | Same |
| Domain | One API + one web name | Same | Same |
| Email | Not required for the API | Same | Same |

Expected monthly infrastructure cost **today**: **$0**, because nothing is hosted.

Expected monthly infrastructure cost **after a minimal launch**: one small VM or PaaS web service + two domains + Groq usage + Lemon fees. Do not budget a second always-on AI server.

---

## Security review (this pass)

Fixed in code: missing rate limits, production `* ` CORS, 422 echoing input, no request IDs, no liveness probe, unversioned classifier cache, uncapped candidate lists, Groq oversize accepted into cache, docs enabled in production, `DEV_SKIP_LICENSE` allowed in production.

Not claimed fixed: live TLS, WAF, instance-bound licenses (still planned), webhook signing (no webhooks), pip CVE sweep.
