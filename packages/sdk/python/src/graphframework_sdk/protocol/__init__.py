"""Protocol DTOs: JSON fields, versions and error codes shared with JS."""

from dataclasses import dataclass, field
from typing import Any


PROTOCOL_VERSION = 1
FRAME_MAX_BYTES = 1024 * 1024
FACT_ENTITY_CAP = 5000
FACT_EDGE_CAP = 20000
FACT_SNAPSHOT_MAX_BYTES = 256 * 1024
RESPONSE_MAX_BYTES = 512 * 1024


@dataclass(frozen=True)
class Info:
    type: str
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dto(self) -> dict[str, Any]:
        return {"type": self.type, **self.payload}

    @staticmethod
    def from_dto(dto: dict[str, Any]) -> "Info":
        rest = dict(dto)
        info_type = rest.pop("type")
        return Info(type=info_type, payload=rest)


class ProtocolError(Exception):
    """Daemon `ok:false` mapped to a typed error."""


@dataclass(frozen=True)
class KernelError(Exception):
    name: str
    node_id: str
