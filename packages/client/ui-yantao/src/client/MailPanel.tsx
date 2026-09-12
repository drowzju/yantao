/**
 * The mail capability's detail inside the 能力 tab (ADR-0019, ADR-0021).
 *
 * Three beats, in order — 往前 / 往后 reads one window of Outlook through the
 * host's Python/COM subprocess, where the two buttons step the window back and
 * forward in time; 分析 hands the batch to a dsh session and reports which
 * stage the run has reached, because the wait is the slow part; and the
 * verdict comes back into {@link MailReview}, where nothing is written until
 * the human confirms. The cursor only moves once a verdict has been dealt
 * with, so a failed analysis leaves the mails unread rather than lost.
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { KbMailMessage } from '@deepseek-ai/dsh-api-yantao-kb-controller/types'
import type { MailFetcher, MailMarker } from './remote.ts'
import type { AnalysisProgress, AnalysisRun, AnalysisStage, MailAnalyser } from './mail-analysis.ts'
import type { MailEntities, MailSelection, MailWriteTarget } from './mail-apply.ts'
import { applyAnalysis } from './mail-apply.ts'
import { MailReview } from './MailReview.tsx'

/** The processed-mail range the capability's persisted state carries, as the panel shows it. */
export interface MailProcessedRange {
  /** The oldest mail ever processed, when known. */
  readonly firstReadAt?: string
  /** The newest mail processed so far (the watermark), when known. */
  readonly lastReadAt?: string
}

