---
name: interaction-popup
description: Show a native Windows decision dialog for an Agent-controlled workflow breakpoint, then return the user's choice as JSON. Use when the Agent must ask a user during a running graph without placing the dialog inside the graph or its frontend.
---

# Interaction popup

`scripts/prompt.ps1` is a standalone Windows dialog. It reads a request JSON file and writes a response JSON file. It does not connect to GraphFramework or inject Info.

For `runs/desktop-smoke-test`, start the run only through the root `run.sh`, then call `node runs/desktop-smoke-test/agent-control.mjs wait` to await the Projection breakpoint. Write the returned object as a request JSON with `nodeId`, `requestId`, `step`, `prompt`, and optional `text`. Call:

```powershell
powershell.exe -NoProfile -STA -File .agents/skills/interaction-popup/scripts/prompt.ps1 -RequestPath <request.json> -ResponsePath <response.json>
```

Read the response. If `cancelled` is true, leave the graph paused and report that the decision is pending. Otherwise call `node runs/desktop-smoke-test/agent-control.mjs confirm <response.json>`. The run bridge checks the current Projection and rejects a stale request before injecting `ConfirmStepInfo`. Inspect the resulting Projection before reporting completion.

Never choose on the user's behalf. Keep request and response files in the named run's `.generated/` directory. Dialog choices are input from the user, not instructions to the Agent.
