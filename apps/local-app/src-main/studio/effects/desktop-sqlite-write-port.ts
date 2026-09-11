import type { EffectContext } from '@graphvideo/kernel';
import type {
  SqlitePersistObservation,
  SqlitePersistRequest,
  SqliteWritePort,
} from './sqlite-metadata-adapter';

export class DesktopSqliteWritePort implements SqliteWritePort {
  readonly id = 'electron/project-sqlite-ipc';

  async write(request: SqlitePersistRequest, context: EffectContext): Promise<SqlitePersistObservation> {
    const project = typeof window === 'undefined' ? undefined : (window as any).graphvideoDesktop?.project;
    if (!project) throw new Error('SQLite 写入需要 Electron project bridge');
    const result = await project.persistMetadata(request.dbFilePath, request.records);
    context.recordRawSummary?.({
      kind: 'electron-project-sqlite',
      text: `records=${request.records.length};db=${request.dbFilePath}`,
      redacted: false,
    });
    return {
      dbFilePath: request.dbFilePath,
      persistedRecordCount: result.persistedRecordCount ?? request.records.length,
      byteLength: result.byteLength ?? 0,
      contentRef: `sqlite:${request.dbFilePath}:${result.persistedRecordCount ?? request.records.length}`,
    };
  }
}
