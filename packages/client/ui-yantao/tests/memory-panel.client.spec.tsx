// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KbMemoryListResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
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

/** The panel's props, with spies standing in for the three memory RPCs. */
function props(overrides: Partial<MemoryPanelProps> = {}): MemoryPanelProps {
  return {
    t,
    list: vi.fn(async () => LISTED),
    add: vi.fn(async (scope: string, text: string) => ({ path: `.dsh/yantao/memory/${scope}.md`, entry: { id: 'm9', text } })),
    remove: vi.fn(async () => ({ path: '.dsh/yantao/memory/global.md' })),
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

  it('adds a rule to the chosen scope and reloads', async () => {
    const panel = props()
    render(<MemoryPanel {...panel} />)
    await screen.findByText('汇报先发给直属上级')
    fireEvent.change(screen.getByPlaceholderText('要记住的纠正或偏好（一句话）'), { target: { value: '日报只写结论' } })
    await act(async () => {
      fireEvent.click(screen.getByText('记住'))
    })
    expect(panel.add).toHaveBeenCalledWith('global', '日报只写结论')
    expect(await screen.findByText('已记住。')).toBeTruthy()
    await waitFor(() => {
      expect(panel.list).toHaveBeenCalledTimes(2)
    })
  })

  it('reads a duplicate refusal as 已记得, not as an error', async () => {
    const { container } = render(<MemoryPanel {...props({
      add: vi.fn(async () => { throw new Error('这条记忆已经存在（作用域 global）：日报只写结论') }),
    })} />)
    await screen.findByText('汇报先发给直属上级')
    fireEvent.change(screen.getByPlaceholderText('要记住的纠正或偏好（一句话）'), { target: { value: '日报只写结论' } })
    await act(async () => {
      fireEvent.click(screen.getByText('记住'))
    })
    expect(await screen.findByText('这条已经记得了。')).toBeTruthy()
    expect(container.querySelector('[data-memory-error]')).toBeNull()
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
})
