// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KbMemoryProposalListResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { MemoryProposalZone, type MemoryProposalZoneProps } from '../src/client/MemoryProposalZone.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const PROPOSED: KbMemoryProposalListResult = {
  groups: [
    {
      scope: 'dingtalk-docs', path: '.dsh/yantao/memory/proposals/dingtalk-docs.md',
      text: '- p1 2026-10-01 [会话] jsonml 判空先看节点类型\n',
      entries: [{ id: 'p1', date: '2026-10-01', text: 'jsonml 判空先看节点类型', source: '会话' }],
    },
  ],
}

/** The zone's props, with spies standing in for the queue RPCs. */
function props(overrides: Partial<MemoryProposalZoneProps> = {}): MemoryProposalZoneProps {
  return {
    t,
    list: vi.fn(async (): Promise<KbMemoryProposalListResult> => ({ groups: [] })),
    approve: vi.fn(async (scope: string, text: string, targetScope?: string) => ({
      path: `.dsh/yantao/memory/proposals/${scope}.md`,
      targetPath: `.dsh/yantao/memory/${targetScope ?? scope}.md`,
      entry: { id: 'm9', text },
    })),
    discard: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('MemoryProposalZone', () => {
  it('renders nothing when the queue is empty and nothing needs saying', () => {
    const { container } = render(<MemoryProposalZone {...props()} />)
    expect(container.querySelector('[data-memory-proposals]')).toBeNull()
  })

  it('shows the queue with source annotations and both verdicts, reporting the count', async () => {
    const onPendingChange = vi.fn()
    const { container } = render(<MemoryProposalZone {...props({ list: vi.fn(async () => PROPOSED), onPendingChange })} />)
    expect(await screen.findByText('jsonml 判空先看节点类型')).toBeTruthy()
    expect(container.querySelector('[data-memory-proposals]')).not.toBeNull()
    const row = container.querySelector('[data-memory-proposal="p1"]')
    expect(row).not.toBeNull()
    expect(container.querySelector('[data-memory-proposal-scope="dingtalk-docs"]')).not.toBeNull()
    expect(screen.getByText(/来源：会话/)).toBeTruthy()
    expect(screen.getByText('批准')).toBeTruthy()
    expect(screen.getByText('丢弃')).toBeTruthy()
    // A proposal arrives already scoped by its capability's run, so the card
    // offers no scope picker — scope picking belongs to the 省得 add row.
    expect(row?.querySelector('select')).toBeNull()
    // The pending count flows upward for the footer/子页 badges.
    await waitFor(() => {
      expect(onPendingChange).toHaveBeenCalledWith(1)
    })
  })

  it('approves a proposal to its own scope, notices, and drains the count', async () => {
    let queue: KbMemoryProposalListResult = PROPOSED
    const onPendingChange = vi.fn()
    const zone = props({
      list: vi.fn(async () => queue),
      approve: vi.fn(async () => { queue = { groups: [] } }),
      onPendingChange,
    })
    render(<MemoryProposalZone {...zone} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('批准'))
    })
    expect(zone.approve).toHaveBeenCalledWith('dingtalk-docs', 'jsonml 判空先看节点类型')
    expect(await screen.findByText('已批准，沉淀为行为记忆。')).toBeTruthy()
    await waitFor(() => {
      expect(onPendingChange).toHaveBeenLastCalledWith(0)
    })
  })

  it('reads an approve duplicate refusal as 已记得, not as an error', async () => {
    const { container } = render(<MemoryProposalZone {...props({
      list: vi.fn(async () => PROPOSED),
      approve: vi.fn(async () => { throw new Error('这条记忆已经存在（作用域 dingtalk-docs）：jsonml 判空先看节点类型') }),
    })} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('批准'))
    })
    expect(await screen.findByText('这条已经记得了。')).toBeTruthy()
    expect(container.querySelector('[data-memory-proposal-error]')).toBeNull()
  })

  it('surfaces a failed approve as the error line', async () => {
    const { container } = render(<MemoryProposalZone {...props({
      list: vi.fn(async () => PROPOSED),
      approve: vi.fn(async () => { throw new Error('KB 根未设置') }),
    })} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('批准'))
    })
    expect(await screen.findByText('KB 根未设置')).toBeTruthy()
    expect(container.querySelector('[data-memory-proposal-error]')).not.toBeNull()
  })

  it('discards a proposal: the row leaves and the count drains', async () => {
    let queue: KbMemoryProposalListResult = PROPOSED
    const onPendingChange = vi.fn()
    const { container } = render(<MemoryProposalZone {...props({
      list: vi.fn(async () => queue),
      discard: vi.fn(async () => { queue = { groups: [] } }),
      onPendingChange,
    })} />)
    await screen.findByText('jsonml 判空先看节点类型')
    await act(async () => {
      fireEvent.click(screen.getByText('丢弃'))
    })
    expect(screen.getByText('已丢弃，提案移出队列。')).toBeTruthy()
    await waitFor(() => {
      expect(container.querySelector('[data-memory-proposal="p1"]')).toBeNull()
    })
    await waitFor(() => {
      expect(onPendingChange).toHaveBeenLastCalledWith(0)
    })
  })
})
