---
name: ufo-computer-control
description: >-
  Inspect and operate native Windows desktop applications through Microsoft UFO,
  GraphFramework Info injection, and post-action Observation Info. Use for desktop
  window discovery, screenshots, UIA control inspection, clicking, typing, keyboard
  shortcuts, scrolling, dragging, and window management outside browser-only automation.
---

# UFO computer control

Use the backend-only `example.ufo-computer-control` plugin. The skill is the Agent
entry and observation window; it never calls the Python UI worker directly.

## Causal contract

Every request must follow this route:

```text
skill script
  -> agentInject(InspectComputerInfo | ControlComputerInfo)
  -> computer/request
  -> computer/execution (actions only)
  -> computer/observation (read-back only)
  -> ComputerObservedInfo
  -> computer/session (result state)
  -> skill output + screenshotPath
```

Do not replace this with direct pywinauto, UFO MCP, PowerShell mouse APIs, or
coordinates issued outside the graph. Treat `computer/observation`'s
`ComputerObservedInfo` as the authoritative post-action result.

## Start and inspect

Run from the GVSDK repository root. Use the repository's only legal lifecycle
entrypoint:

```powershell
# 主 run（统一集成环境）
& 'C:\Program Files\Git\bin\bash.exe' ./run.sh status runs/main/run.config.json
& 'C:\Program Files\Git\bin\bash.exe' ./run.sh start runs/main/run.config.json

# 或独立测试 run
& 'C:\Program Files\Git\bin\bash.exe' ./run.sh start runs/os-recorder/run.config.json
```

If this skill started the run solely for the current task, stop it through the
same `run.sh` after the task. Preserve an already-running user session.

Discover windows first:

```powershell
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs windows
```

The command prints JSON from `ComputerObservedInfo`. Open its absolute
`observation.screenshotPath` with the local image viewer when visual inspection
will improve target selection.

## Operate

Use stable handles when available; otherwise pass both the ephemeral window ID
and exact name returned by the latest observation. Focus a window before issuing
control actions, then take a fresh control observation because control IDs are
step-local.

```powershell
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs focus --window 2 --name "Untitled - Notepad"
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs observe
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs click --control 7 --name "Save" --button left
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs set-text --control 4 --name "Text editor" --text "hello"
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs keys --keys "{VK_CONTROL}s"
```

Every action automatically waits for a new `ComputerObservedInfo` and returns a
post-action screenshot and fresh controls. Inspect that result before choosing
the next action. If the worker reports a stale ID, observe again; never guess an
ID from an earlier window state.

Read [references/commands.md](references/commands.md) when using coordinate,
drag, scroll, generic UFO commands, or window management.

## Safety boundary

- A user request to control the computer authorizes only actions needed for that
  stated task. It does not authorize unrelated applications or data.
- Before the final irreversible UI action—sending, purchasing, deleting,
  publishing, accepting legal terms, or closing unsaved work—show the exact
  target and request explicit confirmation unless the user already explicitly
  requested that precise action.
- `close` has an additional `--yes` CLI gate. Do not add `--yes` after a denied
  gate without the required user authorization.
- Prefer UIA controls with matching ID and name. Use coordinates only when UFO
  exposes no suitable control and a current screenshot makes the point clear.
- Never type secrets supplied by another source into an unverified window.

## Environment recovery

The run uses `packages/ufo/.venv` with Python 3.11. If it is absent or incomplete,
create it without changing the system Python:

```powershell
uv venv packages/ufo/.venv --python 3.11
uv pip install --python packages/ufo/.venv/Scripts/python.exe -r runs/os-recorder/bridge/ufo-ui-requirements.txt
```

Then restart only through `run.sh`. Do not start the Electron host, daemon, or
Python worker directly.
