import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import { envelopeRejectionOf, proposalOfAnswer, proposalOfPayload } from '../src/client/capability-match.ts'
import {
  formatRunStats, runScheduledTask, scheduleBaseline, scheduleCreatedAt, scheduleScan, statsFromEvents,
  toolNominationSucceeded, withInlineInstructions, withProposalConvention,
} from '../src/client/scheduler.ts'

/** One enabled daily-9am row; overrides land on top. */
function row(overrides: Partial<Parameters<typeof scheduleScan>[0]> = {}) {
  return {
    id: 'sch_abc123def',
    cron: '0 9 * * *',
    enabled: true,
    ...overrides,
  }
}

const MINUTE = 60_000

describe('scheduleCreatedAt', () => {
  it('解出 id 里的 base36 毫秒', () => {
    const ms = Date.parse('2026-10-03T08:00:00.000Z')
    expect(scheduleCreatedAt(`sch_${ms.toString(36)}_deadbeef`)?.getTime()).toBe(ms)
  })

  it('外来 id 形状返回 null', () => {
    expect(scheduleCreatedAt('别的 id')).toBeNull()
  })
})

describe('scheduleBaseline', () => {
  it('取 lastFiredAt 与 lastMissedAt 的较晚者', () => {
    const baseline = scheduleBaseline(row({
      lastFiredAt: '2026-10-01T09:00:00.000Z',
      lastMissedAt: '2026-10-02T09:00:00.000Z',
    }))
    expect(baseline.getTime()).toBe(Date.parse('2026-10-02T09:00:00.000Z'))
  })

  it('无时间戳时退回创建时间', () => {
    const ms = Date.parse('2026-10-01T00:00:00.000Z')
    expect(scheduleBaseline(row({ id: `sch_${ms.toString(36)}_xx` })).getTime()).toBe(ms)
  })
})

describe('scheduleScan', () => {
  it('新鲜的到点 → fire', () => {
    // 每天 09:00，基线昨天 09:00，现在 09:00:30 → 30 秒前那次该跑
    const local = new Date(2026, 9, 3, 9, 0, 30)
    const action = scheduleScan(row({ lastFiredAt: new Date(2026, 9, 2, 9, 0).toISOString() }), local, MINUTE)
    expect(action).toEqual({ kind: 'fire', at: new Date(2026, 9, 3, 9, 0) })
  })

  it('超过容忍的到点 → missed（不补跑）', () => {
    const local = new Date(2026, 9, 3, 12, 0)
    const action = scheduleScan(row({ lastFiredAt: new Date(2026, 9, 2, 9, 0).toISOString() }), local, MINUTE)
    expect(action).toEqual({ kind: 'missed', at: new Date(2026, 9, 3, 9, 0) })
  })

  it('错过已记账 → 不再重复提醒', () => {
    const local = new Date(2026, 9, 3, 12, 0)
    const action = scheduleScan(row({
      lastMissedAt: new Date(2026, 9, 3, 9, 0).toISOString(),
    }), local, MINUTE)
    expect(action).toEqual({ kind: 'wait' })
  })

  it('下次触发在未来 → wait', () => {
    const local = new Date(2026, 9, 3, 8, 0)
    const action = scheduleScan(row({ lastFiredAt: new Date(2026, 9, 2, 9, 0).toISOString() }), local, MINUTE)
    expect(action).toEqual({ kind: 'wait' })
  })

  it('停用 → wait', () => {
    const local = new Date(2026, 9, 3, 9, 0, 30)
    const action = scheduleScan(row({ enabled: false, lastFiredAt: new Date(2026, 9, 2, 9, 0).toISOString() }), local, MINUTE)
    expect(action).toEqual({ kind: 'wait' })
  })

  it('坏 cron → wait（不炸扫描）', () => {
    const local = new Date(2026, 9, 3, 9, 0, 30)
    expect(scheduleScan(row({ cron: '不是 cron' }), local, MINUTE)).toEqual({ kind: 'wait' })
  })

  it('新建未触发：基线是创建时间，创建前的到点不算错过', () => {
    // 创建于 09:30，规则是每天 09:00 —— 创建当天的到点已过，但发生在创建之前
    const created = new Date(2026, 9, 3, 9, 30)
    const local = new Date(2026, 9, 3, 9, 31)
    const action = scheduleScan(row({ id: `sch_${created.getTime().toString(36)}_xx` }), local, MINUTE)
    expect(action).toEqual({ kind: 'wait' })
  })

  it('容忍边界：恰好等于容忍值仍算 fire', () => {
    const local = new Date(2026, 9, 3, 9, 1, 0) // 60 秒整
    const action = scheduleScan(row({ lastFiredAt: new Date(2026, 9, 2, 9, 0).toISOString() }), local, MINUTE)
    expect(action.kind).toBe('fire')
  })
})

