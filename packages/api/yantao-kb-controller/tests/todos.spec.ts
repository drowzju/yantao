import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { todayStamp } from '@deepseek-ai/dsh-yantao-kb'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import type { KbTodoItem } from '../src/types.ts'
import YantaoKbController from '../src/index.ts'

const TODOS_PATH = 'entities/todos.md'
const TODAY = todayStamp()

let kbRoot: string
let ctx: Context
let fiber: { dispose(): Promise<void> }

// The real plugin owns the live root; this stand-in behaves like it without
// touching the developer's `~/.dsh`.
let liveRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-todos-'))
  liveRoot = kbRoot
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return liveRoot
    },
    get configured(): boolean {
      return false
    },
    setRoot(next: string): void {
      liveRoot = next
    },
  } satisfies YantaoKbService)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

async function seedTodos(content: string): Promise<void> {
  const target = join(kbRoot, TODOS_PATH)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
}

async function onDisk(): Promise<string> {
  return await readFile(join(kbRoot, TODOS_PATH), 'utf8')
}

function item(overrides: Partial<KbTodoItem> = {}): KbTodoItem {
  return { done: false, title: '把季度汇报发给张三', body: '', extra: [], ...overrides }
}

describe('yantaoKb.todos', () => {
  it('answers an empty board when the file is absent', async () => {
    expect(await ctx.yantaoKbController.todos()).toEqual({ path: TODOS_PATH, text: '', items: [] })
  })

  it('parses fields, body and extra tokens, and echoes the exact text', async () => {
    const text = '- [ ] [due::2026-09-12] 把季度汇报发给张三\n  正文第一行，缩进恰好两个空格\n'
      + '- [x] [due::2026-09-10] [done::2026-09-09] 已完成的事\n'
      + '- [ ] 没有字段的旧行\n'
      + '- [ ] [owner::我] 未知字段\n'
    await seedTodos(text)
    const result = await ctx.yantaoKbController.todos()
    expect(result.path).toBe(TODOS_PATH)
    expect(result.text).toBe(text)
    expect(result.items).toEqual([
      { done: false, title: '把季度汇报发给张三', due: '2026-09-12', body: '正文第一行，缩进恰好两个空格', extra: [] },
      { done: true, title: '已完成的事', due: '2026-09-10', doneOn: '2026-09-09', body: '', extra: [] },
      { done: false, title: '没有字段的旧行', body: '', extra: [] },
      { done: false, title: '未知字段', body: '', extra: ['[owner::我]'] },
    ])
  })

  it('keeps a human-written preamble without treating it as an item', async () => {
    await seedTodos(`# 待办\n\n- [ ] ${TODAY} 的第一件事\n`)
    const { items } = await ctx.yantaoKbController.todos()
    expect(items).toEqual([{ done: false, title: `${TODAY} 的第一件事`, body: '', extra: [] }])
  })
})

describe('yantaoKb.writeTodos', () => {
  it('round trips: what it writes is what todos reads back', async () => {
    const written = await ctx.yantaoKbController.writeTodos({
      items: [
        item({ due: '2026-09-12', body: '正文第一行\n第二行' }),
        item({ done: true, title: '已完成的事', due: '2026-09-10', doneOn: '2026-09-09' }),
      ],
      expectedText: '',
    })
    expect(written.path).toBe(TODOS_PATH)
    expect(await onDisk()).toBe(written.text)
    const reread = await ctx.yantaoKbController.todos()
    expect(reread.text).toBe(written.text)
    expect(reread.items).toHaveLength(2)
    expect(reread.items[0]).toEqual({
      done: false,
      title: '把季度汇报发给张三',
      due: '2026-09-12',
      body: '正文第一行\n第二行',
      extra: [],
    })
    expect(reread.items[1]?.doneOn).toBe('2026-09-09')
  })

  it('creates the singleton when it does not exist yet', async () => {
    const { text } = await ctx.yantaoKbController.writeTodos({ items: [item()], expectedText: '' })
    expect(text).toBe('- [ ] 把季度汇报发给张三\n')
    expect(await onDisk()).toBe(text)
  })

  it('preserves the preamble across a write', async () => {
    const seeded = '# 待办\n\n- [ ] 旧的一条\n'
    await seedTodos(seeded)
    const { text } = await ctx.yantaoKbController.writeTodos({ items: [item({ title: '新的一条' })], expectedText: seeded })
    expect(text).toBe('# 待办\n\n- [ ] 新的一条\n')
    expect(await onDisk()).toBe(text)
  })

  it('writes an empty list, leaving the preamble alone', async () => {
    await seedTodos('# 待办\n\n- [ ] 旧的一条\n')
    const { text } = await ctx.yantaoKbController.writeTodos({ items: [], expectedText: '# 待办\n\n- [ ] 旧的一条\n' })
    expect(text).toBe('# 待办\n')
    expect((await ctx.yantaoKbController.todos()).items).toEqual([])
  })

  it('rejects a stale expectedText without touching the file', async () => {
    const seeded = '- [ ] 别人的修改\n'
    await seedTodos(seeded)
    const failure = await ctx.yantaoKbController.writeTodos({ items: [item()], expectedText: '- [ ] 我读到的旧内容\n' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected', details: { path: TODOS_PATH } })
    expect((failure as Error).message).toMatch(/已被别处修改/)
    expect(await onDisk()).toBe(seeded)
  })

  it('surfaces a serialization KbError as yantao-kb/rejected', async () => {
    const failure = await ctx.yantaoKbController.writeTodos({
      items: [item({ due: '2026/09/12' })],
      expectedText: '',
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected', details: { path: TODOS_PATH } })
    expect((failure as Error).message).toMatch(/YYYY-MM-DD/)
    await expect(onDisk()).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
