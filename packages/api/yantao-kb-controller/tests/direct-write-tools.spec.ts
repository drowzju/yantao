import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

/** Poll until the predicate holds, failing with the label on timeout. */
async function until(description: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`等待超时：${description}`)
}

/** A minimal ChildProcess stand-in (workspace-rpc.spec 的同款简化版). */
class FakeChild extends EventEmitter implements Partial<ChildProcess> {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = { on: (): void => undefined, end: (): void => undefined, write: (): boolean => true }
  pid = 4242
  kill(): boolean {
    queueMicrotask(() => this.emit('close', null))
    return true
  }
}

/** A spawn fake: every child answers one result line, then closes cleanly. */
function fakeSpawn(result: string): unknown {
  return (): FakeChild => {
    const child = new FakeChild()
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'result', result })}\n`))
      child.emit('close', 0)
    })
    return child
  }
}

/** Seed the todo singleton with two open items and one done item. */
async function seedTodos(kbRoot: string, text: string): Promise<void> {
  const target = join(kbRoot, 'entities', 'todos.md')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text, 'utf8')
}

async function diskTodos(kbRoot: string): Promise<string> {
  return await readFile(join(kbRoot, 'entities', 'todos.md'), 'utf8')
}

/** The tool-level harness (same stand-ins as the add-todo-tool spec), driving
 * the ADR-0063 dialogue-direct tools through the captured registrations. */
describe('ADR-0063 对话直写工具', () => {
  let kbRoot: string
  let ctx: Context
  let fiber: { dispose(): Promise<void> }
  let registered: ToolDefinition[]

  beforeEach(async () => {
    kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-direct-'))
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

  function tool(name: string): ToolDefinition {
    const found = registered.find(entry => entry.name === name)
    expect(found).toBeDefined()
    return found as ToolDefinition
  }

  /* ── 待办面板 ─────────────────────────────────────────────────────────── */

  describe('kb_read_todos', () => {
    it('返回带 index 的全部条目（含已完成），序号与文件顺序一致', async () => {
      await seedTodos(kbRoot, '# 我的一周\n\n- [ ] [due::2026-10-17] 和省开同事聚餐\n- [x] [done::2026-10-16] 交周报\n')
      const result = await tool('kb_read_todos').execute({}, {} as never) as {
        path: string
        items: readonly { index: number; done: boolean; title: string; due?: string; doneOn?: string }[]
      }
      expect(result.path).toBe('entities/todos.md')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({ index: 0, done: false, title: '和省开同事聚餐', due: '2026-10-17' })
      expect(result.items[1]).toMatchObject({ index: 1, done: true, title: '交周报', doneOn: '2026-10-16' })
    })
  })

  describe('kb_toggle_todo', () => {
    it('勾选：盒子打勾并盖上今天的完成日期，序言原样保留', async () => {
      await seedTodos(kbRoot, '# 我的一周\n\n- [ ] [due::2026-10-17] 和省开同事聚餐\n- [ ] 交周报\n')
      const result = await tool('kb_toggle_todo').execute({ index: 0, done: true }, { agent: { id: 'sess_chat' } } as never) as { title: string; done: boolean }
      expect(result).toMatchObject({ title: '和省开同事聚餐', done: true })
      const text = await diskTodos(kbRoot)
      expect(text.startsWith('# 我的一周\n\n')).toBe(true)
      expect(text).toMatch(/^- \[x\] \[due::2026-10-17\] \[done::\d{4}-\d{2}-\d{2}\] 和省开同事聚餐$/m)
      expect(text).toContain('- [ ] 交周报')
    })

    it('取消勾选：抹掉完成日期，其余字段不动', async () => {
      await seedTodos(kbRoot, '- [x] [due::2026-10-16] [done::2026-10-16] 交周报\n')
      await tool('kb_toggle_todo').execute({ index: 0, done: false }, {} as never)
      const text = await diskTodos(kbRoot)
      expect(text).toContain('- [ ] [due::2026-10-16] 交周报')
      expect(text).not.toContain('[done::')
    })

    it('序号越界：点名报错并引导重读，磁盘零痕迹', async () => {
      await seedTodos(kbRoot, '- [ ] 唯一一条\n')
      await expect(tool('kb_toggle_todo').execute({ index: 5, done: true }, {} as never))
        .rejects.toThrow(/越界.*kb_read_todos/s)
      expect(await diskTodos(kbRoot)).toContain('- [ ] 唯一一条')
    })

    it('登记过的调度会话被拒绝，磁盘零痕迹', async () => {
      const controller = ctx.yantaoKbController as InstanceType<typeof YantaoKbController>
      controller.scheduledRunMark({ sessionId: 'sess_fire' })
      await seedTodos(kbRoot, '- [ ] 别动我\n')
      await expect(tool('kb_toggle_todo').execute({ index: 0, done: true }, { agent: { id: 'sess_fire' } } as never))
        .rejects.toThrow(/定时任务运行/)
      expect(await diskTodos(kbRoot)).toContain('- [ ] 别动我')
    })
  })

  describe('kb_update_todo / kb_remove_todo', () => {
    it('改期：due 换新值；空串清除', async () => {
      await seedTodos(kbRoot, '- [ ] [due::2026-10-17] 聚餐\n')
      await tool('kb_update_todo').execute({ index: 0, due: '2026-10-20' }, {} as never)
      expect(await diskTodos(kbRoot)).toContain('[due::2026-10-20]')
      await tool('kb_update_todo').execute({ index: 0, due: '' }, {} as never)
      expect(await diskTodos(kbRoot)).not.toContain('[due::')
    })

    it('改标题与正文；一个字段都不给则拒绝', async () => {
      await seedTodos(kbRoot, '- [ ] 聚餐\n')
      await tool('kb_update_todo').execute({ index: 0, title: '部门聚餐', body: '带瓶酒' }, {} as never)
      const text = await diskTodos(kbRoot)
      expect(text).toContain('- [ ] 部门聚餐')
      expect(text).toContain('  带瓶酒')
      await expect(tool('kb_update_todo').execute({ index: 0 }, {} as never)).rejects.toThrow('至少要给')
    })

    it('删除：连同正文一起移除，返回被删标题', async () => {
      await seedTodos(kbRoot, '- [ ] 甲\n- [ ] 乙\n  备注\n')
      const result = await tool('kb_remove_todo').execute({ index: 1 }, {} as never) as { title: string }
      expect(result.title).toBe('乙')
      const text = await diskTodos(kbRoot)
      expect(text).toContain('- [ ] 甲')
      expect(text).not.toContain('乙')
      expect(text).not.toContain('备注')
    })
  })

  /* ── 行为记忆 ─────────────────────────────────────────────────────────── */

  describe('kb_list_memory / kb_add_memory / kb_delete_memory', () => {
    it('增 → 查（带 id）→ 删 的整环', async () => {
      await tool('kb_add_memory').execute({ scope: 'global', text: '邮件摘要只回 512 字' }, {} as never) as { id: string }
      expect(await readFile(join(kbRoot, '.dsh', 'yantao', 'memory', 'global.md'), 'utf8'))
        .toContain('邮件摘要只回 512 字')

      const listed = await tool('kb_list_memory').execute({}, {} as never) as {
        scopes: readonly { scope: string; entries: readonly { id: string; text: string }[] }[]
      }
      const global = listed.scopes.find(scope => scope.scope === 'global')
      expect(global?.entries).toHaveLength(1)
      const id = global?.entries[0]?.id ?? ''

      await tool('kb_delete_memory').execute({ scope: 'global', id }, {} as never)
      const after = await tool('kb_list_memory').execute({}, {} as never) as {
        scopes: readonly { scope: string; entries: readonly unknown[] }[]
      }
      expect(after.scopes.find(scope => scope.scope === 'global')?.entries).toHaveLength(0)
    })

    it('重复记忆被拒绝（原文点名）', async () => {
      await tool('kb_add_memory').execute({ scope: 'global', text: '规则甲' }, {} as never)
      await expect(tool('kb_add_memory').execute({ scope: 'global', text: '规则甲' }, {} as never))
        .rejects.toThrow('已经存在')
    })

    it('调度会话：增删都被拒并指向 kb_propose_memory', async () => {
      const controller = ctx.yantaoKbController as InstanceType<typeof YantaoKbController>
      controller.scheduledRunMark({ sessionId: 'sess_fire' })
      await expect(tool('kb_add_memory').execute({ scope: 'global', text: '规则' }, { agent: { id: 'sess_fire' } } as never))
        .rejects.toThrow(/kb_propose_memory/)
      await expect(tool('kb_delete_memory').execute({ scope: 'global', id: 'x' }, { agent: { id: 'sess_fire' } } as never))
        .rejects.toThrow(/定时任务/)
    })
  })

  /* ── 工作空间 ─────────────────────────────────────────────────────────── */

  describe('kb_list_workspaces / kb_run_workspace_instruction', () => {
    const STORE = join('.dsh', 'yantao', 'workspaces.json')

    function seedStore(workspaces: unknown): Promise<void> {
      const target = join(kbRoot, STORE)
      return mkdir(dirname(target), { recursive: true })
        .then(() => writeFile(target, JSON.stringify({ version: 1, workspaces }), 'utf8'))
    }

    it('列出空间与指令链（含 id 与步骤数）', async () => {
      await seedStore([{
        id: 'ws_a', name: '周报间', directory: 'D:/notes', agent: 'codebuddy',
        instructions: [{ id: 'ins_1', name: '拉周报', enabled: true, steps: ['第一步', '第二步'] }],
      }])
      const result = await tool('kb_list_workspaces').execute({}, {} as never) as {
        workspaces: readonly {
          id: string
          name: string
          instructions: readonly { id: string; name: string; enabled: boolean; steps: readonly string[] }[]
        }[]
      }
      expect(result.workspaces).toHaveLength(1)
      expect(result.workspaces[0]).toMatchObject({ id: 'ws_a', name: '周报间' })
      expect(result.workspaces[0]?.instructions[0]).toMatchObject({ id: 'ins_1', name: '拉周报', enabled: true })
      expect(result.workspaces[0]?.instructions[0]?.steps).toEqual(['第一步', '第二步'])
    })

    it('触发指令：运行行落盘且 trigger 如实记 agent，链条跑完 success', async () => {
      await seedStore([{
        id: 'ws_a', name: '周报间', directory: kbRoot, agent: 'codebuddy',
        instructions: [{ id: 'ins_1', name: '拉周报', enabled: true, steps: ['第一步'] }],
      }])
      ctx.yantaoKbController.workspaceRuntime.spawnImpl = fakeSpawn('跑完了') as never
      const result = await tool('kb_run_workspace_instruction')
        .execute({ workspaceId: 'ws_a', instructionId: 'ins_1' }, { agent: { id: 'sess_chat' } } as never) as { runId: string }
      await until('run settles success', async () => {
        const runs = JSON.parse(await readFile(join(kbRoot, '.dsh', 'yantao', 'workspace-runs.json'), 'utf8')) as {
          runs: readonly { id: string; trigger: string; status: string }[]
        }
        return runs.runs.at(-1)?.id === result.runId && runs.runs.at(-1)?.status === 'success'
      })
      const runs = JSON.parse(await readFile(join(kbRoot, '.dsh', 'yantao', 'workspace-runs.json'), 'utf8')) as {
        runs: readonly { id: string; trigger: string; status: string }[]
      }
      expect(runs.runs.at(-1)?.trigger).toBe('agent')
    })

    it('空间或指令不存在：点名报错', async () => {
      await seedStore([])
      await expect(tool('kb_run_workspace_instruction')
        .execute({ workspaceId: 'nope', instructionId: 'ins_1' }, {} as never)).rejects.toThrow('不存在')
    })

    it('调度会话触发被拒（防链再触发链）', async () => {
      const controller = ctx.yantaoKbController as InstanceType<typeof YantaoKbController>
      controller.scheduledRunMark({ sessionId: 'sess_fire' })
      await expect(tool('kb_run_workspace_instruction')
        .execute({ workspaceId: 'ws_a', instructionId: 'ins_1' }, { agent: { id: 'sess_fire' } } as never))
        .rejects.toThrow(/链再触发链/)
    })
  })
})
