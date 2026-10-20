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
    // kb_read_session_log reads through the session controller; these tests never call it.
    ctx.provide('sessionController', { follow: () => (async function* () {})(), page: async () => ({ records: [], hasMore: false }) } as never)
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

  /* ── ADR-0065：运行历史 / 提议收件箱 / 调度面 ────────────────────────── */

  describe('kb_list_workspace_runs', () => {
    const RUNS_STORE = join('.dsh', 'yantao', 'workspace-runs.json')

    function seedRuns(runs: readonly unknown[]): Promise<void> {
      const target = join(kbRoot, RUNS_STORE)
      return mkdir(dirname(target), { recursive: true })
        .then(() => writeFile(target, JSON.stringify({ version: 1, runs }), 'utf8'))
    }

    function runRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'run_a', workspaceId: 'ws_a', instructionId: 'ins_1', instructionName: '拉周报',
        trigger: 'agent', status: 'success',
        startedAt: '2026-10-19T08:00:00.000Z', finishedAt: '2026-10-19T08:05:00.000Z',
        finalResult: '周报拉好了', steps: [],
        ...overrides,
      }
    }

    it('倒序列出运行历史（最新在前），带终态与结果摘要', async () => {
      await seedRuns([runRow(), runRow({ id: 'run_b', instructionName: '收邮件', trigger: 'cron' })])
      const result = await tool('kb_list_workspace_runs').execute({}, {} as never) as {
        runs: readonly { id: string; instructionName: string; status: string; finalResult?: string }[]
      }
      expect(result.runs.map(entry => entry.id)).toEqual(['run_b', 'run_a'])
      expect(result.runs[1]).toMatchObject({ status: 'success', finalResult: '周报拉好了' })
    })

    it('按 workspaceId 与 runId 过滤', async () => {
      await seedRuns([
        runRow(),
        runRow({ id: 'run_b', workspaceId: 'ws_other', instructionName: '别处的指令' }),
      ])
      const bySpace = await tool('kb_list_workspace_runs')
        .execute({ workspaceId: 'ws_other' }, {} as never) as { runs: readonly { id: string }[] }
      expect(bySpace.runs.map(entry => entry.id)).toEqual(['run_b'])
      const byRun = await tool('kb_list_workspace_runs')
        .execute({ runId: 'run_a' }, {} as never) as { runs: readonly { id: string }[] }
      expect(byRun.runs).toHaveLength(1)
      expect(byRun.runs[0]?.id).toBe('run_a')
    })

    it('失败行带上失败步骤的错误原文', async () => {
      await seedRuns([runRow({
        status: 'failed', failedStep: 0, finalResult: undefined,
        steps: [{ index: 0, promptSnapshot: '第一步', error: '退出码 1：boom' }],
      })])
      const result = await tool('kb_list_workspace_runs')
        .execute({ runId: 'run_a' }, {} as never) as { runs: readonly { status: string; error?: string }[] }
      expect(result.runs[0]).toMatchObject({ status: 'failed', error: '退出码 1：boom' })
    })

    it('includeLog 附带日志尾部；日志已被清理时如实降级', async () => {
      await seedRuns([runRow()])
      const logDir = join(kbRoot, 'sessions', 'workspace')
      await mkdir(logDir, { recursive: true })
      await writeFile(join(logDir, 'run_a.log'), '第一行\n第二行\n✔ 完成\n', 'utf8')
      const withLog = await tool('kb_list_workspace_runs')
        .execute({ runId: 'run_a', includeLog: true }, {} as never) as { logTail?: string }
      expect(withLog.logTail).toContain('✔ 完成')
      await rm(join(logDir, 'run_a.log'))
      const withoutLog = await tool('kb_list_workspace_runs')
        .execute({ runId: 'run_a', includeLog: true }, {} as never) as { logTail?: string }
      expect(withoutLog.logTail).toBeUndefined()
    })
  })

  describe('kb_list_proposals', () => {
    const INBOX_STORE = join('.dsh', 'yantao', 'proposal-inbox.json')

    function seedInbox(entries: readonly unknown[]): Promise<void> {
      const target = join(kbRoot, INBOX_STORE)
      return mkdir(dirname(target), { recursive: true })
        .then(() => writeFile(target, JSON.stringify({ version: 1, proposals: entries }), 'utf8'))
    }

    function entryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'prp_a', createdAt: '2026-10-19T08:00:00.000Z', source: 'schedule:sch_1',
        sourceName: '收邮件', title: '三封邮件待归档',
        proposal: { title: '三封邮件待归档', actions: [{ kind: 'archive-mails' }] },
        status: 'pending',
        ...overrides,
      }
    }

    it('默认只列待批条目；decided/all 各自筛对', async () => {
      await seedInbox([
        entryRow(),
        entryRow({ id: 'prp_b', title: '已批的提议', status: 'approved', decidedAt: '2026-10-19T09:00:00.000Z' }),
        entryRow({
          id: 'prp_c', title: '部分失败的提议', status: 'approved-with-errors', decidedAt: '2026-10-19T09:30:00.000Z',
          applyResults: [{ index: 0, ok: true, error: '' }, { index: 1, ok: false, error: '实体不存在' }],
        }),
      ])
      const pending = await tool('kb_list_proposals').execute({}, {} as never) as {
        proposals: readonly { id: string; status: string }[]
      }
      expect(pending.proposals.map(row => row.id)).toEqual(['prp_a'])
      const decided = await tool('kb_list_proposals')
        .execute({ status: 'decided' }, {} as never) as { proposals: readonly { id: string }[] }
      expect(decided.proposals.map(row => row.id)).toEqual(['prp_c', 'prp_b'])
      const all = await tool('kb_list_proposals')
        .execute({ status: 'all' }, {} as never) as { proposals: readonly { id: string }[] }
      expect(all.proposals).toHaveLength(3)
    })

    it('已裁决行带失败动作计数；载荷不透传', async () => {
      await seedInbox([entryRow({
        id: 'prp_c', status: 'approved-with-errors', decidedAt: '2026-10-19T09:30:00.000Z',
        applyResults: [{ index: 0, ok: true, error: '' }, { index: 1, ok: false, error: '坏了' }],
      })])
      const result = await tool('kb_list_proposals').execute({ status: 'decided' }, {} as never) as {
        proposals: readonly { applyErrors?: number; proposal?: unknown }[]
      }
      expect(result.proposals[0]?.applyErrors).toBe(1)
      expect(result.proposals[0]?.proposal).toBeUndefined()
    })
  })

  describe('调度面四件套（ADR-0065）', () => {
    const SCHEDULES_STORE = join('.dsh', 'yantao', 'schedules.json')

    function seedSchedules(schedules: readonly unknown[]): Promise<void> {
      const target = join(kbRoot, SCHEDULES_STORE)
      return mkdir(dirname(target), { recursive: true })
        .then(() => writeFile(target, JSON.stringify({ version: 1, schedules }), 'utf8'))
    }

    async function diskSchedules(): Promise<{ schedules: readonly Record<string, unknown>[] }> {
      return JSON.parse(await readFile(join(kbRoot, SCHEDULES_STORE), 'utf8')) as { schedules: readonly Record<string, unknown>[] }
    }

    function scheduleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'sch_a', name: '收邮件', prompt: '把邮箱里的新邮件收进来', cron: '0 8 * * *',
        enabled: true, lastFiredAt: '2026-10-19T08:00:00.000Z',
        ...overrides,
      }
    }

    it('kb_list_schedules 列出全字段（含簿记戳）', async () => {
      await seedSchedules([scheduleRow({ capability: 'mail' })])
      const result = await tool('kb_list_schedules').execute({}, {} as never) as {
        schedules: readonly { id: string; name: string; cron: string; enabled: boolean; capability?: string; lastFiredAt?: string }[]
      }
      expect(result.schedules[0]).toMatchObject({
        id: 'sch_a', name: '收邮件', cron: '0 8 * * *', enabled: true,
        capability: 'mail', lastFiredAt: '2026-10-19T08:00:00.000Z',
      })
    })

    it('kb_add_schedule：新建落盘（默认启用），非法 cron 被拒', async () => {
      const result = await tool('kb_add_schedule').execute({
        name: '晨报', prompt: '整理昨天的动态', cron: '30 7 * * 1-5',
      }, { agent: { id: 'sess_chat' } } as never) as { id: string; enabled: boolean }
      expect(result.id).toMatch(/^sch_/)
      expect(result).toMatchObject({ name: '晨报', cron: '30 7 * * 1-5', enabled: true })
      const disk = await diskSchedules()
      expect(disk.schedules).toHaveLength(1)
      expect(disk.schedules[0]).toMatchObject({ name: '晨报' })

      await expect(tool('kb_add_schedule')
        .execute({ name: '坏任务', prompt: 'x', cron: '61 * * * *' }, {} as never))
        .rejects.toThrow('超出 0-59 范围')
    })

    it('kb_update_schedule：改 cron 保簿记戳；传空 capability 清除绑定', async () => {
      await seedSchedules([scheduleRow({ capability: 'mail' })])
      const result = await tool('kb_update_schedule')
        .execute({ id: 'sch_a', cron: '0 9 * * *' }, { agent: { id: 'sess_chat' } } as never) as {
        cron: string
      }
      expect(result.cron).toBe('0 9 * * *')
      const disk = await diskSchedules()
      expect(disk.schedules[0]).toMatchObject({
        cron: '0 9 * * *', lastFiredAt: '2026-10-19T08:00:00.000Z', capability: 'mail',
      })

      await tool('kb_update_schedule')
        .execute({ id: 'sch_a', capability: '' }, { agent: { id: 'sess_chat' } } as never)
      const cleared = await diskSchedules()
      expect(cleared.schedules[0]).toMatchObject({ name: '收邮件' })
      expect(cleared.schedules[0]?.capability).toBeUndefined()
      expect(cleared.schedules[0]?.lastFiredAt).toBe('2026-10-19T08:00:00.000Z')
    })

    it('kb_update_schedule：不存在的 id 点名报错并列出现有任务', async () => {
      await seedSchedules([scheduleRow()])
      await expect(tool('kb_update_schedule')
        .execute({ id: 'sch_ghost', cron: '0 9 * * *' }, {} as never))
        .rejects.toThrow(/不存在.*收邮件\(sch_a\)/s)
    })

    it('kb_remove_schedule：删行；不存在的 id 拒绝', async () => {
      await seedSchedules([scheduleRow(), scheduleRow({ id: 'sch_b', name: '周报' })])
      const result = await tool('kb_remove_schedule')
        .execute({ id: 'sch_a' }, { agent: { id: 'sess_chat' } } as never) as { remaining: number }
      expect(result.remaining).toBe(1)
      const disk = await diskSchedules()
      expect(disk.schedules.map(row => row.id)).toEqual(['sch_b'])

      await expect(tool('kb_remove_schedule').execute({ id: 'sch_ghost' }, {} as never))
        .rejects.toThrow('不存在')
    })

    it('调度会话：增改删全被拒（无人监督的写入仍要等人操作）', async () => {
      const controller = ctx.yantaoKbController as InstanceType<typeof YantaoKbController>
      controller.scheduledRunMark({ sessionId: 'sess_fire' })
      await expect(tool('kb_add_schedule')
        .execute({ name: 'x', prompt: 'x', cron: '0 8 * * *' }, { agent: { id: 'sess_fire' } } as never))
        .rejects.toThrow(/定时任务/)
      await expect(tool('kb_update_schedule')
        .execute({ id: 'sch_a' }, { agent: { id: 'sess_fire' } } as never))
        .rejects.toThrow(/定时任务/)
      await expect(tool('kb_remove_schedule')
        .execute({ id: 'sch_a' }, { agent: { id: 'sess_fire' } } as never))
        .rejects.toThrow(/定时任务/)
    })
  })
})
