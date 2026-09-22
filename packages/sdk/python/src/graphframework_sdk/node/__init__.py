"""Node face: change context, worker loop and local test helper."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

__all__ = [
    "DaemonNodeChangeContext",
    "DaemonNodeHandler",
    "Info",
    "run_daemon_node_worker",
]


Info = dict[str, Any]
DaemonNodeHandler = Callable[[Info, "DaemonNodeChangeContext"], Awaitable[None] | None]


class DaemonNodeChangeContext:
    """Local write/send batcher; one `commit` per change, like the JS twin."""

    def __init__(self, snapshot: Mapping[str, Any], client: Any, change_id: int):
        self._state = dict(snapshot)
        self._client = client
        self._change_id = change_id
        self.operations: list[dict[str, Any]] = []

    def read(self, key: str) -> Any:
        return self._state[key]

    def write(self, key: str, value: Any) -> None:
        self._state[key] = value
        self.operations.append({"op": "write", "key": key, "value": value})

    def patch_state(self, patch: Mapping[str, Any]) -> None:
        self._state.update(patch)
        self.operations.append({"op": "patchState", "patch": dict(patch)})

    def send(self, info: Info, target_node_id: str) -> None:
        self.operations.append({"op": "send", "info": info, "targetNodeId": target_node_id})

    async def effect(self, adapter_id: str, request: Any) -> Any:
        result = await self._client.request_effect(self._change_id, adapter_id, request)
        effect_id = result["effectId"]
        while True:
            outcome = await self._client.await_effect(effect_id)
            if outcome is None:
                continue
            if not outcome.get("ok"):
                raise RuntimeError(str(outcome.get("value")))
            return outcome.get("value")


async def run_daemon_node_worker(client: Any, handlers: Mapping[str, DaemonNodeHandler],
                                 long_poll_ms: int = 1000,
                                 stop: asyncio.Event | None = None) -> None:
    """Claim nodes, run handlers, commit one ordered batch per change."""
    node_ids = sorted(handlers)
    if not node_ids:
        raise ValueError("Daemon Node worker requires at least one handler")
    await client.claim(node_ids)
    try:
        while stop is None or not stop.is_set():
            polled = await client.poll(long_poll_ms)
            if polled is None:
                continue
            change = polled["change"]
            handler = handlers.get(change["nodeId"])
            ctx = DaemonNodeChangeContext(polled.get("state", {}), client, change["changeId"])
            error: str | None = None
            try:
                if handler is None:
                    raise RuntimeError(f"No handler for claimed Node: {change['nodeId']!r}")
                result = handler(change["info"], ctx)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as exc:  # noqa: BLE001 - errors become causal facts
                error = str(exc) or type(exc).__name__
            await client.commit(change["changeId"], ctx.operations, error)
    finally:
        try:
            await client.release(node_ids)
        except Exception:  # noqa: BLE001 - shutdown path must not raise
            pass
