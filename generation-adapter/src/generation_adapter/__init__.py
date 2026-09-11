"""Physical submit, poll, and download adapter for GraphVideo."""

from .contracts import AdapterRequest, AdapterResponse, ProtocolError
from .dispatcher import AdapterDispatcher

__all__ = [
    "AdapterDispatcher",
    "AdapterRequest",
    "AdapterResponse",
    "ProtocolError",
]

__version__ = "0.1.0"

