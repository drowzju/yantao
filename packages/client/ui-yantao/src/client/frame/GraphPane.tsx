/**
 * The 图谱 tab's pane (ADR-0049, interactions per ADR-0051): the whole KB's
 * typed relation graph — person–project, area–project, person–person — as a
 * force-directed SVG. The simulation lives in `graph/graphLayout.ts`; view
 * filtering lives in `graph/subgraph.ts`. This component feeds the sim
 * frames, renders the result, and owns the viewport state machine: wheel
 * zoom (0.5×–4×, cursor-anchored), background-drag pan, node drag,
 * single-click focus (delayed for double-click disambiguation) and
 * double-click open.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { KbRelationGraphResult, KbWireRelationEdge } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { createLayout, stepLayout, type ForceLayout } from '../graph/graphLayout.ts'
import { defaultEnabledKinds, kindOf, visibleSubgraph } from '../graph/subgraph.ts'
import { tabTitle } from '../tabs.ts'
import { tabItemActiveStyle, tabItemStyle } from '../buttons.ts'
import type { WorkbenchT } from '../locales.ts'

/** The pane's fixed coordinate space; the SVG scales it to fit. */
const VIEW_W = 1000
const VIEW_H = 700

/** A pointer gesture shorter than this is a click, not a drag (screen px). */
const CLICK_SLOP_PX = 5

/** The rAF relaxation loop's starting heat, decay, and floor. */
const INITIAL_ALPHA = 0.9
const ALPHA_DECAY = 0.985
const ALPHA_FLOOR = 0.008

/** The viewport's zoom bounds and the focus preset (ADR-0051). */
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const FOCUS_ZOOM = 2
/** The focused node's enlargement factor. */
const FOCUS_NODE_SCALE = 1.4
/** How long a single click waits for a possible second one. */
const CLICK_DELAY_MS = 250
/** The focus viewport animation's duration. */
const FOCUS_ANIM_MS = 300
/** Non-neighbour dimming while focused. */
const DIM_OPACITY = 0.15

/** Node fill/stroke per entity kind, from the yt-tokens palette. */
const FILL: Record<'project' | 'person' | 'area', string> = {
  project: 'var(--yt-accent)',
  person: 'var(--yt-success)',
  area: 'var(--yt-warning)',
}

/** Edge stroke per relation kind. */
const EDGE_STROKE: Record<KbWireRelationEdge['kind'], string> = {
  'person-project': 'var(--yt-accent)',
  'area-project': 'var(--yt-success)',
  'person-person': 'var(--yt-border-strong)',
}

/** The viewport transform: scale about the origin, then translate. */
interface View {
  k: number
  x: number
  y: number
}

/** The identity viewport — the layout's own coordinate space. */
const IDENTITY_VIEW: View = { k: 1, x: 0, y: 0 }

/** Clamp a zoom factor into the viewport's bounds. */
function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
}

/** Cubic ease-in-out, for the focus animation. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Map client (screen) coordinates into the SVG's viewBox space, honouring the
 * element's on-screen placement. Null when the environment cannot answer
 * (jsdom has no `getScreenCTM`).
 */
function clientToView(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  // jsdom ships no getScreenCTM — the typeof guard keeps tests out of trouble.
  if (typeof svg.getScreenCTM !== 'function') return null
  const ctm = svg.getScreenCTM()
  if (ctm === null) return null
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return { x: point.x, y: point.y }
}

/** The relation kind an edge carries, judged from its endpoints' kinds. */
function edgeKindOf(from: string, to: string): KbWireRelationEdge['kind'] {
  const a = kindOf(from)
  const b = kindOf(to)
  const project = a === 'project' || b === 'project'
  if (a === 'person' || b === 'person') return project ? 'person-project' : 'person-person'
  return 'area-project'
}

/** How many edges touch each node, for the isolated-node dimming. */
function degreesOf(edges: readonly KbWireRelationEdge[]): Map<string, number> {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  return degree
}

