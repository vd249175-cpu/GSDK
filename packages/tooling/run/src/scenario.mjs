import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scenario runner for one named run. It reuses the run's real control plane:
 * the same kernel endpoint, the same assembled Node slice, the same Rust
 * scheduling, and the same stop path as an interactive run. Scenarios only
 * add inputs, assertions and end conditions; they never build a second
 * production graph or copy business logic.
 *
 * Settlement proof is the authoritative daemon projection:
 * - every submission id reaches a terminal status (completed/failed/cancelled)
 *   with pending Total at zero, never a single submission or a momentarily
 *   empty queue;
 * - node assertions compare live State/version against the projection.
 * Failure keeps the assertion evidence, the cleanup result and the original
 * non-zero exit status: cleanup success never overwrites the scenario failure.
 */
export async function runScenarioSet({
  parsed,
  runName,
  submitInfos,
  readProjection,
  timeoutMs = 30_000,
  logLine = () => {},
}) {
  const scenarios = parsed.scenarios ?? [];
  const report = { runName, scenarios: [] };
  let failed = 0;
  for (const scenario of scenarios) {
    const started = Date.now();
    const outcome = { name: scenario.name, ok: true, inputs: 0, assertions: [] };
    try {
      let sequence = 0;
      const submissionIds = [];
      for (const input of scenario.inputs) {
        sequence += 1;
        const submissionId = `${runName}/scenario/${scenario.name}/${sequence}`;
        const feedback = await submitInfos(input.targetNodeId, input.info, submissionId);
        outcome.inputs += 1;
        if (feedback?.status === 'dropped') {
          throw new Error(`scenario input dropped: ${input.targetNodeId} ${input.info.type}`);
        }
        submissionIds.push(submissionId);
      }
      await waitForSettled({
        submissionIds,
        readProjection,
        timeoutMs: Math.min(scenario.timeoutMs, timeoutMs),
        scenario: scenario.name,
      });
      const projection = await readProjection();
      for (const assertion of scenario.assertions) {
        checkAssertion(projection, assertion, scenario.name);
        outcome.assertions.push(assertion);
      }
      logLine(`scenario ok ${scenario.name} (${Date.now() - started}ms)`);
    } catch (error) {
      outcome.ok = false;
      outcome.error = error instanceof Error ? error.message : String(error);
      failed += 1;
      logLine(`scenario failed ${scenario.name}: ${outcome.error}`);
    }
    report.scenarios.push(outcome);
  }
  report.failed = failed;
  report.passed = report.scenarios.length - failed;
  return report;
}

async function waitForSettled({ submissionIds, readProjection, timeoutMs, scenario }) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const projection = await readProjection();
    const states = submissionIds.map((id) => projection.submissions?.[id]?.status ?? 'unknown');
    last = states.join(',');
    const terminal = states.every((status) => ['completed', 'failed', 'cancelled'].includes(status));
    if (terminal && (projection.pending ?? 0) === 0) {
      const failed = states.filter((status) => status === 'failed');
      if (failed.length > 0) throw new Error(`scenario submissions failed: ${submissionIds.join(',')}`);
      return projection;
    }
    if (Date.now() > deadline) {
      throw new Error(`scenario timed out (${scenario}): submissions [${last}] pending ${projection.pending ?? '?'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function checkAssertion(projection, assertion, scenario) {
  if (assertion.submission) {
    const status = projection.submissions?.[assertion.submission]?.status;
    if (status !== assertion.status) {
      throw new Error(`scenario ${scenario}: submission ${assertion.submission} is ${status ?? 'unknown'}, want ${assertion.status}`);
    }
    return;
  }
  const node = projection.nodes?.[assertion.nodeId];
  if (!node) throw new Error(`scenario ${scenario}: missing Node in projection: ${assertion.nodeId}`);
  if (assertion.version !== undefined && node.version !== assertion.version) {
    throw new Error(
      `scenario ${scenario}: ${assertion.nodeId} version ${node.version}, want ${assertion.version}`,
    );
  }
  if (assertion.state !== undefined) {
    for (const [key, value] of Object.entries(assertion.state)) {
      if (JSON.stringify(node.state?.[key]) !== JSON.stringify(value)) {
        throw new Error(
          `scenario ${scenario}: ${assertion.nodeId}.${key} is ${JSON.stringify(node.state?.[key])}, want ${JSON.stringify(value)}`,
        );
      }
    }
  }
}

export function writeScenarioReport(logsDirectory, runName, report) {
  mkdirSync(logsDirectory, { recursive: true });
  const path = join(logsDirectory, `${runName}.scenarios.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

