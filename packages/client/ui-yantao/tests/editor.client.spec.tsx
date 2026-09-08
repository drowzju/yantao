// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AUTOSAVE_MS, FileEditor } from '../src/client/editor/FileEditor.tsx'
import { ReadOnlyFile } from '../src/client/editor/ReadOnlyFile.tsx'
import type { SaveStatus } from '../src/client/editor/FileEditor.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
})

/** One entity file, frontmatter included — the editor shows it raw. */
const CONTENT = '---\ntype: area\ncreated: 2026-09-08\n---\n\n## 状态\n\n健康\n'

/** What the server has after somebody else edited the same file. */
const SERVER = '---\ntype: area\ncreated: 2026-09-08\n---\n\n## 状态\n\nagent 写的\n'

/** Let the promises inside `act` settle: an editor load and a save are both async. */
const settle = (): Promise<void> => act(async () => {})

/** Advance the autosave timer inside `act`. */
const tick = (ms: number): Promise<void> => act(async () => {
  vi.advanceTimersByTime(ms)
})

/** Render the editor with spy-backed remote calls. */
function harness(readImpl: () => Promise<string> = () => Promise.resolve(CONTENT)) {
  const read = vi.fn(readImpl)
  const write = vi.fn(() => Promise.resolve())
  const statuses: SaveStatus[] = []
  const view = render(
    <FileEditor
      path="entities/areas/健康.md"
      read={read}
      write={write}
      onStatus={(status) => { statuses.push(status) }}
    />,
  )
  return { read, write, statuses, view }
}

/** The editor's textarea. */
function area(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

describe('FileEditor', () => {
  it('loads the raw file and reports it saved', async () => {
    const { statuses } = harness()
    await settle()
    expect(area().value).toBe(CONTENT)
    expect(statuses).toEqual(['loading', 'saved'])
  })

  it('reports a read failure', async () => {
    harness(() => Promise.reject(new Error('找不到知识库文件')))
    await settle()
    expect(screen.getByText('找不到知识库文件')).toBeTruthy()
  })

  it('autosaves the draft after the debounce, and only once', async () => {
    const { write } = harness()
    await settle()
    fireEvent.change(area(), { target: { value: `${CONTENT}更多` } })
    await tick(AUTOSAVE_MS - 1)
    expect(write).not.toHaveBeenCalled()
    await tick(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('entities/areas/健康.md', `${CONTENT}更多`)
    expect(screen.getByRole('textbox').getAttribute('data-status')).toBe('saved')
  })

  it('restarts the debounce on every keystroke', async () => {
    const { write } = harness()
    await settle()
    fireEvent.change(area(), { target: { value: 'a' } })
    await tick(AUTOSAVE_MS - 1)
    fireEvent.change(area(), { target: { value: 'ab' } })
    await tick(AUTOSAVE_MS - 1)
    expect(write).not.toHaveBeenCalled()
    await tick(1)
    expect(write).toHaveBeenCalledWith('entities/areas/健康.md', 'ab')
  })

  it('saves at once on blur', async () => {
    const { write } = harness()
    await settle()
    fireEvent.change(area(), { target: { value: '失焦保存' } })
    await act(async () => {
      fireEvent.blur(area())
    })
    await settle()
    expect(write).toHaveBeenCalledWith('entities/areas/健康.md', '失焦保存')
  })

  it('skips a save when nothing changed', async () => {
    const { write } = harness()
    await settle()
    await act(async () => {
      fireEvent.blur(area())
    })
    await settle()
    expect(write).not.toHaveBeenCalled()
  })

  it('holds the draft back when the server copy moved, and 覆盖 saves it', async () => {
    let calls = 0
    const { write } = harness(() => {
      calls += 1
      return Promise.resolve(calls === 1 ? CONTENT : SERVER)
    })
    await settle()
    fireEvent.change(area(), { target: { value: '我的版本' } })
    await tick(AUTOSAVE_MS)
    expect(write).not.toHaveBeenCalled()
    expect(screen.getByText('此文件在别处已被修改，未自动保存。')).toBeTruthy()

    // 查看差异 shows both copies side by side.
    fireEvent.click(screen.getByText('查看差异'))
    expect(screen.getByText('我的修改')).toBeTruthy()
    expect(screen.getByText('服务器版本')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('覆盖'))
    })
    await settle()
    expect(write).toHaveBeenCalledWith('entities/areas/健康.md', '我的版本')
    expect(screen.queryByText('此文件在别处已被修改，未自动保存。')).toBeNull()
  })

  it('放弃我的修改 takes the server copy back', async () => {
    let calls = 0
    const { write } = harness(() => {
      calls += 1
      return Promise.resolve(calls === 1 ? CONTENT : SERVER)
    })
    await settle()
    fireEvent.change(area(), { target: { value: '我的版本' } })
    await tick(AUTOSAVE_MS)
    fireEvent.click(screen.getByText('放弃我的修改'))
    expect(area().value).toBe(SERVER)
    expect(screen.queryByText('此文件在别处已被修改，未自动保存。')).toBeNull()

    // The rebased draft is clean, so a later edit saves without a conflict.
    fireEvent.change(area(), { target: { value: `${SERVER}再改` } })
    await tick(AUTOSAVE_MS)
    await settle()
    expect(write).toHaveBeenCalledWith('entities/areas/健康.md', `${SERVER}再改`)
  })

  it('reports a failed save', async () => {
    const read = vi.fn(() => Promise.resolve(CONTENT))
    const write = vi.fn(() => Promise.reject(new Error('磁盘不可写')))
    render(<FileEditor path="entities/areas/健康.md" read={read} write={write} />)
    await settle()
    fireEvent.change(area(), { target: { value: 'x' } })
    await tick(AUTOSAVE_MS)
    await settle()
    expect(screen.getByText('磁盘不可写')).toBeTruthy()
    expect(area().getAttribute('data-status')).toBe('failed')
  })
})

describe('ReadOnlyFile', () => {
  it('shows the file without an editor', async () => {
    render(<ReadOnlyFile path="resources/周报.eml" read={() => Promise.resolve('原始内容')} />)
    await settle()
    expect(screen.getByText('原始内容')).toBeTruthy()
    expect(screen.getByText('只读（原始资源不改写，编辑其影子笔记）')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('reports a read failure', async () => {
    render(<ReadOnlyFile path="resources/周报.eml" read={() => Promise.reject(new Error('读不到'))} />)
    await settle()
    expect(screen.getByText('读不到')).toBeTruthy()
  })
})