describe('withProposalConvention（ADR-0047/0055 修订：约定教工具提名）', () => {
  it('原样保留提示词并在末尾拼上工具约定', () => {
    const composed = withProposalConvention('/mail 向后解析邮件')
    expect(composed.startsWith('/mail 向后解析邮件')).toBe(true)
    expect(composed).toContain('【调度约定（ADR-0047/0055）】')
    expect(composed).toContain('kb_propose_actions')
    expect(composed).toContain('- actions：')
  })

  it('约定教的是应用器认识的 kind，且允许无提议沉默', () => {
    const composed = withProposalConvention('任意任务')
    expect(composed).toContain('"kind":"append-log"')
    expect(composed).toContain('"kind":"save-resource"')
    expect(composed).toContain('不要自行执行')
    expect(composed).toContain('完全不调用本工具')
    expect(composed).not.toContain('delete-mails')
    expect(composed).not.toContain('archive-mails')
  })

  it('带 provenance 时教会透传 source/sourceName', () => {
    const composed = withProposalConvention('任意任务', { source: 'schedule:sch_x', sourceName: '晨检' })
    expect(composed).toContain('source="schedule:sch_x"')
    expect(composed).toContain('sourceName="晨检"')
    expect(withProposalConvention('任意任务')).not.toContain('source=')
  })
})

describe('proposalOfAnswer（ADR-0047 调度答案解析）', () => {
  const ACTION = { kind: 'append-log', entityPath: '项目/dsh 学习.md', entityName: 'dsh 学习', text: '有进展', reason: '晨检' }

  it('裸 JSON 信封直接解析', () => {
    const proposal = proposalOfAnswer(JSON.stringify({ title: '忽略', actions: [ACTION] }), '调度「晨检」的提议')
    expect(proposal).not.toBeNull()
    expect(proposal?.title).toBe('调度「晨检」的提议')
    expect(proposal?.actions).toEqual([ACTION])
  })

  it('围栏 JSON 与散文尾随 JSON 都能取出', () => {
    const fenced = `检查完成。\n\n\`\`\`json\n${JSON.stringify({ actions: [ACTION] }, null, 2)}\n\`\`\`\n`
    expect(proposalOfAnswer(fenced, 't')?.actions).toEqual([ACTION])
    const trailing = `检查完成，建议如下：\n${JSON.stringify({ actions: [ACTION] })}`
    expect(proposalOfAnswer(trailing, 't')?.actions).toEqual([ACTION])
  })

  it('未知 kind 的行被静默剔除，剔光则不算提议', () => {
    const alien = JSON.stringify({ actions: [{ kind: 'format-disk', reason: 'x' }] })
    expect(proposalOfAnswer(alien, 't')).toBeNull()
    const mixed = JSON.stringify({ actions: [{ kind: 'format-disk' }, ACTION] })
    expect(proposalOfAnswer(mixed, 't')?.actions).toEqual([ACTION])
  })

  it('空 actions、非对象、纯散文都返回 null', () => {
    expect(proposalOfAnswer(JSON.stringify({ actions: [] }), 't')).toBeNull()
    expect(proposalOfAnswer('[1,2,3]', 't')).toBeNull()
    expect(proposalOfAnswer('今天的检查一切正常，无需写入。', 't')).toBeNull()
    expect(proposalOfAnswer('', 't')).toBeNull()
  })

  it('信封的 mails 范围随提议透传（验收修正 2），时间戳规范化为 ISO', () => {
    const envelope = JSON.stringify({
      title: '忽略', actions: [ACTION],
      mails: { lastReadAt: '2026-10-01T06:23:54Z', firstReadAt: '2026-09-17T06:23:54Z' },
    })
    const proposal = proposalOfAnswer(envelope, 't')
    // 解析后统一落成规范 Z 戳——宽松形状（'Oct 5, 2026'）不许进水位
    expect(proposal?.mails).toEqual({ lastReadAt: '2026-10-01T06:23:54.000Z', firstReadAt: '2026-09-17T06:23:54.000Z' })
  })

  it('mails 缺失或畸形时不携带范围，但不影响提议本身', () => {
    const noMails = proposalOfAnswer(JSON.stringify({ title: 'x', actions: [ACTION] }), 't')
    expect(noMails?.mails).toBeUndefined()
    const badMails = proposalOfAnswer(JSON.stringify({ title: 'x', actions: [ACTION], mails: { lastReadAt: '' } }), 't')
    expect(badMails?.mails).toBeUndefined()
    expect(badMails?.actions).toEqual([ACTION])
  })
})

