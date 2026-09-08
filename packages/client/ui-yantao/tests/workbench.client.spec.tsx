// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { Workbench } from '../src/client/Workbench.tsx'

afterEach(() => {
  cleanup()
})

const intake: KbTreeSection[] = [
  { id: 'resources', files: [{ name: '周报.eml', path: 'resources/周报.eml' }] },
  { id: 'meetings', files: [{ name: '周会', path: 'entities/meetings/周会.md' }] },
  { id: 'todos', files: [{ name: 'todos', path: 'entities/todos.md' }] },
]

const workspace: KbTreeSection[] = [
  { id: 'projects', files: [{ name: 'dsh 学习', path: 'entities/projects/dsh 学习.md' }] },
  { id: 'areas', files: [{ name: '健康', path: 'entities/areas/健康.md' }] },
  { id: 'people', files: [{ name: '我自己', path: 'entities/people/我自己.md', relation: 'self' }] },
]

describe('Workbench', () => {
  it('shows the four intake panels and the three workspace tabs', () => {
    render(
      <Workbench intake={intake} workspace={workspace} error={null} selection={null} onSelect={() => {}} onRefresh={() => {}} />,
    )
    for (const label of ['资源', '待办', '会议', '连接']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    for (const label of ['领域', '人物', '项目']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // The intake rows are on screen; the workspace rail opens on 领域.
    expect(screen.getByText('周报.eml')).toBeTruthy()
    expect(screen.getByText('健康')).toBeTruthy()
  })

  it('switches workspace tabs and reports the selected path', () => {
    const onSelect = vi.fn()
    render(
      <Workbench intake={intake} workspace={workspace} error={null} selection={null} onSelect={onSelect} onRefresh={() => {}} />,
    )
    fireEvent.click(screen.getByText('项目'))
    expect(screen.getByText('dsh 学习')).toBeTruthy()
    fireEvent.click(screen.getByText('dsh 学习'))
    expect(onSelect).toHaveBeenCalledWith('entities/projects/dsh 学习.md')
  })

  it('surfaces a load failure and a refresh action', () => {
    const onRefresh = vi.fn()
    render(
      <Workbench intake={null} workspace={null} error="知识库加载失败" selection={null} onSelect={() => {}} onRefresh={onRefresh} />,
    )
    expect(screen.getByText('知识库加载失败')).toBeTruthy()
    fireEvent.click(screen.getByText('⟳ 刷新'))
    expect(onRefresh).toHaveBeenCalled()
  })
})
