import {
  Box, Check, ChevronDown, ChevronRight, ChevronsUp, CircleAlert, ClipboardPaste, Copy,
  Download, FilePlus2,
  FileQuestion, FileText, FileWarning, Film, Folder, FolderPlus, Image,
  IndentDecrease, IndentIncrease, ListFilter, Music2, Palette, Pencil,
  Search, Sparkles, Trash2, Rocket, RotateCcw, RefreshCw, Volume2, Square, CheckCircle2,
  Pause, Play, Settings2, X
} from 'lucide-react'
import {
  useCallback, useEffect, useMemo, useState, type DragEvent, type ElementType, type KeyboardEvent,
} from 'react'
import {
  copyProjectTreeItem, flattenProjectTree, parseGenerationPrompt, useAppState, useApplicationClient,
  useClientSelectionActions, useElementState, useSelectedNodeId,
  usesTextPayload, type NodeType,
  type PanelProps, type ProjectNode, type ProjectTreeDropPosition,
  type ProjectTreeClipboardItem, type ProjectTreeEditOperation, type ProjectTreeItem,
} from '@graphvideo/client-sdk'
import { focusKeyAfterTreeEdit, resolveOutlinerSelection } from './outlinerSelection'
import { orderedVideoNodeIds } from './videoExportSelection'
import { useLaunchpadPipeline } from '../generation/useLaunchpadPipeline'
import type { LaunchpadItem } from '@graphvideo/domain'

const typeIcons: Record<NodeType, ElementType> = {
  text: FileText, image: Image, video: Film, audio: Music2, style: Palette,
}

const typeLabels: Record<NodeType, string> = {
  text: '文本', image: '图片', video: '视频', audio: '音频', style: '风格',
}

interface TreeEdit {
  mode: 'create' | 'rename'
  kind: ProjectTreeItem['kind']
  parentKey: string | null
  sourceKey?: string
  nodeType: NodeType
  value: string
}

interface DropTarget {
  key: string | null
  position: ProjectTreeDropPosition
}

type ExplorerRow =
  | { kind: 'item'; item: ProjectTreeItem }
  | { kind: 'edit'; depth: number; key: string }

function nodeProgress(node: ProjectNode | undefined) {
  if (!node) return {
    done: 0, total: 2, generated: false, modelId: null, yamlStatus: null,
  }
  const textual = usesTextPayload(node.type)
  const ownContent = textual ? node.content : node.prompt
  let modelId: string | null = null
  let yamlStatus: 'missing' | 'invalid' | 'model-missing' | null = null
  if (!textual) {
    try {
      const document = parseGenerationPrompt(node.prompt ?? '')
      modelId = document.modelId
      if (!document.hasFrontMatter) yamlStatus = 'missing'
      else if (!document.modelId) yamlStatus = 'model-missing'
    } catch {
      yamlStatus = 'invalid'
    }
  }
  return {
    done: Number(Boolean(node.description?.trim())) + Number(Boolean(ownContent?.trim())),
    total: 2,
    generated: !textual && Boolean(node.history?.length),
    modelId,
    yamlStatus,
  }
}

const yamlStatusLabels = {
  missing: {
    label: '缺少 YAML 头部',
    icon: FileQuestion,
    title: '未声明模型 YAML 头部，在发射台将被视为手动网页生成任务',
  },
  invalid: {
    label: 'YAML 头部语法错误',
    icon: FileWarning,
    title: 'YAML 头部解析失败，请检查 --- 分隔符与语法',
  },
  'model-missing': {
    label: '缺少 model 字段',
    icon: FileWarning,
    title: 'YAML 头部已声明但缺少 model 字段',
  },
} as const

interface TreeRowProps {
  item: ProjectTreeItem
  node?: ProjectNode
  selected: boolean
  focused: boolean
  collapsed: boolean
  dragged: boolean
  dropPosition?: ProjectTreeDropPosition
  lpItem?: LaunchpadItem
  running?: boolean
  onSelect(): void
  onToggle(): void
  onDragStart(event: DragEvent<HTMLDivElement>): void
  onDragEnd(): void
  onDragOver(event: DragEvent<HTMLDivElement>): void
  onDrop(event: DragEvent<HTMLDivElement>): void
  onExecute?(): void
  onCopyPrompt?(): void
  onCopyDeps?(): void
  onReset?(): void
}

