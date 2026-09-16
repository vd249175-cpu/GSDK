/**
 * Browser-safe projection codec: zero node:* imports, no Buffer dependency.
 * Node runtime re-exports this module; renderer imports it directly so the
 * browser bundle never pulls native-space / process-node.
 */

export type EncodedValue =
  | { $type: 'primitive'; value: string | number | boolean | null | undefined }
  | { $type: 'array'; value: EncodedValue[] }
  | { $type: 'object'; value: Record<string, EncodedValue> }
  | { $type: 'map'; entries: Array<[EncodedValue, EncodedValue]> }
  | { $type: 'set'; values: EncodedValue[] }
  | { $type: 'bytes'; value: string; byteLength: number }
  | { $type: 'ref'; kind: string; summary: string; id?: string }
  | { $type: 'truncated'; originalType: string; summary: string; byteLength?: number };

export interface ValueCodecOptions {
  maxDepth?: number;
  maxBytes?: number;
  maxArrayLength?: number;
  rootPath?: string[];
  redactedKeys?: readonly string[];
}

export class ValueCodec {
  constructor(private defaultOptions: ValueCodecOptions = {}) {}

  encode(value: unknown, options: ValueCodecOptions = {}): EncodedValue {
    const opts = { ...this.defaultOptions, ...options };
    return this._encodeValue(value, opts.maxDepth ?? 8, opts.rootPath ?? [], opts);
  }

  decode(encoded: EncodedValue): any {
    if (!encoded || typeof encoded !== 'object') return encoded;
    switch (encoded.$type) {
      case 'primitive':
        return encoded.value;
      case 'array':
        return encoded.value.map((item) => this.decode(item));
      case 'map': {
        const map = new Map();
        for (const [k, v] of encoded.entries) {
          map.set(this.decode(k), this.decode(v));
        }
        return map;
      }
      case 'set': {
        const set = new Set();
        for (const v of encoded.values) {
          set.add(this.decode(v));
        }
        return set;
      }
      case 'object': {
        const result: Record<string, any> = {};
        for (const [key, val] of Object.entries(encoded.value)) {
          result[key] = this.decode(val);
        }
        return result;
      }
      case 'bytes':
        return encoded.value;
      case 'ref':
      case 'truncated':
        return encoded.summary;
      default:
        return encoded;
    }
  }

  private _encodeValue(
    value: unknown,
    depthRemaining: number,
    path: string[],
    options: ValueCodecOptions,
  ): EncodedValue {
    if (value === null || value === undefined) {
      return { $type: 'primitive', value };
    }
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') {
      return { $type: 'primitive', value: value as string | number | boolean };
    }
    if (type === 'bigint' || type === 'symbol' || type === 'function') {
      return { $type: 'ref', kind: type, summary: String(value) };
    }
    if (depthRemaining <= 0) {
      return { $type: 'truncated', originalType: type, summary: '[Max Depth Reached]' };
    }
    if (value instanceof Map) {
      return {
        $type: 'map',
        entries: [...(value as Map<unknown, unknown>).entries()].map(([k, v]) => [
          this._encodeValue(k, depthRemaining - 1, [...path, '<map-key>'], options),
          this._encodeValue(v, depthRemaining - 1, [...path, '<map-value>'], options),
        ]),
      };
    }
    if (value instanceof Set) {
      return {
        $type: 'set',
        values: [...(value as Set<unknown>)].map((v) =>
          this._encodeValue(v, depthRemaining - 1, [...path, '<set>'], options)),
      };
    }
    if (Array.isArray(value)) {
      const limit = options.maxArrayLength ?? 1000;
      return {
        $type: 'array',
        value: value.slice(0, limit).map((v, i) =>
          this._encodeValue(v, depthRemaining - 1, [...path, String(i)], options)),
      };
    }
    if (type === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      const record: Record<string, EncodedValue> = {};
      for (const key of keys) {
        if (options.redactedKeys?.includes(key)) {
          record[key] = { $type: 'ref', kind: 'redacted', summary: '[REDACTED]' };
        } else {
          record[key] = this._encodeValue(obj[key], depthRemaining - 1, [...path, key], options);
        }
      }
      return { $type: 'object', value: record };
    }
    return { $type: 'primitive', value: String(value) };
  }
}

export const defaultValueCodec = new ValueCodec();
