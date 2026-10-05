// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { KbQueuedProposal } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { InboxPane } from '../src/client/frame/InboxPane.tsx'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

const ACTIONS = { actions: [{ kind: 'add-todo', title: '发周报', reason: '每周五前' }] }

function entry(overrides: Partial<KbQueuedProposal> = {}): KbQueuedProposal {
  return {
    id: 'prp_1',
    createdAt: '2026-10-05T08:00:00.000Z',
    source: 'schedule:sch_1',
    sourceName: '每日摘要',
    title: '调度「每日摘要」的提议',
    proposal: { title: '调度「每日摘要」的提议', ...ACTIONS },
    status: 'pending',
    ...overrides,
  }
}

function renderPane(entries: readonly KbQueuedProposal[], overrides: {
  onConfirm?: (entry: KbQueuedProposal, ticked: readonly number[]) => void
  onDiscard?: (entry: KbQueuedProposal) => void
} = {}): ReturnType<typeof render> {
  return render(
    <InboxPane
      entries={entries}
      busyId={null}
      onConfirm={overrides.onConfirm ?? (() => {})}
      onDiscard={overrides.onDiscard ?? (() => {})}
      t={t}
    />,
  )
}

describe('InboxPane', () => {
  it('shows the empty state when nothing is queued', () => {
    renderPane([])
    expect(screen.getByText('还没有提议。调度任务产生了待决策的提议时，会出现在这里。')).toBeTruthy()
  })

  it('lists pending rows first, with the decided rows chipped after', () => {
    renderPane([
      entry({ id: 'prp_old', title: '还开着的那条' }),
      entry({ id: 'prp_ok', title: '已批准的那条', status: 'approved', decidedAt: '2026-10-05T09:00:00.000Z' }),
      entry({ id: 'prp_no', title: '已丢弃的那条', status: 'discarded', decidedAt: '2026-10-05T09:30:00.000Z' }),
    ])
    const rows = screen.getAllByText(/的那条$/)
    expect(rows.map(row => row.textContent)).toEqual(['还开着的那条', '已丢弃的那条', '已批准的那条'])
    expect(screen.getByText(/^已批准 \d/)).toBeTruthy()
    expect(screen.getByText(/^已丢弃 \d/)).toBeTruthy()
  })

  it('opens the shared proposal card over a clicked pending row', () => {
    renderPane([entry()])
    fireEvent.click(screen.getByText('调度「每日摘要」的提议'))
    expect(screen.getByText('待办')).toBeTruthy()
    expect(screen.getByText('发周报')).toBeTruthy()
  })

  it('closing the card without approving IS the discard (取消即丢弃，验收修正)', () => {
    const onDiscard = vi.fn<(called: KbQueuedProposal) => void>()
    const { container } = renderPane([entry()], { onDiscard })
    fireEvent.click(screen.getByText('调度「每日摘要」的提议'))
    // 取消 — the ghost that used to only close — now settles discarded.
    // Scoped: the row-level 丢弃 sits behind the modal with the same label.
    fireEvent.click(container.querySelector('[data-inbox-discard="true"]') as HTMLElement)
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onDiscard.mock.calls[0][0].id).toBe('prp_1')
  })

  it('Esc on the card takes the same discard verdict', () => {
    const onDiscard = vi.fn<(called: KbQueuedProposal) => void>()
    const { container } = renderPane([entry()], { onDiscard })
    fireEvent.click(screen.getByText('调度「每日摘要」的提议'))
    fireEvent.keyDown(container.querySelector('[data-proposal-card="true"]') as HTMLElement, { key: 'Escape' })
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('confirms with the ticked row indexes through the frame', () => {
    const onConfirm = vi.fn<(called: KbQueuedProposal, ticked: readonly number[]) => void>()
    renderPane([entry()], { onConfirm })
    fireEvent.click(screen.getByText('调度「每日摘要」的提议'))
    fireEvent.click(screen.getByLabelText('发周报'))
    fireEvent.click(screen.getByText('确认写入（1）'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const [calledEntry, ticked] = onConfirm.mock.calls[0] as readonly [KbQueuedProposal, readonly number[]]
    expect(calledEntry.id).toBe('prp_1')
    expect(ticked).toEqual([0])
  })

  it('discards from the card — the explicit verdict beside the primary confirm', () => {
    const onDiscard = vi.fn<(called: KbQueuedProposal) => void>()
    const { container } = render(<InboxPane
      entries={[entry()]}
      busyId={null}
      onConfirm={() => {}}
      onDiscard={onDiscard}
      t={t}
    />)
    fireEvent.click(screen.getByText('调度「每日摘要」的提议'))
    // The card's own 丢弃 (data-inbox-discard), not the row-level one behind it.
    fireEvent.click(container.querySelector('[data-inbox-discard="true"]') as HTMLElement)
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onDiscard.mock.calls[0][0].id).toBe('prp_1')
  })

  it('offers the row-level 丢弃 without opening the card', () => {
    const onDiscard = vi.fn()
    renderPane([entry()], { onDiscard })
    fireEvent.click(screen.getByText('丢弃'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('degrades an unparsable payload to a discard-only dialog', () => {
    const onDiscard = vi.fn()
    const { container } = render(<InboxPane
      entries={[entry({ proposal: { title: 'x', actions: [{ kind: 'time-travel' }] } })]}
      busyId={null}
      onConfirm={() => {}}
      onDiscard={onDiscard}
      t={t}
    />)
    fireEvent.click(screen.getByText('调度「每日摘要」的提议'))
    expect(screen.getByText('这条提议的内容无法在本工作台解析（可能来自旧版本），只能丢弃。')).toBeTruthy()
    const dialog = container.querySelector('[data-inbox-unparsable="true"]') as HTMLElement
    fireEvent.click(within(dialog).getByText('丢弃'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })
})
