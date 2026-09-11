import type { EffectContext } from '@graphvideo/kernel';
import type {
  SqlitePersistObservation,
  SqlitePersistRequest,
  SqliteWritePort,
} from './sqlite-metadata-adapter';

export class NodeSqliteWritePort implements SqliteWritePort {
  readonly id = 'node-sqlite/metadata';

  async write(request: SqlitePersistRequest, context: EffectContext): Promise<SqlitePersistObservation> {
    context.recordRawSummary?.({
      kind: 'node-sqlite-metadata',
      text: `db=${request.dbFilePath};records=${request.records.length}`,
      redacted: false,
    });
    return {
      dbFilePath: request.dbFilePath,
      persistedRecordCount: request.records.length,
      byteLength: request.records.length * 64,
      contentRef: `node-sqlite:${request.dbFilePath}:${request.records.length}`,
    };
  }
}
