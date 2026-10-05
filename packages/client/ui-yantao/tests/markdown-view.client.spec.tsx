// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MarkdownView } from '../src/client/editor/MarkdownView.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

// jsdom implements no scrolling; the outline's jump is asserted on the stub.
// It lives on the prototype, so holding the mock beats reading it back off an
// element — which lint reads as an unbound method reference.
let scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
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
    const { container } = render(<MarkdownView content={ENTITY} t={t} />)
    expect(screen.getByText('状态')).toBeTruthy()
    // The envelope is metadata: it must not reach the rendered document.
    expect(container.textContent).not.toContain('---')
    expect(container.textContent).not.toContain('type: project\n')
  })

  it('folds the envelope into a one-line summary', () => {
    render(<MarkdownView content={ENTITY} t={t} />)
    expect(screen.getByText('type: project · relation: peer')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('opens the summary into a table of fields', () => {
    render(<MarkdownView content={ENTITY} t={t} />)
    fireEvent.click(screen.getByText('属性'))
    const table = screen.getByRole('table')
    expect(within(table).getByText('type')).toBeTruthy()
    expect(within(table).getByText('project')).toBeTruthy()
    expect(within(table).getByText('relation')).toBeTruthy()
    expect(screen.getByText('收起属性')).toBeTruthy()
  })

  it('offers no envelope bar for a file without one', () => {
    render(<MarkdownView content={['## 状态', '', '进行中'].join('\n')} t={t} />)
    expect(screen.queryByText('属性')).toBeNull()
    expect(screen.getByText('状态')).toBeTruthy()
  })

  it('renders a task list the way the file writes it', () => {
    render(<MarkdownView content={['- [ ] 未做', '- [x] 已做'].join('\n')} t={t} />)
    expect(screen.getByText('未做')).toBeTruthy()
    expect(screen.getByText('已做')).toBeTruthy()
  })

  it('re-enables the task checkboxes so a click can reach it', () => {
    const { container } = render(<MarkdownView content={['- [ ] 未做'].join('\n')} t={t} />)
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.disabled).toBe(false)
  })

  it('flips a checkbox by handing the whole new content to its caller', () => {
    const onEdit = vi.fn()
    const content = ['---', 'type: todo', '---', '', '- [ ] 未做', '- [x] 已做'].join('\n')
    const { container } = render(<MarkdownView content={content} onEdit={onEdit} t={t} />)
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    fireEvent.click(boxes[1] as HTMLInputElement)
    expect(onEdit).toHaveBeenCalledWith(
      ['---', 'type: todo', '---', '', '- [ ] 未做', '- [ ] 已做'].join('\n'),
    )
  })

  it('offers no outline for a document with one heading', () => {
    render(<MarkdownView content={['## 只有一个'].join('\n')} t={t} />)
    expect(screen.queryByText('大纲')).toBeNull()
  })

  it('opens an outline and jumps to the heading it names', () => {
    // Every heading carries a body line: an empty one would collapse to a
    // placeholder (design.md §1) and rightly leave the outline.
    const content = ['## 状态', '', 'a', '## 流水', '', 'b', '### 细目', '', 'c'].join('\n')
    const { container } = render(<MarkdownView content={content} t={t} />)
    fireEvent.click(screen.getByText('大纲'))
    const outline = container.querySelector('[data-outline="true"]') as HTMLElement
    expect(within(outline).getByText('状态')).toBeTruthy()
    expect(within(outline).getByText('流水')).toBeTruthy()
    expect(within(outline).getByText('细目')).toBeTruthy()

    fireEvent.click(within(outline).getByText('流水'))
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('follows a draft it is handed, without loading anything itself', () => {
    const view = render(<MarkdownView content="第一版"  t={t} />)
    expect(screen.getByText('第一版')).toBeTruthy()
    view.rerender(<MarkdownView content="第二版"  t={t} />)
    expect(screen.getByText('第二版')).toBeTruthy()
    expect(screen.queryByText('第一版')).toBeNull()
  })

  it('renders an exported cell\'s <br> breaks as real newlines (钉钉知识库)', () => {
    const content = [
      '| 事项 | 当前进展 |',
      '|------|---------|',
      '| 汇报 | [日期]<br>06 期已发出<br>[日期]<br>05 期已发 |',
    ].join('\n')
    const { container } = render(<MarkdownView content={content} t={t} />)
    const cell = container.querySelector('td:nth-child(2)')
    // The synthesized `&#10;` decodes through the mdast pipeline into a real
    // newline; the view's pre-wrap cells paint it as a line break.
    expect(cell?.textContent).toBe('[日期]\n06 期已发出\n[日期]\n05 期已发')
  })

  it('fetches a local image reference and points the rendered img at its object URL (ADR-0048 一期)', async () => {
    // jsdom ships no object-URL factory; the stub stands in for one.
    const mimes: string[] = []
    // oxlint-disable-next-line typescript/unbound-method -- restore slots, not calls
    const createObjectURL = URL.createObjectURL
    // oxlint-disable-next-line typescript/unbound-method -- restore slots, not calls
    const revokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn((blob: Blob) => `blob:test-${mimes.length}-${(blob).type}`)
    URL.revokeObjectURL = vi.fn()
    const resolveImage = vi.fn(() => Promise.resolve({ path: 'notes/_assets/a.png', mime: 'image/png', base64: 'aGVsbG8=', size: 5 }))
    const content = ['---', 'type: note', '---', '', '![示意图](_assets/a.png)'].join('\n')
    try {
      const { container } = render(
        <MarkdownView content={content} t={t} path="notes/todo.md" resolveImage={resolveImage} />,
      )
      // Wait on the src, not the element: the img exists before the fetch lands.
      await waitFor(() =>{  expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:test-0-image/png') })
      expect(resolveImage).toHaveBeenCalledWith('notes/_assets/a.png')
    } finally {
      URL.createObjectURL = createObjectURL
      URL.revokeObjectURL = revokeObjectURL
    }
  })

  it('never fetches when no path or resolver is supplied', () => {
    const { container } = render(<MarkdownView content="![图](_assets/a.png)" t={t} />)
    expect(container.querySelector('img[src]')).toBeNull()
  })
})
