"""Dispatch one requested physical operation without chaining lifecycle steps."""

from __future__ import annotations

from typing import Any, Mapping

from .contracts import AdapterRequest, AdapterResponse, PROTOCOL_VERSION, ProtocolError
from .providers import GenerationProvider


class AdapterDispatcher:
    def __init__(self, providers: Mapping[str, GenerationProvider] | None = None):
        self._providers = dict(providers or {})

    def dispatch(self, request: AdapterRequest) -> AdapterResponse:
        try:
            observation = self._execute(request)
            return AdapterResponse(
                request_id=request.request_id,
                ok=True,
                observation=observation,
            )
        except Exception as error:  # process boundary: convert to structured error DTO
            return AdapterResponse(
                request_id=request.request_id,
                ok=False,
                error={
                    "code": "adapter_operation_failed",
                    "message": str(error),
                    "operation": request.operation,
                },
            )

    def _execute(self, request: AdapterRequest) -> Mapping[str, Any]:
        if request.operation == "health":
            provider_status: dict[str, Mapping[str, Any]] = {}
            unavailable: dict[str, str] = {}
            for name, provider in self._providers.items():
                check = getattr(provider, "readiness", None)
                report = check() if callable(check) else {"ready": True}
                ready = bool(report.get("ready", False))
                provider_status[name] = dict(report)
                if not ready:
                    unavailable[name] = str(report.get("error") or "provider is unavailable")
            return {
                "worker": "graphvideo-generation-adapter",
                "protocolVersion": PROTOCOL_VERSION,
                "status": "degraded" if unavailable else "ready",
                "providers": sorted(self._providers),
                "providerStatus": provider_status,
                "unavailableProviders": unavailable,
            }
        if request.operation == "shutdown":
            return {"status": "stopping"}

        provider_name = request.payload.get("provider")
        if not isinstance(provider_name, str) or not provider_name:
            raise ProtocolError("payload.provider must be a non-empty string")
        try:
            provider = self._providers[provider_name]
        except KeyError as error:
            raise ProtocolError(f"provider is not configured: {provider_name}") from error

        if request.operation == "submit":
            provider_request = self._required_mapping(request.payload, "request")
            return provider.submit(provider_request)
        if request.operation == "poll":
            handle = self._required_mapping(request.payload, "handle")
            return provider.poll(handle)
        if request.operation == "download":
            download_request = self._required_mapping(request.payload, "download")
            return provider.download(download_request)
        raise ProtocolError(f"unsupported operation: {request.operation}")

    @staticmethod
    def _required_mapping(payload: Mapping[str, Any], field: str) -> Mapping[str, Any]:
        value = payload.get(field)
        if not isinstance(value, Mapping):
            raise ProtocolError(f"payload.{field} must be an object")
        return value
