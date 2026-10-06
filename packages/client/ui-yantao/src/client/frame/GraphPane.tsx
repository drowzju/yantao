/**
 * The 图谱 tab's pane (ADR-0049): the whole KB's typed relation graph —
 * person–project, area–project, person–person — as a force-directed SVG.
 * The simulation lives in `graph/graphLayout.ts`; this component only feeds
 * it frames, renders the result, and hands clicks to the frame's file-opening
 * gesture. Zoom/pan is deliberately out (二期): a personal KB fits one view.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { KbRelationEdge, KbRelationGraphResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { createLayout, stepLayout, type ForceLayout } from '../graph/graphLayout.ts'
import { tabTitle } from '../tabs.ts'
import type { WorkbenchT } from '../locales.ts'

/** The pane's fixed coordinate space; the SVG scales it to fit. */
const VIEW_W = 1000
const VIEW_H = 700

/** A pointer gesture shorter than this is a click, not a drag. */
const CLICK_SLOP_PX = 5

/** The rAF relaxation loop's starting heat, decay, and floor. */
const INITIAL_ALPHA = 0.9
const ALPHA_DECAY = 0.985
const ALPHA_FLOOR = 0.008

/** Node fill/stroke per entity kind, from the yt-tokens palette. */
const FILL: Record<'project' | 'person' | 'area', string> = {
  project: 'var(--yt-accent)',
  person: 'var(--yt-success)',
  area: 'var(--yt-warning)',
}

/** Edge stroke per relation kind. */
const EDGE_STROKE: Record<KbRelationEdge['kind'], string> = {
  'person-project': 'var(--yt-accent)',
  'area-project': 'var(--yt-success)',
  'person-person': 'var(--yt-border-strong)',
}

/** The entity kind a node path carries — the directory under `entities/`. */
function kindOf(path: string): 'project' | 'person' | 'area' | null {
  if (path.startsWith('entities/projects/')) return 'project'
  if (path.startsWith('entities/people/')) return 'person'
  if (path.startsWith('entities/areas/')) return 'area'
  return null
}

/** The relation kind an edge carries, judged from its endpoints' kinds. */
function edgeKindOf(from: string, to: string): KbRelationEdge['kind'] {
  const a = kindOf(from)
  const b = kindOf(to)
  const project = a === 'project' || b === 'project'
  if (a === 'person' || b === 'person') return project === true ? 'person-project' : 'person-person'
  return 'area-project'
}

/** How many edges touch each node, for the isolated-node dimming. */
function degreesOf(edges: readonly KbRelationEdge[]): Map<string, number> {
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
  /** Open one entity (the frame's file-tab gesture). */
  readonly onOpen: (path: string) => void
  readonly t: WorkbenchT
}

/**
 * Render the relation graph: a force simulation behind an SVG viewport.
 * @param props - see {@link GraphPaneProps}.
 * @returns the pane element.
 */
export function GraphPane({ data, onOpen, t }: GraphPaneProps): ReactElement {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const layoutRef = useRef<ForceLayout | null>(null)
  const alphaRef = useRef(0)
  const dragRef = useRef<{ index: number; lastX: number; lastY: number; moved: number } | null>(null)
  const [, bump] = useState(0)

  // A new payload rebuilds the layout and reheats the simulation.
  useEffect(() => {
    layoutRef.current = createLayout(data.nodes, data.edges, VIEW_W, VIEW_H)
    alphaRef.current = INITIAL_ALPHA
    let raf = 0
    const loop = (): void => {
      const layout = layoutRef.current
      if (layout === null) return
      stepLayout(layout, alphaRef.current)
      alphaRef.current *= ALPHA_DECAY
      bump(value => value + 1)
      if (alphaRef.current >= ALPHA_FLOOR) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf) }
  }, [data])

  const degree = degreesOf(data.edges)

  const onNodeDown = (event: ReactPointerEvent<SVGGElement>, index: number): void => {
    const layout = layoutRef.current
    const node = layout?.nodes[index]
    if (layout === undefined || node === undefined) return
    node.fixed = true
    dragRef.current = { index, lastX: event.clientX, lastY: event.clientY, moved: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onNodeMove = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = dragRef.current
    const layout = layoutRef.current
    const svg = svgRef.current
    if (drag === null || layout === null || svg === null) return
    const rect = svg.getBoundingClientRect()
    const scaleX = rect.width === 0 ? 1 : VIEW_W / rect.width
    const scaleY = rect.height === 0 ? 1 : VIEW_H / rect.height
    const node = layout.nodes[drag.index]
    if (node === undefined) return
    const dx = (event.clientX - drag.lastX) * scaleX
    const dy = (event.clientY - drag.lastY) * scaleY
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    drag.moved += Math.abs(dx) + Math.abs(dy)
    node.x = Math.max(0, Math.min(VIEW_W, node.x + dx))
    node.y = Math.max(0, Math.min(VIEW_H, node.y + dy))
  }

  const onNodeUp = (): void => {
    const drag = dragRef.current
    const layout = layoutRef.current
    dragRef.current = null
    if (drag === null || layout === null) return
    const node = layout.nodes[drag.index]
    if (node === undefined) return
    node.fixed = false
    if (drag.moved < CLICK_SLOP_PX) {
      onOpen(node.id)
    } else {
      // A dragged node disturbed its neighbours — reheat to let them settle.
      alphaRef.current = Math.max(alphaRef.current, 0.35)
    }
  }

  const layout = layoutRef.current
  if (data.nodes.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--yt-text-muted)' }}>
        {t('graph.empty')}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block', fontFamily: 'var(--yt-font-ui)' }}
      >
        {layout !== null && layout.edges.map((edge, i) => {
          const a = layout.nodes[edge.source]
          const b = layout.nodes[edge.target]
          if (a === undefined || b === undefined) return null
          const kind = edgeKindOf(a.id, b.id)
          return (
            <line
              key={`${kind}:${a.id}:${b.id}:${i}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={EDGE_STROKE[kind]}
              strokeWidth={1.5}
              strokeOpacity={0.75}
              {...(kind === 'person-person' ? { strokeDasharray: '5 4' } : {})}
            />
          )
        })}
        {layout !== null && layout.nodes.map((node, index) => {
          const kind = kindOf(node.id)
          const isolated = (degree.get(node.id) ?? 0) === 0
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              style={{ cursor: 'pointer' }}
              onPointerDown={(event) => { onNodeDown(event, index) }}
              onPointerMove={onNodeMove}
              onPointerUp={onNodeUp}
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
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 10px',
          borderRadius: 6,
          background: 'var(--yt-surface-raised)',
          border: '1px solid var(--yt-border-subtle)',
          fontSize: 'var(--yt-type-label)',
          color: 'var(--yt-text-secondary)',
          pointerEvents: 'none',
        }}
      >
        {(Object.keys(EDGE_STROKE) as KbRelationEdge['kind'][]).map(kind => (
          <span key={kind} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width={22} height={8}>
              <line
                x1={0} y1={4} x2={22} y2={4}
                stroke={EDGE_STROKE[kind]}
                strokeWidth={1.5}
                {...(kind === 'person-person' ? { strokeDasharray: '5 4' } : {})}
              />
            </svg>
            {t(GRAPH_LEGEND_KEYS[kind])}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The legend label per relation kind. */
const GRAPH_LEGEND_KEYS: Record<KbRelationEdge['kind'], Parameters<WorkbenchT>[0]> = {
  'person-project': 'graph.legend.personProject',
  'area-project': 'graph.legend.areaProject',
  'person-person': 'graph.legend.personPerson',
}
