import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let kbConfigured: boolean
let ctx: Context
let fiber: { dispose(): Promise<void> }

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-memory-rpc-'))
  kbConfigured = true
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return kbRoot
    },
    get configured(): boolean {
      return kbConfigured
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  ctx.provide('skills', { get: async () => undefined } as never)
  ctx.provide('tools', { register: () => {} } as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

const GLOBAL_PATH = '.dsh/yantao/memory/global.md'

describe('yantaoKb.memoryList', () => {
  it('answers an empty group list before anything is remembered', async () => {
    expect(await ctx.yantaoKbController.memoryList()).toEqual({ groups: [] })
  })

  it('groups the scopes with their exact text and parsed entries', async () => {
    await ctx.yantaoKbController.memoryAdd({ scope: 'global', text: '新建项目应尝试关联 area' })
    await ctx.yantaoKbController.memoryAdd({ scope: 'mail', text: '同类邮件直接提示删除' })
    const { groups } = await ctx.yantaoKbController.memoryList()
    expect(groups.map(group => group.scope)).toEqual(['global', 'mail'])
    expect(groups[0]?.path).toBe(GLOBAL_PATH)
    expect(groups[0]?.entries).toHaveLength(1)
    expect(groups[0]?.entries[0]?.text).toBe('新建项目应尝试关联 area')
    expect(groups[0]?.text).toContain('- ')
  })
})

describe('yantaoKb.memoryAdd', () => {
  it('stamps the entry with today and stores the trimmed text', async () => {
    const { path, entry } = await ctx.yantaoKbController.memoryAdd({ scope: 'global', text: '  同类邮件直接提示删除  ' })
    expect(path).toBe(GLOBAL_PATH)
    expect(entry.text).toBe('同类邮件直接提示删除')
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(entry.id).toMatch(/^[0-9a-f]{40}$/)
  })

  it('refuses an exact duplicate as rejected', async () => {
    await ctx.yantaoKbController.memoryAdd({ scope: 'mail', text: '甲' })
    const failure = await ctx.yantaoKbController.memoryAdd({ scope: 'mail', text: '甲' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('refuses an unsafe scope as rejected', async () => {
    const failure = await ctx.yantaoKbController.memoryAdd({ scope: '../../escape', text: '甲' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
  })

  it('refuses before a KB root is chosen', async () => {
    kbConfigured = false
    const failure = await ctx.yantaoKbController.memoryAdd({ scope: 'global', text: '甲' }).catch((error: unknown) => error)
    const error = remoteErrorOf(failure)
    expect(error).toMatchObject({ code: 'yantao-kb/rejected' })
    expect(error?.message).toContain('还没有选择知识库目录')
  })
})

describe('yantaoKb.memoryDelete', () => {
  it('removes the entry the id addresses and keeps its siblings', async () => {
    await ctx.yantaoKbController.memoryAdd({ scope: 'global', text: '甲' })
    const added = await ctx.yantaoKbController.memoryAdd({ scope: 'global', text: '乙' })
    await ctx.yantaoKbController.memoryDelete({ scope: 'global', id: added.entry.id })
    const { groups } = await ctx.yantaoKbController.memoryList()
    expect(groups[0]?.entries.map(entry => entry.text)).toEqual(['甲'])
  })

  it('reports a stale id as not-found', async () => {
    await ctx.yantaoKbController.memoryAdd({ scope: 'global', text: '甲' })
    const failure = await ctx.yantaoKbController.memoryDelete({ scope: 'global', id: 'deadbeef' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/not-found' })
  })
})

describe('hand-edited memory files are first-class scopes', () => {
  it('a file the human created by hand shows up in the list and accepts appends', async () => {
    const dir = join(kbRoot, '.dsh', 'yantao', 'memory', 'capabilities')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'agenda.md'), '# 记忆 · agenda\n\n- 2026-01-01 人写的\n', 'utf8')
    const { groups } = await ctx.yantaoKbController.memoryList()
    expect(groups.map(group => group.scope)).toEqual(['agenda'])
    expect(groups[0]?.entries[0]?.text).toBe('人写的')
    await ctx.yantaoKbController.memoryAdd({ scope: 'agenda', text: '机写的' })
    const after = (await ctx.yantaoKbController.memoryList()).groups[0]
    expect(after?.entries.map(entry => entry.text)).toEqual(['人写的', '机写的'])
    expect(after?.text).toContain('# 记忆 · agenda')
  })
})
