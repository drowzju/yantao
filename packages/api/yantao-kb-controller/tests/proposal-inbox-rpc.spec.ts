import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let ctx: Context
let fiber: { dispose(): Promise<void> }
let configured: boolean

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-inbox-rpc-'))
  configured = true
  ctx = new Context()
  ctx.provide('yantaoKb', {
    get root(): string {
      return kbRoot
    },
    get configured(): boolean {
      return configured
    },
    setRoot(): void {},
  } satisfies YantaoKbService)
  // The controller also injects the skill registry (ADR-0021) and the tool
  // layer (ADR-0023); the inbox never resolves either, so empty stand-ins
  // are enough.
  ctx.provide('skills', { get: async () => undefined } as never)
  ctx.provide('tools', { register: () => {} } as never)
  fiber = await ctx.plugin(YantaoKbController)
})

afterEach(async () => {
  await fiber.dispose()
  await rm(kbRoot, { recursive: true, force: true })
})

/** 最小的合法提议载荷（对 UI 侧不透明）。 */
function payload(): JsonValue {
  return {
    title: '晨检发现',
    actions: [{ kind: 'append-log', entityPath: '项目/dsh 学习.md', entityName: 'dsh 学习', text: '有进展', reason: '晨检' }],
  }
}

describe('yantaoKb.proposalInbox*', () => {
  it('入队 → 列表 → 决策，全链路落盘', async () => {
    const enqueued = await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_abc123def',
      sourceName: '晨检',
      title: '晨检发现',
      note: '会话可在任务页回看',
      proposal: payload(),
    })
    expect(enqueued.id).toMatch(/^prp_/)
    expect(enqueued.path).toBe('.dsh/yantao/proposal-inbox.json')
    expect(enqueued.proposals).toHaveLength(1)
    expect(enqueued.proposals[0]).toMatchObject({ status: 'pending', sourceName: '晨检' })

    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.path).toBe('.dsh/yantao/proposal-inbox.json')
    expect(listed.proposals).toHaveLength(1)

    const resolved = await ctx.yantaoKbController.proposalInboxResolve({ id: enqueued.id, status: 'approved' })
    expect(resolved.proposals[0]).toMatchObject({ status: 'approved' })
    expect(resolved.proposals[0]?.decidedAt).toBeDefined()

    const after = await ctx.yantaoKbController.proposalInboxList()
    expect(after.proposals[0]?.status).toBe('approved')
  })

  it('入队携带完整提议载荷并原样返回', async () => {
    const enqueued = await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_x',
      sourceName: '晨检',
      title: '载荷保真',
      proposal: payload(),
    })
    expect(enqueued.proposals[0]?.proposal).toEqual(payload())
  })

  it('已决策的再决策拒绝', async () => {
    const enqueued = await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_x', sourceName: '晨检', title: '晨检发现', proposal: payload(),
    })
    await ctx.yantaoKbController.proposalInboxResolve({ id: enqueued.id, status: 'discarded' })
    const failure = await ctx.yantaoKbController.proposalInboxResolve({ id: enqueued.id, status: 'approved' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/已经决策/)
  })

  it('未知 id 报 not-found', async () => {
    const failure = await ctx.yantaoKbController.proposalInboxResolve({ id: 'prp_ghost', status: 'discarded' })
      .catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/not-found' })
  })

  it('坏载荷（缺 actions）拒绝且不落盘', async () => {
    const failure = await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_x', sourceName: '晨检', title: '坏的', proposal: { title: 'x', actions: [] },
    }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/actions/)
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(0)
  })

  it('未配置 KB 根时拒绝', async () => {
    configured = false
    const failure = await ctx.yantaoKbController.proposalInboxList().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    expect((failure as Error).message).toMatch(/还没有选择知识库目录/)
  })

  it('入队与决策各广播一次事件，载荷带动作与条目终态（ADR-0060 决定 5）', async () => {
    const events: Array<{ action: string; entry: { id: string; status: string } }> = []
    ctx.on('yantao-kb/proposal-inbox', (update) => { events.push(update) })

    const enqueued = await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_x', sourceName: '晨检', title: '广播', proposal: payload(),
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'enqueue', entry: { id: enqueued.id, status: 'pending' } })

    await ctx.yantaoKbController.proposalInboxResolve({ id: enqueued.id, status: 'discarded' })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ action: 'resolve', entry: { id: enqueued.id, status: 'discarded' } })
  })

  it('坏载荷拒绝时不广播', async () => {
    const events: unknown[] = []
    ctx.on('yantao-kb/proposal-inbox', (update) => { events.push(update) })
    await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_x', sourceName: '晨检', title: '坏的', proposal: { title: 'x', actions: [] },
    }).catch(() => undefined)
    expect(events).toHaveLength(0)
  })
})

