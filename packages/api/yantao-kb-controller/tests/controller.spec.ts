import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { entityFileContent, todayStamp, todoFileContent } from '@deepseek-ai/dsh-yantao-kb'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import type { KbCreateEntityArgs, KbTreeSection } from '../src/types.ts'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let ctx: Context
let fiber: { dispose(): Promise<void> }

const TODAY = todayStamp()

async function seedFile(relative: string, content: string): Promise<void> {
  const target = join(kbRoot, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
}

// The real plugin owns the live root and persists the override; these tests
// stand in a service that behaves like it, without touching the developer's
// `~/.dsh`.
let liveRoot: string
let configured: boolean

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-controller-'))
  liveRoot = kbRoot
  configured = false
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return liveRoot
    },
    get configured(): boolean {
      return configured
    },
    setRoot(next: string): void {
      liveRoot = next
      configured = true
    },
  } satisfies YantaoKbService)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

async function seedKb(): Promise<void> {
  await seedFile('entities/projects/dsh 学习.md', entityFileContent('project', 'dsh 学习', TODAY))
  await seedFile('entities/projects/旧项目.md', entityFileContent('project', '旧项目', TODAY).replace('tags: []', 'archive: true\ntags: []'))
  await seedFile('entities/areas/健康.md', entityFileContent('area', '健康', TODAY))
  await seedFile('entities/people/我自己.md', entityFileContent('person', '我自己', TODAY, { relation: 'self' }))
  await seedFile('entities/meetings/周会.md', entityFileContent('meeting', '周会', TODAY, { meetingDate: TODAY }))
  await seedFile('entities/todos.md', todoFileContent(TODAY))
  await seedFile('resources/周报.eml', 'raw mail bytes')
  await seedFile('resources/周报.eml.md', '---\ntype: resource\n---\n')
  await seedFile('resources/照片.png', 'png-bytes')
}

describe('yantaoKb.intakeTree', () => {
  it('returns resources, meetings and todos even when the KB is empty', async () => {
    const tree = await ctx.yantaoKbController.intakeTree()
    expect(tree.sections.map(section => section.id)).toEqual(['resources', 'meetings', 'todos'])
    for (const section of tree.sections) expect(section.files).toEqual([])
  })

  it('pairs resource rows with their shadow notes', async () => {
    await seedKb()
    const tree = await ctx.yantaoKbController.intakeTree()
    const [resources, meetings, todos] = tree.sections as [KbTreeSection, KbTreeSection, KbTreeSection]
    expect(resources.files).toEqual([
      { name: '周报.eml', path: 'resources/周报.eml', notePath: 'resources/周报.eml.md' },
      { name: '照片.png', path: 'resources/照片.png' },
    ])
    expect(meetings.files).toEqual([{ name: '周会', path: 'entities/meetings/周会.md' }])
    expect(todos.files).toEqual([{ name: 'todos', path: 'entities/todos.md' }])
  })

  it('lists a .md with no original beside it as a resource of its own, suffix included', async () => {
    await seedKb()
    await seedFile('resources/汇报模板.md', '---\ntype: resource\n---\n')
    const [resources] = (await ctx.yantaoKbController.intakeTree()).sections as [KbTreeSection]
    expect(resources.files).toContainEqual({ name: '汇报模板.md', path: 'resources/汇报模板.md' })
    // The shadow note beside 周报.eml is still that original's, not a row.
    expect(resources.files).not.toContainEqual({ name: '周报.eml.md', path: 'resources/周报.eml.md' })
    expect(resources.files.length).toBe(3)
  })
})

describe('yantaoKb.workspaceTree', () => {
  it('returns projects, areas and people even when the KB is empty', async () => {
    const tree = await ctx.yantaoKbController.workspaceTree()
    expect(tree.sections.map(section => section.id)).toEqual(['projects', 'areas', 'people'])
    for (const section of tree.sections) expect(section.files).toEqual([])
  })

  it('carries archive and relation flags on entity rows', async () => {
    await seedKb()
    const [projects, areas, people] = (await ctx.yantaoKbController.workspaceTree())
      .sections as [KbTreeSection, KbTreeSection, KbTreeSection]
    expect(projects.files).toEqual([
      { name: 'dsh 学习', path: 'entities/projects/dsh 学习.md' },
      { name: '旧项目', path: 'entities/projects/旧项目.md', archived: true },
    ])
    expect(areas.files).toEqual([{ name: '健康', path: 'entities/areas/健康.md' }])
    expect(people.files).toEqual([{ name: '我自己', path: 'entities/people/我自己.md', relation: 'self' }])
  })
})

