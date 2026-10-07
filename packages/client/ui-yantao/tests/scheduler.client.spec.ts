import { describe, expect, it } from 'vitest'
import { proposalOfAnswer, proposalOfPayload } from '../src/client/capability-match.ts'
import { scheduleBaseline, scheduleCreatedAt, scheduleScan, withProposalEnvelope } from '../src/client/scheduler.ts'

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

describe('withProposalEnvelope（ADR-0047 验收修正：约定随 fire 附加）', () => {
  it('原样保留提示词并在末尾拼上信封约定', () => {
    const composed = withProposalEnvelope('/mail 向后解析邮件')
    expect(composed.startsWith('/mail 向后解析邮件')).toBe(true)
    expect(composed).toContain('【调度约定（ADR-0047）】')
    expect(composed).toContain('"actions"')
  })

  it('约定教的是应用器认识的 kind，且允许无提议沉默', () => {
    const composed = withProposalEnvelope('任意任务')
    expect(composed).toContain('"kind":"append-log"')
    expect(composed).toContain('"kind":"save-resource"')
    expect(composed).toContain('不要自行执行')
    expect(composed).toContain('完全不输出信封')
  })

  it('约定带上 mails 范围字段（验收修正 2：裁决联动邮件水位）', () => {
    const composed = withProposalEnvelope('邮件任务')
    expect(composed).toContain('"mails"')
    expect(composed).toContain('lastReadAt')
    expect(composed).toContain('firstReadAt')
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
