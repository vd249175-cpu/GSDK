import { useState } from 'react'
import {
  X,
  Palette,
  Type,
  Layout,
  Check,
  RotateCcw,
  Save,
} from 'lucide-react'
import type {
  ThemeName,
  InterfaceFont,
  InterfaceFontSize,
} from '@graphframework/workbench'
import { IndustrialChip } from './IndustrialChip'

export interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  currentTheme: ThemeName
  onThemeChange: (theme: ThemeName) => void
  currentFont: InterfaceFont
  onFontChange: (font: InterfaceFont) => void
  currentDensity: InterfaceFontSize
  onDensityChange: (density: InterfaceFontSize) => void
  activeWorkspaceId?: string
  onSaveWorkspaceDefault?: () => void
  onResetWorkspaceDefault?: () => void
}

const THEME_OPTIONS: Array<{
  id: ThemeName
  name: string
  desc: string
  bg: string
  accent: string
  border: string
}> = [
  {
    id: 'dark',
    name: '达芬奇暗黑 (DaVinci Dark)',
    desc: '冷峻低饱和深灰基底，工业级调色与调度默认',
    bg: '#080a0d',
    accent: '#38bdf8',
    border: '#22252c',
  },
  {
    id: 'light',
    name: '工坊明亮 (Studio Light)',
    desc: '高明度清晰灰阶，适合强光与多文档审阅',
    bg: '#f8fafc',
    accent: '#0284c7',
    border: '#cbd5e1',
  },
  {
    id: 'xueqing',
    name: '东方雪青 (Xueqing)',
    desc: '典雅紫罗兰中性灰阶，温润雅致',
    bg: '#14141c',
    accent: '#a78bfa',
    border: '#2e2e42',
  },
  {
    id: 'shiliuqun',
    name: '朱砂绯红 (Shiliuqun)',
    desc: '深邃暖炭黑衬底，红金朱砂点缀',
    bg: '#120d0f',
    accent: '#f87171',
    border: '#331f24',
  },
]

const FONT_OPTIONS: Array<{
  id: InterfaceFont
  name: string
  badge: string
  sample: string
}> = [
  {
    id: 'default',
    name: '界面标准无衬线 (UI Sans)',
    badge: 'DEFAULT',
    sample: 'Node: demo.router · 1440x900 · Revision 42',
  },
  {
    id: 'system',
    name: '系统原生字体 (System Native)',
    badge: 'NATIVE',
    sample: 'Node: demo.router · 1440x900 · Revision 42',
  },
  {
    id: 'mono',
    name: '工程全等宽极客模式 (Monospace)',
    badge: 'HARDCORE MONO',
    sample: '0xCAFE -> SUBMIT_ORDER [ID: order-42, GEN: 1]',
  },
]

const DENSITY_OPTIONS: Array<{
  id: InterfaceFontSize
  name: string
  scale: string
  desc: string
}> = [
  {
    id: 'compact',
    name: '紧凑极限 (Compact)',
    scale: '10px / 9px',
    desc: '最高信息密度，适合多窗格与复杂节点链路并发监控',
  },
  {
    id: 'standard',
    name: '标准工程 (Standard)',
    scale: '11px / 10px',
    desc: '默认视觉平衡，标准达芬奇/Blender比例',
  },
  {
    id: 'comfortable',
    name: '舒适阅读 (Comfortable)',
    scale: '12px / 11px',
    desc: '适度微距排版，适合长时间大屏观察',
  },
]

