"""Transport-only JSON Lines contracts.

These DTOs intentionally carry no GraphVideo model, readiness, DAG, or project
state semantics. Provider-specific payloads are opaque to this process boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


PROTOCOL_VERSION = 1
SUPPORTED_OPERATIONS = frozenset({"health", "submit", "poll", "download", "shutdown"})


class ProtocolError(ValueError):
    """Raised when an incoming request does not satisfy the adapter protocol."""


@dataclass(frozen=True, slots=True)
class AdapterRequest:
    request_id: str
    operation: str
    payload: Mapping[str, Any]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "AdapterRequest":
        request_id = value.get("requestId")
        operation = value.get("operation")
        payload = value.get("payload", {})
        if not isinstance(request_id, str) or not request_id.strip():
            raise ProtocolError("requestId must be a non-empty string")
        if operation not in SUPPORTED_OPERATIONS:
            raise ProtocolError(f"unsupported operation: {operation!r}")
        if not isinstance(payload, Mapping):
            raise ProtocolError("payload must be an object")
        return cls(request_id=request_id, operation=operation, payload=payload)


@dataclass(frozen=True, slots=True)
class AdapterResponse:
    request_id: str
    ok: bool
    observation: Mapping[str, Any] | None = None
    error: Mapping[str, Any] | None = None

    def to_mapping(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "requestId": self.request_id,
            "ok": self.ok,
        }
        if self.observation is not None:
            value["observation"] = dict(self.observation)
        if self.error is not None:
            value["error"] = dict(self.error)
        return value

