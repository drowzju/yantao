/**
 * View filtering for the 图谱 tab (ADR-0051): the relation graph's visible
 * subgraph under the view switches. `person-person` is the permanent base —
 * it has no switch — while `area-project` and `person-project` toggle
 * independently. Visible nodes are the endpoints of the enabled edge kinds;
 * fully isolated nodes escape the filter (ADR-0049: silence is information
 * too, and an isolated node belongs to no edge kind, so a strict filter
 * would banish it forever). Pure data, no React and no DOM, so the
 * selection behaviour is unit-testable.
 * @module @deepseek-ai/dsh-client-ui-yantao/graph/subgraph
 */
import type { KbRelationGraphResult, KbWireRelationEdge } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'

/** The relation kinds a view switch can govern — everything but the base. */
export type SwitchableKind = Exclude<KbWireRelationEdge['kind'], 'person-person'>

/** The always-on base kind: the person–person collaboration network. */
export const BASE_KIND = 'person-person' as const

/** The kinds whose edges are visible, under the current switches. */
export type EnabledKinds = ReadonlySet<KbWireRelationEdge['kind']>

/** The default view: the base only — the two switches start off. */
export function defaultEnabledKinds(): Set<KbWireRelationEdge['kind']> {
  return new Set<KbWireRelationEdge['kind']>([BASE_KIND])
}

/** How many edges touch each node, over the whole graph. */
function fullDegrees(edges: KbRelationGraphResult['edges']): Map<string, number> {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  return degree
}

/**
 * Narrow the relation graph to the view's visible subgraph: the edges whose
 * kind is enabled, their endpoints, and every fully isolated node.
 * @param data - the whole KB's relation graph.
 * @param enabled - the enabled edge kinds (the base is always among them).
 * @returns the node paths and edges the pane should lay out and render.
 */
export function visibleSubgraph(data: KbRelationGraphResult, enabled: EnabledKinds): { nodes: string[]; edges: KbWireRelationEdge[] } {
  const edges = data.edges.filter(edge => enabled.has(edge.kind))
  const degree = fullDegrees(data.edges)
  const nodes = new Set<string>()
  for (const node of data.nodes) {
    if ((degree.get(node) ?? 0) === 0) nodes.add(node)
  }
  for (const edge of edges) {
    nodes.add(edge.from)
    nodes.add(edge.to)
  }
  // Preserve the payload's node order so the layout's circle start stays stable.
  return { nodes: data.nodes.filter(node => nodes.has(node)), edges }
}
