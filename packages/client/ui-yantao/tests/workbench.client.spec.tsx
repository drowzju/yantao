// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { TreeLoader } from '../src/client/Workbench.tsx'
import { IntakeRail, WorkspaceRail } from '../src/client/Workbench.tsx'

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

/** A loader that resolves with the given sections. */
const loader = (sections: readonly KbTreeSection[]): TreeLoader => () => Promise.resolve(sections)

describe('IntakeRail', () => {
  it('shows the four intake panels and their file rows', async () => {
    render(<IntakeRail collapsed={false} load={loader(intake)} />)
    for (const label of ['资源', '待办', '会议', '连接']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(await screen.findByText('周报.eml')).toBeTruthy()
  })

  it('collapses to a refresh-only icon column', () => {
    render(<IntakeRail collapsed load={loader(intake)} />)
    expect(screen.queryByText('资源')).toBeNull()
    expect(screen.getByTitle('刷新知识库')).toBeTruthy()
  })

  it('surfaces a load failure and a refresh action', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('知识库加载失败')))
    render(<IntakeRail collapsed={false} load={failing} />)
    expect(await screen.findByText('知识库加载失败')).toBeTruthy()
    fireEvent.click(screen.getByText('⟳ 刷新'))
    expect(failing).toHaveBeenCalledTimes(2)
  })
})

describe('WorkspaceRail', () => {
  it('switches tabs and keeps the selection inside the rail', async () => {
    render(<WorkspaceRail load={loader(workspace)} />)
    for (const label of ['领域', '人物', '项目']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // The rail opens on 领域; switching to 项目 swaps the file rows.
    expect(await screen.findByText('健康')).toBeTruthy()
    fireEvent.click(screen.getByText('项目'))
    expect(await screen.findByText('dsh 学习')).toBeTruthy()
    expect(screen.queryByText('健康')).toBeNull()
  })

  it('retracts to a handle and comes back', () => {
    render(<WorkspaceRail load={loader(workspace)} />)
    fireEvent.click(screen.getByTitle('收起工作区'))
    expect(screen.queryByText('领域')).toBeNull()
    fireEvent.click(screen.getByTitle('展开工作区'))
    expect(screen.getByText('领域')).toBeTruthy()
  })
})
