import {
  Check, ChevronRight, CircleAlert, Copy, FileInput, FileText, Film, GripHorizontal, Image,
  Maximize2, Music2, Palette, Sparkles, Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react'
import {
  generationPromptModelId, parseGenerationPrompt,
  setGenerationPromptModel, useAppState, useApplicationClient,
  useElementState, useProjectAssetUrl, useSelectedNodeId, useShellClient,
  type GenerationModelManifest, type NodeType,
  type PanelProps, type ResolvedGenerationPrompt,
} from '@graphvideo/client-sdk'
import { AudioPlayer, LargeTextEditorDialog } from '@graphvideo/sdk/ui'
import {
  compileManualPrompt, copyableGenerationReferences, nodePrompt, resolveGenerationReferences, type GenerationReference,
} from './generationBundle'

const typePresentation: Record<NodeType, { icon: ElementType; label: string }> = {
  text: { icon: FileText, label: '文本' },
  image: { icon: Image, label: '图片' },
  video: { icon: Film, label: '视频' },
  audio: { icon: Music2, label: '音频' },
  style: { icon: Palette, label: '风格' },
}

type GenerationSectionId = 'prompt' | 'text' | 'media'
type TextEditorState = {
  field: 'content' | 'prompt'
  label: string
  nodeId: string
  title: string
  value: string
}

interface GenerationSectionProps {
  children: ReactNode
  className?: string
  count?: ReactNode
  open: boolean
  title: string
  onToggle: () => void
}

function GenerationSection({
  children, className = '', count, open, title, onToggle,
}: GenerationSectionProps) {
  return (
    <section className={`property-section ${open ? 'is-open' : ''} ${className}`.trim()}>
      <button className="property-section-header" type="button" aria-expanded={open} onClick={onToggle}>
        <ChevronRight className="section-chevron" size={13} />
        <span>{title}</span>
        {count !== undefined && <span className="section-count">{count}</span>}
        <GripHorizontal className="section-grip" size={13} />
      </button>
      {open && <div className="property-section-body generation-section-body">{children}</div>}
    </section>
  )
}

function VersionPreview({ reference }: { reference: GenerationReference }) {
  const version = reference.currentVersion
  const TypeIcon = typePresentation[reference.node.type].icon
  const { source, error } = useProjectAssetUrl(reference.node.id, version?.id ?? null)
  if (!version) return <div className="generation-media-missing"><TypeIcon size={24} /><span>无当前版本</span></div>
  if (error) return <div className="generation-media-missing"><TypeIcon size={24} /><span>资源不可用：{error}</span></div>
  if (!source) return <div className="generation-media-missing"><TypeIcon size={24} /><span>读取资源…</span></div>
  if (reference.node.type === 'image') return <img src={source} alt={reference.node.title} draggable={false} />
  if (reference.node.type === 'video') return <video src={source} controls preload="metadata" draggable={false} />
  return <AudioPlayer source={source} label={reference.node.title} className="generation-audio-player" />
}

export function GenerationPanel({ instanceId, runtime }: PanelProps) {
  const application = useApplicationClient()
  const shell = useShellClient()
  const generationModels = application.generationModels
  const [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [promptView, setPromptView] = useState<'source' | 'parsed'>('source')
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null)
  const [savingText, setSavingText] = useState(false)
  const [models, setModels] = useState<GenerationModelManifest[]>([])
  const [resolution, setResolution] = useState<{
    key: string; value: ResolvedGenerationPrompt
  } | null>(null)
  const [resolveFailure, setResolveFailure] = useState<{ key: string; message: string } | null>(null)
  const [openSections, setOpenSections] = useElementState<Record<GenerationSectionId, boolean>>(runtime, 'sections')
  const selectedNodeId = useSelectedNodeId()
  const nodes = useAppState((state) => state.project.nodes)
  const target = selectedNodeId ? nodes[selectedNodeId] : undefined
  const storedPrompt = target
    ? (target.type === 'text' || target.type === 'style' ? target.content : target.prompt) ?? ''
    : ''
  const draft = target ? drafts[target.id] ?? storedPrompt : ''
  const targetMediaType = target && !['text', 'style'].includes(target.type) ? target.type : null
  const modelId = generationPromptModelId(draft)
  const availableModels = models
  const applicableModels = useMemo(() => availableModels.filter((model) => (
    model.mediaType === targetMediaType
  )), [availableModels, targetMediaType])
  const selectedModel = availableModels.find((model) => model.id === modelId)

  async function refreshModels() {
    const catalog = await generationModels.list()
    setModels(catalog.models)
    if (catalog.issues.length) setNotice(catalog.issues[0])
    return catalog.models
  }

  useEffect(() => {
    let active = true
    void generationModels.list().then((catalog) => {
      if (!active) return
      setModels(catalog.models)
      if (catalog.issues.length) setNotice(catalog.issues[0])
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : '无法读取生成模型')
    })
    return () => { active = false }
  }, [generationModels])

  function setDraft(value: string) {
    if (!target) return
    setDrafts((current) => ({ ...current, [target.id]: value }))
  }

  const promptBody = useMemo(() => {
    try { return parseGenerationPrompt(draft).body } catch { return draft }
  }, [draft])
  const projectTree = useAppState((state) => state.project.tree)
  const references = useMemo(() => target
    ? resolveGenerationReferences(draft, nodes, target.id, projectTree)
    : [], [nodes, draft, target, projectTree])
  const modelReferences = useMemo(() => references.map((reference) => ({
    id: reference.node.id,
    type: reference.node.type,
    title: reference.node.title,
    ordinal: reference.ordinal,
    content: nodePrompt(reference.node),
  })), [references])
  const resolutionKey = `${targetMediaType ?? ''}\u0000${modelId ?? ''}\u0000${draft}`

  useEffect(() => {
    let canceled = false
    if (!targetMediaType || !modelId) return undefined
    const timer = window.setTimeout(() => {
      void generationModels.resolve({
        nodeType: targetMediaType, prompt: draft, references: modelReferences,
      }).then((result) => {
        if (canceled) return
        setResolution({ key: resolutionKey, value: result })
        setResolveFailure(null)
      }).catch((error) => {
        if (canceled) return
        setResolution(null)
        setResolveFailure({
          key: resolutionKey,
          message: error instanceof Error ? error.message : '无法解析生成提示词',
        })
      })
    }, 120)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [draft, generationModels, modelId, modelReferences, resolutionKey, targetMediaType])

  const activeResolvedPrompt = resolution?.key === resolutionKey
    ? resolution.value
    : null
  const resolveError = !modelId && targetMediaType && draft.trim()
    ? '提示词 YAML 头部尚未声明 model'
    : resolveFailure?.key === resolutionKey ? resolveFailure.message : ''

  const localCompiledPrompt = useMemo(() => {
    if (!draft) return null
    if (!selectedModel) return compileManualPrompt(promptBody, modelReferences)
    const typePrefix: Record<string, string> = {
      text: '$',
      image: '@',
      video: '%',
      audio: '~',
      style: '&',
    }
    const idChar = /[\p{L}\p{N}_.:-]/u
    const mediaAliases = (selectedModel as any).promptRules?.mediaAliases ?? (selectedModel as any).prompt?.mediaAliases ?? {}
    const inlineTemplates = (selectedModel as any).promptRules?.inlineTemplates ?? (selectedModel as any).prompt?.inlineTemplates ?? {}

    const curBody = promptBody
    const foundOccurrences: Array<{ start: number; end: number; replacement: string }> = []

    for (const ref of modelReferences) {
      const pfx = typePrefix[ref.type] || ''
      const patterns: Array<{ text: string; needBoundary: boolean }> = []
      if (ref.title) {
        if (pfx) {
          patterns.push({ text: `[${pfx}${ref.title}]`, needBoundary: false })
          patterns.push({ text: `${pfx}${ref.title}`, needBoundary: true })
        }
        patterns.push({ text: `[${ref.title}]`, needBoundary: false })
        if (pfx && ref.id) patterns.push({ text: `[${pfx}${ref.title}:${ref.id}]`, needBoundary: false })
      }
      if (ref.id) {
        patterns.push({ text: `[${ref.id}]`, needBoundary: false })
        patterns.push({ text: ref.id, needBoundary: true })
      }

      const mediaTpl = mediaAliases[ref.type]
      const textTpl = inlineTemplates[ref.type]
      const contentVal = (ref.content || '').trim()
      const values: Record<string, any> = {
        content: contentVal,
        ordinal: ref.ordinal,
        id: ref.id,
        title: ref.title,
      }
      const render = (tpl: string) => tpl.replace(/{{(content|ordinal|id|title)}}/g, (_, k) => String(values[k] ?? ''))
      const replacement = mediaTpl
        ? render(mediaTpl)
        : textTpl
          ? render(textTpl.includes('{{content}}') && !contentVal ? textTpl.replace('{{content}}', ref.title || ref.id) : textTpl)
          : contentVal || (ref.type === 'image'
            ? `Image_${ref.ordinal}`
            : ref.type === 'video'
              ? `Video_${ref.ordinal}`
              : ref.type === 'audio'
                ? `Audio_${ref.ordinal}`
                : ref.title || ref.id)

      for (const { text: pat, needBoundary } of patterns) {
        let st = curBody.indexOf(pat)
        while (st >= 0) {
          const ed = st + pat.length
          if (!needBoundary || ((st === 0 || !idChar.test(curBody[st - 1])) && (ed === curBody.length || !idChar.test(curBody[ed])))) {
            foundOccurrences.push({ start: st, end: ed, replacement })
          }
          st = curBody.indexOf(pat, ed)
        }
      }
    }

    foundOccurrences.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
    const unique = foundOccurrences.filter((item, idx, arr) => idx === 0 || item.start >= arr[idx - 1].end)
    let cur = 0
    let out = ''
    for (const occ of unique) {
      out += curBody.slice(cur, occ.start) + occ.replacement
      cur = occ.end
    }
    out += curBody.slice(cur)
    return out.trim()
  }, [selectedModel, draft, promptBody, modelReferences])

  const processedPrompt = activeResolvedPrompt?.prompt ?? localCompiledPrompt ?? promptBody.trim()
  const copyableReferences = useMemo(() => copyableGenerationReferences(references), [references])
  const mediaReferences = useMemo(() => references.filter(({ node }) => (
    node.type === 'image' || node.type === 'video' || node.type === 'audio'
  )), [references])
  const textReferences = useMemo(() => references.filter(({ node }) => (
    node.type === 'text' || node.type === 'style'
  )), [references])

  useEffect(() => {
    if (!target) return
    if (drafts[target.id] !== undefined && drafts[target.id] === storedPrompt) {
      setDrafts((current) => {
        if (!(target.id in current)) return current
        const next = { ...current }
        delete next[target.id]
        return next
      })
    }
  }, [drafts, storedPrompt, target])

  async function persistPrompt(value: string) {
    if (!target || value === storedPrompt) return
    const patch = target.type === 'text' || target.type === 'style'
      ? { content: value }
      : { prompt: value }
    try {
      await application.project.patchNode({ id: target.id, patch })
      setNotice('提示词已保存')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法保存提示词')
    }
  }

  async function saveTextEditor() {
    if (!textEditor) return
    const editor = textEditor
    setSavingText(true)
    try {
      await application.project.patchNode({
        id: editor.nodeId,
        patch: { [editor.field]: editor.value },
      })
      setDrafts((current) => ({ ...current, [editor.nodeId]: editor.value }))
      setNotice('文本修改已保存')
      setTextEditor(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法保存文本修改')
    } finally {
      setSavingText(false)
    }
  }

  async function copyPrompt() {
    if (!processedPrompt) return
    try {
      await shell.clipboard.writeText(processedPrompt)
      setNotice('解析后的提示词已复制')
    } catch {
      setNotice('无法写入剪贴板')
    }
  }

  async function copyMedia(selected: GenerationReference[]) {
    const items = selected.flatMap((reference) => reference.currentVersion ? [{
      nodeId: reference.node.id,
      versionId: reference.currentVersion.id,
    }] : [])
    try {
      const result = await application.assets.copyVersions(items)
      setNotice(result.mode === 'files'
        ? `已复制 ${result.count} 个媒体文件`
        : `已复制 ${result.count} 个媒体路径`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法复制媒体版本')
    }
  }

  function toggleSection(sectionId: GenerationSectionId) {
    setOpenSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }

  async function importModel() {
    try {
      const result = await generationModels.import()
      if (result.canceled || !result.model) return
      await refreshModels()
      setNotice(`已导入模型“${result.model.name}”`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法导入生成模型')
    }
  }

  async function deleteModel() {
    if (!selectedModel || !window.confirm(`删除生成模型“${selectedModel.name}”吗？`)) return
    try {
      await generationModels.delete(selectedModel.id)
      await refreshModels()
      setNotice(`已删除模型“${selectedModel.name}”`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法删除生成模型')
    }
  }

  async function selectModel(nextModelId: string) {
    if (!target) return
    try {
      const nextPrompt = setGenerationPromptModel(draft, nextModelId)
      setDraft(nextPrompt)
      const patch = target.type === 'text' || target.type === 'style'
        ? { content: nextPrompt }
        : { prompt: nextPrompt }
      await application.project.patchNode({ id: target.id, patch })
      setNotice('已选择模型并保存提示词')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法设置生成模型')
    }
  }

  if (!target) {
    return (
      <section className="panel panel-properties generation-workspace generation-empty" data-instance-id={instanceId}>
        <Sparkles size={38} />
        <strong>选择一个生成目标</strong>
        <span>从左侧目录选择节点，并在提示词中写入要引用节点的稳定 ID。</span>
      </section>
    )
  }

  const targetPresentation = typePresentation[target.type]
  const TargetIcon = targetPresentation.icon
  return (
    <section className="panel panel-properties generation-workspace" data-instance-id={instanceId}>
      <header className="properties-identity generation-identity">
        <h2 title={target.title}>{target.title}</h2>
        <span className="node-type-inline"><TargetIcon size={13} />{targetPresentation.label}</span>
        <div className="generation-actions" style={{ marginLeft: 'auto' }}>
          {notice && <em role="status"><Check size={12} />{notice}</em>}
          <button className="generation-icon-action" type="button" title="复制解析后的提示词" aria-label="复制解析后的提示词" disabled={!processedPrompt} onClick={() => void copyPrompt()}><Copy size={14} /></button>
        </div>
      </header>

      <div className="properties-scroll generation-properties-scroll">
          <GenerationSection
            open={openSections.prompt}
            title="生成提示词"
            onToggle={() => toggleSection('prompt')}
          >
          <div className="generation-prompt-toolbar">
            <div className="generation-prompt-tabs" role="tablist" aria-label="提示词视图">
              <button className={promptView === 'source' ? 'is-active' : ''} type="button" role="tab" aria-selected={promptView === 'source'} onClick={() => setPromptView('source')}>源提示词</button>
              <button className={promptView === 'parsed' ? 'is-active' : ''} type="button" role="tab" aria-selected={promptView === 'parsed'} onClick={() => setPromptView('parsed')}>解析结果</button>
            </div>
            <div className="generation-rule-controls">
              <label className="generation-rule-select" title={selectedModel?.description ?? '在 YAML 头部声明生成模型'}>
                <select
                  aria-label="生成模型"
                  disabled={!targetMediaType || applicableModels.length === 0}
                  value={modelId ?? ''}
                  onChange={(event) => void selectModel(event.target.value)}
                >
                  <option value="" disabled>{applicableModels.length ? '选择模型' : '没有可用模型'}</option>
                  {applicableModels.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}
                </select>
              </label>
              <button
                className="generation-icon-action"
                type="button"
                title="在大窗口中编辑提示词"
                aria-label="在大窗口中编辑提示词"
                onClick={() => setTextEditor({
                  field: target.type === 'text' || target.type === 'style' ? 'content' : 'prompt',
                  label: '源提示词',
                  nodeId: target.id,
                  title: `编辑生成提示词 · ${target.title}`,
                  value: draft,
                })}
              ><Maximize2 size={13} /></button>
              <button className="generation-icon-action" type="button" title="导入模型 Skill" aria-label="导入模型 Skill" onClick={() => void importModel()}><FileInput size={13} /></button>
              <button className="generation-icon-action" type="button" title="删除当前模型" aria-label="删除当前模型" disabled={!selectedModel} onClick={() => void deleteModel()}><Trash2 size={13} /></button>
            </div>
          </div>
          <div className="generation-prompt-view">
            {promptView === 'source' ? (
              <textarea
                aria-label="源提示词"
                spellCheck={false}
                value={draft}
                placeholder="输入提示词，并直接写入需要引用的节点 ID…"
                onChange={(event) => { setDraft(event.target.value); setNotice('') }}
                onBlur={() => void persistPrompt(draft)}
              />
            ) : (
              <pre className="generation-context-preview" title={selectedModel?.description}>{processedPrompt || '尚未填写提示词。'}</pre>
            )}
          </div>
          {!draft && <p className="generation-warning"><CircleAlert size={13} />当前目标尚未填写提示词。</p>}
          {resolveError && <p className="generation-warning"><CircleAlert size={13} />{resolveError}</p>}
          </GenerationSection>

          {textReferences.length > 0 && (
            <GenerationSection
              count={textReferences.length}
              open={openSections.text}
              title="文本引用"
              onToggle={() => toggleSection('text')}
            >
            <div className="generation-text-references">
              {textReferences.map((reference) => {
                const TypeIcon = typePresentation[reference.node.type].icon
                const content = nodePrompt(reference.node) || reference.node.description || '尚未填写文本内容'
                return (
                  <article title={reference.node.id} key={reference.node.id}>
                    <button
                      className="generation-reference-preview"
                      type="button"
                      title="在大窗口中查看和编辑"
                      onClick={() => setTextEditor({
                        field: 'content',
                        label: reference.node.type === 'style' ? '风格文本' : '节点正文',
                        nodeId: reference.node.id,
                        title: `编辑引用文本 · ${reference.node.title}`,
                        value: content === '尚未填写文本内容' ? '' : content,
                      })}
                    >
                      <TypeIcon className={`type-${reference.node.type}`} size={15} />
                      <strong>{reference.node.title}</strong>
                      <Maximize2 size={13} />
                    </button>
                  </article>
                )
              })}
            </div>
            </GenerationSection>
          )}
          <GenerationSection
            className="generation-media-section"
            count={`${copyableReferences.length}/${mediaReferences.length}`}
            open={openSections.media}
            title="媒体引用"
            onToggle={() => toggleSection('media')}
          >
          <div className="generation-media-toolbar">
            <button className="asset-icon-button" type="button" title="按引用顺序复制全部媒体" aria-label="复制全部媒体" disabled={copyableReferences.length === 0} onClick={() => void copyMedia(copyableReferences)}><Copy size={13} /></button>
          </div>
          <div className="generation-media-grid">
            {mediaReferences.map((reference, index) => {
              const copyable = Boolean(reference.currentVersion)
              const TypeIcon = typePresentation[reference.node.type].icon
              return (
                <article
                  className={`generation-media-card type-${reference.node.type} ${copyable ? 'is-copyable' : 'is-missing'}`}
                  title={copyable ? reference.node.id : '节点没有当前媒体版本'}
                  key={reference.node.id}
                >
                  <div className="generation-media-preview">
                        <VersionPreview reference={reference} />
                    {reference.node.type !== 'audio' && <strong className="generation-media-title">{reference.node.title}</strong>}
                  </div>
                  <span className="generation-order">{index + 1}</span>
                  <span className={`generation-type-badge type-${reference.node.type}`}><TypeIcon size={11} />{activeResolvedPrompt?.aliases[reference.node.id] ?? reference.node.id}</span>
                  {copyable && (
                    <button className="generation-card-copy" type="button" title="复制当前文件" aria-label={`复制 ${reference.node.title}`} onClick={() => void copyMedia([reference])}>
                      <Copy size={12} />
                    </button>
                  )}
                </article>
              )
            })}
            {mediaReferences.length === 0 && <p className="generation-section-empty">提示词中没有图片、视频或音频节点 ID。</p>}
          </div>
          </GenerationSection>
      </div>

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
