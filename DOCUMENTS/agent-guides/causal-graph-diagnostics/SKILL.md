---
name: causal-graph-diagnostics
type: guide
description: >-
  Precision instance-driven diagnostics for GraphVideo's causal graph. Use for Node/Info/change/State
  lookup, folded Node/Graph views, coupling health, community discovery, causal paths,
  frontend projection synchronization, state ownership, and topology refactoring.
---

# Causal Graph Diagnostics

## Required context

Read `DOCUMENTS/mental-model.md`, then `DOCUMENTS/debug-guide.md`. For folding, health or community work, also read `DOCUMENTS/causal-analysis.md`. Constructed instance facts and targeted tests override documentation.

The production graph has no declared edges, flows, Wrapper or observedEdges. `NativeRuleSpace.analyze` loads read-only analysis on first request; it never schedules changes. JS Node relations come from constructed instances and actual `ctx.send/read/write` method text. Process Nodes provide versioned `PortableAnalysisSnapshot` facts through the Rust registry; inspect their evidence provenance and `confidence` rather than guessing from language-specific names. Frontend links come from the explicit UI boundary table `app/analysis/links.mjs`. Do not discover Nodes by scanning source directories. Cross-language frame and fact formats are in `DOCUMENTS/portable-node-protocol.md`.

## Canonical entities

```text
node:<nodeId>
change:<nodeId>::<InfoType>
info:<InfoType>@<targetNodeId>
state:<nodeId>::<field>
entry:<ApplicationMethod>
ui:<ApplicationState.path>
```

Canonical causal relations:

```text
entry  --INJECT--> info@Target
info   --TRIGGER-> change
change --SEND----> info@Target
change --WRITE---> state
state  --READ_BY-> change
state  --PROJECT-> ui
```

Node contains/owns relations are membership only and must not create BFS shortcuts.

## Analysis views

`FoldDefinitionFile` supplies a rooted group hierarchy whose leaves cover constructed Node instances exactly once. `foldDepth: 0` shows the root group, `1` expands one level, and deeper values continue to base Nodes. A folded Graph is a complete Node in that view: its State, change, Info, Effect and Send routes are merged with source witnesses. The current app has no saved fold hierarchy; without one, runtime analysis uses a one-level `world` group.

Use a supplied fold hierarchy or `all-nodes` for Node inspection, health and Node-level community discovery. Causal chains use the granular index regardless of fold depth; `all-granular` community discovery is only for fine-grained structure, not routine chains.

## Workflow

1. Start with the narrowest known entity.
2. Use one-hop expansion before requesting a larger cone.
3. For multiple selected Nodes, construct an induced subgraph and report boundary-in/out separately.
4. For paths, use directed BFS over canonical causal relations and show relation types at every hop.
5. For impact scope, use the current-view reachability cone and retain hop distance.
6. If no forward path exists, check the reverse direction and report the nearest reachable boundary.
7. For frontend desync, trace `entry → root Info → Owner State → ApplicationState path → consumer`.
8. Compare natural communities with a saved fold view using NMI/ARI/F1; never rewrite folds automatically.
9. After topology or projection changes, run instance validation and targeted tests.
10. After adding or removing a Runtime Node, update any supplied `FoldDefinitionFile`; validation requires exact leaf coverage.
11. Treat every unresolved Info type as a source defect. `ctx.send` must expose a literal discriminant through a local object, a conditional of explicit objects, or the current narrowed `info`; helper calls may build payloads but must not hide the complete Info.

## Commands

```bash
npm --prefix app run diagnose -- node <nodeId>
npm --prefix app run diagnose -- path <from-address> <to-address>
npm --prefix app run diagnose -- validate
node app/scripts/agent-control.mjs analyze request.json
```

The last command queries the running app through the trusted local Agent channel. Request examples: `{ "op": "view", "foldDepth": 1 }`, `{ "op": "health", "foldDepth": 1 }`, `{ "op": "path", "addresses": ["change:a::Info", "state:b::field"] }`. Other operations are listed in `DOCUMENTS/causal-analysis.md`.

`unresolved-info-type` is always an error. Never convert an opaque expression, helper name, or variable name into a guessed Info entity.

Read `references/flat-causal-query.md` when implementing or changing selection, expansion, pathfinding, or frontend-link validation.

## Validation

```bash
npx vitest run <target-test> --silent
npx tsc --noEmit
npm --prefix app run diagnose -- validate
```

Do not start the desktop app or use browser/computer automation for physical UI validation; leave that to the user.
