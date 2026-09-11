import type { CausalIndex, ValidationIssue, ValidationReport } from './model';
import { findCausalPaths } from './path';

/**
 * Pure structural validation of a causal index: unresolved expressions,
 * dangling edges, and frontend-link integrity. No filesystem access;
 * host-specific service-provider checks belong to the caller.
 */
export function validateCausalIndex(index: CausalIndex): ValidationReport {
  const issues: ValidationIssue[] = [];

  // 1. Unresolved Info expressions are errors and never become graph entities.
  for (const unresolved of index.unresolvedInfoTypes) {
    issues.push({
      severity: 'error',
      code: 'unresolved-info-type',
      message: `Change ${unresolved.sourceChange} 的发送 Info 无法静态解析 (${unresolved.infoExpression})；请在发送点显式保留 type，仅将动态构造放入 payload`,
      entityAddress: unresolved.sourceChange,
      location: unresolved.location,
    });
  }

  // 2. Check unresolved send targets
  for (const unresolved of index.unresolvedSendTargets) {
    issues.push({
      severity: 'error',
      code: 'unresolved-send-target',
      message: `Change ${unresolved.sourceChange} 发送 ${unresolved.infoType} 时目标无法静态解析 (${unresolved.targetExpression})`,
      entityAddress: unresolved.sourceChange,
      location: unresolved.location,
    });
  }

  // 3. Check dangling edges (from or to does not exist)
  for (const edge of index.edges) {
    if (!index.entities.has(edge.from)) {
      issues.push({
        severity: 'error',
        code: 'dangling-edge-source',
        message: `Edge ${edge.id} 源端点 ${edge.from} 未在实体表中找到`,
        location: edge.location,
      });
    }
    if (!index.entities.has(edge.to)) {
      issues.push({
        severity: 'error',
        code: 'dangling-edge-target',
        message: `Edge ${edge.id} 目标端点 ${edge.to} 未在实体表中找到`,
        location: edge.location,
      });
    }
  }

  // 4. Check frontend links validity
  for (const link of index.frontendLinks) {
    const targetNode = index.nodes.get(link.injection.targetNodeId);
    if (!targetNode) {
      issues.push({
        severity: 'error',
        code: 'missing-frontend-injection-target',
        message: `FrontendLink ${link.id} 注入目标 Node ${link.injection.targetNodeId} 不存在`,
      });
    }
    const triggerAddress = `change:${link.injection.targetNodeId}::${link.injection.infoType}`;
    if (!index.changes.has(triggerAddress)) {
      issues.push({
        severity: 'error',
        code: 'missing-frontend-trigger',
        message: `FrontendLink ${link.id} 的根 Info 未被目标 Node 消费: ${triggerAddress}`,
        entityAddress: triggerAddress,
      });
    }

    for (const proj of link.projections) {
      const stateAddress = `state:${proj.ownerNodeId}::${proj.ownerField}`;
      if (!index.states.has(stateAddress)) {
        issues.push({
          severity: 'warning',
          code: 'unverified-projection-field',
          message: `FrontendLink ${link.id} 投影的 State 字段 ${stateAddress} 未在 Node 实例 State 中观察到`,
        });
      }
      const entryAddress = `entry:${link.applicationMethod}`;
      const uiAddress = `ui:${proj.applicationStatePath}`;
      if (!index.entities.has(entryAddress) || !index.entities.has(uiAddress)
        || findCausalPaths(index, entryAddress, uiAddress, { maxPaths: 1, maxDepth: index.entities.size }).paths.length === 0) {
        issues.push({
          severity: 'error',
          code: 'broken-frontend-causal-path',
          message: `FrontendLink ${link.id} 不存在 ${entryAddress} 到 ${uiAddress} 的实际因果路径`,
          entityAddress: entryAddress,
        });
      }
    }
  }

  const valid = !issues.some((i) => i.severity === 'error');

  return {
    valid,
    issues,
  };
}
