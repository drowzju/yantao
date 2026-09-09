// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MarkdownView } from '../src/client/editor/MarkdownView.tsx'

afterEach(() => {
  cleanup()
})

// jsdom implements no scrolling; the outline's jump is asserted on the stub.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const ENTITY = [
  '---',
  'type: project',
  'relation: peer',
  '---',
  '',
  '## 状态',
  '',
  '进行中',
].join('\n')

describe('MarkdownView', () => {
  it('renders the body as markdown and leaves the envelope out of it', () => {
    const { container } = render(<MarkdownView content={ENTITY} />)
    expect(screen.getByText('状态')).toBeTruthy()
    // The envelope is metadata: it must not reach the rendered document.
    expect(container.textContent).not.toContain('---')
    expect(container.textContent).not.toContain('type: project\n')
  })

  it('folds the envelope into a one-line summary', () => {
    render(<MarkdownView content={ENTITY} />)
    expect(screen.getByText('type: project · relation: peer')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('opens the summary into a table of fields', () => {
    render(<MarkdownView content={ENTITY} />)
    fireEvent.click(screen.getByText('属性'))
    const table = screen.getByRole('table')
    expect(within(table).getByText('type')).toBeTruthy()
    expect(within(table).getByText('project')).toBeTruthy()
    expect(within(table).getByText('relation')).toBeTruthy()
    expect(screen.getByText('收起属性')).toBeTruthy()
  })

  it('offers no envelope bar for a file without one', () => {
    render(<MarkdownView content={['## 状态', '', '进行中'].join('\n')} />)
    expect(screen.queryByText('属性')).toBeNull()
    expect(screen.getByText('状态')).toBeTruthy()
  })

  it('renders a task list the way the file writes it', () => {
    render(<MarkdownView content={['- [ ] 未做', '- [x] 已做'].join('\n')} />)
    expect(screen.getByText('未做')).toBeTruthy()
    expect(screen.getByText('已做')).toBeTruthy()
  })

  it('re-enables the task checkboxes so a click can reach it', () => {
    const { container } = render(<MarkdownView content={['- [ ] 未做'].join('\n')} />)
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.disabled).toBe(false)
  })

  it('flips a checkbox by handing the whole new content to its caller', () => {
    const onEdit = vi.fn()
    const content = ['---', 'type: todo', '---', '', '- [ ] 未做', '- [x] 已做'].join('\n')
    const { container } = render(<MarkdownView content={content} onEdit={onEdit} />)
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    fireEvent.click(boxes[1] as HTMLInputElement)
    expect(onEdit).toHaveBeenCalledWith(
      ['---', 'type: todo', '---', '', '- [ ] 未做', '- [ ] 已做'].join('\n'),
    )
  })

  it('offers no outline for a document with one heading', () => {
    render(<MarkdownView content={['## 只有一个'].join('\n')} />)
    expect(screen.queryByText('大纲')).toBeNull()
  })

  it('opens an outline and jumps to the heading it names', () => {
    const content = ['## 状态', '', 'a', '## 流水', '', 'b', '### 细目'].join('\n')
    const { container } = render(<MarkdownView content={content} />)
    fireEvent.click(screen.getByText('大纲'))
    const outline = container.querySelector('[data-outline="true"]') as HTMLElement
    expect(within(outline).getByText('状态')).toBeTruthy()
    expect(within(outline).getByText('流水')).toBeTruthy()
    expect(within(outline).getByText('细目')).toBeTruthy()

    fireEvent.click(within(outline).getByText('流水'))
    const headings = container.querySelectorAll('h2')
    expect(headings[1]?.scrollIntoView).toHaveBeenCalled()
  })

  it('follows a draft it is handed, without loading anything itself', () => {
    const view = render(<MarkdownView content="第一版" />)
    expect(screen.getByText('第一版')).toBeTruthy()
    view.rerender(<MarkdownView content="第二版" />)
    expect(screen.getByText('第二版')).toBeTruthy()
    expect(screen.queryByText('第一版')).toBeNull()
  })
})
