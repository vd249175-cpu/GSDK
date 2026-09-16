"""Plugin face: manifest parsing and package validation shared with JS."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass


_PLUGIN_ID = re.compile(r"^[a-z0-9][a-z0-9.-]*$")
_SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
_TRAVERSAL = re.compile(r"(?:^|[\\/])\.\.(?:[\\/]|$)")


@dataclass(frozen=True)
class PluginContributes:
    backend: str | None = None
    elements: tuple[str, ...] = ()
    workspaces: tuple[str, ...] = ()


@dataclass(frozen=True)
class StudioPluginManifest:
    id: str
    name: str
    version: str
    api_version: int = 1
    contributes: PluginContributes = PluginContributes()


def _id_list(value: object, field: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or any(not isinstance(i, str) or not _PLUGIN_ID.match(i) for i in value):
        raise ValueError(f"Plugin {field} must be a legal ID array")
    if len(set(value)) != len(value):
        raise ValueError(f"Plugin {field} has duplicate IDs")
    return tuple(value)


def _relative_entry(value: object, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"Plugin {field} must be a relative path inside the package")
    normalized = value.replace("\\", "/")
    if normalized.startswith("/") or _TRAVERSAL.search(normalized):
        raise ValueError(f"Plugin {field} must be a relative path inside the package")
    return normalized


def parse_studio_plugin_manifest(text_or_value: str | dict) -> StudioPluginManifest:
    raw = json.loads(text_or_value) if isinstance(text_or_value, str) else text_or_value
    if not isinstance(raw, dict):
        raise ValueError("graphvideo.plugin.json must be an object")
    if raw.get("apiVersion") != 1:
        raise ValueError("Plugin apiVersion must be 1")
    plugin_id = raw.get("id")
    if not isinstance(plugin_id, str) or not _PLUGIN_ID.match(plugin_id):
        raise ValueError("Plugin id may only contain lowercase letters, digits, dots and dashes")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Plugin name must not be empty")
    version = raw.get("version")
    if not isinstance(version, str) or not _SEMVER.match(version):
        raise ValueError("Plugin version must be SemVer")
    contributes = raw.get("contributes") or {}
    if not isinstance(contributes, dict):
        raise ValueError("Plugin contributes must be an object")
    return StudioPluginManifest(
        id=plugin_id, name=name.strip(), version=version, api_version=1,
        contributes=PluginContributes(
            backend=_relative_entry(contributes.get("backend"), "contributes.backend"),
            elements=_id_list(contributes.get("elements"), "contributes.elements"),
            workspaces=_id_list(contributes.get("workspaces"), "contributes.workspaces"),
        ),
    )


def define_studio_plugin_manifest(manifest: str | dict) -> StudioPluginManifest:
    return parse_studio_plugin_manifest(manifest)
