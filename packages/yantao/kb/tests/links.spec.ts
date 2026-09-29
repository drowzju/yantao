import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { linksOf, linkGraphOf, resolveWikiLink, wikilinks } from '../src/links.ts'
import { initKb } from '../src/core.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-links-'))
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

describe('wikilinks', () => {
  it('reads a bare name and a typed locator', () => {
    expect(wikilinks('见 [[dsh 学习]] 与 [[project:工作台]]')).toEqual([
      { target: 'dsh 学习' },
      { target: 'project:工作台' },
    ])
  })

  it('keeps the display half of an alias', () => {
    expect(wikilinks('[[project:工作台|那个项目]]')).toEqual([
      { target: 'project:工作台', label: '那个项目' },
    ])
  })

  it('ignores a link inside a fenced block', () => {
    const text = ['[[真的]]', '```', '[[示例]]', '```', '[[也是真的]]'].join('\n')
    expect(wikilinks(text).map(link => link.target)).toEqual(['真的', '也是真的'])
  })

  it('ignores empty brackets', () => {
    expect(wikilinks('空 [[]]')).toEqual([])
  })
})

describe('resolveWikiLink', () => {
  beforeEach(async () => {
    await put('entities/projects/dsh 学习.md', '---\ntype: project\n---\n')
    await put('entities/people/张三.md', '---\ntype: person\n---\n')
    await put('entities/meetings/2026-09-08 周会.md', '---\ntype: meeting\n---\n')
    await put('entities/todos.md', '- [ ] 一条\n')
    await put('resources/周报.eml', '原件')
  })

  it('resolves a bare name to the one entity that carries it', async () => {
    expect(await resolveWikiLink(kbRoot, 'dsh 学习')).toBe('entities/projects/dsh 学习.md')
  })

  it('resolves a typed locator, singular or plural, either colon', async () => {
    expect(await resolveWikiLink(kbRoot, 'project:dsh 学习')).toBe('entities/projects/dsh 学习.md')
    expect(await resolveWikiLink(kbRoot, 'projects：dsh 学习')).toBe('entities/projects/dsh 学习.md')
  })

  it('resolves a dated meeting by its bare title', async () => {
    expect(await resolveWikiLink(kbRoot, '周会')).toBe('entities/meetings/2026-09-08 周会.md')
  })

  it('resolves the todo singleton', async () => {
    expect(await resolveWikiLink(kbRoot, 'todo:todos')).toBe('entities/todos.md')
  })

  it('leaves an unknown name unresolved instead of inventing a path', async () => {
    expect(await resolveWikiLink(kbRoot, '不存在的东西')).toBeNull()
  })

  it('leaves an ambiguous name unresolved', async () => {
    await put('entities/areas/周会.md', '---\ntype: area\n---\n')
    expect(await resolveWikiLink(kbRoot, '周会')).toBeNull()
  })

  it('refuses to point at resources even when the file is there', async () => {
    expect(await resolveWikiLink(kbRoot, 'resources/周报.eml')).toBeNull()
  })

  it('refuses a locator that climbs out of the root', async () => {
    expect(await resolveWikiLink(kbRoot, 'project:../../etc/passwd')).toBeNull()
  })
})