describe('yantaoKb.read', () => {
  it('returns the complete file content', async () => {
    await seedKb()
    const result = await ctx.yantaoKbController.read('entities/projects/dsh 学习.md')
    expect(result.path).toBe('entities/projects/dsh 学习.md')
    expect(result.content).toBe(entityFileContent('project', 'dsh 学习', TODAY))
  })

  it('classifies a missing file as yantao-kb/not-found', async () => {
    const failure = await ctx.yantaoKbController.read('entities/projects/不存在.md').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/not-found',
      details: { path: 'entities/projects/不存在.md' },
    })
  })

  it('rejects escape attempts without touching the filesystem', async () => {
    const failure = await ctx.yantaoKbController.read('../../etc/passwd').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    const absolute = join(tmpdir(), 'outside.md')
    const failure2 = await ctx.yantaoKbController.read(absolute).catch((error: unknown) => error)
    expect(remoteErrorOf(failure2)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('refuses a binary original as yantao-kb/binary instead of decoding it', async () => {
    await seedKb()
    // A pdf's first bytes: `%PDF` then the binary header garbage that follows.
    await writeFile(join(kbRoot, 'resources/书.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0x9e]))
    const failure = await ctx.yantaoKbController.read('resources/书.pdf').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/binary',
      details: { path: 'resources/书.pdf' },
    })
  })
})

describe('yantaoKb.write', () => {
  it('writes full content the human channel owns, creating parent directories', async () => {
    const result = await ctx.yantaoKbController.write('entities/projects/新项目.md', entityFileContent('project', '新项目', TODAY))
    expect(result.path).toBe('entities/projects/新项目.md')
    const onDisk = await readFile(join(kbRoot, 'entities/projects/新项目.md'), 'utf8')
    expect(onDisk).toBe(entityFileContent('project', '新项目', TODAY))
  })

  it('rejects escape attempts and never writes outside the root', async () => {
    const escapeTarget = join(kbRoot, '..', 'escape-victim.md')
    const failure = await ctx.yantaoKbController.write('../escape-victim.md', 'x').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    await expect(readFile(escapeTarget, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('yantaoKb.setRelation', () => {
  it('rewrites the relation a person carries, and adds the field when it is absent', async () => {
    await seedKb()
    const path = 'entities/people/我自己.md'
    const result = await ctx.yantaoKbController.setRelation({ path, relation: 'peer' })
    expect(result).toEqual({ path, relation: 'peer' })
    expect(await readFile(join(kbRoot, path), 'utf8')).toContain('relation: peer')

    const plain = await ctx.yantaoKbController.createEntity({ type: 'person', name: '没有关系的' })
    const added = await ctx.yantaoKbController.setRelation({ path: plain.path, relation: 'superior' })
    expect(added.relation).toBe('superior')
    const content = await readFile(join(kbRoot, plain.path), 'utf8')
    expect(content).toContain('relation: superior')
    // The splice keeps the document's own sections: nothing else moved.
    expect(content).toContain('## 状态')
    expect(content).toContain('- ')
  })

  it('refuses a file that is not a person, a missing file, and an unknown relation', async () => {
    await seedKb()
    const project = 'entities/projects/dsh 学习.md'
    const notAPerson = await ctx.yantaoKbController.setRelation({ path: project, relation: 'peer' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(notAPerson)).toMatchObject({ code: 'yantao-kb/rejected', details: { path: project } })
    expect(await readFile(join(kbRoot, project), 'utf8')).not.toContain('relation:')

    const missing = await ctx.yantaoKbController.setRelation({ path: 'entities/people/不存在.md', relation: 'peer' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(missing)).toMatchObject({ code: 'yantao-kb/not-found' })

    const unknown = await ctx.yantaoKbController.setRelation({
      path: 'entities/people/我自己.md',
      relation: 'friend',
    } as unknown as Parameters<typeof ctx.yantaoKbController.setRelation>[0]).catch((error: unknown) => error)
    expect(remoteErrorOf(unknown)).toMatchObject({ code: 'yantao-kb/rejected' })
  })
})

describe('yantaoKb.deleteFile', () => {
  it('removes one entity file', async () => {
    await seedKb()
    const result = await ctx.yantaoKbController.deleteFile('entities/projects/dsh 学习.md')
    expect(result).toEqual({ path: 'entities/projects/dsh 学习.md' })
    await expect(readFile(join(kbRoot, 'entities/projects/dsh 学习.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('classifies a missing file as yantao-kb/not-found', async () => {
    const failure = await ctx.yantaoKbController.deleteFile('entities/areas/不存在.md')
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'yantao-kb/not-found',
      details: { path: 'entities/areas/不存在.md' },
    })
  })

  it('rejects escape attempts without touching the filesystem', async () => {
    await seedKb()
    const outside = join(kbRoot, '..', 'delete-victim.md')
    await writeFile(outside, 'untouched', 'utf8')
    try {
      const failure = await ctx.yantaoKbController.deleteFile('../delete-victim.md').catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
      expect(await readFile(outside, 'utf8')).toBe('untouched')
    } finally {
      await rm(outside, { force: true })
    }
  })
})

describe('yantaoKb.root', () => {
  it('reports the live root and an unconfigured state', async () => {
    expect(await ctx.yantaoKbController.root()).toEqual({ root: kbRoot, configured: false })
  })
})

describe('yantaoKb.setRoot', () => {
  it('creates the skeleton, then reports it as existing on a second call', async () => {
    const chosen = await mkdtemp(join(tmpdir(), 'yantao-kb-chosen-'))
    try {
      const first = await ctx.yantaoKbController.setRoot(chosen)
      expect(first.root).toBe(chosen)
      expect(first.configured).toBe(true)
      expect(first.created).toContain('README.md')
      expect(first.created).toContain('entities/todos.md')
      expect(first.created).toContain('entities/meetings')
      expect(await ctx.yantaoKbController.root()).toEqual({ root: chosen, configured: true })

      const second = await ctx.yantaoKbController.setRoot(chosen)
      expect(second.root).toBe(chosen)
      expect(second.created).toEqual([])
      expect(second.existing).toContain('README.md')
      expect(second.existing).toContain('entities/todos.md')
    } finally {
      await rm(chosen, { recursive: true, force: true })
    }
  })

  it('rejects a relative or empty path', async () => {
    for (const bad of ['', '   ', 'kb', './kb']) {
      const failure = await ctx.yantaoKbController.setRoot(bad).catch((error: unknown) => error)
      expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected', details: { path: bad } })
    }
  })

  it('rejects a path it cannot initialize', async () => {
    await seedFile('entities/todos.md', todoFileContent(TODAY))
    const blocked = join(kbRoot, 'entities/todos.md', 'nested')
    const failure = await ctx.yantaoKbController.setRoot(blocked).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected', details: { path: blocked } })
  })
})

describe('yantaoKb.createEntity', () => {
  it('files a meeting under its date and every other kind under its name', async () => {
    const meeting = await ctx.yantaoKbController.createEntity({ type: 'meeting', name: '周会', date: '2026-09-09' })
    expect(meeting.path).toBe('entities/meetings/2026-09-09 周会.md')
    expect(await readFile(join(kbRoot, meeting.path), 'utf8')).toBe(
      entityFileContent('meeting', '周会', TODAY, { meetingDate: '2026-09-09' }),
    )
    const project = await ctx.yantaoKbController.createEntity({ type: 'project', name: 'dsh 学习' })
    expect(project.path).toBe('entities/projects/dsh 学习.md')
    expect(await readFile(join(kbRoot, project.path), 'utf8')).toBe(entityFileContent('project', 'dsh 学习', TODAY))
  })

  it('defaults the meeting date to today', async () => {
    const { path } = await ctx.yantaoKbController.createEntity({ type: 'meeting', name: '周会' })
    expect(path).toBe(`entities/meetings/${TODAY} 周会.md`)
  })

  it('carries the relation the caller named, and the KB default when it named none', async () => {
    const peer = await ctx.yantaoKbController.createEntity({ type: 'person', name: '新同事', relation: 'peer' })
    expect(peer.path).toBe('entities/people/新同事.md')
    expect(await readFile(join(kbRoot, peer.path), 'utf8')).toContain('relation: peer')

    const plain = await ctx.yantaoKbController.createEntity({ type: 'person', name: '另一个人' })
    expect(await readFile(join(kbRoot, plain.path), 'utf8')).toContain('relation: subordinate')
  })

  it('rejects the todo singleton and an entity that already exists', async () => {
    const singleton = { type: 'todo', name: 'todos' } as unknown as KbCreateEntityArgs
    const failure = await ctx.yantaoKbController.createEntity(singleton).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected', details: { path: 'entities/todos.md' } })
    expect((failure as Error).message).toMatch(/单例实体/)

    await ctx.yantaoKbController.createEntity({ type: 'area', name: '健康' })
    const duplicate = await ctx.yantaoKbController.createEntity({ type: 'area', name: '健康' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(duplicate)).toMatchObject({
      code: 'yantao-kb/rejected',
      details: { path: 'entities/areas/健康.md' },
    })
  })
})

describe('yantaoKb.revision', () => {
  it('reports the root it watches and starts at zero', async () => {
    const first = await ctx.yantaoKbController.revision()
    expect(first).toEqual({ root: kbRoot, revision: 0 })
  })

  it('follows a root chosen after the first poll', async () => {
    await ctx.yantaoKbController.revision()
    const moved = await mkdtemp(join(tmpdir(), 'yantao-kb-controller-moved-'))
    try {
      ctx.yantaoKb.setRoot(moved)
      expect((await ctx.yantaoKbController.revision()).root).toBe(moved)
    } finally {
      await rm(moved, { recursive: true, force: true })
    }
  })
})

// The happy path really hands the target to the desktop and is covered by
// `open.spec.ts` (which stands in a fake spawn). What matters here is that the
// bridge refuses to become a shell.
describe('yantaoKb.openExternal', () => {
  it('refuses a path that escapes the KB', async () => {
    const failure = await ctx.yantaoKbController.openExternal('../outside.md')
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('refuses a scheme that is not allowlisted, and shell metacharacters', async () => {
    for (const target of ['file:///etc/passwd', 'javascript:alert(1)', 'entities/a & calc.md']) {
      const failure = await ctx.yantaoKbController.openExternal(target).catch((error: unknown) => error)
      expect(remoteErrorOf(failure), target).toMatchObject({ code: 'yantao-kb/rejected' })
    }
  })

  it('refuses the empty target', async () => {
    const failure = await ctx.yantaoKbController.openExternal('   ').catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })
})
