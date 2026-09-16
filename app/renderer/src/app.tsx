import { useCallback, useEffect, useRef, useState } from 'react'
import '@graphvideo/sdk/workbench/styles.css'
import './app.css'

declare global {
  interface Window {
    graph: {
      incrementCounter: () => Promise<{ count: number }>
      readCounter: () => Promise<{ count: number }>
    }
    demo: {
      readState: () => Promise<DemoSnapshot>
      step: () => Promise<DemoSnapshot>
      reset: () => Promise<DemoSnapshot>
    }
    shell?: {
      minimize: () => void
      toggleMaximize: () => void
      close: () => void
    }
  }
}

const THEMES = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'xueqing', label: '雪青' },
  { value: 'shiliuqun', label: '石榴裙' },
] as const

type ThemeValue = (typeof THEMES)[number]['value']

const THEME_STORAGE_KEY = 'example.theme'
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

function readInitialTheme(): ThemeValue {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (THEMES.some((entry) => entry.value === saved)) return saved as ThemeValue
  } catch {
    // 隐私模式等场景直接回退默认主题。
  }
  return 'dark'
}

/* ==========================================================================
   类型定义与神格设定（多角色史诗因果录）
   ========================================================================== */
interface DemoNodeView {
  nodeId: string
  generation: number | null
  state: Record<string, unknown>
}

interface DemoEdgeView {
  from: string
  to: string
}

interface DemoSnapshot {
  phase: number
  phaseLabel: string
  revision: number
  nodes: DemoNodeView[]
  edges: DemoEdgeView[]
}

interface CharacterMeta {
  id: string
  name: string
  title: string
  glyph: string
  lore: string
  pos: { x: number; y: number }
}

const CHARACTERS: Record<string, CharacterMeta> = {
  'demo.orders': {
    id: 'demo.orders',
    name: '神谕司祭·艾尔',
    title: '万象星盘持有者',
    glyph: '🌟',
    lore: '居于苍穹圣坛之巅，每次转动星盘便掷出一枚命定诏令（SubmitOrder），点燃全域因果之线。',
    pos: { x: 70, y: 190 },
  },
  'demo.router': {
    id: 'demo.router',
    name: '星轨枢机使·罗盘长老',
    title: '命运棱镜执掌者',
    glyph: '🪐',
    lore: '执掌以太星晶雕琢的命运棱镜，折射并引动因果流光至各神殿，能感应神座坍塌并记录熄灭星痕（Dropped）。',
    pos: { x: 195, y: 190 },
  },
  'demo.billing': {
    id: 'demo.billing',
    name: '金律贤者·弥达斯',
    title: '神圣法典裁定者',
    glyph: '⚖️',
    lore: '手持永不磨损的金羽笔，在黄金法典上核算每一笔因果对价，向终末天平呈递不灭的金印回执。',
    pos: { x: 345, y: 70 },
  },
  'demo.fraud': {
    id: 'demo.fraud',
    name: '虚空巡察使·深渊审判官',
    title: '真实之眼破妄者',
    glyph: '👁️',
    lore: '本隐于界壁裂隙，当因果动荡时被大密咒召入神殿（Admit），以真实之眼洞穿诏令并烙印破妄断言。',
    pos: { x: 345, y: 190 },
  },
  'demo.inventory': {
    id: 'demo.inventory',
    name: '山岳巨灵·守库泰坦',
    title: '星核神石镇守者',
    glyph: '🛡️',
    lore: '手托星核宝库，曾于天劫风暴中神格破碎坠入深渊（Evict），黎明时洗尽铅华以二转神格重生（Gen 1）。',
    pos: { x: 345, y: 310 },
  },
  'demo.ledger': {
    id: 'demo.ledger',
    name: '命运编织之母·终末天平',
    title: '万象法典终汇者',
    glyph: '📜',
    lore: '端坐于因果终焉的神圣天平前，将四方奔流的金印回执、巨灵神石与审判断言汇聚编织进不朽的世界卷轴。',
    pos: { x: 555, y: 190 },
  },
}

/* ==========================================================================
   预言六幕（The 6 Prophecy Acts）
   ========================================================================== */
interface ProphecyAct {
  act: number
  title: string
  actTag: string
  foretold: string
  fulfillment: string
  kernelInsight: string
  featuredCharacters: string[]
}