describe('proposalOfPayload（ADR-0047 收件箱载荷回读）', () => {
  const ACTION = { kind: 'append-log', entityPath: '项目/dsh 学习.md', entityName: 'dsh 学习', text: '有进展', reason: '晨检' }

  it('合法载荷原样读回，标题取载荷自带', () => {
    const proposal = proposalOfPayload({ title: '晨检提议', actions: [ACTION] })
    expect(proposal).toEqual({ title: '晨检提议', actions: [ACTION] })
  })

  it('缺标题、空 actions、未知 kind 剔光、非对象都返回 null', () => {
    expect(proposalOfPayload({ actions: [ACTION] })).toBeNull()
    expect(proposalOfPayload({ title: 'x', actions: [] })).toBeNull()
    expect(proposalOfPayload({ title: 'x', actions: [{ kind: 'format-disk' }] })).toBeNull()
    expect(proposalOfPayload('不是对象')).toBeNull()
    expect(proposalOfPayload(null)).toBeNull()
  })

  it('混合已知与未知 kind 时保留已知行', () => {
    const proposal = proposalOfPayload({ title: 'x', actions: [{ kind: 'format-disk' }, ACTION] })
    expect(proposal?.actions).toEqual([ACTION])
  })

  it('回读透传 mails 范围，畸形范围剔除（验收修正 2）', () => {
    const range = { lastReadAt: '2026-10-01T06:23:54.000Z', firstReadAt: '2026-09-17T06:23:54.000Z' }
    expect(proposalOfPayload({ title: 'x', actions: [ACTION], mails: range })?.mails).toEqual(range)
    expect(proposalOfPayload({ title: 'x', actions: [ACTION], mails: '乱写' })?.mails).toBeUndefined()
    expect(proposalOfPayload({ title: 'x', actions: [ACTION], mails: { firstReadAt: '2026-09-17' } })?.mails).toBeUndefined()
    // 松散但可解析的形状：照常收下，规范化成 Z 戳（不再原文透传）
    expect(proposalOfPayload({ title: 'x', actions: [ACTION], mails: { lastReadAt: '2026/10/01 06:23' } })?.mails)
      .toEqual({ lastReadAt: new Date('2026/10/01 06:23').toISOString() })
  })
})

