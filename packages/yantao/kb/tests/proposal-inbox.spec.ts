import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  annotateProposalInboxEntry, APPLY_LEDGER_DISPLAY_PATH, enqueueProposal, INBOX_PENDING_SOFT_CAP,
  newProposalInboxId, normalizeInboxEntries, PROPOSAL_INBOX_DISPLAY_PATH, readProposalInbox,
  resolveProposalInboxEntry, writeProposalInbox, type QueuedProposal,
} from '../src/proposal-inbox.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-inbox-'))
  await mkdir(join(kbRoot, '.dsh', 'yantao'), { recursive: true })
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

/** 最小的合法提议体：本层只认 title + 非空 actions。 */
function payload(actions: readonly unknown[] = [{ kind: 'append-log', entityPath: '人物/张三.md', text: '见了客户' }]): unknown {
  return { title: '晨检发现', actions }
}

/** 一条已入库的完整记录；覆盖项落在上面。 */
function entry(overrides: Partial<QueuedProposal> = {}): QueuedProposal {
  return {
    id: 'prp_abc123def',
    createdAt: '2026-10-05T08:00:00.000Z',
    source: 'schedule:sch_abc123def',
    sourceName: '晨检',
    title: '晨检发现',
    proposal: payload(),
    status: 'pending',
    ...overrides,
  }
}

describe('normalizeInboxEntries', () => {
  it('修剪空白并保留可选备注', () => {
    const [row] = normalizeInboxEntries([entry({ title: '  晨检发现  ', note: ' 会话可回看 ' })])
    expect(row?.title).toBe('晨检发现')
    expect(row?.note).toBe('会话可回看')
  })

  it('空备注归一为缺席', () => {
    expect(normalizeInboxEntries([entry({ note: '   ' })])[0]?.note).toBeUndefined()
  })

  it('拒绝缺 id、重复 id、坏时间、缺来源、空标题', () => {
    expect(() => normalizeInboxEntries([entry({ id: '' })])).toThrow(KbError)
    expect(() => normalizeInboxEntries([entry(), entry()])).toThrow(/重复/)
    expect(() => normalizeInboxEntries([entry({ createdAt: '不是日期' })])).toThrow(/入队时间/)
    expect(() => normalizeInboxEntries([entry({ source: '' })])).toThrow(/来源/)
    expect(() => normalizeInboxEntries([entry({ sourceName: ' ' })])).toThrow(/来源/)
    expect(() => normalizeInboxEntries([entry({ title: '' })])).toThrow(/标题/)
  })

  it('拒绝缺 actions、空 actions、坏状态的提议体', () => {
    expect(() => normalizeInboxEntries([entry({ proposal: { title: 'x' } })])).toThrow(/actions/)
    expect(() => normalizeInboxEntries([entry({ proposal: { title: 'x', actions: [] } })])).toThrow(/actions/)
    expect(() => normalizeInboxEntries([entry({ proposal: null })])).toThrow(KbError)
    expect(() => normalizeInboxEntries([entry({ status: ' reopened ' as unknown as QueuedProposal['status'] })])).toThrow(/状态/)
  })

  it('status 与 decidedAt 必须配对', () => {
    expect(() => normalizeInboxEntries([entry({ status: 'approved' })])).toThrow(/决策时间/)
    expect(() => normalizeInboxEntries([entry({ decidedAt: '2026-10-05T09:00:00.000Z' })])).toThrow(/不应带有决策时间/)
    const [ok] = normalizeInboxEntries([entry({ status: 'discarded', decidedAt: '2026-10-05T09:00:00.000Z' })])
    expect(ok?.decidedAt).toBe('2026-10-05T09:00:00.000Z')
  })

  it('接受三分结算状态并校验逐项结果的形状（ADR-0059 决定 5）', () => {
    const trail = [{ index: 0, ok: false, error: '实体定位不可达' }]
    const [ok] = normalizeInboxEntries([entry({
      status: 'approved-with-errors', decidedAt: '2026-10-05T09:00:00.000Z', applyResults: trail,
    })])
    expect(ok?.applyResults).toEqual(trail)
    // 序号负数、ok 非布尔、错误说明缺席都是响亮的形状错误——逐项结果是
    // 已结算卡片的权威展示数据，坏了不能静默丢。
    expect(() => normalizeInboxEntries([entry({
      status: 'failed', decidedAt: '2026-10-05T09:00:00.000Z',
      applyResults: [{ index: -1, ok: true, error: '' }],
    })])).toThrow(/逐项结果/)
    expect(() => normalizeInboxEntries([entry({
      status: 'failed', decidedAt: '2026-10-05T09:00:00.000Z',
      applyResults: [{ index: 0, ok: 'yes' as unknown as boolean, error: '' }],
    })])).toThrow(/逐项结果/)
    expect(() => normalizeInboxEntries([entry({
      status: 'failed', decidedAt: '2026-10-05T09:00:00.000Z',
      applyResults: [{ index: 0, ok: true }],
    })])).toThrow(/逐项结果/)
  })

  it('总量软帽之上拒绝', () => {
    const many = Array.from({ length: INBOX_PENDING_SOFT_CAP * 4 + 1 }, (_, at) => entry({ id: `prp_${at}` }))
    expect(() => normalizeInboxEntries(many)).toThrow(/最多保留/)
  })
})

