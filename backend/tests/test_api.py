from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from main import app


class _Message:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Message(content)


class _Completion:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


class FakeGroq:
    def __init__(self, content: str = '{"kind":"VALID"}') -> None:
        self.content = content
        self.calls = 0
        self.chat = self

    @property
    def completions(self) -> FakeGroq:
        return self

    async def create(self, **_kwargs):
        self.calls += 1
        return _Completion(self.content)

    async def close(self) -> None:
        return None


def _client() -> TestClient:
    return TestClient(app)


def test_liveness_health():
    with _client() as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        assert "X-Request-ID" in response.headers
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert "groq" not in response.text.lower()
        assert "key" not in response.text.lower()


def test_api_health_still_exists():
    with _client() as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert "layouts" in body


def test_analyze_word_validation_does_not_echo_input(caplog):
    token = "UNIQUE_PRIVACY_TOKEN_XYZ"
    caplog.set_level(logging.INFO)
    with _client() as client:
        response = client.post(
            "/api/analyze-word",
            json={
                "word": token * 4,
                "candidate_layouts": ["en-US-qwerty", "ar-101"],
            },
        )
        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_request"}
        assert token not in response.text
    combined = " ".join(record.getMessage() for record in caplog.records)
    assert token not in combined


def test_analyze_word_rejects_extra_fields():
    with _client() as client:
        response = client.post(
            "/api/analyze-word",
            json={
                "word": "React",
                "is_pro": True,
                "candidate_layouts": ["en-US-qwerty", "ar-101"],
            },
        )
        assert response.status_code == 422
        assert response.json() == {"detail": "invalid_request"}


def test_analyze_word_rejects_too_many_layouts():
    with _client() as client:
        response = client.post(
            "/api/analyze-word",
            json={
                "word": "React",
                "candidate_layouts": [f"layout-{index}" for index in range(20)],
            },
        )
        assert response.status_code == 422


def test_analyze_word_cache_and_rate_limit(monkeypatch, caplog):
    fake = FakeGroq('{"kind":"VALID"}')
    monkeypatch.setattr("main.RATE_LIMIT_ANALYZE_PER_MINUTE", 3)
    caplog.set_level(logging.INFO)
    with _client() as client:
        app.state.groq = fake
        app.state.limiter.clear()
        payload = {
            "word": "React",
            "candidate_layouts": ["en-US-qwerty", "ar-101"],
        }
        first = client.post("/api/analyze-word", json=payload)
        second = client.post("/api/analyze-word", json=payload)
        assert first.status_code == 200
        assert first.json() == {"result": {"kind": "VALID", "target_layout": None}}
        assert second.status_code == 200
        assert fake.calls == 1

        third = client.post("/api/analyze-word", json={"word": "API", "candidate_layouts": ["en-US-qwerty", "ar-101"]})
        blocked = client.post("/api/analyze-word", json={"word": "hello", "candidate_layouts": ["en-US-qwerty", "ar-101"]})
        assert third.status_code == 200
        assert fake.calls == 2
        assert blocked.status_code == 429
        assert blocked.json() == {"detail": "rate_limited"}
        assert "Retry-After" in blocked.headers

        logs = " ".join(record.getMessage() for record in caplog.records)
        assert "React" not in logs
        assert "hello" not in logs
        assert "cache=hit" in logs
        assert "rate_limited=1" in logs


def test_analyze_word_oversized_groq_response_fails_closed(monkeypatch):
    fake = FakeGroq('{"kind":"LAYOUT_MISMATCH","target_layout":"ar-101"}' + ("x" * 400))
    with _client() as client:
        app.state.groq = fake
        app.state.limiter.clear()
        response = client.post(
            "/api/analyze-word",
            json={"word": "hsjo]lj", "candidate_layouts": ["en-US-qwerty", "ar-101"]},
        )
        assert response.status_code == 502
        assert response.json() == {"detail": "groq_failed"}


def test_payload_too_large():
    with _client() as client:
        response = client.post(
            "/api/analyze-word",
            content=b"x" * 9000,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert response.json() == {"detail": "payload_too_large"}
