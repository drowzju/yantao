// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KbMemoryListResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { ShengDePanel, type ShengDePanelProps } from '../src/client/ShengDePanel.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  localStorage.clear()
})

const PATH = 'entities/todos.md'

const TODO_TEXT = '- [ ] 写下第一个待办\n- [x] 已完成的\n'

const TODO_ITEMS = [
  { done: false, title: '写下第一个待办', body: '', extra: [] },
  { done: true, title: '已完成的', body: '', extra: [] },
]

const LISTED: KbMemoryListResult = {
  groups: [
    {
      scope: 'global', path: '.dsh/yantao/memory/global.md',
      text: '# 行为记忆\n\n## 规则\n\n- m1 2026-09-20 汇报先发给直属上级\n',
      entries: [{ id: 'm1', date: '2026-09-20', text: '汇报先发给直属上级' }],
    },
  ],
}

/** The merged panel's props, with spies standing in for both halves' RPCs. */
function props(overrides: Partial<ShengDePanelProps> = {}): ShengDePanelProps {
  return {
    t,
    load: () => Promise.resolve({ path: PATH, text: TODO_TEXT, items: TODO_ITEMS }),
    write: () => Promise.resolve({ path: PATH, text: TODO_TEXT }),
    refreshKey: 0,
    onOpenFile: () => {},
    list: () => Promise.resolve(LISTED),
    add: () => Promise.resolve({ path: '.dsh/yantao/memory/global.md', entry: { id: 'm9', text: 'x' } }),
    remove: () => Promise.resolve(),
    ...overrides,
  }
}

describe('ShengDePanel', () => {
  it('stacks the todo board above the memory view, both sediment layers folded', async () => {
    const { container } = render(<ShengDePanel {...props()} />)
    expect(await screen.findByText('写下第一个待办')).toBeTruthy()
    // DONE folded…
    expect(container.querySelector('[data-todo-pane="done"]')).toBeNull()
    // …and the approved rules folded too, behind their toggle.
    expect(container.querySelector('[data-memory-group="global"]')).toBeNull()
    expect(container.querySelector('[data-memory-approved-toggle]')).not.toBeNull()
  })

  it('expands a layer on demand and remembers it across a remount', async () => {
    const { container, unmount } = render(<ShengDePanel {...props()} />)
    await screen.findByText('写下第一个待办')
    fireEvent.click(container.querySelector('[data-todo-block="done"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-memory-approved-toggle]') as HTMLElement)
    expect(await screen.findByText('已完成的')).toBeTruthy()
    expect(await screen.findByText('汇报先发给直属上级')).toBeTruthy()
    unmount()

    // The ledger survives in localStorage; a fresh mount reads it back.
    const again = render(<ShengDePanel {...props()} />)
    expect(await screen.findByText('写下第一个待办')).toBeTruthy()
    expect(again.container.querySelector('[data-todo-pane="done"]')).not.toBeNull()
    await waitFor(() => {
      expect(again.container.querySelector('[data-memory-group="global"]')).not.toBeNull()
    })
  })
})
