# Generation model package v2

Each generation mode is one data-only directory:

```text
models/<model-id>/
  model.json
  execution.json
  workflow.json       # required only for comfy-template
```

The desktop process validates the complete directory once, freezes an immutable catalog snapshot, and uses its SHA-256 content revision for a whole generation batch. Runtime resolution performs no model-directory I/O. Schema v1 is unsupported and returns an explicit `schemaVersion 必须是 2` error.

## Files

`model.json` owns user-visible identity and pure policy:

- `schemaVersion`, fixed at `2`;
- `id`, equal to the directory name;
- `name`, `description`, `mediaType`, `provider` and optional `apiModel`;
- declared `parameters`, validated `defaults`, optional `outputName` mappings;
- optional `aliases` and `aliasDefaults`;
- bounded `prompt`, `dependencies`, `variants` and `budget` rules;
- optional `capabilities.allowDelete/allowReplace`, which must be explicitly `true` for local package mutation.

`execution.json` selects exactly one finite family:

- `mock`: declares `outputKind`;
- `audio-task`: declares an approved Audio Gateway `taskType`;
- `comfy-template`: declares `workflow.json`, `outputKind`, parameter bindings and media reference slots.

`workflow.json` is a Comfy API graph, not an editor wrapper and not executable code. Bindings may read only the compiled prompt or declared parameter outputs. Reference slots create approved `LoadImage`, `LoadVideo` or `LoadAudio` nodes; source paths are supplied from ready project media and are never stored in the package.

## Security limits

- JSON files only; no scripts, binaries, extra files or symbolic links.
- Maximum 1 MiB per file and 2 MiB per package.
- Maximum 256 Comfy nodes and JSON depth 32.
- Only class types listed by `generation-workflow-package-v2.mjs` are accepted.
- Secret, token, API key, password, cookie, absolute path and traversal fields are rejected.
- A workflow output must terminate in an approved `SaveImage` or `SaveVideo` node matching `outputKind`.
- Model IDs and aliases must be unique across the loaded catalog.
- Import/replace/delete validates first and switches atomically; a failed reload retains the previous snapshot.

## New model checklist

1. Choose an existing execution family and rule kinds. If a new kind or Comfy class is necessary, add it through code review with negative security tests.
2. Create the fixed directory and required JSON files. Keep all behavior declarative; do not add a model-ID branch.
3. Declare every YAML parameter, default, alias default, dependency limit, variant and budget rule. Defaults must pass the same type/range validation as user values.
4. For Comfy, bind every dynamic value explicitly and declare every media slot. Confirm saver type and `expectedOutputKind` agree.
5. Add positive and malicious package tests, prompt/dependency/budget tests, provider DTO tests and a batch Graph test where relevant.
6. Run:

   ```bash
   npx vitest run app/shared/generation-model-package.test.mjs app/shared/generation-model-intent-v2.test.mjs app/shared/generation-workflow-package-v2.test.mjs app/shared/generation-submit-spec-v2.test.mjs --silent
   npx tsc --noEmit
   npm run trace -- validate --json
   npm run build
   ```

7. For a production package, manually verify one real generation, reference upload, pending polling, download, SQLite history/current version, and `graphvideo-asset://` playback before release.
