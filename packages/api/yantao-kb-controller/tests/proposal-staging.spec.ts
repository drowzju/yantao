import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { YantaoKbService } from '@deepseek-ai/dsh-yantao-kb'
import YantaoKbController from '../src/index.ts'
import { appendStagedActions, clearStagedActions, readStagedActions, stagingPathOf } from '../src/capability/proposal-staging.ts'
import { groupDiagnostics } from '../src/capability/proposal-actions.ts'
import { flushStagedProposal } from '../src/capability/staging-flush.ts'

describe('proposal staging（2026-10-20 分批落盘）', () => {
  let kbRoot: string

  beforeEach(async () => {
    kbRoot = await mkdtemp(join(tmpdir(), 'yantao-staging-'))
  })

  afterEach(async () => {
    await rm(kbRoot, { recursive: true, force: true })
  })

  it('append 是合并写：重复的邮件行按 entryId 覆盖，其余行累加', async () => {
    const path = stagingPathOf(kbRoot, 'session-a')
    const first = { kind: 'delete-mails', entryId: 'E1', sender: 'a@x', subject: '旧主题' }
    const second = { kind: 'delete-mails', entryId: 'E2', sender: 'b@x', subject: 'B' }
    expect(await appendStagedActions(path, [first, second])).toBe(2)
    const repaired = { ...first, subject: '新主题' }
    expect(await appendStagedActions(path, [repaired])).toBe(2)
    const rows = await readStagedActions(path) as Array<{ subject: string }>
    expect(rows.map(row => row.subject)).toEqual(['新主题', 'B'])
  })

  it('读不到或坏文件 fail-open 为空；clear 幂等', async () => {
    const path = stagingPathOf(kbRoot, 'session-b')
    expect(await readStagedActions(path)).toEqual([])
    expect(await readStagedActions(undefined)).toEqual([])
    await clearStagedActions(path)
    await clearStagedActions(undefined)
  })

  it('运行键里的非法字符被清洗，不同会话不共用一个暂存', async () => {
    const a = stagingPathOf(kbRoot, 'session/a b')
    const b = stagingPathOf(kbRoot, 'session-a-b')
    expect(a).toBe(b)
    expect(stagingPathOf(kbRoot, 'session-c')).not.toBe(a)
  })
})

describe('groupDiagnostics（同因合并）', () => {
  it('同因的逐项诊断合并成一行，行号压成区间', () => {
    const lines = [
      '第 4 项「delete-mails」的 entryId 是 40 位指纹',
      '第 5 项「delete-mails」的 entryId 是 40 位指纹',
      '第 6 项「delete-mails」的 entryId 是 40 位指纹',
      '第 14 项「delete-mails」的 entryId 是 40 位指纹',
      '第 15 项「delete-mails」的 entryId 是 40 位指纹',
    ]
    expect(groupDiagnostics(lines)).toEqual(['第 4–6、14–15 项「delete-mails」的 entryId 是 40 位指纹'])
  })

  it('不同因各自成行，单条保持原文，无前缀的整单诊断原样透传', () => {
    const lines = [
      '第 1 项「append-log」缺必填字段 entityPath',
      '第 2 项「append-log」缺必填字段 entityPath',
      '第 3 项「create-entity」缺必填字段 entityType',
      'actions 不能为空——没有值得提议的就不要调用本工具',
    ]
    expect(groupDiagnostics(lines)).toEqual([
      'actions 不能为空——没有值得提议的就不要调用本工具',
      '第 1–2 项「append-log」缺必填字段 entityPath',
      '第 3 项「create-entity」缺必填字段 entityType',
    ])
  })
})