/** One node's shape, centred on its position. */
function NodeShape({ kind, isolated }: { kind: 'project' | 'person' | 'area'; isolated: boolean }): ReactElement {
  const fill = isolated ? 'var(--yt-surface-raised)' : FILL[kind]
  const stroke = isolated ? 'var(--yt-border-strong)' : 'none'
  if (kind === 'project') {
    return <circle r={11} fill={fill} stroke={stroke} strokeWidth={1.5} />
  }
  if (kind === 'person') {
    return <rect x={-12} y={-9} width={24} height={18} rx={7} fill={fill} stroke={stroke} strokeWidth={1.5} />
  }
  return <polygon points="0,-13 13,0 0,13 -13,0" fill={fill} stroke={stroke} strokeWidth={1.5} />
}

/** Graph pane props. */
export interface GraphPaneProps {
  /** The whole KB's typed relation graph. */
  readonly data: KbRelationGraphResult
  /** Open one entity on double-click (the frame's file-tab gesture, ADR-0051). */
  readonly onOpen: (path: string) => void
  /** Re-read the whole KB's graph (the frame's reload; absent in tests). */
  readonly onReload?: (() => void) | undefined
  readonly t: WorkbenchT
}

/** The two optional views around the permanent person–person base. */
interface ExtraViews {
  areaProject: boolean
  personProject: boolean
}

/**
 * Render the relation graph: a force simulation behind an SVG viewport.
 * @param props - see {@link GraphPaneProps}.
 * @returns the pane element.
 */
