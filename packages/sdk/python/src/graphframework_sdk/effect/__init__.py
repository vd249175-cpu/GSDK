"""Effect face: provider loop over opaque adapter DTOs."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

__all__ = [
    "DaemonEffectAdapter",
    "DaemonEffectContext",
    "run_daemon_effect_provider",
]


@dataclass(frozen=True)
class DaemonEffectContext:
    effect_id: int
    change_id: int
    node_id: str
    generation: int


DaemonEffectAdapter = Callable[[Any, DaemonEffectContext], Awaitable[Any] | Any]


async def run_daemon_effect_provider(client: Any, adapters: Mapping[str, DaemonEffectAdapter],
                                     long_poll_ms: int = 1000,
                                     stop: asyncio.Event | None = None) -> None:
    """Claim adapters, run them, complete effects with observations or errors."""
    adapter_ids = sorted(adapters)
    if not adapter_ids:
        raise ValueError("Effect provider requires at least one adapter")
    await client.claim_effects(adapter_ids)
    try:
        while stop is None or not stop.is_set():
            effect = await client.poll_effect(long_poll_ms)
            if effect is None:
                continue
            adapter = adapters.get(effect["adapterId"])
            try:
                if adapter is None:
                    raise RuntimeError(f"No provider for claimed EffectAdapter: {effect['adapterId']!r}")
                observation = adapter(effect["request"], DaemonEffectContext(
                    effect_id=effect["effectId"], change_id=effect["changeId"],
                    node_id=effect["nodeId"], generation=effect["generation"]))
                if asyncio.iscoroutine(observation):
                    observation = await observation
                await client.complete_effect(effect["effectId"], True, observation=observation)
            except Exception as exc:  # noqa: BLE001 - failures complete the effect, never crash the loop
                message = str(exc) or type(exc).__name__
                await client.complete_effect(effect["effectId"], False, error=message)
    finally:
        try:
            await client.release_effects(adapter_ids)
        except Exception:  # noqa: BLE001 - shutdown path must not raise
            pass
