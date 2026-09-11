"""Physical provider interface used by the one-step dispatcher."""

from __future__ import annotations

from typing import Any, Mapping, Protocol


class GenerationProvider(Protocol):
    def submit(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        """Submit one already-assembled provider request and return a handle."""

    def poll(self, handle: Mapping[str, Any]) -> Mapping[str, Any]:
        """Query one handle exactly once and return a status observation."""

    def download(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        """Download one ready artifact to the explicit destination."""

