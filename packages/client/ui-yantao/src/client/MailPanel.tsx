/**
 * The mail capability's detail inside the 能力 tab (ADR-0019, ADR-0021).
 *
 * Three beats, in order — 往前 / 往后 reads one window of Outlook through the
 * host's Python/COM subprocess, where the two buttons step the window back and
 * forward in time; 分析 hands the batch to a dsh session and reports which
 * stage the run has reached, because the wait is the slow part; and the
 * the verdict comes back into {@link ProposalCard}, where nothing is written
 * until the human confirms. The cursor only moves once a verdict has been
 * dealt with, so a failed analysis leaves the mails unread rather than lost.
 *
 * The panel is a pure view: the run's state lives in a {@link MailRunStore},
 * handed down by the workbench so it survives the panel's unmount (switching
 * tab, another capability, a collapsed rail). Without one, the panel makes its
 * own and behaves as it always did.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import { isDuplicateMemory, remoteMessage, type MailFetcher, type MailMarker, type MemoryAdder } from './remote.ts'
import type { AnalysisStage, MailAnalyser, MailImportance } from './mail-analysis.ts'
import { createMailRun, useMailRun, type MailProcessedRange, type MailRunStore } from './mail-run.ts'
import { groupThreads, rollupImportance, THREAD_COLLAPSE_MIN } from './mail-threads.ts'
import type { MailEntities } from './mail-apply.ts'
import type { ProposalTarget } from './proposal-apply.ts'
import { ProposalCard } from './ProposalCard.tsx'
import type { WorkbenchLocaleKey, WorkbenchT } from './locales.ts'

export type { MailProcessedRange } from './mail-run.ts'

/** What the panel does with the Remote surface and the KB. */
export interface MailPanelProps {
  /** The workbench translate face. */
  readonly t: WorkbenchT
  /** Read the newest mails after the connector's cursor. */
  readonly fetch: MailFetcher
  /** Move that cursor forward. */
  readonly mark: MailMarker
  /** Run one analysis over a batch, reporting the stage it has reached. */
  readonly analyse: MailAnalyser
  /** The KB seams the confirmed writes go through. */
  readonly target: ProposalTarget
  /** Read what the KB already holds, for the prompt and for the writes. */
  readonly entities: () => Promise<MailEntities>
  /** The processed range so far, from the capability's persisted state. */
  readonly processed?: MailProcessedRange
  /**
   * The run state to render, when the workbench owns one that outlives this
   * panel; absent, the panel keeps its own (which dies with it).
   */
  readonly store?: MailRunStore
  /**
   * Remember one behavior rule (ADR-0032 批次③) — the human-side direct
   * write: a correction spotted while reading the batch goes straight into
   * the `mail` scope, no proposal card (the human is the author). Absent,
   * the row is not offered.
   */
  readonly memoryAdd?: MemoryAdder
}

/**
 * Extract the processed range from a capability's persisted state, tolerating
 * anything a capability run might have left there.
 * @param state - the `state` a `capabilityList` row carries, or `undefined`.
 * @returns the range's known ends, each only when it is a string.
 */
export function mailRangeOf(state: unknown): { firstReadAt?: string; lastReadAt?: string } {
  if (typeof state !== 'object' || state === null) return {}
  const { firstReadAt, lastReadAt } = state as Record<string, unknown>
  return {
    ...(typeof firstReadAt === 'string' ? { firstReadAt } : {}),
    ...(typeof lastReadAt === 'string' ? { lastReadAt } : {}),
  }
}

/** Which each stage of an analysis run says on screen — dictionary keys, translated at render. */
const STAGE_KEYS: Record<AnalysisStage, WorkbenchLocaleKey> = {
  session: 'mail.stage.creatingSession',
  prompt: 'mail.stage.askingModel',
  answer: 'mail.stage.analysing',
}

/** What each importance verdict says on a mail row — dictionary keys, translated at render. */
const IMPORTANCE_KEYS: Record<MailImportance, WorkbenchLocaleKey> = {
  focus: 'mail.importance.key',
  digest: 'mail.importance.digest',
  normal: 'mail.importance.normal',
}

/** How each importance badge is styled: 重点 shouts, 汇总 mumbles, 普通 stays quiet. */
const IMPORTANCE_STYLES: Record<MailImportance, CSSProperties> = {
  focus: { color: 'var(--yt-error)', fontWeight: 600 },
  digest: { color: 'var(--yt-text-muted)' },
  normal: { color: 'var(--yt-text-secondary)' },
}

// 密度放宽（2026-10-05 第三轮评审 #9）：间距吃 space 阶梯、字号吃 type
// 阶梯——之前 4px/6px 的挤压节奏让三个节拍糊成一团。
const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 8, padding: 'var(--yt-space-2) var(--yt-space-3)' } as const

const buttonStyle = { padding: 'var(--yt-space-1) var(--yt-space-2)', minHeight: 'var(--yt-control-min-h)', boxSizing: 'border-box', alignSelf: 'flex-start' } as const

