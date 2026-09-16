"""Agent face: inspect/analyze/inject/patch over the loopback control plane."""

from __future__ import annotations

from typing import Any


async def inspect(client: Any, after: int | None = None, limit: int | None = None) -> Any:
    return await client.agent_inspect(after, limit)


async def analyze(client: Any, request: dict[str, Any]) -> Any:
    return await client.analyze(request)


async def inject(client: Any, actor: str, reason: str, submission_id: str,
                 target_node_id: str, info: dict[str, Any]) -> Any:
    return await client.agent_inject(actor, reason, submission_id, target_node_id, info)


async def intervene_state(client: Any, actor: str, reason: str, node_id: str,
                          patch: dict[str, Any],
                          expected_generation: int, expected_version: int) -> Any:
    return await client.agent_intervene_state(
        actor, reason, node_id, patch, expected_generation, expected_version)
