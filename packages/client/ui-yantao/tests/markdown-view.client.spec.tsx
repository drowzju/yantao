// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MarkdownView } from '../src/client/editor/MarkdownView.tsx'

afterEach(() => {
  cleanup()
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

  it('follows a draft it is handed, without loading anything itself', () => {
    const view = render(<MarkdownView content="第一版" />)
    expect(screen.getByText('第一版')).toBeTruthy()
    view.rerender(<MarkdownView content="第二版" />)
    expect(screen.getByText('第二版')).toBeTruthy()
    expect(screen.queryByText('第一版')).toBeNull()
  })
})
