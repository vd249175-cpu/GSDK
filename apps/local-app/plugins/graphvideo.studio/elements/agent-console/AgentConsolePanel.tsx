import {
  AlertCircle,
  Bot,
  Clock,
  ExternalLink,
  FolderOpen,
  Info,
  Play,
  RotateCw,
  ShieldCheck,
  SquareTerminal,
  X,
} from 'lucide-react'
import { useMemo, useSyncExternalStore } from 'react'
import { useAppState, type PanelProps } from '@graphvideo/client-sdk'
import type { AgentConsoleStore } from './agentConsoleStore'

function formatTerminalName(terminal: string) {
  switch (terminal) {
    case 'windows-terminal':
      return 'Windows Terminal (wt.exe)'
    case 'windows-console':
      return 'Windows Console (cmd.exe)'
    case 'macos-terminal':
      return 'macOS Terminal (Terminal.app)'
    case 'linux-terminal':
      return 'Linux Terminal'
    default:
      return terminal
  }
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function AgentConsolePanel({ runtime }: PanelProps) {
  const localProjectPath = useAppState((state) => state.project.localPath)
  const projectName = useAppState((state) => state.project.name)
  const hasProject = Boolean(localProjectPath)

  const store = useMemo(() => (
    runtime.value as { store: AgentConsoleStore }
  ).store, [runtime])

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const selectedTemplate = snapshot.templates.find((template) => template.id === snapshot.templateId)
    ?? snapshot.templates[0]
  const selectedAgent = selectedTemplate?.agents.find((agent) => agent.id === snapshot.agentId)
    ?? selectedTemplate?.agents[0]

  return (
    <section className="panel panel-agent-console" data-instance-id={runtime.instanceId}>
      {/* Top Toolbar */}
      <div className="agent-console-toolbar">
        <label>
          <span>模板</span>
          <select
            value={selectedTemplate?.id ?? ''}
            onChange={(event) => store.setTemplate(event.target.value)}
          >
            {snapshot.templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Agent</span>
          <select
            value={selectedAgent?.id ?? ''}
            onChange={(event) => store.setAgent(event.target.value)}
          >
            {selectedTemplate?.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </label>
        <button
          className="agent-toolbar-button"
          type="button"
          disabled={!selectedAgent}
          title="打开 Agent 本地目录"
          onClick={() => void store.openDirectory()}
        >
          <FolderOpen size={14} />
          目录
        </button>
        <button
          className="agent-toolbar-button is-primary"
          type="button"
          disabled={!hasProject || !selectedAgent || snapshot.launching}
          title={hasProject ? '在操作系统原生终端中启动 Anti-Gravity CLI' : '请先打开本地项目'}
          onClick={() => void store.launchTerminal()}
        >
          {snapshot.launching ? (
            <>
              <RotateCw size={14} className="agent-spin" />
              启动中...
            </>
          ) : (
            <>
              <Play size={14} />
              启动原生终端
            </>
          )}
        </button>
      </div>

      {/* Main Content Dashboard */}
      <div className="agent-launcher-scroll">
        {/* Selected Agent Information Card */}
        <div className="agent-overview-card">
          <div className="agent-overview-header">
            <div className="agent-overview-title-group">
              <div className="agent-avatar">
                <Bot size={20} />
              </div>
              <div>
                <h3 className="agent-name">{selectedAgent?.name ?? '未选择 Agent'}</h3>
                <span className="agent-template-tag">
                  {selectedTemplate?.name ?? '默认模板'} · {selectedAgent?.id ?? 'none'}
                </span>
              </div>
            </div>
            <div className="agent-overview-actions">
              <button
                className="agent-action-btn is-secondary"
                type="button"
                disabled={!selectedAgent}
                onClick={() => void store.openDirectory()}
                title="在文件管理器中查看 Agent 配置文件与 prompt"
              >
                <FolderOpen size={14} />
                浏览配置
              </button>
              <button
                className="agent-action-btn is-primary"
                type="button"
                disabled={!hasProject || !selectedAgent || snapshot.launching}
                onClick={() => void store.launchTerminal()}
              >
                <ExternalLink size={14} />
                {snapshot.launching ? '正在拉起终端...' : '启动终端会话'}
              </button>
            </div>
          </div>

          <div className="agent-details-grid">
            <div className="agent-detail-item">
              <span className="agent-detail-label">工作区挂载项目</span>
              <span className="agent-detail-value" title={localProjectPath || '未打开项目'}>
                {hasProject ? `${projectName || '当前项目'} (${localProjectPath})` : '未打开本地项目（请先打开项目）'}
              </span>
            </div>
            <div className="agent-detail-item">
              <span className="agent-detail-label">共享 Skills 技能库</span>
              <span className="agent-detail-value">
                自动挂载 <code>.agents/skills</code> 与 GraphVideo CLI 工具链
              </span>
            </div>
            <div className="agent-detail-item">
              <span className="agent-detail-label">终端运行环境</span>
              <span className="agent-detail-value">
                独立 OS 原生终端进程（Windows Terminal / CMD）
              </span>
            </div>
            <div className="agent-detail-item">
              <span className="agent-detail-label">工作目录 (CWD)</span>
              <span className="agent-detail-value">
                <code>templates/{selectedTemplate?.id}/agents/{selectedAgent?.id}</code>
              </span>
            </div>
          </div>
        </div>

        {/* Launch History or Welcome Guide */}
        {snapshot.launches.length > 0 ? (
          <div className="agent-history-card">
            <div className="agent-history-header">
              <div className="agent-history-title">
                <Clock size={16} />
                <h4>启动记录 (外部终端)</h4>
                <span className="agent-history-count">{snapshot.launches.length}</span>
              </div>
            </div>
            <div className="agent-history-list">
              {snapshot.launches.map((item) => (
                <div key={item.id} className="agent-history-row">
                  <div className="agent-history-row-main">
                    <SquareTerminal size={16} className="agent-history-icon" />
                    <div>
                      <span className="agent-history-agent">{item.title || item.agentId}</span>
                      <span className="agent-history-terminal">{formatTerminalName(item.terminal)}</span>
                    </div>
                  </div>
                  <div className="agent-history-row-meta">
                    <span className="agent-history-time">{formatTime(item.launchedAt)}</span>
                    <span className="agent-history-badge">已调起外部终端</span>
                    <button
                      className="agent-history-dismiss"
                      type="button"
                      title="移除此记录"
                      onClick={() => store.dismissLaunch(item.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="agent-guide-card">
            <div className="agent-guide-icon">
              <Info size={24} />
            </div>
            <div className="agent-guide-content">
              <h4>原生终端交互模式</h4>
              <p>
                点击上方「启动原生终端」后，系统将在原生终端窗口中运行 Agent CLI 会话，并保持命令行窗口持续开启，自动挂载当前项目路径与共享 Skills。
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {snapshot.error && (
        <div className="agent-console-error" role="alert">
          <AlertCircle size={15} />
          <span>{snapshot.error}</span>
          <button
            type="button"
            className="agent-error-close"
            onClick={() => store.clearError()}
            title="关闭提示"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </section>
  )
}

