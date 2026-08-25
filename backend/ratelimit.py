from __future__ import annotations

from collections import deque
import time


class SlidingWindowLimiter:
    """In-process sliding window. Enough for a single production worker."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str, limit: int, window_seconds: float) -> tuple[bool, int]:
        if limit <= 0:
            return True, 0
        now = time.monotonic()
        queue = self._hits.setdefault(key, deque())
        cutoff = now - window_seconds
        while queue and queue[0] <= cutoff:
            queue.popleft()
        if len(queue) >= limit:
            retry_after = max(1, int(window_seconds - (now - queue[0])) + 1)
            return False, retry_after
        queue.append(now)
        return True, 0

    def clear(self) -> None:
        self._hits.clear()
