// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { KbTodoItem, KbWriteTodosArgs, KbWriteTodosResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { TodoBoard, type TodoBoardProps } from '../src/client/TodoBoard.tsx'

afterEach(() => {
  cleanup()
})

const PATH = 'entities/todos.md'

const TEXT = '- [ ] [due::2026-12-31] 有期限\n- [ ] 没期限\n- [x] [done::2026-09-09] 已完成\n'

const ITEMS: readonly KbTodoItem[] = [
  { done: false, title: '有期限', due: '2026-12-31', body: '', extra: [] },
  { done: false, title: '没期限', body: '', extra: [] },
  { done: true, title: '已完成', doneOn: '2026-09-09', body: '', extra: [] },
]

/**
 * Today plus or minus `offset` days, as a YYYY-MM-DD stamp — deadlines are
 * compared against the real today, so a fixture has to move with it.
 */
function day(offset: number): string {
  const now = new Date()
  now.setDate(now.getDate() + offset)
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/** The board's props, with spies standing in for the two RPCs. */
function props(overrides: Partial<TodoBoardProps> = {}): TodoBoardProps {
  return {
    load: () => Promise.resolve({ path: PATH, text: TEXT, items: ITEMS }),
    write: () => Promise.resolve({ path: PATH, text: TEXT }),
    refreshKey: 0,
    onOpenFile: () => {},
    ...overrides,
  }
}

/**
 * The board's `write` prop as a spy. Typing it is what lets {@link written}
 * read the last call's arguments without an `any` in between.
 */
type WriteSpy = Mock<(_args: KbWriteTodosArgs) => Promise<KbWriteTodosResult>>

/** The arguments the last write was called with. */
function written(write: WriteSpy): KbWriteTodosArgs {
  const args = write.mock.calls[write.mock.calls.length - 1]?.[0]
  expect(args).toBeTruthy()
  return args as KbWriteTodosArgs
}

describe('TodoBoard', () => {
  it('renders a TODO block above a DONE block', async () => {
    const { container } = render(<TodoBoard {...props()} />)
    // Before the load lands there is nothing to show but the placeholder.
    expect(screen.getByText('载入中…')).toBeTruthy()
    expect(await screen.findByText('有期限')).toBeTruthy()
    expect([...container.querySelectorAll('[data-todo-block]')].map(node => node.textContent))
      .toEqual(['TODO', 'DONE'])
    expect(within(container.querySelector('[data-todo-pane="todo"]') as HTMLElement).getByText('有期限')).toBeTruthy()
    expect(within(container.querySelector('[data-todo-pane="done"]') as HTMLElement).getByText('已完成')).toBeTruthy()
  })

  it('sorts undated items last and marks an overdue deadline red', async () => {
    const { container } = render(<TodoBoard {...props({
      load: () => Promise.resolve({
        path: PATH,
        text: TEXT,
        items: [
          { done: false, title: '没期限', body: '', extra: [] },
          { done: false, title: '有期限', due: day(7), body: '', extra: [] },
          { done: false, title: '已过期', due: day(-1), body: '', extra: [] },
        ],
      }),
    })} />)
    await screen.findByText('已过期')
    const order = [...container.querySelectorAll('[data-todo-row]')].map(node => node.getAttribute('data-todo-row'))
    expect(order).toEqual(['2', '1', '0'])

    const overdue = container.querySelector('[data-todo-row="2"]') as HTMLElement
    expect(overdue.querySelector('[data-overdue="true"]')).not.toBeNull()
    const dated = container.querySelector('[data-todo-row="1"]') as HTMLElement
    expect(dated.querySelector('[data-overdue="true"]')).toBeNull()
  })

  it('moves an item into DONE when its box is checked, stamping today', async () => {
    const write: WriteSpy = vi.fn(() => Promise.resolve({ path: PATH, text: TEXT }))
    const { container } = render(<TodoBoard {...props({ write })} />)
    // The checkbox is found before the click, not inside `act`: a `findBy`
    // awaited inside an outer `act` never sees the load land.
    fireEvent.click(await screen.findByLabelText('有期限'))
    await waitFor(() => { expect(write).toHaveBeenCalledOnce() })
    const { items, expectedText } = written(write)
    expect(expectedText).toBe(TEXT)
    expect(items.map(item => item.done)).toEqual([true, false, true])
    expect(items[0]?.doneOn).toBe(day(0))
    // The board re-renders from what it wrote: the item changed pane.
    await waitFor(() => {
      const pane = container.querySelector('[data-todo-pane="done"]') as HTMLElement
      expect(within(pane).getByText('有期限')).toBeTruthy()
    })
  })

  it('moves an item back into TODO when its box is unchecked, dropping the stamp', async () => {
    const write: WriteSpy = vi.fn(() => Promise.resolve({ path: PATH, text: TEXT }))
    render(<TodoBoard {...props({ write })} />)
    fireEvent.click(await screen.findByLabelText('已完成'))
    await waitFor(() => { expect(write).toHaveBeenCalledOnce() })
    const { items } = written(write)
    expect(items[2]?.done).toBe(false)
    expect(items[2]?.doneOn).toBeUndefined()
  })

  it('sends the text the last write returned as the next expectedText', async () => {
    const next = `${TEXT}\n`
    const write: WriteSpy = vi.fn(() => Promise.resolve({ path: PATH, text: next }))
    const { container } = render(<TodoBoard {...props({ write })} />)
    fireEvent.click(await screen.findByLabelText('有期限'))
    // The item landing in DONE is the same tick that clears `busy`, so it is
    // also the point at which the second click is not swallowed.
    await waitFor(() => {
      const pane = container.querySelector('[data-todo-pane="done"]') as HTMLElement
      expect(within(pane).getByText('有期限')).toBeTruthy()
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText('已完成'))
    })
    await waitFor(() => { expect(write).toHaveBeenCalledTimes(2) })
    expect(written(write).expectedText).toBe(next)
  })

  it('appends a blank item and opens it for editing', async () => {
    render(<TodoBoard {...props()} />)
    fireEvent.click(await screen.findByTitle('新增待办'))
    const editor = screen.getByLabelText('标题') as HTMLInputElement
    expect(editor.value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('截止日期').value).toBe('')
    expect(screen.getByLabelText<HTMLTextAreaElement>('正文').value).toBe('')
  })

  it('drops the blank item again when the editor is cancelled', async () => {
    const write: WriteSpy = vi.fn()
    const { container } = render(<TodoBoard {...props({ write })} />)
    fireEvent.click(await screen.findByTitle('新增待办'))
    fireEvent.click(screen.getByText('取消'))
    expect(write).not.toHaveBeenCalled()
    const pane = container.querySelector('[data-todo-pane="todo"]') as HTMLElement
    expect(pane.querySelectorAll('[data-todo-row]')).toHaveLength(2)
  })

  it('refuses a blank title with the host\'s own message', async () => {
    const write: WriteSpy = vi.fn(() => Promise.reject(new Error('待办标题不能为空')))
    const load = vi.fn(() => Promise.resolve({ path: PATH, text: TEXT, items: ITEMS }))
    render(<TodoBoard {...props({ write, load })} />)
    fireEvent.click(await screen.findByTitle('新增待办'))
    await act(async () => {
      fireEvent.click(screen.getByText('保存'))
    })
    expect(await screen.findByText('待办标题不能为空')).toBeTruthy()
    // The rejected write reloads: the blank item is gone and the file's items
    // are the ones on disk.
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('carries an edited title, deadline, and body into the write', async () => {
    const write: WriteSpy = vi.fn(() => Promise.resolve({ path: PATH, text: TEXT }))
    render(<TodoBoard {...props({ write })} />)
    fireEvent.click(await screen.findByText('没期限'))
    await act(async () => {
      fireEvent.change(screen.getByLabelText('标题'), { target: { value: '改过的标题' } })
      fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-12-31' } })
      fireEvent.change(screen.getByLabelText('正文'), { target: { value: '正文内容' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('保存'))
    })
    expect(written(write).items[1]).toEqual({
      done: false,
      title: '改过的标题',
      due: '2026-12-31',
      body: '正文内容',
      extra: [],
    })
    expect(screen.queryByLabelText('标题')).toBeNull()
  })

  it('clears a deadline when the date input is emptied', async () => {
    const write: WriteSpy = vi.fn(() => Promise.resolve({ path: PATH, text: TEXT }))
    render(<TodoBoard {...props({ write })} />)
    fireEvent.click(await screen.findByText('有期限'))
    await act(async () => {
      fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('保存'))
    })
    expect(written(write).items[0]?.due).toBeUndefined()
  })

  it('drops one item through its delete affordance', async () => {
    const write: WriteSpy = vi.fn(() => Promise.resolve({ path: PATH, text: TEXT }))
    render(<TodoBoard {...props({ write })} />)
    await screen.findByText('有期限')
    await act(async () => {
      fireEvent.click(screen.getAllByTitle('删除')[0] as HTMLElement)
    })
    expect(written(write).items.map(item => item.title)).toEqual(['没期限', '已完成'])
  })

  it('opens the singleton in the centre pane through 打开全文', async () => {
    const onOpenFile = vi.fn()
    render(<TodoBoard {...props({ onOpenFile })} />)
    fireEvent.click(await screen.findByText('打开全文'))
    expect(onOpenFile).toHaveBeenCalledWith(PATH)
  })

  it('reloads when the frame bumps its refresh key', async () => {
    const load = vi.fn(() => Promise.resolve({ path: PATH, text: TEXT, items: ITEMS }))
    const { rerender } = render(<TodoBoard {...props({ load })} />)
    await screen.findByText('有期限')
    await act(async () => {
      rerender(<TodoBoard {...props({ load, refreshKey: 1 })} />)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('surfaces a load failure', async () => {
    render(<TodoBoard {...props({ load: () => Promise.reject(new Error('读取待办失败')) })} />)
    expect(await screen.findByText('读取待办失败')).toBeTruthy()
  })
})