describe('readProposalInbox / writeProposalInbox', () => {
  it('缺文件读作空收件箱', async () => {
    await expect(readProposalInbox(kbRoot)).resolves.toEqual([])
  })

  it('写后读回同一列表', async () => {
    const rows = [entry(), entry({ id: 'prp_b22222222', title: '周报整理', status: 'discarded', decidedAt: '2026-10-05T09:00:00.000Z' })]
    await writeProposalInbox(kbRoot, rows)
    await expect(readProposalInbox(kbRoot)).resolves.toEqual(rows)
  })

  it('坏 JSON 是响亮的错误', async () => {
    await writeFile(join(kbRoot, PROPOSAL_INBOX_DISPLAY_PATH), '{ 不是 json', 'utf8')
    await expect(readProposalInbox(kbRoot)).rejects.toThrow(KbError)
  })

  it('写前校验：坏列表不碰文件', async () => {
    await writeProposalInbox(kbRoot, [entry()])
    await expect(writeProposalInbox(kbRoot, [entry({ proposal: { title: 'x', actions: [] } })])).rejects.toThrow(KbError)
    await expect(readProposalInbox(kbRoot)).resolves.toEqual([entry()])
  })

  it('新 KB 没有 .dsh/yantao 目录时也能写（先建目录）', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'yantao-kb-inbox-fresh-'))
    try {
      await writeProposalInbox(fresh, [entry()])
      await expect(readProposalInbox(fresh)).resolves.toEqual([entry()])
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})

describe('enqueueProposal', () => {
  it('分配 id、打 createdAt、置 pending，追加在队尾', async () => {
    const now = new Date('2026-10-05T08:00:00.000Z')
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() }, now)
    const second = await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '第二条', note: '备注', proposal: payload() }, now)
    expect(second).toHaveLength(2)
    expect(second[0]).toMatchObject({ source: 'schedule:sch_a', status: 'pending', createdAt: now.toISOString() })
    expect(second[0]?.id).toMatch(/^prp_/)
    expect(second[1]?.note).toBe('备注')
    // 持久化验证
    await expect(readProposalInbox(kbRoot)).resolves.toEqual(second)
  })

  it('未决策积压到软帽后拒绝', async () => {
    const now = new Date('2026-10-05T08:00:00.000Z')
    for (let at = 0; at < INBOX_PENDING_SOFT_CAP; at += 1) {
      await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: `第 ${at} 条`, proposal: payload() }, now)
    }
    await expect(enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '溢出', proposal: payload() }, now))
      .rejects.toThrow(/未决策的提议已达/)
  })

  it('已决策的不占软帽', async () => {
    const now = new Date('2026-10-05T08:00:00.000Z')
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '旧的', proposal: payload() }, now)
    // 把首条标为已决策，再连续入队恰好软帽条不拒
    const rows = await readProposalInbox(kbRoot)
    await writeProposalInbox(kbRoot, rows.map(row => ({ ...row, status: 'discarded' as const, decidedAt: now.toISOString() })))
    for (let at = 0; at < INBOX_PENDING_SOFT_CAP; at += 1) {
      await expect(enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: `第 ${at} 条`, proposal: payload() }, now)).resolves.toBeDefined()
    }
  })

  it('超总量帽：裁最老已决策行，未决行原样保留，新条目压尾', async () => {
    const now = new Date('2026-10-05T08:00:00.000Z')
    const decidedAt = '2026-10-05T07:00:00.000Z'
    // 种子恰好总量帽：未决两条夹着 198 条已丢弃；再入队 1 条触发裁剪。
    // 这是会静默删持久数据的路径——回归时最先烂掉的应该是这里。
    const seeded: QueuedProposal[] = [
      entry({ id: 'prp_pending_first' }),
      ...Array.from({ length: INBOX_PENDING_SOFT_CAP * 4 - 2 }, (_, at) =>
        entry({ id: `prp_dec_${String(at).padStart(3, '0')}`, status: 'discarded' as const, decidedAt })),
      entry({ id: 'prp_pending_last' }),
    ]
    await writeProposalInbox(kbRoot, seeded)
    const stored = await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '压哨', proposal: payload() }, now)
    expect(stored).toHaveLength(INBOX_PENDING_SOFT_CAP * 4)
    // 未决行一条不少、位置不动——裁剪永不碰它们（第三条 pending 是刚入队的压哨自身）
    expect(stored.filter(row => row.status === 'pending').map(row => row.id))
      .toEqual(['prp_pending_first', 'prp_pending_last', expect.stringMatching(/^prp_/)])
    // 最老的已决策行先走：dec_000 没了，dec_001 还在
    expect(stored.some(row => row.id === 'prp_dec_000')).toBe(false)
    expect(stored.some(row => row.id === 'prp_dec_001')).toBe(true)
    // 新条目仍在队尾（控制器靠 proposals.at(-1) 映射刚入队的 id）
    expect(stored.at(-1)?.title).toBe('压哨')
    await expect(readProposalInbox(kbRoot)).resolves.toEqual(stored)
  })
})