/** 2026-10-10 早晨事故的批量形态信封：动作合体、字段缺失，校验器全拒。 */
const BATCH_ENVELOPE = JSON.stringify({
  title: '清理邮件',
  actions: [
    { kind: 'delete-mails', mailIds: ['a', 'b'] },
    { kind: 'archive-mails', dir: 'resources/mails', targets: ['c'] },
  ],
})

const VALID_ACTION = { kind: 'delete-mails', entryId: 'a', sender: 's@example.com', subject: '周报' }

describe('envelopeRejectionOf（2026-10-10 反静默丢单探针）', () => {
  it('批量形态信封报出每个动作缺的必填字段', () => {
    const rejection = envelopeRejectionOf(`清理完毕。\n${BATCH_ENVELOPE}`)
    expect(rejection).toContain('信封动作全部未通过校验')
    expect(rejection).toContain('「delete-mails」缺必填字段 entryId、sender、subject')
    expect(rejection).toContain('「archive-mails」缺必填字段 entryId、sender、subject')
  })

  it('未知 kind 报不是已知的动作类别', () => {
    expect(envelopeRejectionOf(JSON.stringify({ actions: [{ kind: 'format-disk' }] }))).toContain('不是已知的动作类别')
  })

  it('有效信封、空 actions、纯散文都是诚实沉默（undefined）', () => {
    expect(envelopeRejectionOf(JSON.stringify({ actions: [VALID_ACTION] }))).toBeUndefined()
    expect(envelopeRejectionOf(JSON.stringify({ actions: [] }))).toBeUndefined()
    expect(envelopeRejectionOf('今天没有值得提议的动作。')).toBeUndefined()
    expect(envelopeRejectionOf('')).toBeUndefined()
  })
})

/** One durable wire event, shape-loose — the folds read defensively anyway. */
function wireEvent(seq: number, type: string, data: unknown): SessionWireEvent {
  return { type, seq, time: 0, data } as unknown as SessionWireEvent
}

describe('statsFromEvents / formatRunStats（2026-10-10 调度性能统计）', () => {
  it('折叠加总重试等待、工具数、截断数与 token', () => {
    const events: SessionWireEvent[] = [
      wireEvent(1, 'turn/start', { turn: 1 }),
      wireEvent(2, 'llm/retry', { turn: 1, step: 1, retry: 1, delayMs: 30_000 }),
      wireEvent(3, 'llm/retry', { turn: 1, step: 1, retry: 2, delayMs: 90_000 }),
      wireEvent(4, 'tool/call', { name: 'kb_exec_capability_script', arguments: '{"verb":"read"}' }),
      wireEvent(5, 'tool/result', { message: { content: [{ type: 'text', text: '…（输出超过 64KB，已截断）' }] } }),
      wireEvent(6, 'assistant/message', {
        message: { content: [{ type: 'text', text: '完' }] },
        usage: { inputTokens: 1_500_000, outputTokens: 9_800 },
      }),
      wireEvent(7, 'turn/end', { reason: { kind: 'completed' } }),
    ]
    const stats = statsFromEvents(events, 8.5 * 60_000)
    expect(stats.retries).toBe(2)
    expect(stats.retryDelayMs).toBe(120_000)
    expect(stats.toolCalls).toBe(1)
    expect(stats.truncations).toBe(1)
    expect(stats.steps).toBe(1)
    expect(stats.inputTokens).toBe(1_500_000)
    const line = formatRunStats(stats)
    expect(line).toContain('用时 8.5 分钟')
    expect(line).toContain('1 步')
    expect(line).toContain('网关重试 2 次（累计等待 2 分钟）')
    expect(line).toContain('工具 1 次')
    expect(line).toContain('输出截断 1 次')
    expect(line).toContain('tokens 进 1.5M/出 9.8k')
  })

  it('干净运行的账不出现重试与截断段', () => {
    const line = formatRunStats(statsFromEvents([], 5 * 60_000))
    expect(line).toContain('用时 5 分钟')
    expect(line).toContain('0 步')
    expect(line).not.toContain('重试')
    expect(line).not.toContain('截断')
    expect(line).not.toContain('tokens')
  })
})