describe('linksOf', () => {
  it('collects outgoing links in document order, resolved and unresolved', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n## 状态\n\n依赖 [[乙]] 和 [[丙]] 和 [[不在库里]]\n')
    await put('entities/projects/乙.md', '---\ntype: project\n---\n')
    const links = await linksOf(kbRoot, 'entities/projects/甲.md')
    expect(links.outgoing).toEqual([
      { target: '乙', path: 'entities/projects/乙.md' },
      { target: '丙', path: null },
      { target: '不在库里', path: null },
    ])
    expect(links.incoming).toEqual([])
  })

  it('collects what links back in', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n引用 [[乙]]\n')
    await put('entities/areas/乙.md', '---\ntype: area\n---\n')
    await put('entities/people/张三.md', '---\ntype: person\n---\n\n也提到 [[area:乙]]\n')
    const links = await linksOf(kbRoot, 'entities/areas/乙.md')
    expect(links.incoming).toEqual([
      { from: 'entities/projects/甲.md', target: '乙' },
      { from: 'entities/people/张三.md', target: 'area:乙' },
    ])
  })

  it('does not count a file as linking to itself', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n自转 [[甲]]\n')
    expect((await linksOf(kbRoot, 'entities/projects/甲.md')).incoming).toEqual([])
  })

  it('returns an empty graph for a file it cannot read', async () => {
    expect(await linksOf(kbRoot, 'entities/projects/不存在.md')).toEqual({
      path: 'entities/projects/不存在.md',
      outgoing: [],
      incoming: [],
    })
  })

  it('works over a real kb_init skeleton', async () => {
    await initKb(kbRoot)
    await put('entities/areas/健康.md', '---\ntype: area\n---\n\n关联 [[我自己]]\n')
    const links = await linksOf(kbRoot, 'entities/areas/健康.md')
    expect(links.outgoing).toEqual([{ target: '我自己', path: 'entities/people/我自己.md' }])
    // The skeleton's own people note is in the scan and links nowhere yet.
    expect(links.incoming).toEqual([])
  })
})

describe('linkGraphOf', () => {
  it('returns the whole graph: every entity a node, every link an edge', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n依赖 [[乙]]，提及 [[不在库里]]\n')
    await put('entities/areas/乙.md', '---\ntype: area\n---\n\n回到 [[project:甲]]\n')
    await put('entities/people/张三.md', '---\ntype: person\n---\n')
    const graph = await linkGraphOf(kbRoot)
    expect(graph.nodes).toEqual([
      'entities/projects/甲.md',
      'entities/areas/乙.md',
      'entities/people/张三.md',
    ])
    expect(graph.edges).toEqual([
      { from: 'entities/projects/甲.md', target: '乙', to: 'entities/areas/乙.md' },
      { from: 'entities/projects/甲.md', target: '不在库里', to: null },
      { from: 'entities/areas/乙.md', target: 'project:甲', to: 'entities/projects/甲.md' },
    ])
  })

  it('drops self-links and keeps ambiguous names unresolved', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n自转 [[甲]]，歧义 [[重名]]\n')
    await put('entities/areas/重名.md', '---\ntype: area\n---\n')
    await put('entities/people/重名.md', '---\ntype: person\n---\n')
    const graph = await linkGraphOf(kbRoot)
    // [[甲]] resolves to the file itself — a self-link, dropped by design.
    expect(graph.edges).toEqual([
      { from: 'entities/projects/甲.md', target: '重名', to: null },
    ])
  })

  it('resolves a dated meeting by its bare title, once per unique target', async () => {
    await put('entities/meetings/2026-09-08 周会.md', '---\ntype: meeting\n---\n')
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n会上 [[周会]] 又提 [[周会]]\n')
    const graph = await linkGraphOf(kbRoot)
    expect(graph.edges).toEqual([
      { from: 'entities/projects/甲.md', target: '周会', to: 'entities/meetings/2026-09-08 周会.md' },
      { from: 'entities/projects/甲.md', target: '周会', to: 'entities/meetings/2026-09-08 周会.md' },
    ])
  })

  it('agrees with linksOf on every file it covers', async () => {
    await put('entities/projects/甲.md', '---\ntype: project\n---\n\n依赖 [[乙]] 和 [[丙]]\n')
    await put('entities/projects/乙.md', '---\ntype: project\n---\n\n引用 [[area:丙]]\n')
    await put('entities/areas/丙.md', '---\ntype: area\n---\n')
    const graph = await linkGraphOf(kbRoot)
    for (const node of graph.nodes) {
      const links = await linksOf(kbRoot, node)
      const outs = graph.edges.filter(edge => edge.from === node)
      expect(outs.map(({ target, to }) => ({ target, path: to }))).toEqual(links.outgoing)
      const ins = graph.edges.filter(edge => edge.to === node)
      expect(ins.map(({ from, target }) => ({ from, target }))).toEqual(links.incoming)
    }
  })
})
