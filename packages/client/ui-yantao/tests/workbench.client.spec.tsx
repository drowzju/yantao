// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { KbTreeSection } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { TreeLoader } from '../src/client/Workbench.tsx'
import { IntakeRail, WorkspaceRail } from '../src/client/Workbench.tsx'
import { Frame } from '../src/client/frame/Frame.tsx'
import { CENTER_MIN, RAIL_COLLAPSED, RAIL_DEFAULT, RAIL_MIN, clampRail, solveColumns } from '../src/client/frame/columns.ts'
import { WorkbenchLayout, createPanelSeat } from '../src/client/frame/layout.ts'

afterEach(() => {
  cleanup()
})

// jsdom implements no ResizeObserver; the frame measures itself with one, so
// the spec installs the same no-op stub upstream specs use.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
  // jsdom lacks pointer capture: emulate per-element so the handles'
  // hasPointerCapture gates pass.
  const captured = new WeakSet<Element>()
  Element.prototype.setPointerCapture = function () { captured.add(this) }
  Element.prototype.releasePointerCapture = function () { captured.delete(this) }
  Element.prototype.hasPointerCapture = function () { return captured.has(this) }
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

describe('solveColumns', () => {
  it('keeps both rails at their preference when the viewport is wide', () => {
    expect(solveColumns(1600, RAIL_DEFAULT, RAIL_DEFAULT)).toEqual({ intake: 280, center: 1040, workspace: 280 })
  })

  it('concedes from the wider rail first, down to RAIL_MIN', () => {
    const cols = solveColumns(1000, 320, 280)
    expect(cols.center).toBeGreaterThanOrEqual(CENTER_MIN - (320 - RAIL_MIN) - (280 - RAIL_MIN) - 1)
    expect(cols.workspace).toBeLessThanOrEqual(320)
    expect(cols.workspace).toBeGreaterThanOrEqual(RAIL_MIN)
  })

  it('renders a collapsed rail as the compact column', () => {
    expect(solveColumns(1600, 0, RAIL_DEFAULT).intake).toBe(RAIL_COLLAPSED)
  })

  it('clamps a dragged width into the rail range', () => {
    expect(clampRail(10)).toBe(RAIL_MIN)
    expect(clampRail(9999)).toBe(420)
  })
})

describe('WorkbenchLayout', () => {
  it('forwards the panel face onto the frame seat', () => {
    const seat = createPanelSeat()
    const toggled = vi.fn()
    const opened = vi.fn()
    const closed = vi.fn()
    seat.toggleIntake = toggled
    seat.openWorkspace = opened
    seat.closeWorkspace = closed
    const layout = new WorkbenchLayout(seat)
    layout.toggleSidebar()
    layout.openDetails()
    layout.closeDetails()
    expect(toggled).toHaveBeenCalledOnce()
    expect(opened).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
  })
})

/** Render the frame with a stub conversation seat. */
function renderFrame(): ReactElement {
  return (
    <Frame
      renderSlot={key => <div data-seat={key}>{key === 'conversation' ? 'middle' : null}</div>}
      panels={createPanelSeat()}
      intake={loader(intake)}
      workspace={loader(workspace)}
    />
  )
}

describe('IntakeRail', () => {
  it('shows the four intake panels and their file rows', async () => {
    render(<IntakeRail collapsed={false} load={loader(intake)} onExpand={() => {}} />)
    for (const label of ['资源', '待办', '会议', '连接']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(await screen.findByText('周报.eml')).toBeTruthy()
  })

  it('collapses to a refresh-and-expand icon column', () => {
    const onExpand = vi.fn()
    render(<IntakeRail collapsed load={loader(intake)} onExpand={onExpand} />)
    expect(screen.queryByText('资源')).toBeNull()
    fireEvent.click(screen.getByTitle('展开输入栏'))
    expect(onExpand).toHaveBeenCalledOnce()
    expect(screen.getByTitle('刷新知识库')).toBeTruthy()
  })

  it('surfaces a load failure and a refresh action', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('知识库加载失败')))
    render(<IntakeRail collapsed={false} load={failing} onExpand={() => {}} />)
    expect(await screen.findByText('知识库加载失败')).toBeTruthy()
    fireEvent.click(screen.getByText('⟳ 刷新'))
    expect(failing).toHaveBeenCalledTimes(2)
  })
})

describe('WorkspaceRail', () => {
  it('switches tabs and keeps the selection inside the rail', async () => {
    render(<WorkspaceRail collapsed={false} load={loader(workspace)} onExpand={() => {}} />)
    for (const label of ['领域', '人物', '项目']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // The rail opens on 领域; switching to 项目 swaps the file rows.
    expect(await screen.findByText('健康')).toBeTruthy()
    fireEvent.click(screen.getByText('项目'))
    expect(await screen.findByText('dsh 学习')).toBeTruthy()
    expect(screen.queryByText('健康')).toBeNull()
  })

  it('collapses to a refresh-and-expand icon column', () => {
    const onExpand = vi.fn()
    render(<WorkspaceRail collapsed load={loader(workspace)} onExpand={onExpand} />)
    expect(screen.queryByText('领域')).toBeNull()
    fireEvent.click(screen.getByTitle('展开工作栏'))
    expect(onExpand).toHaveBeenCalledOnce()
  })
})

describe('Frame', () => {
  it('renders three columns with the host conversation in the middle', async () => {
    render(renderFrame())
    expect(screen.getByText('middle')).toBeTruthy()
    expect(await screen.findByText('资源')).toBeTruthy()
    expect(await screen.findByText('领域')).toBeTruthy()
  })

  /** Drive one handle through a full pointer gesture. */
  function drag(side: 'intake' | 'workspace', from: number, to: number): void {
    const handle = document.querySelector(`[data-rail-handle="${side}"]`)
    expect(handle).not.toBeNull()
    fireEvent.pointerDown(handle!, { clientX: from, pointerId: 1 })
    fireEvent.pointerMove(handle!, { clientX: to, pointerId: 1 })
    fireEvent.pointerUp(handle!, { clientX: to, pointerId: 1 })
  }

  it('keeps both handles reachable after a rail is dragged to its limit', () => {
    const { container } = render(renderFrame())
    const widthOf = (side: 'intake' | 'workspace'): number =>
      Number.parseFloat(
        (container.querySelector(`[data-rail-handle="${side}"]`) as HTMLElement).style.left,
      )

    // Left rail: drag the handle all the way to the left edge, then back out.
    drag('intake', RAIL_DEFAULT, 0)
    expect(widthOf('intake')).toBe(RAIL_MIN)
    expect(container.querySelector('[data-rail-handle="intake"]')).not.toBeNull()
    drag('intake', 0, 100)
    // The rail grows back (the solver may still concede a little to keep the
    // center above its floor) and the handle is still there to grab.
    expect(widthOf('intake')).toBeGreaterThan(RAIL_MIN)

    // Right rail: the handle sits at viewport - width, so dragging right
    // shrinks the rail; it must come back from its minimum too.
    drag('workspace', RAIL_DEFAULT, 9999)
    expect(container.querySelector('[data-rail-handle="workspace"]')).not.toBeNull()
    drag('workspace', 9999, 8000)
    expect(widthOf('workspace')).toBeLessThan(window.innerWidth - RAIL_MIN)
  })
})
