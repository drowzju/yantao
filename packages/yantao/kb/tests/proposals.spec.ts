import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendMemoryEntry, memoryEntryId } from '../src/memory.ts'
import {
  appendMemoryProposal, listProposalScopes, parseProposalFile, PROPOSAL_PENDING_SOFT_CAP,
  proposalDisplayPath, proposalEntryLine, readProposalScope, removeMemoryProposalByText,
  serializeProposalFile,
} from '../src/proposals.ts'
import { KbError } from '../src/types.ts'

let kbRoot: string

beforeEach(async () => {
  kbRoot = await mkdtemp(join(tmpdir(), 'yantao-kb-proposals-'))
})

afterEach(async () => {
  await rm(kbRoot, { recursive: true, force: true })
})

const GLOBAL_QUEUE_PATH = '.dsh/yantao/memory/proposals/global.md'

describe('proposal file format', () => {
  it('parses bullets into proposals, splitting the trailing 〔source〕 off the text', () => {
    const parsed = parseProposalFile('global', '# 记忆提案 · 全局\n\n- 2026-10-01 代理兜底前先探测端口 〔会话〕\n- 快照 diff 为空也算成功 〔UI 运行摘要〕\n- 无注记的一条\n')
    expect(parsed.preamble).toBe('# 记忆提案 · 全局')
    expect(parsed.entries).toHaveLength(3)
    expect(parsed.entries[0]).toMatchObject({ date: '2026-10-01', text: '代理兜底前先探测端口', source: '会话' })
    expect(parsed.entries[1]?.source).toBe('UI 运行摘要')
    expect(parsed.entries[2]?.source).toBe('')
  })

  it('ids ignore the source annotation and match the promoted memory id', () => {
    const queued = parseProposalFile('mail', '- 2026-10-01 先探测端口 〔会话〕')
    expect(queued.entries[0]?.id).toBe(memoryEntryId('mail', '先探测端口'))
  })

  it('round trips a well-formed file byte-for-byte', () => {
    const text = '# 记忆提案 · mail\n\n- 2026-10-01 甲 〔会话〕\n- 乙\n'
    expect(serializeProposalFile(parseProposalFile('mail', text))).toBe(text)
  })

  it('skips annotation-only bullets and blank bullets', () => {
    expect(parseProposalFile('global', '- 〔会话〕\n-  \n').entries).toHaveLength(0)
  })

  it('renders the line shape with an optional stamp and annotation', () => {
    expect(proposalEntryLine({ date: '2026-10-01', text: '甲', source: '会话' })).toBe('- 2026-10-01 甲 〔会话〕')
    expect(proposalEntryLine({ text: '甲', source: '' })).toBe('- 甲')
  })
})

describe('proposalDisplayPath', () => {
  it('queues every scope flat under proposals/', () => {
    expect(proposalDisplayPath('global')).toBe(GLOBAL_QUEUE_PATH)
    expect(proposalDisplayPath('mail')).toBe('.dsh/yantao/memory/proposals/mail.md')
  })
})