/** What the panel does with the Remote surface and the KB. */
export interface MailPanelProps {
  /** Read the newest mails after the connector's cursor. */
  readonly fetch: MailFetcher
  /** Move that cursor forward. */
  readonly mark: MailMarker
  /** Run one analysis over a batch, reporting the stage it has reached. */
  readonly analyse: MailAnalyser
  /** The KB seams the confirmed writes go through. */
  readonly target: MailWriteTarget
  /** Read what the KB already holds, for the prompt and for the writes. */
  readonly entities: () => Promise<MailEntities>
  /** The processed range so far, from the capability's persisted state. */
  readonly processed?: MailProcessedRange
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

type Phase = 'idle' | 'fetching' | 'analysing' | 'applying'

/** Which way a read steps the window: back into older mail, or forward into newer. */
type Direction = 'older' | 'newer'

/** How far back one 往前 step reaches. */
const STEP_DAYS = 30

/** What each stage of an analysis run says on screen. */
const STAGE_LABELS: Record<AnalysisStage, string> = {
  session: '正在创建会话…',
  prompt: '正在向模型提问…',
  answer: '模型正在读这批邮件…',
}

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 6px' } as const

const buttonStyle = { padding: '3px 8px', alignSelf: 'flex-start' } as const

const mutedStyle = { color: '#9a9488', fontSize: 12 } as const

const errorStyle = { color: '#b4453a', fontSize: 12 } as const

const hintStyle = { color: '#6b6455', fontSize: 12 } as const

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

/** The date of one ISO stamp, for the line that names the batch on screen. */
function day(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * The bounds of the batch one direction button asks for.
 *
 * 往后 is everything newer than the newest mail on screen (the host fills the
 * lower bound from its watermark when nothing is loaded yet); 往前 is the
 * `STEP_DAYS` window that ends where the oldest mail on screen begins, so each
 * press steps one window back instead of re-reading the newest page.
 * @param direction - which way to step.
 * @param mails - the batch on screen, newest first.
 * @returns the `since` / `until` bounds for the read.
 */
function boundsFor(direction: Direction, mails: readonly KbMailMessage[]): { since?: string; until?: string } {
  const newest = mails[0]?.receivedAt
  const oldest = mails[mails.length - 1]?.receivedAt
  if (direction === 'newer') return newest === undefined ? {} : { since: newest }
  const until = oldest ?? new Date().toISOString()
  return { since: earlier(until, STEP_DAYS), until }
}

/**
 * Render the connector panel.
 * @param props - see {@link MailPanelProps}.
 * @returns the panel element.
 */
export function MailPanel({ fetch, mark, analyse, target, entities, processed = {} }: MailPanelProps): ReactElement {
  const [mails, setMails] = useState<readonly KbMailMessage[]>([])
  const [stale, setStale] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [lastReadAt, setLastReadAt] = useState<string | undefined>(undefined)
  // The processed range: seeded from the capability's persisted state, then
  // kept current with what each 批准/忽略 answers.
  const [range, setRange] = useState<MailProcessedRange>(processed)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [review, setReview] = useState<{ run: AnalysisRun; known: MailEntities } | null>(null)
  const [summary, setSummary] = useState<readonly string[]>([])
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [elapsed, setElapsed] = useState(0)

  // A slow judgement with no feedback reads as a hung one: count the seconds
  // the analysis has been running, next to the stage it has reached.
  useEffect(() => {
    if (phase !== 'analysing') return
    setElapsed(0)
    const timer = setInterval(() => { setElapsed(value => value + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [phase])

  /**
   * Read one batch in one direction. A failure keeps its message *and* its
   * remedy: the useful answer to "Outlook is not answering" is what to start,
   * not that it failed.
   * @param direction - 往前 into older mail, or 往后 into newer.
   */
  const read = async (direction: Direction): Promise<void> => {
    setPhase('fetching')
    setError(null)
    setHint(null)
    setSummary([])
    try {
      const result = await fetch(boundsFor(direction, mails))
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
    setProgress({ stage: 'session' })
    try {
      const known = await entities()
      const result = await analyse(mails, known, setProgress)
      setReview({ run: result, known })
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPhase('idle')
      setProgress(null)
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
    await moveCursor()
  }

  /** Close the window without writing; the mails still count as read. */
  const dismiss = async (): Promise<void> => {
    setReview(null)
    await moveCursor()
  }

  /**
   * Move the cursor past the batch on screen: the newest mail becomes the
   * watermark, the oldest extends the processed range's start backward.
   */
  const moveCursor = async (): Promise<void> => {
    const oldest = mails[mails.length - 1]?.receivedAt
    try {
      const answer = await mark({
        lastReadAt: mails[0]?.receivedAt ?? new Date().toISOString(),
        ...(oldest !== undefined ? { firstReadAt: oldest } : {}),
      })
      setRange((previous) => {
        const firstReadAt = answer.firstReadAt !== undefined ? answer.firstReadAt : previous.firstReadAt
        return {
          ...(firstReadAt !== undefined ? { firstReadAt } : {}),
          lastReadAt: answer.lastReadAt,
        }
      })
    } catch {
      // The verdict is already dealt with; a failed cursor move surfaces on
      // the next read (the host answers from its watermark), not here.
    }
  }

  const busy = phase !== 'idle'

  return (
    <div style={wrapStyle} data-mail-panel="true">
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={busy}
          onClick={() => { void read('older') }}
        >
          ← 往前
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={busy}
          onClick={() => { void read('newer') }}
        >
          {phase === 'fetching' ? '读取中…' : '往后 →'}
        </button>
      </div>
      {mails.length === 0 && phase === 'idle' && (
        <div style={mutedStyle}>
          能力「邮件」：Outlook（COM 子进程）。「往后」读最新的一批，「往前」往更早读一段；读取后由 agent 分析，确认后才写库。
        </div>
      )}
      {mails.length > 0 && (
        <div style={{ fontSize: 12 }} data-mail-batch="true">
          {mails.length} 封 · {day(mails[mails.length - 1]?.receivedAt ?? '')} → {day(mails[0]?.receivedAt ?? '')}
          {hasMore ? '（还有更多）' : ''}
        </div>
      )}
      {(range.firstReadAt !== undefined || range.lastReadAt !== undefined) && (
        <div style={mutedStyle} data-mail-processed="true">
          已处理：
          {range.firstReadAt !== undefined
            ? `${day(range.firstReadAt)} 到 ${day(range.lastReadAt ?? range.firstReadAt)}`
            : day(range.lastReadAt ?? '')}
        </div>
      )}
      {stale && lastReadAt !== undefined && (
        <div style={hintStyle}>上次读取是一个多月前，中间那段还没读过。</div>
      )}
      {mails.length > 0 && (
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void run() }}>
          {phase === 'analysing' ? '分析中…' : `分析这 ${mails.length} 封`}
        </button>
      )}
      {phase === 'analysing' && progress !== null && (
        <div style={hintStyle} data-mail-progress={progress.stage}>
          {STAGE_LABELS[progress.stage]}（已等待 {elapsed} 秒）
        </div>
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
