/**
 * The mail run's wiring, split out of Frame.tsx (2026-10-24 评审 P2-4).
 *
 * The frame still owns the run store's *life* — the 任务 tab mirrors every
 * analysis as a row, so the store must live where the frame can watch it —
 * but the three things that watch it (the row's phase mirror, the fetch's
 * booked row, the cancel path) are one concern and now live together.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KbMailFetchArgs, KbMailFetchResult } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { AnalysisStage } from '../mail-analysis.ts'
import { createMailRun, useMailRun, type MailRunStore } from '../mail-run.ts'
import type { TaskKind, TaskRow, TaskStatus } from '../task-view.ts'
import { remoteMessage, type MailFetcher } from '../remote.ts'

/** The task-row seams the wiring reports through — Frame's own three callbacks. */
export interface MailTaskSeams {
  readonly taskBegin: (kind: TaskKind, title: string, stage: string, target?: string) => string
  readonly taskPatch: (id: string, patch: Partial<Pick<TaskRow, 'stage' | 'detail' | 'status' | 'endedAt' | 'sessionId'>>) => void
  readonly taskEnd: (id: string, status: TaskStatus, stage: string) => void
  readonly taskDrop: (id: string) => void
}

/** What the frame renders with: the store, the booked fetch, the cancel line. */
export interface MailRunWiring {
  readonly mailRun: MailRunStore
  readonly bookedMailFetch: (args: KbMailFetchArgs) => Promise<KbMailFetchResult>
  /** Cancel one mail row: the fetch reader or the analysis, whichever owns the id. */
  readonly cancelMailRow: (rowId: string) => void
}

/**
 * Create the mail run store and mirror its phases onto a 任务 row.
 * @param seams - the task-row callbacks plus the mail fetch face.
 * @returns the store, the booked fetch, and the cancel line.
 */
export function useMailRunWiring(seams: MailTaskSeams & { readonly mailFetch: MailFetcher }): MailRunWiring {
  const { mailFetch, taskBegin, taskPatch, taskEnd, taskDrop } = seams
  // ── the mail run (ADR-0031) ──────────────────────────────────────────────
  // The frame owns the mail run store now: the 任务 tab mirrors every
  // analysis as a row, so the store must live where the frame can watch it.
  // It already outlived the panel; now it outlives the rail's tab strip too.
  const mailRun = useMemo(() => createMailRun(), [])
  const mailState = useMailRun(mailRun)
  // The analysis's row, from `analysing` through the proposal card to the
  // write (or the dismiss) — the store's phase transitions drive it.
  const mailTaskId = useRef<string | null>(null)
  useEffect(() => {
    const stageOf = (stage: AnalysisStage): string =>
      stage === 'session' ? '创建会话' : stage === 'prompt' ? '准备分析' : '分批判定'
    if (mailState.phase === 'analysing') {
      const id = mailTaskId.current ?? taskBegin('mail', `邮件分析（${mailState.mails.length} 封）`, '创建会话', 'mail')
      mailTaskId.current = id
      const progress = mailState.progress
      const detail = progress !== null && progress.done !== undefined && progress.total !== undefined
        ? `已判 ${progress.done}/${progress.total} 封`
        : null
      taskPatch(id, {
        stage: progress === null ? '创建会话' : stageOf(progress.stage),
        ...(detail !== null ? { detail } : {}),
        // Anchor the row's 「详情」 entry once the run's session exists (ADR-0033).
        ...(mailState.sessionId !== null ? { sessionId: mailState.sessionId } : {}),
      })
      return
    }
    if (mailState.phase === 'applying') {
      if (mailTaskId.current !== null) taskPatch(mailTaskId.current, { status: 'running', stage: '正在写入' })
      return
    }
    if (mailTaskId.current === null) return
    const id = mailTaskId.current
    if (mailState.review !== null) {
      // 待确认不是这条行的终点：确认后的写入、或关掉卡片，都是同一行的
      // 后续阶段 —— 所以这里只挂起行，id 必须留着（清了它，确认写入后
      // 的 applying/idle 两拍都会因拿不到 id 而 return，行永远停在待确认）。
      taskPatch(id, { status: 'waiting', stage: '提议待确认' })
      return
    }
    mailTaskId.current = null
    if (mailState.cancelled) taskEnd(id, 'cancelled', '已取消，已完成的判定保留')
    else if (mailState.error !== null) taskEnd(id, 'failed', mailState.error)
    else if (mailState.summary.length > 0) taskEnd(id, 'done', `已写入 ${mailState.summary.length} 项`)
    else taskEnd(id, 'done', '已忽略')
  }, [mailState, taskBegin, taskPatch, taskEnd])

  // The fetch is an execution the workbench started too (ADR-0031 落地注记二):
  // the panel's 读取 buttons go through this wrapper, so the read shows as a
  // row of its own — 「读取邮件」 — with the same cancel line as any
  // capability run: the signal rides the RPC and an abort kills the reader
  // subprocess server-side. Its row is watched by id, not by the analysis's
  // store — the two lifecycles never overlap (the analysis starts from the
  // fetch's result).
  const mailFetchTaskId = useRef<string | null>(null)
  const mailFetchAbort = useRef<AbortController | null>(null)
  const bookedMailFetch = useCallback(async (args: KbMailFetchArgs): Promise<KbMailFetchResult> => {
    const taskId = taskBegin('mail', '读取邮件', '读取中', 'mail')
    mailFetchTaskId.current = taskId
    const aborter = new AbortController()
    mailFetchAbort.current = aborter
    try {
      const result = await mailFetch(args, aborter.signal)
      // An empty read is a no-op (the watermark already covers the range) —
      // it leaves no row behind instead of a done-line that says nothing.
      if (result.messages.length === 0) taskDrop(taskId)
      else taskEnd(taskId, 'done', `已读 ${result.messages.length} 封`)
      return result
    } catch (failure: unknown) {
      if (aborter.signal.aborted) taskEnd(taskId, 'cancelled', '已取消')
      else taskEnd(taskId, 'failed', `失败：${remoteMessage(failure)}`)
      throw failure
    } finally {
      mailFetchTaskId.current = null
      mailFetchAbort.current = null
    }
  }, [mailFetch, taskBegin, taskEnd, taskDrop])

  const cancelMailRow = useCallback((rowId: string): void => {
    if (rowId === mailFetchTaskId.current) {
      mailFetchAbort.current?.abort()
      return
    }
    mailRun.cancel()
  }, [mailRun])

  return { mailRun, bookedMailFetch, cancelMailRow }
}
