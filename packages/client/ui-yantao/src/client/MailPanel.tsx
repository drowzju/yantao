/**
 * The 连接 tab: the mail connector's own panel (ADR-0019).
 *
 * Three beats, in order — 读取邮件 asks the host to read Outlook through its
 * Python/COM subprocess; 分析 hands the batch to a dsh session; and the
 * verdict comes back into {@link MailReview}, where nothing is written until
 * the human confirms. The cursor only moves once a verdict has been dealt
 * with, so a failed analysis leaves the mails unread rather than lost.
 */
import { useState, type ReactElement } from 'react'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { MailFetcher, MailMarker } from './remote.ts'
import type { AnalysisRun, KnownEntities } from './mail-analysis.ts'
import type { MailEntities, MailSelection, MailWriteTarget } from './mail-apply.ts'
import { applyAnalysis } from './mail-apply.ts'
import { MailReview } from './MailReview.tsx'

/** What the panel does with the Remote surface and the KB. */
export interface MailPanelProps {
  /** Read the newest mails after the connector's cursor. */
  readonly fetch: MailFetcher
  /** Move that cursor forward. */
  readonly mark: MailMarker
  /** Run one analysis over a batch. */
  readonly analyse: (mails: readonly KbMailMessage[], known: KnownEntities) => Promise<AnalysisRun>
  /** The KB seams the confirmed writes go through. */
  readonly target: MailWriteTarget
  /** Read what the KB already holds, for the prompt and for the writes. */
  readonly entities: () => Promise<MailEntities>
}

type Phase = 'idle' | 'fetching' | 'analysing' | 'applying'

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 6px' } as const

const buttonStyle = { padding: '3px 8px', alignSelf: 'flex-start' } as const

const mutedStyle = { color: '#9a9488', fontSize: 12 } as const

const errorStyle = { color: '#b4453a', fontSize: 12 } as const

const hintStyle = { color: '#6b6455', fontSize: 12 } as const

/**
 * An ISO stamp `days` before `from` — the 「补读更早」 bound.
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
 * Render the connector panel.
 * @param props - see {@link MailPanelProps}.
 * @returns the panel element.
 */
export function MailPanel({ fetch, mark, analyse, target, entities }: MailPanelProps): ReactElement {
  const [mails, setMails] = useState<readonly KbMailMessage[]>([])
  const [stale, setStale] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [lastReadAt, setLastReadAt] = useState<string | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [review, setReview] = useState<{ run: AnalysisRun; known: MailEntities } | null>(null)
  const [summary, setSummary] = useState<readonly string[]>([])

  /**
   * Read one batch. A failure keeps its message *and* its remedy: the useful
   * answer to "Outlook is not answering" is what to start, not that it failed.
   * @param since - an explicit bound, for 补读更早.
   */
  const read = async (since?: string): Promise<void> => {
    setPhase('fetching')
    setError(null)
    setHint(null)
    setSummary([])
    try {
      const result = await fetch({ ...since !== undefined ? { since } : {} })
      setMails(result.messages)
      setStale(result.stale)
      setHasMore(result.hasMore)
      setLastReadAt(result.lastReadAt ?? result.since)
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setHint((failure as { details?: { hint?: string } }).details?.hint ?? null)
    } finally {
      setPhase('idle')
    }
  }

  /** Hand the batch to a session and open the confirmation window. */
  const run = async (): Promise<void> => {
    setPhase('analysing')
    setError(null)
    setHint(null)
    try {
      const known = await entities()
      const result = await analyse(mails, known)
      setReview({ run: result, known })
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPhase('idle')
    }
  }

  /**
   * Write what was ticked, then move the cursor: the mails have been read and
   * judged, whether the human took anything from them or not.
   * @param selection - the ticked rows.
   */
  const confirm = async (selection: MailSelection): Promise<void> => {
    if (review === null) return
    setPhase('applying')
    try {
      const result = await applyAnalysis({
        analysis: review.run.analysis,
        selection,
        target,
        entities: review.known,
      })
      setSummary([...result.written, ...result.skipped])
      setReview(null)
      setMails([])
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPhase('idle')
    }
    await mark({ lastReadAt: mails[0]?.receivedAt ?? new Date().toISOString() }).catch(() => {})
  }

  /** Close the window without writing; the mails still count as read. */
  const dismiss = async (): Promise<void> => {
    setReview(null)
    await mark({ lastReadAt: mails[0]?.receivedAt ?? new Date().toISOString() }).catch(() => {})
  }

  const busy = phase !== 'idle'

  return (
    <div style={wrapStyle} data-mail-panel="true">
      <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void read() }}>
        {phase === 'fetching' ? '读取中…' : '读取邮件'}
      </button>
      {mails.length === 0 && phase === 'idle' && (
        <div style={mutedStyle}>连接：Outlook（COM 子进程）。读取后由 agent 分析，确认后才写库。</div>
      )}
      {mails.length > 0 && (
        <div style={{ fontSize: 12 }}>
          {mails.length} 封新邮件{hasMore ? '（还有更多未读）' : ''}
        </div>
      )}
      {stale && lastReadAt !== undefined && (
        <div>
          <div style={hintStyle}>上次读取是一个多月前，中间那段还没读过。</div>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void read(earlier(lastReadAt, 30)) }}>
            补读更早
          </button>
        </div>
      )}
      {mails.length > 0 && (
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void run() }}>
          {phase === 'analysing' ? '分析中…' : `分析这 ${mails.length} 封`}
        </button>
      )}
      {error !== null && <div style={errorStyle} data-mail-error="true">{error}</div>}
      {hint !== null && <div style={hintStyle}>{hint}</div>}
      {summary.length > 0 && (
        <div style={mutedStyle} data-mail-summary="true">
          {summary.map(line => <div key={line}>{line}</div>)}
        </div>
      )}
      {review !== null && (
        <MailReview
          analysis={review.run.analysis}
          sessionTitle={review.run.title}
          onConfirm={(selection) => { void confirm(selection) }}
          onDismiss={() => { void dismiss() }}
        />
      )}
    </div>
  )
}