/** One session Remote + yantaoKb pair over scripted replies, structurally cast into the Context. */
function harness(
  replies: readonly string[],
  kb: Record<string, unknown> = {},
  opts: { readonly toolCall?: string; readonly toolCallTurn?: number; readonly toolFailed?: boolean } = {},
): { ctx: Context; prompts: string[] } {
  const prompts: string[] = []
  const allEvents: SessionWireEvent[] = []
  let turnCount = 0
  let seq = 1
  // ADR-0055 起 collectEvents 在回合中途也会跟进（工具提名探测），follow 必须
  // 区分两种来访者：askTurn 先 prompt 再 follow，消费一条脚本回复；事件收集
  // 裸 follow，只取快照——不然会把下一条回复偷走，修复回合就拿不到回答。
  let awaitingReply = false
  const session = {
    create: async () => ({ ok: true as const, value: { sessionId: 'sess1' } }),
    rename: async () => ({ ok: true as const, value: {} }),
    prompt: async (request: { content: readonly { text?: string }[] }) => {
      prompts.push(request.content.map(part => part.text ?? '').join(''))
      awaitingReply = true
      return { ok: true as const, value: {} }
    },
    follow: async function* () {
      // collectEvents 只为快照而来：先给全量快照（askTurn 会跳过它）。
      yield { type: 'snapshot', cursor: seq, records: allEvents.map(event => ({ event })), hasMore: false }
      if (!awaitingReply) return
      awaitingReply = false
      const turn = turnCount++
      const reply = replies[turn]
      if (reply === undefined) return
      const events: SessionWireEvent[] = []
      // ADR-0055: a woven tool call simulates the model nominating through
      // kb_propose_actions. The paired result decides success (2026-10-10
      // ocr 评审 #4: a failed result is NOT a nomination).
      if (turn === (opts.toolCallTurn ?? 0) && opts.toolCall !== undefined) {
        events.push(wireEvent(seq++, 'tool/call', { callId: 'call1', name: opts.toolCall, arguments: '{}' }))
        events.push(opts.toolFailed
          ? wireEvent(seq++, 'tool/result', { callId: 'call1', error: { name: '校验', code: 'bad-action' } })
          : wireEvent(seq++, 'tool/result', { callId: 'call1', message: { content: [{ type: 'text', text: '已入队 1 条提议' }] } }))
      }
      events.push(wireEvent(seq++, 'assistant/message', {
        message: { content: [{ type: 'text', text: reply }] },
        usage: { inputTokens: 100, outputTokens: 10 },
      }))
      events.push(wireEvent(seq++, 'turn/end', { reason: { kind: 'completed' } }))
      allEvents.push(...events)
      yield* events.map(event => ({ type: 'event', event }))
    },
    cancel: async () => ({ ok: true as const, value: {} }),
  }
  const ctx = {
    remote: {
      session,
      yantaoKb: {
        proposalInboxEnqueue: async () => ({ ok: true as const, value: { id: 'prop1', entries: [] } }),
        ...kb,
      },
    },
  } as unknown as Context
  return { ctx, prompts }
}

