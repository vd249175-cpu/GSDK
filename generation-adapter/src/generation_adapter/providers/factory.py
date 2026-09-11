"""Explicit provider composition for the Electron-managed worker."""

from __future__ import annotations

import os
from typing import Any, Mapping

from ..config import AdapterConfig
from .audio_gateway import AudioGatewayProvider
from .base import GenerationProvider
from .comfy_cloud import ComfyCloudProvider
from .mock import MockProvider


def build_providers(config: AdapterConfig) -> Mapping[str, GenerationProvider]:
    providers: dict[str, GenerationProvider] = {}
    providers["mock"] = MockProvider()
    comfy = config.providers.get("comfy")
    if isinstance(comfy, Mapping):
        api_key_env = _string(comfy, "api_key_env", "COMFY_API_KEY")
        explicit_api_key = str(comfy.get("api_key") or "")
        api_key = (
            explicit_api_key
            or os.getenv(api_key_env, "")
            or os.getenv("COMFY_API_KEY", "")
            or os.getenv("COMFY_CLOUD_API_KEY", "")
        )
        providers["comfy"] = ComfyCloudProvider(
            base_url=_string(comfy, "base_url", "https://cloud.comfy.org"),
            api_key=api_key,
            api_mode=_string(comfy, "api_mode", "cloud"),
            use_sdk=bool(comfy.get("use_sdk", True)),
            timeout_seconds=_number(comfy, "request_timeout_seconds", 60),
        )
    audio = config.providers.get("audio")
    if isinstance(audio, Mapping):
        providers["audio"] = AudioGatewayProvider(
            base_url=_string(audio, "base_url", "http://127.0.0.1:5000/api/v1"),
            project_id=_string(audio, "project_id", "default"),
            project_name=_string(audio, "project_name", "GraphVideo"),
            timeout_seconds=_number(audio, "request_timeout_seconds", 120),
        )
    return providers


def _string(config: Mapping[str, Any], field: str, default: str) -> str:
    value = config.get(field, default)
    if not isinstance(value, str) or not value:
        raise ValueError(f"provider {field} must be a non-empty string")
    return value


def _number(config: Mapping[str, Any], field: str, default: float) -> float:
    value = config.get(field, default)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"provider {field} must be a positive number")
    return float(value)
