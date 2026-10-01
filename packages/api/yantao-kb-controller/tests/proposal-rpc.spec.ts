import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { appendMemoryEntry, type YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import { appendMemoryProposal } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'

let kbRoot: string
let kbConfigured: boolean
let ctx: Context
let fiber: { dispose(): Promise<void> }

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-proposal-rpc-'))
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

const GLOBAL_QUEUE_PATH = '.dsh/yantao/memory/proposals/global.md'

describe('yantaoKb.memoryProposalList', () => {
  it('answers an empty group list before anything is proposed', async () => {
    expect(await ctx.yantaoKbController.memoryProposalList()).toEqual({ groups: [] })
  })

  it('groups the scopes with their exact text and parsed proposals, annotations intact', async () => {
    await appendMemoryProposal(kbRoot, 'global', '先探测端口', '会话')
    await appendMemoryProposal(kbRoot, 'mail', 'key 即密码', 'UI 运行摘要')
    const { groups } = await ctx.yantaoKbController.memoryProposalList()
    expect(groups.map(group => group.scope)).toEqual(['global', 'mail'])
    expect(groups[0]?.path).toBe(GLOBAL_QUEUE_PATH)
    expect(groups[0]?.entries[0]).toMatchObject({ text: '先探测端口', source: '会话' })
    expect(groups[1]?.entries[0]?.source).toBe('UI 运行摘要')
  })

  it('refuses before a KB root is chosen', async () => {
    kbConfigured = false
    const failure = await ctx.yantaoKbController.memoryProposalList().catch((error: unknown) => error)
    const error = remoteErrorOf(failure)
    expect(error).toMatchObject({ code: 'yantao-kb/rejected' })
    expect(error?.message).toContain('还没有选择知识库目录')
  })
})

describe('yantaoKb.memoryProposalApprove', () => {
  it('lands the bare text in the source scope and drains the queue', async () => {
    await appendMemoryProposal(kbRoot, 'mail', '先探测端口', '会话')
    const { path, targetPath, entry } = await ctx.yantaoKbController.memoryProposalApprove({ scope: 'mail', text: '先探测端口' })
    expect(path).toBe('.dsh/yantao/memory/proposals/mail.md')
    expect(targetPath).toBe('.dsh/yantao/memory/capabilities/mail.md')
    expect(entry.text).toBe('先探测端口')
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const { groups } = await ctx.yantaoKbController.memoryProposalList()
    expect(groups).toEqual([])
  })

  it('honors a re-judged target scope', async () => {
    await appendMemoryProposal(kbRoot, 'mail', '全局性的坑', '会话')
    const { targetPath } = await ctx.yantaoKbController.memoryProposalApprove({ scope: 'mail', text: '全局性的坑', targetScope: 'global' })
    expect(targetPath).toBe('.dsh/yantao/memory/global.md')
  })

  it('refuses a text that became remembered meanwhile, keeping the pending copy', async () => {
    await appendMemoryProposal(kbRoot, 'mail', '先探测端口', '会话')
    // The same lesson lands in memory through the human channel while the proposal waits.
    await appendMemoryEntry(kbRoot, 'mail', '先探测端口')
    const failure = await ctx.yantaoKbController.memoryProposalApprove({ scope: 'mail', text: '先探测端口' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/rejected' })
    const { groups } = await ctx.yantaoKbController.memoryProposalList()
    expect(groups[0]?.entries).toHaveLength(1)
  })

  it('reports a stale text as not-found', async () => {
    const failure = await ctx.yantaoKbController.memoryProposalApprove({ scope: 'mail', text: '不存在' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/not-found' })
  })
})

describe('yantaoKb.memoryProposalDiscard', () => {
  it('drops the line and keeps its siblings', async () => {
    await appendMemoryProposal(kbRoot, 'global', '甲')
    await appendMemoryProposal(kbRoot, 'global', '乙', '会话')
    const { path } = await ctx.yantaoKbController.memoryProposalDiscard({ scope: 'global', text: '甲' })
    expect(path).toBe(GLOBAL_QUEUE_PATH)
    const { groups } = await ctx.yantaoKbController.memoryProposalList()
    expect(groups[0]?.entries.map(entry => entry.text)).toEqual(['乙'])
  })

  it('reports a stale text as not-found', async () => {
    await appendMemoryProposal(kbRoot, 'global', '甲')
    const failure = await ctx.yantaoKbController.memoryProposalDiscard({ scope: 'global', text: '不存在' }).catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'yantao-kb/not-found' })
  })
})