describe('runScheduledTask（校验留痕 + 一次追问兜底 + 统计）', () => {
  it('信封全拒时追问一轮，修复后的信封照常入队', async () => {
    const { ctx, prompts } = harness([
      `清理完毕。\n${BATCH_ENVELOPE}`,
      `已修正。\n${JSON.stringify({ actions: [VALID_ACTION] })}`,
    ])
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: '邮件自动解析', prompt: '做晨检' })
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('未通过校验')
    expect(prompts[1]).toContain('delete-mails')
    expect(result.proposalId).toBe('prop1')
    expect(result.answer).toContain('已修正')
    expect(result.stats).toBeDefined()
  })

  it('第一轮就是有效信封：不追问，统计在场', async () => {
    const { ctx, prompts } = harness([JSON.stringify({ actions: [VALID_ACTION] })])
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: 'p' })
    expect(prompts).toHaveLength(1)
    expect(result.proposalId).toBe('prop1')
    expect(result.stats?.steps).toBe(1)
    expect(result.stats?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('纯散文回答：诚实沉默，不追问', async () => {
    const { ctx, prompts } = harness(['今日无事，无需写入。'])
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: 'p' })
    expect(prompts).toHaveLength(1)
    expect(result.proposalId).toBeUndefined()
    expect(result.stats?.steps).toBe(1)
  })

  it('追问后仍是坏信封：放弃追问，结果不带提议但答案留存', async () => {
    const { ctx, prompts } = harness([BATCH_ENVELOPE, BATCH_ENVELOPE])
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: 'p' })
    expect(prompts).toHaveLength(2)
    expect(result.proposalId).toBeUndefined()
    expect(result.answer).toContain('delete-mails')
  })
})

describe('withInlineInstructions（调度首跳直通）', () => {
  it('指令正文在前，任务提示词在后，中间带免读声明', () => {
    const composed = withInlineInstructions('做晨检', 'mail', '能力「mail」的指令正文如下：……')
    expect(composed.startsWith('能力「mail」的指令正文如下：')).toBe(true)
    expect(composed).toContain('无需再经 kb_run_capability 读取')
    expect(composed.indexOf('---')).toBeGreaterThan(0)
    expect(composed.endsWith('做晨检')).toBe(true)
    expect(composed.indexOf('无需再经')).toBeLessThan(composed.lastIndexOf('做晨检'))
  })
})

describe('runScheduledTask 首跳直通（capability 绑定）', () => {
  it('绑定能力时指令内联进 prompt，信封约定仍殿后', async () => {
    const { ctx, prompts } = harness(
      [JSON.stringify({ actions: [VALID_ACTION] })],
      { capabilityInstructions: async ({ name }: { name: string }) => ({
        ok: true as const,
        value: { name, instructions: `能力「${name}」的指令正文如下，请照其行事：\n\nSLIM 页宽 40。` },
      }) },
    )
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: '晨检', prompt: '做晨检', capability: 'mail' })
    expect(prompts).toHaveLength(1)
    const fired = prompts[0]
    expect(fired).toContain('SLIM 页宽 40')
    expect(fired).toContain('无需再经 kb_run_capability 读取')
    expect(fired).toContain('做晨检')
    expect(fired).toContain('【调度约定（ADR-0047/0055）】')
    // 顺序：指令正文 → 任务提示词 → 信封约定殿后
    expect(fired.indexOf('SLIM 页宽 40')).toBeLessThan(fired.indexOf('做晨检'))
    expect(fired.indexOf('做晨检')).toBeLessThan(fired.indexOf('【调度约定（ADR-0047/0055）】'))
    expect(result.proposalId).toBe('prop1')
  })

  it('取指令失败时回退原提示词，运行不中断', async () => {
    const { ctx, prompts } = harness(
      ['今日无事。'],
      { capabilityInstructions: async () => { throw new Error('路由坏了') } },
    )
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: '做晨检', capability: 'mail' })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('做晨检')
    expect(prompts[0]).not.toContain('无需再经 kb_run_capability 读取')
    expect(result.proposalId).toBeUndefined()
  })

  it('不绑定时完全走旧路径（不发 capabilityInstructions 调用）', async () => {
    let called = 0
    const { ctx, prompts } = harness(
      ['今日无事。'],
      { capabilityInstructions: async () => { called += 1; throw new Error('不该被调用') } },
    )
    await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: '做晨检' })
    expect(called).toBe(0)
    expect(prompts[0]).toContain('做晨检')
  })
})