const PROPHECY_ACTS: ProphecyAct[] = [
  {
    act: 0,
    title: '星盘初启·众神就位',
    actTag: 'Act 0 · Genesis',
    foretold:
      '“万籁寂静，星轨未启。古卷谶语：神谕司祭艾尔将掷出命运之矢，因果之轮划破长夜，黄金贤者与山岳巨灵将自沉睡中醒来。”',
    fulfillment: '天地初开，五大主神位装配就绪，星轨静止，静候第一道命定诏令注入。',
    kernelInsight: '微内核装配完成；demo 域拓扑 5 节点处于初态，尚未注入任何 Root Info。',
    featuredCharacters: ['demo.orders', 'demo.router'],
  },
  {
    act: 1,
    title: '因果奔涌·双星入账',
    actTag: 'Act I · The Flow',
    foretold:
      '“预言言道：双星飞驰！金律殿中金印生辉，神库之内神石共鸣，两道命定回执已汇入终末天平。”',
    fulfillment: '艾尔司祭连续降下两道星辰诏令（order-1, order-2）。金律贤者与守库巨灵顺利结算，终末天平已平稳收讫。',
    kernelInsight: '稳态因果流转：OrderPlaced 经 router 扇出，下游独立处理并提交 ReceiptPosted、StockReserved。',
    featuredCharacters: ['demo.billing', 'demo.inventory', 'demo.ledger'],
  },
  {
    act: 2,
    title: '深渊破界·巡察降临',
    actTag: 'Act II · The Inquisitor',
    foretold:
      '“预言言道：极北虚空雷鸣，深渊巡察使破界而来！枢机长老将施展星轨牵引术，将审判之眼接入命运棱镜……”',
    fulfillment: '运行中动态接纳（Admit）：虚空巡察使已降临圣坛！星轨枢机使已将其挂接至筛查网络（AttachScreening）。',
    kernelInsight: '运行时动态装载：RuleSpace.mountDomainNode(FraudNode)，并在 router 状态写入 screening 白名单。',
    featuredCharacters: ['demo.fraud', 'demo.router'],
  },
  {
    act: 3,
    title: '破妄银印·真言刻册',
    actTag: 'Act III · Silver Verdict',
    foretold:
      '“预言言道：第三道神谕降临之时，虚妄终将无所遁形。审判官的破妄银印将与黄金法典并列，永驻终末之卷。”',
    fulfillment: '新诏令（order-3）穿梭星轨！虚空审判官睁开真实之眼，向终末天平铭刻下首道破妄断言（order-3:clear）！',
    kernelInsight: '新拓扑接管流量：router 向 fraud 发送 ScreenOrder，新节点参与因果结算并生成 FraudVerdict。',
    featuredCharacters: ['demo.fraud', 'demo.ledger'],
  },
  {
    act: 4,
    title: '天劫裂空·巨灵陨落',
    actTag: 'Act IV · The Cataclysm',
    foretold:
      '“预言言道：血色天劫裂空！守护星核的巨灵将被褫夺神格、坠入虚空！飞向神殿的星火将在深渊中化作湮灭的灰烬……”',
    fulfillment: '天劫降临：山岳巨灵被动态驱逐（Evict）！飞往仓库的信件在虚空中湮灭（Dropped +1）。但金律与审判依然如常结算，因果之网巍然不倒！',
    kernelInsight: '轻量投递反馈：目标节点被 unregister，发送方 send 返回 dropped，而整个提交不受阻断、原子结算。',
    featuredCharacters: ['demo.inventory', 'demo.router'],
  },
  {
    act: 5,
    title: '神格重铸·二转涅槃',
    actTag: 'Act V · Rebirth',
    foretold:
      '“预言言道：长夜尽头是破晓！巨灵于涅槃神火中重铸神躯，头顶二转神环（Generation 1），洗净铅华以纯净初生之体归位！”',
    fulfillment: '黎明重登神坛：山岳巨灵同 ID 重准入成功！代次跃升为 1，清空旧劫因果从零开始，重新稳健守护新诏令（order-5）！',
    kernelInsight: '同 ID 重准入代次自增（Generation +1），以纯净初值启动，彻底摒弃脏状态残留。',
    featuredCharacters: ['demo.inventory', 'demo.ledger'],
  },
]

type PageTabKey = 'prophecy' | 'astrolabe' | 'pantheon' | 'chronicle' | 'sandbox'

const PAGE_TABS: { key: PageTabKey; label: string; icon: string; badge?: string }[] = [
  { key: 'prophecy', label: '预言编织', icon: '📜' },
  { key: 'astrolabe', label: '因果星盘', icon: '🌌' },
  { key: 'pantheon', label: '神格示波', icon: '⚖️' },
  { key: 'chronicle', label: '万象编年', icon: '🏛️' },
  { key: 'sandbox', label: '内核基石', icon: '⚡', badge: 'DTO' },
]

