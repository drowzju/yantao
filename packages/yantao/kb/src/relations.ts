/**
 * Typed relations between entities for the workbench's 图谱 tab (ADR-0049).
 *
 * The `[[…]]` link graph (links.ts) is untyped — an edge only says "this note
 * mentions that one". The graph view needs three specific relations, and they
 * live in two different carriers: person–project and person–person exist only
 * as wiki links between entities of the matching kinds, while area–project is
 * structured frontmatter (`areas:` on the project, written by 提炼 proposals)
 * that the link graph never carries. This module composes both carriers into
 * one payload, reusing {@link linkGraphOf} so the two graphs can never drift
 * apart on resolution rules.
 * @module @deepseek-ai/dsh-yantao-kb/relations
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'
import { linkGraphOf, resolveWikiLink } from './links.ts'
import { KbError } from './types.ts'

/** The three relations the graph view draws (ADR-0049). */
export type RelationKind = 'person-project' | 'area-project' | 'person-person'

/** One undirected relation between two active entities. */
export interface KbRelationEdge {
  /** One endpoint, normalized: the person (or area) half of a cross-kind pair. */
  readonly from: string
  /** The other endpoint: the project half of a cross-kind pair. */
  readonly to: string
  /** Which relation this edge carries. */
  readonly kind: RelationKind
}

/** The whole KB's relation graph in one payload. */
export interface KbRelationGraph {
  /** Every active entity, as KB-relative paths, in type-then-directory order. */
  readonly nodes: readonly string[]
  /** Every relation edge, deduplicated. */
  readonly edges: readonly KbRelationEdge[]
}

/**
 * The entity kind a graph edge endpoint must have, judged from the KB-relative
 * path — the directory under `entities/` is the type. Meetings and the todo
 * singleton answer null: mentions involving them are prose, not relations.
 */
type GraphEndpoint = 'person' | 'project' | 'area'

function endpointOf(path: string): GraphEndpoint | null {
  if (path.startsWith('entities/people/')) return 'person'
  if (path.startsWith('entities/projects/')) return 'project'
  if (path.startsWith('entities/areas/')) return 'area'
  return null
}

/**
 * The whole KB's typed relation graph (ADR-0049): the wiki-link graph filtered
 * to the three drawable relations, plus the structured area–project edges read
 * from project frontmatter. A wiki link has no semantic direction — a person
 * note may link a project just as the project links the person — so both
 * orientations are collected and normalized (the person/area half becomes
 * `from`, the project half `to`; person–person pairs are ordered by path and
 * deduplicated). Edges touching meetings, todos, archived entities, or
 * unresolved targets never appear; an `areas:` entry that names zero or
 * several areas is silently dropped, matching the link graph's
 * never-guess rule.
 * @param kbRoot - the knowledge-base root directory.
 * @returns the nodes (every active entity) and the deduplicated edges.
 */
export async function relationGraphOf(kbRoot: string): Promise<KbRelationGraph> {
  const graph = await linkGraphOf(kbRoot)
  const active = new Set(graph.nodes)
  const edges = new Map<string, KbRelationEdge>()
  const add = (edge: KbRelationEdge): void => {
    const key = `${edge.kind}|${edge.from}|${edge.to}`
    if (!edges.has(key)) edges.set(key, edge)
  }
  for (const edge of graph.edges) {
    if (edge.to === null) continue
    const a = endpointOf(edge.from)
    const b = endpointOf(edge.to)
    if (a === null || b === null) continue
    if (a === 'person' && b === 'person') {
      const [from, to] = edge.from <= edge.to ? [edge.from, edge.to] : [edge.to, edge.from]
      add({ kind: 'person-person', from, to })
    } else if (a === 'person' && b === 'project') {
      add({ kind: 'person-project', from: edge.from, to: edge.to })
    } else if (a === 'project' && b === 'person') {
      add({ kind: 'person-project', from: edge.to, to: edge.from })
    } else if (a === 'area' && b === 'project') {
      add({ kind: 'area-project', from: edge.from, to: edge.to })
    } else if (a === 'project' && b === 'area') {
      add({ kind: 'area-project', from: edge.to, to: edge.from })
    }
    // area–area and person–area pairs carry no drawn relation and fall through.
  }
  // The structured carrier: each project's frontmatter `areas` list. Entries
  // resolve through the same locator pathway as wiki links; an entry that
  // names zero or several areas, or an archived one, is dropped quietly.
  const root = resolve(kbRoot)
  for (const path of graph.nodes) {
    if (!path.startsWith('entities/projects/')) continue
    let text: string
    try {
      text = await readFile(join(root, path), 'utf8')
    } catch {
      continue
    }
    let areas: unknown
    try {
      areas = parseFrontmatter(text, path).data.areas
    } catch (error) {
      if (!(error instanceof KbError)) throw error
      continue
    }
    if (!Array.isArray(areas)) continue
    for (const entry of areas) {
      if (typeof entry !== 'string' || entry.trim() === '') continue
      const areaPath = await resolveWikiLink(kbRoot, `area:${entry.trim()}`)
      if (areaPath === null || !active.has(areaPath)) continue
      add({ kind: 'area-project', from: areaPath, to: path })
    }
  }
  return { nodes: graph.nodes, edges: [...edges.values()] }
}