describe('runScheduledTask 工具提名路径（ADR-0055：kb_propose_actions 优先）', () => {
  it('事件里有 kb_propose_actions 调用：跳过散文解析，proposalId 从收件箱查得', async () => {
    const { ctx, prompts } = harness(
      ['已提交提议，详见提议页。'],
      {
        proposalInboxList: async () => ({
          ok: true as const,
          value: {
            proposals: [
              { id: 'prp_old', source: 'schedule:other', sourceName: '别的', title: '旧', status: 'pending', createdAt: '2026-10-01T00:00:00Z', proposal: { title: 'x', actions: [] } },
              { id: 'prp_tool', source: 'schedule:sch_x', sourceName: 'x', title: '新', status: 'pending', createdAt: new Date().toISOString(), proposal: { title: 'x', actions: [] } },
            ],
            path: '.dsh/yantao/proposal-inbox.json',
          },
        }),
      },
      { toolCall: 'kb_propose_actions' },
    )
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: '做晨检' })
    expect(prompts).toHaveLength(1)
    expect(result.proposalId).toBe('prp_tool')
    expect(result.stats?.steps).toBe(1)
  })

  it('工具提名但收件箱查询失败：降级纯通知，运行不炸', async () => {
    const { ctx, prompts } = harness(
      ['已通过工具提交提议。'],
      { proposalInboxList: async () => { throw new Error('磁盘坏了') } },
      { toolCall: 'kb_propose_actions' },
    )
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: '做晨检' })
    expect(prompts).toHaveLength(1)
    expect(result.proposalId).toBeUndefined()
    expect(result.answer).toContain('提议')
  })

  it('约定行携带调度的 provenance', async () => {
    const { ctx, prompts } = harness(['今日无事。'])
    await runScheduledTask({ ctx, id: 'sch_x', name: '晨检', prompt: '做晨检' })
    expect(prompts[0]).toContain('source="schedule:sch_x"')
    expect(prompts[0]).toContain('sourceName="晨检"')
  })

  it('工具调用失败（result 带 error）：不算提名，散文信封照常兜底入队（ocr 评审 #4）', async () => {
    const { ctx, prompts } = harness(
      [`工具坏了，改用信封。\n${JSON.stringify({ actions: [VALID_ACTION] })}`],
      {},
      { toolCall: 'kb_propose_actions', toolFailed: true },
    )
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: '做晨检' })
    expect(prompts).toHaveLength(1)
    expect(result.proposalId).toBe('prop1')
  })

  it('修复轮改走工具提名：重检后跳过散文解析，不再双重入队（ocr 评审 #2）', async () => {
    let enqueued = 0
    const { ctx, prompts } = harness(
      [BATCH_ENVELOPE, '已改用工具提交提议。'],
      {
        proposalInboxList: async () => ({
          ok: true as const,
          value: {
            proposals: [
              { id: 'prp_tool', source: 'schedule:sch_x', sourceName: 'x', title: '新', status: 'pending', createdAt: new Date().toISOString(), proposal: { title: 'x', actions: [] } },
            ],
            path: '.dsh/yantao/proposal-inbox.json',
          },
        }),
        proposalInboxEnqueue: async () => { enqueued += 1; return { ok: true as const, value: { id: 'prop1', entries: [] } } },
      },
      { toolCall: 'kb_propose_actions', toolCallTurn: 1 },
    )
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: '做晨检' })
    expect(prompts).toHaveLength(2)
    expect(enqueued).toBe(0)
    expect(result.proposalId).toBe('prp_tool')
  })

  it('收件箱查找有时间下界：上次触发的旧 pending 条目不被错认（ocr 评审 #3）', async () => {
    const { ctx } = harness(
      ['已通过工具提交提议。'],
      {
        proposalInboxList: async () => ({
          ok: true as const,
          value: {
            proposals: [
              { id: 'prp_stale', source: 'schedule:sch_x', sourceName: 'x', title: '上一轮的', status: 'pending', createdAt: '2026-10-01T00:00:00Z', proposal: { title: 'x', actions: [] } },
            ],
            path: '.dsh/yantao/proposal-inbox.json',
          },
        }),
      },
      { toolCall: 'kb_propose_actions' },
    )
    const result = await runScheduledTask({ ctx, id: 'sch_x', name: 'x', prompt: '做晨检' })
    expect(result.proposalId).toBeUndefined()
  })
})

