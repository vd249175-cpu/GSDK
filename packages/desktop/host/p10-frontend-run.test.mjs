import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import { statusRun } from '../../tooling/run/src/session.mjs';
import { callRunControl } from '../../tooling/run/src/control.mjs';
import { DatabaseSync } from 'node:sqlite';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
function runDefinition(root, name, namespace = 'studio') {
  const directory = join(root, name); mkdirSync(directory);
  const definition = JSON.parse(readFileSync(join(repo, 'runs/studio/run.config.json'), 'utf8'));
  definition.name = name;
  for (const kind of ['backend', 'frontend']) definition.plugins[kind][0].path = join(repo, `app/plugins/${kind}/graphvideo.studio`);
  definition.kernel.daemonPath = join(repo, 'packages/rust/target/debug/graphvideo-kernel-daemon');
  definition.backend.host = join(repo, 'runs/studio/backend/host.mjs');
  definition.graph.instances[0].id = namespace;
  definition.frontend.instances[0].graph = namespace;
  for (const phase of ['startInfos', 'stopInfos']) for (const entry of definition.lifecycle[phase]) {
    entry.targetNodeId = entry.targetNodeId.replace('studio/', `${namespace}/`);
    if (entry.await) entry.await.nodeId = entry.await.nodeId.replace('studio/', `${namespace}/`);
  }
  definition.lifecycle.ready.nodeId = `${namespace}/node-application-lifecycle`;
  return { directory, definition };
}
function shell(op, config) {
  try { return JSON.parse(execFileSync(bash, [join(repo, 'run.sh'), op, config], { cwd: repo, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch (error) { throw new Error(`${error.message}\n${readFileSync(join(dirname(config), '.generated/logs/supervisor.log'), 'utf8')}`, { cause: error }); }
}
it('starts an actual configured Electron frontend and closes the full Studio graph through Bash', () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-p10-frontend-'));
  const directory = join(root, 'alice'); mkdirSync(directory);
  const definition = JSON.parse(readFileSync(join(repo, 'runs/studio/run.config.json'), 'utf8'));
  definition.name = 'alice';
  for (const kind of ['backend', 'frontend']) definition.plugins[kind][0].path = join(repo, `app/plugins/${kind}/graphvideo.studio`);
  definition.kernel.daemonPath = join(repo, 'packages/rust/target/debug/graphvideo-kernel-daemon');
  definition.backend.host = join(repo, 'runs/studio/backend/host.mjs');
  definition.scenarios = [{ name: 'actual-ui-ready', inputs: [], assertions: [{ nodeId: 'studio/node-application-lifecycle', state: { phase: 'Ready' } }] }];
  const config = join(directory, 'run.config.json'); writeFileSync(config, JSON.stringify(definition));
  try {
    let output;
    try { output = execFileSync(bash, [join(repo, 'run.sh'), 'start', config], { cwd: repo, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { throw new Error(`${error.message}\n${readFileSync(join(directory, '.generated/logs/supervisor.log'), 'utf8')}`, { cause: error }); }
    expect(JSON.parse(output)).toMatchObject({ started: true, stopped: true, report: { passed: 1, failed: 0 } });
    const snapshot = statusRun(config); expect(snapshot.active).toBe(false);
    expect(readFileSync(join(directory, '.generated/runtime/frontend-studio-ui.stdout'), 'utf8')).not.toContain('GraphVideo Renderer 渲染失败');
    const frontend = JSON.parse(readFileSync(join(directory, '.generated/runtime/frontend-studio-ui.json'), 'utf8'));
    expect(frontend.pid).toBeGreaterThan(0); expect(frontend.runId).toBe(snapshot.runId);
  } finally {
    if (!statusRun(config).active) rmSync(root, { recursive: true, force: true });
  }
}, 150000);

it('keeps two real frontend/backend/kernel runs independent and saves the edited project on stop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gv-p10-parallel-'));
  const configurations = [];
  try {
    for (const [name, namespace] of [['alice', 'agent-a'], ['task-42', 'agent-b']]) {
      const { directory, definition } = runDefinition(root, name, namespace);
      const config = join(directory, 'run.config.json'); writeFileSync(config, JSON.stringify(definition)); configurations.push(config);
      expect(shell('start', config).started).toBe(true);
    }
    const [alice, other] = configurations.map(statusRun);
    expect(alice.kernel.address).not.toBe(other.kernel.address);
    expect(alice.pid).not.toBe(other.pid);
    const runtime = join(dirname(configurations[0]), '.generated/runtime');
    const project = join(dirname(configurations[0]), '.generated/data/project'); mkdirSync(project, { recursive: true });
    await callRunControl(runtime, 'effect', { adapter: 'project', request: { type: 'OPEN', path: project } }, 30000, 'frontend-studio-ui.json');
    const markdown = '<project-structure>\n# 独立运行草稿\n</project-structure>\n';
    await callRunControl(runtime, 'inject-renderer', { frontendId: 'studio-ui', targetNodeId: 'agent-a/node-md-source', info: { type: 'UserMarkdownEditedInfo', markdown } });
    expect(shell('stop', configurations[0]).stopped).toBe(true);
    const database = new DatabaseSync(join(project, '.graphvideo/nodes.sqlite'));
    try { expect(database.prepare('SELECT markdown FROM project_documents ORDER BY updated_at DESC LIMIT 1').get().markdown).toBe(markdown); }
    finally { database.close(); }
    expect(shell('status', configurations[1])).toMatchObject({ active: true, verified: true });
    const otherProjection = await callRunControl(join(dirname(configurations[1]), '.generated/runtime'), 'projection');
    expect(otherProjection.nodes['agent-b/node-application-lifecycle'].state).toMatchObject({ phase: 'Ready', hasProject: false });
    expect(shell('stop', configurations[1]).stopped).toBe(true);
  } finally {
    for (const config of configurations) if (statusRun(config).active) shell('stop', config);
    rmSync(root, { recursive: true, force: true });
  }
}, 180000);
