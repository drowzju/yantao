import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
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
function payload(): Record<string, unknown> {
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
})
