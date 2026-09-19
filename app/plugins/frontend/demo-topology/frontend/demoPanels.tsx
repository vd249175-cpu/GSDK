import { createContext, useContext, useMemo } from 'react'
import {
  BookOpen,
  Compass,
  Sliders,
  Layers,
  Cpu,
} from 'lucide-react'
import type { PanelDefinition, PanelProps } from '@graphframework/workbench'
import {
  NodeCard,
  IndustrialChip,
  PropertySection,
  PropertyRow,
} from '@graphframework/ui'

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
  x: number
  y: number
  hasInput: boolean
  hasOutput: boolean
}

export const CHARACTERS: Record<string, CharacterMeta> = {
  'demo.orders': {
    id: 'demo.orders',
    name: '神谕司祭·艾尔',
    title: '万象星盘持有者',
    glyph: '🌟',
    lore: '居于苍穹圣坛之巅，每次转动星盘便掷出一枚命定诏令（SubmitOrder），点燃全域因果之线。',
    x: 20,
    y: 110,
    hasInput: false,
    hasOutput: true,
  },
  'demo.router': {
    id: 'demo.router',
    name: '星轨枢机使·罗盘长老',
    title: '命运棱镜执掌者',
    glyph: '🪐',
    lore: '执掌以太星晶雕琢的命运棱镜，折射并引动因果流光至各神殿，能感应神座坍塌并记录熄灭星痕（Dropped）。',
    x: 230,
    y: 110,
    hasInput: true,
    hasOutput: true,
  },
  'demo.billing': {
    id: 'demo.billing',
    name: '金律贤者·弥达斯',
    title: '神圣法典裁定者',
    glyph: '⚖️',
    lore: '手持永不磨损的金羽笔，在黄金法典上核算每一笔因果对价，向终末天平呈递不灭的金印回执。',
    x: 450,
    y: 16,
    hasInput: true,
    hasOutput: true,
  },
  'demo.fraud': {
    id: 'demo.fraud',
    name: '虚空巡察使·深渊审判官',
    title: '真实之眼破妄者',
    glyph: '👁️',
    lore: '本隐于界壁裂隙，当因果动荡时被大密咒召入神殿（Admit），以真实之眼洞穿诏令并烙印破妄断言。',
    x: 450,
    y: 110,
    hasInput: true,
    hasOutput: true,
  },
  'demo.inventory': {
    id: 'demo.inventory',
    name: '山岳巨灵·守库泰坦',
    title: '星核神石镇守者',
    glyph: '🛡️',
    lore: '手托星核宝库，曾于天劫风暴中神格破碎坠入深渊（Evict），黎明时洗尽铅华以二转神格重生（Gen 1）。',
    x: 450,
    y: 204,
    hasInput: true,
    hasOutput: true,
  },
  'demo.ledger': {
    id: 'demo.ledger',
    name: '命运编织之母·终末天平',
    title: '万象法典终汇者',
    glyph: '📜',
    lore: '端坐于因果终焉的神圣天平前，将四方奔流的金印回执、巨灵神石与审判断言汇聚编织进不朽的世界卷轴。',
    x: 670,
    y: 110,
    hasInput: true,
    hasOutput: false,
  },
}