describe('appendMemoryProposal', () => {
  it('creates the queue file with its heading on first write', async () => {
    const scope = await appendMemoryProposal(kbRoot, 'global', '代理兜底前先探测端口', '会话')
    expect(scope.path).toBe(GLOBAL_QUEUE_PATH)
    expect(scope.entries).toHaveLength(1)
    expect(scope.entries[0]).toMatchObject({ text: '代理兜底前先探测端口', source: '会话' })
    expect(scope.entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(scope.text).toContain('# 记忆提案 · 全局')
  })

  it('preserves the human preamble and appends flat per scope', async () => {
    const dir = join(kbRoot, '.dsh', 'yantao', 'memory', 'proposals')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'mail.md'), '# 我的提案箱\n\n- 2026-01-01 旧的 〔会话〕\n', 'utf8')
    const scope = await appendMemoryProposal(kbRoot, 'mail', '新的')
    expect(scope.text).toContain('# 我的提案箱')
    expect(scope.entries.map(entry => entry.text)).toEqual(['旧的', '新的'])
    expect(scope.entries[1]?.source).toBe('')
  })

  it('refuses a text that is already remembered in the scope', async () => {
    await appendMemoryEntry(kbRoot, 'mail', '先探测端口')
    const error = await appendMemoryProposal(kbRoot, 'mail', '先探测端口').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KbError)
    expect((error as KbError).code).toBe('duplicate-memory')
    expect((await readProposalScope(kbRoot, 'mail')).entries).toHaveLength(0)
  })

  it('refuses a duplicate pending proposal', async () => {
    await appendMemoryProposal(kbRoot, 'mail', '先探测端口')
    const error = await appendMemoryProposal(kbRoot, 'mail', '  先探测端口  ', 'UI 运行摘要').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KbError)
    expect((error as KbError).code).toBe('duplicate-proposal')
    expect((await readProposalScope(kbRoot, 'mail')).entries).toHaveLength(1)
  })

  it('refuses an empty text and an unsafe scope', async () => {
    await expect(appendMemoryProposal(kbRoot, 'global', '   ')).rejects.toThrow(KbError)
    await expect(appendMemoryProposal(kbRoot, '../escape', '甲')).rejects.toThrow(KbError)
  })

  it('refuses an embedded newline in the text or the source — one line per proposal', async () => {
    const textError = await appendMemoryProposal(kbRoot, 'mail', '看似无害\n- 2026-10-01 伪造的第二条 〔会话〕').catch((caught: unknown) => caught)
    expect(textError).toBeInstanceOf(KbError)
    expect((textError as KbError).code).toBe('multiline-proposal-text')
    const sourceError = await appendMemoryProposal(kbRoot, 'mail', '正常的一条', '会话\n伪造注记').catch((caught: unknown) => caught)
    expect(sourceError).toBeInstanceOf(KbError)
    expect((sourceError as KbError).code).toBe('multiline-proposal-source')
    // Neither refusal may have left a physical line behind.
    expect((await readProposalScope(kbRoot, 'mail')).text).not.toContain('伪造')
  })

  it('refuses a text ending with a 〔…〕 group — indistinguishable from a source annotation', async () => {
    const error = await appendMemoryProposal(kbRoot, 'mail', '提交前先跑一遍测试 〔会话〕').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KbError)
    expect((error as KbError).code).toBe('ambiguous-proposal-tail')
    // The refusal leaves no physical line behind.
    expect((await readProposalScope(kbRoot, 'mail')).text).not.toContain('提交前先跑一遍测试')
  })

  it('refuses the 21st pending proposal in a scope with proposal-queue-full', async () => {
    for (let at = 0; at < PROPOSAL_PENDING_SOFT_CAP; at += 1) {
      await appendMemoryProposal(kbRoot, 'mail', `提案${at}`)
    }
    const error = await appendMemoryProposal(kbRoot, 'mail', '提案20').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KbError)
    expect((error as KbError).code).toBe('proposal-queue-full')
    // The cap is per scope: another scope still accepts.
    await expect(appendMemoryProposal(kbRoot, 'global', '提案0')).resolves.toBeDefined()
  })
})

describe('removeMemoryProposalByText', () => {
  it('removes by text and keeps the rest — both verdicts drop the line', async () => {
    await appendMemoryProposal(kbRoot, 'global', '甲')
    await appendMemoryProposal(kbRoot, 'global', '乙', '会话')
    const scope = await removeMemoryProposalByText(kbRoot, 'global', '甲')
    expect(scope.entries.map(entry => entry.text)).toEqual(['乙'])
  })

  it('reports a stale text as proposal-not-found', async () => {
    await appendMemoryProposal(kbRoot, 'global', '甲')
    const error = await removeMemoryProposalByText(kbRoot, 'global', '不存在').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(KbError)
    expect((error as KbError).code).toBe('proposal-not-found')
  })
})

describe('listProposalScopes', () => {
  it('answers an empty list when nothing is pending', async () => {
    expect(await listProposalScopes(kbRoot)).toEqual([])
  })

  it('lists global first, then capability scopes name-sorted', async () => {
    await appendMemoryProposal(kbRoot, 'mail', '甲')
    await appendMemoryProposal(kbRoot, 'global', '乙')
    await appendMemoryProposal(kbRoot, 'agenda', '丙')
    const scopes = await listProposalScopes(kbRoot)
    expect(scopes.map(scope => scope.scope)).toEqual(['global', 'agenda', 'mail'])
  })

  it('ignores non-markdown and unsafely named files', async () => {
    const dir = join(kbRoot, '.dsh', 'yantao', 'memory', 'proposals')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'notes.txt'), '- x\n', 'utf8')
    await writeFile(join(dir, '..esc.md'), '- x\n', 'utf8')
    await expect(listProposalScopes(kbRoot)).resolves.toEqual([])
  })

  it('stops listing a scope whose queue has been drained, file kept on disk', async () => {
    await appendMemoryProposal(kbRoot, 'mail', '甲')
    await removeMemoryProposalByText(kbRoot, 'mail', '甲')
    expect(await listProposalScopes(kbRoot)).toEqual([])
    // The file survives with its preamble — only the listing shrinks.
    expect(await readProposalScope(kbRoot, 'mail')).toMatchObject({ entries: [] })
  })
})

describe('promotion interplay (ADR-0044 决定 7)', () => {
  it('the queued id and the promoted memory id coincide, so dedup closes the loop', async () => {
    const queued = await appendMemoryProposal(kbRoot, 'mail', '先探测端口', '会话')
    expect(queued.entries[0]?.id).toBe(memoryEntryId('mail', '先探测端口'))
    await appendMemoryEntry(kbRoot, 'mail', '先探测端口')
    // Promoting again through the queue is refused as already-remembered.
    await expect(appendMemoryProposal(kbRoot, 'mail', '先探测端口')).rejects.toThrow(KbError)
  })
})
