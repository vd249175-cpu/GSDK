import { AlertTriangle, Braces, CheckCircle2, CircleHelp, Cloud, Play } from 'lucide-react'
import { memo, useMemo, useRef, useState } from 'react'
import {
  useAppState, useApplicationClient, useMarkdownDraft, type PanelProps,
  type ProjectIssue,
} from '@graphvideo/client-sdk'

export function MarkdownEditorPanel({ instanceId }: PanelProps) {
  const logicState = useAppState((state) => ({
    markdown: state.project.markdown,
    lastRunMarkdown: state.project.lastRunMarkdown,
    issues: state.project.issues,
    revision: state.project.logicRevision,
    hasProject: Boolean(state.project.localPath),
    projectPath: state.project.localPath,
    savedAt: state.project.lastLogicRunAt,
  }))
  return <MarkdownEditorView instanceId={instanceId} {...logicState} />
}

interface MarkdownEditorViewProps {
  instanceId: string
  markdown: string
  lastRunMarkdown: string
  issues: ProjectIssue[]
  revision: number
  hasProject: boolean
  projectPath: string | null
  savedAt: number | null
}

const MarkdownEditorView = memo(function MarkdownEditorView({
  instanceId, markdown, lastRunMarkdown, issues, revision, hasProject, projectPath,
  savedAt,
}: MarkdownEditorViewProps) {
  const application = useApplicationClient()
  const [draft, setDraft] = useMarkdownDraft(projectPath, markdown)
  const [runningLogic, setRunningLogic] = useState(false)
  const lines = useMemo(() => draft.split('\n').length, [draft])
  const isDirty = draft !== lastRunMarkdown
  const editorRef = useRef<HTMLTextAreaElement>(null)

  async function runMarkdownLogic() {
    setRunningLogic(true)
    try {
      await application.project.runMarkdown(draft)
    } catch {
      // Runtime owns the visible task error; this state only tracks this button invocation.
    } finally {
      setRunningLogic(false)
    }
  }

  function goToLine(line: number) {
    const editor = editorRef.current
    if (!editor) return
    const lineStart = draft.split('\n').slice(0, Math.max(0, line - 1)).join('\n').length + (line > 1 ? 1 : 0)
    editor.focus()
    editor.setSelectionRange(lineStart, lineStart)
  }

  return (
    <section className={`panel panel-editor ${issues.length ? 'has-errors' : ''}`} data-instance-id={instanceId}>
      <div className="panel-toolbar">
        <div className="toolbar-group toolbar-primary">
          <button className="tool-button is-active" type="button"><Braces size={14} /> Logic</button>
          <span className="toolbar-divider" />
          <span className="legend-token text">$ 文本</span>
          <span className="legend-token image">@ 图片</span>
          <span className="legend-token video">% 视频</span>
          <span className="legend-token audio">~ 音频</span>
          <span className="legend-token style">& 风格</span>
        </div>
        <div className="toolbar-group toolbar-actions">
          <span className="revision-label">r{revision}</span>
          <button
            className={`run-logic-button ${isDirty ? 'has-changes' : ''}`}
            type="button"
            disabled={runningLogic || !hasProject}
            title={hasProject ? '运行 Markdown Logic 并更新项目目录' : '请先打开本地项目'}
            onClick={() => void runMarkdownLogic()}
          >
            <Play size={12} />{runningLogic ? '运行中' : '运行'}
          </button>
        </div>
      </div>
      <div className="editor-body">
        <div className="line-numbers" aria-hidden="true">
          {Array.from({ length: lines }, (_, index) => <span key={index}>{index + 1}</span>)}
        </div>
        <textarea
          ref={editorRef}
          aria-label="Markdown Logic 编辑器"
          className="logic-editor"
          value={draft}
          disabled={!hasProject}
          placeholder="请先从顶栏打开项目目录；空目录会自动创建最小项目"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      {issues.length > 0 && (
        <div className="run-error-list" role="alert" aria-label="Markdown 运行错误">
          {issues.map((issue, index) => (
            <button type="button" key={`${issue.code}-${issue.line}-${index}`} onClick={() => goToLine(issue.line)}>
              <AlertTriangle size={12} />
              <strong>第 {issue.line} 行</strong>
              <span>{issue.message}</span>
              <code>{issue.code}</code>
            </button>
          ))}
        </div>
      )}
      <footer className="panel-statusbar">
        <span><Cloud size={12} />{runningLogic
          ? '运行中…'
          : savedAt
            ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
            : hasProject ? '项目已加载' : '未打开项目'}</span>
        <span className="status-separator" />
        <span>{lines} 行</span>
        <span className="status-separator" />
        {issues.length > 0 ? (
          <span className="status-error"><AlertTriangle size={12} /> {issues.length} 个运行错误</span>
        ) : isDirty ? (
          <span className="status-warning"><AlertTriangle size={12} /> 有未运行的更改</span>
        ) : (
          <span className="status-ok"><CheckCircle2 size={12} /> 结构有效</span>
        )}
        <span className="status-spacer" />
        <span title="两空格为一个结构层级"><CircleHelp size={12} /> 缩进: 2 空格</span>
      </footer>
    </section>
  )
})
