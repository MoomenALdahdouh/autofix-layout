from __future__ import annotations

import hashlib
import logging
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from cachetools import TTLCache
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from groq import AsyncGroq
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from classification import (
    build_system_prompt,
    classification_cache_key,
    implemented_layouts,
    is_supported_layout,
    normalize_candidates,
    parse_classification,
)
from observability import RequestContextMiddleware, apply_security_headers, client_ip
from ratelimit import SlidingWindowLimiter
from settings import (
    CORS_ALLOW_ORIGINS,
    DEV_SKIP_LICENSE,
    EXTENSION_ORIGIN_REGEX,
    GROQ_MAX_RETRIES,
    GROQ_MODEL,
    GROQ_TIMEOUT_SECONDS,
    INVALID_LICENSE_TTL_SECONDS,
    LEMON_SQUEEZY_API_KEY,
    LICENSE_MODE,
    LICENSE_TTL_SECONDS,
    MAX_CANDIDATE_LAYOUTS,
    MAX_GROQ_RESPONSE_CHARS,
    MAX_LAYOUT_ID_LEN,
    RATE_LIMIT_ANALYZE_PER_MINUTE,
    RATE_LIMIT_LICENSE_PER_MINUTE,
    RATE_LIMIT_WINDOW_SECONDS,
    WORD_TTL_SECONDS,
    assert_production_safe,
    is_production,
    license_enforcement_mode,
    public_error_detail,
    require_groq_api_key,
    resolve_cors_origins,
)

logger = logging.getLogger("autofix")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


class AnalyzeWordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    license_key: str | None = Field(default=None, max_length=128)
    word: str = Field(..., min_length=1, max_length=64)
    context: str | None = Field(default=None, max_length=500)
    source_layout: str | None = Field(default=None, max_length=MAX_LAYOUT_ID_LEN)
    candidate_layouts: list[str] | None = None

    @field_validator("word")
    @classmethod
    def normalize_word(cls, value: str) -> str:
        word = value.strip()
        if not word:
            raise ValueError("word must not be empty")
        return word

    @field_validator("context")
    @classmethod
    def normalize_context(cls, value: str | None) -> str | None:
        if value is None:
            return None
        context = value.strip()
        return context or None

    @field_validator("license_key")
    @classmethod
    def normalize_license(cls, value: str | None) -> str | None:
        if value is None:
            return None
        key = value.strip()
        return key or None

    @field_validator("candidate_layouts")
    @classmethod
    def normalize_layout_ids(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if len(value) > MAX_CANDIDATE_LAYOUTS:
            raise ValueError("too many candidate_layouts")
        cleaned: list[str] = []
        for item in value:
            layout_id = item.strip()
            if not layout_id:
                continue
            if len(layout_id) > MAX_LAYOUT_ID_LEN:
                raise ValueError("layout id too long")
            cleaned.append(layout_id)
        return cleaned


class ClassificationResult(BaseModel):
    kind: Literal["VALID", "LAYOUT_MISMATCH"]
    target_layout: str | None = None


class AnalyzeWordResponse(BaseModel):
    result: ClassificationResult


class ActivateLicenseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    license_key: str = Field(..., min_length=1, max_length=128)


class ActivateLicenseResponse(BaseModel):
    valid: bool
    status: str
    license_required: bool


class HealthResponse(BaseModel):
    ok: bool
    model: str
    license_required: bool
    layouts: list[dict[str, str]]


class LivenessResponse(BaseModel):
    status: Literal["ok"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    assert_production_safe()
    app.state.groq = AsyncGroq(
        api_key=require_groq_api_key(),
        timeout=GROQ_TIMEOUT_SECONDS,
        max_retries=GROQ_MAX_RETRIES,
    )
    app.state.http = httpx.AsyncClient(timeout=5.0)
    app.state.word_cache = TTLCache(maxsize=10_000, ttl=WORD_TTL_SECONDS)
    app.state.valid_licenses = TTLCache(maxsize=2_000, ttl=LICENSE_TTL_SECONDS)
    app.state.invalid_licenses = TTLCache(
        maxsize=2_000,
        ttl=INVALID_LICENSE_TTL_SECONDS,
    )
    app.state.limiter = SlidingWindowLimiter()
    try:
        yield
    finally:
        await app.state.groq.close()
        await app.state.http.aclose()


app = FastAPI(
    title="AutoFix Layout API",
    lifespan=lifespan,
    docs_url=None if is_production() else "/docs",
    redoc_url=None if is_production() else "/redoc",
    openapi_url=None if is_production() else "/openapi.json",
)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_origin_regex=None if CORS_ALLOW_ORIGINS == ["*"] else EXTENSION_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Retry-After"],
)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _json_error(request: Request, status: int, detail: object, headers: dict[str, str] | None = None) -> JSONResponse:
    merged = dict(headers or {})
    merged["X-Request-ID"] = _request_id(request)
    response = JSONResponse(
        status_code=status,
        content={"detail": public_error_detail(detail)},
        headers=merged,
    )
    apply_security_headers(response)
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request_handler(request: Request, _exc: RequestValidationError) -> JSONResponse:
    return _json_error(request, 422, "invalid_request")


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return _json_error(request, exc.status_code, exc.detail, dict(exc.headers or {}))


def _license_hash(license_key: str) -> str:
    return hashlib.sha256(license_key.encode("utf-8")).hexdigest()


def _enforce_rate_limit(request: Request, bucket: str) -> None:
    limiter: SlidingWindowLimiter = request.app.state.limiter
    limit = (
        RATE_LIMIT_ANALYZE_PER_MINUTE
        if bucket == "analyze"
        else RATE_LIMIT_LICENSE_PER_MINUTE
    )
    allowed, retry_after = limiter.check(
        f"{bucket}:{client_ip(request)}",
        limit,
        RATE_LIMIT_WINDOW_SECONDS,
    )
    if allowed:
        return
    logger.info(
        "rid=%s path=%s rate_limited=1",
        _request_id(request),
        request.url.path,
    )
    raise HTTPException(
        status_code=429,
        detail="rate_limited",
        headers={"Retry-After": str(retry_after)},
    )


def _build_user_prompt(payload: AnalyzeWordRequest, candidates: list[str]) -> str:
    lines = [f"Word: {payload.word}", f"Candidates: {', '.join(candidates)}"]
    if payload.context:
        lines.append(f"Context: {payload.context}")
    return "\n".join(lines)


async def _lemon_validate(license_key: str) -> tuple[bool, str]:
    if not LEMON_SQUEEZY_API_KEY:
        return False, "lemon_squeezy_unconfigured"

    response = await app.state.http.post(
        "https://api.lemonsqueezy.com/v1/licenses/validate",
        headers={
            "Authorization": f"Bearer {LEMON_SQUEEZY_API_KEY}",
            "Accept": "application/json",
        },
        json={"license_key": license_key},
    )
    data = response.json()
    valid = bool(data.get("valid"))
    status = str((data.get("license_key") or {}).get("status") or data.get("error") or "unknown")
    if status and not status.replace("_", "").replace("-", "").isalnum():
        status = "unknown"
    return valid, status[:40]


async def _ensure_license(request: Request, license_key: str | None) -> str:
    if LICENSE_MODE == "dev":
        return "dev"
    if LICENSE_MODE == "unconfigured":
        raise HTTPException(status_code=503, detail="license_unconfigured")

    if not license_key:
        raise HTTPException(status_code=403, detail="license_invalid")

    digest = _license_hash(license_key)
    if digest in app.state.valid_licenses:
        logger.info(
            "rid=%s license_cache=valid",
            _request_id(request),
        )
        return str(app.state.valid_licenses[digest])
    if digest in app.state.invalid_licenses:
        logger.info(
            "rid=%s license_cache=invalid",
            _request_id(request),
        )
        raise HTTPException(status_code=403, detail="license_invalid")

    try:
        valid, status = await _lemon_validate(license_key)
    except Exception as exc:
        logger.error(
            "rid=%s lemon_validate_failed=%s",
            _request_id(request),
            type(exc).__name__,
        )
        raise HTTPException(status_code=502, detail="license_upstream") from exc

    if not valid:
        app.state.invalid_licenses[digest] = status
        logger.info("rid=%s license_result=invalid", _request_id(request))
        raise HTTPException(status_code=403, detail="license_invalid")

    app.state.valid_licenses[digest] = status
    logger.info("rid=%s license_result=valid", _request_id(request))
    return status


@app.get("/health", response_model=LivenessResponse)
async def liveness() -> LivenessResponse:
    return LivenessResponse(status="ok")


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        ok=True,
        model=GROQ_MODEL,
        license_required=LICENSE_MODE != "dev",
        layouts=implemented_layouts(),
    )