export function SettingsDialog({
  isOpen,
  onClose,
  currentTheme,
  onThemeChange,
  currentFont,
  onFontChange,
  currentDensity,
  onDensityChange,
  activeWorkspaceId,
  onSaveWorkspaceDefault,
  onResetWorkspaceDefault,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'theme' | 'typography' | 'workspace'>('theme')
  const [saveFlash, setSaveFlash] = useState(false)
  const [resetFlash, setResetFlash] = useState(false)

  if (!isOpen) return null

  const handleSaveDefault = () => {
    onSaveWorkspaceDefault?.()
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 1800)
  }

  const handleResetDefault = () => {
    onResetWorkspaceDefault?.()
    setResetFlash(true)
    setTimeout(() => setResetFlash(false), 1800)
  }

  return (
    <div className="gv-settings-backdrop" onClick={onClose}>
      <div
        className="gv-settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="工作台偏好设置"
      >
        {/* 顶部工具栏 */}
        <div className="gv-settings-header">
          <div className="gv-settings-title-group">
            <span className="gv-settings-title">工作台偏好设置 · PREFERENCES</span>
            <IndustrialChip label="SWISS SPEC" tone="accent" monospace />
          </div>
          <button
            type="button"
            className="gv-settings-close-btn"
            onClick={onClose}
            title="关闭设置 (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* 主体左右分栏 */}
        <div className="gv-settings-body">
          {/* 左侧导航 */}
          <nav className="gv-settings-nav">
            <button
              type="button"
              className={`gv-settings-nav-item${activeTab === 'theme' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('theme')}
            >
              <Palette size={13} />
              <span>外观主题</span>
            </button>
            <button
              type="button"
              className={`gv-settings-nav-item${activeTab === 'typography' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('typography')}
            >
              <Type size={13} />
              <span>字体与排版</span>
            </button>
            <button
              type="button"
              className={`gv-settings-nav-item${activeTab === 'workspace' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('workspace')}
            >
              <Layout size={13} />
              <span>工作区布局</span>
            </button>
          </nav>

          {/* 右侧设置内容区 */}
          <div className="gv-settings-content">
            {/* Tab 1: 外观主题 */}
            {activeTab === 'theme' && (
              <div className="gv-settings-section">
                <div className="gv-settings-section-header">
                  <h3 className="gv-settings-section-title">色彩与界面主题</h3>
                  <p className="gv-settings-section-desc">
                    选择工作台视觉基底。所有面板、画布与窗口控件严格通过 Design Tokens 即时同步。
                  </p>
                </div>
                <div className="gv-theme-grid">
                  {THEME_OPTIONS.map((t) => {
                    const isSelected = currentTheme === t.id
                    return (
                      <div
                        key={t.id}
                        className={`gv-theme-card${isSelected ? ' is-selected' : ''}`}
                        onClick={() => onThemeChange(t.id)}
                      >
                        <div className="gv-theme-preview" style={{ background: t.bg, borderColor: t.border }}>
                          <span className="gv-theme-accent-bar" style={{ background: t.accent }} />
                          <div className="gv-theme-inner-chip" style={{ borderColor: t.border, color: t.accent }}>
                            1px
                          </div>
                        </div>
                        <div className="gv-theme-meta">
                          <div className="gv-theme-name-row">
                            <span className="gv-theme-name">{t.name}</span>
                            {isSelected && <Check size={12} className="gv-theme-check" />}
                          </div>
                          <p className="gv-theme-desc">{t.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Tab 2: 字体与排版 */}
            {activeTab === 'typography' && (
              <div className="gv-settings-section">
                <div className="gv-settings-section-header">
                  <h3 className="gv-settings-section-title">界面字体与信息密度</h3>
                  <p className="gv-settings-section-desc">
                    遵循瑞士国际主义排版规约。支持标准界面字体与工程师全等宽极客模式。
                  </p>
                </div>

                <div className="gv-settings-subblock">
                  <span className="gv-settings-label">字体族规范 (Font Family)</span>
                  <div className="gv-font-list">
                    {FONT_OPTIONS.map((f) => {
                      const isSelected = currentFont === f.id
                      return (
                        <div
                          key={f.id}
                          className={`gv-font-card${isSelected ? ' is-selected' : ''}`}
                          onClick={() => onFontChange(f.id)}
                        >
                          <div className="gv-font-top">
                            <span className="gv-font-title">{f.name}</span>
                            <IndustrialChip label={f.badge} tone={isSelected ? 'accent' : 'default'} monospace />
                          </div>
                          <div className={`gv-font-sample${f.id === 'mono' ? ' is-mono' : ''}`}>
                            {f.sample}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="gv-settings-subblock">
                  <span className="gv-settings-label">字号与行高刻度 (Information Density)</span>
                  <div className="gv-density-grid">
                    {DENSITY_OPTIONS.map((d) => {
                      const isSelected = currentDensity === d.id
                      return (
                        <div
                          key={d.id}
                          className={`gv-density-card${isSelected ? ' is-selected' : ''}`}
                          onClick={() => onDensityChange(d.id)}
                        >
                          <div className="gv-density-header">
                            <span className="gv-density-name">{d.name}</span>
                            <span className="gv-density-scale">{d.scale}</span>
                          </div>
                          <p className="gv-density-desc">{d.desc}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: 工作区与布局 */}
            {activeTab === 'workspace' && (
              <div className="gv-settings-section">
                <div className="gv-settings-section-header">
                  <h3 className="gv-settings-section-title">分屏与窗口布局持久化</h3>
                  <p className="gv-settings-section-desc">
                    随意拖拽调整的 Blender 分屏比例与停靠布局均可固化为用户预设，并由本地存储跨会话恢复。
                  </p>
                </div>

                <div className="gv-layout-card">
                  <div className="gv-layout-info">
                    <span className="gv-layout-title">当前工作区：</span>
                    <span className="gv-layout-target is-mono">
                      {activeWorkspaceId ?? 'active-workspace'}
                    </span>
                  </div>
                  <p className="gv-layout-help">
                    你可以随意分屏、拖拽调整尺寸。点击下方按钮即可将当前窗口结构固化为此页面的专属默认值。
                  </p>

                  <div className="gv-layout-actions">
                    <button
                      type="button"
                      className={`gv-action-tool-btn is-primary${saveFlash ? ' is-flashing' : ''}`}
                      onClick={handleSaveDefault}
                    >
                      <Save size={12} />
                      <span>{saveFlash ? '已成功持久化至本地！' : '保存当前布局为默认预设'}</span>
                    </button>

                    <button
                      type="button"
                      className={`gv-action-tool-btn${resetFlash ? ' is-flashing' : ''}`}
                      onClick={handleResetDefault}
                    >
                      <RotateCcw size={12} />
                      <span>{resetFlash ? '已重置为出厂预设！' : '重置此工作区出厂布局'}</span>
                    </button>
                  </div>
                </div>

                <div className="gv-layout-spec-box">
                  <div className="gv-layout-spec-title">📐 瑞士平面实用主义视效准则</div>
                  <ul className="gv-layout-spec-list">
                    <li><strong>0px ~ 2px 硬朗边缘</strong>：剔除消费级大圆角与浮夸发光，纯粹依靠 1px 细槽线分离层级。</li>
                    <li><strong>无缝停靠网格</strong>：多窗格分屏严丝合缝，零留白浪费，追求极致桌面空间利用率。</li>
                    <li><strong>即时响应与零延迟</strong>：所有偏好无需重启应用，毫秒级注入 DOM 根节点并自动广播。</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部信息栏 */}
        <div className="gv-settings-footer">
          <span className="gv-settings-foot-info">
            GraphFramework SDK · 瑞士国际主义平面与工业工程设计规约
          </span>
          <button type="button" className="gv-action-tool-btn" onClick={onClose}>
            完成设置
          </button>
        </div>
      </div>
    </div>
  )
}
