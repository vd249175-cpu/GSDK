import { createContext, useContext } from 'react'
import {
  BookOpen,
  Compass,
  Sliders,
  Layers,
  Cpu,
} from 'lucide-react'
import type { PanelDefinition, PanelProps } from '@graphframework/workbench'

/* ==========================================================================
   类型定义与神格设定（多角色史诗因果录）
   ========================================================================== */
export interface DemoNodeView {
  nodeId: string
  generation: number | null
  state: Record<string, unknown>
}

export interface DemoEdgeView {
  from: string
  to: string
}

export interface DemoSnapshot {
  phase: number
  phaseLabel: string
  revision: number
  nodes: DemoNodeView[]
  edges: DemoEdgeView[]
}

export interface CharacterMeta {
  id: string
  name: string
  title: string
  glyph: string
  lore: string
  pos: { x: number; y: number }
}

export const CHARACTERS: Record<string, CharacterMeta> = {
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

export interface ProphecyAct {
  act: number
  title: string
  actTag: string
  foretold: string
  fulfillment: string
  kernelInsight: string
  featuredCharacters: string[]
}

export const PROPHECY_ACTS: ProphecyAct[] = [
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

export function summarizeDemoNode(entry: DemoNodeView): string {
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
   共享 Demo 上下文
   ========================================================================== */
export interface DemoContextValue {
  snapshot: DemoSnapshot | null
  selectedCharId: string
  setSelectedCharId: (id: string) => void
  viewingAct: number
  setViewingAct: (act: number) => void
  busy: boolean
  playing: boolean
  setPlaying: (p: boolean) => void
  runTopologyOp: (action: () => Promise<DemoSnapshot>) => Promise<void>
}

export const DemoContext = createContext<DemoContextValue | null>(null)

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error('useDemo must be used within DemoContextProvider')
  return ctx
}

/* ==========================================================================
   Panel 1: 【预言编织 · 命运古卷】 (demo.prophecy)
   ========================================================================== */
export function ProphecyPanel(_props: PanelProps) {
  const {
    snapshot,
    selectedCharId,
    setSelectedCharId,
    viewingAct,
    setViewingAct,
    busy,
    playing,
    setPlaying,
    runTopologyOp,
  } = useDemo()

  const currentAct = PROPHECY_ACTS[viewingAct] ?? PROPHECY_ACTS[0]
  const liveNodesMap = new Map((snapshot?.nodes ?? []).map((entry) => [entry.nodeId, entry]))

  return (
    <div className="panel-container prophecy-panel-root">
      {/* 篇章翻页器 */}
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
        <article className="prophecy-scroll">
          <header className="scroll-header">
            <div>
              <span className="scroll-act-tag">{currentAct.actTag}</span>
              <h1 className="scroll-title">{currentAct.title}</h1>
            </div>
          </header>

          <div className="scroll-content-box">
            <div className="foretold-card">
              <div className="foretold-label">
                <span>📜</span> 谶语 · 命定之预示
              </div>
              <p className="foretold-text">{currentAct.foretold}</p>
            </div>

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
        </aside>
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 2: 【因果星盘 · 天体拓扑】 (demo.astrolabe)
   ========================================================================== */
export function AstrolabePanel(_props: PanelProps) {
  const { snapshot, selectedCharId, setSelectedCharId } = useDemo()
  const live = new Map((snapshot?.nodes ?? []).map((entry) => [entry.nodeId, entry]))
  const routerDropped = Number(live.get('demo.router')?.state.dropped ?? 0)
  const selectedCharMeta = CHARACTERS[selectedCharId] ?? CHARACTERS['demo.orders']
  const selectedCharEntry = live.get(selectedCharId)

  return (
    <div className="panel-container astrolabe-panel-root">
      <div className="astrolabe-canvas-box">
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

          <circle cx="325" cy="190" r="160" fill="none" stroke="#252d4a" strokeWidth="1" strokeDasharray="3 6" opacity="0.6" />
          <circle cx="325" cy="190" r="110" fill="none" stroke="#2c3659" strokeWidth="1" strokeDasharray="4 8" opacity="0.4" />
          <circle cx="590" cy="46" r="22" fill="#fff5d9" opacity="0.85" filter="url(#celestialGlow)" />
          <circle cx="582" cy="40" r="20" fill="#0d1020" opacity="0.3" />

          {[
            [50, 45], [130, 30], [240, 56], [320, 30], [420, 48], [490, 85],
            [80, 330], [180, 345], [300, 340], [460, 335], [570, 320], [280, 110],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="#d0dbff" opacity="0.75" />
          ))}

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

          {Object.entries(CHARACTERS).map(([id, meta]) => {
            const entry = live.get(id)
            const isSelected = selectedCharId === id
            const isEvicted = !entry

            if (isEvicted) {
              return (
                <g
                  key={id}
                  onClick={() => setSelectedCharId(id)}
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
                onClick={() => setSelectedCharId(id)}
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

                <circle
                  cx={meta.pos.x}
                  cy={meta.pos.y}
                  r={isElevatedGen ? 22 : 18}
                  fill={isElevatedGen ? '#ffd76a' : '#5a78c8'}
                  opacity={isSelected ? 0.35 : 0.18}
                  filter="url(#celestialGlow)"
                />

                <circle
                  cx={meta.pos.x}
                  cy={meta.pos.y}
                  r="10"
                  fill={isElevatedGen ? '#ffd76a' : '#92b3ff'}
                  stroke="#0d1020"
                  strokeWidth="2"
                />

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

                <text x={meta.pos.x} y={meta.pos.y + 32} textAnchor="middle" fill="#a0adc9" fontSize="10">
                  {summarizeDemoNode(entry)}
                </text>
              </g>
            )
          })}

          {routerDropped > 0 && (
            <g transform="translate(195, 250)">
              <rect x="-65" y="-12" width="130" height="24" rx="12" fill="#2d1217" stroke="#ff5c5c" strokeWidth="1" />
              <text x="0" y="4" textAnchor="middle" fill="#ff8585" fontSize="11" fontWeight="bold">
                ✦ 虚空湮灭 (Dropped ×{routerDropped})
              </text>
            </g>
          )}
        </svg>
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
        <div style={{ fontSize: '11px', color: 'var(--content-tertiary)' }}>
          {selectedCharMeta.lore}
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 3: 【神格示波 · 状态透镜】 (demo.pantheon)
   ========================================================================== */
export function PantheonPanel(_props: PanelProps) {
  const { snapshot, selectedCharId, setSelectedCharId } = useDemo()
  const live = new Map((snapshot?.nodes ?? []).map((entry) => [entry.nodeId, entry]))
  const selectedCharMeta = CHARACTERS[selectedCharId] ?? CHARACTERS['demo.orders']
  const selectedCharEntry = live.get(selectedCharId)

  return (
    <div className="panel-container pantheon-panel-root">
      <div className="pantheon-layout">
        <div className="pantheon-roster">
          <div className="sidebar-title">神殿六神座</div>
          {Object.entries(CHARACTERS).map(([id, meta]) => {
            const entry = live.get(id)
            const isSelected = selectedCharId === id
            return (
              <div
                key={id}
                className={`character-card${isSelected ? ' is-selected' : ''}`}
                onClick={() => setSelectedCharId(id)}
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
                    {entry ? `GEN ${entry.generation}` : '离席'}
                  </span>
                </div>
                <div className="char-stat-summary">
                  {entry ? summarizeDemoNode(entry) : '神位空悬'}
                </div>
              </div>
            )
          })}
        </div>

        <div className="pantheon-scope">
          <div className="scope-header">
            <div className="scope-main-title">
              <div className="scope-char-symbol">{selectedCharMeta.glyph}</div>
              <div className="scope-title-text">
                <h2>{selectedCharMeta.name}</h2>
                <p>
                  {selectedCharMeta.title} · 万象坐标 <code>{selectedCharMeta.id}</code>
                </p>
              </div>
            </div>
            <span
              className={`char-gen-badge${
                (selectedCharEntry?.generation ?? 0) > 0 ? ' is-elevated' : ''
              }`}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              代次: GEN {selectedCharEntry ? selectedCharEntry.generation : '–'}
            </span>
          </div>

          <div style={{ fontSize: '13px', color: 'var(--content-secondary)', lineHeight: 1.6 }}>
            {selectedCharMeta.lore}
          </div>

          <div className="scope-grid">
            <div className="metric-card">
              <div className="metric-card-label">神座存续状态</div>
              <div className="metric-card-val" style={{ color: selectedCharEntry ? 'var(--state-success-fg)' : 'var(--state-danger-fg)' }}>
                {selectedCharEntry ? '在位守护' : '神位放逐'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card-label">生命代次 (Generation)</div>
              <div className="metric-card-val">
                {selectedCharEntry ? selectedCharEntry.generation : '—'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card-label">因果交互归属</div>
              <div className="metric-card-val" style={{ fontSize: '14px' }}>
                {selectedCharId === 'demo.orders' ? 'Root 外部发信源' : 'Domain 纯领域因果'}
              </div>
            </div>
          </div>

          <div>
            <div className="sidebar-title" style={{ marginBottom: '8px' }}>
              PROJECTION 解码私有状态 (DECODED STATE DTO)
            </div>
            <pre className="scope-json-box">
              {JSON.stringify(selectedCharEntry?.state ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 4: 【万象编年 · 终末法典】 (demo.chronicle)
   ========================================================================== */
export function ChroniclePanel(_props: PanelProps) {
  const { snapshot } = useDemo()
  const live = new Map((snapshot?.nodes ?? []).map((entry) => [entry.nodeId, entry]))
  const ledgerState = live.get('demo.ledger')?.state ?? {}
  const receiptsList = Array.isArray(ledgerState.receipts) ? ledgerState.receipts : []
  const reservationsList = Array.isArray(ledgerState.reservations) ? ledgerState.reservations : []
  const verdictsList = Array.isArray(ledgerState.verdicts) ? ledgerState.verdicts : []
  const routerState = live.get('demo.router')?.state ?? {}
  const routedCount = Number(routerState.routed ?? 0)
  const routerDropped = Number(routerState.dropped ?? 0)
  const screeningList = Array.isArray(routerState.screening) ? routerState.screening : []

  return (
    <div className="panel-container chronicle-panel-root">
      <div className="chronicle-layout">
        <div className="chronicle-summary-grid">
          <div className="metric-card">
            <div className="metric-card-label">⚖️ 黄金法典收讫 (Receipts)</div>
            <div className="metric-card-val" style={{ color: '#ffd76a' }}>
              {receiptsList.length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-card-label">🛡️ 泰坦神石镇守 (Reservations)</div>
            <div className="metric-card-val" style={{ color: '#92b3ff' }}>
              {reservationsList.length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-card-label">👁️ 真实之眼断言 (Verdicts)</div>
            <div className="metric-card-val" style={{ color: '#82e0aa' }}>
              {verdictsList.length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-card-label">✦ 虚空因果湮灭 (Dropped)</div>
            <div className="metric-card-val" style={{ color: routerDropped > 0 ? '#ff6060' : 'var(--content-tertiary)' }}>
              {routerDropped}
            </div>
          </div>
        </div>

        <div className="chronicle-split">
          <div className="chronicle-book">
            <div className="sidebar-title">终末天平 · 世界卷轴流水账</div>
            <div className="chronicle-records-list">
              {receiptsList.length === 0 && reservationsList.length === 0 && verdictsList.length === 0 ? (
                <div style={{ color: 'var(--content-tertiary)', fontSize: '12px', padding: '16px' }}>
                  卷轴空白，尚无因果汇聚……
                </div>
              ) : (
                <>
                  {receiptsList.map((item, index) => (
                    <div className="chronicle-record-item" key={`rec-${index}`}>
                      <span className="record-tag is-gold">金印回执</span>
                      <code>{JSON.stringify(item)}</code>
                    </div>
                  ))}
                  {reservationsList.map((item, index) => (
                    <div className="chronicle-record-item" key={`res-${index}`}>
                      <span className="record-tag is-blue">神石定额</span>
                      <code>{JSON.stringify(item)}</code>
                    </div>
                  ))}
                  {verdictsList.map((item, index) => (
                    <div className="chronicle-record-item" key={`ver-${index}`}>
                      <span className="record-tag is-green">破妄断言</span>
                      <code>{JSON.stringify(item)}</code>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="chronicle-book">
            <div className="sidebar-title">枢机长老 · 星轨折射日志</div>
            <div className="chronicle-records-list">
              <div className="chronicle-record-item">
                <span className="record-tag">累计分发</span>
                <span>{routedCount} 枚星辰诏令</span>
              </div>
              <div className="chronicle-record-item">
                <span className="record-tag">湮灭信件</span>
                <span style={{ color: routerDropped > 0 ? '#ff8585' : 'inherit' }}>
                  {routerDropped} 枚因果断点 (Dropped)
                </span>
              </div>
              <div className="chronicle-record-item">
                <span className="record-tag">筛查节点挂接</span>
                <span>[{screeningList.join(', ') || '未挂接'}]</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 5: 【内核基石 · 规约底座】 (demo.kernel)
   ========================================================================== */
export function KernelPanel(_props: PanelProps) {
  const { snapshot } = useDemo()

  return (
    <div className="panel-container kernel-panel-root">
      <div className="sidebar-title">Rust 微内核 RuleSpace 权威图状态投影</div>
      <div style={{ fontSize: '11px', color: 'var(--content-tertiary)', marginBottom: '12px' }}>
        物理调度由 Rust 微内核运行，无业务语义微内核；本面板为从 IPC 缓存读取到的已解码 State 投影。
      </div>
      <pre className="scope-json-box" style={{ height: 'calc(100% - 60px)', margin: 0 }}>
        {JSON.stringify(snapshot ?? {}, null, 2)}
      </pre>
    </div>
  )
}

/* ==========================================================================
   面板定义集合 (供 Workbench 注册)
   ========================================================================== */
export const DEMO_PANEL_DEFINITIONS: PanelDefinition[] = [
  {
    id: 'demo.prophecy',
    title: '预言编织 · 命运古卷',
    icon: BookOpen,
    component: ProphecyPanel,
  },
  {
    id: 'demo.astrolabe',
    title: '因果星盘 · 天体拓扑',
    icon: Compass,
    component: AstrolabePanel,
  },
  {
    id: 'demo.pantheon',
    title: '神格示波 · 状态透镜',
    icon: Sliders,
    component: PantheonPanel,
  },
  {
    id: 'demo.chronicle',
    title: '万象编年 · 终末法典',
    icon: Layers,
    component: ChroniclePanel,
  },
  {
    id: 'demo.kernel',
    title: '内核基石 · 规约底座',
    icon: Cpu,
    component: KernelPanel,
  },
]