const mutedStyle = { color: 'var(--yt-text-muted)', fontSize: 'var(--yt-type-label)' } as const

const errorStyle = { color: 'var(--yt-error)', fontSize: 'var(--yt-type-label)' } as const

const hintStyle = { color: 'var(--yt-text-secondary)', fontSize: 'var(--yt-type-label)' } as const

const mailListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 240,
  overflow: 'auto',
  fontSize: 'var(--yt-type-label)',
  borderTop: '1px solid var(--yt-border-subtle)',
  borderBottom: '1px solid var(--yt-border-subtle)',
  padding: 'var(--yt-space-1) 0',
} as const

const mailRowStyle = { display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 } as const

const mailBadgeStyle = { flexShrink: 0, fontSize: 'var(--yt-type-label)' } as const

const mailTextMutedStyle = { color: 'var(--yt-text-muted)', whiteSpace: 'nowrap' } as const

const mailSubjectStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const

/** A thread header is a full-width toggle: badge, topic, ×N, and the caret. */
const threadHeadStyle = {
  display: 'flex',
  gap: 6,
  alignItems: 'baseline',
  minWidth: 0,
  width: '100%',
  padding: 'var(--yt-space-1) 0',
  background: 'none',
  border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 'var(--yt-type-label)',
} as const

const threadMemberIndent = { paddingLeft: 14 } as const

