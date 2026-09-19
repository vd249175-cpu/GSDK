/** Lossless portable values for JSON daemon State/Info. No projection truncation. */
const tag = '$graphframeworkValue';

function encode(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === undefined) return { [tag]: 'undefined' };
  if (typeof value === 'bigint') return { [tag]: 'bigint', value: String(value) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { [tag]: 'number', value: String(value) };
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object') throw new Error(`Non-portable daemon value: ${typeof value}`);
  const object = value as object;
  if (ancestors.has(object)) throw new Error('Cyclic daemon value');
  ancestors.add(object);
  const child = (entry: unknown) => encode(entry, ancestors);
  try {
    if (value instanceof Map) return { [tag]: 'map', entries: [...value].map(([key, entry]) => [child(key), child(entry)]) };
    if (value instanceof Set) return { [tag]: 'set', values: [...value].map(child) };
    if (value instanceof Date) return { [tag]: 'date', value: value.toISOString() };
    if (value instanceof Uint8Array) return { [tag]: 'bytes', values: [...value] };
    if (Array.isArray(value)) return value.map(child);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Non-portable daemon object');
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record).map(([key, entry]) => [key, child(entry)]);
    if (Object.hasOwn(record, tag)) return { [tag]: 'object', entries };
    return Object.fromEntries(entries);
  } finally { ancestors.delete(object); }
}

function decode(value: unknown): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const record = value as Record<string, any>;
  switch (record[tag]) {
    case 'undefined': return undefined;
    case 'bigint': return BigInt(record.value);
    case 'number': return Number(record.value);
    case 'map': return new Map(record.entries.map(([key, entry]: unknown[]) => [decode(key), decode(entry)]));
    case 'set': return new Set(record.values.map(decode));
    case 'date': return new Date(record.value);
    case 'bytes': return new Uint8Array(record.values);
    case 'object': return Object.fromEntries(record.entries.map(([key, entry]: unknown[]) => [key, decode(entry)]));
    default: return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, decode(entry)]));
  }
}

export const daemonValueCodec = { encode, decode };
