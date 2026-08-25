from ratelimit import SlidingWindowLimiter


def test_sliding_window_allows_then_blocks():
    limiter = SlidingWindowLimiter()
    assert limiter.check("analyze:127.0.0.1", 2, 60)[0] is True
    assert limiter.check("analyze:127.0.0.1", 2, 60)[0] is True
    allowed, retry_after = limiter.check("analyze:127.0.0.1", 2, 60)
    assert allowed is False
    assert retry_after >= 1


def test_sliding_window_isolates_keys():
    limiter = SlidingWindowLimiter()
    assert limiter.check("analyze:a", 1, 60)[0] is True
    assert limiter.check("analyze:b", 1, 60)[0] is True
    assert limiter.check("analyze:a", 1, 60)[0] is False
