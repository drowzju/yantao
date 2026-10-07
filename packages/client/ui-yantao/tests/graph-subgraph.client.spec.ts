// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { KbRelationGraphResult, KbWireRelationEdge } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { BASE_KIND, defaultEnabledKinds, visibleSubgraph } from '../src/client/graph/subgraph.ts'

/** A small skeleton library: two people, two projects, one area, one loner. */
function skeleton(): KbRelationGraphResult {
  const edge = (from: string, to: string, kind: KbWireRelationEdge['kind']): KbWireRelationEdge => ({ from, to, kind })
  return {
    nodes: [
      'entities/areas/健康.md',
      'entities/people/张三.md',
      'entities/people/李四.md',
      'entities/people/王五.md',
      'entities/projects/yantao.md',
      'entities/projects/健身计划.md',
    ],
    edges: [
      edge('entities/people/张三.md', 'entities/projects/yantao.md', 'person-project'),
      edge('entities/areas/健康.md', 'entities/projects/健身计划.md', 'area-project'),
      edge('entities/people/张三.md', 'entities/people/李四.md', 'person-person'),
    ],
  }
}

describe('defaultEnabledKinds', () => {
  it('starts with the base only — both switches off', () => {
    const enabled = defaultEnabledKinds()
    expect(enabled.size).toBe(1)
    expect(enabled.has(BASE_KIND)).toBe(true)
  })
})

describe('visibleSubgraph', () => {
  it('ships the base view with only person–person edges and their endpoints', () => {
    const view = visibleSubgraph(skeleton(), defaultEnabledKinds())
    expect(view.edges).toEqual([
      { from: 'entities/people/张三.md', to: 'entities/people/李四.md', kind: 'person-person' },
    ])
    expect(view.nodes).toEqual([
      'entities/people/张三.md',
      'entities/people/李四.md',
      'entities/people/王五.md',
    ])
  })

  it("adds each switch's edges and endpoints when turned on", () => {
    const enabled = defaultEnabledKinds()
    enabled.add('person-project')
    const view = visibleSubgraph(skeleton(), enabled)
    expect(view.edges).toHaveLength(2)
    expect(view.nodes).toContain('entities/projects/yantao.md')
    expect(view.nodes).not.toContain('entities/projects/健身计划.md')
  })

  it('keeps fully isolated nodes whatever the switches say', () => {
    const view = visibleSubgraph(skeleton(), defaultEnabledKinds())
    // 王五 has no edges at all — he survives the strictest filter.
    expect(view.nodes).toContain('entities/people/王五.md')
  })

  it('excludes nodes left with no enabled edge kind', () => {
    const enabled = defaultEnabledKinds()
    enabled.add('person-project')
    const view = visibleSubgraph(skeleton(), enabled)
    // 健康 and 健身计划 only touch area-project edges, which stay off.
    expect(view.nodes).not.toContain('entities/areas/健康.md')
    expect(view.nodes).not.toContain('entities/projects/健身计划.md')
    // 张三 rides the permanent person–person base.
    expect(view.nodes).toContain('entities/people/张三.md')
    expect(view.nodes).toContain('entities/projects/yantao.md')
  })

  it("preserves the payload's node order so the layout start stays stable", () => {
    const enabled = defaultEnabledKinds()
    enabled.add('person-project')
    enabled.add('area-project')
    const view = visibleSubgraph(skeleton(), enabled)
    expect(view.nodes).toEqual(skeleton().nodes)
  })
})
