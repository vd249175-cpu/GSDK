import {
  ArrowUpToLine, Check, ChevronRight, CircleAlert, Copy, FileText, Film, FolderUp,
  GripHorizontal, History, Image, Info, Maximize2, Music2, Palette,
  Tag, WandSparkles, X,
} from 'lucide-react'
import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from 'react'
import {
  useAppState, useApplicationRevision, useApplicationClient, useElementState, useProjectAssetUrl,
  useSelectedNodeId, useShellClient,
  usesTextPayload,
  type GenerationModelManifest, type NodeType, type NodeVersion,
  type PanelProps, type ProjectNode,
} from '@graphvideo/client-sdk'
import { AudioPlayer, LargeTextEditorDialog } from '@graphvideo/sdk/ui'
import { resolveGenerationModelStatus } from './generationModelStatus'
import {
  useNodePropertyDraft, type NodePropertyField, type NodePropertyPatch,
} from './useNodePropertyDraft'

const typePresentation: Record<NodeType, { label: string; icon: typeof FileText; importLabel: string }> = {
  text: { label: '文本节点', icon: FileText, importLabel: '导入文本' },
  image: { label: '图片节点', icon: Image, importLabel: '导入图片' },
  video: { label: '视频节点', icon: Film, importLabel: '导入视频' },
  audio: { label: '音频节点', icon: Music2, importLabel: '导入音频' },
  style: { label: '风格节点', icon: Palette, importLabel: '导入风格文本' },
}

type ViewerState = { kind: 'image' | 'text'; title: string; source?: string; content?: string }
type TextEditorState = {
  field: NodePropertyField
  label: string
  title: string
  value: string
}

function FieldLabel({ icon: Icon, children }: { icon: typeof Info; children: ReactNode }) {
  return <span className="field-label"><Icon size={12} />{children}</span>
}

function PropertySection({
  title, className = '', count, open, onToggle, children,
}: {
  title: string
  className?: string
  count?: number
  open: boolean
  onToggle(): void
  children: ReactNode
}) {
  return (
    <section className={`property-section ${open ? 'is-open' : ''} ${className}`.trim()}>
      <button className="property-section-header" type="button" onClick={onToggle}>
        <ChevronRight className="section-chevron" size={13} />
        <span>{title}</span>
        {count !== undefined && <span className="section-count">{count}</span>}
        <GripHorizontal className="section-grip" size={13} />
      </button>
      {open && <div className="property-section-body">{children}</div>}
    </section>
  )
}

