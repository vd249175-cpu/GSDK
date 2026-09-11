import ts from 'typescript';
import { Node, WorldNode } from '@graphvideo/kernel';
import type { SourceLocation } from './model';

type AnalysisValue = null | string | number | boolean | AnalysisValue[] | { [key: string]: AnalysisValue };

export interface AnalysisInstanceDescriptor {
  readonly className: string;
  readonly properties: readonly {
    name: string;
    valueType: string;
    value?: AnalysisValue;
  }[];
  readonly methods: readonly { name: string; ownerClassName: string; source: string }[];
}

// Data descriptors only: inspecting an instance must not execute application getters.
function toAnalysisValue(value: unknown, depth = 0): AnalysisValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || depth >= 3) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (typeof descriptors.id?.value === 'string' && descriptors.id.value) return { id: descriptors.id.value };
  if (Array.isArray(value)) {
    const items: AnalysisValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !('value' in descriptor)) return undefined;
      const item = toAnalysisValue(descriptor.value, depth + 1);
      if (item === undefined) return undefined;
      items.push(item);
    }
    return items;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined;
  const result: { [key: string]: AnalysisValue } = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) continue;
    const encoded = toAnalysisValue(descriptor.value, depth + 1);
    if (encoded !== undefined) result[key] = encoded;
  }
  return result;
}

function describeInstance(node: Node<any>): AnalysisInstanceDescriptor {
  const properties = Object.entries(Object.getOwnPropertyDescriptors(node))
    .filter(([, descriptor]) => descriptor.enumerable)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, descriptor]) => {
      if (!('value' in descriptor)) return { name, valueType: 'accessor' };
      const raw = descriptor.value;
      const value = toAnalysisValue(raw);
      return {
        name,
        valueType: raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw,
        ...(value === undefined ? {} : { value }),
      };
    });
  const methods: Array<{ name: string; ownerClassName: string; source: string }> = [];
  const seen = new Set<string>();
  let prototype = Object.getPrototypeOf(node) as object | null;
  while (prototype && prototype !== Node.prototype && prototype !== Object.prototype) {
    if (prototype !== WorldNode.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(prototype);
      const ownerClassName = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value?.name ?? 'Anonymous';
      for (const name of Object.keys(descriptors).sort()) {
        if (name === 'constructor' || seen.has(name)) continue;
        seen.add(name);
        const descriptor = descriptors[name];
        if (typeof descriptor.value !== 'function') continue;
        methods.push({ name, ownerClassName, source: Function.prototype.toString.call(descriptor.value) });
      }
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return { className: node.constructor.name, properties, methods };
}

export interface InstanceNodeInfo {
  nodeId: string;
  nodeName: string;
  className: string;
  isWorldNode: boolean;
  worldKind?: string;
  filePath: string;
  location: SourceLocation;
  stateFields: Array<{
    name: string;
    typeText: string;
    location: SourceLocation;
  }>;
  classDeclaration: ts.ClassDeclaration;
  sourceFile: ts.SourceFile;
}

export interface NodeObjectFact {
  nodeId: string;
  nodeName: string;
  className: string;
  factoryKey: string;
  isWorldNode: boolean;
  worldKind?: string;
  stateFields: string[];
  ownProperties: string[];
  descriptor: AnalysisInstanceDescriptor;
}

/** Reads only already-constructed Node object properties; it never mounts or runs them. */
export function inspectNodeObjects(nodes: readonly Node<any>[]): NodeObjectFact[] {
  const ids = new Set<string>();
  return nodes.map((node) => {
    if (!node.id) throw new Error('分析对象必须具有非空 Node ID');
    if (ids.has(node.id)) throw new Error(`分析对象包含重复 Node ID: ${node.id}`);
    ids.add(node.id);

    const descriptor = describeInstance(node);
    const state = Object.getOwnPropertyDescriptor(node, 'state')?.value;
    return {
      nodeId: node.id,
      nodeName: node.name,
      className: node.constructor.name,
      factoryKey: node.factoryKey,
      isWorldNode: node.isWorldNode,
      worldKind: (node as { worldKind?: string }).worldKind,
      stateFields: state && typeof state === 'object' ? Object.keys(state) : [],
      ownProperties: descriptor.properties.map((property) => property.name),
      descriptor,
    };
  });
}

/** Builds a temporary class AST only from the already-instantiated object DTO. */
export function nodeObjectFactToScannedNode(fact: NodeObjectFact): InstanceNodeInfo {
  const virtualPath = `instance://${fact.nodeId}/${fact.className}.ts`;
  const propertySource = fact.descriptor.properties
    .filter((property) => property.value !== undefined)
    .filter((property) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property.name))
    .map((property) => `${property.name} = ${JSON.stringify(property.value)};`)
    .join('\n');
  const methodSource = fact.descriptor.methods
    .map((method) => method.source)
    .join('\n');
  const sourceCode = `class ${fact.className} extends Node<any> {\n${propertySource}\n${methodSource}\n}`;
  const sourceFile = ts.createSourceFile(
    virtualPath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const classDeclaration = sourceFile.statements.find(ts.isClassDeclaration);
  if (!classDeclaration) throw new Error(`无法从实例 ${fact.nodeId} 构建分析类`);

  const location = { filePath: virtualPath, line: 1, column: 1 };
  return {
    nodeId: fact.nodeId,
    nodeName: fact.nodeName,
    className: fact.className,
    isWorldNode: fact.isWorldNode,
    worldKind: fact.worldKind,
    filePath: virtualPath,
    location,
    stateFields: fact.stateFields.map((name) => ({
      name,
      typeText: 'instance-observed',
      location,
    })),
    classDeclaration,
    sourceFile,
  };
}
