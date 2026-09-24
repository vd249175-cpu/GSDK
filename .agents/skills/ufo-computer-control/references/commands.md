# Command reference

All commands call `scripts/ufo-computer.mjs` and inject an Info into
`computer/request`. Result state remains on `computer/session`; options shown as
selectors come from the latest observation.

## Observation

```powershell
# Entire desktop: window inventory and all-screen screenshot
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs windows

# Current selected window: controls and screenshot
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs observe

# Inspect one window without focusing it
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs observe --window 3 --name "Calculator"

# Include UFO's UI tree (larger response)
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs observe --ui-tree
```

Selectors accept `--window <ephemeral-id> --name <exact-name>`,
`--handle <native-window-handle>`, or `--title-contains <unique-fragment>`.

## Window actions

```powershell
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs focus --handle 123456
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs maximize
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs minimize
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs restore
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs close --yes
```

Without a selector, actions use the window most recently selected by `focus`.

## UI actions

```powershell
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs click --control 7 --name "Open" --button left --double
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs coordinate-click --x 0.50 --y 0.25
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs drag --start-x 0.20 --start-y 0.50 --end-x 0.80 --end-y 0.50 --duration 1
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs set-text --control 4 --name "File name:" --text "report.docx" --clear
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs keys --keys "{TAB 2}{ENTER}"
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs scroll --control 9 --name "Document" --distance -5
```

`coordinate-click` and `drag` use fractional coordinates from 0.0 to 1.0 within
the selected application window. UFO keyboard syntax follows pywinauto, for
example `{VK_CONTROL}c`, `{TAB 2}`, `{ENTER}`, and `+{TAB}`.

## Generic UFO UI command

Use only when the dedicated commands do not cover an exposed UFO action:

```powershell
node .agents/skills/ufo-computer-control/scripts/ufo-computer.mjs raw-action `
  --command keypress --args-json '{"keys":["ENTER"]}'
```

The backend allowlist is limited to UFO UI mutation commands. Filesystem shell
commands, process launch, arbitrary Python, and UFO agent/model execution are not
available through this skill.
