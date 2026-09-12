// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReadingDialog, ReadingMonitor, bookTitleOf } from '../src/client/ReadingDialog.tsx'
import { ReadingProposal } from '../src/client/ReadingProposal.tsx'
import type { ReadingTask } from '../src/client/reading-task.ts'
import type { ReadingRun } from '../src/client/reading-flow.ts'

afterEach(() => {
  cleanup()
})

const RUN: ReadingRun = {
  sessionId: 'session-1',
  title: '读书-《三体》 2026-09-11',
  proposal: { domains: ['科幻', '历史'], newDomain: '认知科学' },
}

/** A task mid-run, for the monitor bar. */
function task(overrides: Partial<ReadingTask> = {}): ReadingTask {
  return {
    bookTitle: '三体',
    resourcePath: 'resources/三体.epub',
    projectPath: 'entities/projects/读书-《三体》.md',
    status: 'running',
    stage: 'reading',
    run: null,
    error: null,
    hint: null,
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
    render(<ReadingDialog resourcePath="resources/三体.epub" onStart={() => {}} onCancel={() => {}} />)
    expect(screen.getByLabelText<HTMLInputElement>('书名').value).toBe('三体')
    expect(screen.getByLabelText<HTMLInputElement>('读取书籍内容').checked).toBe(true)
  })

  it('hands the two choices to the background task and lets the dialog close', () => {
    const onStart = vi.fn()
    render(<ReadingDialog resourcePath="resources/三体.epub" onStart={onStart} onCancel={() => {}} />)
    fireEvent.click(screen.getByText('创建'))
    expect(onStart).toHaveBeenCalledWith('三体', true)
  })

  it('hands an unticked read question through', () => {
    const onStart = vi.fn()
    render(<ReadingDialog resourcePath="resources/三体.epub" onStart={onStart} onCancel={() => {}} />)
    fireEvent.click(screen.getByLabelText('读取书籍内容'))
    fireEvent.click(screen.getByText('创建'))
    expect(onStart).toHaveBeenCalledWith('三体', false)
  })

  it('refuses an empty book title', () => {
    render(<ReadingDialog resourcePath="resources/三体.epub" onStart={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>('书名'), { target: { value: '  ' } })
    expect(screen.getByText<HTMLButtonElement>('创建').disabled).toBe(true)
  })

  it('refuses to start while another reading task runs', () => {
    render(<ReadingDialog resourcePath="resources/三体.epub" onStart={() => {}} onCancel={() => {}} disabled />)
    expect(screen.getByText<HTMLButtonElement>('创建').disabled).toBe(true)
  })

  it('closes without creating anything on 取消', () => {
    const onCancel = vi.fn()
    render(<ReadingDialog resourcePath="resources/三体.epub" onStart={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('ReadingMonitor', () => {
  it('shows the running stage and offers the cancel button', () => {
    const onCancel = vi.fn()
    render(<ReadingMonitor task={task()} onCancel={onCancel} onDismiss={() => {}} onOpen={() => {}} />)
    expect(screen.getByText('模型正在读书…（抽样阅读，几分钟内完成）')).toBeTruthy()
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows the failure with the remedy and the session to look into', () => {
    const onDismiss = vi.fn()
    render(<ReadingMonitor
      task={task({ status: 'failed', error: '模型没有返回可解析的 JSON。', hint: 'pip install pypdf', run: null })}
      onCancel={() => {}}
      onDismiss={onDismiss}
      onOpen={() => {}}
    />)
    expect(screen.getByText('模型没有返回可解析的 JSON。')).toBeTruthy()
    expect(screen.getByText('pip install pypdf')).toBeTruthy()
    expect(screen.getByText(/会话「读书-《三体》/)).toBeTruthy()
    fireEvent.click(screen.getByText('关闭'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('opens the project a failed task kept', () => {
    const onOpen = vi.fn()
    render(<ReadingMonitor
      task={task({ status: 'failed', error: '抽取文档文本失败。', run: null })}
      onCancel={() => {}}
      onDismiss={() => {}}
      onOpen={onOpen}
    />)
    fireEvent.click(screen.getByText('打开项目'))
    expect(onOpen).toHaveBeenCalledWith('entities/projects/读书-《三体》.md')
  })
})

describe('ReadingProposal', () => {
  it('confirms the ticked domains and the new one, in one call', () => {
    const onConfirm = vi.fn()
    render(<ReadingProposal proposal={RUN.proposal} onConfirm={onConfirm} onDismiss={() => {}} />)
    fireEvent.click(screen.getByLabelText('科幻'))
    fireEvent.click(screen.getByLabelText('新建领域'))
    fireEvent.click(screen.getByText('确认关联（2）'))
    expect(onConfirm).toHaveBeenCalledWith(['科幻'], '认知科学')
  })

  it('skips the linking without touching the project', () => {
    const onConfirm = vi.fn()
    const onDismiss = vi.fn()
    render(<ReadingProposal proposal={RUN.proposal} onConfirm={onConfirm} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('跳过'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('starts with nothing ticked: the agent proposes, the human decides', () => {
    render(<ReadingProposal proposal={RUN.proposal} onConfirm={() => {}} onDismiss={() => {}} />)
    expect(screen.getByLabelText<HTMLInputElement>('科幻').checked).toBe(false)
    expect(screen.getByText<HTMLButtonElement>('确认关联（0）').disabled).toBe(true)
  })

  it('holds its buttons while the second round writes', () => {
    render(<ReadingProposal proposal={RUN.proposal} onConfirm={() => {}} onDismiss={() => {}} busy />)
    expect(screen.getByText<HTMLButtonElement>('确认关联（0）').disabled).toBe(true)
    expect(screen.getByText<HTMLButtonElement>('跳过').disabled).toBe(true)
  })
})
