export function selectWatchedFields(nodes, definitions) {
  return definitions.map(({ label, nodeId, path }) => {
    const state = nodes.find((node) => node.nodeId === nodeId)?.state;
    const value = path.split('.').reduce((current, key) => current && typeof current === 'object' ? current[key] : undefined, state);
    return { label, nodeId, path, value: value ?? null };
  });
}

export function selectWatchedInfos(events, definitions) {
  const types = new Set(definitions.map((entry) => entry.type));
  return events.filter((event) => types.has(event.infoType)).slice(-100).reverse();
}
