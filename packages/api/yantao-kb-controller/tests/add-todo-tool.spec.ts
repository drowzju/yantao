import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

/** The tool-level harness: same stand-ins as the proposal-tool spec, driving
 * `kb_add_todo` (ADR-0061 决定 1) through the captured registration. */
describe('kb_add_todo 工具（对话直写待办）', () => {
  let kbRoot: string
  let ctx: Context
  let fiber: { dispose(): Promise<void> }
  let registered: ToolDefinition[]

  beforeEach(async () => {
    kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-add-todo-'))
    ctx = new Context()
    ctx.provide('yantaoKb', {
      get root(): string {
        return kbRoot
      },
      get configured(): boolean {
        return true
      },
      setRoot(): void {},
    } satisfies YantaoKbService)
    ctx.provide('skills', { get: async () => undefined } as never)
    registered = []
    ctx.provide('tools', { register: (definition: ToolDefinition) => { registered.push(definition) } } as never)
    fiber = await ctx.plugin(YantaoKbController)
  })

  afterEach(async () => {
    await fiber.dispose()
    await rm(kbRoot, { recursive: true, force: true })
  })

  function tool(): ToolDefinition {
    const found = registered.find(entry => entry.name === 'kb_add_todo')
    expect(found).toBeDefined()
    return found as ToolDefinition
  }

  async function diskTodos(): Promise<string> {
    return await readFile(join(kbRoot, 'entities', 'todos.md'), 'utf8')
  }

  it('交互会话直写：缺文件播种序言 + 追加一项，落盘可回读', async () => {
    const result = await tool().execute({ title: '今晚跟省开吃饭' }, { agent: { id: 'sess_chat' } } as never) as { path: string; title: string }
    expect(result.path).toBe('entities/todos.md')
    expect(result.title).toBe('今晚跟省开吃饭')
    const text = await diskTodos()
    expect(text).toContain('---\ntype: todo\ncreated: ')
    expect(text).toContain('- [ ] 今晚跟省开吃饭')
  })

  it('已有文件：人的序言原样保留，新项追加在末尾', async () => {
    const target = join(kbRoot, 'entities', 'todos.md')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, '# 我的一周\n\n- [ ] [due::2026-10-01] 旧待办\n', 'utf8')
    await tool().execute({ title: '新待办', due: '2026-10-18', body: '带瓶酒' }, {} as never)
    const text = await diskTodos()
    expect(text.startsWith('# 我的一周\n\n')).toBe(true)
    expect(text).toContain('- [ ] [due::2026-10-01] 旧待办')
    expect(text).toContain('- [ ] [due::2026-10-18] 新待办')
    expect(text).toContain('带瓶酒')
  })

  it('登记过的调度会话被拒绝并引导去 kb_propose_actions，磁盘零痕迹', async () => {
    const controller = ctx.yantaoKbController as InstanceType<typeof YantaoKbController>
    controller.scheduledRunMark({ sessionId: 'sess_fire' })
    await expect(tool().execute({ title: '自动写入' }, { agent: { id: 'sess_fire' } } as never))
      .rejects.toThrow(/kb_propose_actions/)
    await expect(diskTodos()).rejects.toMatchObject({ code: 'ENOENT' })
    // 注销后同一会话恢复交互身份
    controller.scheduledRunForget({ sessionId: 'sess_fire' })
    const result = await tool().execute({ title: '人工写入' }, { agent: { id: 'sess_fire' } } as never) as { title: string }
    expect(result.title).toBe('人工写入')
  })

  it('带 agent 但未登记：照常直写（闸门只认登记簿，不看有没有 agent）', async () => {
    const result = await tool().execute({ title: '普通会话' }, { agent: { id: 'sess_unknown' } } as never) as { title: string }
    expect(result.title).toBe('普通会话')
    expect(await diskTodos()).toContain('- [ ] 普通会话')
  })

  it('空标题抛 KbError 措辞；due/body 空白被修剪或缺席时不留脏字段', async () => {
    await expect(tool().execute({ title: '   ' }, {} as never)).rejects.toThrow('待办标题不能为空')
    await tool().execute({ title: '空白处理', due: '  ', body: '' }, {} as never)
    const text = await diskTodos()
    expect(text).toContain('- [ ] 空白处理')
    expect(text).not.toContain('[due::')
  })
})