export function GraphPane({ data, onOpen, onReload, t }: GraphPaneProps): ReactElement {
  // 图谱/列表双视图（2026-10-14 impeccable P2 修复）：力导图只认指针事件，
  // 对键盘与读屏是整面白墙——列表视图是同一数据的文本通道，节点行是真
  // 按钮（回车打开实体），关系逐行成文；图例过滤对两个视图同样生效。
  const [mode, setMode] = useState<'graph' | 'list'>('graph')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const layoutRef = useRef<ForceLayout | null>(null)
  const alphaRef = useRef(0)
  const dragRef = useRef<{ index: number; lastX: number; lastY: number; moved: number } | null>(null)
  const panRef = useRef<{ lastX: number; lastY: number; moved: number } | null>(null)
  const [, bump] = useState(0)
  /** The live relaxation loop's frame handle, so a reheat can restart it. */
  const rafRef = useRef(0)
  /** The viewport transform — mirrored in a ref so gesture closures read fresh. */
  const [view, setViewState] = useState<View>(IDENTITY_VIEW)
  const viewRef = useRef<View>(IDENTITY_VIEW)
  /** The focus animation's frame handle. */
  const viewAnimRef = useRef(0)
  /** The pending single-click timer, cancelled when a double-click lands. */
  const clickTimerRef = useRef<number | null>(null)
  /** The focused node, mirrored for the gesture closures. */
  const [focusId, setFocusId] = useState<string | null>(null)
  const focusRef = useRef<string | null>(null)
  /** The viewport as it was before the current focus began. */
  const savedViewRef = useRef<View | null>(null)
  /** The two optional views; the person–person base is always on. */
  const [extra, setExtra] = useState<ExtraViews>({ areaProject: false, personProject: false })

  const applyView = useCallback((next: View): void => {
    viewRef.current = next
    setViewState(next)
  }, [])

  const cancelViewAnim = useCallback((): void => {
    cancelAnimationFrame(viewAnimRef.current)
  }, [])

  /** Tween the viewport to `target` over {@link FOCUS_ANIM_MS}. */
  const animateView = useCallback((target: View): void => {
    cancelViewAnim()
    const from = viewRef.current
    const start = performance.now()
    const step = (): void => {
      const p = Math.min(1, (performance.now() - start) / FOCUS_ANIM_MS)
      const e = easeInOut(p)
      applyView({
        k: from.k + (target.k - from.k) * e,
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
      })
      if (p < 1) viewAnimRef.current = requestAnimationFrame(step)
    }
    viewAnimRef.current = requestAnimationFrame(step)
  }, [applyView, cancelViewAnim])

  const exitFocus = useCallback((): void => {
    if (focusRef.current === null) return
    focusRef.current = null
    setFocusId(null)
    const saved = savedViewRef.current
    savedViewRef.current = null
    if (saved !== null) animateView(saved)
  }, [animateView])

  /** Enter or switch focus: centre the node at the focus zoom. */
  const enterFocus = useCallback((id: string): void => {
    const node = layoutRef.current?.nodes.find(candidate => candidate.id === id)
    if (node === undefined) return
    if (focusRef.current === null) savedViewRef.current = viewRef.current
    focusRef.current = id
    setFocusId(id)
    const k = Math.max(viewRef.current.k, FOCUS_ZOOM)
    animateView({ k, x: VIEW_W / 2 - k * node.x, y: VIEW_H / 2 - k * node.y })
  }, [animateView])

  const toggleFocus = useCallback((id: string): void => {
    if (focusRef.current === id) exitFocus()
    else enterFocus(id)
  }, [enterFocus, exitFocus])

  // The loop dies once alpha sinks under the floor; a drag's reheat must be
  // able to bring it back, so starting it is a named move, not an effect
  // birthright. Restarting a live loop is harmless (cancel + relaunch).
  const startLoop = useCallback((): void => {
    cancelAnimationFrame(rafRef.current)
    const loop = (): void => {
      const layout = layoutRef.current
      if (layout === null) return
      stepLayout(layout, alphaRef.current)
      alphaRef.current *= ALPHA_DECAY
      bump(value => value + 1)
      if (alphaRef.current >= ALPHA_FLOOR) rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  // The visible subgraph under the view switches; the layout rebuilds on it.
  const enabled = useMemo(() => {
    const kinds = defaultEnabledKinds()
    if (extra.areaProject) kinds.add('area-project')
    if (extra.personProject) kinds.add('person-project')
    return kinds
  }, [extra])
  const filtered = useMemo(() => visibleSubgraph(data, enabled), [data, enabled])

  // A new payload or view combination rebuilds the layout and reheats.
  // 列表视图不养模拟（2026-10-14 复评 P3 修复）：看不见的力导每帧白转还
  // 带着 bump 重渲染；切回图谱时本 effect 重跑并 reheat。
  useEffect(() => {
    if (mode === 'list') return
    layoutRef.current = createLayout(filtered.nodes, filtered.edges, VIEW_W, VIEW_H)
    alphaRef.current = INITIAL_ALPHA
    startLoop()
    return () => { cancelAnimationFrame(rafRef.current) }
  }, [filtered, startLoop, mode])

  // Wheel zoom, cursor-anchored. A native non-passive listener, because the
  // synthetic onWheel cannot preventDefault reliably.
  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const viewPt = clientToView(svg, event.clientX, event.clientY)
      if (viewPt === null) return
      const current = viewRef.current
      const gx = (viewPt.x - current.x) / current.k
      const gy = (viewPt.y - current.y) / current.k
      const k = clampZoom(current.k * Math.exp(-event.deltaY * 0.0015))
      cancelViewAnim()
      applyView({ k, x: viewPt.x - k * gx, y: viewPt.y - k * gy })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => { svg.removeEventListener('wheel', onWheel) }
  }, [applyView, cancelViewAnim])

  // Pending gestures die with the pane.
  useEffect(() => () => {
    if (clickTimerRef.current !== null) clearTimeout(clickTimerRef.current)
    cancelAnimationFrame(viewAnimRef.current)
  }, [])

  const degree = degreesOf(filtered.edges)

  /** The focused node plus its neighbours, or null when unfocused. */
  const neighbours = useMemo(() => {
    if (focusId === null) return null
    const set = new Set<string>([focusId])
    for (const edge of filtered.edges) {
      if (edge.from === focusId) set.add(edge.to)
      if (edge.to === focusId) set.add(edge.from)
    }
    return set
  }, [focusId, filtered.edges])

  /**
   * Delta in viewBox units between two client positions, via the screen CTM;
   * falls back to the rect ratio when the environment cannot answer.
   */
  const viewDelta = (event: { clientX: number; clientY: number }, lastX: number, lastY: number): { dx: number; dy: number } => {
    const svg = svgRef.current
    const from = svg === null ? null : clientToView(svg, lastX, lastY)
    const to = svg === null ? null : clientToView(svg, event.clientX, event.clientY)
    if (from !== null && to !== null) return { dx: to.x - from.x, dy: to.y - from.y }
    const rect = svg?.getBoundingClientRect()
    const scaleX = rect === undefined || rect.width === 0 ? 1 : VIEW_W / rect.width
    const scaleY = rect === undefined || rect.height === 0 ? 1 : VIEW_H / rect.height
    return { dx: (event.clientX - lastX) * scaleX, dy: (event.clientY - lastY) * scaleY }
  }

  const onNodeDown = (event: ReactPointerEvent<SVGGElement>, index: number): void => {
    const layout = layoutRef.current
    const node = layout?.nodes[index]
    if (layout === null || node === undefined) return
    node.fixed = true
    dragRef.current = { index, lastX: event.clientX, lastY: event.clientY, moved: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onNodeMove = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = dragRef.current
    const layout = layoutRef.current
    if (drag === null || layout === null) return
    const node = layout.nodes[drag.index]
    if (node === undefined) return
    const { dx, dy } = viewDelta(event, drag.lastX, drag.lastY)
    drag.moved += Math.hypot(event.clientX - drag.lastX, event.clientY - drag.lastY)
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    const current = viewRef.current
    node.x = Math.max(0, Math.min(VIEW_W, node.x + dx / current.k))
    node.y = Math.max(0, Math.min(VIEW_H, node.y + dy / current.k))
    // The loop may be asleep (alpha under its floor) — without a bump the
    // dragged node would not follow the pointer on screen.
    bump(value => value + 1)
  }

  const onNodeUp = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = dragRef.current
    const layout = layoutRef.current
    dragRef.current = null
    if (drag === null || layout === null) return
    const node = layout.nodes[drag.index]
    if (node === undefined) return
    node.fixed = false
    if (drag.moved < CLICK_SLOP_PX) {
      // Delayed single click: a double-click landing inside the window
      // cancels it and opens instead (ADR-0051).
      if (clickTimerRef.current !== null) clearTimeout(clickTimerRef.current)
      const id = node.id
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null
        toggleFocus(id)
      }, CLICK_DELAY_MS)
    } else {
      // A dragged node disturbed its neighbours — reheat to let them settle.
      // The loop died when alpha sank under the floor, so the reheat must
      // also restart it; a live loop survives the restart harmlessly.
      alphaRef.current = Math.max(alphaRef.current, 0.35)
      startLoop()
    }
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onNodeDoubleClick = (event: ReactMouseEvent<SVGGElement>, path: string): void => {
    event.stopPropagation()
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    onOpen(path)
  }

  // Background pan: a press that starts on the empty canvas (not on a node)
  // drags the viewport; a short one doubles as a click on empty space, which
  // leaves focus.
  const onBackgroundDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.target !== svgRef.current) return
    panRef.current = { lastX: event.clientX, lastY: event.clientY, moved: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onBackgroundMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const pan = panRef.current
    if (pan === null) return
    const { dx, dy } = viewDelta(event, pan.lastX, pan.lastY)
    pan.moved += Math.hypot(event.clientX - pan.lastX, event.clientY - pan.lastY)
    pan.lastX = event.clientX
    pan.lastY = event.clientY
    cancelViewAnim()
    const current = viewRef.current
    applyView({ ...current, x: current.x + dx, y: current.y + dy })
  }

  const onBackgroundUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const pan = panRef.current
    panRef.current = null
    if (pan === null) return
    if (pan.moved < CLICK_SLOP_PX) exitFocus()
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const toggleSwitch = (key: keyof ExtraViews): void => {
    setExtra(previous => ({ ...previous, [key]: !previous[key] }))
  }

  const layout = layoutRef.current
  if (data.nodes.length === 0 || filtered.nodes.length === 0) {
    return (
      <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--yt-text-muted)' }}>
        {t('graph.empty')}
        {onReload !== undefined && (
          <div style={topLeftDockStyle}>
            <ReloadButton onReload={onReload} t={t} />
          </div>
        )}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      {/* 视图切换与刷新同一条工具带：与页签同构（tabItem 面 + data-selected
          豁免），刷新钉在切换钮右侧，互不压盖（2026-10-14 复评 P2-1 修复）。 */}
      <div style={{ ...topLeftDockStyle, zIndex: 1, display: 'flex', gap: 'var(--yt-space-1)', alignItems: 'center' }}>
        {(['graph', 'list'] as const).map(option => (
          <button
            key={option}
            type="button"
            data-hover="tab"
            data-selected={mode === option ? '' : undefined}
            aria-pressed={mode === option}
            style={mode === option ? tabItemActiveStyle : tabItemStyle}
            onClick={() => { setMode(option) }}
          >
            {t(option === 'graph' ? 'graph.viewGraph' : 'graph.viewList')}
          </button>
        ))}
        {onReload !== undefined && <ReloadButton onReload={onReload} t={t} />}
      </div>
      {mode === 'list' ? (
        <div
          style={{
            position: 'absolute', inset: 0, overflow: 'auto',
            padding: 'var(--yt-space-6) var(--yt-space-3) var(--yt-space-3)',
            fontSize: 'var(--yt-type-body)',
          }}
          data-graph-list="true"
        >
          <div style={listHeadStyle}>{t('graph.nodes')}</div>
          {filtered.nodes.map((id) => {
            const kind = kindOf(id)
            return (
              <button
                key={id}
                type="button"
                data-hover="true"
                style={nodeRowStyle}
                onClick={() => { onOpen(id) }}
              >
                <span>{tabTitle(id)}</span>
                {kind !== null && <span style={kindChipStyle}>{t(KIND_KEYS[kind])}</span>}
              </button>
            )
          })}
          <div style={listHeadStyle}>{t('graph.edges')}</div>
          {filtered.edges.map((edge, index) => (
            <div key={`${edge.from}:${edge.kind}:${edge.to}:${index}`} style={edgeRowStyle}>
              {`${tabTitle(edge.from)} — ${t(GRAPH_LEGEND_KEYS[edge.kind])} — ${tabTitle(edge.to)}`}
            </div>
          ))}
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: '100%', display: 'block', fontFamily: 'var(--yt-font-ui)', touchAction: 'none' }}
          onPointerDown={onBackgroundDown}
          onPointerMove={onBackgroundMove}
          onPointerUp={onBackgroundUp}
          onPointerCancel={onBackgroundUp}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout !== null && layout.edges.map((edge, i) => {
              const a = layout.nodes[edge.source]
              const b = layout.nodes[edge.target]
              if (a === undefined || b === undefined) return null
              const kind = edgeKindOf(a.id, b.id)
              const highlighted = focusId !== null && neighbours !== null
              && (a.id === focusId || b.id === focusId) && neighbours.has(a.id) && neighbours.has(b.id)
              return (
                <line
                  key={`${kind}:${a.id}:${b.id}:${i}`}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={EDGE_STROKE[kind]}
                  strokeWidth={highlighted ? 3 : 1.5}
                  strokeOpacity={neighbours === null ? 0.75 : (highlighted ? 1 : DIM_OPACITY)}
                  {...(kind === 'person-person' ? { strokeDasharray: '5 4' } : {})}
                />
              )
            })}
            {layout !== null && layout.nodes.map((node, index) => {
              const kind = kindOf(node.id)
              const isolated = (degree.get(node.id) ?? 0) === 0
              const focused = node.id === focusId
              const dimmed = neighbours !== null && !neighbours.has(node.id)
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})${focused ? ` scale(${FOCUS_NODE_SCALE})` : ''}`}
                  style={{ cursor: 'pointer', opacity: dimmed ? DIM_OPACITY : 1 }}
                  onPointerDown={(event) => { onNodeDown(event, index) }}
                  onPointerMove={onNodeMove}
                  onPointerUp={onNodeUp}
                  onPointerCancel={onNodeUp}
                  onDoubleClick={(event) => { onNodeDoubleClick(event, node.id) }}
                >
                  <title>{node.id}</title>
                  {kind !== null && <NodeShape kind={kind} isolated={isolated} />}
                  <text
                    y={kind === 'person' ? 23 : 26}
                    textAnchor="middle"
                    fontSize={12}
                    fill={isolated ? 'var(--yt-text-muted)' : 'var(--yt-text-primary)'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {tabTitle(node.id)}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      )}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--yt-space-1)',
          padding: 'var(--yt-space-1) var(--yt-space-2)',
          borderRadius: 6,
          background: 'var(--yt-surface-raised)',
          border: '1px solid var(--yt-border-subtle)',
          fontSize: 'var(--yt-type-label)',
          color: 'var(--yt-text-secondary)',
        }}
      >
        {(Object.keys(EDGE_STROKE) as KbWireRelationEdge['kind'][]).map((kind) => {
          // The person–person base has no switch (ADR-0051); the other two
          // rows are their own toggles — 真按钮（2026-10-14 impeccable P2
          // 修复）：此前是 span onClick，键盘与读屏够不到；aria-pressed
          // 报开关态，色块承担视觉态。
          const switchKey: keyof ExtraViews | null = kind === 'area-project' ? 'areaProject' : kind === 'person-project' ? 'personProject' : null
          const on = switchKey === null || extra[switchKey]
          const chip = (
            <svg width={22} height={8} aria-hidden="true">
              <line
                x1={0} y1={4} x2={22} y2={4}
                stroke={EDGE_STROKE[kind]}
                strokeWidth={1.5}
                {...(kind === 'person-person' ? { strokeDasharray: '5 4' } : {})}
              />
            </svg>
          )
          if (switchKey === null) {
            return (
              <span
                key={kind}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--yt-space-1)', userSelect: 'none' }}
              >
                {chip}
                {t(GRAPH_LEGEND_KEYS[kind])}
              </span>
            )
          }
          return (
            <button
              key={kind}
              type="button"
              data-hover="true"
              aria-pressed={on}
              onClick={() => { toggleSwitch(switchKey) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--yt-space-1)',
                background: 'transparent', border: 'none', padding: 0,
                fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit',
                cursor: 'pointer', userSelect: 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 11, height: 11, borderRadius: 3, flexShrink: 0,
                  border: '1px solid var(--yt-border-strong)',
                  background: on ? EDGE_STROKE[kind] : 'transparent',
                }}
              />
              {chip}
              {t(GRAPH_LEGEND_KEYS[kind])}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The legend label per relation kind. */
const GRAPH_LEGEND_KEYS: Record<KbWireRelationEdge['kind'], Parameters<WorkbenchT>[0]> = {
  'person-project': 'graph.legend.personProject',
  'area-project': 'graph.legend.areaProject',
  'person-person': 'graph.legend.personPerson',
}

/** The node kind's label key in the list view. */
const KIND_KEYS: Record<'project' | 'person' | 'area', Parameters<WorkbenchT>[0]> = {
  project: 'graph.kind.project',
  person: 'graph.kind.person',
  area: 'graph.kind.area',
}

/** The list view's section head (节点 / 关系) — 从属证据的 label 档弱墨。 */
const listHeadStyle = {
  marginTop: 'var(--yt-space-3)',
  marginBottom: 'var(--yt-space-1)',
  fontSize: 'var(--yt-type-label)',
  color: 'var(--yt-text-muted)',
} as const

/** A node row in the list view: full-width text button, Enter opens the entity. */
const nodeRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--yt-space-2)',
  width: '100%',
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
} as const

const kindChipStyle = { fontSize: 'var(--yt-type-label)', color: 'var(--yt-text-muted)' } as const

const edgeRowStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  color: 'var(--yt-text-secondary)',
} as const

/** The 刷新 button's ghost face — placement belongs to the parent (the empty
    state docks it top-left; the graph view docks it beside the view toggle).
    2026-10-14 复评 P2-1：此前它自己绝对定位在 top:8/left:12，与后加的
    图谱/列表切换钮同坐标，被整个压死——图谱页唯一的手动恢复通道静默消失。 */
const reloadButtonStyle = {
  padding: 'var(--yt-space-1) var(--yt-space-2)',
  background: 'var(--yt-surface-raised)',
  border: '1px solid var(--yt-border-subtle)',
  borderRadius: 6,
  color: 'var(--yt-text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--yt-font-ui)',
  fontSize: 'var(--yt-type-label)',
} as const

/** 左上角停靠契约：空态刷新容器与视图工具带共用同一偏移；图例卡在右上
    镜像（top: 8 / right: 12）。chrome 偏移若变，只改这一处。 */
const topLeftDockStyle = { position: 'absolute', top: 8, left: 12 } as const

/** The pane's 刷新 button; rendered in the graph view and the empty state alike. */
function ReloadButton({ onReload, t }: { onReload: () => void; t: WorkbenchT }): ReactElement {
  return (
    <button type="button" data-hover="true" style={reloadButtonStyle} title={t('graph.refresh')} onClick={onReload}>
      {t('graph.refresh')}
    </button>
  )
}
