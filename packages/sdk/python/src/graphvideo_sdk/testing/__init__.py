"""Testing face: deterministic helpers for Node and protocol tests."""

from __future__ import annotations

import asyncio
from typing import Any

from graphvideo_sdk.node import DaemonNodeChangeContext


class FakeDaemonClient:
    """In-memory stand-in with the same poll/commit shape as the daemon."""

    def __init__(self, changes: list[dict[str, Any]] | None = None):
        self.claimed: list[str] = []
        self.commits: list[dict[str, Any]] = []
        self._changes = list(changes or [])
        self._effects: dict[int, Any] = {}

    async def claim(self, node_ids: list[str]) -> dict[str, Any]:
        self.claimed = list(node_ids)
        return {"nodeIds": node_ids}

    async def release(self, node_ids: list[str]) -> dict[str, Any]:
        return {"nodeIds": node_ids}

    async def poll(self, wait_ms: int = 0) -> Any:
        return self._changes.pop(0) if self._changes else None

    async def commit(self, change_id: int, operations: list[dict[str, Any]],
                     error: str | None = None) -> dict[str, Any]:
        self.commits.append({"changeId": change_id, "operations": operations, "error": error})
        return {"settled": True}

    async def claim_effects(self, adapter_ids: list[str]) -> dict[str, Any]:
        return {"adapterIds": adapter_ids}

    async def release_effects(self, adapter_ids: list[str]) -> dict[str, Any]:
        return {"adapterIds": adapter_ids}

def local_change_context(state: dict[str, Any]) -> DaemonNodeChangeContext:
    return DaemonNodeChangeContext(state, FakeDaemonClient(), 0)


async def wait_for(predicate: Any, timeout_s: float = 5.0) -> None:
    async def _wait() -> None:
        while not predicate():
            await asyncio.sleep(0.005)
    await asyncio.wait_for(_wait(), timeout_s)
