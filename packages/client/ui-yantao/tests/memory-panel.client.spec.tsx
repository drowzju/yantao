// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KbMemoryListResult, KbMemoryProposalListResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { MemoryPanel, type MemoryPanelProps } from '../src/client/MemoryPanel.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const LISTED: KbMemoryListResult = {
  groups: [
    {
      scope: 'global', path: '.dsh/yantao/memory/global.md',
      text: '# 行为记忆\n\n## 规则\n\n- m1 2026-09-20 汇报先发给直属上级\n',
      entries: [{ id: 'm1', date: '2026-09-20', text: '汇报先发给直属上级' }],
    },
    {
      scope: 'mail', path: '.dsh/yantao/memory/mail.md',
      text: '# 行为记忆（邮件）\n\n## 规则\n\n- m2 2026-09-21 周报周五下班前发\n',
      entries: [{ id: 'm2', date: '2026-09-21', text: '周报周五下班前发' }],
    },
  ],
}

const PROPOSED: KbMemoryProposalListResult = {
  groups: [
    {
      scope: 'dingtalk-docs', path: '.dsh/yantao/memory/proposals/dingtalk-docs.md',
      text: '- p1 2026-10-01 [会话] jsonml 判空先看节点类型\n',
      entries: [{ id: 'p1', date: '2026-10-01', text: 'jsonml 判空先看节点类型', source: '会话' }],
    },
  ],
}

