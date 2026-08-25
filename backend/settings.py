from __future__ import annotations

import os
import re

from dotenv import load_dotenv

load_dotenv()

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
if APP_ENV not in {"development", "production"}:
    APP_ENV = "development"

DEBUG_RAW = os.getenv("DEBUG", "false").strip().lower() in {"1", "true", "yes"}
DEBUG = False if APP_ENV == "production" else DEBUG_RAW

DEV_SKIP_LICENSE = os.getenv("DEV_SKIP_LICENSE", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
LEMON_SQUEEZY_API_KEY = os.getenv("LEMON_SQUEEZY_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "allam-2-7b")
CLASSIFIER_VERSION = os.getenv("CLASSIFIER_VERSION", "v1").strip() or "v1"

# Chrome and Chromium Edge both use chrome-extension:// plus a 32-character ID.
CHROMIUM_EXTENSION_ORIGIN = r"^chrome-extension://[a-z]{32}$"
CHROME_EXTENSION_ORIGIN = CHROMIUM_EXTENSION_ORIGIN
MAX_CANDIDATE_LAYOUTS = 16
MAX_LAYOUT_ID_LEN = 32
MAX_BODY_BYTES = 8192
MAX_GROQ_RESPONSE_CHARS = 400
GROQ_TIMEOUT_SECONDS = float(os.getenv("GROQ_TIMEOUT_SECONDS", "5"))
GROQ_MAX_RETRIES = 0
TRUST_PROXY = os.getenv("TRUST_PROXY", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}

_SAFE_ERROR = re.compile(r"^[a-z0-9_]{1,40}$")


def _int_env(*names: str, default: str) -> int:
    for name in names:
        raw = os.getenv(name)
        if raw is not None and raw.strip() != "":
            return int(raw)
    return int(default)


LICENSE_TTL_SECONDS = _int_env(
    "LICENSE_CACHE_TTL",
    "LICENSE_TTL_SECONDS",
    default="900",
)
INVALID_LICENSE_TTL_SECONDS = _int_env("INVALID_LICENSE_TTL_SECONDS", default="90")
WORD_TTL_SECONDS = _int_env(
    "WORD_TTL_SECONDS",
    "CLASSIFICATION_CACHE_TTL",
    default="86400",
)
RATE_LIMIT_WINDOW_SECONDS = _int_env("RATE_LIMIT_WINDOW_SECONDS", default="60")
RATE_LIMIT_ANALYZE_PER_MINUTE = _int_env(
    "RATE_LIMIT_ANALYZE_PER_MINUTE",
    default="120",
)
RATE_LIMIT_LICENSE_PER_MINUTE = _int_env(
    "RATE_LIMIT_LICENSE_PER_MINUTE",
    default="20",
)


def is_production() -> bool:
    return APP_ENV == "production"


def resolve_cors_origins(
    raw: str,
    dev_skip: bool,
    app_env: str = APP_ENV,
) -> list[str]:
    value = raw.strip()
    if value == "*":
        if app_env == "production":
            raise ValueError("CORS_ORIGINS=* is not allowed when APP_ENV=production")
        return ["*"]
    if value:
        return [item.strip() for item in value.split(",") if item.strip()]
    if dev_skip:
        return [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:8003",
            "http://localhost:8003",
        ]
    return []


def chrome_extension_origin_regex(raw_ids: str) -> str:
    ids = [item.strip() for item in raw_ids.split(",") if item.strip()]
    if not ids:
        return CHROMIUM_EXTENSION_ORIGIN
    for ext_id in ids:
        if not re.fullmatch(r"[a-z]{32}", ext_id):
            raise ValueError(
                "EXTENSION_IDS entries must be 32-character Chromium IDs (Chrome or Edge)"
            )
    joined = "|".join(ids)
    return rf"^chrome-extension://({joined})$"


def license_enforcement_mode(dev_skip: bool, lemon_key: str) -> str:
    if dev_skip:
        return "dev"
    if not lemon_key:
        return "unconfigured"
    return "required"


def assert_production_safe(
    app_env: str = APP_ENV,
    dev_skip: bool = DEV_SKIP_LICENSE,
    lemon_key: str = LEMON_SQUEEZY_API_KEY,
    cors_raw: str | None = None,
) -> None:
    if app_env != "production":
        return
    if dev_skip:
        raise RuntimeError("DEV_SKIP_LICENSE cannot be enabled in production")
    if not lemon_key:
        raise RuntimeError("LEMON_SQUEEZY_API_KEY is required in production")
    if (cors_raw if cors_raw is not None else os.getenv("CORS_ORIGINS", "")).strip() == "*":
        raise RuntimeError("CORS_ORIGINS=* is not allowed in production")


def public_error_detail(detail: object) -> str:
    if isinstance(detail, str) and _SAFE_ERROR.fullmatch(detail):
        return detail
    return "error"


def require_groq_api_key() -> str:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is missing. Add it to backend/.env")
    return api_key


CORS_ALLOW_ORIGINS = resolve_cors_origins(os.getenv("CORS_ORIGINS", ""), DEV_SKIP_LICENSE)
EXTENSION_ORIGIN_REGEX = chrome_extension_origin_regex(os.getenv("EXTENSION_IDS", ""))
LICENSE_MODE = license_enforcement_mode(DEV_SKIP_LICENSE, LEMON_SQUEEZY_API_KEY)
