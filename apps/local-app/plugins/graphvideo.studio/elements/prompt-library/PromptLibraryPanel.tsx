import {
  Check, ChevronDown, ChevronRight, ChevronsUp, Copy, FilePlus2, FileText, Folder,
  FolderOpen, FolderPlus, LibraryBig, PanelLeftClose, PanelLeftOpen, Pencil, Plus,
  RefreshCw, Trash2,
} from 'lucide-react'
import {
  useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent,
} from 'react'
import {
  useApplicationClient, useShellClient, type PanelProps, type PromptLibraryEntry,
} from '@graphvideo/client-sdk'
import { LargeTextEditorDialog } from '@graphvideo/sdk/ui'
import {
  parsePromptDocument, serializePromptDocument, type PromptBlock, type PromptDocument,
} from './promptBlocks'
import {
  buildPromptFileRows, canMovePromptPath, joinPromptPath, promptEntryName,
  promptMoveTarget, promptParentPath, rebasePromptPath, visiblePromptFileRows,
  type PromptFileRow,
} from './promptFileTree'

interface EntryDraft extends PromptBlock {
  index: number
}

interface TreeEdit {
  mode: 'create' | 'rename'
  kind: PromptLibraryEntry['kind']
  parentPath: string
  sourcePath?: string
  value: string
}

type ExplorerRow =
  | { kind: 'entry'; row: PromptFileRow }
  | { kind: 'edit'; depth: number; key: string }

const emptyDocument: PromptDocument = { blocks: [] }

function fileTitle(path: string) {
  return path.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.xml$/i, '') || 'Untitled'
}

function normalizedEntryName(value: string, kind: PromptLibraryEntry['kind']) {
  const name = value.trim()
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new Error('名称不能为空，也不能包含路径分隔符')
  }
  return kind === 'file' && !name.toLowerCase().endsWith('.xml') ? `${name}.xml` : name
}

function expandPath(current: Set<string>, path: string) {
  const next = new Set(current)
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  parts.forEach((_, index) => next.delete(parts.slice(0, index + 1).join('/')))
  return next
}