/** The date of one ISO stamp, for the line that names the batch on screen. */
function day(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Render the connector panel.
 * @param props - see {@link MailPanelProps}.
 * @returns the panel element.
 */
export function MailPanel({ t, fetch, mark, analyse, target, entities, processed = {}, store, memoryAdd }: MailPanelProps): ReactElement {
  // The store is the workbench's when it hands one down; otherwise this panel
  // keeps its own, exactly as ephemeral as the component state used to be.
  const local = useRef<MailRunStore | null>(null)
  if (local.current === null) local.current = createMailRun()
  const run = store ?? local.current
  run.bind({ fetch, mark, analyse, target, entities })

  const { mails, stale, hasMore, range: movedRange, phase, error, hint, review, summary, progress, verdicts, startedAt } = useMailRun(run)
  // Until the run itself advances the cursor, the capability's persisted
  // state is the fresher authority on the processed range.
  const range = movedRange ?? processed

  // Threads regroup per batch; memoising keeps the second-by-second analysis
  // ticker from re-grouping. Collapse state is explicit per thread key, so it
  // survives both the ticker and the batch's re-renders.
  const threads = useMemo(() => groupThreads(mails), [mails])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // A slow judgement with no feedback reads as a hung one: count the seconds
  // the analysis has been running, next to the stage it has reached. Counting
  // from the run's own start keeps the number honest across remounts.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (phase !== 'analysing' || startedAt === null) return
    setTick(0)
    const timer = setInterval(() => { setTick(value => value + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [phase, startedAt])
  const elapsed = startedAt === null ? 0 : Math.max(Math.floor((Date.now() - startedAt) / 1000), 0)

  const busy = phase !== 'idle'

  // ADR-0032 批次③: the human-side direct write — a correction spotted while
  // reading the batch lands straight in the `mail` scope, no proposal card:
  // the human is the author, and the UI is the human channel. A duplicate
  // reads as 已记得, not an error.
  const [memory, setMemory] = useState('')
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null)
  const remember = async (): Promise<void> => {
    const trimmed = memory.trim()
    if (trimmed === '' || memoryAdd === undefined) return
    try {
      await memoryAdd('mail', trimmed)
      setMemory('')
      setMemoryNotice(t('memory.added'))
    } catch (failure: unknown) {
      setMemoryNotice(isDuplicateMemory(failure) ? t('memory.known') : remoteMessage(failure))
    }
  }

  /** One flat-batch mail, exactly as the pre-thread row looked; threads indent theirs. */
  const mailRow = (mail: KbMailMessage, index: number, indented: boolean): ReactElement => {
    const verdict = verdicts.get(index + 1)
    return (
      <div key={mail.id} style={{ ...mailRowStyle, ...(indented ? threadMemberIndent : {}) }} data-mail-row={index + 1}>
        {verdict !== undefined && (
          <span style={{ ...mailBadgeStyle, ...IMPORTANCE_STYLES[verdict.importance] }} data-mail-verdict={verdict.importance}>
            {t(IMPORTANCE_KEYS[verdict.importance])}
          </span>
        )}
        <span style={mailTextMutedStyle}>{mail.senderName}</span>
        <span style={mailSubjectStyle} title={mail.subject}>{mail.subject || t('mail.noSubject')}</span>
        {verdict !== undefined && verdict.why !== '' && verdict.importance === 'focus' && (
          <span style={hintStyle} title={verdict.why}>{verdict.why}</span>
        )}
      </div>
    )
  }

  return (
    <div style={wrapStyle} data-mail-panel="true">
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={busy}
          onClick={() => { void run.read('older') }}
        >
          {t('mail.prev')}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={busy}
          onClick={() => { void run.read('newer') }}
        >
          {phase === 'fetching' ? t('mail.loading') : t('mail.next')}
        </button>
      </div>
      {mails.length === 0 && phase === 'idle' && (
        <div style={mutedStyle}>
          {t('mail.description')}
        </div>
      )}
      {mails.length > 0 && (
        <div style={{ fontSize: 'var(--yt-type-label)' }} data-mail-batch="true">
          {t('mail.countUnit', { count: mails.length })}
          {' '}
          {day(mails[mails.length - 1]?.receivedAt ?? '')}
          {' → '}
          {day(mails[0]?.receivedAt ?? '')}
          {hasMore ? t('mail.morePending') : ''}
        </div>
      )}
      {mails.length > 0 && (
        <div style={mailListStyle} data-mail-list="true">
          {threads.map((thread) => {
            const rollup = rollupImportance(thread.members.map(member => verdicts.get(member.index + 1)?.importance))
            if (thread.members.length === 1) {
              const sole = thread.members[0]
              if (sole === undefined) return null
              return mailRow(sole.mail, sole.index, false)
            }
            const open = expanded[thread.key] ?? thread.members.length < THREAD_COLLAPSE_MIN
            return (
              <div key={thread.key} data-mail-thread={thread.key}>
                <button
                  type="button"
                  style={threadHeadStyle}
                  data-mail-thread-toggle={thread.key}
                  onClick={() => { setExpanded(previous => ({ ...previous, [thread.key]: !open })) }}
                >
                  <span style={{ ...mailBadgeStyle, ...IMPORTANCE_STYLES[rollup] }} data-mail-thread-verdict={rollup}>
                    {t(IMPORTANCE_KEYS[rollup])}
                  </span>
                  <span style={mailSubjectStyle} title={thread.topic}>{thread.topic || t('mail.noSubject')}</span>
                  <span style={mailTextMutedStyle}>{`×${thread.members.length}${open ? ' ▾' : ' ▸'}`}</span>
                </button>
                {open && thread.members.map(member => mailRow(member.mail, member.index, true))}
              </div>
            )
          })}
        </div>
      )}
      {(range.firstReadAt !== undefined || range.lastReadAt !== undefined) && (
        <div style={mutedStyle} data-mail-processed="true">
          {t('mail.processed')}
          {range.firstReadAt !== undefined
            ? `${day(range.firstReadAt)} ${t('mail.rangeTo')} ${day(range.lastReadAt ?? range.firstReadAt)}`
            : day(range.lastReadAt ?? '')}
        </div>
      )}
      {stale && <div style={hintStyle}>{t('mail.longGap')}</div>}
      {mails.length > 0 && (
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void run.run() }}>
          {phase === 'analysing' ? t('mail.analysing') : t('mail.analyseBatch', { count: mails.length })}
        </button>
      )}
      {phase === 'analysing' && (
        <button type="button" style={buttonStyle} data-mail-cancel="true" onClick={() => { run.cancel() }}>
          {t('common.cancel')}
        </button>
      )}
      {phase === 'analysing' && progress !== null && (
        <div style={hintStyle} data-mail-progress={progress.stage}>
          {/* 阶段与计数进 live region；逐秒跳动的等待计时留在外面——
              否则读屏每秒被吵一次。 */}
          <span role="status">
            {t(STAGE_KEYS[progress.stage])}
            {progress.done !== undefined && progress.total !== undefined
              ? ` ${t('mail.analysedProgress', { done: progress.done, total: progress.total })}`
              : ''}
          </span>
          {` ${t('mail.waited', { seconds: elapsed })}`}
        </div>
      )}
      {error !== null && <div style={errorStyle} role="alert" data-mail-error="true">{error}</div>}
      {memoryAdd !== undefined && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} data-mail-memory="true">
          <input
            style={{ flex: 1, minWidth: 0, padding: 'var(--yt-space-1) var(--yt-space-2)' }}
            value={memory}
            placeholder={t('memory.addPlaceholder')}
            onChange={(event) => { setMemory(event.target.value) }}
            onKeyDown={(event) => {
              // IME 组合中的回车（选字确认）不是「记住」——与 MemoryPanel
              // 同一守卫，中文输入法选词回车不再误提交。
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') { void remember() }
            }}
          />
          <button type="button" style={buttonStyle} disabled={memory.trim() === ''} onClick={() => { void remember() }}>
            {t('memory.addButton')}
          </button>
        </div>
      )}
      {memoryNotice !== null && <div style={hintStyle} role="status" data-mail-memory-notice="true">{memoryNotice}</div>}
      {hint !== null && <div style={hintStyle}>{hint}</div>}
      {summary.length > 0 && (
        <div style={mutedStyle} role="status" data-mail-summary="true">
          {summary.map(line => <div key={line}>{line}</div>)}
        </div>
      )}
      {review !== null && (
        <ProposalCard
          t={t}
          proposal={review}
          busy={phase === 'applying'}
          onConfirm={(ticked, areaPicks) => { void run.confirm(ticked, areaPicks) }}
          onDismiss={() => { void run.dismiss() }}
        />
      )}
    </div>
  )
}
