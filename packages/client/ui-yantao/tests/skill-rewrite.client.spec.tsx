// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { lineDiff } from '../src/client/diff.ts'
import { proposalOfPayload } from '../src/client/capability-match.ts'
import type { Proposal } from '../src/client/proposal.ts'
import type { ProposalTarget } from '../src/client/proposal-apply.ts'
import { applyProposal } from '../src/client/proposal-apply.ts'
import { ProposalCard } from '../src/client/ProposalCard.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

/** The KB seams, with spies standing in for every write. */
function target(overrides: Partial<ProposalTarget> = {}): ProposalTarget {
  return {
    createEntity: vi.fn(async () => 'entities/people/张三.md'),
    read: vi.fn(async () => ''),
    write: vi.fn(async () => {}),
    todos: vi.fn(async () => ({ path: 'entities/todos.md', text: '', items: [] })),
    writeTodos: vi.fn(async () => ({ path: 'entities/todos.md', text: '' })),
    memoryAdd: vi.fn(async (scope: string, text: string) => ({ path: `.dsh/yantao/memory/${scope}.md`, entry: { id: 'm1', text } })),
    ...overrides,
  }
}

const ACTION = {
  kind: 'skill-rewrite' as const,
  name: 'mail-reader',
  file: 'notes.md',
  original: '原始笔记\n第二行\n',
  new: '改好的笔记\n第二行\n',
  why: '流程变了',
}

describe('lineDiff', () => {
  it('标出删除、新增与不变行', () => {
    const diff = lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n')
    expect(diff.rows).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ])
    expect(diff.omitted).toBe(0)
  })

  it('超长的中间折成计数省略', () => {
    const left = Array.from({ length: 400 }, (_, at) => `行${at}`).join('\n')
    const diff = lineDiff(left, left.replace('行200', '改'))
    // 总行数 = 399 条不变 + 1 删 + 1 增 = 401；超出帽后保留首尾各 20 行。
    expect(diff.omitted).toBe(401 - 40)
    expect(diff.rows.length).toBe(40)
  })

  it('纯新增与纯删除各自成立（末尾换行是终止符，不是空行）', () => {
    expect(lineDiff('', '新的一行\n').rows).toEqual([{ type: 'add', text: '新的一行' }])
    expect(lineDiff('旧的一行\n', '').rows).toEqual([{ type: 'del', text: '旧的一行' }])
  })
})

describe('proposalOfPayload：skill-rewrite 载荷回读', () => {
  it('五字段齐全的行读回为 skill-rewrite 动作', () => {
    const proposal = proposalOfPayload({ title: '改写能力', actions: [ACTION] })
    expect(proposal?.actions).toEqual([ACTION])
  })

  it('缺任一必需字段的行被剔除，剔光则不算提议', () => {
    for (const missing of ['name', 'file', 'original', 'new', 'why'] as const) {
      const broken = { ...ACTION, [missing]: undefined }
      expect(proposalOfPayload({ title: 'x', actions: [broken] })).toBeNull()
    }
  })
})

describe('applyProposal：skill-rewrite 行', () => {
  const proposal: Proposal = { title: '改写能力', actions: [ACTION] }

  it('没有挂写回动词的通道诚实跳过', async () => {
    const result = await applyProposal({ proposal, ticked: [0], target: target() })
    expect(result.written).toEqual([])
    expect(result.skipped).toEqual(['技能改写 mail-reader/notes.md：这条通道没有挂技能写回动词'])
  })

  it('勾选驱动写回动词，回报带备份位置，且记为不可逆', async () => {
    const skillRewrite = vi.fn(async () => ({ file: 'notes.md', backupPath: '.dsh/yantao/capability-backups/mail-reader/stamp/notes.md' }))
    const result = await applyProposal({ proposal, ticked: [0], target: target({ skillRewrite }) })
    expect(skillRewrite).toHaveBeenCalledWith({
      name: 'mail-reader', file: 'notes.md', original: '原始笔记\n第二行\n', new: '改好的笔记\n第二行\n',
    })
    expect(result.written).toEqual(['技能改写 mail-reader/notes.md（原内容已备份 → .dsh/yantao/capability-backups/mail-reader/stamp/notes.md）'])
    expect(result.skipped).toEqual([])
    // 写回是既成事实：不出撤销步骤，也不伪造可逆记录。
    expect(result.undo).toBeUndefined()
  })

  it('写回失败只标记本行，不炸整卡', async () => {
    const skillRewrite = vi.fn(async () => { throw new Error('文件在提名后又被改动') })
    const result = await applyProposal({ proposal, ticked: [0], target: target({ skillRewrite }) })
    expect(result.written).toEqual([])
    expect(result.skipped).toEqual(['技能改写 mail-reader/notes.md：文件在提名后又被改动'])
  })
})

describe('ProposalCard：skill-rewrite 行的 diff 面', () => {
  const proposal: Proposal = { title: '改写能力', actions: [ACTION] }

  it('分组头、行标签与 why 都按 ADR-0054 的脸渲染', () => {
    render(<ProposalCard proposal={proposal} onConfirm={() => {}} onDismiss={() => {}} t={t} />)
    expect(screen.getByText('技能改写（批准即生效）')).toBeTruthy()
    expect(screen.getByText('notes.md')).toBeTruthy()
    expect(screen.getByText('mail-reader：流程变了')).toBeTruthy()
  })

  it('diff 默认折叠，「查看改动」展开朴素逐行 diff', () => {
    render(<ProposalCard proposal={proposal} onConfirm={() => {}} onDismiss={() => {}} t={t} />)
    expect(document.querySelector('[data-proposal-diff-body]')).toBeNull()
    fireEvent.click(screen.getByText('查看改动'))
    expect(screen.getByText('- 原始笔记')).toBeTruthy()
    expect(screen.getByText('+ 改好的笔记')).toBeTruthy()
    // 不变行以两空格前缀呈现；RTL 对前导空白的文本查询不可靠，按行类型断言。
    const sameRow = document.querySelector('[data-proposal-diff-row="same"]')
    expect(sameRow?.textContent).toBe('  第二行')
    fireEvent.click(screen.getByText('收起改动'))
    expect(document.querySelector('[data-proposal-diff-body]')).toBeNull()
  })

  it('勾选 skill-rewrite 行按下标确认', () => {
    const onConfirm = vi.fn()
    render(<ProposalCard proposal={proposal} onConfirm={onConfirm} onDismiss={() => {}} t={t} />)
    fireEvent.click(screen.getByLabelText('notes.md'))
    fireEvent.click(screen.getByText('确认写入（1）'))
    expect(onConfirm).toHaveBeenCalledWith([0], undefined)
  })
})
