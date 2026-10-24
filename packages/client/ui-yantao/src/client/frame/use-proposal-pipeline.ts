/**
 * The proposal pipeline: applying a confirmed card, reporting what landed, and
 * the 提议 tab's inbox verdicts (2026-10-24 评审 P2-4 拆分).
 *
 * Split out of Frame.tsx verbatim. What stays in the frame is the state the
 * rest of the workbench shares — the task rows, the foot notice, the tree
 * key — and this module owns the one path every card's verdict takes: apply,
 * reload the trees, report the writes (with the undo chip), or report the
 * failure. The inbox's three verdicts live here too because they answer to
 * the same rule: nothing is written except by the human's click, and every
 * settle leaves a line behind.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KbQueuedProposal } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { proposalOfPayload } from '../capability-match.ts'
import { applyProposal, runUndo, type ProposalApplyResult, type ProposalUndo } from '../proposal-apply.ts'
import type { Proposal, ProposalMailRange } from '../proposal.ts'
import {
  remoteMessage, type Archiver, type CapabilityLoader, type EntityArchiver, type EntityCreator,
  type EntityResolver, type FileReader, type FileWriter, type MailDeleter, type MailMarker,
  type MemoryAdder, type MemoryDeleter, type ProposalInboxApplier, type ProposalInboxEnqueuer,
  type ProposalInboxLister, type ProposalInboxResolver, type ProposalInboxUndoer,
  type ResourceDeleter, type SkillRewriteApplier, type TodoLoader, type TodoWriter,
} from '../remote.ts'

/** The foot notice's one door — structurally Frame's `setCapabilityNotice`. */
export type NoticeSink = (update: string | null, options?: {
  readonly severity?: 'info' | 'progress' | 'undo' | 'error'
  readonly action?: { readonly label: string; readonly run: () => void }
}) => void

/** The KB seams the applier binds, plus the frame state the reports touch. */
export interface ProposalPipelineSeams {
  readonly createEntity: EntityCreator
  readonly read: FileReader
  readonly write: FileWriter
  readonly todos: TodoLoader
  readonly writeTodos: TodoWriter
  readonly memoryAdd: MemoryAdder
  readonly archiveEntity: EntityArchiver
  readonly memoryDelete: MemoryDeleter
  readonly deleteResource: ResourceDeleter
  readonly resolveEntity: EntityResolver
  readonly mailDelete?: MailDeleter
  readonly mailArchive?: Archiver
  readonly skillRewriteApply?: SkillRewriteApplier
  readonly mailMarkRead: MailMarker
  readonly proposalInboxList: ProposalInboxLister
  readonly proposalInboxApply: ProposalInboxApplier
  readonly proposalInboxResolve: ProposalInboxResolver
  readonly proposalInboxEnqueue: ProposalInboxEnqueuer
  readonly proposalInboxUndo: ProposalInboxUndoer
  readonly capabilityList: CapabilityLoader
  /** Reload both rails after a write (Frame's tree-key bump). */
  readonly refreshTrees: () => void
  /** Report through the foot notice. */
  readonly notice: NoticeSink
}

/** What the frame renders with. */
export interface ProposalPipeline {
  readonly confirmProposal: (proposal: Proposal, ticked: readonly number[]) => void
  readonly inboxEntries: readonly KbQueuedProposal[]
  readonly inboxLoaded: boolean
  readonly inboxBusyId: string | null
  readonly confirmInboxEntry: (entry: KbQueuedProposal, ticked: readonly number[]) => void
  readonly discardInboxEntry: (entry: KbQueuedProposal) => void
  readonly reenqueueInboxEntry: (entry: KbQueuedProposal) => void
  readonly loadInbox: () => void
  readonly capabilityScopes: readonly string[]
}

/**
 * Run the proposal pipeline.
 * @param seams - see {@link ProposalPipelineSeams}.
 * @returns the confirm path and the inbox's read + verdicts.
 */