function summarizeDemoNode(entry: DemoNodeView): string {
  const list = (key: string): unknown[] => {
    const value = entry.state[key]
    return Array.isArray(value) ? value : []
  }
  switch (entry.nodeId) {
    case 'demo.orders':
      return `降下诏令: ${String(entry.state.placed ?? 0)}`
    case 'demo.router': {
      const screening = list('screening').join(',') || '–'
      return `分发: ${String(entry.state.routed ?? 0)} | 湮灭: ${String(entry.state.dropped ?? 0)} | 挂接: [${screening}]`
    }
    case 'demo.billing':
      return `金印回执: ${list('billed').length}`
    case 'demo.inventory':
      return `镇守神石: ${list('reserved').length}`
    case 'demo.ledger':
      return `金印: ${list('receipts').length} | 神石: ${list('reservations').length} | 破妄: ${list('verdicts').length}`
    case 'demo.fraud':
      return `审判定谳: ${list('screened').length}`
    default:
      return entry.nodeId
  }
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2 - 28
  return `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`
}

/* ==========================================================================
   星盘主画面 SVG
   ========================================================================== */
function AstrolabeScene({
  snapshot,
  selectedCharId,
  onSelectChar,
}: {
  snapshot: DemoSnapshot | null
  selectedCharId: string
  onSelectChar: (id: string) => void
}) {
  const live = new Map((snapshot?.nodes ?? []).map((entry) => [entry.nodeId, entry]))
  const routerDropped = Number(live.get('demo.router')?.state.dropped ?? 0)

  return (
    <svg viewBox="0 0 650 380" width="100%" height="100%" role="img" aria-label="因果星盘">
      <defs>
        <radialGradient id="celestialSpace" cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#1e233d" />
          <stop offset="60%" stopColor="#0d1020" />
          <stop offset="100%" stopColor="#05060b" />
        </radialGradient>
        <filter id="celestialGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <rect x="0" y="0" width="650" height="380" fill="url(#celestialSpace)" />

      {/* 苍穹天体与黄道星环 */}
      <circle cx="325" cy="190" r="160" fill="none" stroke="#252d4a" strokeWidth="1" strokeDasharray="3 6" opacity="0.6" />
      <circle cx="325" cy="190" r="110" fill="none" stroke="#2c3659" strokeWidth="1" strokeDasharray="4 8" opacity="0.4" />
      <circle cx="590" cy="46" r="22" fill="#fff5d9" opacity="0.85" filter="url(#celestialGlow)" />
      <circle cx="582" cy="40" r="20" fill="#0d1020" opacity="0.3" />

      {/* 散落群星 */}
      {[
        [50, 45], [130, 30], [240, 56], [320, 30], [420, 48], [490, 85],
        [80, 330], [180, 345], [300, 340], [460, 335], [570, 320], [280, 110],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="#d0dbff" opacity="0.75" />
      ))}

      {/* 因果命运金线 */}
      {(snapshot?.edges ?? []).map((edge) => {
        const from = CHARACTERS[edge.from]
        const to = CHARACTERS[edge.to]
        if (!from || !to) return null
        const d = edgePath(from.pos, to.pos)
        return (
          <g key={`${edge.from}->${edge.to}`}>
            <path d={d} fill="none" stroke="#5d6e94" strokeWidth="1.6" strokeDasharray="4 4" opacity="0.75" />
            {[0, 1].map((i) => (
              <circle key={i} r="3" fill="#ffd76a" filter="url(#celestialGlow)">
                <animateMotion dur={`${2.2 + i * 1.1}s`} begin={`${-i * 1.2}s`} repeatCount="indefinite" path={d} />
              </circle>
            ))}
          </g>
        )
      })}

      {/* 六大神格节点 */}
      {Object.entries(CHARACTERS).map(([id, meta]) => {
        const entry = live.get(id)
        const isSelected = selectedCharId === id
        const isEvicted = !entry

        if (isEvicted) {
          return (
            <g
              key={id}
              onClick={() => onSelectChar(id)}
              style={{ cursor: 'pointer' }}
              opacity="0.45"
            >
              <circle
                cx={meta.pos.x}
                cy={meta.pos.y}
                r="18"
                fill="none"
                stroke="#ff6060"
                strokeWidth="1.6"
                strokeDasharray="4 4"
              />
              <text x={meta.pos.x} y={meta.pos.y - 24} textAnchor="middle" fill="#ff9090" fontSize="11" fontWeight="bold">
                {meta.glyph} {meta.name}
              </text>
              <text x={meta.pos.x} y={meta.pos.y + 32} textAnchor="middle" fill="#ff7070" fontSize="10">
                [神位剥离·坠入深渊]
              </text>
            </g>
          )
        }

        const gen = entry.generation ?? 0
        const isElevatedGen = gen > 0

        return (
          <g
            key={id}
            onClick={() => onSelectChar(id)}
            style={{ cursor: 'pointer' }}
          >
            {isSelected && (
              <circle
                cx={meta.pos.x}
                cy={meta.pos.y}
                r="28"
                fill="none"
                stroke="#ffd76a"
                strokeWidth="2"
                strokeDasharray="6 3"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from={`0 ${meta.pos.x} ${meta.pos.y}`}
                  to={`360 ${meta.pos.x} ${meta.pos.y}`}
                  dur="8s"
                  repeatCount="indefinite"
                />
              </circle>
            )}

            {/* 节点外光晕 */}
            <circle
              cx={meta.pos.x}
              cy={meta.pos.y}
              r={isElevatedGen ? 22 : 18}
              fill={isElevatedGen ? '#ffd76a' : '#5a78c8'}
              opacity={isSelected ? 0.35 : 0.18}
              filter="url(#celestialGlow)"
            />

            {/* 核心法球 */}
            <circle
              cx={meta.pos.x}
              cy={meta.pos.y}
              r="10"
              fill={isElevatedGen ? '#ffd76a' : '#92b3ff'}
              stroke="#0d1020"
              strokeWidth="2"
            />

            {/* 神格代次光环 */}
            {isElevatedGen && (
              <circle
                cx={meta.pos.x}
                cy={meta.pos.y}
                r="15"
                fill="none"
                stroke="#ffd76a"
                strokeWidth="1.2"
                strokeDasharray="2 3"
              />
            )}

            {/* 角色名称与代次 */}
            <text
              x={meta.pos.x}
              y={meta.pos.y - 24}
              textAnchor="middle"
              fill="#f5f7fc"
              fontSize="12"
              fontWeight={isSelected ? 'bold' : 'normal'}
            >
              {meta.glyph} {meta.name}
              {isElevatedGen ? ` [GEN ${gen} 涅槃]` : ` @${gen}`}
            </text>

            {/* 状态简报 */}
            <text x={meta.pos.x} y={meta.pos.y + 32} textAnchor="middle" fill="#a0adc9" fontSize="10">
              {summarizeDemoNode(entry)}
            </text>
          </g>
        )
      })}

      {/* 湮灭星痕告警 */}
      {routerDropped > 0 && (
        <g transform="translate(195, 250)">
          <rect x="-65" y="-12" width="130" height="24" rx="12" fill="#2d1217" stroke="#ff5c5c" strokeWidth="1" />
          <text x="0" y="4" textAnchor="middle" fill="#ff8585" fontSize="11" fontWeight="bold">
            ✦ 虚空湮灭 (Dropped ×{routerDropped})
          </text>
        </g>
      )}
    </svg>
  )
}

