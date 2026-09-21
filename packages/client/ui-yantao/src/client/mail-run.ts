/**
 * The mail panel's run state, held *outside* the panel (ADR-0019's three-beat
 * interaction, unchanged — only its memory moves).
 *
 * Everything {@link MailPanel} used to keep in component state — the batch on
 * screen, the phase, the per-mail verdicts, the proposal card — lives here in
 * a module-shaped store instead, because component state dies with the
 * component: switching rail tab, picking another capability, or collapsing the
 * rail all unmount the panel, and an analysis that took ten minutes would
 * vanish from view the moment the human looked elsewhere. The analysis itself
 * keeps running in the host either way; this store is what lets the panel
 * find it again when it comes back.
 *
 * Deliberately *not* persisted: a refresh resets it (the watermark and the
 * named session survive in the KB, so nothing is lost — the worst case is
 * re-reading a batch that was never cursor-moved).
 *
 * The desktop shell attaches a `window.yantao.notify` bridge (preload +
 * IPC); when the window is hidden in the tray, the store announces a finished
 * or failed analysis through it, because a run that ends unseen is a run the
 * human never collects.
 * @module @deepseek-ai/dsh-client-ui-yantao/mail-run
 */
import { useSyncExternalStore } from 'react'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { MailFetcher, MailMarker } from './remote.ts'
import type { AnalysisProgress, MailAnalyser, MailVerdict } from './mail-analysis.ts'
import type { MailEntities } from './mail-apply.ts'
import type { ProposalTarget } from './proposal-apply.ts'
import { applyProposal } from './proposal-apply.ts'
import type { Proposal } from './proposal.ts'
import { analysisToProposal } from './proposal.ts'

/** The processed-mail range the capability's persisted state carries. */
export interface MailProcessedRange {
  /** The oldest mail ever processed, when known. */
  readonly firstReadAt?: string
  /** The newest mail processed so far (the watermark), when known. */
  readonly lastReadAt?: string
}

/** What the run is doing — the one word the panel's buttons and lines agree on. */
export type MailPhase = 'idle' | 'fetching' | 'analysing' | 'applying'

/** Which way a read steps the window: back into older mail, or forward into newer. */
export type MailDirection = 'older' | 'newer'

/** The store's whole state — what the panel renders, and nothing else. */
export interface MailRunState {
  /** The batch on screen, newest first. */
  readonly mails: readonly KbMailMessage[]
  /** Whether the host warned that the gap since the last read is long. */
  readonly stale: boolean
  /** Whether newer mail exists beyond this batch. */
  readonly hasMore: boolean
  /** The read's answer about where the window ends, for the staleness line. */
  readonly lastReadAt?: string
  /**
   * The processed range as the run last advanced it. `undefined` until a
   * cursor move lands: before that the panel shows the capability's own
   * persisted state, which is the fresher authority early on.
   */
  readonly range?: MailProcessedRange
  readonly phase: MailPhase
  readonly error: string | null
  readonly hint: string | null
  /** The proposal card waiting for the human, when one is open. */
  readonly review: Proposal | null
  /** What the last confirmed write reported, line by line. */
  readonly summary: readonly string[]
  readonly progress: AnalysisProgress | null
  /** Per-mail verdicts as the chunks land: mail number (1-based) → its judgement. */
  readonly verdicts: ReadonlyMap<number, MailVerdict>
  /** When the current analysis began, for the seconds counter across remounts. */
  readonly startedAt: number | null
  /**
   * Whether the last analysis ended because the human cancelled it (ADR-0031)
   * — the task view's witness, distinct from an error.
   */
  readonly cancelled: boolean
}

/** The seams a run needs — exactly the panel's RPC props, captured once. */
export interface MailRunDeps {
  readonly fetch: MailFetcher
  readonly mark: MailMarker
  readonly analyse: MailAnalyser
  readonly target: ProposalTarget
  readonly entities: () => Promise<MailEntities>
}

/** The store's face: subscribe/get for React, the actions for the panel. */
export interface MailRunStore {
  readonly subscribe: (listener: () => void) => () => void
  readonly get: () => MailRunState
  /** Point the actions at the panel's injected RPCs (safe to call every render). */
  readonly bind: (deps: MailRunDeps) => void
  readonly read: (direction: MailDirection) => Promise<void>
  readonly run: () => Promise<void>
  /** Stop a running analysis: later chunks never start, landed verdicts stay (ADR-0031). */
  readonly cancel: () => void
  readonly confirm: (ticked: readonly number[]) => Promise<void>
  readonly dismiss: () => Promise<void>
}

