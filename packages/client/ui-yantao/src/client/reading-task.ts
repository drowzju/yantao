/**
 * The reading task's one background slot (ADR-0020).
 *
 * The confirm chain — create the project, extract the book, run the reading
 * round — takes minutes, so it runs here, outside any dialog: the workbench
 * stays usable, a bottom bar reports the stage, and a cancel button aborts
 * the wait. One task at a time: reading is a deliberate act, not a queue.
 *
 * The proposal and the failure still demand the human's eyes, so they surface
 * as states of this slot — the frame renders the proposal window and the
 * monitor bar from the same task value.
 * @module @deepseek-ai/dsh-client-ui-yantao/reading-task
 */
import { useCallback, useRef, useState } from 'react'
import type { ResourceExtractor } from './remote.ts'
import { remoteDetails, remoteMessage } from './remote.ts'
import type { BookReader, DomainConfirmer, ReadingProgress, ReadingRun } from './reading-flow.ts'

/** What a running task is doing — the monitor bar turns it into a line of prose. */
export type ReadingStage = 'creating' | 'extracting' | 'session' | 'prompt' | 'reading' | 'writing'

/** The task's states: working, waiting for the human's verdict, or dead. */
export type ReadingTaskStatus = 'running' | 'proposal' | 'failed'

/** One reading task as the frame sees it. */
export interface ReadingTask {
  /** The book's display name, as the human typed it. */
  readonly bookTitle: string
  /** The resource the project reads, `resources/…`. */
  readonly resourcePath: string
  /** The project's KB-relative path, once creation has landed. */
  readonly projectPath: string | null
  /** Where the task stands. */
  readonly status: ReadingTaskStatus
  /** What a running task is doing right now. */
  readonly stage: ReadingStage
  /** What the model proposed, once the first round has landed. */
  readonly run: ReadingRun | null
  /** Why the task died, when it did. */
  readonly error: string | null
  /** The remedy the host named for that death, when it did. */
  readonly hint: string | null
}

/** The workbench faces the task drives. */
export interface ReadingTaskFaces {
  /** Create the project entity with `source:` set; resolves its path. */
  readonly createReadingProject: (name: string, source: string) => Promise<string>
  /** Extract the book's text into the cache (ADR-0020). */
  readonly extract: ResourceExtractor
  /** Read the 领域 the KB already holds, for the prompt. */
  readonly knownAreas: () => Promise<readonly string[]>
  /** Run the first reading round in a dsh session. */
  readonly readBook: BookReader
  /** Land the confirmed domain links in a second round. */
  readonly confirmDomains: DomainConfirmer
  /** The project exists (and any links landed): open it and reload the tree. */
  readonly onDone: (projectPath: string) => void
}

/** The task slot's face: its current state and the four human controls. */
export interface ReadingTaskSlot {
  /** The current task, or null when the slot is free. */
  readonly task: ReadingTask | null
  /** Start the confirm chain for one resource; ignored while a task runs. */
  readonly start: (resourcePath: string, bookTitle: string, read: boolean, cwd?: string) => void
  /** Land what the human ticked in the proposal. */
  readonly confirm: (domains: readonly string[], newDomain?: string) => void
  /** Dismiss the proposal without linking; the project is kept and opened. */
  readonly skip: () => void
  /** Abort a running task and free the slot. */
  readonly cancel: () => void
  /** Clear a failed task from the slot. */
  readonly dismiss: () => void
}

/**
 * Own the reading task's state machine.
 * @param faces - the workbench faces the task drives; read fresh at each call.
 * @returns the slot.
 */
export function useReadingTask(faces: ReadingTaskFaces): ReadingTaskSlot {
  const [task, setTask] = useState<ReadingTask | null>(null)
  // The faces are fresh closures every render, but the chain below outlives
  // one render — it reads them through this ref instead of freezing them.
  const latest = useRef(faces)
  latest.current = faces
  const current = useRef<ReadingTask | null>(null)
  const abort = useRef<AbortController | null>(null)

  /** Set the state and its mirror in one move. */
  const apply = useCallback((next: ReadingTask | null): void => {
    current.current = next
    setTask(next)
  }, [])

  /** Merge one partial into the live task, if it is still the live one. */
  const patch = useCallback((partial: Partial<ReadingTask>): void => {
    if (current.current === null) return
    apply({ ...current.current, ...partial })
  }, [apply])

  /** One Remote failure rendered for the failed state. */
  const failureOf = useCallback((failure: unknown): Partial<ReadingTask> => ({
    status: 'failed',
    error: remoteMessage(failure),
    hint: remoteDetails(failure)?.hint ?? null,
  }), [])

  const start = useCallback((resourcePath: string, bookTitle: string, read: boolean, cwd?: string): void => {
    if (current.current !== null) return
    const controller = new AbortController()
    abort.current = controller
    const signal = controller.signal
    // Read through a function: oxlint's property narrowing treats a re-read of
    // `signal.aborted` after the first check as always-false, across awaits.
    const aborted = (): boolean => signal.aborted
    apply({
      bookTitle, resourcePath, projectPath: null, status: 'running', stage: 'creating',
      run: null, error: null, hint: null,
    })
    void (async () => {
      try {
        const path = await latest.current.createReadingProject(bookTitle, resourcePath)
        if (aborted()) return
        if (!read) {
          apply(null)
          abort.current = null
          latest.current.onDone(path)
          return
        }
        patch({ projectPath: path, stage: 'extracting' })
        await latest.current.extract(resourcePath)
        if (aborted()) return
        patch({ stage: 'session' })
        const areas = await latest.current.knownAreas()
        if (aborted()) return
        patch({ stage: 'reading' })
        const onProgress = (progress: ReadingProgress): void => {
          patch({ stage: progress.stage })
        }
        const run = await latest.current.readBook({
          bookTitle, projectPath: path, resourcePath, knownAreas: areas, onProgress,
          ...cwd !== undefined ? { cwd } : {},
          ...{ signal },
        })
        if (aborted()) return
        abort.current = null
        patch({ status: 'proposal', run })
      } catch (failure: unknown) {
        if (aborted()) return
        abort.current = null
        patch(failureOf(failure))
      }
    })()
  }, [apply, patch, failureOf])

  const confirm = useCallback((domains: readonly string[], newDomain?: string): void => {
    const live = current.current
    if (live === null || live.run === null || live.projectPath === null) return
    const { run, projectPath } = live
    patch({ status: 'running', stage: 'writing' })
    void latest.current.confirmDomains({
      sessionId: run.sessionId, projectPath, domains,
      ...newDomain !== undefined ? { newDomain } : {},
    }).then(() => {
      apply(null)
      latest.current.onDone(projectPath)
    }, (failure: unknown) => {
      patch(failureOf(failure))
    })
  }, [apply, patch, failureOf])

  const skip = useCallback((): void => {
    const live = current.current
    if (live === null || live.projectPath === null) return
    apply(null)
    latest.current.onDone(live.projectPath)
  }, [apply])

  const cancel = useCallback((): void => {
    abort.current?.abort()
    abort.current = null
    apply(null)
  }, [apply])

  const dismiss = useCallback((): void => {
    apply(null)
  }, [apply])

  return { task, start, confirm, skip, cancel, dismiss }
}
