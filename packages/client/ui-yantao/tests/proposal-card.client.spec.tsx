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
    expect(screen.getByLabelText('机房搬迁·基础设施').checked).toBe(true)
    expect(screen.getByLabelText('机房搬迁·协作平台').checked).toBe(false)
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