/** The empty state a fresh store starts from. */
const EMPTY_STATE: MailRunState = {
  mails: [],
  stale: false,
  hasMore: false,
  phase: 'idle',
  error: null,
  hint: null,
  review: null,
  summary: [],
  progress: null,
  verdicts: new Map(),
  startedAt: null,
  cancelled: false,
}

/** How far back one 往前 step reaches. */
const STEP_DAYS = 30

/**
 * An ISO stamp `days` before `from` — the 往前 bound.
 * @param from - the stamp to move back from, when there is one.
 * @param days - how far back to go.
 * @returns the earlier bound.
 */
function earlier(from: string | undefined, days: number): string {
  const parsed = from === undefined ? Number.NaN : Date.parse(from)
  const then = new Date(Number.isNaN(parsed) ? Date.now() : parsed)
  then.setDate(then.getDate() - days)
  return then.toISOString()
}

/**
 * The bounds of the batch one direction button asks for.
 *
 * 往后 is everything newer than the newest mail on screen (the host fills the
 * lower bound from its watermark when nothing is loaded yet); 往前 is the
 * {@link STEP_DAYS} window that ends where the oldest mail on screen begins.
 * @param direction - which way to step.
 * @param mails - the batch on screen, newest first.
 * @returns the `since` / `until` bounds for the read.
 */
function boundsFor(direction: MailDirection, mails: readonly KbMailMessage[]): { since?: string; until?: string } {
  const newest = mails[0]?.receivedAt
  const oldest = mails[mails.length - 1]?.receivedAt
  if (direction === 'newer') return newest === undefined ? {} : { since: newest }
  const until = oldest ?? new Date().toISOString()
  return { since: earlier(until, STEP_DAYS), until }
}

/**
 * A failure's message and, when the host supplied one, its remedy.
 * @param failure - whatever a rejected promise threw.
 * @returns the state patch that shows both.
 */
function failurePatch(failure: unknown): Pick<MailRunState, 'error' | 'hint'> {
  return {
    error: failure instanceof Error ? failure.message : String(failure),
    hint: (failure as { details?: { hint?: string } }).details?.hint ?? null,
  }
}

/** The notify bridge the desktop shell's preload exposes, when it is there. */
declare global {
  interface Window {
    readonly yantao?: {
      readonly notify: (message: { readonly title: string; readonly body: string }) => void
    }
  }
}

/**
 * Announce a settled analysis through the desktop bridge. The shell decides
 * whether that is worth a system notification (it pops one only while the
 * window is hidden); a plain browser without the bridge stays silent.
 * @param message - the notification's title and body.
 */
function notify(message: { title: string; body: string }): void {
  window.yantao?.notify(message)
}

/**
 * Create one store. The workbench creates one per session and hands it to the
 * panel; a panel without one (the tests, any other embedder) creates its own
 * and behaves exactly as it did when the state lived in the component.
 * @returns the store.
 */
