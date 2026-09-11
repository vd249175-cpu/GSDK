"""Deterministic physical fixture provider for the two built-in chat draft models."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any
import uuid

from .io import atomic_write


class MockProvider:
    def __init__(self):
        self._tasks: dict[str, str] = {}

    def submit(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        kind = request.get("kind")
        if kind not in {"image", "video"}:
            raise ValueError("Mock kind must be image or video")
        task_id = f"mock-{uuid.uuid4()}"
        self._tasks[task_id] = kind
        return {"status": "submitted", "handle": {"provider": "mock", "taskId": task_id}}

    def poll(self, handle: Mapping[str, Any]) -> Mapping[str, Any]:
        task_id = str(handle.get("taskId") or "")
        kind = self._tasks.get(task_id)
        if not kind:
            return {"status": "failed", "progress": 0, "error": "Mock task not found"}
        extension = "png" if kind == "image" else "mp4"
        return {"status": "ready", "progress": 100, "artifact": {"provider": "mock", "taskId": task_id, "kind": kind, "filename": f"{task_id}.{extension}", "token": task_id}}

    def download(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        artifact = request.get("artifact")
        destination = request.get("destination")
        if not isinstance(artifact, Mapping) or not isinstance(destination, str):
            raise ValueError("Mock download requires artifact and destination")
        task_id = str(artifact.get("taskId") or "")
        kind = self._tasks.get(task_id)
        if not kind:
            raise RuntimeError("Mock task not found")
        content = b"MOCK_IMAGE" if kind == "image" else b"MOCK_VIDEO"
        bytes_written, target = atomic_write(destination, content)
        return {"status": "downloaded", "bytesWritten": bytes_written, "destination": str(target), "contentType": "image/png" if kind == "image" else "video/mp4"}