describe('yantaoKb.proposalInboxApply / proposalInboxUndo（ADR-0060 决定 7）', () => {
  /** 种子实体：`project:验收项目` 所指的真实文件（e2e 同款直接落盘）。 */
  async function seedEntity(): Promise<string> {
    const rel = join('entities', 'projects', '验收项目.md')
    await mkdir(join(kbRoot, 'entities', 'projects'), { recursive: true })
    await writeFile(join(kbRoot, rel), '# 验收项目\n\n## 状态\n\n进行中\n\n## 流水\n\n- 2026-01-01 创建\n', 'utf8')
    return rel
  }

  async function enqueueState(): Promise<{ id: string }> {
    return ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_apply', sourceName: '晨检', title: '状态建议',
      proposal: {
        title: '状态建议',
        actions: [{ kind: 'write-state', entityPath: 'project:验收项目', entityName: '验收项目', text: '已交付', reason: '验收' }],
      } as JsonValue,
    })
  }

  it('批准即落库：写入与三方结算一个调用完成，undo 一致且一次性', async () => {
    const rel = await seedEntity()
    const enqueued = await enqueueState()

    const outcome = await ctx.yantaoKbController.proposalInboxApply({ id: enqueued.id })
    expect(outcome.kind).toBe('applied')
    if (outcome.kind !== 'applied') return
    expect(outcome.status).toBe('approved')
    expect(outcome.apply.written).toEqual(['状态 验收项目'])
    expect(outcome.apply.perAction).toEqual([{ index: 0, ok: true, error: '' }])
    // 线上痕迹是脱壳版：有可撤写入的存在性，不带闭包步骤。
    expect(outcome.apply.undo).toMatchObject({ irreversible: [] })
    expect(outcome.proposals[0]).toMatchObject({ id: enqueued.id, status: 'approved', decidedAt: expect.anything() })
    expect(await readFile(join(kbRoot, rel), 'utf8')).toContain('已交付')

    // 撤销：状态恢复原值；第二次得到明确的「窗口已关」。
    const undone = await ctx.yantaoKbController.proposalInboxUndo({ id: enqueued.id })
    expect(undone.failed).toEqual([])
    expect(undone.irreversible).toEqual([])
    expect(await readFile(join(kbRoot, rel), 'utf8')).toContain('进行中')
    const again = await ctx.yantaoKbController.proposalInboxUndo({ id: enqueued.id }).catch((error: unknown) => error)
    expect(remoteErrorOf(again)).toMatchObject({ code: 'yantao-kb/not-found' })
    expect((again as Error).message).toMatch(/撤销窗口已关闭/)
  })

  it('重复批准幂等：已决的行回报既有决策，写入不重放', async () => {
    await seedEntity()
    const enqueued = await enqueueState()
    await ctx.yantaoKbController.proposalInboxApply({ id: enqueued.id })
    const repeat = await ctx.yantaoKbController.proposalInboxApply({ id: enqueued.id })
    expect(repeat).toMatchObject({ kind: 'already-decided', status: 'approved' })

    // 丢弃过的行同样幂等；两次都不重放写入（流水恰好一行）。
    const enq2 = await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_apply', sourceName: '晨检', title: '动态一条',
      proposal: {
        title: '动态一条',
        actions: [{ kind: 'append-log', entityPath: 'project:验收项目', entityName: '验收项目', text: '晨检记录', reason: '晨检' }],
      } as JsonValue,
    })
    await ctx.yantaoKbController.proposalInboxResolve({ id: enq2.id, status: 'discarded' })
    const repeat2 = await ctx.yantaoKbController.proposalInboxApply({ id: enq2.id })
    expect(repeat2).toMatchObject({ kind: 'already-decided', status: 'discarded' })
    const onDisk = await readFile(join(kbRoot, 'entities', 'projects', '验收项目.md'), 'utf8')
    expect(onDisk).not.toContain('晨检记录')
  })

  it('全部实体定位不可达：preflight-blocked 变体，一字未落、行保持待决', async () => {
    const enqueued = await ctx.yantaoKbController.proposalInboxEnqueue({
      source: 'schedule:sch_apply', sourceName: '晨检', title: '指向幽灵',
      proposal: {
        title: '指向幽灵',
        actions: [{ kind: 'append-log', entityPath: 'project:幽灵项目', entityName: '幽灵项目', text: '不该出现', reason: '晨检' }],
      } as JsonValue,
    })
    const outcome = await ctx.yantaoKbController.proposalInboxApply({ id: enqueued.id })
    expect(outcome.kind).toBe('preflight-blocked')
    if (outcome.kind !== 'preflight-blocked') return
    expect(outcome.message).toMatch(/重启/)
    expect(outcome.unreachable).toEqual(['项目动态 幽灵项目'])
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals[0]).toMatchObject({ id: enqueued.id, status: 'pending' })
  })

  it('未知 id 与未配置根目录照常报错', async () => {
    const ghost = await ctx.yantaoKbController.proposalInboxApply({ id: 'prp_ghost' }).catch((error: unknown) => error)
    expect(remoteErrorOf(ghost)).toMatchObject({ code: 'yantao-kb/not-found' })
    const ghostUndo = await ctx.yantaoKbController.proposalInboxUndo({ id: 'prp_ghost' }).catch((error: unknown) => error)
    expect(remoteErrorOf(ghostUndo)).toMatchObject({ code: 'yantao-kb/not-found' })

    configured = false
    const blocked = await ctx.yantaoKbController.proposalInboxApply({ id: 'prp_any' }).catch((error: unknown) => error)
    expect(remoteErrorOf(blocked)).toMatchObject({ code: 'yantao-kb/rejected' })
    configured = true
  })
})
