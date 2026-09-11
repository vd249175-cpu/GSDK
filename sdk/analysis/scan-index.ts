import type {
  CausalEdge,
  CausalEntity,
  CausalIndex,
  FrontendLinkDefinition,
  FrontendServiceLinkDefinition,
} from './model';
import { scanNodeChanges } from './scan-changes';
import { inspectNodeObjects, nodeObjectFactToScannedNode } from './inspect-nodes';
import type { Node } from '@graphvideo/kernel';

export interface ScanIndexOptions {
  /** Caller-constructed Node objects; the builder never creates Nodes or Runtimes. */
  readonly nodeObjects: readonly Node<any>[];
  /** Caller-supplied UI boundary links; defaults to none (no host table). */
  readonly frontendLinks?: readonly FrontendLinkDefinition[];
  readonly frontendServiceLinks?: readonly FrontendServiceLinkDefinition[];
}

/**
 * Builds a causal index purely from the given Node instances plus explicit
 * UI boundary links. No host assembly, no filesystem access, no Runtime.
 */
export function buildCausalIndex(options: ScanIndexOptions): CausalIndex {
  const frontendLinks = options.frontendLinks ?? [];
  const frontendServiceLinks = options.frontendServiceLinks ?? [];
  const entities = new Map<string, CausalEntity>();
  const edges: CausalEdge[] = [];
  const nodes = new Map<string, CausalEntity>();
  const changes = new Map<string, CausalEntity>();
  const states = new Map<string, CausalEntity>();
  const infos = new Map<string, CausalEntity>();
  const effects = new Map<string, CausalEntity>();
  const entries = new Map<string, CausalEntity>();
  const uiPaths = new Map<string, CausalEntity>();
  const unresolvedInfoTypes: CausalIndex['unresolvedInfoTypes'] = [];
  const unresolvedSendTargets: CausalIndex['unresolvedSendTargets'] = [];

  function addEntity(entity: CausalEntity) {
    entities.set(entity.address, entity);
    if (entity.kind === 'node') nodes.set(entity.id, entity);
    if (entity.kind === 'change') changes.set(entity.address, entity);
    if (entity.kind === 'state') states.set(entity.address, entity);
    if (entity.kind === 'info') infos.set(entity.address, entity);
    if (entity.kind === 'effect') effects.set(entity.address, entity);
    if (entity.kind === 'entry') entries.set(entity.address, entity);
    if (entity.kind === 'ui') uiPaths.set(entity.address, entity);
  }

  function addEdge(edge: CausalEdge) {
    edges.push(edge);
  }

  // 1. Analyze only instance DTOs of the given Node objects.
  const nodeObjectFacts = inspectNodeObjects(options.nodeObjects);

  for (const objectFact of nodeObjectFacts) {
    const sNode = nodeObjectFactToScannedNode(objectFact);
    const nodeAddress = `node:${sNode.nodeId}`;
    const nodeEntity: CausalEntity = {
      address: nodeAddress,
      kind: 'node',
      id: sNode.nodeId,
      name: sNode.nodeName,
      location: sNode.location,
      meta: {
        className: sNode.className,
        isWorldNode: sNode.isWorldNode,
        factoryKey: objectFact.factoryKey,
        ownProperties: objectFact.ownProperties,
        runtimeStateFields: objectFact.stateFields,
      },
    };
    addEntity(nodeEntity);

    // Register state fields
    for (const field of sNode.stateFields) {
      const stateAddress = `state:${sNode.nodeId}::${field.name}`;
      const stateEntity: CausalEntity = {
        address: stateAddress,
        kind: 'state',
        id: sNode.nodeId,
        subId: field.name,
        nodeId: sNode.nodeId,
        location: field.location,
        meta: { typeText: field.typeText },
      };
      addEntity(stateEntity);
    }

    // Scan changes
    const branches = scanNodeChanges(sNode);
    for (const branch of branches) {
      const changeAddress = `change:${sNode.nodeId}::${branch.infoType}`;
      const changeEntity: CausalEntity = {
        address: changeAddress,
        kind: 'change',
        id: sNode.nodeId,
        subId: branch.infoType,
        nodeId: sNode.nodeId,
        location: branch.location,
      };
      addEntity(changeEntity);

      // Inbound Trigger Edge: info@Target -> change
      const inboundInfoAddress = `info:${branch.infoType}@${sNode.nodeId}`;
      let inboundInfo = entities.get(inboundInfoAddress);
      if (!inboundInfo) {
        inboundInfo = {
          address: inboundInfoAddress,
          kind: 'info',
          id: branch.infoType,
          subId: sNode.nodeId,
          nodeId: sNode.nodeId,
          location: branch.location,
        };
        addEntity(inboundInfo);
      }
      addEdge({
        id: `trigger:${inboundInfoAddress}->${changeAddress}`,
        from: inboundInfoAddress,
        to: changeAddress,
        type: 'trigger',
        confidence: 'high',
        location: branch.location,
      });

      // Reads: state -> change
      for (const read of branch.reads) {
        const stateAddress = `state:${sNode.nodeId}::${read.fieldName}`;
        let stateEntity = entities.get(stateAddress);
        if (!stateEntity) {
          stateEntity = {
            address: stateAddress,
            kind: 'state',
            id: sNode.nodeId,
            subId: read.fieldName,
            nodeId: sNode.nodeId,
            location: read.location,
          };
          addEntity(stateEntity);
        }
        addEdge({
          id: `read:${stateAddress}->${changeAddress}`,
          from: stateAddress,
          to: changeAddress,
          type: 'read-by',
          confidence: 'high',
          location: read.location,
        });
      }

      // Writes: change -> state
      for (const write of branch.writes) {
        const stateAddress = `state:${sNode.nodeId}::${write.fieldName}`;
        let stateEntity = entities.get(stateAddress);
        if (!stateEntity) {
          stateEntity = {
            address: stateAddress,
            kind: 'state',
            id: sNode.nodeId,
            subId: write.fieldName,
            nodeId: sNode.nodeId,
            location: write.location,
          };
          addEntity(stateEntity);
        }
        addEdge({
          id: `write:${changeAddress}->${stateAddress}`,
          from: changeAddress,
          to: stateAddress,
          type: 'write',
          confidence: 'high',
          location: write.location,
        });
      }

      // Effects: change -> effect
      for (const eff of branch.effects) {
        const effectAddress = `effect:${sNode.nodeId}::${eff.adapterOrName}`;
        let effectEntity = entities.get(effectAddress);
        if (!effectEntity) {
          effectEntity = {
            address: effectAddress,
            kind: 'effect',
            id: sNode.nodeId,
            subId: eff.adapterOrName,
            nodeId: sNode.nodeId,
            location: eff.location,
          };
          addEntity(effectEntity);
        }
        addEdge({
          id: `effect:${changeAddress}->${effectAddress}`,
          from: changeAddress,
          to: effectAddress,
          type: 'effect',
          confidence: 'high',
          location: eff.location,
        });
      }

      // Sends: change -> info@Target
      for (const send of branch.sends) {
        if (!send.infoType) {
          unresolvedInfoTypes.push({
            sourceChange: changeAddress,
            targetNodeId: send.targetNodeId,
            infoExpression: send.rawInfoExpr,
            location: send.location,
          });
          continue;
        }
        if (!send.targetNodeId) {
          unresolvedSendTargets.push({
            sourceChange: changeAddress,
            infoType: send.infoType,
            targetExpression: send.rawTargetExpr,
            location: send.location,
          });
          continue;
        }

        const targetInfoAddress = `info:${send.infoType}@${send.targetNodeId}`;
        let targetInfo = entities.get(targetInfoAddress);
        if (!targetInfo) {
          targetInfo = {
            address: targetInfoAddress,
            kind: 'info',
            id: send.infoType,
            subId: send.targetNodeId,
            nodeId: send.targetNodeId,
            location: send.location,
          };
          addEntity(targetInfo);
        }
        addEdge({
          id: `send:${changeAddress}->${targetInfoAddress}`,
          from: changeAddress,
          to: targetInfoAddress,
          type: 'send',
          confidence: 'high',
          location: send.location,
        });
      }
    }
  }

  // 2. Caller-supplied frontend links
  for (const link of frontendLinks) {
    const entryAddress = `entry:${link.applicationMethod}`;
    const entryEntity: CausalEntity = {
      address: entryAddress,
      kind: 'entry',
      id: link.applicationMethod,
      name: link.applicationMethod,
    };
    addEntity(entryEntity);

    // Entry --inject--> info@Target
    const targetInfoAddress = `info:${link.injection.infoType}@${link.injection.targetNodeId}`;
    let targetInfo = entities.get(targetInfoAddress);
    if (!targetInfo) {
      targetInfo = {
        address: targetInfoAddress,
        kind: 'info',
        id: link.injection.infoType,
        subId: link.injection.targetNodeId,
        nodeId: link.injection.targetNodeId,
      };
      addEntity(targetInfo);
    }
    addEdge({
      id: `inject:${entryAddress}->${targetInfoAddress}`,
      from: entryAddress,
      to: targetInfoAddress,
      type: 'inject',
      confidence: 'high',
    });

    // Projections: state --project--> ui
    for (const proj of link.projections) {
      const stateAddress = `state:${proj.ownerNodeId}::${proj.ownerField}`;
      const uiAddress = `ui:${proj.applicationStatePath}`;
      let uiEntity = entities.get(uiAddress);
      if (!uiEntity) {
        uiEntity = {
          address: uiAddress,
          kind: 'ui',
          id: proj.applicationStatePath,
          name: proj.applicationStatePath,
          meta: { consumers: proj.consumers },
        };
        addEntity(uiEntity);
      }
      addEdge({
        id: `project:${stateAddress}->${uiAddress}`,
        from: stateAddress,
        to: uiAddress,
        type: 'project',
        confidence: 'high',
      });
    }
  }

  return {
    timestamp: Date.now(),
    entities,
    edges,
    nodes,
    changes,
    states,
    infos,
    effects,
    entries,
    uiPaths,
    frontendLinks: [...frontendLinks],
    frontendServiceLinks: [...frontendServiceLinks],
    nodeObjectFacts,
    unresolvedInfoTypes,
    unresolvedSendTargets,
  };
}
