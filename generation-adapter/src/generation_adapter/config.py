"""Configuration loading for the Electron-managed generation worker."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
import tomllib


@dataclass(frozen=True, slots=True)
class AdapterConfig:
    max_workers: int = 8
    providers: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)


def load_config(path: Path | None) -> AdapterConfig:
    if path is None:
        return AdapterConfig()
    with path.open("rb") as config_file:
        raw = tomllib.load(config_file)
    worker = raw.get("worker", {})
    providers = raw.get("providers", {})
    max_workers = worker.get("max_workers", 8)
    if not isinstance(max_workers, int) or max_workers < 1:
        raise ValueError("worker.max_workers must be a positive integer")
    if not isinstance(providers, Mapping):
        raise ValueError("providers must be a table")
    return AdapterConfig(max_workers=max_workers, providers=providers)