export function useProposalPipeline(seams: ProposalPipelineSeams): ProposalPipeline {
  const {
    createEntity, read, write, todos, writeTodos, memoryAdd, archiveEntity, memoryDelete, deleteResource,
    resolveEntity, mailDelete, mailArchive, skillRewriteApply, mailMarkRead,
    proposalInboxList, proposalInboxApply, proposalInboxResolve, proposalInboxEnqueue, proposalInboxUndo,
    capabilityList, refreshTrees, notice,
  } = seams

  // ADR-0021 决定 4: the confirmed proposal lands through the shared applier's
  // direct RPCs — the frame owns the KB seams, the task owns the state machine.
  // ADR-0032 批次③: the card's 记忆 rows go through the same memoryAdd. The
  // three undo-only verbs ride along so the written report can offer 撤销.
  // The mail verbs and the skill writeback ride along too (their absence made
  // inbox-approved 删除/归档/下载 rows skip honestly — the inbox IS their
  // decision surface, so the knives belong here), each only when the host
  // supplied the face.
  const applyConfirmed = useCallback(
    (options: { proposal: Proposal; ticked: readonly number[] }): Promise<ProposalApplyResult> =>
      applyProposal({
        ...options,
        target: {
          createEntity, read, write, todos, writeTodos, memoryAdd, archiveEntity, memoryDelete, deleteResource,
          resolveEntity,
          ...(mailDelete !== undefined ? { deleteMails: mailDelete } : {}),
          ...(mailArchive !== undefined ? { archiveMails: mailArchive } : {}),
          ...(skillRewriteApply !== undefined ? { skillRewrite: skillRewriteApply } : {}),
        },
      }),
    [createEntity, read, write, todos, writeTodos, memoryAdd, archiveEntity, memoryDelete, deleteResource,
      resolveEntity, mailDelete, mailArchive, skillRewriteApply],
  )

  type ConfirmWrittenResult = Omit<ProposalApplyResult, 'undo'> & { undo?: Pick<ProposalUndo, 'irreversible'> }
  const confirmWritten = (result: ConfirmWrittenResult, entryId?: string): void => {
    const text = [...result.written, ...result.skipped].join('；') || '没有写入任何内容。'
    const undo = result.undo
    if (undo === undefined) {
      notice(text, { severity: 'info' })
      return
    }
    const suffix = undo.irreversible.length > 0 ? `（其中 ${undo.irreversible.length} 项不可撤销）` : ''
    notice(text + suffix, {
      severity: 'undo',
      action: {
        label: '撤销',
        run: () => {
          notice(null)
          if (entryId !== undefined) {
            void proposalInboxUndo({ id: entryId }).then(({ failed }) => {
              refreshTrees()
              notice(failed.length === 0 ? '已撤销刚才的写入。' : `撤销失败：${failed.join('；')}`,
                { severity: failed.length === 0 ? 'info' : 'error' })
            }, (failure: unknown) => {
              notice(`撤销失败：${remoteMessage(failure)}`, { severity: 'error' })
            })
            return
          }
          // Card flow only: this branch never runs for an inbox row, whose
          // trail carries no steps — the cast restores the full undo shape.
          void runUndo(undo as ProposalUndo).then(({ failed }) => {
            refreshTrees()
            notice(failed.length === 0 ? '已撤销刚才的写入。' : `撤销失败：${failed.join('；')}`,
              { severity: failed.length === 0 ? 'info' : 'error' })
          })
        },
      },
    })
  }

  const confirmProposal = useCallback((proposal: Proposal, ticked: readonly number[]): void => {
    void applyConfirmed({ proposal, ticked }).then((result) => {
      refreshTrees()
      confirmWritten(result)
    }, (failure: unknown) => {
      notice(`写入失败：${remoteMessage(failure)}`, { severity: 'error' })
    })
  }, [applyConfirmed])

  // ── the 提议 tab and its inbox (ADR-0047) ────────────────────────────────
  // The scheduler's proposals wait here for the human's verdict: 批准
  // applies through the same human-channel seams as every other card and
  // only then settles the row approved; 丢弃 settles it without writing;
  // closing the card decides nothing. The read rides the scheduler's scan
  // (declared below), so a fired run's proposal surfaces without a remount.
  const [inboxEntries, setInboxEntries] = useState<readonly KbQueuedProposal[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)
  const [inboxBusyId, setInboxBusyId] = useState<string | null>(null)

  // ADR-0047 验收修正 2: settling a mail-covering entry moves the mail
  // watermark past the envelope's range — the same "seen and judged" sense
  // the manual panel's confirm/dismiss carries, so the next read never
  // re-offers the batch. A failed cursor move stays silent, exactly like the
  // manual path's: the host answers from its watermark on the next read.
  const moveMailCursor = useCallback((range: ProposalMailRange | undefined): void => {
    if (range === undefined) return
    void mailMarkRead({
      lastReadAt: range.lastReadAt,
      ...(range.firstReadAt !== undefined ? { firstReadAt: range.firstReadAt } : {}),
    }).catch(() => { /* the next read re-derives from the host's watermark */ })
  }, [mailMarkRead])

  const loadInboxTick = useRef(0)
  const loadInbox = useCallback((): void => {
    // Stale-response guard (the schedule-scan and relation-graph effects'
    // pattern): mount, the 30s scan and the post-run refresh overlap, and a
    // slower older answer must not land last over a fresher one.
    const at = ++loadInboxTick.current
    void proposalInboxList().then(
      (result) => {
        if (at !== loadInboxTick.current) return
        setInboxEntries(result.proposals)
        setInboxLoaded(true)
      },
      (failure: unknown) => {
        if (at !== loadInboxTick.current) return
        notice(`提议读取失败：${remoteMessage(failure)}`, { severity: 'error' })
      },
    )
  }, [proposalInboxList])

  // 2026-10-10 分流提示：提议卡里指向已注册能力的 add-memory 行要附一句
  // 「考虑改提技能改写」——能力名清单挂载时读一次即可，读失败只是没提示。
  const [capabilityScopes, setCapabilityScopes] = useState<readonly string[]>([])
  useEffect(() => {
    let gone = false
    void capabilityList().then(
      (result) => {
        if (!gone) setCapabilityScopes(result.capabilities.map(row => row.name))
      },
      () => { /* 提示是装饰，读取失败不值得打扰 */ },
    )
    return () => { gone = true }
  }, [capabilityList])

  useEffect(() => { loadInbox() }, [loadInbox])

  // 重新入队（2026-10-14 丢弃后悔药）：误丢弃的恢复不是撤销旧决策（决策
  // 终态不可改，入库闸门单向），而是把条目内容原样投回队列——新 id、新
  // 时间戳、pending 等待重新裁决；旧的已丢弃条目留在列表里当痕迹。
  const reenqueueInboxEntry = useCallback((entry: KbQueuedProposal): void => {
    setInboxBusyId(entry.id)
    void proposalInboxEnqueue({
      source: entry.source,
      sourceName: entry.sourceName,
      title: entry.title,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
      proposal: entry.proposal,
    }).then(
      (result) => {
        setInboxBusyId(null)
        setInboxEntries(result.proposals)
        notice(`已重新入队提议「${entry.title}」，等待重新裁决。`, { severity: 'info' })
      },
      (failure: unknown) => {
        setInboxBusyId(null)
        notice(`重新入队失败：${remoteMessage(failure)}`, { severity: 'error' })
      },
    )
  }, [proposalInboxEnqueue])

  const discardInboxEntry = useCallback((entry: KbQueuedProposal): void => {
    setInboxBusyId(entry.id)
    void proposalInboxResolve({ id: entry.id, status: 'discarded' }).then(
      (result) => {
        setInboxBusyId(null)
        setInboxEntries(result.proposals)
        // 丢弃也算看过 (the manual dismiss's own sense, ADR-0047 验收修正 2).
        moveMailCursor(proposalOfPayload(entry.proposal)?.mails)
        // 2026-10-23 评审：丢弃和写入都是「可恢复的轻裁决」，恢复动作就该同样
        // 挂在通知条上——此前写入有 90 秒撤销芯片，丢弃只有一句「已丢弃」，
        // 后悔药藏在行尾的「重新入队」里。
        notice(`已丢弃提议「${entry.title}」。`, {
          severity: 'undo',
          action: { label: '重新入队', run: () => { reenqueueInboxEntry(entry) } },
        })
      },
      (failure: unknown) => {
        setInboxBusyId(null)
        notice(`提议处置失败：${remoteMessage(failure)}`, { severity: 'error' })
      },
    )
  }, [proposalInboxResolve, moveMailCursor, reenqueueInboxEntry])

  // 批准: the whole thing is one server RPC now (ADR-0060 决定 7) — the
  // controller binds the KB seams itself, applies, and settles the row in
  // the SAME call, so the client no longer choreographs apply → settle or
  // compensates a failed settle (the server's discard re-push covers that).
  // The result is a three-way verdict: applied (with the settlement status),
  // preflight-blocked (nothing written, the row stays pending — the remedy
  // is a restart, not a re-ask), already-decided (a repeated card callback
  // or double-click — idempotent no-op, the list refreshes to what's stored).
  // Something landed → the covered mails count as processed (ADR-0047
  // 验收修正 2); a zero-write apply leaves the mails unprocessed so the
  // nomination can come again.
  const confirmInboxEntry = useCallback((entry: KbQueuedProposal, ticked: readonly number[]): void => {
    setInboxBusyId(entry.id)
    void proposalInboxApply({ id: entry.id, ticked }).then((outcome) => {
      setInboxBusyId(null)
      if (outcome.kind === 'already-decided') {
        void proposalInboxList().then(list => setInboxEntries(list.proposals))
        notice(`提议「${entry.title}」已被处理过（${outcome.status}），无需重复操作。`, { severity: 'info' })
        return
      }
      if (outcome.kind === 'preflight-blocked') {
        notice(outcome.message, { severity: 'error' })
        return
      }
      const result = outcome.apply
      const proposal = proposalOfPayload(entry.proposal)
      if (proposal !== null && result.perAction.some(row => row.ok)) moveMailCursor(proposal.mails)
      setInboxEntries(outcome.proposals)
      if (outcome.status === 'failed') {
        const detail = result.perAction.filter(row => !row.ok).map(row => row.error).join('；')
        notice(`提议「${entry.title}」零写入，已记为失败：${detail}`, { severity: 'error' })
        return
      }
      refreshTrees()
      confirmWritten(result, entry.id)
    }, (failure: unknown) => {
      setInboxBusyId(null)
      // An apply-level surprise — the row stays pending on disk either way.
      notice(`写入失败：${remoteMessage(failure)}`, { severity: 'error' })
    })
  }, [proposalInboxApply, proposalInboxList, confirmWritten, moveMailCursor])

  return {
    confirmProposal, inboxEntries, inboxLoaded, inboxBusyId,
    confirmInboxEntry, discardInboxEntry, reenqueueInboxEntry, loadInbox, capabilityScopes,
  }
}
