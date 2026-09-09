import { describe, expect, it, vi } from 'vitest'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { alignWorkspace, type KbWorkspaceFaces } from '../src/client/kb-workspace.ts'

/** One workspace row, with only the fields the alignment pass reads. */
function view(workspaceId: string, path: string): WorkspaceView {
  return {
    workspaceId: workspaceId as WorkspaceId, path, title: path,
    sessionIds: [], createdAt: '', updatedAt: '',
  }
}

/** The pass under test, with the two stubs a test asserts on. */
interface Harness {
  /** The faces the pass consumes. */
  readonly faces: KbWorkspaceFaces
  /** The workspace create spy. */
  readonly create: ReturnType<typeof vi.fn>
  /** The session-start spy. */
  readonly startSession: ReturnType<typeof vi.fn>
  /** Flip the list to its ready phase and notify subscribers. */
  readonly settle: () => void
}

/**
 * Build the pass's faces over a small mutable workspace list.
 * @param options.items - rows the list answers with.
 * @param options.root - the KB root state the loader reports.
 * @param options.pending - start the list unloaded, so the pass has to wait.
 * @returns the harness.
 */
function harness(options: {
  items?: readonly WorkspaceView[]
  root?: { root: string; configured: boolean }
  pending?: boolean
} = {}): Harness {
  const state: { phase: WorkspaceSnapshot['phase']; items: readonly WorkspaceView[] } = {
    phase: options.pending === true ? 'pending' : 'ready',
    items: options.items ?? [],
  }
  let notify: (() => void) | undefined
  const create = vi.fn((input: { path: string }) => Promise.resolve(view('ws-new', input.path)))
  const startSession = vi.fn()
  const workspaces: IWorkspaces = {
    list: {
      getSnapshot: () => ({
        items: state.items, archivedSessionIds: [], state: 'idle', phase: state.phase, error: null,
      }),
      subscribe: (listener: () => void) => {
        notify = listener
        return () => {
          notify = undefined
        }
      },
    },
    create,
    rename: () => Promise.reject(new Error('unused')),
    delete: () => Promise.resolve(),
    insertBefore: () => Promise.resolve(),
    archiveSession: () => Promise.resolve(),
    insertSessionBefore: () => Promise.reject(new Error('unused')),
  }
  return {
    create,
    startSession,
    settle: () => {
      state.phase = 'ready'
      notify?.()
    },
    faces: {
      root: () => Promise.resolve(options.root ?? { root: '/kb', configured: true }),
      workspaces,
      startSession,
    },
  }
}

describe('alignWorkspace', () => {
  it('registers the KB root and starts its session', async () => {
    const test = harness()
    expect(await alignWorkspace(test.faces)).toBe('/kb')
    expect(test.create).toHaveBeenCalledWith({ path: '/kb' })
    expect(test.startSession).toHaveBeenCalledWith('ws-new' as WorkspaceId)
  })

  it('reuses an already registered root instead of creating a second one', async () => {
    const test = harness({ items: [view('ws-old', '/kb')] })
    await alignWorkspace(test.faces)
    expect(test.create).not.toHaveBeenCalled()
    expect(test.startSession).toHaveBeenCalledWith('ws-old' as WorkspaceId)
  })

  it('does nothing while the KB root is unset — the first-run overlay owns that', async () => {
    const test = harness({ root: { root: '', configured: false } })
    expect(await alignWorkspace(test.faces)).toBeNull()
    expect(test.create).not.toHaveBeenCalled()
    expect(test.startSession).not.toHaveBeenCalled()
  })

  it('waits for the workspace list before reading it', async () => {
    const test = harness({ items: [view('ws-old', '/kb')], pending: true })
    const pending = alignWorkspace(test.faces)
    expect(test.startSession).not.toHaveBeenCalled()
    test.settle()
    await pending
    expect(test.startSession).toHaveBeenCalledWith('ws-old' as WorkspaceId)
    expect(test.create).not.toHaveBeenCalled()
  })
})
