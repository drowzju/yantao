// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { KbRelationGraphResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { GraphPane } from '../src/client/frame/GraphPane.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const DATA: KbRelationGraphResult = {
  nodes: ['entities/people/alice.md', 'entities/people/bob.md', 'entities/projects/x.md'],
  edges: [
    { from: 'entities/people/alice.md', to: 'entities/people/bob.md', kind: 'person-person' },
    { from: 'entities/people/alice.md', to: 'entities/projects/x.md', kind: 'person-project' },
  ],
}

function renderPane(
  onOpen: (path: string) => void = () => {},
  onReload?: () => void,
  data: KbRelationGraphResult = DATA,
): ReturnType<typeof render> {
  return render(<GraphPane data={data} onOpen={onOpen} onReload={onReload} t={t} />)
}

describe('GraphPane (2026-10-14 键盘与读屏可达化)', () => {
  it('legend switches are real buttons reporting aria-pressed', () => {
    renderPane()
    const toggle = screen.getByRole('button', { name: /人 — 项目/ })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /人 — 项目/ }).getAttribute('aria-pressed')).toBe('true')
    // The 人 — 人 base has no switch and stays a plain legend row.
    expect(screen.queryByRole('button', { name: /人 — 人/ })).toBeNull()
  })

  it('the list view answers the same data with keyboard-operable node rows', () => {
    const onOpen = vi.fn<(path: string) => void>()
    const { container } = renderPane(onOpen)
    fireEvent.click(screen.getByRole('button', { name: '列表' }))
    const list = container.querySelector('[data-graph-list="true"]') as HTMLElement
    expect(list).toBeTruthy()
    // 默认视图只开 person-person 基座：alice/bob 可见，x 躲在关闭的开关后。
    fireEvent.click(within(list).getByRole('button', { name: /alice/ }))
    expect(onOpen).toHaveBeenCalledWith('entities/people/alice.md')
    expect(within(list).queryByRole('button', { name: /^x/ })).toBeNull()
    expect(within(list).getByText(/alice — 人 — 人 — bob/)).toBeTruthy()
    expect(within(list).queryByText(/alice — 人 — 项目 — x/)).toBeNull()
    // 图例开关对列表同样生效：打开后 x 与人 — 项目 关系行出现。
    fireEvent.click(screen.getByRole('button', { name: /人 — 项目/ }))
    expect(within(list).getByRole('button', { name: /^x/ })).toBeTruthy()
    expect(within(list).getByText(/alice — 人 — 项目 — x/)).toBeTruthy()
  })

  it('view switch rides the tab face with data-selected on the active one', () => {
    const { container } = renderPane()
    const listButton = screen.getByRole('button', { name: '列表' })
    expect(listButton.hasAttribute('data-selected')).toBe(false)
    fireEvent.click(listButton)
    expect(screen.getByRole('button', { name: '列表' }).hasAttribute('data-selected')).toBe(true)
    expect(screen.getByRole('button', { name: '图谱' }).hasAttribute('data-selected')).toBe(false)
    expect(container.querySelector('[data-graph-list="true"]')).toBeTruthy()
  })

  it('刷新钮与视图切换钮同一条工具带共存且回调可达（2026-10-15 ocr 复核补测）', () => {
    // 此前用例从不传 onReload，刷新钮被同坐标切换钮压死的回归（P2-1）CI 无法察觉。
    const onReload = vi.fn()
    renderPane(undefined, onReload)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    // 同屏共存：切换钮与刷新钮互不顶替。
    expect(screen.getByRole('button', { name: '图谱' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '列表' })).toBeTruthy()
  })

  it('空态（零节点）也渲染刷新钮', () => {
    const onReload = vi.fn()
    renderPane(undefined, onReload, { nodes: [], edges: [] })
    const refresh = screen.getByRole('button', { name: '刷新' })
    fireEvent.click(refresh)
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
