"""ComfyUI Cloud/local physical submit, one-shot poll, and download transport."""

from __future__ import annotations

from collections.abc import Mapping
import mimetypes
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.parse import quote, urlencode
import uuid

import httpx

try:
    from comfy_sdk import Comfy
except ImportError:  # surfaced only when SDK transport is selected
    Comfy = None

from .io import atomic_write


FAILED_STATUSES = frozenset(
    {"error", "non_retryable_error", "lost", "canceled", "cancelled", "expired", "failed"}
)
SUCCESS_STATUSES = frozenset({"completed", "success", "succeeded"})
OUTPUT_KINDS = (
    ("image", "images"),
    ("video", "videos"),
    ("video", "gifs"),
    ("audio", "audio"),
)


class ComfyCloudProvider:
    """Preserves the established Comfy endpoints without owning model logic."""

    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        api_mode: str = "cloud",
        use_sdk: bool | None = None,
        timeout_seconds: float = 60,
        client: httpx.Client | None = None,
    ):
        if api_mode not in {"cloud", "local"}:
            raise ValueError("Comfy api_mode must be 'cloud' or 'local'")
        self._base_url = base_url.rstrip("/")
        self._api_key = self._normalize_api_key(api_key)
        self._api_mode = api_mode
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.Client(timeout=timeout_seconds)
        self._use_sdk = bool(api_mode == "cloud" if use_sdk is None else use_sdk) and client is None
        self._sdk_client = None
        self._sdk_jobs: dict[str, dict[str, Any]] = {}
        self._sdk_lock = Lock()

    def submit(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        if self._use_sdk:
            return self._submit_sdk(request)
        prompt = request.get("prompt")
        if not isinstance(prompt, Mapping):
            raise ValueError("Comfy submit request.prompt must be an object")
        client_id = request.get("clientId")
        if not isinstance(client_id, str) or not client_id:
            client_id = f"gv-client-{uuid.uuid4()}"

        payload: dict[str, Any] = {
            "client_id": client_id,
            "prompt": dict(prompt),
        }
        if self._api_mode == "cloud":
            payload["extra_data"] = {"api_key_comfy_org": self._api_key}

        response = self._client.post(
            self._url("/api/prompt" if self._api_mode == "cloud" else "/prompt"),
            headers=self._json_headers(),
            json=payload,
        )
        body = self._response_json(response, "ComfyUI submit")
        prompt_id = body.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise RuntimeError("ComfyUI submit response is missing prompt_id")
        return {
            "status": "submitted",
            "handle": {
                "provider": "comfy",
                "taskId": prompt_id,
                "apiMode": self._api_mode,
            },
        }

    def readiness(self) -> Mapping[str, Any]:
        if not self._api_key:
            return {
                "ready": False,
                "error": "Comfy Cloud requires COMFY_API_KEY",
            }
        if self._use_sdk and Comfy is None:
            return {
                "ready": False,
                "error": "Comfy Cloud SDK transport requires the comfy-sdk package; install generation-adapter dependencies into generation-adapter/.venv",
            }
        return {
            "ready": True,
            "transport": "sdk" if self._use_sdk else "http",
        }

    def poll(self, handle: Mapping[str, Any]) -> Mapping[str, Any]:
        if self._use_sdk:
            return self._poll_sdk(handle)
        prompt_id = self._task_id(handle)
        if self._api_mode == "local":
            return self._poll_local(prompt_id)

        status_data = self._optional_json(
            self._client.get(
                self._url(f"/api/job/{quote(prompt_id, safe='')}/status"),
                headers=self._auth_headers(),
            )
        )
        status = status_data.get("status") if status_data else None
        failure = self._failure(status_data)
        if failure:
            return self._failed(prompt_id, failure, status)

        job = self._optional_json(
            self._client.get(
                self._url(f"/api/jobs/{quote(prompt_id, safe='')}"),
                headers=self._auth_headers(),
            )
        )
        failure = self._failure(job)
        if failure:
            return self._failed(prompt_id, failure, job.get("status") if job else None)
        artifact = self._first_artifact(job, prompt_id)
        job_status = job.get("status") if job else None
        if artifact or self._is_complete(job, status):
            return {
                "status": "ready",
                "progress": 100,
                "artifact": artifact or self._fallback_artifact(prompt_id),
            }

        history = self._optional_json(
            self._client.get(
                self._url(f"/api/history/{quote(prompt_id, safe='')}"),
                headers=self._auth_headers(),
            )
        )
        history_entry = self._history_entry(history, prompt_id)
        failure = self._failure(history_entry)
        if failure:
            return self._failed(prompt_id, failure, "error")
        artifact = self._first_artifact(history_entry, prompt_id)
        if artifact:
            return {"status": "ready", "progress": 100, "artifact": artifact}
        return {
            "status": "pending",
            "progress": 25,
            "remoteStatus": status or job_status or "unknown",
        }

    def download(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        artifact = request.get("artifact")
        if self._use_sdk and isinstance(artifact, Mapping) and artifact.get("token"):
            return self._download_sdk(request)
        destination = request.get("destination")
        if not isinstance(artifact, Mapping):
            raise ValueError("Comfy download.artifact must be an object")
        if not isinstance(destination, str) or not destination:
            raise ValueError("Comfy download.destination must be a non-empty string")
        url = artifact.get("url")
        if not isinstance(url, str) or not url:
            raise ValueError("Comfy artifact.url must be a non-empty string")

        response = self._client.get(url, headers=self._auth_headers())
        if not response.is_success:
            raise RuntimeError(
                f"ComfyUI download failed ({response.status_code}): {response.text[:300]}"
            )
        bytes_written, target = atomic_write(destination, response.content)
        return {
            "status": "downloaded",
            "bytesWritten": bytes_written,
            "destination": str(target),
            "contentType": response.headers.get("content-type", ""),
        }

    def _comfy_sdk(self):
        if self._sdk_client is not None:
            return self._sdk_client
        if Comfy is None:
            raise RuntimeError("Comfy Cloud SDK transport requires the comfy-sdk package")
        # Current SDK reads COMFY_BASE_URL itself. Cloud is the default surface.
        self._sdk_client = Comfy(
            api_key=self._api_key or None,
            timeout=self._timeout_seconds,
            client_info="graphvideo-generation-adapter",
        )
        return self._sdk_client

    def _submit_sdk(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        prompt = request.get("prompt")
        if not isinstance(prompt, Mapping):
            raise ValueError("Comfy submit request.prompt must be an object")
        client = self._comfy_sdk()
        workflow = client.workflows.from_json(dict(prompt))
        uploads = request.get("uploads") or []
        if not isinstance(uploads, list):
            raise ValueError("Comfy submit request.uploads must be an array")
        for upload in uploads:
            if not isinstance(upload, Mapping):
                raise ValueError("Comfy upload descriptor must be an object")
            source = Path(str(upload.get("sourcePath") or "")).resolve()
            node_id = str(upload.get("nodeId") or "")
            input_name = str(upload.get("inputName") or "")
            if not source.is_file() or not node_id or not input_name:
                raise ValueError(f"Invalid Comfy upload descriptor: {upload}")
            asset = client.assets.from_file(source)
            if hasattr(asset, "commit"):
                asset.commit()
            if hasattr(workflow, "set_input"):
                workflow.set_input(node_id, input_name, asset)
            else:
                raise RuntimeError("Installed comfy-sdk does not support workflow.set_input")
        # Constructor auth reaches Comfy Cloud itself; the per-submit key is also
        # required by Partner Nodes such as ByteDance2ReferenceNodeV2. This
        # boundary must return a handle immediately: terminal waiting belongs to
        # the graph's separate poll effect, never to the submit operation.
        if not hasattr(client, "submit"):
            raise RuntimeError("Installed comfy-sdk does not support non-blocking submit")
        expected_output_kind = str(request.get("expectedOutputKind") or "")
        if expected_output_kind not in {"image", "video"}:
            raise ValueError("Comfy SDK submit requires expectedOutputKind image or video")
        job = client.submit(workflow, api_key=self._api_key)
        task_id = str(getattr(job, "id", ""))
        if not task_id:
            raise RuntimeError("Comfy SDK submit returned a job without id")
        with self._sdk_lock:
            self._sdk_jobs[task_id] = {
                "job": job,
                "expectedOutputKind": expected_output_kind,
            }
        return {
            "status": "submitted",
            "handle": {"provider": "comfy", "taskId": task_id, "apiMode": "cloud"},
        }

    def _poll_sdk(self, handle: Mapping[str, Any]) -> Mapping[str, Any]:
        task_id = self._task_id(handle)
        with self._sdk_lock:
            entry = self._sdk_jobs.get(task_id)
        if entry is None:
            return self._failed(task_id, "Comfy SDK job handle is no longer available", "lost")
        job = entry["job"]
        if hasattr(job, "refresh"):
            job.refresh()
        status = str(getattr(job, "status", "unknown")).lower()
        if status in FAILED_STATUSES:
            return self._failed(task_id, str(getattr(job, "error", None) or status), status)
        outputs = list(getattr(job, "outputs", []) or [])
        expected_kind = entry["expectedOutputKind"]
        if status in SUCCESS_STATUSES:
            output = self._select_sdk_output(outputs, expected_kind)
            if output is None:
                return self._failed(
                    task_id,
                    f"Comfy SDK job completed without a {expected_kind} output",
                    status,
                )
            filename = str(getattr(output, "name", task_id))
            kind = self._sdk_output_kind(output) or expected_kind
            output_id = str(getattr(output, "id", ""))
            if not output_id:
                return self._failed(
                    task_id,
                    "Comfy SDK job output is missing its asset id",
                    status,
                )
            return {
                "status": "ready",
                "progress": 100,
                "artifact": {
                    "provider": "comfy",
                    "taskId": task_id,
                    "kind": kind,
                    "filename": filename,
                    "token": output_id,
                },
            }
        return {"status": "pending", "progress": 25, "remoteStatus": status}

    def _download_sdk(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        artifact = request.get("artifact")
        destination = request.get("destination")
        if not isinstance(artifact, Mapping) or not isinstance(destination, str) or not destination:
            raise ValueError("Comfy SDK download requires artifact and destination")
        task_id = self._task_id(artifact)
        with self._sdk_lock:
            entry = self._sdk_jobs.get(task_id)
        if entry is None:
            raise RuntimeError("Comfy SDK job handle is no longer available")
        job = entry["job"]
        if hasattr(job, "refresh"):
            job.refresh()
        outputs = list(getattr(job, "outputs", []) or [])
        expected_kind = entry["expectedOutputKind"]
        output = self._select_sdk_output(
            outputs,
            expected_kind,
            token=str(artifact.get("token") or ""),
        )
        if output is None:
            raise RuntimeError(
                f"Comfy SDK job is ready but has no downloadable {expected_kind} output"
            )
        target = Path(destination).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.adapter-download")
        try:
            output.to_file(temporary)
            if not temporary.is_file() or temporary.stat().st_size <= 0:
                raise RuntimeError("Comfy SDK downloaded an empty output")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return {
            "status": "downloaded",
            "bytesWritten": target.stat().st_size,
            "destination": str(target),
            "contentType": self._sdk_output_content_type(output, expected_kind),
        }

    @staticmethod
    def _sdk_output_kind(output: Any) -> str:
        content_type = str(getattr(output, "content_type", "")).lower()
        for candidate in ("image", "video", "audio"):
            if content_type.startswith(f"{candidate}/"):
                return candidate
        suffix = Path(str(getattr(output, "name", ""))).suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}:
            return "image"
        if suffix in {".mp4", ".webm", ".mov", ".mkv"}:
            return "video"
        if suffix in {".wav", ".mp3", ".flac", ".aac", ".m4a", ".ogg"}:
            return "audio"
        # Comfy Cloud currently reports some SaveVideo MP4 assets as
        # type="image" with blank content_type and size_bytes=0. The committed
        # output filename and downloaded bytes are authoritative in that case;
        # use the SDK's normalized type only when no media extension is known.
        kind = str(getattr(output, "type", "")).lower()
        if kind in {"image", "video", "audio"}:
            return kind
        return ""

    @staticmethod
    def _sdk_output_content_type(output: Any, expected_kind: str) -> str:
        content_type = str(getattr(output, "content_type", "")).strip().lower()
        if content_type:
            return content_type
        guessed, _ = mimetypes.guess_type(str(getattr(output, "name", "")))
        if guessed:
            return guessed
        return {
            "image": "image/png",
            "video": "video/mp4",
            "audio": "audio/mpeg",
        }.get(expected_kind, "application/octet-stream")

    @classmethod
    def _select_sdk_output(
        cls,
        outputs: list[Any],
        expected_kind: str,
        token: str = "",
    ) -> Any | None:
        if token:
            exact = next(
                (output for output in outputs if str(getattr(output, "id", "")) == token),
                None,
            )
            if exact is not None:
                return exact
        return next(
            (output for output in outputs if cls._sdk_output_kind(output) == expected_kind),
            None,
        )

    def _poll_local(self, prompt_id: str) -> Mapping[str, Any]:
        history = self._optional_json(
            self._client.get(
                self._url(f"/history/{quote(prompt_id, safe='')}"),
                headers=self._auth_headers(),
            )
        )
        entry = self._history_entry(history, prompt_id)
        failure = self._failure(entry)
        if failure:
            return self._failed(prompt_id, failure, "error")
        artifact = self._first_artifact(entry, prompt_id)
        completed = entry.get("status", {}).get("completed") is True if entry else False
        if artifact or completed:
            return {
                "status": "ready",
                "progress": 100,
                "artifact": artifact or self._fallback_artifact(prompt_id),
            }
        return {"status": "pending", "progress": 25, "remoteStatus": "unknown"}

    def _first_artifact(
        self,
        job: Mapping[str, Any] | None,
        prompt_id: str,
    ) -> Mapping[str, Any] | None:
        if not job:
            return None
        outputs = job.get("outputs") or job.get("output")
        if isinstance(outputs, Mapping):
            for node_output in outputs.values():
                if not isinstance(node_output, Mapping):
                    continue
                for kind, field in OUTPUT_KINDS:
                    entries = node_output.get(field)
                    if not isinstance(entries, list):
                        continue
                    for entry in entries:
                        if isinstance(entry, Mapping) and entry.get("filename"):
                            return self._artifact(kind, entry, prompt_id)
        preview = job.get("preview_output")
        if isinstance(preview, Mapping) and preview.get("filename"):
            return self._artifact("image", preview, prompt_id)
        return None

    def _artifact(
        self,
        kind: str,
        entry: Mapping[str, Any],
        prompt_id: str,
    ) -> Mapping[str, Any]:
        query = urlencode(
            {
                "filename": entry["filename"],
                "subfolder": entry.get("subfolder", ""),
                "type": entry.get("type", "output"),
            },
            quote_via=quote,
        )
        view_path = "/api/view" if self._api_mode == "cloud" else "/view"
        return {
            "provider": "comfy",
            "taskId": prompt_id,
            "kind": kind,
            "filename": entry["filename"],
            "url": self._url(f"{view_path}?{query}"),
        }

    def _fallback_artifact(self, prompt_id: str) -> Mapping[str, Any]:
        view_path = "/api/view" if self._api_mode == "cloud" else "/view"
        return {
            "provider": "comfy",
            "taskId": prompt_id,
            "kind": "unknown",
            "filename": prompt_id,
            "url": self._url(f"{view_path}?prompt_id={quote(prompt_id, safe='')}"),
        }

    @staticmethod
    def _history_entry(
        history: Mapping[str, Any] | None,
        prompt_id: str,
    ) -> Mapping[str, Any] | None:
        if not history:
            return None
        nested = history.get(prompt_id)
        return nested if isinstance(nested, Mapping) else history

    @staticmethod
    def _failure(value: Mapping[str, Any] | None) -> str | None:
        if not value:
            return None
        status = value.get("status")
        status_name = status.get("status_str") if isinstance(status, Mapping) else status
        if status_name not in FAILED_STATUSES:
            return None
        execution_error = value.get("execution_error")
        if isinstance(execution_error, Mapping):
            message = execution_error.get("exception_message")
            if message:
                return str(message)
        explicit = value.get("error") or value.get("message")
        if explicit:
            return str(explicit)
        if isinstance(status, Mapping):
            messages = status.get("messages")
            if isinstance(messages, list):
                summarized = []
                for group in messages:
                    if isinstance(group, list):
                        parts = [part for part in group if isinstance(part, str)]
                        if parts:
                            summarized.append(": ".join(parts))
                if summarized:
                    return "；".join(summarized)
        return str(status_name)

    @staticmethod
    def _is_complete(job: Mapping[str, Any] | None, status: Any) -> bool:
        if status in SUCCESS_STATUSES:
            return True
        if not job:
            return False
        job_status = job.get("status")
        outputs = job.get("outputs") or job.get("output")
        return (
            job_status in SUCCESS_STATUSES
            or bool(job.get("outputs_count"))
            or isinstance(outputs, Mapping) and bool(outputs)
        )

    @staticmethod
    def _failed(prompt_id: str, message: str, remote_status: Any) -> Mapping[str, Any]:
        return {
            "status": "failed",
            "progress": 0,
            "taskId": prompt_id,
            "remoteStatus": str(remote_status or "failed"),
            "error": message,
        }

    @staticmethod
    def _task_id(handle: Mapping[str, Any]) -> str:
        task_id = handle.get("taskId")
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Comfy handle.taskId must be a non-empty string")
        return task_id

    @staticmethod
    def _normalize_api_key(value: str) -> str:
        stripped = value.strip()
        return stripped[7:].strip() if stripped.startswith("Bearer ") else stripped

    def _auth_headers(self) -> dict[str, str]:
        if not self._api_key:
            return {}
        return {
            "X-API-Key": self._api_key,
            "Authorization": f"Bearer {self._api_key}",
        }

    def _json_headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json", **self._auth_headers()}

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    @staticmethod
    def _optional_json(response: httpx.Response) -> Mapping[str, Any] | None:
        if not response.is_success:
            return None
        try:
            value = response.json()
        except ValueError:
            return None
        return value if isinstance(value, Mapping) else None

    @staticmethod
    def _response_json(response: httpx.Response, operation: str) -> Mapping[str, Any]:
        if not response.is_success:
            raise RuntimeError(
                f"{operation} failed ({response.status_code}): {response.text[:300]}"
            )
        try:
            value = response.json()
        except ValueError as error:
            raise RuntimeError(f"{operation} returned non-JSON response") from error
        if not isinstance(value, Mapping):
            raise RuntimeError(f"{operation} returned invalid JSON object")
        return value