export const DAG_CONDUITS: Array<{ from: string; to: string }> = [
  { from: 'demo.orders', to: 'demo.router' },
  { from: 'demo.router', to: 'demo.billing' },
  { from: 'demo.router', to: 'demo.fraud' },
  { from: 'demo.router', to: 'demo.inventory' },
  { from: 'demo.billing', to: 'demo.ledger' },
  { from: 'demo.fraud', to: 'demo.ledger' },
  { from: 'demo.inventory', to: 'demo.ledger' },
]

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
      '“预言言道：当第七颗因果之星划破太虚，圣坛之上的神谕司祭将掷出首枚命定诏令。星盘转动，沉睡的诸神自长夜苏醒……”',
    fulfillment: '微内核启动完毕，基础神殿就绪（Orders, Router, Billing, Inventory, Ledger 在位，代次 GEN 0）。等待第一声神谕召唤。',
    kernelInsight: '阶段初始化：静态组装（Assemble）后准入（Admit），节点处于 Gen 0 干净初始态。',
    featuredCharacters: ['demo.orders', 'demo.router'],
  },
  {
    act: 1,
    title: '因果奔涌·双星入账',
    actTag: 'Act I · Dual Echoes',
    foretold:
      '“预言言道：星轨初辟，一念动而双星应。金律贤者展阅黄金法典，山岳泰坦捧出守护神石，终末天平铭刻下最初的印记。”',
    fulfillment: '首枚诏令（order-1）穿越命运棱镜！金律贤者如实核算，守库泰坦如数备石，终末天平已记下首道完备回执！',
    kernelInsight: '静态拓扑扩散：单个 Input 经 Router 扇出（Fan-out）至 Billing 与 Inventory，最终原子汇聚于 Ledger。',
    featuredCharacters: ['demo.billing', 'demo.inventory'],
  },
  {
    act: 2,
    title: '大密咒动·虚空巡察',
    actTag: 'Act II · The Summoning',
    foretold:
      '“预言言道：当第二道星芒破晓，界壁裂隙间将降下隐秘的巡察使。祂睁开真实之眼，自虚空之中降临神殿，洞察一切因果的伪饰。”',
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

function getNodeProperties(nodeId: string, state?: Record<string, unknown>) {
  if (!state) return []
  const list = (key: string): unknown[] => {
    const value = state[key]
    return Array.isArray(value) ? value : []
  }
  switch (nodeId) {
    case 'demo.orders':
      return [{ label: 'Placed', value: String(state.placed ?? 0), monospace: true }]
    case 'demo.router':
      return [
        { label: 'Routed', value: String(state.routed ?? 0), monospace: true },
        { label: 'Dropped', value: String(state.dropped ?? 0), monospace: true },
      ]
    case 'demo.billing':
      return [{ label: 'Billed', value: String(list('billed').length), monospace: true }]
    case 'demo.fraud':
      return [{ label: 'Screened', value: String(list('screened').length), monospace: true }]
    case 'demo.inventory':
      return [{ label: 'Reserved', value: String(list('reserved').length), monospace: true }]
    case 'demo.ledger':
      return [
        { label: 'Receipts', value: String(list('receipts').length), monospace: true },
        { label: 'Settled', value: String(list('reservations').length), monospace: true },
      ]
    default:
      return []
  }
}

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
      {/* 篇章步进工具条 */}
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
              <span className="chapter-step-num is-mono">ACT {act.act}</span>
              <span>{act.title}</span>
              {isCurrentPhase && (
                <IndustrialChip label="CURRENT" tone="accent" monospace />
              )}
            </button>
          )
        })}
      </div>

      <div className="prophecy-layout">
        <article className="prophecy-scroll">
          <header className="scroll-header">
            <div>
              <IndustrialChip label={currentAct.actTag} tone="accent" monospace />
              <h1 className="scroll-title">{currentAct.title}</h1>
            </div>
          </header>

          <div className="scroll-content-box">
            <div className="foretold-card">
              <div className="foretold-label">
                <IndustrialChip label="Foretold · 谶语预示" monospace />
              </div>
              <p className="foretold-text">{currentAct.foretold}</p>
            </div>

            <div className="fulfillment-card">
              <div className="fulfillment-label">
                <IndustrialChip
                  label="Fulfillment · 因果应验"
                  tone={snapshot && snapshot.phase >= currentAct.act ? 'success' : 'muted'}
                  monospace
                />
              </div>
              <p className="fulfillment-text">
                {snapshot && snapshot.phase >= currentAct.act
                  ? currentAct.fulfillment
                  : '因果尚未行至此幕，等待预言之音应验……'}
              </p>
              <div className="kernel-insight is-mono">
                [KERNEL_RULE] {currentAct.kernelInsight}
              </div>
            </div>
          </div>

          <footer className="ritual-controls">
            <button
              type="button"
              className="gv-action-tool-btn is-primary"
              disabled={!snapshot || busy || playing || (snapshot?.phase ?? 0) >= 5}
              onClick={() => void runTopologyOp(() => window.demo.step())}
            >
              {busy ? '因果运转中…' : '⚡ 应验此言 · 驱动命运之轮'}
            </button>
            <button
              type="button"
              className="gv-action-tool-btn"
              disabled={!snapshot || busy}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? '⏸ 暂停演进' : '▶ 连续宣讲'}
            </button>
            <button
              type="button"
              className="gv-action-tool-btn"
              disabled={!snapshot || busy}
              onClick={() => void runTopologyOp(() => window.demo.reset())}
            >
              ↺ 命运重溯
            </button>
          </footer>
        </article>

        <aside className="prophecy-sidebar">
          <div className="sidebar-section-title">焦点神格 (FOCUS NODE)</div>
          <div className="prophecy-node-list">
            {currentAct.featuredCharacters.map((charId) => {
              const meta = CHARACTERS[charId]
              if (!meta) return null
              const entry = liveNodesMap.get(charId)
              const isSelected = selectedCharId === charId
              return (
                <NodeCard
                  key={charId}
                  nodeId={charId}
                  title={meta.name}
                  subtitle={meta.title}
                  generation={entry?.generation ?? null}
                  status={entry ? 'ONLINE' : 'OFFLINE'}
                  statusTone={entry ? 'active' : 'evicted'}
                  selected={isSelected}
                  properties={getNodeProperties(charId, entry?.state)}
                  onClick={() => setSelectedCharId(charId)}
                />
              )
            })}
          </div>
        </aside>
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 2: 【因果拓扑 · 工业节点图】 (demo.astrolabe)
   ========================================================================== */