describe('toolNominationSucceeded（ocr 评审 #4：提名判定看结果成败）', () => {
  it('成功的 tool/result 算提名', () => {
    const events = [
      wireEvent(1, 'tool/call', { callId: 'c1', name: 'kb_propose_actions' }),
      wireEvent(2, 'tool/result', { callId: 'c1', message: { content: [{ type: 'text', text: '已入队' }] } }),
    ]
    expect(toolNominationSucceeded(events)).toBe(true)
  })

  it('真实线缆形状：callId 嵌在 message.toolCallId 里也能配上（a5000eab 会话实录）', () => {
    const events = [
      wireEvent(1, 'tool/call', { callId: 'chatcmpl-tool-aaa', name: 'kb_propose_actions', arguments: '{}' }),
      wireEvent(2, 'tool/result', {
        turn: 1, step: 8,
        message: { role: 'tool', source: { kind: 'tool', callId: 'chatcmpl-tool-aaa' }, toolCallId: 'chatcmpl-tool-aaa', content: [{ type: 'text', text: '提议已入队（prp_x）' }] },
      }),
    ]
    expect(toolNominationSucceeded(events)).toBe(true)
    // 校验拒绝走文本不走 error 字段（a5000eab 实录：整单未入队，无顶层 error）
    const rejectedByText = [
      wireEvent(1, 'tool/call', { callId: 'chatcmpl-tool-bbb', name: 'kb_propose_actions', arguments: '{}' }),
      wireEvent(2, 'tool/result', {
        turn: 1, step: 9,
        message: { role: 'tool', source: { kind: 'tool', callId: 'chatcmpl-tool-bbb' }, toolCallId: 'chatcmpl-tool-bbb', content: [{ type: 'text', text: 'Error: 提议未通过校验，请修正后重新调用（整单未入队）：第 1 项「append-log」缺必填字段 entityName' }] },
      }),
    ]
    expect(toolNominationSucceeded(rejectedByText)).toBe(false)
    const rejectedByErrorField = [
      wireEvent(1, 'tool/call', { callId: 'chatcmpl-tool-ccc', name: 'kb_propose_actions', arguments: '{}' }),
      wireEvent(2, 'tool/result', {
        turn: 1, step: 9, error: { name: 'Error', code: 'VALIDATION' },
        message: { role: 'tool', source: { kind: 'tool', callId: 'chatcmpl-tool-ccc' }, toolCallId: 'chatcmpl-tool-ccc', content: [{ type: 'text', text: 'Error: 提议未通过校验（整单未入队）' }] },
      }),
    ]
    expect(toolNominationSucceeded(rejectedByErrorField)).toBe(false)
  })

  it('result 带 error、无 result、别的工具调用都不算', () => {
    const failed = [
      wireEvent(1, 'tool/call', { callId: 'c1', name: 'kb_propose_actions' }),
      wireEvent(2, 'tool/result', { callId: 'c1', error: { name: '校验', code: 'bad-action' } }),
    ]
    expect(toolNominationSucceeded(failed)).toBe(false)
    expect(toolNominationSucceeded([wireEvent(1, 'tool/call', { callId: 'c1', name: 'kb_propose_actions' })])).toBe(false)
    expect(toolNominationSucceeded([
      wireEvent(1, 'tool/call', { callId: 'c1', name: 'kb_run_capability' }),
      wireEvent(2, 'tool/result', { callId: 'c1', message: { content: [] } }),
    ])).toBe(false)
  })
})
