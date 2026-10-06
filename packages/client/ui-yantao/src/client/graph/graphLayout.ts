/**
 * The force simulation behind the 图谱 tab (ADR-0049): a tiny hand-rolled
 * layout — pairwise repulsion, edge springs, a weak center pull, damped
 * integration — because the workbench carries no graph dependency and a
 * personal KB's dozens of nodes make the O(n²) pair loop cheap. Pure math,
 * no React and no DOM, so the convergence behaviour is unit-testable.
 * @module @deepseek-ai/dsh-client-ui-yantao/graph/graphLayout
 */

/** One simulated node: a KB-relative path with its current state. */
export interface LayoutNode {
  /** The node's KB-relative path — the layout's identity. */
  readonly id: string
  x: number
  y: number
  vx: number
  vy: number
  /** While dragging, the node is pinned: forces compute, integration skips. */
  fixed: boolean
}

/** One simulated edge as index pairs into the node array. */
export interface LayoutEdge {
  readonly source: number
  readonly target: number
}

/** The simulation state: nodes with positions, edges as index pairs. */
export interface ForceLayout {
  readonly nodes: LayoutNode[]
  readonly edges: LayoutEdge[]
  /** Canvas extent the layout relaxes inside. */
  readonly width: number
  readonly height: number
}

/** Pairwise repulsion strength. */
const REPULSION = 24_000
/** Spring stiffness toward the ideal edge length. */
const SPRING = 0.03
/** Ideal edge length in px. */
const REST_LENGTH = 130
/** Weak pull toward the canvas centre, so the cloud never drifts off. */
const CENTER_PULL = 0.015
/** Velocity retained per tick — the damping that lets the layout settle. */
const DAMPING = 0.85
/** Per-tick displacement cap, so a fresh layout never explodes. */
const MAX_STEP = 24

/**
 * Lay the nodes out on a circle and index the edges. A circle start spreads
 * the cloud evenly, which is all the symmetry a force layout needs.
 * @param ids - every node's KB-relative path, in the payload's order.
 * @param edges - the payload's edges, matched to indices; unknown endpoints
 *   are dropped (never expected — the payload only ships known paths).
 * @param width - canvas width.
 * @param height - canvas height.
 * @returns a fresh layout ready for {@link stepLayout}.
 */
export function createLayout(
  ids: readonly string[],
  edges: readonly { from: string; to: string }[],
  width: number,
  height: number,
): ForceLayout {
  const index = new Map<string, number>()
  const nodes: LayoutNode[] = ids.map((id, i) => {
    index.set(id, i)
    const angle = (2 * Math.PI * i) / Math.max(ids.length, 1)
    const radius = Math.min(width, height) * 0.36
    return {
      id,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      fixed: false,
    }
  })
  const pairs: LayoutEdge[] = []
  for (const edge of edges) {
    const source = index.get(edge.from)
    const target = index.get(edge.to)
    if (source === undefined || target === undefined || source === target) continue
    pairs.push({ source, target })
  }
  return { nodes, edges: pairs, width, height }
}

/**
 * Advance the simulation one tick: repulsion pushes every pair apart,
 * springs pull connected nodes toward the resting length, the centre pull
 * keeps the cloud framed, and damped integration moves the nodes. Fixed
 * (dragged) nodes contribute forces but never move.
 * @param layout - the simulation to mutate.
 * @param alpha - this tick's heat, scaling every force.
 */
export function stepLayout(layout: ForceLayout, alpha: number): void {
  const { nodes, edges, width, height } = layout
  const fx = new Float64Array(nodes.length)
  const fy = new Float64Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i] as LayoutNode
      const b = nodes[j] as LayoutNode
      let dx = b.x - a.x
      let dy = b.y - a.y
      const d2 = dx * dx + dy * dy + 0.01
      const d = Math.sqrt(d2)
      const force = (REPULSION / d2) * alpha
      dx /= d
      dy /= d
      fx[i] = (fx[i] as number) - dx * force
      fy[i] = (fy[i] as number) - dy * force
      fx[j] = (fx[j] as number) + dx * force
      fy[j] = (fy[j] as number) + dy * force
    }
  }
  for (const edge of edges) {
    const a = nodes[edge.source] as LayoutNode
    const b = nodes[edge.target] as LayoutNode
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) + 0.01
    const force = (SPRING * (d - REST_LENGTH) * alpha) / d
    fx[edge.source] = (fx[edge.source] as number) + dx * force
    fy[edge.source] = (fy[edge.source] as number) + dy * force
    fx[edge.target] = (fx[edge.target] as number) - dx * force
    fy[edge.target] = (fy[edge.target] as number) - dy * force
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as LayoutNode
    fx[i] = (fx[i] as number) + ((width / 2) - node.x) * CENTER_PULL * alpha
    fy[i] = (fy[i] as number) + ((height / 2) - node.y) * CENTER_PULL * alpha
    if (node.fixed) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx = (node.vx + (fx[i] as number)) * DAMPING
    node.vy = (node.vy + (fy[i] as number)) * DAMPING
    const step = Math.hypot(node.vx, node.vy)
    if (step > MAX_STEP) {
      node.vx = (node.vx / step) * MAX_STEP
      node.vy = (node.vy / step) * MAX_STEP
    }
    node.x += node.vx
    node.y += node.vy
  }
}