describe('resolveProposalInboxEntry', () => {
  it('置状态与决策时间，其余不动', async () => {
    const now = new Date('2026-10-05T09:00:00.000Z')
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() }, now)
    const [first] = await readProposalInbox(kbRoot)
    const resolved = await resolveProposalInboxEntry(kbRoot, first!.id, 'approved', now)
    expect(resolved[0]).toMatchObject({ status: 'approved', decidedAt: now.toISOString(), title: '晨检发现' })
    // 持久化验证
    await expect(readProposalInbox(kbRoot)).resolves.toEqual(resolved)
  })

  it('未知 id 拒绝；已决策的再决策拒绝', async () => {
    const now = new Date('2026-10-05T09:00:00.000Z')
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() }, now)
    await expect(resolveProposalInboxEntry(kbRoot, 'prp_ghost', 'discarded', now)).rejects.toThrow(/不存在/)
    const [first] = await readProposalInbox(kbRoot)
    await resolveProposalInboxEntry(kbRoot, first!.id, 'discarded', now)
    await expect(resolveProposalInboxEntry(kbRoot, first!.id, 'approved', now)).rejects.toThrow(/已经决策/)
  })

  it('部分失败结算把逐项结果存进行并持久化（ADR-0059 决定 5）', async () => {
    const now = new Date('2026-10-05T09:00:00.000Z')
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() }, now)
    const [first] = await readProposalInbox(kbRoot)
    const trail = [{ index: 0, ok: true, error: '' }, { index: 1, ok: false, error: '实体定位不可达' }]
    const resolved = await resolveProposalInboxEntry(kbRoot, first!.id, 'approved-with-errors', now, trail)
    expect(resolved[0]).toMatchObject({ status: 'approved-with-errors', applyResults: trail })
    await expect(readProposalInbox(kbRoot)).resolves.toEqual(resolved)
  })

  it('每次结算追加 apply-ledger 一行；环形截断保最新弃最老（ADR-0059 决定 5）', async () => {
    const now = new Date('2026-10-05T09:00:00.000Z')
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() }, now)
    const [first] = await readProposalInbox(kbRoot)
    // 预填 501 行假账，再结算一次：应只剩 500 行且最老的丢了、新行在尾。
    const stale = Array.from({ length: 501 }, (_, at) => JSON.stringify({ at, seq: at }))
    await writeFile(join(kbRoot, APPLY_LEDGER_DISPLAY_PATH), `${stale.join('\n')}\n`, 'utf8')
    await resolveProposalInboxEntry(kbRoot, first!.id, 'failed', now, [{ index: 0, ok: false, error: 'boom' }])
    const raw = await readFile(join(kbRoot, APPLY_LEDGER_DISPLAY_PATH), 'utf8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(500)
    // 501 行旧账 + 1 行新账裁成 500：最老的两行（seq 0/1）出局，seq 2 带头。
    expect(lines[0]).toBe(JSON.stringify({ at: 2, seq: 2 }))
    const fresh = JSON.parse(lines.at(-1)!) as { id: string; status: string; title: string; applyResults: unknown }
    expect(fresh).toMatchObject({ id: first!.id, status: 'failed', title: '晨检发现' })
    expect(fresh.applyResults).toEqual([{ index: 0, ok: false, error: 'boom' }])
  })
})

