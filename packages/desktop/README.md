---
type: Developer Guide
title: GraphFramework Desktop Host
description: Reusable Electron host modules and the repository run boundary.
status: stable
---

# GraphFramework Desktop Host

The package exposes reusable host capabilities through nine explicit
`@graphframework/desktop/*` subpaths. It has no package-root API. See the
[desktop developer guide](../../REFERENCE/packages/desktop/README.md) for the
module table, security contract, examples and verification commands.

Applications must be started from the repository root through a named run:

```bash
bash ./run.sh start runs/<name>/run.config.json
bash ./run.sh status runs/<name>/run.config.json
bash ./run.sh stop runs/<name>/run.config.json
```

Do not use `npm start`, `npm run dev` or direct Electron/plugin entrypoints to
launch an application. Package scripts for build, typecheck and tests are
headless development commands.

```bash
npm --prefix packages/desktop run typecheck
npm --prefix packages/desktop test -- packages/desktop/application.test.mjs --silent
npm --prefix packages/desktop run check:renderer-boundary
```
