import { mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'
import { proposalOfPayload } from '../../../client/ui-yantao/src/client/capability-match.ts'
import { applyProposal } from '../../../client/ui-yantao/src/client/proposal-apply.ts'
import type { ProposalTarget } from '../../../client/ui-yantao/src/client/proposal-apply.ts'
import { runScheduledTask } from '../../../client/ui-yantao/src/client/scheduler.ts'

/**
 * 端到端（ADR-0047/0055）：调度 fire → 邮件能力指令内联（真 controller RPC：
 * 中央路由文件 + SKILL.md + 环境说明）→ 模型调 `kb_propose_actions`（真工具、
 * 真服务端校验、真磁盘收件箱）→ 调度器事件检测走工具路径 → 收件箱回查分流 →
 * 客户端 `proposalOfPayload` 解析成立（提议卡将渲染）。
 *
 * 唯一脚本化的是传输层与会话（session Remote 扮演模型的回合）；其余每一环
 * 都是生产代码——controller 插件、kb_propose_actions 工具、proposal-inbox
 * store、客户端调度器与 Remote 包装全部为真。
 */

// capability-tool.spec 同款：homedir 指向临时 KB，builtin 播种器不会越过
// version 999 的假技能覆写真实资产。
const { state } = vi.hoisted(() => ({ state: { home: '' } }))
vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => state.home,
}))

let home: string
let ctx: Context
let fiber: { dispose(): Promise<void> }
let registered: ToolDefinition[]

/** The central routing file's path in the test KB (ADR-0052: 唯一配置). */
function routesPath(): string {
  return join(home, '.dsh', 'skills', 'yantao.json')
}