describe('newProposalInboxId', () => {
  it('嵌入创建时间且互不重复', () => {
    const now = new Date('2026-10-05T08:00:00.000Z')
    const first = newProposalInboxId(now)
    const second = newProposalInboxId(now)
    expect(first.startsWith(`prp_${now.getTime().toString(36)}`)).toBe(true)
    expect(first).not.toBe(second)
  })
})

describe('annotateProposalInboxEntry（ADR-0059 决定 2：校验警告附卡）', () => {
  const WARN = { sender: '读取闭合', subject: 'resources/a.md', why: '本轮读过该资源，但没有动作引用它' }

  function highlightsOf(row: QueuedProposal | undefined): unknown {
    return (row?.proposal as { highlights?: unknown }).highlights
  }

  it('pending 条目合并 highlights 并持久化', async () => {
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() })
    const [first] = await readProposalInbox(kbRoot)
    const rows = await annotateProposalInboxEntry(kbRoot, first!.id, [WARN])
    expect(highlightsOf(rows[0])).toEqual([WARN])
    // 其余字段不动
    expect(rows[0]).toMatchObject({ id: first!.id, status: 'pending', title: '晨检发现' })
    await expect(readProposalInbox(kbRoot)).resolves.toEqual(rows)
  })

  it('已有 highlights 保留，新警告追加在后', async () => {
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() })
    const [first] = await readProposalInbox(kbRoot)
    const firstWarn = { sender: '溯源校验', subject: 'resources/ghost.md', why: '从未读取' }
    await annotateProposalInboxEntry(kbRoot, first!.id, [firstWarn])
    const rows = await annotateProposalInboxEntry(kbRoot, first!.id, [WARN])
    expect(highlightsOf(rows[0])).toEqual([firstWarn, WARN])
  })

  it('未知 id 与已决策条目都拒绝', async () => {
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() })
    await expect(annotateProposalInboxEntry(kbRoot, 'prp_ghost', [WARN])).rejects.toThrow(/不存在/)
    const [first] = await readProposalInbox(kbRoot)
    await resolveProposalInboxEntry(kbRoot, first!.id, 'discarded')
    await expect(annotateProposalInboxEntry(kbRoot, first!.id, [WARN])).rejects.toThrow(/已经决策/)
  })

  it('畸形警告响亮拒绝：缺字段、空串、why 超长', async () => {
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() })
    const [first] = await readProposalInbox(kbRoot)
    await expect(annotateProposalInboxEntry(kbRoot, first!.id, [{ subject: 'x', why: 'y' } as never])).rejects.toThrow(/格式不对/)
    await expect(annotateProposalInboxEntry(kbRoot, first!.id, [{ sender: '', subject: 'x', why: 'y' }])).rejects.toThrow(/格式不对/)
    await expect(annotateProposalInboxEntry(kbRoot, first!.id, [{
      sender: 's', subject: 'x', why: '长'.repeat(301),
    }])).rejects.toThrow(/上限 300 字/)
    // 拒绝后文件未被污染
    const [after] = await readProposalInbox(kbRoot)
    expect(highlightsOf(after)).toBeUndefined()
  })

  it('合并后超出 20 条：截断保最新弃最老', async () => {
    await enqueueProposal(kbRoot, { source: 'schedule:sch_a', sourceName: '晨检', title: '晨检发现', proposal: payload() })
    const [first] = await readProposalInbox(kbRoot)
    // 种子 18 条旧高亮，再附 3 条 → 21 裁成 20，最老的 0 号出局。
    const stale = Array.from({ length: 18 }, (_, at) => ({ sender: '旧', subject: `s${at}`, why: 'w' }))
    await writeProposalInbox(kbRoot, [entry({
      id: first!.id,
      proposal: { title: '晨检发现', actions: [{ kind: 'append-log', entityPath: '人物/张三.md', text: '见了客户' }], highlights: stale },
    })])
    const fresh = Array.from({ length: 3 }, (_, at) => ({ sender: '新', subject: `n${at}`, why: 'w' }))
    const rows = await annotateProposalInboxEntry(kbRoot, first!.id, fresh)
    const merged = highlightsOf(rows[0]) as { subject: string }[]
    expect(merged).toHaveLength(20)
    expect(merged[0]?.subject).toBe('s1')
    expect(merged.at(-1)?.subject).toBe('n2')
  })
})
