import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  enqueueProposal, INBOX_PENDING_SOFT_CAP, newProposalInboxId, normalizeInboxEntries,
  PROPOSAL_INBOX_DISPLAY_PATH, readProposalInbox, resolveProposalInboxEntry, writeProposalInbox,
  type QueuedProposal,
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
