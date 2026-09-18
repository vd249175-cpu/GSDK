import {
  Check, Clock3, DatabaseBackup, GitBranch, Plus, ShieldCheck, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectSnapshotGraphDto, ProjectSnapshotDto } from '../application/contract/domain'

interface ProjectSnapshotsClient {
  listSnapshots(): Promise<ProjectSnapshotGraphDto>
  createSnapshot(label?: string): Promise<ProjectSnapshotGraphDto>
  branchFromSnapshot(snapshotId: string, branchName: string): Promise<ProjectSnapshotGraphDto>
}

interface ProjectSnapshotsDialogProps {
  client: ProjectSnapshotsClient
  disabled: boolean
  projectName: string
}

function snapshotTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

function snapshotSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ProjectSnapshotsDialog({ client, disabled, projectName }: ProjectSnapshotsDialogProps) {
  const [open, setOpen] = useState(false)
  const [graph, setGraph] = useState<ProjectSnapshotGraphDto | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [branchName, setBranchName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    let active = true
    setBusy(true)
    setError('')
    void client.listSnapshots()
      .then((nextGraph) => {
        if (!active) return
        setGraph(nextGraph)
        setSelectedId((current) => current && nextGraph.snapshots.some((item) => item.id === current)
          ? current
          : nextGraph.snapshots.at(-1)?.id ?? null)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取项目快照')
      })
      .finally(() => { if (active) setBusy(false) })
    dialogRef.current?.focus()
    return () => { active = false }
  }, [client, open])

  useEffect(() => {
    if (!open) return undefined
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [busy, open])

  const selectedSnapshot = useMemo(() => (
    graph?.snapshots.find((snapshot) => snapshot.id === selectedId) ?? null
  ), [graph, selectedId])
  const snapshotById = useMemo(() => new Map(
    graph?.snapshots.map((snapshot) => [snapshot.id, snapshot]) ?? [],
  ), [graph])

  async function createSnapshot() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const nextGraph = await client.createSnapshot(snapshotLabel.trim() || undefined)
      setGraph(nextGraph)
      setSelectedId(nextGraph.snapshots.at(-1)?.id ?? null)
      setSnapshotLabel('')
      setNotice('项目 SQLite 快照已创建')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建项目快照失败')
    } finally {
      setBusy(false)
    }
  }

  async function createBranch() {
    if (!selectedSnapshot || !branchName.trim()) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const nextGraph = await client.branchFromSnapshot(selectedSnapshot.id, branchName.trim())
      setGraph(nextGraph)
      setBranchName('')
      setNotice(`已回到“${selectedSnapshot.label}”并建立新分支`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '建立项目分支失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="project-snapshots-trigger"
        disabled={disabled}
        type="button"
        title={disabled ? '打开项目且等待当前任务完成后才能管理快照' : '项目 SQLite 快照与分支'}
        onClick={() => setOpen(true)}
      >
        <DatabaseBackup size={14} aria-hidden="true" />
        <span>项目快照</span>
      </button>
      {open && createPortal(
        <div className="project-snapshots-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false)
        }}>
          <div
            aria-label="项目快照与分支"
            aria-modal="true"
            className="project-snapshots-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header>
              <div>
                <DatabaseBackup size={18} aria-hidden="true" />
                <div>
                  <strong>项目快照与分支</strong>
                  <span>{projectName} · SQLite 时间线</span>
                </div>
              </div>
              <button aria-label="关闭项目快照" disabled={busy} type="button" onClick={() => setOpen(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="project-snapshots-create">
              <label>
                <span>快照名称</span>
                <input
                  disabled={busy}
                  maxLength={80}
                  placeholder="例如：分镜初稿完成"
                  value={snapshotLabel}
                  onChange={(event) => setSnapshotLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !busy) void createSnapshot()
                  }}
                />
              </label>
              <button disabled={busy} type="button" onClick={() => void createSnapshot()}>
                <Plus size={14} aria-hidden="true" />创建当前快照
              </button>
            </div>

            <div className="project-snapshots-content">
              <div className="project-snapshot-graph" aria-label="项目快照分支图">
                {busy && !graph ? (
                  <div className="project-snapshot-empty">正在读取项目快照…</div>
                ) : graph && graph.branches.length > 0 ? graph.branches.map((branch) => {
                  const snapshots = graph.snapshots
                    .filter((snapshot) => snapshot.branchId === branch.id)
                    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
                  const source = branch.sourceSnapshotId
                    ? snapshotById.get(branch.sourceSnapshotId)
                    : undefined
                  return (
                    <section className="project-snapshot-lane" key={branch.id}>
                      <div className="project-snapshot-lane-label">
                        <GitBranch size={14} aria-hidden="true" />
                        <strong>{branch.name}</strong>
                        {branch.id === graph.activeBranchId && <span><Check size={11} />当前</span>}
                      </div>
                      <div className="project-snapshot-track">
                        {source && (
                          <button
                            className={`project-snapshot-node is-origin ${selectedId === source.id ? 'is-selected' : ''}`}
                            type="button"
                            onClick={() => setSelectedId(source.id)}
                          >
                            <i />
                            <small>分支起点</small>
                            <strong>{source.label}</strong>
                          </button>
                        )}
                        {snapshots.map((snapshot) => (
                          <SnapshotNode
                            active={branch.headSnapshotId === snapshot.id}
                            key={`${branch.id}/${snapshot.id}`}
                            selected={selectedId === snapshot.id}
                            snapshot={snapshot}
                            onSelect={setSelectedId}
                          />
                        ))}
                        {!source && snapshots.length === 0 && (
                          <div className="project-snapshot-lane-empty">尚未创建快照</div>
                        )}
                      </div>
                    </section>
                  )
                }) : (
                  <div className="project-snapshot-empty">
                    <DatabaseBackup size={34} aria-hidden="true" />
                    <strong>还没有项目快照</strong>
                    <span>创建快照后，这里会显示可回溯和分支的图形时间线。</span>
                  </div>
                )}
              </div>

              <aside className="project-snapshot-inspector">
                {selectedSnapshot ? (
                  <>
                    <div className="project-snapshot-selected-title">
                      {selectedSnapshot.kind === 'recovery'
                        ? <ShieldCheck size={17} aria-hidden="true" />
                        : <DatabaseBackup size={17} aria-hidden="true" />}
                      <div>
                        <strong>{selectedSnapshot.label}</strong>
                        <span><Clock3 size={12} />{snapshotTime(selectedSnapshot.createdAt)}</span>
                      </div>
                    </div>
                    <dl>
                      <div><dt>分支</dt><dd>{graph?.branches.find((item) => item.id === selectedSnapshot.branchId)?.name}</dd></div>
                      <div><dt>大小</dt><dd>{snapshotSize(selectedSnapshot.sizeBytes)}</dd></div>
                      <div><dt>类型</dt><dd>{selectedSnapshot.kind === 'recovery' ? '切换保护' : '手动快照'}</dd></div>
                    </dl>
                    <div className="project-snapshot-branch-form">
                      <label>
                        <span>新分支名称</span>
                        <input
                          disabled={busy}
                          maxLength={80}
                          placeholder="例如：新版结局"
                          value={branchName}
                          onChange={(event) => setBranchName(event.target.value)}
                        />
                      </label>
                      <p>项目将回到此节点；切换前的当前状态会自动保存为保护快照。</p>
                      <button
                        disabled={busy || !branchName.trim()}
                        type="button"
                        onClick={() => void createBranch()}
                      ><GitBranch size={14} aria-hidden="true" />从此节点建立分支</button>
                    </div>
                  </>
                ) : (
                  <div className="project-snapshot-inspector-empty">选择一个快照节点查看详情或建立分支。</div>
                )}
              </aside>
            </div>

            {(error || notice) && (
              <footer className={error ? 'is-error' : 'is-success'}>
                {error || notice}
              </footer>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function SnapshotNode({
  active, onSelect, selected, snapshot,
}: {
  active: boolean
  onSelect(id: string): void
  selected: boolean
  snapshot: ProjectSnapshotDto
}) {
  return (
    <button
      aria-pressed={selected}
      className={`project-snapshot-node ${selected ? 'is-selected' : ''} ${snapshot.kind === 'recovery' ? 'is-recovery' : ''}`}
      type="button"
      onClick={() => onSelect(snapshot.id)}
    >
      <i />
      <small>{snapshot.kind === 'recovery' ? '保护快照' : snapshotTime(snapshot.createdAt)}</small>
      <strong>{snapshot.label}</strong>
      {active && <em>HEAD</em>}
    </button>
  )
}
