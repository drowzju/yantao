// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KbWorkbenchSnapshot } from '../src/client/service.ts'
import type { KbEditorComponentProps } from '../src/client/contract/slots.ts'
import { zh, type YantaoKbKey } from '../src/client/locales.ts'
import { KbEditor } from '../src/client/KbEditor.tsx'

afterEach(() => {
  cleanup()
})

const t = (key: YantaoKbKey): string => zh[key]

function editorProps(overrides: {
  selection?: string | null
  loadFile?: (path: string) => Promise<string>
  saveFile?: (path: string, content: string) => Promise<void>
}): KbEditorComponentProps {
  const snapshot: KbWorkbenchSnapshot = {
    // `in` keeps an explicit null selection distinct from an unset override.
    selection: 'selection' in overrides ? (overrides.selection ?? null) : 'entities/projects/dsh 学习.md',
    tree: null,
    treeError: null,
  }
  // The framework supplies the session-standard props at runtime; the test
  // doubles only the business shares the component logic reads.
  return {
    useWorkbench: (<S,>(sel: (snapshot: KbWorkbenchSnapshot) => S): S => sel(snapshot)) as never,
    loadFile: overrides.loadFile ?? (() => Promise.resolve('## 状态\n\n\n## 流水\n\n- 2026-09-05 创建 demo\n')),
    saveFile: overrides.saveFile ?? (() => Promise.resolve()),
    t,
  } as KbEditorComponentProps
}

describe('KbEditor', () => {
  it('loads the selected file, tracks dirty, and saves the draft', async () => {
    const saveFile = vi.fn((_: string, __: string) => Promise.resolve())
    render(<KbEditor {...editorProps({ saveFile })} />)

    const textarea = await screen.findByDisplayValue(/创建 demo/)
    expect(screen.getByText('已保存')).toBeTruthy()

    fireEvent.change(textarea, { target: { value: '## 状态\n\n进行中\n\n## 流水\n\n- 2026-09-05 创建 demo\n' } })
    expect(screen.getByText('未保存')).toBeTruthy()

    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => { expect(screen.getByText('已保存')).toBeTruthy() })
    expect(saveFile).toHaveBeenCalledTimes(1)
    expect(saveFile).toHaveBeenCalledWith(
      'entities/projects/dsh 学习.md',
      '## 状态\n\n进行中\n\n## 流水\n\n- 2026-09-05 创建 demo\n',
    )
  })

  it('renders the empty placeholder without a selection', () => {
    render(<KbEditor {...editorProps({ selection: null })} />)
    expect(screen.getByText(zh['editor.empty'])).toBeTruthy()
  })

  it('marks resources originals read-only and hides save', async () => {
    render(<KbEditor {...editorProps({ selection: 'resources/周报.eml' })} />)
    await screen.findByDisplayValue(/创建 demo/)
    expect(screen.getByText(zh['editor.readonly'])).toBeTruthy()
    expect(screen.queryByText('保存')).toBeNull()
    const textarea = screen.getByDisplayValue(/创建 demo/) as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)
  })
})