export function AstrolabePanel(_props: PanelProps) {
  const { snapshot, selectedCharId, setSelectedCharId } = useDemo()
  const live = new Map((snapshot?.nodes ?? []).map((entry) => [entry.nodeId, entry]))
  const routerDropped = Number(live.get('demo.router')?.state.dropped ?? 0)
  const selectedCharMeta = CHARACTERS[selectedCharId] ?? CHARACTERS['demo.orders']
  const selectedCharEntry = live.get(selectedCharId)

  return (
    <div className="panel-container causal-dag-root">
      {/* 顶部工程 HUD 信息条 */}
      <div className="dag-hud-bar">
        <div className="dag-hud-left">
          <span className="dag-hud-title">CAUSAL ROUTING DAG · 权威规则空间拓扑</span>
          <IndustrialChip label={`NODES: ${snapshot?.nodes.length ?? 0}`} monospace />
          <IndustrialChip label={`REVISION: ${snapshot?.revision ?? 0}`} tone="accent" monospace />
          {routerDropped > 0 && (
            <IndustrialChip label={`DROPPED ×${routerDropped}`} tone="danger" monospace />
          )}
        </div>
        <div className="dag-hud-right">
          <span className="dag-hud-hint">点击节点检视因果状态 · 矢量正交导管实时寻路</span>
        </div>
      </div>

      {/* 节点图主画布 */}
      <div className="dag-canvas-container">
        {/* SVG 导管连线层 */}
        <svg className="dag-conduits-layer" width="100%" height="100%">
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <polygon points="0 0, 6 3, 0 6" fill="#334155" />
            </marker>
            <marker id="arrowhead-active" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <polygon points="0 0, 6 3, 0 6" fill="#38bdf8" />
            </marker>
          </defs>

          {DAG_CONDUITS.map((edge) => {
            const fromNode = CHARACTERS[edge.from]
            const toNode = CHARACTERS[edge.to]
            if (!fromNode || !toNode) return null
            const x1 = fromNode.x + 180
            const y1 = fromNode.y + 44
            const x2 = toNode.x
            const y2 = toNode.y + 44
            const dx = Math.max(30, (x2 - x1) * 0.5)
            const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
            const isAlive = live.has(edge.from) && live.has(edge.to)
            const isDroppedEdge = edge.to === 'demo.inventory' && !live.has('demo.inventory')

            return (
              <g key={`${edge.from}->${edge.to}`} className={`conduit-group${isAlive ? ' is-alive' : ' is-broken'}`}>
                <path
                  d={pathD}
                  className={`conduit-path${isAlive ? ' is-active' : ''}${isDroppedEdge ? ' is-dropped' : ''}`}
                  markerEnd={isAlive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                />
                {isAlive && (
                  <circle r="2.5" fill="#facc15">
                    <animateMotion dur="2.4s" repeatCount="indefinite" path={pathD} />
                  </circle>
                )}
              </g>
            )
          })}
        </svg>

        {/* DOM 工业节点层 */}
        <div className="dag-nodes-layer">
          {Object.entries(CHARACTERS).map(([id, meta]) => {
            const entry = live.get(id)
            const isSelected = selectedCharId === id
            const gen = entry?.generation ?? null
            const isEvicted = !entry && id === 'demo.inventory'
            const isUnmounted = !entry && id === 'demo.fraud'

            let statusLabel = 'ACTIVE'
            let statusTone: 'idle' | 'active' | 'warning' | 'danger' | 'evicted' = 'active'
            if (isEvicted) {
              statusLabel = 'EVICTED'
              statusTone = 'evicted'
            } else if (isUnmounted) {
              statusLabel = 'UNMOUNTED'
              statusTone = 'idle'
            }

            const props = getNodeProperties(id, entry?.state)

            return (
              <div
                key={id}
                className="dag-node-wrapper"
                style={{
                  position: 'absolute',
                  left: meta.x,
                  top: meta.y,
                  width: 180,
                }}
              >
                <NodeCard
                  nodeId={id}
                  title={meta.name}
                  subtitle={meta.title}
                  generation={gen}
                  status={statusLabel}
                  statusTone={statusTone}
                  selected={isSelected}
                  ports={{
                    in: meta.hasInput ? [{ id: `${id}:in`, active: Boolean(entry) }] : undefined,
                    out: meta.hasOutput ? [{ id: `${id}:out`, active: Boolean(entry) }] : undefined,
                  }}
                  properties={props}
                  onClick={() => setSelectedCharId(id)}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部工业检视栏 */}
      <div className="dag-inspector-bar">
        <div className="dag-inspector-left">
          <span className="dag-inspector-glyph">{selectedCharMeta.glyph}</span>
          <div>
            <div className="dag-inspector-id-row">
              <span className="dag-inspector-id is-mono">{selectedCharMeta.id}</span>
              <span className="dag-inspector-name">{selectedCharMeta.name}</span>
              <IndustrialChip
                label={selectedCharEntry ? `GEN ${selectedCharEntry.generation}` : 'OFFLINE'}
                tone={selectedCharEntry ? 'accent' : 'danger'}
                monospace
              />
            </div>
            <div className="dag-inspector-lore">{selectedCharMeta.lore}</div>
          </div>
        </div>
        <div className="dag-inspector-right">
          <span className="dag-inspector-dto-label">DECODED STATE</span>
          <code className="dag-inspector-dto is-mono">
            {JSON.stringify(selectedCharEntry?.state ?? {})}
          </code>
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
          <div className="sidebar-section-title">神殿六神座 (NODE MATRIX)</div>
          <div className="pantheon-cards-grid">
            {Object.entries(CHARACTERS).map(([id, meta]) => {
              const entry = live.get(id)
              const isSelected = selectedCharId === id
              return (
                <NodeCard
                  key={id}
                  nodeId={id}
                  title={meta.name}
                  subtitle={meta.title}
                  generation={entry?.generation ?? null}
                  status={entry ? 'ONLINE' : 'OFFLINE'}
                  statusTone={entry ? 'active' : 'evicted'}
                  selected={isSelected}
                  properties={getNodeProperties(id, entry?.state)}
                  onClick={() => setSelectedCharId(id)}
                />
              )
            })}
          </div>
        </div>

        <div className="pantheon-scope">
          <div className="scope-header">
            <div className="scope-main-title">
              <div className="scope-char-symbol">{selectedCharMeta.glyph}</div>
              <div className="scope-title-text">
                <h2>{selectedCharMeta.name}</h2>
                <p className="is-mono">
                  {selectedCharMeta.title} · <code>{selectedCharMeta.id}</code>
                </p>
              </div>
            </div>
            <IndustrialChip
              label={`GEN ${selectedCharEntry ? selectedCharEntry.generation : '–'}`}
              tone={(selectedCharEntry?.generation ?? 0) > 0 ? 'elevated' : 'default'}
              monospace
            />
          </div>

          <div className="scope-lore-text">
            {selectedCharMeta.lore}
          </div>

          <div className="scope-grid">
            <div className="metric-card">
              <div className="metric-card-label">神座存续状态</div>
              <div className="metric-card-val" style={{ color: selectedCharEntry ? 'var(--status-success)' : 'var(--status-danger)' }}>
                {selectedCharEntry ? '在位守护' : '神位放逐'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card-label">生命代次 (Generation)</div>
              <div className="metric-card-val is-mono">
                {selectedCharEntry ? selectedCharEntry.generation : '—'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-card-label">因果交互归属</div>
              <div className="metric-card-val" style={{ fontSize: '12px' }}>
                {selectedCharId === 'demo.orders' ? 'Root 外部发信源' : 'Domain 纯领域因果'}
              </div>
            </div>
          </div>

          <div className="scope-dto-section">
            <div className="sidebar-section-title">
              PROJECTION 解码私有状态 (DECODED STATE DTO)
            </div>
            <pre className="scope-json-box is-mono">
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

  return (
    <div className="panel-container chronicle-panel-root">
      <div className="chronicle-layout">
        <div className="chronicle-summary-grid">
          <div className="metric-card">
            <div className="metric-card-label">黄金法典收讫 (Receipts)</div>
            <div className="metric-card-val is-mono" style={{ color: '#ffd76a' }}>
              {receiptsList.length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-card-label">泰坦神石镇守 (Reservations)</div>
            <div className="metric-card-val is-mono" style={{ color: '#92b3ff' }}>
              {reservationsList.length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-card-label">真实之眼断言 (Verdicts)</div>
            <div className="metric-card-val is-mono" style={{ color: '#82e0aa' }}>
              {verdictsList.length}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-card-label">虚空因果湮灭 (Dropped)</div>
            <div className="metric-card-val is-mono" style={{ color: routerDropped > 0 ? '#ef4444' : 'var(--text-tertiary)' }}>
              {routerDropped}
            </div>
          </div>
        </div>

        <div className="chronicle-split">
          <div className="chronicle-book">
            <div className="sidebar-section-title">终末天平 · 世界卷轴流水账</div>
            <div className="chronicle-records-list">
              {receiptsList.length === 0 && reservationsList.length === 0 && verdictsList.length === 0 ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: '11px', padding: '16px' }}>
                  卷轴空白，尚无因果汇聚……
                </div>
              ) : (
                <>
                  {receiptsList.map((item, index) => (
                    <div className="chronicle-record-item" key={`rec-${index}`}>
                      <IndustrialChip label="金印回执" tone="elevated" monospace />
                      <code className="is-mono">{JSON.stringify(item)}</code>
                    </div>
                  ))}
                  {reservationsList.map((item, index) => (
                    <div className="chronicle-record-item" key={`res-${index}`}>
                      <IndustrialChip label="神石定额" tone="accent" monospace />
                      <code className="is-mono">{JSON.stringify(item)}</code>
                    </div>
                  ))}
                  {verdictsList.map((item, index) => (
                    <div className="chronicle-record-item" key={`ver-${index}`}>
                      <IndustrialChip label="破妄断言" tone="success" monospace />
                      <code className="is-mono">{JSON.stringify(item)}</code>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="chronicle-book">
            <div className="sidebar-section-title">枢机长老 · 路由折射流水</div>
            <div className="chronicle-records-list">
              <div className="chronicle-record-item">
                <IndustrialChip label="累计分发" tone="default" monospace />
                <span className="is-mono">{routedCount} 条星辰诏令</span>
              </div>
              <div className="chronicle-record-item">
                <IndustrialChip label="湮灭信件" tone={routerDropped > 0 ? 'danger' : 'muted'} monospace />
                <span className="is-mono">{routerDropped} 条（因果断链）</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 5: 【内核基石 · 权威调度】 (demo.kernel)
   ========================================================================== */
export function KernelPanel(_props: PanelProps) {
  const { snapshot, busy, playing, setPlaying, runTopologyOp } = useDemo()

  return (
    <div className="panel-container kernel-panel-root">
      <div className="kernel-layout">
        <div className="kernel-card">
          <div className="sidebar-section-title">微内核状态探针 (KERNEL OBSERVABILITY)</div>
          <div className="scope-grid">
            <div className="metric-card">
              <div className="metric-card-label">全域拓扑修订 (Revision)</div>
              <div className="metric-card-val is-mono">{snapshot?.revision ?? 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card-label">准入节点数 (Admitted)</div>
              <div className="metric-card-val is-mono">{snapshot?.nodes.length ?? 0}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card-label">因果导轨数 (Edges)</div>
              <div className="metric-card-val is-mono">{snapshot?.edges.length ?? 0}</div>
            </div>
          </div>

          <div style={{ marginTop: '16px' }}>
            <div className="sidebar-section-title">权威调度操作控制台</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                className="gv-action-tool-btn is-primary"
                disabled={!snapshot || busy || playing}
                onClick={() => void runTopologyOp(() => window.demo.step())}
              >
                ⚡ 提交推演信件 (SubmitOrder)
              </button>
              <button
                type="button"
                className="gv-action-tool-btn"
                disabled={!snapshot || busy}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? '⏸ 暂停自动推演' : '▶ 启动时钟演进'}
              </button>
              <button
                type="button"
                className="gv-action-tool-btn"
                disabled={!snapshot || busy}
                onClick={() => void runTopologyOp(() => window.demo.reset())}
              >
                ↺ 全域清零重溯
              </button>
            </div>
          </div>

          <div style={{ marginTop: '16px' }}>
            <div className="sidebar-section-title">全量快照原始 DTO (RAW SNAPSHOT JSON)</div>
            <pre className="scope-json-box is-mono" style={{ maxHeight: '280px' }}>
              {JSON.stringify(snapshot ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Panel 注册表：导出标准 PanelDefinition
   ========================================================================== */
export const DEMO_PANEL_DEFINITIONS: PanelDefinition[] = [
  {
    id: 'demo.prophecy',
    title: '预言编织',
    icon: BookOpen,
    component: ProphecyPanel,
  },
  {
    id: 'demo.astrolabe',
    title: '因果拓扑',
    icon: Compass,
    component: AstrolabePanel,
  },
  {
    id: 'demo.pantheon',
    title: '神格示波',
    icon: Sliders,
    component: PantheonPanel,
  },
  {
    id: 'demo.chronicle',
    title: '万象编年',
    icon: Layers,
    component: ChroniclePanel,
  },
  {
    id: 'demo.kernel',
    title: '内核基石',
    icon: Cpu,
    component: KernelPanel,
  },
]