async function routeEntry(name: string, invocation: readonly string[]): Promise<void> {
  await writeFile(routesPath(), JSON.stringify({
    version: 1,
    capabilities: { [name]: { path: name, invocation } },
  }), 'utf8')
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yantao-kb-e2e-'))
  state.home = home
  const skillDir = join(home, '.dsh', 'skills', 'mail')
  await mkdir(skillDir, { recursive: true })
  // version 999 高于 shipped master：builtin 播种器不会在测试中途覆写这个假技能。
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: mail\ndescription: 读 Outlook 邮件\nmetadata:\n  yantao:\n    version: 999\n---\n\n# 邮件能力说明\n\nSLIM 页宽 40。读邮件后按批次提名。\n',
    'utf8',
  )
  await routeEntry('mail', ['human'])

  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return home
    },
    get configured(): boolean {
      return true
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  ctx.provide('skills', {
    get: async () => undefined,
    list: async () => (await readdir(join(home, '.dsh', 'skills'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => ({ name: entry.name })),
    registerProvider: () => () => {},
  } as unknown as SkillRegistry)
  registered = []
  ctx.provide('tools', { register: (definition: ToolDefinition) => { registered.push(definition) } } as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(home, { recursive: true, force: true })
})

/** The registered `kb_propose_actions` definition — the nomination front door. */
function proposeTool(): ToolDefinition {
  const found = registered.find(entry => entry.name === 'kb_propose_actions')
  expect(found).toBeDefined()
  return found as ToolDefinition
}

/** One durable wire event, shape-loose — the folds read defensively anyway. */
function wireEvent(seq: number, type: string, data: unknown): SessionWireEvent {
  return { type, seq, time: 0, data } as unknown as SessionWireEvent
}

/** One scripted model turn; `nominate` plays the host executing the tool call. */
interface ScriptedTurn {
  readonly reply: string
  readonly nominate?: () => Promise<unknown>
}

/**
 * One staged run: a REAL controller underneath, a REAL client scheduler on
 * top, and a scripted session transport in between. Each turn may `nominate`
 * — the host executing the model's `kb_propose_actions` call against the real
 * KB — before the assistant message lands in the durable log.
 */
function stage(turns: readonly ScriptedTurn[]): { client: Context; prompts: string[] } {
  const prompts: string[] = []
  const allEvents: SessionWireEvent[] = []
  let turnCount = 0
  let seq = 1
  let awaitingReply = false
  const session = {
    create: async () => ({ ok: true as const, value: { sessionId: 'sess_e2e' } }),
    rename: async () => ({ ok: true as const, value: {} }),
    prompt: async (request: { content: readonly { text?: string }[] }) => {
      prompts.push(request.content.map(part => part.text ?? '').join(''))
      awaitingReply = true
      return { ok: true as const, value: {} }
    },
    follow: async function* () {
      yield { type: 'snapshot', cursor: seq, records: allEvents.map(event => ({ event })), hasMore: false }
      if (!awaitingReply) return
      awaitingReply = false
      const turn = turnCount++
      const scripted = turns[turn]
      if (scripted === undefined) return
      const events: SessionWireEvent[] = []
      if (scripted.nominate !== undefined) {
        // 真实线缆形状（a5000eab 实录）：tool/call 顶层带 callId，成对的
        // tool/result 把 callId 嵌套在 message.toolCallId——调度器的提名
        // 判定靠这对关联事件区分「工具已成功入队」与「散文兜底」。
        const callId = `call_e2e_${seq}`
        let failure: string | undefined
        try {
          await scripted.nominate()
        } catch (error) {
          failure = (error as Error).message
        }
        events.push(wireEvent(seq, 'tool/call', { callId, name: 'kb_propose_actions', arguments: '{}' }))
        seq += 1
        events.push(wireEvent(seq, 'tool/result', {
          message: {
            toolCallId: callId,
            content: [{ type: 'text', text: failure === undefined ? '已入队提议队列' : `Error: ${failure}` }],
          },
        }))
        seq += 1
      }
      events.push(
        wireEvent(seq, 'assistant/message', {
          message: { content: [{ type: 'text', text: scripted.reply }] },
          usage: { inputTokens: 100, outputTokens: 10 },
        }),
        wireEvent(seq + 1, 'turn/end', { reason: { kind: 'completed' } }),
      )
      seq += 2
      allEvents.push(...events)
      yield* events.map(event => ({ type: 'event', event }))
    },
    cancel: async () => ({ ok: true as const, value: {} }),
  }
  const controller = ctx.yantaoKbController
  // The client face talks RemoteResult; the VALUES come from the real
  // controller RPCs — the same seam the typert transport carries in prod.
  const client = {
    remote: {
      session,
      yantaoKb: {
        capabilityInstructions: async (args: { name: string }) =>
          ({ ok: true as const, value: await controller.capabilityInstructions(args) }),
        proposalInboxList: async () =>
          ({ ok: true as const, value: await controller.proposalInboxList() }),
        proposalInboxEnqueue: async (args: Parameters<typeof controller.proposalInboxEnqueue>[0]) =>
          ({ ok: true as const, value: await controller.proposalInboxEnqueue(args) }),
      },
    },
  } as unknown as Context
  return { client, prompts }
}

describe('端到端：调度 → 邮件能力 → 提名工具 → 提议卡（ADR-0047/0055）', () => {
  it('工具提名全链路：指令内联 → 真工具入队 → 事件检测 → 收件箱回查 → 卡可渲染，且不双入队', async () => {
    const { client, prompts } = stage([{
      // 模型的回答拖着一段信封散文——若散文路径误跑会双入队，这条就是探针。
      reply: `解析完成，共 1 封待删。建议信封：\n${JSON.stringify({
        title: '重复的信封',
        actions: [{ kind: 'delete-mails', entryId: 'm-1', sender: 's@example.com', subject: 'x' }],
      })}`,
      nominate: () => proposeTool().execute({
        title: '晨检邮件提议',
        actions: [{ kind: 'delete-mails', entryId: 'm-1', sender: 'boss@example.com', subject: '周五请早走' }],
        mails: { lastReadAt: '2026-10-10T08:00:00+08:00', firstReadAt: '2026-10-09T09:00:00+08:00' },
        source: 'schedule:sch_e2e',
        sourceName: '晨检',
      }, {} as never),
    }])

    const result = await runScheduledTask({ ctx: client, id: 'sch_e2e', name: '晨检', prompt: '向后解析邮件', capability: 'mail' })

    // ① 首跳直通：fire 的 prompt 里是【真】能力指令——中央路由解析 + SKILL.md
    //    正文 + 环境说明，任务提示词殿后。
    const fired = prompts[0]
    expect(fired).toContain('能力「mail」的指令正文如下，请照其行事：')
    expect(fired).toContain('SLIM 页宽 40')
    expect(fired).toContain('无需再经 kb_run_capability 读取')
    expect(fired.indexOf('SLIM 页宽 40')).toBeLessThan(fired.indexOf('向后解析邮件'))

    // ② 约定殿后，教的是工具且带着这次调度的 provenance。
    expect(fired).toContain('kb_propose_actions')
    expect(fired).toContain('source="schedule:sch_e2e"')
    expect(fired).toContain('sourceName="晨检"')
    expect(fired.indexOf('向后解析邮件')).toBeLessThan(fired.indexOf('kb_propose_actions'))

    // ③ 真磁盘：恰好一条 pending，来源与规范化后的水位都在。
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(1)
    const entry = listed.proposals[0]
    expect(entry).toMatchObject({ status: 'pending', source: 'schedule:sch_e2e', sourceName: '晨检', title: '晨检邮件提议' })
    expect(entry.note).toContain('覆盖邮件')
    expect((entry.proposal as { mails?: { lastReadAt?: string } }).mails?.lastReadAt)
      .toBe(new Date('2026-10-10T08:00:00+08:00').toISOString())

    // ④ 调度器经真 RPC 回查到同一行——通知分流拿到的就是这个 id。
    expect(result.proposalId).toBe(entry.id)

    // ⑤ 提议卡的脸：entry.proposal 经客户端 proposalOfPayload 解析成立。
    const card = proposalOfPayload(entry.proposal)
    expect(card).not.toBeNull()
    expect(card?.actions[0]).toMatchObject({ kind: 'delete-mails', entryId: 'm-1' })

    // ⑥ 反双入队：答案里拖着信封，但工具路径不解析散文——磁盘上仍只有一条。
    expect(result.answer).toContain('建议信封')
    expect(result.stats?.steps).toBe(1)
  })

  it('服务端拒绝坏提名：整单零痕迹，run 照常完成、纯通知', async () => {
    let rejection = ''
    const { client, prompts } = stage([{
      reply: '汇报：邮件已清点，无可提议动作。',
      nominate: async () => {
        try {
          await proposeTool().execute({
            title: '坏提议',
            actions: [{ kind: 'delete-mails', mailIds: ['a', 'b'] }],
            source: 'schedule:sch_e2e',
          }, {} as never)
        } catch (error) {
          rejection = (error as Error).message
          throw error
        }
      },
    }])

    const result = await runScheduledTask({ ctx: client, id: 'sch_e2e', name: '晨检', prompt: '做晨检', capability: 'mail' })

    // 工具失败把诊断带回给模型（当轮修复的原料），磁盘零痕迹。
    expect(rejection).toContain('缺必填字段 entryId、sender、subject')
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(0)
    // 事件里有 tool/call → 走工具路径 → 收件箱查无 pending → 纯通知，run 不点。
    expect(prompts).toHaveLength(1)
    expect(result.proposalId).toBeUndefined()
    expect(result.answer).toContain('邮件已清点')
  })

  it('散文回退仍通：答案信封经真 proposalInboxEnqueue 入队', async () => {
    const { client, prompts } = stage([{
      reply: `清理完毕。\n${JSON.stringify({
        title: '晨检提议',
        actions: [{ kind: 'append-log', entityPath: '项目/邮件.md', entityName: '邮件', text: '已清点', reason: '晨检' }],
        mails: { lastReadAt: '2026-10-10T08:00:00+08:00' },
      })}`,
    }])

    const result = await runScheduledTask({ ctx: client, id: 'sch_e2e', name: '晨检', prompt: '向后解析邮件' })

    // 无能力绑定时没有内联段，但约定仍在殿后。
    expect(prompts[0]).not.toContain('SLIM 页宽 40')
    expect(prompts[0]).toContain('kb_propose_actions')
    // 散文信封 → 客户端解析 → 真 RPC → 真磁盘，来源是调度。
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(1)
    const entry = listed.proposals[0]
    expect(entry).toMatchObject({ status: 'pending', source: 'schedule:sch_e2e' })
    expect((entry.proposal as { mails?: { lastReadAt?: string } }).mails?.lastReadAt)
      .toBe(new Date('2026-10-10T08:00:00+08:00').toISOString())
    expect(result.proposalId).toBe(entry.id)
    expect(proposalOfPayload(entry.proposal)).not.toBeNull()
  })

  it('locator 提名全链路：entityPath 用 project:名字 入队 → resolveEntity 归一 → 流水落盘（2026-10-13 周报流水事故）', async () => {
    // 种子项目实体：agent 提名的 locator 在真实 KB 里所指的文件。
    const entityRel = 'entities/projects/周报项目.md'
    await mkdir(join(home, 'entities', 'projects'), { recursive: true })
    await writeFile(join(home, entityRel), '# 周报项目\n\n## 状态\n\n进行中\n\n## 流水\n\n- 2026-01-01 创建\n', 'utf8')

    const { client } = stage([{
      reply: '周报已归档。',
      nominate: () => proposeTool().execute({
        title: '周报归档提议',
        actions: [{ kind: 'append-log', entityPath: 'project:周报项目', entityName: '周报项目', text: '批次归档', reason: '调度周报' }],
        source: 'schedule:sch_e2e',
        sourceName: '周报',
      }, {} as never),
    }])

    const result = await runScheduledTask({ ctx: client, id: 'sch_e2e', name: '周报', prompt: '归档周报', capability: 'mail' })

    // A2：locator 形态被服务端放行（形状校验不拒），真磁盘恰好一条 pending。
    expect(result.proposalId).toBeDefined()
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(1)
    const card = proposalOfPayload(listed.proposals[0].proposal)
    expect(card).not.toBeNull()
    expect(card?.actions[0]).toMatchObject({ kind: 'append-log', entityPath: 'project:周报项目' })

    // 人类批准后的回写：ProposalTarget 的读写与归一缝全部接真 controller RPC。
    const controller = ctx.yantaoKbController
    const target = {
      read: async (path: string) => (await controller.read(path)).content,
      write: async (path: string, content: string) => { await controller.write(path, content) },
      resolveEntity: async (locator: string) => (await controller.resolveEntity(locator)).path,
    } as unknown as ProposalTarget
    const applied = await applyProposal({
      proposal: card!,
      ticked: card!.actions.map((_, index) => index),
      target,
    })
    expect(applied.written).toEqual(['项目动态 周报项目'])
    expect(applied.skipped).toEqual([])

    // 磁盘实体文件的流水出现了带日期的一行——事故里丢的就是这一行。
    const onDisk = await readFile(join(home, entityRel), 'utf8')
    expect(onDisk).toContain('- 2026-01-01 创建')
    expect(onDisk).toMatch(/- \d{4}-\d{2}-\d{2} 批次归档/)
  })
})
