import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initKb } from '../src/core.ts'
import { relationGraphOf } from '../src/relations.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-relations-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** Write one KB file, creating its directory. */
async function put(path: string, content: string): Promise<void> {
  const absolute = join(kbRoot, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

describe('relationGraphOf', () => {
  it('collects person–project links in either direction, normalized', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n负责人 [[张三]]\n')
    await put('entities/people/张三.md', '---\ntype: person\n---\n\n在做 [[甲]]\n')
    await put('entities/people/李四.md', '---\ntype: person\n---\n\n也在做 [[project:甲]]\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.edges).toEqual([
      { kind: 'person-project', from: 'entities/people/张三.md', to: 'entities/projects/甲.md' },
      { kind: 'person-project', from: 'entities/people/李四.md', to: 'entities/projects/甲.md' },
    ])
  })

  it('deduplicates repeated links between the same pair', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n[[张三]] 又见 [[张三]]\n')
    await put('entities/people/张三.md', '---\ntype: person\n---\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.edges).toEqual([
      { kind: 'person-project', from: 'entities/people/张三.md', to: 'entities/projects/甲.md' },
    ])
  })

  it('orders person–person pairs by path and collapses both writings', async () => {
    await put('entities/people/王五.md', '---\ntype: person\n---\n\n搭档 [[张三]]\n')
    await put('entities/people/张三.md', '---\ntype: person\n---\n\n搭档 [[王五]]\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.edges).toEqual([
      { kind: 'person-person', from: 'entities/people/张三.md', to: 'entities/people/王五.md' },
    ])
  })

  it('adds area–project edges from project frontmatter and unions them with wiki links', async () => {
    await put('entities/areas/健康.md', '---\ntype: area\n---\n')
    await put('entities/areas/财富.md', '---\ntype: area\n---\n')
    await put('entities/projects/甲.md', '---\ntype: project\nareas: [健康, 财富]\n---\n\n归属 [[健康]]\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.edges).toEqual([
      { kind: 'area-project', from: 'entities/areas/健康.md', to: 'entities/projects/甲.md' },
      { kind: 'area-project', from: 'entities/areas/财富.md', to: 'entities/projects/甲.md' },
    ])
  })

  it('drops an areas entry that names zero or several areas', async () => {
    await put('entities/areas/健康.md', '---\ntype: area\n---\n')
    await put('entities/people/重名.md', '---\ntype: person\n---\n')
    await put('entities/projects/甲.md', '---\ntype: project\nareas: [不存在, 重名, 42, ""]\n---\n')
    const graph = await relationGraphOf(kbRoot)
    // 「不存在」names nothing, 「重名」names a person and an area (ambiguous),
    // 42 is not a name, "" is empty — nothing survives.
    expect(graph.edges).toEqual([])
  })

  it('tolerates a missing or non-array areas field', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\nareas: 健康\n---\n')
    await put('entities/projects/乙.md', '---\ntype: project\n---\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.edges).toEqual([])
    expect(graph.nodes).toContain('entities/projects/甲.md')
  })

  it('excludes archived entities from nodes and edges, frontmatter areas included', async () => {
    await put('entities/people/张三.md', '---\ntype: person\narchive: true\n---\n\n在做 [[甲]]\n')
    await put('entities/areas/健康.md', '---\ntype: area\narchive: true\n---\n')
    await put('entities/projects/甲.md', '---\ntype: project\nareas: [健康]\n---\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.nodes).toEqual(['entities/projects/甲.md'])
    expect(graph.edges).toEqual([])
  })

  it('drops edges touching meetings, the todo singleton, and unresolved targets', async () => {
    await put('entities/meetings/2026-09-08 周会.md', '---\ntype: meeting\n---\n\n来了 [[张三]]，谈了 [[甲]]\n')
    await put('entities/todos.md', '- [ ] 问 [[张三]]\n')
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n[[张三]] 和 [[不在库里]]\n')
    await put('entities/people/张三.md', '---\ntype: person\n---\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.edges).toEqual([
      { kind: 'person-project', from: 'entities/people/张三.md', to: 'entities/projects/甲.md' },
    ])
  })

  it('keeps isolated entities as nodes and works over a real kb_init skeleton', async () => {
    await initKb(kbRoot)
    await put('entities/areas/健康.md', '---\ntype: area\n---\n')
    await put('entities/projects/甲.md', '---\ntype: project\nareas: [健康]\n---\n')
    const graph = await relationGraphOf(kbRoot)
    expect(graph.nodes).toContain('entities/people/我自己.md')
    expect(graph.nodes).toContain('entities/todos.md')
    expect(graph.edges).toEqual([
      { kind: 'area-project', from: 'entities/areas/健康.md', to: 'entities/projects/甲.md' },
    ])
  })
})
