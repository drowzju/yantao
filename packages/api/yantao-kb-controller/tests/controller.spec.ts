import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { entityFileContent, todayStamp } from '@deepseek-ai/dsh-yantao-kb'
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

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-controller-'))
  ctx = new Context()
  ctx.provide('yantaoKb', { root: kbRoot })
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
  await seedFile('entities/people/我自己.md', entityFileContent('person', '我自己', TODAY, 'self'))
  await seedFile('resources/周报.eml', 'raw mail bytes')
  await seedFile('resources/周报.eml.md', '---\ntype: resource\n---\n')
  await seedFile('resources/照片.png', 'png-bytes')
  await seedFile('sessions/2026-09-01.md', '# 会话归档\n')
}

describe('yantaoKb.tree', () => {
  it('returns all five sections even when the KB is empty', async () => {
    const tree = await ctx.yantaoKbController.tree()
    expect(tree.sections.map(section => section.id)).toEqual(['resources', 'projects', 'areas', 'people', 'sessions'])
    for (const section of tree.sections) expect(section.files).toEqual([])
  })

  it('shapes resources with shadow-note pairing and entities with flags', async () => {
    await seedKb()
    const tree = await ctx.yantaoKbController.tree()
    const resources = tree.sections[0]!
    expect(resources.files).toEqual([
      { name: '周报.eml', path: 'resources/周报.eml', notePath: 'resources/周报.eml.md' },
      { name: '照片.png', path: 'resources/照片.png' },
    ])
    const projects = tree.sections[1]!
    expect(projects.files).toEqual([
      { name: 'dsh 学习', path: 'entities/projects/dsh 学习.md' },
      { name: '旧项目', path: 'entities/projects/旧项目.md', archived: true },
    ])
    const areas = tree.sections[2]!
    expect(areas.files).toEqual([{ name: '健康', path: 'entities/areas/健康.md' }])
    const people = tree.sections[3]!
    expect(people.files).toEqual([{ name: '我自己', path: 'entities/people/我自己.md', relation: 'self' }])
    const sessions = tree.sections[4]!
    expect(sessions.files).toEqual([{ name: '2026-09-01.md', path: 'sessions/2026-09-01.md' }])
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