/* ==========================================================================
   主应用组件
   ========================================================================== */
export function App() {
  const [activeTab, setActiveTab] = useState<PageTabKey>('prophecy')
  const [selectedCharId, setSelectedCharId] = useState<string>('demo.orders')
  const [viewingAct, setViewingAct] = useState<number>(0)
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [theme, setTheme] = useState<ThemeValue>(readInitialTheme)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [pendingCounter, setPendingCounter] = useState(false)
  const busyRef = useRef(false)

  // 主题注入
  useEffect(() => {
    if (theme === 'dark') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // 存储失败忽略
    }
  }, [theme])

  // 刷新计数
  const refreshCounter = useCallback(async () => {
    try {
      const state = await window.graph.readCounter()
      setCount(state.count)
    } catch {
      setCount(null)
    }
  }, [])

  // 刷新拓扑演示
  const refreshDemo = useCallback(async () => {
    try {
      const s = await window.demo.readState()
      setSnapshot(s)
    } catch {
      setSnapshot(null)
    }
  }, [])

  useEffect(() => {
    refreshCounter()
    refreshDemo()
    const timer = setInterval(() => {
      refreshDemo()
    }, 1000)
    return () => clearInterval(timer)
  }, [refreshCounter, refreshDemo])

  // 当 snapshot phase 改变时，若 viewingAct 在跟随，则同步
  useEffect(() => {
    if (snapshot) {
      setViewingAct(snapshot.phase)
    }
  }, [snapshot?.phase])

  // 运行拓扑动作
  const runTopologyOp = useCallback(
    async (action: () => Promise<DemoSnapshot>) => {
      setBusy(true)
      busyRef.current = true
      try {
        const next = await action()
        setSnapshot(next)
      } finally {
        setBusy(false)
        busyRef.current = false
      }
    },
    [],
  )

  // 播放控制
  useEffect(() => {
    if (!playing) return
    if (snapshot && snapshot.phase >= 5) {
      setPlaying(false)
      return
    }
    const timer = setInterval(() => {
      if (busyRef.current) return
      runTopologyOp(() => window.demo.step()).catch(() => setPlaying(false))
    }, 3800)
    return () => clearInterval(timer)
  }, [playing, snapshot, runTopologyOp])

  // 计数器递增
  const incrementCounter = useCallback(async () => {
    setPendingCounter(true)
    try {
      await window.graph.incrementCounter()
      await refreshCounter()
    } finally {
      setPendingCounter(false)
    }
  }, [refreshCounter])

  const connected = typeof count === 'number'
  const currentAct = PROPHECY_ACTS[viewingAct] ?? PROPHECY_ACTS[0]
  const liveNodesMap = new Map((snapshot?.nodes ?? []).map((entry) => [entry.nodeId, entry]))
  const selectedCharMeta = CHARACTERS[selectedCharId] ?? CHARACTERS['demo.orders']
  const selectedCharEntry = liveNodesMap.get(selectedCharId)

  // 总账统计
  const ledgerState = liveNodesMap.get('demo.ledger')?.state ?? {}
  const receiptsList = Array.isArray(ledgerState.receipts) ? ledgerState.receipts : []
  const reservationsList = Array.isArray(ledgerState.reservations) ? ledgerState.reservations : []
  const verdictsList = Array.isArray(ledgerState.verdicts) ? ledgerState.verdicts : []
  const routerDropped = Number(liveNodesMap.get('demo.router')?.state.dropped ?? 0)

  return (
    <div className="app-shell">
      {/* 顶栏：品牌 + 全局因果推演集群 + 主题与窗口控制 */}
      <header className={`app-topbar${isMac ? ' is-mac' : ''}`}>
        <div className="brand-cluster">
          <span className="brand-glyph">🪐</span>
          <span className="app-title">星辰因果仪 · 达芬奇工作台</span>
          <span className="topbar-phase-badge">
            <i className="topbar-phase-dot" />
            第 {snapshot ? snapshot.phase : 0} 幕 / 5
          </span>
        </div>

        <span className="topbar-spacer" />

        {/* 全局因果推进快捷工具组（跨分页一致可用） */}
        <div className="topbar-actions" role="toolbar" aria-label="推演控制">
          <button
            type="button"
            className="action-btn is-primary"
            disabled={!snapshot || busy || playing}
            onClick={() => void runTopologyOp(() => window.demo.step())}
            title="驱动因果流转进入下一幕"
          >
            {busy && !playing ? '应验中…' : '⚡ 应验此言'}
          </button>
          <button
            type="button"
            className="action-btn"
            disabled={!snapshot || busy}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? '⏸ 暂停演进' : '▶ 宣讲预言'}
          </button>
          <button
            type="button"
            className="action-btn"
            disabled={!snapshot || busy}
            onClick={() => void runTopologyOp(() => window.demo.reset())}
          >
            ↺ 重溯
          </button>
        </div>

        {/* 主题切换 */}
        <div className="theme-switch" role="group" aria-label="主题">
          {THEMES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={theme === entry.value}
              onClick={() => setTheme(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {/* 窗口三键 */}
        {!isMac && window.shell && (
          <div className="window-controls">
            <button type="button" title="最小化" onClick={() => window.shell?.minimize()}>
              —
            </button>
            <button type="button" title="最大化/恢复" onClick={() => window.shell?.toggleMaximize()}>
              ▢
            </button>
            <button type="button" className="window-close" title="关闭" onClick={() => window.shell?.close()}>
              ✕
            </button>
          </div>
        )}
      </header>

      {/* 工作区主内容区：由当前 DaVinci 分页切换驱动 */}
      <main className="app-content">
        {/* ==================================================================
            分页 1：【预言编织 (Prophecy)】
            ================================================================== */}
        {activeTab === 'prophecy' && (
          <div className="page-container">
            {/* 篇章翻页器 (Chapter Pagination) */}
            <div className="chapter-stepper" role="navigation" aria-label="篇章翻页">
              {PROPHECY_ACTS.map((act) => {
                const isCurrentPhase = snapshot?.phase === act.act
                const isFulfilled = (snapshot?.phase ?? 0) > act.act
                const isActiveView = viewingAct === act.act
                return (
                  <button
                    key={act.act}
                    type="button"
                    className={`chapter-step-btn${isActiveView ? ' is-active' : ''}${
                      isFulfilled ? ' is-fulfilled' : ''
                    }`}
                    onClick={() => setViewingAct(act.act)}
                  >
                    <span className="chapter-step-num">ACT {act.act}</span>
                    <span>{act.title}</span>
                    {isCurrentPhase && <span className="dock-badge">当前</span>}
                  </button>
                )
              })}
            </div>

            <div className="prophecy-layout">
              {/* 预言古卷主卡片 */}
              <article className="prophecy-scroll">
                <header className="scroll-header">
                  <div>
                    <span className="scroll-act-tag">{currentAct.actTag}</span>
                    <h1 className="scroll-title">{currentAct.title}</h1>
                  </div>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setActiveTab('astrolabe')}
                  >
                    前往星盘观象 →
                  </button>
                </header>

                <div className="scroll-content-box">
                  {/* 谶言框 */}
                  <div className="foretold-card">
                    <div className="foretold-label">
                      <span>📜</span> 谶语 · 命定之预示
                    </div>
                    <p className="foretold-text">{currentAct.foretold}</p>
                  </div>

                  {/* 应验框 */}
                  <div className="fulfillment-card">
                    <div className="fulfillment-label">
                      <span>⚡</span> 现实应验 · 因果流变
                    </div>
                    <p className="fulfillment-text">
                      {snapshot && snapshot.phase >= currentAct.act
                        ? currentAct.fulfillment
                        : '因果尚未行至此幕，等待预言之音应验……'}
                    </p>
                    <div className="kernel-insight">
                      <strong>🏛️ 微内核法则映射：</strong> {currentAct.kernelInsight}
                    </div>
                  </div>
                </div>

                <footer className="ritual-controls">
                  <button
                    type="button"
                    className="ritual-primary-btn"
                    disabled={!snapshot || busy || playing || (snapshot?.phase ?? 0) >= 5}
                    onClick={() => void runTopologyOp(() => window.demo.step())}
                  >
                    {busy ? '因果运转中…' : '🔮 应验此言 · 驱动命运之轮'}
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    disabled={!snapshot || busy}
                    onClick={() => setPlaying(!playing)}
                  >
                    {playing ? '⏸ 暂停演进' : '▶ 连续宣讲'}
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    disabled={!snapshot || busy}
                    onClick={() => void runTopologyOp(() => window.demo.reset())}
                  >
                    ↺ 命运重溯
                  </button>
                </footer>
              </article>

              {/* 右侧：本幕出场神格名录与联动交互 */}
              <aside className="prophecy-sidebar">
                <h2 className="sidebar-title">本幕焦点神格 (点击联动选视)</h2>
                {currentAct.featuredCharacters.map((charId) => {
                  const meta = CHARACTERS[charId]
                  if (!meta) return null
                  const entry = liveNodesMap.get(charId)
                  const isSelected = selectedCharId === charId
                  return (
                    <div
                      key={charId}
                      className={`character-card${isSelected ? ' is-selected' : ''}`}
                      onClick={() => setSelectedCharId(charId)}
                    >
                      <div className="char-header">
                        <div className="char-name-group">
                          <span className="char-glyph">{meta.glyph}</span>
                          <span className="char-name">{meta.name}</span>
                        </div>
                        <span
                          className={`char-gen-badge${
                            (entry?.generation ?? 0) > 0 ? ' is-elevated' : ''
                          }`}
                        >
                          {entry ? `GEN ${entry.generation}` : '已放逐'}
                        </span>
                      </div>
                      <div className="char-title">{meta.title}</div>
                      <div className="char-stat-summary">
                        {entry ? summarizeDemoNode(entry) : '神位空悬，静待重生'}
                      </div>
                    </div>
                  )
                })}

                <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                  <button
                    type="button"
                    className="action-btn"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => setActiveTab('pantheon')}
                  >
                    查看选中神格【{selectedCharMeta.name}】示波器 →
                  </button>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* ==================================================================
            分页 2：【因果星盘 (Astrolabe - Fusion 节点图风格)】
            ================================================================== */}
        {activeTab === 'astrolabe' && (
          <div className="page-container">
            <div className="astrolabe-layout">
              <div className="astrolabe-canvas-box">
                <AstrolabeScene
                  snapshot={snapshot}
                  selectedCharId={selectedCharId}
                  onSelectChar={(id) => setSelectedCharId(id)}
                />
              </div>

              <div className="astrolabe-inspector-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px' }}>{selectedCharMeta.glyph}</span>
                  <div>
                    <strong style={{ fontSize: '13px' }}>{selectedCharMeta.name}</strong>
                    <span style={{ fontSize: '11px', color: 'var(--content-secondary)', marginLeft: '8px' }}>
                      {selectedCharMeta.title} · {selectedCharEntry ? `代次: GEN ${selectedCharEntry.generation}` : '状态: 离席'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setActiveTab('pantheon')}
                  >
                    在神格示波中透视 →
                  </button>
                  <button
                    type="button"
                    className="action-btn is-primary"
                    disabled={!snapshot || busy}
                    onClick={() => void runTopologyOp(() => window.demo.step())}
                  >
                    推进因果
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            分页 3：【神格示波 (Pantheon - Color 调色与示波器风格)】
            ================================================================== */}
        {activeTab === 'pantheon' && (
          <div className="page-container">
            <div className="pantheon-layout">
              {/* 左侧：六神座阵列 */}
              <div className="pantheon-roster">
                <h2 className="sidebar-title">神殿六神座</h2>
                {Object.values(CHARACTERS).map((meta) => {
                  const entry = liveNodesMap.get(meta.id)
                  const isSelected = selectedCharId === meta.id
                  const isElevated = (entry?.generation ?? 0) > 0
                  return (
                    <div
                      key={meta.id}
                      className={`character-card${isSelected ? ' is-selected' : ''}`}
                      onClick={() => setSelectedCharId(meta.id)}
                    >
                      <div className="char-header">
                        <div className="char-name-group">
                          <span className="char-glyph">{meta.glyph}</span>
                          <span className="char-name">{meta.name}</span>
                        </div>
                        <span className={`char-gen-badge${isElevated ? ' is-elevated' : ''}`}>
                          {entry ? `GEN ${entry.generation}` : '离席'}
                        </span>
                      </div>
                      <div className="char-stat-summary">
                        {entry ? summarizeDemoNode(entry) : '神位放逐'}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* 右侧：当前选中神格的深度属性示波器 */}
              <div className="pantheon-scope">
                <div className="scope-header">
                  <div className="scope-main-title">
                    <div className="scope-char-symbol">{selectedCharMeta.glyph}</div>
                    <div className="scope-title-text">
                      <h2>{selectedCharMeta.name}</h2>
                      <p>{selectedCharMeta.title} · <code>{selectedCharMeta.id}</code></p>
                    </div>
                  </div>
                  <span
                    className={`char-gen-badge${
                      (selectedCharEntry?.generation ?? 0) > 0 ? ' is-elevated' : ''
                    }`}
                    style={{ fontSize: '13px', padding: '4px 12px' }}
                  >
                    {selectedCharEntry ? `代次: GEN ${selectedCharEntry.generation}` : '神位放逐'}
                  </span>
                </div>

                <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6', color: 'var(--content-secondary)' }}>
                  {selectedCharMeta.lore}
                </p>

                {/* 状态指标卡片阵列 */}
                <div className="scope-grid">
                  <div className="metric-card">
                    <div className="metric-card-label">神座存续状态</div>
                    <div className="metric-card-val" style={{ color: selectedCharEntry ? 'var(--state-success-fg)' : 'var(--state-danger-fg)' }}>
                      {selectedCharEntry ? '在位守护' : '已放逐 (Evicted)'}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-card-label">生命代次 (Generation)</div>
                    <div className="metric-card-val">
                      {selectedCharEntry?.generation ?? '—'}
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-card-label">因果交互归属</div>
                    <div className="metric-card-val" style={{ fontSize: '15px' }}>
                      {selectedCharMeta.id === 'demo.orders' && 'Root 外部发信源'}
                      {selectedCharMeta.id === 'demo.router' && '枢机多路分流器'}
                      {selectedCharMeta.id === 'demo.billing' && '确定性金融结算'}
                      {selectedCharMeta.id === 'demo.fraud' && '动态挂接审查网'}
                      {selectedCharMeta.id === 'demo.inventory' && '代次重塑物料库'}
                      {selectedCharMeta.id === 'demo.ledger' && '终末因果汇总台'}
                    </div>
                  </div>
                </div>

                {/* 解码后的只读私有 State JSON */}
                <div>
                  <h3 style={{ margin: '0 0 8px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--content-secondary)' }}>
                    Projection 解码私有状态 (Decoded State DTO)
                  </h3>
                  <pre className="scope-json-box">
                    {JSON.stringify(selectedCharEntry?.state ?? { status: 'Evicted from RuleSpace' }, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            分页 4：【万象编年 (Chronicle & Ledger - Fairlight 调音/交付风格)】
            ================================================================== */}
        {activeTab === 'chronicle' && (
          <div className="page-container">
            <div className="chronicle-layout">
              {/* 指标矩阵 */}
              <div className="chronicle-stats-grid">
                <div className="metric-card">
                  <div className="metric-card-label">金律殿收据总数 (Receipts)</div>
                  <div className="metric-card-val" style={{ color: '#ffd76a' }}>
                    {receiptsList.length}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-card-label">巨灵殿神石总数 (Reservations)</div>
                  <div className="metric-card-val" style={{ color: '#64b4ff' }}>
                    {reservationsList.length}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-card-label">审判官破妄印记 (Verdicts)</div>
                  <div className="metric-card-val" style={{ color: '#b48cff' }}>
                    {verdictsList.length}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-card-label">虚空湮灭告警 (Dropped)</div>
                  <div className="metric-card-val" style={{ color: routerDropped > 0 ? 'var(--state-danger-fg)' : 'var(--content-tertiary)' }}>
                    {routerDropped}
                  </div>
                </div>
              </div>

              {/* 终末天平事件瀑布流 */}
              <div className="ledger-feed-box">
                <h2 className="ledger-feed-title">
                  <span>📜 终末天平因果记账流 (Ledger Event Stream)</span>
                  <span style={{ fontSize: '11px', color: 'var(--content-tertiary)' }}>
                    Revision = {snapshot?.revision ?? 0}
                  </span>
                </h2>

                <div className="ledger-item-list">
                  {receiptsList.map((item, idx) => (
                    <div key={`receipt-${idx}`} className="ledger-item">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="ledger-type-badge receipt">金律收据</span>
                        <code>{String(item)}</code>
                      </span>
                      <span style={{ color: 'var(--content-tertiary)' }}>经 金律贤者·弥达斯 核算记账</span>
                    </div>
                  ))}

                  {reservationsList.map((item, idx) => (
                    <div key={`res-${idx}`} className="ledger-item">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="ledger-type-badge reservation">神石封存</span>
                        <code>{String(item)}</code>
                      </span>
                      <span style={{ color: 'var(--content-tertiary)' }}>由 山岳巨灵·守库泰坦 镇守入库</span>
                    </div>
                  ))}

                  {verdictsList.map((item, idx) => (
                    <div key={`verd-${idx}`} className="ledger-item">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="ledger-type-badge verdict">破妄裁决</span>
                        <code>{String(item)}</code>
                      </span>
                      <span style={{ color: 'var(--content-tertiary)' }}>由 虚空巡察使 审判定谳</span>
                    </div>
                  ))}

                  {receiptsList.length === 0 && reservationsList.length === 0 && verdictsList.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '30px', color: 'var(--content-tertiary)' }}>
                      终末天平尚处于静止，静待预言之令流注……
                    </div>
                  )}
                </div>

                <div className="hint" style={{ marginTop: 'auto' }}>
                  因果图核心准则：节点间通信只走 <code>ctx.send</code>，禁止全局广播或旁路修改；
                  节点被驱逐（Evict）后只返回 <code>dropped</code> 反馈，事务结算保持原子收敛。
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            分页 5：【内核基石 (Core Sandbox)】
            ================================================================== */}
        {activeTab === 'sandbox' && (
          <div className="page-container">
            <div className="counter-sandbox-layout">
              <section className="counter-card">
                <p className="counter-label">Projection 派生计数（Hello Counter）</p>
                <p className="count-value" data-testid="count">
                  {connected ? count : '–'}
                </p>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!connected || pendingCounter}
                  onClick={incrementCounter}
                >
                  {pendingCounter ? '授权提交中…' : 'Increment 计数跃迁'}
                </button>
                <p className="hint">
                  {connected
                    ? '写入经插件 rendererRoots 白名单校验授权，读取走 Projection DTO。'
                    : '主进程未连接（浏览器预览模式只看样式）。'}
                  <br />
                  因果用 <code>npm run diagnose -- change example.counter::IncrementInfo</code> 查看。
                </p>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* ==================================================================
          类达芬奇风格底部页面导航坞 (DaVinci Dock)
          ================================================================== */}
      <nav className="davinci-dock" aria-label="达芬奇工作区分页">
        {PAGE_TABS.map((tab, idx) => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              className={`dock-item${isActive ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className="dock-icon">{tab.icon}</span>
              <span className="dock-label">
                {tab.label}
                {tab.badge && <span className="dock-badge">{tab.badge}</span>}
              </span>
            </button>
          )
        })}
      </nav>

      {/* 极客监控底栏 */}
      <footer className="app-footer">
        <span>
          <i className={`connection-dot${connected ? '' : ' is-offline'}`} />
          {connected ? 'RuleSpace 状态已连接' : 'State 未连接'}
        </span>
        <span className="footer-meta-tag">
          Rev: <code>{snapshot?.revision ?? 0}</code>
        </span>
        <span className="footer-meta-tag">
          焦点神格: <code>{selectedCharMeta.name}</code>
        </span>
        <span className="footer-spacer" />
        <span>GraphFramework · DaVinci Creative Suite Demo</span>
      </footer>
    </div>
  )
}