/** The panel's props, with spies standing in for the memory and proposal RPCs. */
function props(overrides: Partial<MemoryPanelProps> = {}): MemoryPanelProps {
  return {
    t,
    list: vi.fn(async () => LISTED),
    add: vi.fn(async (scope: string, text: string) => ({ path: `.dsh/yantao/memory/${scope}.md`, entry: { id: 'm9', text } })),
    remove: vi.fn(async () => {}),
    listProposals: vi.fn(async (): Promise<KbMemoryProposalListResult> => ({ groups: [] })),
    approveProposal: vi.fn(async (scope: string, text: string, targetScope?: string) => ({
      path: `.dsh/yantao/memory/proposals/${scope}.md`,
      targetPath: `.dsh/yantao/memory/${targetScope ?? scope}.md`,
      entry: { id: 'm9', text },
    })),
    discardProposal: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('MemoryPanel', () => {
  it('lists every scope under its name, entries with their dates', async () => {
    const { container } = render(<MemoryPanel {...props()} />)
    await screen.findByText('汇报先发给直属上级')
    expect(container.querySelector('[data-memory-group="global"]')).not.toBeNull()
    expect(container.querySelector('[data-memory-group="mail"]')).not.toBeNull()
    expect(container.querySelector('[data-memory-entry="m1"]')?.textContent).toContain('2026-09-20')
  })

  it('adds a rule to the chosen scope and reloads, then the form collapses', async () => {
    const panel = props()
    render(<MemoryPanel {...panel} />)
    await screen.findByText('汇报先发给直属上级')
    fireEvent.click(screen.getByText('新增记忆'))
    fireEvent.change(screen.getByPlaceholderText('要记住的纠正或偏好（一句话）'), { target: { value: '日报只写结论' } })
    await act(async () => {
      fireEvent.click(screen.getByText('保存'))
    })
    expect(panel.add).toHaveBeenCalledWith('global', '日报只写结论')
    expect(await screen.findByText('已记住。')).toBeTruthy()
    // A successful save collapses the form back to the 新增记忆 button.
    expect(screen.queryByPlaceholderText('要记住的纠正或偏好（一句话）')).toBeNull()
    await waitFor(() => {
      expect(panel.list).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps the add form collapsed until 新增记忆, and 取消 closes it without adding', async () => {
    const panel = props()
    const { container } = render(<MemoryPanel {...panel} />)
    await screen.findByText('汇报先发给直属上级')
    expect(container.querySelector('[data-memory-add]')).toBeNull()
    fireEvent.click(container.querySelector('[data-memory-add-open]') as Element)
    expect(container.querySelector('[data-memory-add]')).not.toBeNull()
    fireEvent.change(screen.getByPlaceholderText('要记住的纠正或偏好（一句话）'), { target: { value: '写了一半' } })
    fireEvent.click(container.querySelector('[data-memory-add-cancel]') as Element)
    expect(container.querySelector('[data-memory-add]')).toBeNull()
    expect(panel.add).not.toHaveBeenCalled()
  })

  it('reads a duplicate refusal as 已记得, not as an error — and keeps the form open', async () => {
    const { container } = render(<MemoryPanel {...props({
      add: vi.fn(async () => { throw new Error('这条记忆已经存在（作用域 global）：日报只写结论') }),
    })} />)
    await screen.findByText('汇报先发给直属上级')
    fireEvent.click(screen.getByText('新增记忆'))
    fireEvent.change(screen.getByPlaceholderText('要记住的纠正或偏好（一句话）'), { target: { value: '日报只写结论' } })
    await act(async () => {
      fireEvent.click(screen.getByText('保存'))
    })
    expect(await screen.findByText('这条已经记得了。')).toBeTruthy()
    expect(container.querySelector('[data-memory-error]')).toBeNull()
    expect(container.querySelector('[data-memory-add]')).not.toBeNull()
  })

  it('deletes an entry and refreshes even when the id went stale', async () => {
    const panel = props({
      remove: vi.fn(async () => { throw new Error('没有这条记忆（可能已被手工删除）') }),
    })
    const { container } = render(<MemoryPanel {...panel} />)
    await screen.findByText('汇报先发给直属上级')
    await act(async () => {
      fireEvent.click(container.querySelector('[data-memory-delete="m1"]') as Element)
    })
    expect(panel.remove).toHaveBeenCalledWith('global', 'm1')
    expect(await screen.findByText(/没有这条记忆/)).toBeTruthy()
    await waitFor(() => {
      expect(panel.list).toHaveBeenCalledTimes(2)
    })
  })

  it('shows the 待批准 zone with source annotations and both verdicts', async () => {
    const { container } = render(<MemoryPanel {...props({ listProposals: vi.fn(async () => PROPOSED) })} />)
    expect(await screen.findByText('jsonml 判空先看节点类型')).toBeTruthy()
    expect(container.querySelector('[data-memory-proposals]')).not.toBeNull()
    const row = container.querySelector('[data-memory-proposal="p1"]')
    expect(row).not.toBeNull()
    expect(container.querySelector('[data-memory-proposal-scope="dingtalk-docs"]')).not.toBeNull()
    expect(screen.getByText(/来源：会话/)).toBeTruthy()
    expect(screen.getByText('批准')).toBeTruthy()
    expect(screen.getByText('丢弃')).toBeTruthy()
    // A proposal arrives already scoped by its capability's run, so the card
    // offers no scope picker — scope picking belongs to the add row.
    expect(row?.querySelector('select')).toBeNull()
  })

  it('hides the 待批准 zone when the queue is empty', () => {
    const { container } = render(<MemoryPanel {...props()} />)
    expect(container.querySelector('[data-memory-proposals]')).toBeNull()
  })

  it('approves a proposal to its own scope and reloads', async () => {
    const panel = props({ listProposals: vi.fn(async () => PROPOSED) })
    render(<MemoryPanel {...panel} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('批准'))
    })
    expect(panel.approveProposal).toHaveBeenCalledWith('dingtalk-docs', 'jsonml 判空先看节点类型')
    expect(await screen.findByText('已批准，沉淀为行为记忆。')).toBeTruthy()
  })

  it('reads an approve duplicate refusal as 已记得, not as an error', async () => {
    const { container } = render(<MemoryPanel {...props({
      listProposals: vi.fn(async () => PROPOSED),
      approveProposal: vi.fn(async () => { throw new Error('这条记忆已经存在（作用域 dingtalk-docs）：jsonml 判空先看节点类型') }),
    })} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('批准'))
    })
    expect(await screen.findByText('这条已经记得了。')).toBeTruthy()
    expect(container.querySelector('[data-memory-error]')).toBeNull()
  })

  it('surfaces a failed approve as the error line', async () => {
    const { container } = render(<MemoryPanel {...props({
      listProposals: vi.fn(async () => PROPOSED),
      approveProposal: vi.fn(async () => { throw new Error('KB 根未设置') }),
    })} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('批准'))
    })
    expect(await screen.findByText('KB 根未设置')).toBeTruthy()
    // An approve failure belongs to the proposal channel's own error line,
    // not the queue-load error above the zone.
    expect(container.querySelector('[data-memory-proposal-error]')).not.toBeNull()
  })

  it('discards a proposal and the row leaves the zone', async () => {
    let queue: KbMemoryProposalListResult = PROPOSED
    const panel = props({
      listProposals: vi.fn(async () => queue),
      discardProposal: vi.fn(async () => { queue = { groups: [] } }),
    })
    const { container } = render(<MemoryPanel {...panel} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('丢弃'))
    })
    expect(panel.discardProposal).toHaveBeenCalledWith('dingtalk-docs', 'jsonml 判空先看节点类型')
    expect(await screen.findByText('已丢弃，提案移出队列。')).toBeTruthy()
    await waitFor(() => {
      expect(container.querySelector('[data-memory-proposals]')).toBeNull()
    })
  })
})
