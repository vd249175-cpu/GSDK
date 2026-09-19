"""Analysis face: portable facts and analysis client (compute stays in Rust)."""

from __future__ import annotations

from typing import Any


ANALYSIS_OPS = frozenset({
    "index", "facts", "validate", "entity", "expand", "path",
    "select", "view", "health", "reach", "centrality",
    "communities", "granularCommunities", "compareCommunities",
})


def portable_snapshot(node_id: str, entities: list[dict[str, Any]],
                      edges: list[dict[str, Any]]) -> dict[str, Any]:
    """Build one Node's portable fact object; validation happens in Rust on admit."""
    return {"version": 1, "nodeId": node_id, "entities": entities, "edges": edges}


async def analyze(client: Any, request: dict[str, Any]) -> Any:
    """Passthrough to the daemon's authoritative Rust compute."""
    if request.get("op") not in ANALYSIS_OPS:
        raise ValueError(f"Unknown analysis op: {request.get('op')!r}")
    return await client.analyze(request)
