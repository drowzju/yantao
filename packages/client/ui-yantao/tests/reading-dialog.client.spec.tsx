// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReadingDialog, bookTitleOf } from '../src/client/ReadingDialog.tsx'
import type { ReadingRun } from '../src/client/reading-flow.ts'

afterEach(() => {
  cleanup()
})

const RUN: ReadingRun = {
  sessionId: 'session-1',
  title: '读书-《三体》 2026-09-11',
  proposal: { domains: ['科幻', '历史'], newDomain: '认知科学' },
}

/** The dialog's faces, all spies. */
function dialogProps(overrides: Partial<Parameters<typeof ReadingDialog>[0]> = {}): Parameters<typeof ReadingDialog>[0] {
  return {
    resourcePath: 'resources/三体.epub',
    createReadingProject: () => Promise.resolve('entities/projects/读书-《三体》.md'),
    extract: () => Promise.resolve({ extractPath: '.yantao/extracts/三体.epub.txt', format: 'epub', chars: 100, cached: false }),
    readBook: () => Promise.resolve(RUN),
    knownAreas: () => Promise.resolve(['科幻']),
    confirmDomains: () => Promise.resolve(),
    onDone: () => {},
    onCancel: () => {},
    ...overrides,
  }
}

describe('bookTitleOf', () => {
  it('strips the extension from the resource\'s file name', () => {
    expect(bookTitleOf('resources/三体.epub')).toBe('三体')
    expect(bookTitleOf('resources/周报 2026.pdf')).toBe('周报 2026')
  })

  it('keeps a name without an extension whole', () => {
    expect(bookTitleOf('resources/读书笔记')).toBe('读书笔记')
  })
})

describe('ReadingDialog', () => {
  it('pre-fills the book title from the file name and offers the read question ticked', () => {
    render(<ReadingDialog {...dialogProps()} />)
    const title = screen.getByLabelText('书名') as HTMLInputElement
    expect(title.value).toBe('三体')
    expect(screen.getByLabelText<HTMLInputElement>('读取书籍内容').checked).toBe(true)
  })

  it('creates the project with the resource as its source, then runs the reading round', async () => {
    const createReadingProject = vi.fn(() => Promise.resolve('entities/projects/读书-《三体》.md'))
    const extract = vi.fn(() => Promise.resolve({ extractPath: 'x', format: 'epub', chars: 1, cached: false }))
    const readBook = vi.fn(() => Promise.resolve(RUN))
    const knownAreas = vi.fn(() => Promise.resolve(['科幻']))
    render(<ReadingDialog {...dialogProps({ createReadingProject, extract, readBook, knownAreas })} />)
    fireEvent.click(screen.getByText('创建'))
    await screen.findByText('读完了一本书')
    expect(createReadingProject).toHaveBeenCalledWith('三体', 'resources/三体.epub')
    expect(extract).toHaveBeenCalledWith('resources/三体.epub')
    expect(knownAreas).toHaveBeenCalledOnce()
    expect(readBook).toHaveBeenCalledOnce()
  })

  it('lands only the project when the read question is unticked', async () => {
    const createReadingProject = vi.fn(() => Promise.resolve('entities/projects/读书-《三体》.md'))
    const extract = vi.fn()
    const readBook = vi.fn()
    const onDone = vi.fn()
    render(<ReadingDialog {...dialogProps({ createReadingProject, extract, readBook, onDone })} />)
    fireEvent.click(screen.getByLabelText('读取书籍内容'))
    fireEvent.click(screen.getByText('创建'))
    await vi.waitFor(() => { expect(onDone).toHaveBeenCalledWith('entities/projects/读书-《三体》.md') })
    expect(extract).not.toHaveBeenCalled()
    expect(readBook).not.toHaveBeenCalled()
  })

  it('keeps the project and shows the remedy when extraction fails', async () => {
    const extract = vi.fn(() => Promise.reject(Object.assign(new Error('抽取文档文本失败。'), { details: { hint: 'pip install pypdf' } })))
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(<ReadingDialog {...dialogProps({ extract, onDone, onCancel })} />)
    fireEvent.click(screen.getByText('创建'))
    expect(await screen.findByText('抽取文档文本失败。')).toBeTruthy()
    expect(screen.getByText('pip install pypdf')).toBeTruthy()
    expect(screen.getByText('读书项目已创建，可以稍后在它里面继续。')).toBeTruthy()
    fireEvent.click(screen.getByText('关闭'))
    expect(onDone).toHaveBeenCalledWith('entities/projects/读书-《三体》.md')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('closes without creating anything on 取消', () => {
    const onCancel = vi.fn()
    render(<ReadingDialog {...dialogProps({ onCancel })} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('refuses an empty book title', () => {
    render(<ReadingDialog {...dialogProps()} />)
    const title = screen.getByLabelText('书名') as HTMLInputElement
    fireEvent.change(title, { target: { value: '  ' } })
    expect(screen.getByText<HTMLButtonElement>('创建').disabled).toBe(true)
  })
})

describe('ReadingProposal', () => {
  it('confirms the ticked domains and the new one, in one call', async () => {
    const confirmDomains = vi.fn(() => Promise.resolve())
    const onDone = vi.fn()
    render(<ReadingDialog {...dialogProps({ confirmDomains, onDone })} />)
    fireEvent.click(screen.getByText('创建'))
    await screen.findByText('读完了一本书')
    fireEvent.click(screen.getByLabelText('科幻'))
    fireEvent.click(screen.getByLabelText('新建领域'))
    fireEvent.click(screen.getByText('确认关联（2）'))
    await vi.waitFor(() => {
      expect(confirmDomains).toHaveBeenCalledWith({
        sessionId: 'session-1',
        projectPath: 'entities/projects/读书-《三体》.md',
        domains: ['科幻'],
        newDomain: '认知科学',
      })
    })
    expect(onDone).toHaveBeenCalledWith('entities/projects/读书-《三体》.md')
  })

  it('skips the linking without touching the project', async () => {
    const confirmDomains = vi.fn()
    const onDone = vi.fn()
    render(<ReadingDialog {...dialogProps({ confirmDomains, onDone })} />)
    fireEvent.click(screen.getByText('创建'))
    await screen.findByText('读完了一本书')
    fireEvent.click(screen.getByText('跳过'))
    expect(confirmDomains).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith('entities/projects/读书-《三体》.md')
  })

  it('starts with nothing ticked: the agent proposes, the human decides', async () => {
    render(<ReadingDialog {...dialogProps()} />)
    fireEvent.click(screen.getByText('创建'))
    await screen.findByText('读完了一本书')
    expect(screen.getByLabelText<HTMLInputElement>('科幻').checked).toBe(false)
    expect(screen.getByText<HTMLButtonElement>('确认关联（0）').disabled).toBe(true)
  })
})