export function PromptLibraryPanel({ instanceId }: PanelProps) {
  const application = useApplicationClient()
  const shell = useShellClient()
  const promptLibrary = application.promptLibrary
  const [entries, setEntries] = useState<PromptLibraryEntry[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [document, setDocument] = useState<PromptDocument>(emptyDocument)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [treeEdit, setTreeEdit] = useState<TreeEdit | null>(null)
  const [draggedPath, setDraggedPath] = useState('')
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [draft, setDraft] = useState<EntryDraft | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(230)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [collapsedCards, setCollapsedCards] = useState<Set<number>>(new Set())
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeStateRef = useRef<{ startX: number; startWidth: number; panelWidth: number } | null>(null)
  const fileRows = useMemo(() => buildPromptFileRows(entries), [entries])
  const visibleRows = useMemo(
    () => visiblePromptFileRows(fileRows, collapsed),
    [collapsed, fileRows],
  )
  const selectedEntry = entries.find((entry) => entry.path === selectedPath) ?? null

  const toggleCardCollapse = useCallback((index: number) => {
    setCollapsedCards((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const toggleAllCards = useCallback(() => {
    setCollapsedCards((prev) => (
      prev.size >= document.blocks.length && document.blocks.length > 0
        ? new Set()
        : new Set(document.blocks.map((_, index) => index))
    ))
  }, [document.blocks])

  const beginSidebarResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const container = event.currentTarget.parentElement
    if (!container) return
    const containerWidth = container.getBoundingClientRect().width
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
      panelWidth: containerWidth,
    }
  }, [sidebarWidth])

  const moveSidebarResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!resizeStateRef.current) return
    const { startX, startWidth, panelWidth } = resizeStateRef.current
    const delta = event.clientX - startX
    const minWidth = 160
    const maxWidth = Math.max(minWidth, panelWidth - 220)
    const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
    setSidebarWidth(Math.round(nextWidth))
  }, [])

  const endSidebarResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!resizeStateRef.current) return
    resizeStateRef.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const handleSplitterDoubleClick = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev)
  }, [])

  const explorerRows = useMemo(() => {
    const rows: ExplorerRow[] = []
    if (treeEdit?.mode === 'create' && !treeEdit.parentPath) {
      rows.push({ kind: 'edit', depth: 0, key: 'create-root' })
    }
    visibleRows.forEach((row) => {
      if (treeEdit?.mode === 'rename' && treeEdit.sourcePath === row.path) {
        rows.push({ kind: 'edit', depth: row.depth, key: `rename-${row.path}` })
      } else rows.push({ kind: 'entry', row })
      if (treeEdit?.mode === 'create' && treeEdit.parentPath === row.path) {
        rows.push({ kind: 'edit', depth: row.depth + 1, key: `create-${row.path}` })
      }
    })
    return rows
  }, [treeEdit, visibleRows])

  async function refreshEntries(preferredSelection?: string, preferredFile?: string) {
    const items = await promptLibrary.list()
    const paths = new Set(items.map((entry) => entry.path))
    const files = new Set(items.filter((entry) => entry.kind === 'file').map((entry) => entry.path))
    setEntries(items)
    if (files.size === 0) {
      setDocument(emptyDocument)
      setDraft(null)
    }
    setSelectedPath((current) => (
      preferredSelection && paths.has(preferredSelection)
        ? preferredSelection
        : paths.has(current) ? current : items[0]?.path ?? ''
    ))
    setSelectedFile((current) => (
      preferredFile && files.has(preferredFile)
        ? preferredFile
        : files.has(current) ? current : [...files][0] ?? ''
    ))
  }

  async function reloadEntries() {
    setBusy(true)
    try {
      await refreshEntries()
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法刷新提示词库')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void promptLibrary.list()
      .then((items) => {
        const firstFile = items.find((entry) => entry.kind === 'file')?.path ?? ''
        setEntries(items)
        setSelectedPath(firstFile || items[0]?.path || '')
        setSelectedFile(firstFile)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '无法读取提示词库'))
  }, [promptLibrary])

  useEffect(() => {
    if (!selectedFile) return
    let active = true
    void promptLibrary.read(selectedFile)
      .then((source) => {
        if (!active) return
        setDocument(parsePromptDocument(source))
        setError('')
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法读取提示词文件')
      })
    return () => { active = false }
  }, [promptLibrary, selectedFile])

  function startCreate(kind: PromptLibraryEntry['kind']) {
    const parentPath = selectedEntry?.kind === 'directory'
      ? selectedEntry.path
      : promptParentPath(selectedPath)
    setCollapsed((current) => expandPath(current, parentPath))
    setTreeEdit({ mode: 'create', kind, parentPath, value: '' })
    setNotice('')
  }

  function startRename(entry: PromptLibraryEntry | PromptFileRow | null = selectedEntry) {
    if (!entry) return
    setCollapsed((current) => expandPath(current, promptParentPath(entry.path)))
    setTreeEdit({
      mode: 'rename',
      kind: entry.kind,
      parentPath: promptParentPath(entry.path),
      sourcePath: entry.path,
      value: promptEntryName(entry.path),
    })
    setNotice('')
  }

  async function submitTreeEdit() {
    if (!treeEdit) return
    let targetPath = ''
    try {
      targetPath = joinPromptPath(
        treeEdit.parentPath,
        normalizedEntryName(treeEdit.value, treeEdit.kind),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '名称无效')
      return
    }
    setBusy(true)
    try {
      const library = promptLibrary
      let preferredSelection = targetPath
      let preferredFile = selectedFile
      if (treeEdit.mode === 'create') {
        if (treeEdit.kind === 'directory') await library.createDirectory(targetPath)
        else {
          await library.create(targetPath, serializePromptDocument(emptyDocument))
          preferredFile = targetPath
        }
      } else if (treeEdit.sourcePath) {
        await library.rename(treeEdit.sourcePath, targetPath)
        preferredSelection = rebasePromptPath(selectedPath, treeEdit.sourcePath, targetPath)
        preferredFile = rebasePromptPath(selectedFile, treeEdit.sourcePath, targetPath)
        setCollapsed((current) => new Set([...current].map((path) => (
          rebasePromptPath(path, treeEdit.sourcePath!, targetPath)
        ))))
      }
      await refreshEntries(preferredSelection, preferredFile)
      setTreeEdit(null)
      setDraft(null)
      setNotice(treeEdit.mode === 'create'
        ? treeEdit.kind === 'directory' ? '目录已创建' : '文件已创建'
        : '名称已更新')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法更新提示词库')
    } finally {
      setBusy(false)
    }
  }

  async function deleteEntry(entry: PromptLibraryEntry | PromptFileRow | null = selectedEntry) {
    if (!entry) return
    const message = entry.kind === 'directory'
      ? `永久删除目录“${entry.path}”及其中全部内容吗？`
      : `永久删除文件“${entry.path}”吗？`
    if (!window.confirm(message)) return
    setBusy(true)
    try {
      const fileAffected = selectedFile === entry.path || selectedFile.startsWith(`${entry.path}/`)
      await promptLibrary.delete(entry.path)
      await refreshEntries(undefined, fileAffected ? '' : selectedFile)
      setCollapsed((current) => new Set([...current].filter((path) => (
        path !== entry.path && !path.startsWith(`${entry.path}/`)
      ))))
      setTreeEdit(null)
      setDraft(null)
      setNotice(entry.kind === 'directory' ? '目录已删除' : '文件已删除')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法删除提示词条目')
    } finally {
      setBusy(false)
    }
  }

  async function moveEntry(sourcePath: string, targetDirectory: string) {
    if (!canMovePromptPath(sourcePath, targetDirectory)) return
    const targetPath = promptMoveTarget(sourcePath, targetDirectory)
    setBusy(true)
    try {
      await promptLibrary.rename(sourcePath, targetPath)
      const preferredSelection = rebasePromptPath(selectedPath, sourcePath, targetPath)
      const preferredFile = rebasePromptPath(selectedFile, sourcePath, targetPath)
      setCollapsed((current) => new Set([...current].map((path) => (
        rebasePromptPath(path, sourcePath, targetPath)
      ))))
      await refreshEntries(preferredSelection, preferredFile)
      setNotice(`已移动到 ${targetDirectory || 'Prompt Library'}`)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法移动提示词条目')
    } finally {
      setBusy(false)
      setDraggedPath('')
      setDropTargetPath(null)
    }
  }

  function beginDrag(event: DragEvent<HTMLElement>, path: string) {
    if (busy || treeEdit) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-graphvideo-prompt-entry', path)
    setDraggedPath(path)
    setSelectedPath(path)
  }

  function allowDirectoryDrop(event: DragEvent<HTMLElement>, directoryPath: string) {
    event.stopPropagation()
    if (!canMovePromptPath(draggedPath, directoryPath)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetPath(directoryPath)
    setCollapsed((current) => expandPath(current, directoryPath))
  }

  async function persist(nextDocument: PromptDocument, message: string) {
    if (!selectedFile) return
    setBusy(true)
    try {
      await promptLibrary.save(selectedFile, serializePromptDocument(nextDocument))
      setDocument(nextDocument)
      setDraft(null)
      setNotice(message)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存提示词文件')
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    if (!draft?.content.trim()) return
    const blocks = [...document.blocks]
    const block = { content: draft.content.trim() }
    if (draft.index >= blocks.length) blocks.push(block)
    else blocks[draft.index] = block
    await persist({ ...document, blocks }, draft.index >= document.blocks.length ? '已新增词条' : '已更新词条')
  }

  async function deletePromptBlock(index: number) {
    const block = document.blocks[index]
    if (!block || !window.confirm(`确定删除第 ${index + 1} 条提示词吗？`)) return
    await persist({ ...document, blocks: document.blocks.filter((_, itemIndex) => itemIndex !== index) }, '已删除词条')
  }

  async function copyEntry(block: PromptBlock, index: number) {
    try {
      await shell.clipboard.writeText(block.content)
      setNotice(`已复制第 ${index + 1} 条提示词`)
      setError('')
      setCopiedIndex(index)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopiedIndex(null), 1800)
    } catch (err: any) {
      setError(err?.message || '无法写入剪贴板')
    }
  }

  function selectRow(row: PromptFileRow) {
    setSelectedPath(row.path)
    setTreeEdit(null)
    setNotice('')
    if (row.kind === 'file') {
      setSelectedFile(row.path)
      setDraft(null)
      return
    }
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(row.path)) next.delete(row.path)
      else next.add(row.path)
      return next
    })
  }

  return (
    <section className="panel panel-prompt-library" data-instance-id={instanceId}>
      {!isSidebarCollapsed && (
        <>
          <aside className="prompt-file-column" style={{ width: sidebarWidth }}>
            <header>
              <LibraryBig size={14} /><span>PROMPT LIBRARY</span>
              <button type="button" title="新建文件" disabled={busy} onClick={() => startCreate('file')}><FilePlus2 size={13} /></button>
              <button type="button" title="新建目录" disabled={busy} onClick={() => startCreate('directory')}><FolderPlus size={13} /></button>
              <button type="button" title="刷新" disabled={busy} onClick={() => void reloadEntries()}><RefreshCw size={13} /></button>
              <button type="button" title="全部折叠" onClick={() => setCollapsed(new Set(fileRows.filter((row) => row.kind === 'directory').map((row) => row.path)))}><ChevronsUp size={13} /></button>
              <button type="button" title="折叠目录" onClick={() => setIsSidebarCollapsed(true)}><PanelLeftClose size={13} /></button>
            </header>
            <div
              className={`prompt-file-list ${dropTargetPath === '' ? 'is-root-drop-target' : ''}`}
              onDragOver={(event) => {
                if (!canMovePromptPath(draggedPath, '')) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTargetPath('')
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedPath) void moveEntry(draggedPath, '')
              }}
              onKeyDown={(event) => {
                if (treeEdit) return
                if (event.key === 'F2' && selectedEntry) { event.preventDefault(); startRename() }
                if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEntry) { event.preventDefault(); void deleteEntry() }
              }}
            >
              {explorerRows.map((item) => item.kind === 'edit' ? (
                <div className="prompt-tree-edit-row" style={{ paddingLeft: 7 + item.depth * 13 }} key={item.key}>
                  {treeEdit?.kind === 'directory' ? <Folder size={13} /> : <FileText size={13} />}
                  <input
                    autoFocus
                    spellCheck={false}
                    value={treeEdit?.value ?? ''}
                    onFocus={(event) => {
                      if (treeEdit?.mode !== 'rename') return
                      const extensionIndex = treeEdit.kind === 'file' ? event.currentTarget.value.lastIndexOf('.') : -1
                      event.currentTarget.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : event.currentTarget.value.length)
                    }}
                    onChange={(event) => setTreeEdit((current) => current ? { ...current, value: event.target.value } : current)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); void submitTreeEdit() }
                      if (event.key === 'Escape') setTreeEdit(null)
                    }}
                  />
                </div>
              ) : (
                <div
                  className={`prompt-tree-row ${item.row.kind === 'directory' ? 'is-directory' : 'is-file'} ${item.row.path === selectedPath ? 'is-selected' : ''} ${item.row.path === selectedFile ? 'is-open' : ''} ${item.row.path === dropTargetPath ? 'is-drop-target' : ''}`}
                  style={{ paddingLeft: 4 + item.row.depth * 13 }}
                  key={item.row.path}
                  draggable={!busy && !treeEdit}
                  aria-grabbed={item.row.path === draggedPath}
                  onDragStart={(event) => beginDrag(event, item.row.path)}
                  onDragEnd={() => { setDraggedPath(''); setDropTargetPath(null) }}
                  onDragOver={(event) => {
                    if (item.row.kind === 'directory') allowDirectoryDrop(event, item.row.path)
                    else event.stopPropagation()
                  }}
                  onDrop={(event) => {
                    event.stopPropagation()
                    if (item.row.kind === 'directory' && draggedPath) {
                      event.preventDefault()
                      void moveEntry(draggedPath, item.row.path)
                    }
                  }}
                >
                  <button className="prompt-tree-main" type="button" title={item.row.path} onClick={() => selectRow(item.row)}>
                    {item.row.kind === 'directory'
                      ? collapsed.has(item.row.path) ? <ChevronRight size={12} /> : <ChevronDown size={12} />
                      : <span className="prompt-tree-chevron-spacer" />}
                    {item.row.kind === 'directory'
                      ? collapsed.has(item.row.path) ? <Folder size={13} /> : <FolderOpen size={13} />
                      : <FileText size={13} />}
                    <span>{item.row.name}</span>
                  </button>
                  <span className="prompt-tree-actions">
                    <button type="button" title="重命名 (F2)" onClick={() => startRename(item.row)}><Pencil size={11} /></button>
                    <button type="button" title="删除 (Delete)" onClick={() => void deleteEntry(item.row)}><Trash2 size={11} /></button>
                  </span>
                </div>
              ))}
              {entries.length === 0 && !treeEdit && <p>还没有提示词文件或目录</p>}
            </div>
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整目录宽度"
            className={`prompt-splitter ${resizing ? 'is-resizing' : ''}`}
            onPointerDown={beginSidebarResize}
            onPointerMove={moveSidebarResize}
            onPointerUp={endSidebarResize}
            onPointerCancel={endSidebarResize}
            onDoubleClick={handleSplitterDoubleClick}
          />
        </>
      )}
      <main className="prompt-entry-page">
        <div className="prompt-entry-toolbar">
          {isSidebarCollapsed && (
            <button
              type="button"
              className="prompt-expand-sidebar-button"
              title="展开目录"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <PanelLeftOpen size={13} />
            </button>
          )}
          <div><strong>{selectedFile ? fileTitle(selectedFile) : '提示词库'}</strong><span>{selectedFile}</span></div>
          {notice && <em><Check size={12} />{notice}</em>}
          {document.blocks.length > 0 && (
            <button
              type="button"
              title={collapsedCards.size >= document.blocks.length ? '全部展开词条' : '全部折叠词条'}
              onClick={toggleAllCards}
            >
              <ChevronsUp size={13} />
              {collapsedCards.size >= document.blocks.length ? '展开全部' : '折叠全部'}
            </button>
          )}
          <button type="button" disabled={!selectedFile || busy} onClick={() => setDraft({ index: document.blocks.length, content: '' })}><Plus size={13} />新增提示词</button>
        </div>
        <div className="prompt-entry-scroll">
          {document.blocks.map((block, index) => {
            const isCardCollapsed = collapsedCards.has(index)
            return (
              <article className={`prompt-entry-card ${isCardCollapsed ? 'is-collapsed' : ''}`} key={index}>
                <header>
                  <button
                    type="button"
                    className="prompt-card-toggle"
                    title={isCardCollapsed ? '展开词条' : '折叠词条'}
                    onClick={() => toggleCardCollapse(index)}
                  >
                    {isCardCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <span className="prompt-entry-index" onClick={() => toggleCardCollapse(index)}>{`<prompt> ${String(index + 1).padStart(2, '0')}`}</span>
                  <button type="button" title="复制词条" onClick={() => void copyEntry(block, index)}>
                    {copiedIndex === index ? <Check size={13} style={{ color: 'var(--state-success-fg)' }} /> : <Copy size={13} />}
                  </button>
                  <button type="button" title="编辑词条" onClick={() => setDraft({ index, ...block })}><Pencil size={13} /></button>
                  <button type="button" title="删除词条" onClick={() => void deletePromptBlock(index)}><Trash2 size={13} /></button>
                </header>
                {!isCardCollapsed && (
                  <button
                    className="prompt-rendered-content"
                    type="button"
                    title="打开并编辑词条"
                    onClick={() => setDraft({ index, ...block })}
                  >
                    {block.content}
                  </button>
                )}
              </article>
            )
          })}
          {selectedFile && document.blocks.length === 0 && <button className="prompt-empty-entry" type="button" onClick={() => setDraft({ index: 0, content: '' })}><Plus size={20} /><strong>创建第一条提示词</strong></button>}
          {!selectedFile && <div className="prompt-library-welcome"><LibraryBig size={34} />从左侧创建或选择提示词文件</div>}
        </div>
        {draft && (
          <LargeTextEditorDialog
            busy={busy}
            label="自然语言描述"
            title={draft.index >= document.blocks.length ? '新增提示词' : `编辑提示词 ${String(draft.index + 1).padStart(2, '0')}`}
            value={draft.content}
            saveDisabled={!draft.content.trim()}
            saveLabel="保存提示词"
            onChange={(content) => setDraft({ ...draft, content })}
            onClose={() => setDraft(null)}
            onSave={saveDraft}
          />
        )}
        {error && <div className="prompt-library-error" role="alert">{error}</div>}
      </main>
    </section>
  )
}
