import { defineClientHooks, useStateSelector, type ClientHookServices } from '../client';

interface ExampleState {
  greetingCount: number
  lastMessage: string
}

interface FakePluginEntry {
  state: unknown
  version: number
}

interface FakeApp {
  revision: number
  project: { localPath: string | null }
  plugins?: Record<string, FakePluginEntry>
}

interface FakeClientState {
  note: string
}

interface FakeAppClient {
  ping(): string
}

interface FakeShell {
  open(path: string): void
}

declare const useFakeServices: () => ClientHookServices<FakeApp, FakeClientState, FakeAppClient, FakeShell>;

const hooks = defineClientHooks(useFakeServices, {
  selectProjectId: (app) => app.project.localPath,
  readPluginStates: (app) => app.plugins,
});

type Equal<Left, Right> = (
  (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2)
    ? (<T>() => T extends Right ? 1 : 2) extends (<T>() => T extends Left ? 1 : 2)
      ? true : false
    : false
)
type Assert<Condition extends true> = Condition

type RevisionCheck = Assert<Equal<ReturnType<typeof hooks.useApplicationRevision>, number>>
type ClientCheck = Assert<Equal<ReturnType<typeof hooks.useApplicationClient>, FakeAppClient>>
type ShellCheck = Assert<Equal<ReturnType<typeof hooks.useShellClient>, FakeShell>>
const genericChecks: RevisionCheck & ClientCheck & ShellCheck = true;
void genericChecks;

// This file is included by the production tsc command. It must never move into an excluded test file.
function verifyUseNodeStateTypes() {
  const explicit = hooks.useNodeState<ExampleState, number>('example-node', (state) => state.greetingCount);
  const inferred = hooks.useNodeState('example-node', (state: ExampleState) => state.greetingCount);
  const complete = hooks.useNodeState<ExampleState>('example-node');
  type Explicit = Assert<Equal<typeof explicit, number | undefined>>
  type Inferred = Assert<Equal<typeof inferred, number | undefined>>
  type Complete = Assert<Equal<typeof complete, ExampleState | undefined>>
  const checked: Explicit & Inferred & Complete = true;
  return { explicit, inferred, complete, checked };
}

void verifyUseNodeStateTypes;

function verifySelectorTypes() {
  const store = {
    read: (): FakeApp => {
      throw new Error('type-level only');
    },
    subscribe: (): (() => void) => {
      throw new Error('type-level only');
    },
  };
  const selected = useStateSelector(store, (snapshot) => snapshot.project.localPath);
  type Selected = Assert<Equal<typeof selected, string | null>>;
  const checked: Selected = true;
  return { selected, checked };
}

void verifySelectorTypes;