function IconButton({ title, disabled = false, onClick, children }: {
  title: string
  disabled?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <button className="asset-icon-button" type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

async function readTextVersion(
  source: string,
) {
  const response = await fetch(source)
  if (!response.ok) throw new Error('无法读取文本版本')
  return response.text()
}

function TextVersionPreview({
  version, source,
}: { version: NodeVersion; source: string }) {
  const [preview, setPreview] = useState('读取文本…')
  useEffect(() => {
    let active = true
    void readTextVersion(source)
      .then((value) => { if (active) setPreview(value.trim() || '空文本') })
      .catch(() => { if (active) setPreview('无法读取文本预览') })
    return () => { active = false }
  }, [source, version])
  return <pre className="text-version-preview">{preview}</pre>
}

function VersionPreview({ node, version }: {
  node: ProjectNode
  version: NodeVersion
}) {
  const { source, error } = useProjectAssetUrl(node.id, version.id)
  if (error) return <div className="asset-empty">资源不可用：{error}</div>
  if (!source) return <div className="asset-empty">读取资源…</div>
  if (usesTextPayload(node.type)) {
    return <TextVersionPreview version={version} source={source} />
  }
  if (node.type === 'image') {
    return <img className="asset-image" src={source} alt={version.label} draggable={false} />
  }
  if (node.type === 'video') {
    return <video className="asset-video" src={source} controls preload="metadata" draggable={false} />
  }
  return <AudioPlayer key={source} source={source} label={version.label} />
}

function formatVersionTime(value: string) {
  if (!value) return '历史版本'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '历史版本'
  return date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function versionSourceLabel(source: NodeVersion['source']) {
  if (source === 'upload') return '本地导入'
  if (source === 'edit') return '文本编辑'
  return '生成'
}

export function PropertiesPanel({ instanceId, runtime }: PanelProps) {
  const application = useApplicationClient()
  const shell = useShellClient()
  const generationModels = application.generationModels
  const [sections, setSections] = useElementState<Record<string, boolean>>(runtime, 'sections')
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null)
  const [savingText, setSavingText] = useState(false)
  const [copiedId, setCopiedId] = useState('')
  const [modelCatalog, setModelCatalog] = useState<{
    models: GenerationModelManifest[]
  } | null>(null)
  const [modelCatalogRevision, setModelCatalogRevision] = useState(0)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedNodeId = useSelectedNodeId()
  const projectionRevision = useApplicationRevision()
  const { nodes, pending } = useAppState((state) => ({
    nodes: state.project.nodes,
    pending: state.runtime.pendingTasks > 0,
  }))
  const node = selectedNodeId
    ? (nodes[selectedNodeId] ?? Object.values(nodes).find((n) => n.title === selectedNodeId || n.id === selectedNodeId))
    : undefined
  const persistPatch = useCallback((
    id: string, patch: NodePropertyPatch, historyGroupId?: string,
  ) => (
    application.project.patchNode({ id, patch, historyGroupId })
  ), [application])
  const propertyDraft = useNodePropertyDraft(node, persistPatch, projectionRevision)

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])
  useEffect(() => {
    if (!generationModels) return undefined
    let active = true
    void generationModels.list().then((catalog) => {
      if (active) setModelCatalog({ models: catalog.models })
    }).catch(() => {
      if (active) setModelCatalog({ models: [] })
    })
    return () => { active = false }
  }, [generationModels, modelCatalogRevision])
  useEffect(() => generationModels.onCatalogChanged(() => {
    setModelCatalogRevision((current) => current + 1)
  }), [generationModels])
  useEffect(() => {
    if (!viewer) return undefined
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setViewer(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [viewer])

  function sectionProps(id: string, defaultOpen = false) {
    return {
      open: sections[id] ?? defaultOpen,
      onToggle: () => setSections((current) => ({
        ...current, [id]: !(current[id] ?? defaultOpen),
      })),
    }
  }

  function showCopied(id: string) {
    setCopiedId(id)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopiedId(''), 1400)
  }

  async function copyVersion(version: NodeVersion) {
    if (!node) return
    if (usesTextPayload(node.type)) {
      const source = await application.assets.url(node.id, version.id)
      await shell.clipboard.writeText(await readTextVersion(source))
    } else {
      await application.assets.copyVersions([{ nodeId: node.id, versionId: version.id }])
    }
    showCopied(version.id)
  }

  async function openVersion(version: NodeVersion) {
    if (!node) return
    if (usesTextPayload(node.type)) {
      const source = await application.assets.url(node.id, version.id)
      setViewer({
        kind: 'text',
        title: version.label,
        content: await readTextVersion(source),
      })
    } else if (node.type === 'image') {
      const source = await application.assets.url(node.id, version.id)
      setViewer({
        kind: 'image', title: version.label, source,
      })
    }
  }

  function openTextEditor(field: NodePropertyField, title: string, label: string) {
    setTextEditor({ field, title, label, value: propertyDraft.values[field] })
  }

  async function saveTextEditor() {
    if (!textEditor) return
    setSavingText(true)
    propertyDraft.update(textEditor.field, textEditor.value)
    try {
      await propertyDraft.flush()
      setTextEditor(null)
    } finally {
      setSavingText(false)
    }
  }

  if (!node) {
    return (
      <section className="panel empty-properties" data-instance-id={instanceId}>
        <Tag size={28} /><strong>未选择节点</strong><span>从项目目录中选择一个节点</span>
      </section>
    )
  }

  const presentation = typePresentation[node.type]
  const TypeIcon = presentation.icon
  const history = node.history ?? []
  const currentVersion = history.find((version) => version.current)
  const textual = usesTextPayload(node.type)
  const activeModelCatalog = modelCatalog
  const modelStatus = resolveGenerationModelStatus(
    node.type,
    propertyDraft.values.prompt,
    activeModelCatalog?.models ?? [],
    true,
    Boolean(activeModelCatalog),
  )
  const nodeId = node.id

  function versionActions(version: NodeVersion, includeImport = false) {
    const viewable = textual || node?.type === 'image'
    return (
      <div className="asset-actions">
        {viewable && (
          <IconButton title="放大查看" onClick={() => void openVersion(version)}><Maximize2 size={13} /></IconButton>
        )}
        <IconButton title="复制到剪贴板" onClick={() => void copyVersion(version)}>
          {copiedId === version.id ? <Check size={13} /> : <Copy size={13} />}
        </IconButton>
        {includeImport && (
          <IconButton title={presentation.importLabel} disabled={pending} onClick={() => void application.project.importVersion(nodeId)}>
            <FolderUp size={13} />
          </IconButton>
        )}
      </div>
    )
  }

  return (
    <section className="panel panel-properties" data-instance-id={instanceId}>
      <div className="properties-identity">
        <h2>{node.title}</h2>
        <span className={`node-type-inline type-${node.type}`} title={presentation.label}>
          <TypeIcon size={13} />
          <span>{presentation.label}</span>
        </span>
      </div>

      <div className="properties-scroll">
          <PropertySection title="身份信息" {...sectionProps('identity')}>
          <div className="identity-field-row">
            <label><FieldLabel icon={Tag}>标题</FieldLabel><input value={node.title} readOnly title="标题由 Markdown Logic 维护" /></label>
            <label><FieldLabel icon={Info}>稳定 ID</FieldLabel><input className="mono-input" value={node.id} readOnly /></label>
          </div>
          </PropertySection>

          <PropertySection title="节点内容" {...sectionProps('content', true)}>
          <div className="property-text-field">
            <div className="property-text-field-heading">
              <FieldLabel icon={Info}>描述</FieldLabel>
              <IconButton title="在大窗口中编辑" onClick={() => openTextEditor('description', `编辑描述 · ${node.title}`, '节点描述')}><Maximize2 size={13} /></IconButton>
            </div>
            <textarea
              aria-label="描述"
              {...propertyDraft.fieldEvents}
              spellCheck={false}
              rows={3}
              placeholder="说明节点的用途、目标或创作意图…"
              value={propertyDraft.values.description}
              onChange={(event) => propertyDraft.update('description', event.target.value)}
            />
          </div>

          {textual ? (
            <div className="text-content-shell">
              <label>
                <FieldLabel icon={node.type === 'style' ? Palette : FileText}>{node.type === 'style' ? '当前风格文本' : '当前正文'}</FieldLabel>
                <textarea
                  spellCheck={false}
                  className="content-field"
                  rows={9}
                  placeholder={node.type === 'style' ? '输入风格描述或从本地导入…' : '输入正文或从本地导入…'}
                  value={propertyDraft.values.content}
                  onChange={(event) => propertyDraft.update('content', event.target.value)}
                  {...propertyDraft.fieldEvents}
                />
              </label>
              <div className="asset-actions">
                <IconButton title="在大窗口中编辑" onClick={() => openTextEditor('content', `编辑${node.type === 'style' ? '风格文本' : '正文'} · ${node.title}`, node.type === 'style' ? '当前风格文本' : '当前正文')}><Maximize2 size={13} /></IconButton>
                <IconButton title="复制到剪贴板" onClick={() => {
                  void shell.clipboard.writeText(propertyDraft.values.content).then(() => showCopied('current-text'))
                }}>{copiedId === 'current-text' ? <Check size={13} /> : <Copy size={13} />}</IconButton>
                <IconButton title={presentation.importLabel} disabled={pending} onClick={() => void application.project.importVersion(node.id)}><FolderUp size={13} /></IconButton>
              </div>
            </div>
          ) : currentVersion ? (
            <div className={`current-asset is-${node.type}`}>
              <VersionPreview node={node} version={currentVersion} />
              <span className="asset-caption" title={currentVersion.label}><Check size={11} />{currentVersion.label}</span>
              {versionActions(currentVersion, true)}
            </div>
          ) : (
            <div className="asset-empty">
              <TypeIcon size={24} />
              <IconButton title={presentation.importLabel} disabled={pending} onClick={() => void application.project.importVersion(node.id)}><FolderUp size={14} /></IconButton>
            </div>
          )}
          </PropertySection>

          {!textual && (
            <PropertySection title="生成设置" {...sectionProps('generation', true)}>
            <div className="property-text-field">
              <div className="property-text-field-heading">
                <FieldLabel icon={WandSparkles}>生成提示词</FieldLabel>
                <IconButton title="在大窗口中编辑" onClick={() => openTextEditor('prompt', `编辑生成提示词 · ${node.title}`, '生成提示词')}><Maximize2 size={13} /></IconButton>
              </div>
              <textarea
                aria-label="生成提示词"
                {...propertyDraft.fieldEvents}
                spellCheck={false}
                className="prompt-field"
                rows={6}
                placeholder="描述希望生成的资产…"
                value={propertyDraft.values.prompt}
                onChange={(event) => propertyDraft.update('prompt', event.target.value)}
              />
            </div>
            {modelStatus && (
              <p className={`property-model-status is-${modelStatus.kind}`} title={modelStatus.title}>
                {modelStatus.kind === 'ready' ? <Check size={12} /> : <CircleAlert size={12} />}
                <span>{modelStatus.label}</span>
              </p>
            )}
            </PropertySection>
          )}
          <PropertySection className="properties-history-section" title="版本历史" count={history.length} {...sectionProps('history', true)}>
            {history.length ? (
              <div className="history-list">
                {[...history].reverse().map((version) => (
                  <article className={`version-card is-${node.type} ${version.current ? 'is-current' : ''}`} key={version.id}>
                    <VersionPreview node={node} version={version} />
                    <span className="version-caption" title={`${version.label} · ${formatVersionTime(version.createdAt)} · ${versionSourceLabel(version.source)}`}>
                      {version.label}
                    </span>
                    <div className="asset-actions">
                      {(textual || node.type === 'image') && (
                        <IconButton title="放大查看" onClick={() => void openVersion(version)}><Maximize2 size={12} /></IconButton>
                      )}
                      <IconButton title="复制到剪贴板" onClick={() => void copyVersion(version)}>
                        {copiedId === version.id ? <Check size={12} /> : <Copy size={12} />}
                      </IconButton>
                      {version.current ? (
                        <span className="asset-current-icon" title="当前版本"><Check size={12} /></span>
                      ) : (
                        <IconButton title="设为当前" disabled={pending} onClick={() => void application.project.promoteVersion(node.id, version.id)}><ArrowUpToLine size={12} /></IconButton>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-history"><History size={15} />还没有版本</p>
            )}
          </PropertySection>
      </div>

      {viewer && (
        <div className="asset-viewer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setViewer(null)
        }}>
          <section className={`asset-viewer is-${viewer.kind}`} role="dialog" aria-modal="true" aria-label={viewer.title}>
            <header><strong title={viewer.title}>{viewer.title}</strong><IconButton title="关闭" onClick={() => setViewer(null)}><X size={14} /></IconButton></header>
            {viewer.kind === 'image'
              ? <img src={viewer.source} alt={viewer.title} draggable={false} />
              : <pre>{viewer.content || '空文本'}</pre>}
          </section>
        </div>
      )}
      {textEditor && (
        <LargeTextEditorDialog
          busy={savingText}
          label={textEditor.label}
          title={textEditor.title}
          value={textEditor.value}
          saveLabel="保存修改"
          onChange={(value) => setTextEditor((current) => current ? { ...current, value } : current)}
          onClose={() => setTextEditor(null)}
          onSave={saveTextEditor}
        />
      )}
    </section>
  )
}
