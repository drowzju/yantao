// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConfigDialog } from '../src/client/ConfigDialog.tsx'
import { QuestionDialog } from '../src/client/QuestionDialog.tsx'
import { SessionDetailDrawer } from '../src/client/SessionDetailDrawer.tsx'
import type { ModelsConfigDraft, ModelsConfigSaveResult, ModelsConfigView } from '../src/client/model-config.ts'
import type { SessionDetail } from '../src/client/session-detail.ts'
import type { TaskRow } from '../src/client/task-view.ts'
import { t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
})

vi.stubGlobal('ResizeObserver', class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
})

const VIEW: ModelsConfigView = {
  displayName: '内网模型网关',
  baseURL: 'https://gateway.internal/v1',
  baseDisplayName: '内网模型网关',
  baseBaseURL: 'https://gateway.internal/v1',
  apiKeyEnv: 'MODEL_GATEWAY_API_KEY',
  keyConfigured: true,
  keyWritable: true,
  models: [{ id: 'GLM5.1', name: 'inner-glm5.1' }],
  defaultModel: 'GLM5.1',
  profileRevision: 7,
  defaultRevision: 3,
  rawModels: [{ id: 'GLM5.1', name: 'inner-glm5.1', contextWindow: 131072 }],
}

type Loader = () => Promise<ModelsConfigView>
type Saver = (draft: ModelsConfigDraft) => Promise<ModelsConfigSaveResult>

/**
 * The one modal discipline every overlay shares (2026-10-05 模态纪律收敛):
 * initial focus lands in the dialog, Esc is a first-class exit (guarded while
 * busy), Tab is trapped inside, and the focus returns to whoever held it.
 * ProposalCard carried this alone; these specs pin the converged behaviour
 * across the other three overlays.
 */
describe('模态纪律收敛 (useDialogModal)', () => {
  it('ConfigDialog: Esc closes, and the focus entered the card on mount', async () => {
    const onClose = vi.fn()
    render(<ConfigDialog t={t} load={vi.fn<Loader>().mockResolvedValue(VIEW)} save={vi.fn<Saver>()} onClose={onClose} />)
    const card = await screen.findByRole('dialog')
    expect(document.activeElement).toBe(card)
    fireEvent.keyDown(card.closest('[data-config-backdrop]')!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ConfigDialog: Esc is inert while a save is in flight', async () => {
    const onClose = vi.fn()
    let settle!: (result: ModelsConfigSaveResult) => void
    const save = vi.fn<Saver>().mockReturnValue(new Promise<ModelsConfigSaveResult>((resolve) => { settle = resolve }))
    render(<ConfigDialog t={t} load={vi.fn<Loader>().mockResolvedValue(VIEW)} save={save} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: '保存' }))
    const backdrop = document.querySelector('[data-config-backdrop]')!
    fireEvent.keyDown(backdrop, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    settle({ kind: 'saved' })
  })

  it('QuestionDialog: Esc aborts, and busy holds the exit', () => {
    const onAbort = vi.fn()
    const run = { reason: '需要确认口径', questions: [{ question: '归属哪个项目？', why: '' }] }
    const { rerender } = render(
      <QuestionDialog run={run} onSubmit={() => {}} onAbort={onAbort} t={t} />,
    )
    const card = screen.getByRole('dialog')
    expect(document.activeElement).toBe(card)
    fireEvent.keyDown(card, { key: 'Escape' })
    expect(onAbort).toHaveBeenCalledTimes(1)
    rerender(<QuestionDialog run={run} busy onSubmit={() => {}} onAbort={onAbort} t={t} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('SessionDetailDrawer: Esc closes, focus enters the panel and returns home on unmount', async () => {
    const ROW: TaskRow = {
      id: 'task-1', kind: 'refine', title: '提炼 张三', stage: '完成', detail: null,
      status: 'done', startedAt: 0, endedAt: 1, sessionId: 's-1',
    }
    const DETAIL: SessionDetail = { items: [], usage: null }
    const onClose = vi.fn()
    const holder = document.createElement('button')
    document.body.appendChild(holder)
    holder.focus()
    const { unmount } = render(
      <SessionDetailDrawer row={ROW} load={async () => DETAIL} onClose={onClose} t={t} />,
    )
    const panel = await screen.findByRole('dialog')
    expect(document.activeElement).toBe(panel)
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    expect(document.activeElement).toBe(holder)
    holder.remove()
  })

  it('SessionDetailDrawer: Tab cycles inside the panel instead of escaping it', async () => {
    const ROW: TaskRow = {
      id: 'task-1', kind: 'refine', title: '提炼 张三', stage: '完成', detail: null,
      status: 'done', startedAt: 0, endedAt: 1, sessionId: 's-1',
    }
    const DETAIL: SessionDetail = { items: [], usage: null }
    render(<SessionDetailDrawer row={ROW} load={async () => DETAIL} onClose={() => {}} t={t} />)
    const panel = await screen.findByRole('dialog')
    // The only focusable inside is the ✕ close button; Tab on it wraps back
    // to the first stop instead of slipping beneath the overlay.
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).not.toBe(document.body)
    expect(panel.contains(document.activeElement)).toBe(true)
  })
})
