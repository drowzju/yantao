// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Proposal } from '../src/client/proposal.ts'
import { ProposalCard } from '../src/client/ProposalCard.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const PROPOSAL: Proposal = {
  title: '邮件分析 2026-09-14',
  actions: [
    { kind: 'create-entity', entityType: 'person', name: '张三', reason: '合作方：一起做汇报' },
    { kind: 'add-todo', title: '发汇报', due: '2026-09-20', body: '给张三', reason: '给张三' },
    { kind: 'append-log', entityPath: 'entities/projects/飞书迁移.md', entityName: '飞书迁移', text: '确认了时间', reason: '确认了时间' },
    { kind: 'save-resource', path: 'resources/汇报模板.md', content: '…', reason: '两句话' },
  ],
}

describe('ProposalCard', () => {
  it('groups the actions by kind with the shared labels', () => {
    render(<ProposalCard proposal={PROPOSAL} onConfirm={() => {}} onDismiss={() => {}} t={t} />)
    expect(screen.getByText('新建实体')).toBeTruthy()
    expect(screen.getByText('待办')).toBeTruthy()
    expect(screen.getByText('项目动态')).toBeTruthy()
    expect(screen.getByText('资源')).toBeTruthy()
    // The add-todo row shows its due date; the save-resource row shows its path.
    expect(screen.getByText('发汇报（2026-09-20）')).toBeTruthy()
    expect(screen.getByText('resources/汇报模板.md')).toBeTruthy()
  })

  it('shows each row reason as the small print', () => {
    render(<ProposalCard proposal={PROPOSAL} onConfirm={() => {}} onDismiss={() => {}} t={t} />)
    expect(screen.getByText('合作方：一起做汇报')).toBeTruthy()
    expect(screen.getByText('两句话')).toBeTruthy()
  })

  it('ticks nothing to begin with, and counts what the human ticked', () => {
    render(<ProposalCard proposal={PROPOSAL} onConfirm={() => {}} onDismiss={() => {}} t={t} />)
    expect(screen.getByText('确认写入（0）')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('张三'))
    expect(screen.getByText('确认写入（1）')).toBeTruthy()
    fireEvent.click(screen.getByText('全部接受'))
    expect(screen.getByText('确认写入（4）')).toBeTruthy()
    fireEvent.click(screen.getByText('全部忽略'))
    expect(screen.getByText('确认写入（0）')).toBeTruthy()
  })

  it('confirms with the flat indexes of the ticked rows', () => {
    const onConfirm = vi.fn()
    render(<ProposalCard proposal={PROPOSAL} onConfirm={onConfirm} onDismiss={() => {}} t={t} />)
    fireEvent.click(screen.getByLabelText('张三'))
    fireEvent.click(screen.getByLabelText('resources/汇报模板.md'))
    fireEvent.click(screen.getByText('确认写入（2）'))
    expect(onConfirm).toHaveBeenCalledWith([0, 3], undefined)
  })

  it('refuses to confirm while nothing is ticked, and holds still while busy', () => {
    const onConfirm = vi.fn()
    render(<ProposalCard proposal={PROPOSAL} onConfirm={onConfirm} onDismiss={() => {}} busy t={t} />)
    const confirm = screen.getByText('确认写入（0）') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByText('全部接受'))
    expect(confirm.disabled).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('says so when the proposal is empty, and disables 全部接受', () => {
    render(
      <ProposalCard
        proposal={{ title: '邮件分析', actions: [] }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        t={t}
      />,
    )
    expect(screen.getByText('这次没有发现值得进入知识库的内容。')).toBeTruthy()
    expect(screen.getByText<HTMLButtonElement>('全部接受').disabled).toBe(true)
  })

  it('shows the 重点提醒 block above the groups, without checkboxes', () => {
    render(
      <ProposalCard
        proposal={{
          ...PROPOSAL,
          highlights: [{ sender: '老板', subject: '周报截止', why: '上级主送，有截止' }],
          digest: [{ sender: '系统', subject: '邮催', why: '自动提醒' }],
        }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        t={t}
      />,
    )
    expect(screen.getByText('重点提醒')).toBeTruthy()
    expect(screen.getByText('老板：周报截止')).toBeTruthy()
    expect(screen.getByText('上级主送，有截止')).toBeTruthy()
    expect(screen.getByText('日常通知（汇总）')).toBeTruthy()
    // Highlights are informational: they add nothing to the tick count.
    expect(screen.getByText('确认写入（0）')).toBeTruthy()
    fireEvent.click(screen.getByText('全部接受'))
    expect(screen.getByText('确认写入（4）')).toBeTruthy()
  })

  it('dismisses without writing anything', () => {
    const onDismiss = vi.fn()
    render(<ProposalCard proposal={PROPOSAL} onConfirm={() => {}} onDismiss={onDismiss} t={t} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('ProposalCard create-project 领域勾选 (ADR-0034 决定 4)', () => {
  const AREAS_PROPOSAL: Proposal = {
    title: '邮件分析 2026-09-24',
    actions: [{ kind: 'create-project', name: '机房搬迁', reason: 'r', areas: ['基础设施'] }],
    areas: ['基础设施', '协作平台'],
  }

  it('renders the row\'s 领域勾选 with the model\'s suggestion pre-checked', () => {
    render(<ProposalCard proposal={AREAS_PROPOSAL} onConfirm={() => {}} onDismiss={() => {}} t={t} />)
    expect(screen.getByText('新建项目')).toBeTruthy()
    expect(screen.getByText(/关联领域：基础设施。/)).toBeTruthy()
    // `matches(':checked')` instead of the `checked` property: the aggregated
    // typert build and oxlint disagree on what `getByLabelText` returns, and
    // this reads the same truth off either typing without a cast.
    expect(screen.getByLabelText('机房搬迁·基础设施').matches(':checked')).toBe(true)
    expect(screen.getByLabelText('机房搬迁·协作平台').matches(':checked')).toBe(false)
  })

  it('passes the adjusted 领域勾选 to onConfirm, keyed by action index', () => {
    const onConfirm = vi.fn()
    render(<ProposalCard proposal={AREAS_PROPOSAL} onConfirm={onConfirm} onDismiss={() => {}} t={t} />)
    fireEvent.click(screen.getByLabelText('机房搬迁·协作平台'))
    fireEvent.click(screen.getByLabelText('机房搬迁'))
    fireEvent.click(screen.getByText('确认写入（1）'))
    expect(onConfirm).toHaveBeenCalledWith([0], { 0: ['基础设施', '协作平台'] })
  })

  it('keeps the model\'s suggestion when the human touches no checkbox', () => {
    const onConfirm = vi.fn()
    render(<ProposalCard proposal={AREAS_PROPOSAL} onConfirm={onConfirm} onDismiss={() => {}} t={t} />)
    fireEvent.click(screen.getByLabelText('机房搬迁'))
    fireEvent.click(screen.getByText('确认写入（1）'))
    expect(onConfirm).toHaveBeenCalledWith([0], undefined)
  })
})

describe('ProposalCard delete-mails group (ADR-0034 决定 5)', () => {
  const DELETION_PROPOSAL: Proposal = {
    title: '邮件分析 2026-09-24',
    actions: [
      { kind: 'delete-mails', entryId: 'e1', sender: 'IT 服务台', subject: '旧流程下线通知', reason: '失效通知，无待办' },
    ],
  }

  it('renders the nominees as a tickable 删除邮件 group, not an informational block', () => {
    const onConfirm = vi.fn()
    render(<ProposalCard proposal={DELETION_PROPOSAL} onConfirm={onConfirm} onDismiss={() => {}} t={t} />)
    expect(screen.getByText('删除邮件（移入已删除）')).toBeTruthy()
    expect(screen.getByText('旧流程下线通知')).toBeTruthy()
    expect(screen.getByText('IT 服务台：失效通知，无待办')).toBeTruthy()
    // The knife waits for the human's tick: nothing is pre-ticked.
    expect(screen.getByText('确认写入（0）')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('旧流程下线通知'))
    fireEvent.click(screen.getByText('确认写入（1）'))
    expect(onConfirm).toHaveBeenCalledWith([0], undefined)
  })
})

describe('ProposalCard 双区块 (ADR-0036 决定 6)', () => {
  const FIX_ROW = {
    kind: 'edit-section',
    path: 'entities/people/张三.md',
    section: '状态',
    before: '旧',
    after: '新',
    why: '将 [[坏名]]（位于 张三）改写为 [[好名]]',
  } as const
  const MODEL_ROW = { kind: 'create-entity', entityType: 'person', name: '李四', reason: 'r' } as const

  it('folds the prescan into a summary, and opens the detail on demand (2026-09-30)', () => {
    const onConfirm = vi.fn()
    const { container } = render(
      <ProposalCard
        proposal={{
          title: 't',
          actions: [],
          prescan: {
            orphans: [{ name: '孤岛', type: 'person', incoming: 0 }],
            findings: [{ kind: 'broken-link', subject: '[[坏名]]', why: '无可信修复候选' }],
            actions: [FIX_ROW],
          },
        }}
        onConfirm={onConfirm}
        onDismiss={() => {}}
        t={t}
      />,
    )
    // Folded: the summary line stands, the detail rows are not in the DOM.
    expect(screen.getByText('系统预扫（确定性）')).toBeTruthy()
    expect(container.querySelector('[data-proposal-prescan-summary]')?.textContent).toContain('孤岛 1 个 · 死链 1 条 · 可勾选修复 1 条')
    expect(screen.queryByText('孤岛（person，入链 0）')).toBeNull()
    expect(screen.queryByText('[[坏名]] — 无可信修复候选')).toBeNull()
    expect(screen.queryByText('模型发现')).toBeNull()
    // Expanding reveals the orphans, the findings and the tickable fix row,
    // with the same partial-approval semantics as any action.
    fireEvent.click(container.querySelector('[data-proposal-prescan-toggle]')!)
    expect(screen.getByText('孤岛（person，入链 0）')).toBeTruthy()
    expect(screen.getByText('[[坏名]] — 无可信修复候选')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('状态'))
    fireEvent.click(screen.getByText('确认写入（1）'))
    expect(onConfirm).toHaveBeenCalledWith([0], undefined)
  })

  it('shows only the model block when there is no prescan', () => {
    render(
      <ProposalCard
        proposal={{
          title: 't',
          actions: [MODEL_ROW],
          findings: [{ kind: 'stale', subject: '张三', why: '状态过期' }],
        }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        t={t}
      />,
    )
    expect(screen.getByText('模型发现')).toBeTruthy()
    expect(screen.queryByText('系统预扫（确定性）')).toBeNull()
  })

  it('hides the whole deterministic block when the prescan found nothing', () => {
    render(
      <ProposalCard
        proposal={{ title: 't', actions: [MODEL_ROW], prescan: { orphans: [], findings: [], actions: [] } }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        t={t}
      />,
    )
    expect(screen.queryByText('系统预扫（确定性）')).toBeNull()
    expect(screen.getByText('新建实体')).toBeTruthy()
  })

  it('orders the deterministic block above the model block when both exist', () => {
    const { container } = render(
      <ProposalCard
        proposal={{
          title: 't',
          actions: [MODEL_ROW],
          findings: [{ kind: 'stale', subject: '张三', why: '状态过期' }],
          prescan: {
            orphans: [{ name: '孤岛', type: 'person', incoming: 0 }],
            findings: [{ kind: 'broken-link', subject: '[[坏名]]', why: '无可信修复候选' }],
            actions: [FIX_ROW],
          },
        }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        t={t}
      />,
    )
    const prescan = container.querySelector('[data-proposal-prescan]')
    const model = container.querySelector('[data-proposal-findings]')
    expect(prescan).not.toBeNull()
    expect(model).not.toBeNull()
    expect(model!.compareDocumentPosition(prescan!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('ticks both blocks with 全部接受 and keeps the flat index across them', () => {
    const onConfirm = vi.fn()
    render(
      <ProposalCard
        proposal={{
          title: 't',
          actions: [MODEL_ROW],
          prescan: { orphans: [], findings: [], actions: [FIX_ROW] },
        }}
        onConfirm={onConfirm}
        onDismiss={() => {}}
        t={t}
      />,
    )
    fireEvent.click(screen.getByText('全部接受'))
    fireEvent.click(screen.getByText('确认写入（2）'))
    expect(onConfirm).toHaveBeenCalledWith([0, 1], undefined)
  })
})

describe('ProposalCard 校验卡的实体分组与自由输入 (2026-09-30)', () => {
  const LINK_A = { kind: 'create-link', entityPath: 'entities/people/张三.md', entityName: '张三', link: '[[李四]]', reason: '汇报线' } as const
  const LOG_A = { kind: 'append-log', entityPath: 'entities/people/张三.md', entityName: '张三', text: '确认了对接关系', reason: '体检补链' } as const

  it('groups the model rows by target entity in the [A] 页 → [[B]] shape', () => {
    render(
      <ProposalCard
        proposal={{
          title: 't',
          actions: [LINK_A, LOG_A],
          prescan: { orphans: [], findings: [], actions: [] },
        }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        t={t}
      />,
    )
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.getByText('张三 页 新增链接 → [[李四]]')).toBeTruthy()
    expect(screen.getByText('张三 页 追加流水：确认了对接关系')).toBeTruthy()
    expect(screen.getByText('汇报线')).toBeTruthy()
  })

  it('merges same-target suggestions into one row with joined reasons, one checkbox ticking both', () => {
    const onConfirm = vi.fn()
    render(
      <ProposalCard
        proposal={{
          title: 't',
          actions: [
            LINK_A,
            { ...LINK_A, reason: '同一项目的两条佐证' },
          ],
          prescan: { orphans: [], findings: [], actions: [] },
        }}
        onConfirm={onConfirm}
        onDismiss={() => {}}
        t={t}
      />,
    )
    expect(screen.getAllByText('张三 页 新增链接 → [[李四]]')).toHaveLength(1)
    expect(screen.getByText('汇报线；同一项目的两条佐证')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('张三 页 新增链接 → [[李四]]'))
    // One tick, two writes: the count counts flat actions, not visual rows.
    fireEvent.click(screen.getByText('确认写入（2）'))
    // The flat indices ride together.
    expect(onConfirm).toHaveBeenCalledWith([0, 1], undefined)
  })

  it('renders a mutual pair once as 双向互链, one checkbox ticking both pages', () => {
    const onConfirm = vi.fn()
    render(
      <ProposalCard
        proposal={{
          title: 't',
          actions: [
            LINK_A,
            { kind: 'create-link', entityPath: 'entities/people/李四.md', entityName: '李四', link: '[[张三]]', reason: '反向补链' },
          ],
          prescan: { orphans: [], findings: [], actions: [] },
        }}
        onConfirm={onConfirm}
        onDismiss={() => {}}
        t={t}
      />,
    )
    // One row, not two; the reverse suggestion is absorbed into it.
    expect(screen.getByText('张三 页 新增链接 ↔ [[李四]]（双向互链）')).toBeTruthy()
    expect(screen.queryByText('李四 页 新增链接 → [[张三]]')).toBeNull()
    expect(screen.getByText('汇报线；反向补链')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('张三 页 新增链接 ↔ [[李四]]（双向互链）'))
    // One tick, two page writes — the count stays in flat actions.
    fireEvent.click(screen.getByText('确认写入（2）'))
    expect(onConfirm).toHaveBeenCalledWith([0, 1], undefined)
  })

  it('offers the free-input box only when the run can take instructions, and forwards the text', async () => {
    const onInstruction = vi.fn(async (_text: string) => {})
    const { rerender, container } = render(
      <ProposalCard proposal={{ title: 't', actions: [] }} onConfirm={() => {}} onDismiss={() => {}} t={t} />,
    )
    // Without the continuation the box does not exist at all.
    expect(container.querySelector('[data-validate-instruction]')).toBeNull()
    rerender(
      <ProposalCard
        proposal={{ title: 't', actions: [] }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        onInstruction={onInstruction}
        t={t}
      />,
    )
    const input = container.querySelector('[data-validate-instruction-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '以后别推荐没有新信息的提炼' } })
    fireEvent.click(screen.getByText('发送'))
    await vi.waitFor(() => { expect(onInstruction).toHaveBeenCalledWith('以后别推荐没有新信息的提炼') })
  })

  it('disables 发送 while the draft is blank or a round is in flight', () => {
    const { container } = render(
      <ProposalCard
        proposal={{ title: 't', actions: [] }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        onInstruction={vi.fn(async () => {})}
        t={t}
      />,
    )
    const send = screen.getByText('发送') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    const input = container.querySelector('[data-validate-instruction-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '意见' } })
    expect(send.disabled).toBe(false)
  })

  it('resets the tick state when a revision round hands over a fresh proposal (2026-09-30 review)', () => {
    const base = { title: 't', actions: [LOG_A], prescan: { orphans: [], findings: [], actions: [] } }
    const { rerender } = render(
      <ProposalCard proposal={base} onConfirm={() => {}} onDismiss={() => {}} t={t} />,
    )
    fireEvent.click(screen.getByLabelText('张三 页 追加流水：确认了对接关系'))
    expect(screen.getByText('确认写入（1）')).toBeTruthy()
    // Same shape, new object: the previous round's ticks must not leak in.
    rerender(
      <ProposalCard proposal={{ ...base }} onConfirm={() => {}} onDismiss={() => {}} t={t} />,
    )
    expect(screen.getByText('确认写入（0）')).toBeTruthy()
  })

  it('ignores Enter while the IME is still composing (2026-09-30 review)', async () => {
    const onInstruction = vi.fn(async (_text: string) => {})
    const { container } = render(
      <ProposalCard
        proposal={{ title: 't', actions: [] }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        onInstruction={onInstruction}
        t={t}
      />,
    )
    const input = container.querySelector('[data-validate-instruction-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '意见' } })
    // 选字确认的那次回车：组合未结束，不能当作发送。
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onInstruction).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => { expect(onInstruction).toHaveBeenCalledWith('意见') })
  })

  it('keeps the draft in the box when the revision round fails (2026-09-30 review)', async () => {
    const onInstruction = vi.fn(async () => { throw new Error('网关超时') })
    const { container } = render(
      <ProposalCard
        proposal={{ title: 't', actions: [] }}
        onConfirm={() => {}}
        onDismiss={() => {}}
        onInstruction={onInstruction}
        t={t}
      />,
    )
    const input = container.querySelector('[data-validate-instruction-input]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '意见' } })
    fireEvent.click(screen.getByText('发送'))
    await vi.waitFor(() => { expect(onInstruction).toHaveBeenCalledWith('意见') })
    // 失败不清空草稿：人可以直接改字重试。
    await vi.waitFor(() => {
      expect(input.value).toBe('意见')
      expect((screen.getByText('发送') as HTMLButtonElement).disabled).toBe(false)
    })
  })
})
