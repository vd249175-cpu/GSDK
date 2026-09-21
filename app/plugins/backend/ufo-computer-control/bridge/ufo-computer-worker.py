#!/usr/bin/env python3
"""Persistent Microsoft UFO UIA worker for GraphFramework EffectAdapters.

The process owns transient UIA wrapper objects. Only portable JSON receipts and
observations cross the boundary; Graph State never contains Python objects.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config.config_loader import get_ufo_config
from ufo.automator.puppeteer import AppPuppeteer
from ufo.automator.ui_control import ui_tree
from ufo.automator.ui_control.inspector import ControlInspectorFacade
from ufo.automator.ui_control.screenshot import PhotographerFacade


PROTOCOL_STDOUT = sys.stdout
MUTATING_UI_COMMANDS = {
    "click_input",
    "click_on_coordinates",
    "drag_on_coordinates",
    "set_edit_text",
    "keyboard_input",
    "wheel_mouse_input",
    "click",
    "double_click",
    "keypress",
    "move",
    "scroll",
    "type",
}
WINDOW_COMMANDS = {
    "focus_window",
    "maximize_window",
    "minimize_window",
    "restore_window",
    "close_window",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_name(value: Any) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "observation")).strip("-")
    return (normalized or "observation")[:100]


def _rect(control: Any) -> list[int] | None:
    try:
        rectangle = control.rectangle()
        return [rectangle.left, rectangle.top, rectangle.right, rectangle.bottom]
    except Exception:
        return None


def _bool(control: Any, method: str) -> bool | None:
    try:
        return bool(getattr(control, method)())
    except Exception:
        return None


class UfoComputer:
    def __init__(self, screenshots_directory: Path) -> None:
        self.inspector = ControlInspectorFacade("uia")
        self.photographer = PhotographerFacade()
        self.control_types = list(get_ufo_config().system.control_list)
        self.screenshots_directory = screenshots_directory.resolve()
        self.screenshots_directory.mkdir(parents=True, exist_ok=True)
        self.windows: dict[str, Any] = {}
        self.controls: dict[str, Any] = {}
        self.selected_window: Any | None = None
        self.puppeteer: AppPuppeteer | None = None

    def _window_info(self, key: str, window: Any) -> dict[str, Any]:
        try:
            handle = int(window.handle)
        except Exception:
            handle = None
        try:
            process_id = int(window.process_id())
        except Exception:
            process_id = None
        try:
            name = window.element_info.name or window.window_text()
        except Exception:
            name = ""
        try:
            title = window.window_text()
        except Exception:
            title = name
        try:
            control_type = window.element_info.control_type
        except Exception:
            control_type = None
        return {
            "id": key,
            "name": name,
            "title": title,
            "type": control_type,
            "handle": handle,
            "processId": process_id,
            "processName": self.inspector.get_application_root_name(window),
            "rect": _rect(window),
            "active": _bool(window, "is_active"),
            "minimized": _bool(window, "is_minimized"),
            "maximized": _bool(window, "is_maximized"),
            "visible": _bool(window, "is_visible"),
        }

    def refresh_windows(self) -> list[dict[str, Any]]:
        self.windows = self.inspector.get_desktop_app_dict(remove_empty=True)
        return [self._window_info(key, window) for key, window in self.windows.items()]

    def _resolve_window(self, selector: dict[str, Any] | None, allow_selected: bool = True) -> Any:
        windows = self.refresh_windows()
        selector = selector or {}
        target = None
        requested_id = str(selector.get("id", "")).strip()
        requested_handle = selector.get("handle")
        requested_name = str(selector.get("name", "")).strip()
        requested_title = str(selector.get("titleContains", "")).strip().casefold()

        if requested_handle is not None:
            for key, window in self.windows.items():
                if self._window_info(key, window).get("handle") == int(requested_handle):
                    target = window
                    break
        elif requested_id:
            target = self.windows.get(requested_id)
        elif requested_name:
            matches = [
                window for key, window in self.windows.items()
                if self._window_info(key, window).get("name") == requested_name
            ]
            if len(matches) == 1:
                target = matches[0]
            elif len(matches) > 1:
                raise ValueError(f"Window name is ambiguous: {requested_name}")
        elif requested_title:
            matches = [
                window for key, window in self.windows.items()
                if requested_title in str(self._window_info(key, window).get("title", "")).casefold()
            ]
            if len(matches) == 1:
                target = matches[0]
            elif len(matches) > 1:
                raise ValueError(f"Window title selector is ambiguous: {selector.get('titleContains')}")
        elif allow_selected and self.selected_window is not None:
            selected_handle = self._window_info("selected", self.selected_window).get("handle")
            target = next(
                (
                    window for key, window in self.windows.items()
                    if self._window_info(key, window).get("handle") == selected_handle
                ),
                None,
            )

        if target is None:
            available = [{"id": item["id"], "name": item["name"], "handle": item["handle"]} for item in windows]
            raise ValueError(f"Target window was not found. Available windows: {available}")

        if requested_name:
            actual = self._window_info("selected", target).get("name")
            if actual != requested_name:
                raise ValueError(f"Window id/name mismatch: expected {requested_name!r}, got {actual!r}")
        return target

    def _select_window(self, selector: dict[str, Any] | None, focus: bool) -> dict[str, Any]:
        window = self._resolve_window(selector, allow_selected=True)
        if focus:
            window.set_focus()
        self.selected_window = window
        process_name = self.inspector.get_application_root_name(window)
        self.puppeteer = AppPuppeteer(window.window_text(), process_name)
        self.controls = {}
        return self._window_info("selected", window)

    def _control_info(self, key: str, control: Any) -> dict[str, Any]:
        try:
            element = control.element_info
            name = element.name
            control_type = element.control_type
            automation_id = element.automation_id
            class_name = element.class_name
        except Exception:
            name = ""
            control_type = None
            automation_id = None
            class_name = None
        return {
            "id": key,
            "name": name,
            "type": control_type,
            "automationId": automation_id,
            "className": class_name,
            "rect": _rect(control),
            "enabled": _bool(control, "is_enabled"),
            "visible": _bool(control, "is_visible"),
        }

    def refresh_controls(self, window: Any, limit: int = 500) -> list[dict[str, Any]]:
        found = self.inspector.find_control_elements_in_descendants(
            window,
            control_type_list=self.control_types,
            class_name_list=[],
            is_visible=True,
            is_enabled=True,
        )
        self.controls = {str(index + 1): control for index, control in enumerate(found[: max(1, min(limit, 1000))])}
        return [self._control_info(key, control) for key, control in self.controls.items()]

    def _resolve_control(self, action: dict[str, Any]) -> Any | None:
        control_id = str(action.get("controlId", "")).strip()
        if not control_id:
            return None
        control = self.controls.get(control_id)
        if control is None:
            raise ValueError("Control id is stale or unknown; request a fresh selected-window observation")
        expected_name = action.get("controlName")
        if expected_name is not None:
            actual_name = self._control_info(control_id, control).get("name")
            if actual_name != expected_name:
                raise ValueError(f"Control id/name mismatch: expected {expected_name!r}, got {actual_name!r}")
        return control

    def execute(self, action: dict[str, Any]) -> dict[str, Any]:
        command = str(action.get("command", "")).strip()
        if command not in MUTATING_UI_COMMANDS | WINDOW_COMMANDS:
            raise ValueError(f"Unsupported UFO UI command: {command}")

        if command in WINDOW_COMMANDS:
            window = self._resolve_window(action.get("window"), allow_selected=True)
            if command == "focus_window":
                selected = self._select_window(action.get("window"), focus=True)
            else:
                method = {
                    "maximize_window": "maximize",
                    "minimize_window": "minimize",
                    "restore_window": "restore",
                    "close_window": "close",
                }[command]
                getattr(window, method)()
                selected = self._window_info("selected", window)
                if command != "close_window":
                    self.selected_window = window
            return {"status": "executed", "command": command, "selectedWindow": selected, "executedAt": _now()}

        if self.selected_window is None or self.puppeteer is None:
            if not action.get("window"):
                raise ValueError("No UFO window is selected; execute focus_window first")
            self._select_window(action.get("window"), focus=True)

        control = self._resolve_control(action)
        self.puppeteer.receiver_manager.create_ui_control_receiver(control, self.selected_window)
        available = self.puppeteer.list_commands()
        if command not in available:
            raise ValueError(f"UFO command {command!r} is unavailable; available commands: {sorted(available)}")
        result = self.puppeteer.execute_command(command, action.get("args") or {})
        if not isinstance(result, (str, int, float, bool, list, dict, type(None))):
            result = str(result)
        return {"status": "executed", "command": command, "result": result, "executedAt": _now()}

    def _save_screenshot(self, image: Any, request_id: Any) -> str:
        path = (self.screenshots_directory / f"{_safe_name(request_id)}.png").resolve()
        if self.screenshots_directory not in path.parents:
            raise ValueError("Observation screenshot path escaped its configured directory")
        image.save(path, format="PNG")
        return str(path)

    def observe(self, request_id: Any, options: dict[str, Any]) -> dict[str, Any]:
        settle_ms = max(0, min(int(options.get("settleMs", 0)), 5000))
        if settle_ms:
            time.sleep(settle_ms / 1000)
        mode = str(options.get("mode", "desktop"))
        include_screenshot = options.get("includeScreenshot", True) is not False
        include_controls = options.get("includeControls", mode != "desktop") is not False
        include_ui_tree = options.get("includeUiTree", False) is True
        result: dict[str, Any] = {
            "mode": mode,
            "windows": [],
            "controls": [],
            "selectedWindow": None,
            "screenshotPath": None,
            "uiTree": None,
            "observedAt": _now(),
        }

        if mode == "desktop":
            result["windows"] = self.refresh_windows()
            if include_screenshot:
                image = self.photographer.capture_desktop_screen_screenshot(all_screens=True)
                result["screenshotPath"] = self._save_screenshot(image, request_id)
            return result

        if mode not in {"window", "selected-window", "after-action"}:
            raise ValueError(f"Unsupported observation mode: {mode}")
        window = self._resolve_window(options.get("window"), allow_selected=True)
        result["selectedWindow"] = self._window_info("selected", window)
        if include_controls:
            result["controls"] = self.refresh_controls(window, int(options.get("maxControls", 500)))
        if include_screenshot:
            image = self.photographer.capture_app_window_screenshot(window)
            result["screenshotPath"] = self._save_screenshot(image, request_id)
        if include_ui_tree:
            result["uiTree"] = ui_tree.UITree(window).ui_tree
        return result


def _write(message: dict[str, Any]) -> None:
    PROTOCOL_STDOUT.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    PROTOCOL_STDOUT.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--screenshots", required=True)
    args = parser.parse_args()
    computer = UfoComputer(Path(args.screenshots))
    _write({"type": "ready", "protocol": 1, "pid": os.getpid()})

    for raw_line in sys.stdin:
        request_id = None
        try:
            message = json.loads(raw_line)
            request_id = message.get("id")
            with contextlib.redirect_stdout(sys.stderr):
                if message.get("op") == "execute":
                    result = computer.execute(message.get("action") or {})
                elif message.get("op") == "observe":
                    result = computer.observe(message.get("requestId"), message.get("observation") or {})
                else:
                    raise ValueError(f"Unknown worker operation: {message.get('op')}")
            _write({"id": request_id, "ok": True, "result": result})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            _write({"id": request_id, "ok": False, "error": str(error)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
