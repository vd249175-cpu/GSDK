"""Audio Gateway physical request and explicit download transport."""

from __future__ import annotations

from collections.abc import Mapping
import base64
import json
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import quote, urljoin
import uuid

import httpx

from .io import atomic_write


AUDIO_ENDPOINTS = {
    "SFX": "audio/generate",
    "SPEECH": "speech/synthesize",
    "VOICE_DESIGN": "voice/design",
    "VOICE_CLONE": "voice/clone",
}


class AudioGatewayProvider:
    """Keeps synchronous gateway responses as process-owned physical handles."""

    def __init__(
        self,
        base_url: str,
        project_id: str = "default",
        project_name: str | None = None,
        timeout_seconds: float = 120,
        client: httpx.Client | None = None,
    ):
        self._base_url = base_url.rstrip("/")
        self._default_project_id = project_id.strip() or "default"
        self._default_project_name = (project_name or project_id).strip() or project_id
        self._client = client or httpx.Client(timeout=timeout_seconds)
        self._results: dict[str, dict[str, Any]] = {}
        self._results_lock = Lock()

    def submit(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        task_type = request.get("taskType")
        if task_type not in AUDIO_ENDPOINTS:
            raise ValueError(f"Audio Gateway does not support taskType: {task_type!r}")
        payload = request.get("payload")
        if not isinstance(payload, Mapping):
            raise ValueError("Audio submit request.payload must be an object")
        project_id = request.get("projectId", self._default_project_id)
        project_name = request.get("projectName", self._default_project_name)
        base_url = request.get("baseUrl", self._base_url)
        if not isinstance(project_id, str) or not project_id.strip():
            raise ValueError("Audio projectId must be a non-empty string")
        if not isinstance(project_name, str) or not project_name.strip():
            project_name = project_id
        if not isinstance(base_url, str) or not base_url.startswith(("http://", "https://")):
            raise ValueError("Audio baseUrl must be an http(s) URL")
        base_url = base_url.rstrip("/")

        physical_payload = dict(payload)
        reference_path = physical_payload.pop("reference_audio_path", None)
        if reference_path is not None:
            source = Path(str(reference_path)).resolve()
            if not source.is_file():
                raise FileNotFoundError(f"Voice clone reference does not exist: {source}")
            physical_payload["reference_audio_base64"] = base64.b64encode(source.read_bytes()).decode("ascii")

        self._ensure_project(project_id, project_name, base_url)
        endpoint = self._project_url(project_id, AUDIO_ENDPOINTS[task_type], base_url)
        response = self._client.post(
            endpoint,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "MediaStudioAudioClient/1.0",
            },
            json=physical_payload,
        )
        if not response.is_success:
            raise RuntimeError(
                f"Audio Gateway request failed ({response.status_code}): {response.text[:300]}"
            )

        task_id = f"audio-{uuid.uuid4()}"
        result = self._capture_response(response, base_url)
        with self._results_lock:
            self._results[task_id] = result
        return {
            "status": "submitted",
            "handle": {
                "provider": "audio",
                "taskId": task_id,
                "resultKind": result["kind"],
            },
        }

    def poll(self, handle: Mapping[str, Any]) -> Mapping[str, Any]:
        task_id = self._task_id(handle)
        with self._results_lock:
            result = self._results.get(task_id)
        if result is None:
            return {
                "status": "failed",
                "progress": 0,
                "taskId": task_id,
                "error": "Audio result handle is no longer available",
            }
        artifact: dict[str, Any] = {
            "provider": "audio",
            "taskId": task_id,
            "kind": "audio",
            "filename": result["filename"],
        }
        if result["kind"] == "remote-url":
            artifact["url"] = result["url"]
        else:
            artifact["token"] = task_id
        return {"status": "ready", "progress": 100, "artifact": artifact}

    def download(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        artifact = request.get("artifact")
        destination = request.get("destination")
        if not isinstance(artifact, Mapping):
            raise ValueError("Audio download.artifact must be an object")
        if not isinstance(destination, str) or not destination:
            raise ValueError("Audio download.destination must be a non-empty string")
        task_id = self._task_id(artifact)
        with self._results_lock:
            result = self._results.get(task_id)
        if result is None:
            raise RuntimeError("Audio result handle is no longer available")

        if result["kind"] == "remote-url":
            response = self._client.get(
                result["url"],
                headers={"User-Agent": "MediaStudioAudioClient/1.0"},
            )
            if not response.is_success:
                raise RuntimeError(
                    f"Audio download failed ({response.status_code}): {response.text[:300]}"
                )
            content = response.content
            content_type = response.headers.get("content-type", "")
        else:
            content = result["content"]
            content_type = result["contentType"]

        bytes_written, target = atomic_write(destination, content)
        return {
            "status": "downloaded",
            "bytesWritten": bytes_written,
            "destination": str(target),
            "contentType": content_type,
        }

    def _ensure_project(self, project_id: str, project_name: str, base_url: str) -> None:
        if project_id == "default":
            return
        project_url = self._project_url(project_id, "", base_url)
        response = self._client.get(project_url)
        if response.is_success:
            return
        if response.status_code != 404:
            raise RuntimeError(
                f"Audio Gateway project lookup failed ({response.status_code}): {response.text[:300]}"
            )
        create = self._client.post(
            f"{base_url}/projects",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "GraphVideoAudioClient/1.0",
            },
            json={
                "project_id": project_id,
                "name": project_name,
                "description": f"GraphVideo 工程：{project_name}",
            },
        )
        if not create.is_success and create.status_code != 409:
            raise RuntimeError(
                f"Audio Gateway project creation failed ({create.status_code}): {create.text[:300]}"
            )

    def _capture_response(self, response: httpx.Response, base_url: str) -> dict[str, Any]:
        content_type = response.headers.get("content-type", "")
        content = response.content
        if "json" in content_type.lower() or content.lstrip().startswith(b"{"):
            try:
                body = json.loads(content.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                body = None
            if isinstance(body, Mapping):
                if body.get("status") == "error":
                    raise RuntimeError(
                        str(body.get("message") or body.get("detail") or "Audio Gateway request failed")
                    )
                audio_url = body.get("audio_url") or body.get("sample_url")
                if isinstance(audio_url, str) and audio_url:
                    url = self._absolute_media_url(audio_url, base_url)
                    return {
                        "kind": "remote-url",
                        "url": url,
                        "filename": Path(url.split("?", 1)[0]).name or "audio.wav",
                    }
        if not content:
            raise RuntimeError("Audio Gateway returned an empty response")
        return {
            "kind": "memory",
            "content": content,
            "contentType": content_type,
            "filename": "audio.wav",
        }

    def _absolute_media_url(self, value: str, base_url: str) -> str:
        if value.startswith("http://") or value.startswith("https://"):
            return value
        public_root = base_url.removesuffix("/api/v1") + "/"
        return urljoin(public_root, value.lstrip("/"))

    def _project_url(self, project_id: str, suffix: str, base_url: str | None = None) -> str:
        encoded = quote(project_id, safe="-_")
        tail = f"/{suffix.lstrip('/')}" if suffix else ""
        return f"{(base_url or self._base_url).rstrip('/')}/projects/{encoded}{tail}"

    @staticmethod
    def _task_id(value: Mapping[str, Any]) -> str:
        task_id = value.get("taskId")
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Audio handle.taskId must be a non-empty string")
        return task_id