describe('kb_propose_actions 的草稿面与提交面', () => {
  let kbRoot: string
  let ctx: Context
  let fiber: { dispose(): Promise<void> }
  let registered: ToolDefinition[]

  beforeEach(async () => {
    kbRoot = await mkdtemp(join(tmpdir(), 'yantao-draft-tool-'))
    ctx = new Context()
    ctx.provide('yantaoKb', {
      get root(): string { return kbRoot },
      get configured(): boolean { return true },
      setRoot(): void {},
    } satisfies YantaoKbService)
    ctx.provide('skills', { get: async () => undefined } as never)
    registered = []
    ctx.provide('tools', { register: (definition: ToolDefinition) => { registered.push(definition) } } as never)
    ctx.provide('sessionController', { follow: () => (async function* () {})(), page: async () => ({ records: [], hasMore: false }) } as never)
    fiber = await ctx.plugin(YantaoKbController)
  })

  afterEach(async () => {
    await fiber.dispose()
    await rm(kbRoot, { recursive: true, force: true })
  })

  const tool = (): ToolDefinition => registered.find(entry => entry.name === 'kb_propose_actions') as ToolDefinition
  const run = { agent: { id: 'session-draft' } } as never

  it('draft:true 只暂存不建卡，回执带 staged/total', async () => {
    const result = await tool().execute({
      title: '第一批',
      draft: true,
      actions: [{ kind: 'delete-mails', entryId: 'E1', sender: 'a@x', subject: 'A' }],
    }, run) as { staged: number; total: number }
    expect(result).toMatchObject({ staged: 1, total: 1 })
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(0)
    const staged = await readStagedActions(stagingPathOf(kbRoot, 'session-draft')) as unknown[]
    expect(staged).toHaveLength(1)
  })

  it('收尾提交把暂存与本次 actions 并成一张卡，暂存随后清空', async () => {
    await tool().execute({
      title: '第一批',
      draft: true,
      actions: [{ kind: 'delete-mails', entryId: 'E1', sender: 'a@x', subject: 'A' }],
    }, run)
    const result = await tool().execute({
      title: '汇总',
      actions: [{ kind: 'create-entity', entityType: 'project', name: '新项目' }],
    }, run) as { id: string; merged: number }
    expect(result.id).toMatch(/^prp_/)
    expect(result.merged).toBe(1)
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(1)
    const proposal = listed.proposals[0]?.proposal as { actions: Array<{ kind: string }> }
    expect(proposal.actions.map(action => action.kind)).toEqual(['delete-mails', 'create-entity'])
    expect(existsSync(stagingPathOf(kbRoot, 'session-draft'))).toBe(false)
  })

  it('暂存有货时 actions 可以为空；整单不合格时暂存保留', async () => {
    await tool().execute({
      title: '第一批',
      draft: true,
      actions: [{ kind: 'delete-mails', entryId: 'E1', sender: 'a@x', subject: 'A' }],
    }, run)
    const result = await tool().execute({ title: '汇总', actions: [] }, run) as { id: string }
    expect(result.id).toMatch(/^prp_/)
    await expect(tool().execute({
      title: '坏批',
      draft: true,
      actions: [{ kind: 'delete-mails', entryId: 'a'.repeat(40), sender: 'a@x', subject: 'A' }],
    }, run)).rejects.toThrow(/40 位指纹/)
  })

  it('人通道（无运行作用域）的 draft 被拒，普通提交不受影响', async () => {
    await expect(tool().execute({
      title: 'x',
      draft: true,
      actions: [{ kind: 'create-entity', entityType: 'project', name: 'P' }],
    }, {} as never)).rejects.toThrow(/只在会话运行里可用/)
    const result = await tool().execute({
      title: 'x',
      actions: [{ kind: 'create-entity', entityType: 'project', name: 'P' }],
    }, {} as never) as { id: string }
    expect(result.id).toMatch(/^prp_/)
  })
  it('回合停止兜底：暂存仍有货时自动合成一张卡并清空暂存', async () => {
    await tool().execute({
      title: '第一批',
      draft: true,
      actions: [{ kind: 'delete-mails', entryId: 'E9', sender: 'a@x', subject: 'A' }],
    }, run)
    const flushed = await flushStagedProposal(kbRoot, 'session-draft')
    expect(flushed).toMatchObject({ count: 1 })
    expect(flushed.id).toMatch(/^prp_/)
    const listed = await ctx.yantaoKbController.proposalInboxList()
    expect(listed.proposals).toHaveLength(1)
    expect(listed.proposals[0]?.source).toBe('agent:staging-flush')
    const proposal = listed.proposals[0]?.proposal as { actions: unknown[] }
    expect(proposal.actions).toHaveLength(1)
    expect(existsSync(stagingPathOf(kbRoot, 'session-draft'))).toBe(false)
    // 幂等：暂存已清空，再跑一次什么都不做。
    expect(await flushStagedProposal(kbRoot, 'session-draft')).toEqual({ count: 0 })
  })
})
