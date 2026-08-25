from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from settings import MAX_BODY_BYTES, TRUST_PROXY, is_production, public_error_detail

logger = logging.getLogger("autofix")


def new_request_id() -> str:
    return str(uuid.uuid4())


def client_ip(request: Request, trust_proxy: bool = TRUST_PROXY) -> str:
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def apply_security_headers(response: Response) -> None:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
    )
    if is_production():
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = new_request_id()
        request.state.request_id = request_id

        if request.method in {"POST", "PUT", "PATCH"}:
            length = request.headers.get("content-length")
            if length:
                try:
                    size = int(length)
                except ValueError:
                    return _safe_error(request_id, 400, "invalid_request")
                if size > MAX_BODY_BYTES:
                    return _safe_error(request_id, 413, "payload_too_large")

        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.error(
                "rid=%s method=%s path=%s unhandled=%s",
                request_id,
                request.method,
                request.url.path,
                "internal_error",
            )
            return _safe_error(request_id, 500, "internal_error")

        latency_ms = int((time.perf_counter() - start) * 1000)
        response.headers["X-Request-ID"] = request_id
        apply_security_headers(response)
        logger.info(
            "rid=%s method=%s path=%s status=%s latency_ms=%s",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            latency_ms,
        )
        return response


def _safe_error(request_id: str, status: int, detail: str) -> JSONResponse:
    response = JSONResponse(
        status_code=status,
        content={"detail": public_error_detail(detail)},
        headers={"X-Request-ID": request_id},
    )
    apply_security_headers(response)
    return response
