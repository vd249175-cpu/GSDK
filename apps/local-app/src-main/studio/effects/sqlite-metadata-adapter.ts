import type {
  EffectAdapter,
  EffectContext,
} from '@graphvideo/kernel';

export interface SqliteMetadataRecord {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface SqlitePersistRequest {
  readonly taskId?: string;
  readonly dbFilePath: string;
  readonly records: readonly SqliteMetadataRecord[];
}

export interface SqlitePersistObservation {
  readonly dbFilePath: string;
  readonly persistedRecordCount: number;
  readonly byteLength: number;
  readonly contentRef: string;
}

export interface SqliteWritePort {
  readonly id: string;
  write(
    request: SqlitePersistRequest,
    context: EffectContext,
  ): Promise<SqlitePersistObservation>;
}

export const sqliteMetadataAdapterId = 'graphvideo/sqlite-metadata-v1';

export class SqliteMetadataAdapter implements EffectAdapter<
  SqlitePersistRequest,
  SqlitePersistObservation
> {
  readonly id = sqliteMetadataAdapterId;

  constructor(private readonly port: SqliteWritePort) {}

  async execute(request: SqlitePersistRequest, context: EffectContext) {
    if (!request.dbFilePath.trim()) throw new Error('SQLite Request 缺少 dbFilePath');
    const ids = new Set<string>();
    for (const record of request.records) {
      if (
        !record ||
        typeof record !== 'object' ||
        typeof record.id !== 'string' ||
        !record.id.trim()
      ) {
        throw new Error('SQLite metadata record 缺少 id');
      }
      if (ids.has(record.id)) throw new Error(`SQLite metadata record id 重复: ${record.id}`);
      ids.add(record.id);
    }
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error('SQLite 写入已取消');
    }
    context.recordTransport?.({
      portId: this.port.id,
      transaction: 'upsert-graph-metadata',
      recordCount: request.records.length,
    });
    const observation = await this.port.write(request, context);
    if (!observation.dbFilePath.trim() || !observation.contentRef.trim()) {
      throw new Error('SQLite WritePort 返回的 Observation 不完整');
    }
    return observation;
  }
}
