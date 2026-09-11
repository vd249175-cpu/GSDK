---
name: causal-graph-diagnostics
description: >-
  Precision instance-driven diagnostics for GraphVideo's causal graph. Use for Node/Info/change/State
  lookup, folded Node/Graph views, coupling health, community discovery, causal paths,
  frontend projection synchronization, state ownership, and topology refactoring.
---

# Causal Graph Diagnostics

## Required context

Read `DOCUMENTS/mental-model.md`, then `DOCUMENTS/debug-guide.md`. For folding, health or community work, also read `DOCUMENTS/causal-analysis.md`. Constructed instance facts and targeted tests override documentation.

The production graph has no declared edges, flows, Wrapper, observedEdges or runtime analyzer. Studio Nodes are constructed through `createStudioNodes` (consumers assemble their own plugin Nodes via backend-sdk factories); read their analysis descriptors, and derive relations from actual `ctx.send/read/write` method text plus the explicit UI boundary table `plugins/graphvideo.studio/analysis/` (`app/src/application/frontend-links.ts` is only its transitional re-export). Do not discover Nodes by scanning source directories.

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

`analysis/folds.json` is the stable manual fold definition; its leaves are constructed Node instances. `analysis/views/*.json` only records which named folds are expanded. A folded Graph is a complete Node in that view: its State, change, Info, Effect and Send routes are merged automatically with source witnesses.

Use configured views or `all-nodes` for Node inspection, causal chains, health and Node-level community discovery. `all-granular` expands change/State/Info/Effect/entry/ui and is only for fine-grained community discovery; do not use it for routine causal chains.

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
10. After adding or removing a Runtime Node, update `analysis/folds.json`; validation requires exact leaf coverage.
11. Treat every unresolved Info type as a source defect. `ctx.send` must expose a literal discriminant through a local object, a conditional of explicit objects, or the current narrowed `info`; helper calls may build payloads but must not hide the complete Info.

## Commands

```bash
npm run trace -- instance [nodeId] --json
npm run trace -- node <nodeId> --json
npm run trace -- change <nodeId>::<InfoType> --json
npm run trace -- info <InfoType>@<targetNodeId> --json
npm run trace -- state <nodeId>::<field> --json
npm run trace -- expand <address> --json
npm run trace -- path <from-address> <to-address> --json
npm run trace -- select <nodeId...> --json
npm run trace -- frontend --json
npm run trace -- views --json
npm run trace -- graph --view <viewId> --json
npm run trace -- node <currentNodeId> --view <viewId> --json
npm run trace -- chain <fromNode> <toNode> --view <viewId> --json
npm run trace -- reach <nodeId> --view <viewId> --json
npm run trace -- health --view <viewId|all-nodes> --json
npm run trace -- centrality --view <viewId|all-nodes> --json
npm run trace -- cluster --view <viewId|all-nodes> --json
npm run trace -- cluster --view all-nodes --compare <savedViewId> --json
npm run trace -- cluster --view all-granular --json
npm run trace -- validate --json
npm run report:architecture
```

`unresolved-info-type` is always an error. Never convert an opaque expression, helper name, or variable name into a guessed Info entity.

Read `references/flat-causal-query.md` when implementing or changing selection, expansion, pathfinding, or frontend-link validation.

## Validation

```bash
npx vitest run <target-test> --silent
npx tsc --noEmit
npm run trace -- validate --json
```

Do not start the desktop app or use browser/computer automation for physical UI validation; leave that to the user.