@app.post("/api/license/activate", response_model=ActivateLicenseResponse)
async def activate_license(
    payload: ActivateLicenseRequest,
    request: Request,
) -> ActivateLicenseResponse:
    _enforce_rate_limit(request, "license")
    if LICENSE_MODE == "dev":
        return ActivateLicenseResponse(
            valid=True,
            status="dev",
            license_required=False,
        )
    if LICENSE_MODE == "unconfigured":
        raise HTTPException(status_code=503, detail="license_unconfigured")

    digest = _license_hash(payload.license_key)
    app.state.invalid_licenses.pop(digest, None)

    try:
        valid, status = await _lemon_validate(payload.license_key)
    except Exception as exc:
        logger.error(
            "rid=%s lemon_activate_failed=%s",
            _request_id(request),
            type(exc).__name__,
        )
        raise HTTPException(status_code=502, detail="license_upstream") from exc

    if valid:
        app.state.valid_licenses[digest] = status
    else:
        app.state.invalid_licenses[digest] = status

    logger.info(
        "rid=%s license_activate=%s",
        _request_id(request),
        "valid" if valid else "invalid",
    )
    return ActivateLicenseResponse(
        valid=valid,
        status=status,
        license_required=True,
    )


@app.post("/api/analyze-word", response_model=AnalyzeWordResponse)
async def analyze_word(payload: AnalyzeWordRequest, request: Request) -> AnalyzeWordResponse:
    _enforce_rate_limit(request, "analyze")
    await _ensure_license(request, payload.license_key)

    source = (
        payload.source_layout
        if payload.source_layout and is_supported_layout(payload.source_layout)
        else "en-US-qwerty"
    )
    candidates = normalize_candidates(payload.candidate_layouts)
    cache_key = classification_cache_key(
        payload.word, source, candidates, payload.context
    )
    cached = app.state.word_cache.get(cache_key)
    if isinstance(cached, dict) and cached.get("kind") in {"VALID", "LAYOUT_MISMATCH"}:
        logger.info(
            "rid=%s cache=hit layouts=%s",
            _request_id(request),
            len(candidates),
        )
        return AnalyzeWordResponse(result=ClassificationResult.model_validate(cached))

    logger.info(
        "rid=%s cache=miss layouts=%s",
        _request_id(request),
        len(candidates),
    )
    client: AsyncGroq = app.state.groq
    try:
        completion = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": build_system_prompt(source, candidates)},
                {"role": "user", "content": _build_user_prompt(payload, candidates)},
            ],
            temperature=0,
            max_tokens=48,
            top_p=1,
            stream=False,
        )
    except Exception as exc:
        logger.error(
            "rid=%s groq_failed=%s",
            _request_id(request),
            type(exc).__name__,
        )
        raise HTTPException(status_code=502, detail="groq_failed") from exc

    message = completion.choices[0].message.content if completion.choices else None
    if not message or not str(message).strip():
        raise HTTPException(status_code=502, detail="groq_failed")
    raw = str(message)
    if len(raw) > MAX_GROQ_RESPONSE_CHARS:
        logger.error("rid=%s groq_failed=oversized", _request_id(request))
        raise HTTPException(status_code=502, detail="groq_failed")

    parsed = parse_classification(raw, candidates, source)
    if parsed.get("kind") not in {"VALID", "LAYOUT_MISMATCH"}:
        raise HTTPException(status_code=502, detail="groq_failed")
    if parsed.get("kind") == "LAYOUT_MISMATCH":
        target = parsed.get("target_layout")
        if not isinstance(target, str) or target not in candidates or not is_supported_layout(target):
            parsed = {"kind": "VALID"}

    app.state.word_cache[cache_key] = parsed
    return AnalyzeWordResponse(result=ClassificationResult.model_validate(parsed))