function TreeRow({
  item,
  node,
  selected,
  focused,
  collapsed,
  dragged,
  dropPosition,
  lpItem,
  running,
  onSelect,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onExecute,
  onCopyPrompt,
  onCopyDeps,
  onReset,
}: TreeRowProps) {
  const TypeIcon = item.kind === 'structure' ? Folder : typeIcons[item.nodeType ?? 'text']
  const progress = nodeProgress(node)
  const isMedia = item.kind === 'node' && item.nodeType && !usesTextPayload(item.nodeType)
  const hasChildren = item.children.length > 0

  return (
    <div
      className={`tree-row ${selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''} ${dropPosition ? `is-drop-${dropPosition}` : ''}`}
      style={{ paddingLeft: `${item.depth * 14 + 6}px` }}
      draggable
      aria-selected={selected}
      aria-grabbed={dragged}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button className="tree-row-main" type="button" title={`节点 ID: ${item.nodeId || item.key}`} onClick={onSelect}>
        <span
          className={`tree-disclosure ${hasChildren ? '' : 'is-empty'}`}
          onClick={(event) => { event.stopPropagation(); if (hasChildren) onToggle() }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <TypeIcon className={`tree-type-icon type-${item.nodeType ?? 'structure'}`} size={14} />
        <span className="tree-title">{item.title}</span>
        {item.kind === 'node' && item.nodeType && (
          <span className="tree-meta">
            {lpItem && (
              <span className="launchpad-layer-pill" title={`生成依赖层级: Layer ${lpItem.layer}`}>
                L{lpItem.layer}
              </span>
            )}
            {progress.modelId ? (
              <span className="tree-model" title={`生成模型：${progress.modelId}`}>{progress.modelId}</span>
            ) : isMedia && lpItem?.dispatchMode === 'manual-web' ? (
              <span className="tree-model is-manual-tag" title="网页手动任务">手动</span>
            ) : null}

            {progress.yamlStatus && !progress.modelId && (() => {
              const status = yamlStatusLabels[progress.yamlStatus]
              const StatusIcon = status.icon
              return (
                <span className="tree-yaml-warning" title={status.title} aria-label={status.label}>
                  <StatusIcon size={13} aria-hidden="true" />
                </span>
              )
            })()}

            {/* 状态点与指示器 */}
            {lpItem?.status === 'running' ? (
              <span title="生成中..."><RefreshCw size={11} className="spin text-blue" /></span>
            ) : lpItem?.status === 'error' ? (
              <span title={lpItem.statusMessage || '生成异常'}><CircleAlert className="meta-warning text-red" size={12} /></span>
            ) : lpItem?.status === 'manual_waiting' ? (
              <span title="等待手工生成"><CircleAlert className="meta-warning" size={12} /></span>
            ) : lpItem?.status === 'completed' || progress.generated ? (
              <span className="tree-meta-completed" title="节点资产已生成">
                <Rocket size={12} strokeWidth={2.6} className="meta-generated-rocket" />
              </span>
            ) : (
              <span className={`progress-dots progress-${progress.done}`}><i /><i /></span>
            )}
          </span>
        )}
      </button>
      <span className="tree-row-actions">
        {isMedia && (
          <>
            {lpItem?.status === 'error' && onReset && (
              <button type="button" title="重置生成异常状态" onClick={onReset}><RotateCcw size={13} /></button>
            )}
            {onCopyPrompt && <button type="button" title="复制提示词" onClick={onCopyPrompt}><Copy size={13} /></button>}
            {onCopyDeps && lpItem?.dispatchMode === 'manual-web' && <button type="button" title="复制已就绪的媒体依赖文件，用于网页端上传" onClick={onCopyDeps}><ClipboardPaste size={13} /></button>}
            {onExecute && lpItem?.dispatchMode === 'model' && (
              (lpItem?.status === 'completed' || progress.generated) ? (
                // 仅对具备自动化模型声明的节点展示重新生成按钮；手动/导入任务不展示
                (lpItem?.hasHeader || progress.modelId) ? (
                  <button
                    type="button"
                    className="action-regenerate"
                    disabled={running || (Boolean(lpItem) && !lpItem?.isReady)}
                    title={lpItem && !lpItem.isReady ? lpItem.statusMessage : '重新生成该项资产'}
                    onClick={onExecute}
                  >
                    <RotateCcw size={13} strokeWidth={2.2} />
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  className="action-launch"
                  disabled={running || (Boolean(lpItem) && !lpItem?.isReady)}
                  title={lpItem && !lpItem.isReady ? lpItem.statusMessage : '单项发射生成'}
                  onClick={onExecute}
                >
                  <Rocket size={13} strokeWidth={2.2} />
                </button>
              )
            )}
          </>
        )}
      </span>
    </div>
  )
}

export function OutlinerPanel({ runtime, instanceId, workspaceId }: PanelProps) {
  const application = useApplicationClient()
  const project = useAppState((state) => state.project)
  const [collapsedIds, setCollapsedIds] = useElementState<string[]>(runtime, 'collapsed', { workspaceId })
  const selectedNodeId = useSelectedNodeId()
  const { selectNode } = useClientSelectionActions()
  const isMac = typeof navigator !== 'undefined'
    ? /Mac|iPod|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
    : false

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | NodeType>('all')
  const [draggedKey, setDraggedKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [treeEdit, setTreeEdit] = useState<TreeEdit | null>(null)
  const [focusedKey, setFocusedKey] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [clipboard, setClipboard] = useState<ProjectTreeClipboardItem | null>(null)
  const focusEditInput = useCallback((input: HTMLInputElement | null) => {
    input?.focus()
    input?.select()
  }, [])

  // 统一的生成调度与流水线引擎
  const pipeline = useLaunchpadPipeline()

  // 弹窗状态管理
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    title: string
    targetItems: LaunchpadItem[]
    totalCredits: number
    action: () => void
  } | null>(null)

  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [tempBudgetInput, setTempBudgetInput] = useState(String(pipeline.maxBudget))
  const [tempWaitMinutesInput, setTempWaitMinutesInput] = useState(
    String(pipeline.maxGenerationWaitMinutes),
  )

  useEffect(() => {
    setTempBudgetInput(String(pipeline.maxBudget))
  }, [pipeline.maxBudget])

  useEffect(() => {
    setTempWaitMinutesInput(String(pipeline.maxGenerationWaitMinutes))
  }, [pipeline.maxGenerationWaitMinutes])

  const collapsedSet = useMemo(() => new Set(collapsedIds), [collapsedIds])
  const flattenedTree = useMemo(() => flattenProjectTree(project.tree), [project.tree])

  const selectedItemKey = useMemo(() => {
    if (selectedNodeId) {
      const matched = flattenedTree.find((item) => item.nodeId === selectedNodeId)
      if (matched) return matched.key
    }
    return focusedKey || null
  }, [flattenedTree, selectedNodeId, focusedKey])

  const selectedItem = useMemo(() => {
    if (!selectedItemKey) return null
    return flattenedTree.find((item) => item.key === selectedItemKey) ?? null
  }, [flattenedTree, selectedItemKey])

  const videoNodeIds = useMemo(() => orderedVideoNodeIds(project.tree, project.nodes), [project.tree, project.nodes])

  function findNodeForItem(item: ProjectTreeItem): ProjectNode | undefined {
    if (item.nodeId && project.nodes[item.nodeId]) return project.nodes[item.nodeId]
    const candidates = Object.values(project.nodes)
    const exactTitle = candidates.find((n) => n.title === item.title && (!item.nodeType || n.type === item.nodeType))
    if (exactTitle) return exactTitle
    return candidates.find((n) => n.title === item.title)
  }

  function matchesFilter(item: ProjectTreeItem): boolean {
    if (typeFilter !== 'all') {
      if (item.kind !== 'node' || item.nodeType !== typeFilter) return false
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      return item.title.toLowerCase().includes(q)
    }
    return true
  }

  const explorerRows = useMemo(() => {
    const rows: ExplorerRow[] = []
    const visibleKeys = new Set<string>()

    function collect(item: ProjectTreeItem, parentVisible: boolean) {
      const selfMatches = matchesFilter(item)
      const isCollapsed = collapsedSet.has(item.key)

      if (parentVisible && (selfMatches || search || typeFilter !== 'all')) {
        visibleKeys.add(item.key)
        rows.push(treeEdit?.mode === 'rename' && treeEdit.sourceKey === item.key
          ? { kind: 'edit', depth: item.depth, key: `__rename_${item.key}` }
          : { kind: 'item', item })
      }

      if (treeEdit && treeEdit.mode === 'create' && treeEdit.parentKey === item.key) {
        rows.push({ kind: 'edit', depth: item.depth + 1, key: `__edit_${item.key}` })
      }

      if (!isCollapsed || search || typeFilter !== 'all') {
        for (const child of item.children) {
          collect(child, parentVisible)
        }
      }
    }

    for (const item of project.tree) {
      if (item.depth === 0) {
        collect(item, true)
      }
    }

    if (treeEdit && treeEdit.mode === 'create' && treeEdit.parentKey === null) {
      rows.push({ kind: 'edit', depth: 0, key: '__edit_root' })
    }

    return rows
  }, [project.tree, collapsedSet, search, typeFilter, treeEdit])

  async function executeEdit(operation: ProjectTreeEditOperation, notice: string) {
    setBusy(true)
    try {
      await application.project.editTree(operation)
      const nextFocus = focusKeyAfterTreeEdit(operation, focusedKey)
      if (nextFocus) setFocusedKey(nextFocus)
      pipeline.setNotice(notice)
      setTimeout(() => pipeline.setNotice(''), 3000)
    } catch (err: any) {
      pipeline.setNotice(`操作失败: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function startCreate(kind: 'node' | 'structure') {
    const parentKey = selectedItem ? selectedItem.key : null
    setTreeEdit({
      mode: 'create',
      kind,
      parentKey,
      nodeType: 'image',
      value: kind === 'structure' ? '新目录' : '新节点',
    })
  }

  function startRename() {
    if (!selectedItem) return
    setTreeEdit({
      mode: 'rename',
      kind: selectedItem.kind,
      parentKey: null,
      sourceKey: selectedItem.key,
      nodeType: selectedItem.nodeType || 'image',
      value: selectedItem.title,
    })
  }

  async function submitTreeEdit() {
    if (!treeEdit || !treeEdit.value.trim()) {
      setTreeEdit(null)
      return
    }
    const val = treeEdit.value.trim()
    if (treeEdit.mode === 'create') {
      if (treeEdit.kind === 'structure') {
        await executeEdit({
          type: 'create',
          parentKey: treeEdit.parentKey,
          kind: 'structure',
          title: val,
        }, `已新建目录【${val}】`)
      } else {
        const generatedNodeId = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        await executeEdit({
          type: 'create',
          parentKey: treeEdit.parentKey,
          kind: 'node',
          title: val,
          nodeType: treeEdit.nodeType,
          nodeId: generatedNodeId,
        }, `已新建节点【${val}】`)
      }
    } else if (treeEdit.mode === 'rename' && treeEdit.sourceKey) {
      await executeEdit({
        type: 'rename',
        key: treeEdit.sourceKey,
        title: val,
      }, `已重命名为【${val}】`)
    }
    setTreeEdit(null)
  }

  function deleteItem() {
    if (!selectedItem) return
    void executeEdit({
      type: 'delete',
      key: selectedItem.key,
    }, `已删除【${selectedItem.title}】`)
  }

  function copySelectedItem() {
    if (!selectedItem) return
    const copied = copyProjectTreeItem(project.tree, selectedItem.key)
    setClipboard(copied)
    pipeline.setNotice(`已复制【${selectedItem.title}】`)
    setTimeout(() => pipeline.setNotice(''), 2500)
  }

  function pasteCopiedItem() {
    if (!clipboard) return
    void executeEdit({
      type: 'paste',
      targetKey: selectedItem?.key || null,
      item: clipboard,
    }, `已粘贴项目项`)
  }

  function adjustItemDepth(direction: 'left' | 'right', includeChildren: boolean) {
    if (!selectedItem) return
    void executeEdit({
      type: 'adjust-depth',
      key: selectedItem.key,
      direction,
      includeChildren,
    }, `已${direction === 'left' ? '提升' : '缩进'}层级`)
  }

  async function exportVideos() {
    if (!videoNodeIds.length) return
    setBusy(true)
    try {
      const res = await application.assets.exportVideos(videoNodeIds)
      if (!res.canceled) {
        if (res.skipped.length) {
          const details = res.skipped.map((item) => `${item.title}：${item.reason}`).join('；')
          pipeline.setNotice(`导出完成：成功 ${res.exported.length} 个，未导出 ${res.skipped.length} 个。${details}`)
        } else if (res.exported.length) {
          pipeline.setNotice(`✅ 已成功导出 ${res.exported.length} 个视频！`)
        } else {
          pipeline.setNotice('未导出视频，请确认节点有可用的当前视频版本。')
        }
      }
    } catch (err: any) {
      pipeline.setNotice(`导出失败: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (treeEdit) return
    if (event.key === 'F2') {
      event.preventDefault()
      startRename()
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteItem()
    } else if (event.key === 'c' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      copySelectedItem()
    } else if (event.key === 'v' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      pasteCopiedItem()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      adjustItemDepth('left', event.shiftKey)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      adjustItemDepth('right', event.shiftKey)
    }
  }

  // 弹窗确认触发逻辑 (严格仅包含当前已就绪的自动化任务；一次只发射一批)
  function triggerLaunchAllConfirm() {
    const readyItems = pipeline.items
      .filter((it) => it.status !== 'completed' && it.isReady)
      .sort((a, b) => a.layer - b.layer)

    if (readyItems.length === 0) {
      const remainingAutomated = pipeline.items.filter((it) => it.status !== 'completed' && it.hasHeader && Boolean(it.modelId))
      if (remainingAutomated.length === 0) {
        pipeline.setNotice('✅ 全量自动化模型任务已全部生成完毕！')
      } else {
        pipeline.setNotice('⚠️ 当前暂无满足前置依赖的就绪任务（等待前置依赖或手动素材就绪）')
      }
      return
    }

    const totalCredits = Math.round(readyItems.reduce((sum, it) => sum + (it.estimatedCredits ?? (it.type === 'video' ? 20 : (it.type === 'audio' ? 0 : 10))), 0) * 100) / 100
    setConfirmModal({
      open: true,
      title: `确认发射本批就绪任务 (共 ${readyItems.length} 项)`,
      targetItems: readyItems,
      totalCredits,
      action: () => {
        setConfirmModal(null)
        void pipeline.startPipeline('auto')
      },
    })
  }

  function triggerLaunchLayerConfirm(layer: number) {
    const targetItems = pipeline.items.filter((it) => it.layer === layer && it.status !== 'completed' && it.isReady)
    if (targetItems.length === 0) {
      pipeline.setNotice(`✅ Layer ${layer} 所有自动化模型任务已全部完成！`)
      return
    }
    const totalCredits = Math.round(targetItems.reduce((sum, it) => sum + (it.estimatedCredits ?? (it.type === 'video' ? 20 : (it.type === 'audio' ? 0 : 10))), 0) * 100) / 100
    setConfirmModal({
      open: true,
      title: `确认发射 Layer ${layer} 批量任务`,
      targetItems,
      totalCredits,
      action: () => {
        setConfirmModal(null)
        void pipeline.startLayerPipeline(layer)
      },
    })
  }

  function saveBudgetSetting() {
    const budget = Number(tempBudgetInput)
    if (!isNaN(budget) && budget >= 0) {
      pipeline.setMaxBudget(budget)
    }
    const waitMinutes = Number(tempWaitMinutesInput)
    if (Number.isFinite(waitMinutes) && waitMinutes >= 0 && waitMinutes <= 1440) {
      pipeline.setMaxGenerationWaitMinutes(waitMinutes)
    }
    setBudgetModalOpen(false)
  }

  return (
    <section className="panel panel-outliner" data-instance-id={instanceId}>
      {/* 1. 结构与大纲操作工具栏 */}
      <div className="outliner-toolbar">
        <div className="outliner-action-row">
          <div className="outliner-search">
            <Search size={13} />
            <input
              type="text"
              placeholder="搜索项目项…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="outliner-action-group">
            <ListFilter size={13} className="text-secondary" />
            <select
              className="outliner-type-filter"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as NodeType | 'all')}
            >
              <option value="all">全部类型</option>
              {(Object.keys(typeLabels) as NodeType[]).map((type) => (
                <option value={type} key={type}>{typeLabels[type]}</option>
              ))}
            </select>
          </div>

          <span className="outliner-divider" />

          <div className="outliner-action-group">
            <button type="button" title="在当前项内新建节点" disabled={busy || !project.localPath} onClick={() => startCreate('node')}><FilePlus2 size={13} />节点</button>
            <button type="button" title="在当前项内新建目录" disabled={busy || !project.localPath} onClick={() => startCreate('structure')}><FolderPlus size={13} />目录</button>
            <button
              type="button"
              title={videoNodeIds.length ? `按项目目录顺序导出 ${videoNodeIds.length} 个当前视频` : '项目目录中没有视频节点'}
              disabled={busy || !project.localPath || videoNodeIds.length === 0}
              onClick={() => void exportVideos()}
            ><Download size={13} />导出</button>
          </div>

          <span className="outliner-divider" />

          <div className="outliner-action-group">
            <button type="button" title={isMac ? '复制当前项及子内容 (⌘C)' : '复制当前项及子内容 (Ctrl+C)'} disabled={busy || !selectedItem} onClick={copySelectedItem}><Copy size={12} /></button>
            <button type="button" title={isMac ? '粘贴到当前项之后 (⌘V)' : '粘贴到当前项之后 (Ctrl+V)'} disabled={busy || !clipboard} onClick={pasteCopiedItem}><ClipboardPaste size={12} /></button>
            <button type="button" title="当前项左移一层 (←；Shift+← 包含子内容)" disabled={busy || !selectedItem} onClick={() => adjustItemDepth('left', false)}><IndentDecrease size={12} /></button>
            <button type="button" title="当前项右移一层 (→；Shift+→ 包含子内容)" disabled={busy || !selectedItem} onClick={() => adjustItemDepth('right', false)}><IndentIncrease size={12} /></button>
            <button type="button" title="重命名 (F2)" disabled={busy || !selectedItem} onClick={() => startRename()}><Pencil size={12} /></button>
            <button type="button" title={isMac ? '删除 (Delete / ⌫)' : '删除 (Delete)'} disabled={busy || !selectedItem} onClick={() => deleteItem()}><Trash2 size={12} /></button>
            <button type="button" title="全部折叠" onClick={() => setCollapsedIds(project.tree.flatMap(function collect(item): string[] { return [item.key, ...item.children.flatMap(collect)] }))}><ChevronsUp size={12} /></button>
          </div>
        </div>
      </div>

      {/* 2. 独立成行的批量发射与发射中台控制条 (Dedicated Launchpad Control Row) */}
      <div className="outliner-launchpad-row">
        <div className="outliner-launchpad-left">
          <div
            className="outliner-budget-badge"
            title="点击修改积分预算与生成等待时间"
            onClick={() => setBudgetModalOpen(true)}
          >
            <span>⚡ 预算:</span>
            <strong>{pipeline.spentCredits}</strong>
            <span>/</span>
            <span>{pipeline.maxBudget} pt</span>
            <Settings2 size={11} style={{ marginLeft: 2, opacity: 0.7 }} />
          </div>

          <span className="outliner-divider" />

          {/* 分层批量发射按钮组 (L0, L1, L2...) */}
          <div className="outliner-launchpad-layers">
            {pipeline.layersSummary.map((layerInfo) => (
              <button
                key={`launch-layer-${layerInfo.layer}`}
                type="button"
                className={`outliner-btn-launch-layer ${layerInfo.ready === 0 ? 'is-completed' : ''}`}
                disabled={pipeline.isRunning || layerInfo.ready === 0}
                title={`批量发射 Layer ${layerInfo.layer} (${layerInfo.ready} 项通过预检 · ${layerInfo.completed}/${layerInfo.total} 完成${layerInfo.credits > 0 ? ` · 预估 ${layerInfo.credits}pt` : ''})`}
                onClick={() => triggerLaunchLayerConfirm(layerInfo.layer)}
              >
                L{layerInfo.layer} ({layerInfo.ready})
              </button>
            ))}
          </div>
        </div>

        <div className="outliner-launchpad-right">
          {pipeline.hasActiveErrors && !pipeline.isRunning && (
            <button
              type="button"
              className="outliner-btn-launch-layer"
              title="重置所有生成异常状态"
              onClick={pipeline.resetAllStatuses}
            >
              <RotateCcw size={11} /> 重置错误
            </button>
          )}

          {/* 运行态控制：暂停、继续、终止、全量发射 */}
          {pipeline.isRunning ? (
            <>
              {pipeline.currentRunningId && (
                <span className="outliner-running-badge">
                  <RefreshCw size={11} className="spin" />
                  {pipeline.currentRunningIds.length > 1
                    ? `${pipeline.currentRunningIds.length} 个媒体任务并行生成中`
                    : pipeline.itemsMap.get(pipeline.currentRunningId)?.title || '生成中...'}
                </span>
              )}
              {pipeline.isPaused ? (
                <button
                  type="button"
                  className="outliner-btn-resume"
                  title="恢复流水线执行"
                  onClick={pipeline.resumePipeline}
                >
                  <Play size={11} fill="currentColor" /> 继续
                </button>
              ) : (
                <button
                  type="button"
                  className="outliner-btn-pause"
                  title="暂停流水线（当前进行中的任务等待落盘完成）"
                  onClick={pipeline.pausePipeline}
                >
                  <Pause size={11} fill="currentColor" /> 暂停
                </button>
              )}
              <button
                type="button"
                className="outliner-btn-stop"
                title="立即终止所有发射任务"
                onClick={pipeline.cancelPipeline}
                disabled={!pipeline.canCancel}
              >
                <Square size={10} fill="currentColor" /> 终止
              </button>
            </>
          ) : (
            <button
              type="button"
              className="outliner-btn-launch-all"
              disabled={pipeline.readyCount === 0}
              title={pipeline.readyCount > 0 ? `发射 ${pipeline.readyCount} 个已通过预检的媒体任务` : '当前没有通过提示词、参数与依赖预检的任务'}
              onClick={triggerLaunchAllConfirm}
            >
              <Rocket size={12} /> 发射全量
            </button>
          )}
        </div>
      </div>

      {/* 3. 统计概要与状态提示 */}
      <div className="outliner-summary">
        <div className="outliner-summary-left">
          <span><Box size={12} /> {Object.keys(project.nodes).length} 节点</span>
          <span className="text-green"><CheckCircle2 size={11} /> {pipeline.completedCount} 完成</span>
          {pipeline.runningCount > 0 && <span className="text-blue"><RefreshCw size={11} className="spin" /> {pipeline.runningCount} 生成中</span>}
          {pipeline.errorCount > 0 && <span className="text-red"><CircleAlert size={11} /> {pipeline.errorCount} 异常</span>}
          {project.issues.length > 0 && <span className="has-issues">{project.issues.length} 问题</span>}
        </div>
        {pipeline.notice ? (
          <span className="outliner-pipeline-notice">{pipeline.notice}</span>
        ) : (
          <span className="outliner-budget">待耗: <strong>{pipeline.totalPlannedCredits} pt</strong> · 剩余: <strong>{pipeline.remainingCredits} pt</strong></span>
        )}
      </div>

      {/* 4. 树形大纲与逐项生成发射 */}
      <div
        className={`tree-scroll ${dropTarget?.key === null ? 'is-root-drop-target' : ''}`}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) { setFocusedKey(''); setTreeEdit(null) }
        }}
        onDragOver={(event) => {
          if (!draggedKey || event.target !== event.currentTarget) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTarget({ key: null, position: 'after' })
        }}
        onDrop={(event) => {
          if (dropTarget?.key !== null || !draggedKey) return
          event.preventDefault()
          void executeEdit({
            type: 'move', key: draggedKey, targetKey: null, position: 'after',
          }, '项目项已移动到列表末尾')
        }}
      >
        {explorerRows.map((row) => {
          if (row.kind === 'edit') return (
            <div
              key={row.key}
              className="tree-row is-editing"
              style={{ paddingLeft: `${row.depth * 14 + 6}px` }}
            >
              <input
                ref={focusEditInput}
                value={treeEdit?.value || ''}
                onChange={(event) => setTreeEdit((prev) => prev ? { ...prev, value: event.target.value } : null)}
                onBlur={() => void submitTreeEdit()}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter') void submitTreeEdit()
                  if (event.key === 'Escape') setTreeEdit(null)
                }}
              />
            </div>
          )

          const item = row.item
          const node = findNodeForItem(item)
          const lpItem = node?.id ? pipeline.itemsMap.get(node.id) : undefined

          // 全局同节点 / 通名节点多重引用高亮判断
          const isSelected = Boolean(
            (selectedItemKey && item.key === selectedItemKey) ||
            (selectedNodeId && (item.nodeId === selectedNodeId || node?.id === selectedNodeId)) ||
            (selectedItem && item.kind === 'node' && selectedItem.kind === 'node' && item.title === selectedItem.title && (!item.nodeType || !selectedItem.nodeType || item.nodeType === selectedItem.nodeType))
          )

          return (
            <TreeRow
              key={item.key}
              item={item}
              node={node}
              lpItem={lpItem}
              running={pipeline.isRunning}
              selected={isSelected}
              focused={item.key === focusedKey || item.key === selectedItemKey}
              collapsed={collapsedSet.has(item.key)}
              dragged={item.key === draggedKey}
              dropPosition={dropTarget?.key === item.key ? dropTarget.position : undefined}
              onSelect={() => {
                setFocusedKey(item.key)
                if (node?.id) {
                  selectNode(project.localPath, node.id)
                } else if (item.nodeId) {
                  selectNode(project.localPath, item.nodeId)
                }
              }}
              onToggle={() => {
                const next = new Set(collapsedSet)
                if (next.has(item.key)) next.delete(item.key)
                else next.add(item.key)
                setCollapsedIds(Array.from(next))
              }}
              onDragStart={(event) => {
                setDraggedKey(item.key)
                event.dataTransfer.setData('text/plain', item.key)
              }}
              onDragEnd={() => { setDraggedKey(null); setDropTarget(null) }}
              onDragOver={(event) => {
                if (!draggedKey || draggedKey === item.key) return
                event.preventDefault()
                const rect = event.currentTarget.getBoundingClientRect()
                const relY = event.clientY - rect.top
                let position: ProjectTreeDropPosition = 'after'
                if (relY < rect.height / 2) position = 'before'
                else position = 'after'
                setDropTarget({ key: item.key, position })
              }}
              onDrop={(event) => {
                if (!draggedKey || !dropTarget) return
                event.preventDefault()
                void executeEdit({
                  type: 'move',
                  key: draggedKey,
                  targetKey: dropTarget.key,
                  position: dropTarget.position,
                }, '项目项层级已调整')
              }}
              onExecute={lpItem ? () => void pipeline.executeSingleItem(lpItem) : undefined}
              onCopyPrompt={lpItem ? () => void pipeline.copyPromptText(lpItem) : undefined}
              onCopyDeps={lpItem ? () => void pipeline.copyDependencies(lpItem) : undefined}
              onReset={lpItem ? () => pipeline.resetItemStatus(lpItem.id) : undefined}
            />
          )
        })}
      </div>

      {/* 5. 发射确认弹窗 (Launch Confirmation Modal) */}
      {confirmModal?.open && (
        <div className="outliner-modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="outliner-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="outliner-modal-header">
              <h3>{confirmModal.title}</h3>
              <button
                type="button"
                className="generation-icon-action"
                onClick={() => setConfirmModal(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="outliner-modal-body">
              <p>即将按拓扑层级顺序调度执行以下 <strong>{confirmModal.targetItems.length}</strong> 个媒体任务：</p>
              <div className="outliner-modal-list">
                {confirmModal.targetItems.map((it) => {
                  const Icon = typeIcons[it.type] || Box
                  return (
                    <div className="outliner-modal-list-item" key={it.id}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Icon size={12} className={`type-${it.type}`} />
                        <strong>{it.title}</strong>
                        <span className="launchpad-layer-pill">L{it.layer}</span>
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {it.estimatedCredits ?? (it.type === 'video' ? 20 : (it.type === 'audio' ? 0 : 10))} pt
                      </span>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span>预估总消耗: <strong style={{ color: 'var(--accent)' }}>{confirmModal.totalCredits} pt</strong></span>
                <span>当前可用余额: <strong>{pipeline.remainingCredits} pt</strong></span>
              </div>
              {confirmModal.totalCredits > pipeline.remainingCredits && (
                <p style={{ color: 'var(--red)', marginTop: 8, fontSize: 11 }}>
                  ⚠️ 警告：预估积分超出可用余额，执行可能在中途熔断！
                </p>
              )}
            </div>
            <div className="outliner-modal-footer">
              <button
                type="button"
                className="outliner-modal-btn-cancel"
                onClick={() => setConfirmModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="outliner-modal-btn-confirm"
                onClick={confirmModal.action}
              >
                <Rocket size={12} /> 立即发射
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. 发射设置弹窗 */}
      {budgetModalOpen && (
        <div className="outliner-modal-overlay" onClick={() => setBudgetModalOpen(false)}>
          <div className="outliner-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="outliner-modal-header">
              <h3>发射设置</h3>
              <button
                type="button"
                className="generation-icon-action"
                onClick={() => setBudgetModalOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="outliner-modal-body">
              <div className="outliner-budget-field">
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
                  设置积分预算上限 (Credits Limit):
                </label>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={tempBudgetInput}
                  onChange={(e) => setTempBudgetInput(e.target.value)}
                  placeholder="例如: 500"
                />
              </div>

              <div className="outliner-budget-field">
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>
                  最大生成等待时间（分钟）:
                </label>
                <input
                  type="number"
                  min="0"
                  max="1440"
                  step="5"
                  value={tempWaitMinutesInput}
                  onChange={(e) => setTempWaitMinutesInput(e.target.value)}
                  placeholder="例如: 30"
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  0 表示不限制。这里限制的是生成任务的实际等待时间，不是视频成片时长。
                </div>
              </div>

              <div style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text)' }}>当前已累计消耗: <strong>{pipeline.spentCredits} pt</strong></div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>若重新开始计费，可一键重置已消耗计数</div>
                  </div>
                  <button
                    type="button"
                    className="outliner-btn-launch-layer"
                    onClick={() => {
                      pipeline.resetSpentCredits()
                      pipeline.setNotice('已成功重置已消耗积分！')
                    }}
                  >
                    <RotateCcw size={11} /> 重置已消耗
                  </button>
                </div>
              </div>
            </div>
            <div className="outliner-modal-footer">
              <button
                type="button"
                className="outliner-modal-btn-cancel"
                onClick={() => setBudgetModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="outliner-modal-btn-confirm"
                onClick={saveBudgetSetting}
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