export function createMailRun(): MailRunStore {
  let state = EMPTY_STATE
  const listeners = new Set<() => void>()
  let deps: MailRunDeps | undefined
  // The running analysis's abort controller (ADR-0031): a catch that sees its
  // signal tripped knows the run was cancelled, not failed — the verdicts
  // already landed stay in the map, and the watermark never moved.
  const analyseCancel: { controller: AbortController | null } = { controller: null }

  const set = (patch: Partial<MailRunState>): void => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  /** Read one batch in one direction; a failure keeps its message and its remedy. */
  const read = async (direction: MailDirection): Promise<void> => {
    if (deps === undefined) return
    set({ phase: 'fetching', error: null, hint: null, summary: [], verdicts: new Map() })
    try {
      const result = await deps.fetch(boundsFor(direction, state.mails))
      set({
        mails: result.messages,
        stale: result.stale,
        hasMore: result.hasMore,
        lastReadAt: result.lastReadAt ?? result.since,
      })
    } catch (failure: unknown) {
      set(failurePatch(failure))
    } finally {
      set({ phase: 'idle' })
    }
  }

  /** Hand the batch to a session, announce the outcome, and open the review. */
  const run = async (): Promise<void> => {
    if (deps === undefined || state.mails.length === 0) return
    analyseCancel.controller = new AbortController()
    set({
      phase: 'analysing',
      error: null,
      hint: null,
      cancelled: false,
      progress: { stage: 'session' },
      verdicts: new Map(),
      startedAt: Date.now(),
    })
    try {
      const known = await deps.entities()
      const result = await deps.analyse(state.mails, known, (update) => {
        set(update.verdicts !== undefined
          ? { progress: update, verdicts: new Map(update.verdicts.map(verdict => [verdict.mail, verdict])) }
          : { progress: update })
      }, analyseCancel.controller.signal)
      set({ verdicts: new Map(result.analysis.verdicts.map(verdict => [verdict.mail, verdict])) })
      const review = analysisToProposal(result.analysis, known, result.title, state.mails)
      set({ review })
      notify({ title: '邮件分析完成', body: `${result.title}：${review.actions.length} 条提议等你确认` })
    } catch (failure: unknown) {
      // The abort signal is the cancellation witness: only `cancel` trips it,
      // and the finally below has not cleared the controller yet. The human
      // stopped it — not a failure. What landed stays on screen; the cursor
      // is untouched, so a later read re-offers the batch.
      if (analyseCancel.controller.signal.aborted) {
        set({ error: null, hint: null, cancelled: true, summary: ['已取消，已完成的判定保留。'] })
      } else {
        const body = failure instanceof Error ? failure.message : String(failure)
        set({ error: body })
        notify({ title: '邮件分析失败', body })
      }
    } finally {
      analyseCancel.controller = null
      set({ phase: 'idle', progress: null, startedAt: null })
    }
  }

  /** Stop the running analysis (ADR-0031): the in-flight chunk dies, the rest never start. */
  const cancel = (): void => {
    if (state.phase !== 'analysing' || analyseCancel.controller === null) return
    analyseCancel.controller.abort()
  }

  /**
   * Move the cursor past `batch`: the newest mail becomes the watermark, the
   * oldest extends the processed range's start backward. The batch is passed
   * in because {@link confirm} clears it before calling — the cursor must
   * still move to where the batch *was*.
   */
  const moveCursor = async (batch: readonly KbMailMessage[]): Promise<void> => {
    if (deps === undefined) return
    const oldest = batch[batch.length - 1]?.receivedAt
    try {
      const answer = await deps.mark({
        lastReadAt: batch[0]?.receivedAt ?? new Date().toISOString(),
        ...(oldest !== undefined ? { firstReadAt: oldest } : {}),
      })
      const firstReadAt = answer.firstReadAt !== undefined ? answer.firstReadAt : state.range?.firstReadAt
      set({
        range: {
          ...(firstReadAt !== undefined ? { firstReadAt } : {}),
          lastReadAt: answer.lastReadAt,
        },
      })
    } catch {
      // The verdict is already dealt with; a failed cursor move surfaces on
      // the next read (the host answers from its watermark), not here.
    }
  }

  /** Write what was ticked, then move the cursor: the mails count as read. */
  const confirm = async (ticked: readonly number[]): Promise<void> => {
    if (deps === undefined || state.review === null) return
    const batch = state.mails
    set({ phase: 'applying' })
    try {
      const result = await applyProposal({ proposal: state.review, ticked, target: deps.target })
      set({ summary: [...result.written, ...result.skipped], review: null, mails: [] })
    } catch (failure: unknown) {
      set(failurePatch(failure))
    } finally {
      set({ phase: 'idle' })
    }
    await moveCursor(batch)
  }

  /** Close the window without writing; the mails still count as read. */
  const dismiss = async (): Promise<void> => {
    set({ review: null })
    await moveCursor(state.mails)
  }

  return {
    subscribe,
    get: () => state,
    bind: (next) => { deps = next },
    read,
    run,
    cancel,
    confirm,
    dismiss,
  }
}

/** The panel's view of its store: a subscription that survives remounts. */
export function useMailRun(store: MailRunStore): MailRunState {
  return useSyncExternalStore(store.subscribe, store.get)
}
