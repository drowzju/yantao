/**
 * The 洞察 tab's current-session dashboard data plane (ADR-0050). The
 * durable session log is already on disk — the same log the 任务 drawer
 * reads — so the dashboard needs no new RPC either: it reuses
 * `collectEvents` (the follow-snapshot-then-page-backwards reader shared by
 * every full-log reader) and folds the events into the three shapes the
 * four cards render:
 *
 * - 逐步趋势 — one record per model step that reported usage, the raw
 *   material for the per-request stacked bars (Step view) and their
 *   per-turn sums (Turn view);
 * - 事件流 — the three event families worth surfacing (pipeline
 *   injections, compactions, model selections), everything else is
 *   scaffolding;
 * - 文件活动 — tool calls classified into the four read/write/edit/search
 *   buckets with line deltas read off the arguments, after dsh-context's
 *   file-activity precedent.
 *
 * Pure shaping plus one loader over the session Remote face — no React — so
 * the recognition rules are pinned by unit tests.
 * @module @deepseek-ai/dsh-client-ui-yantao/insights
 */
import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionRemote } from './remote.ts'
import { collectEvents } from './session-detail.ts'

/** One model step's usage: the raw material of the 趋势 card's bars. */
export interface TrendStep {
  readonly seq: number
  readonly turn: number
  /** Uncached prompt tokens of this request (disjoint from the cache fields). */
  readonly inputTokens: number
  /** Completion tokens of this step (reasoning already included). */
  readonly outputTokens: number
  /** Prompt tokens served from the provider cache. */
  readonly cacheReadTokens: number
  /** Prompt tokens written to the provider cache this step. */
  readonly cacheWriteTokens: number
}

/** One surfaced 事件流 line: an injection, a compaction, or a model switch. */
export type FeedItem =
  | {
    /** A user-role message the pipeline injected (skill body, notices) — not typed by the human. */
    readonly kind: 'injection'
    readonly seq: number
    readonly turn: number
    /** The injected text, clipped. */
    readonly text: string
  }
  | {
    /** A compaction summary: history above the shadowed range was replaced. */
    readonly kind: 'compaction'
    readonly seq: number
    readonly turn: number
    /** Tokens the summary shadowed, when the log carried the figure. */
    readonly shadowedTokenCount: number | null
    /** The summary text, clipped. */
    readonly summary: string
  }
  | {
    /** A model route selection. */
    readonly kind: 'model'
    readonly seq: number
    readonly turn: number
    readonly provider: string
    readonly model: string
  }

/** One 会话's file activity: four buckets plus the line deltas read off args. */
export interface FileActivity {
  /** Reads: file/entity/resource reads and listings. */
  readonly read: number
  /** Whole-file creations (new content, no previous text to diff against). */
  readonly write: number
  /** Targeted rewrites of existing text. */
  readonly edit: number
  /** Searches: grep/glob-style lookups. */
  readonly search: number
  /** Lines the session's writes and edits added, summed. */
  readonly linesAdded: number
  /** Lines the session's edits removed, summed. */
  readonly linesRemoved: number
}

/** One session's shaped dashboard data, oldest first. */
export interface SessionInsights {
  /** Every model step that reported usage, oldest first. */
  readonly steps: readonly TrendStep[]
  /** The surfaced events, oldest first. */
  readonly feed: readonly FeedItem[]
  /** The file-activity buckets, zeroed when the session touched no files. */
  readonly files: FileActivity
}

/** Read one session's dashboard data — the insights slot's injected seam. */
export type InsightsLoader = (
  sessionId: string,
  signal?: AbortSignal,
) => Promise<SessionInsights>

/** Occupancy thresholds for the footer button's stroke: amber past 80%, red past 95% (ADR-0039's). */
export const WARNING_PERCENT = 80
export const DANGER_PERCENT = 95

/**
 * Format a token count compactly for the dashboards, the footer button and
 * the status bar.
 * @param value - token count.
 * @returns `842`, `12.3k`, or `1.2M` style figures.
 */
export function formatTokens(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}k`
  return `${Math.round(value / 100_000) / 10}M`
}

/** How much of one injected message or compaction summary the feed keeps. */
const FEED_CLIP = 2_000

/** The marker a clip appends, so a shortened read is never mistaken for a whole one. */
const CLIP_MARK = '\n（过长，已截断）'

/** Clip one string to `max` code units, marking the cut. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}${CLIP_MARK}`
}

/** The text blocks of one message-shaped `content` array, joined; defensive — wire JSON. */
function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part !== 'object' || part === null) return ''
    if ((part as { type?: unknown }).type !== 'text') return ''
    const text = (part as { text?: unknown }).text
    return typeof text === 'string' ? text : ''
  }).join('')
}

/** Parse one `tool/call` arguments string into an object; defensive — model output. */
function argsObjectOf(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) return {}
  const args = (data as { arguments?: unknown }).arguments
  if (typeof args !== 'string' || args === '') return {}
  try {
    const parsed: unknown = JSON.parse(args)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Count the lines of one string; empty text is zero lines. */
function linesOf(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

/** The number-valued field of one record, or the fallback. */
function numberOf(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Fold the durable events into the 趋势 card's per-step records: every
 * `assistant/message` that carried provider usage earns one row; turn
 * brackets only supply the grouping key. Defensive — this arrived as wire
 * JSON.
 * @param events - the session's durable events, oldest first.
 * @returns the steps in the same order.
 */
export function stepsFromEvents(events: readonly SessionWireEvent[]): readonly TrendStep[] {
  const steps: TrendStep[] = []
  let turn = 0
  for (const event of events) {
    if (event.type === 'turn/start') {
      const data = event.data as { turn?: unknown }
      if (typeof data.turn === 'number') turn = data.turn
      continue
    }
    if (event.type !== 'assistant/message') continue
    const usage = (event.data as { usage?: unknown } | null)?.usage
    if (typeof usage !== 'object' || usage === null) continue
    const input = (usage as { inputTokens?: unknown }).inputTokens
    const output = (usage as { outputTokens?: unknown }).outputTokens
    if (typeof input !== 'number' || typeof output !== 'number') continue
    const cacheRead = (usage as { cacheReadTokens?: unknown }).cacheReadTokens
    const cacheWrite = (usage as { cacheWriteTokens?: unknown }).cacheWriteTokens
    steps.push({
      seq: event.seq,
      turn,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: typeof cacheRead === 'number' ? cacheRead : 0,
      cacheWriteTokens: typeof cacheWrite === 'number' ? cacheWrite : 0,
    })
  }
  return steps
}

/**
 * Fold the durable events into the 事件流 card's lines: pipeline injections
 * (user-role messages whose source is not the human), compaction summaries,
 * and model selections. Requests, retries, tool traffic and the human's own
 * prompts are scaffolding the stream does not surface.
 * @param events - the session's durable events, oldest first.
 * @returns the surfaced items in the same order.
 */
export function feedFromEvents(events: readonly SessionWireEvent[]): readonly FeedItem[] {
  const items: FeedItem[] = []
  let turn = 0
  for (const event of events) {
    if (event.type === 'turn/start') {
      const data = event.data as { turn?: unknown }
      if (typeof data.turn === 'number') turn = data.turn
      continue
    }
    if (event.type === 'user/message') {
      const data = event.data as { source?: { kind?: unknown }; content?: unknown }
      if (data.source?.kind === 'user') continue
      const text = textOfContent(data.content)
      if (text === '') continue
      items.push({ kind: 'injection', seq: event.seq, turn, text: clip(text, FEED_CLIP) })
      continue
    }
    if (event.type === 'compaction/summary') {
      const data = event.data as Record<string, unknown>
      const summary = typeof data.summary === 'string' ? data.summary : ''
      items.push({
        kind: 'compaction',
        seq: event.seq,
        turn,
        shadowedTokenCount: numberOf(data, 'shadowedTokenCount'),
        summary: clip(summary, FEED_CLIP),
      })
      continue
    }
    if (event.type === 'model/selection') {
      const data = event.data as Record<string, unknown>
      const provider = typeof data.provider === 'string' ? data.provider : ''
      const model = typeof data.model === 'string' ? data.model : ''
      if (provider === '' && model === '') continue
      items.push({ kind: 'model', seq: event.seq, turn, provider, model })
      continue
    }
  }
  return items
}

/** The tool names that read: yantao's readers plus the generic read tools. */
const READ_TOOLS = new Set(['kb_read_resource', 'kb_read_entity', 'read', 'read_image', 'view'])
/** The tool names that create whole files or whole KB entries. */
const WRITE_TOOLS = new Set(['kb_write_resource', 'kb_write_state', 'kb_register_resource', 'write'])
/** The tool names that rewrite existing text in place. */
const EDIT_TOOLS = new Set(['kb_edit_section', 'kb_append_log', 'edit', 'str_replace_editor'])
/** The tool names that search or list: lookups, not content reads. */
const SEARCH_TOOLS = new Set(['kb_list_entities', 'grep', 'glob'])

/**
 * Classify one tool call into the 文件活动 buckets, or null when the tool
 * is neither a file operation nor recognisable by name.
 * @param name - the `tool/call` event's tool name.
 * @returns the bucket, or null to ignore the call.
 */
function fileBucketOf(name: string): 'read' | 'write' | 'edit' | 'search' | null {
  if (READ_TOOLS.has(name)) return 'read'
  if (WRITE_TOOLS.has(name)) return 'write'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (SEARCH_TOOLS.has(name)) return 'search'
  // Unknown tools fall back to name substrings, after dsh-context's precedent;
  // anything still unrecognised is not a file operation.
  if (/read|list/i.test(name)) return 'read'
  if (/grep|glob|search|find/i.test(name)) return 'search'
  if (/edit|update|patch/i.test(name)) return 'edit'
  if (/write|create|save/i.test(name)) return 'write'
  return null
}

/**
 * Read one call's line delta off its arguments, after dsh-context's file
 * activity: edits contribute new minus old, whole-file writes contribute
 * their content. Only the arguments are consulted — results may carry
 * echoed text that would double-count.
 * @param name - the tool name.
 * @param args - the parsed arguments object.
 * @returns the added and removed line counts.
 */
function lineDeltaOf(name: string, args: Record<string, unknown>): { added: number; removed: number } {
  const stringField = (key: string): string => {
    const value = args[key]
    return typeof value === 'string' ? value : ''
  }
  if (name === 'str_replace_editor' || name === 'edit') {
    return { added: linesOf(stringField('new_string')), removed: linesOf(stringField('old_string')) }
  }
  if (name === 'kb_edit_section' || name === 'kb_append_log') {
    return { added: linesOf(stringField('text')), removed: 0 }
  }
  if (name === 'kb_write_resource' || name === 'write') {
    return { added: linesOf(stringField('content')), removed: 0 }
  }
  if (name === 'kb_write_state') {
    return { added: linesOf(stringField('text')), removed: 0 }
  }
  return { added: 0, removed: 0 }
}

/**
 * Fold the durable events into the 文件活动 card's buckets: every `tool/call`
 * is classified by tool name (exact table first, substring fallback after),
 * and line deltas are read off the arguments only. Results, errors and
 * non-file tools contribute nothing.
 * @param events - the session's durable events, oldest first.
 * @returns the bucket counts and line deltas, zeroed when nothing matched.
 */
export function fileActivityFromEvents(events: readonly SessionWireEvent[]): FileActivity {
  let read = 0
  let write = 0
  let edit = 0
  let search = 0
  let linesAdded = 0
  let linesRemoved = 0
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = event.data as { name?: unknown }
    if (typeof data.name !== 'string') continue
    const bucket = fileBucketOf(data.name)
    if (bucket === null) continue
    if (bucket === 'read') read += 1
    else if (bucket === 'write') write += 1
    else if (bucket === 'edit') edit += 1
    else search += 1
    const delta = lineDeltaOf(data.name, argsObjectOf(event.data))
    linesAdded += delta.added
    linesRemoved += delta.removed
  }
  return { read, write, edit, search, linesAdded, linesRemoved }
}

/**
 * Read one session's dashboard data through the session Remote's existing
 * faces (ADR-0050): the shared full-log reader collects the durable events
 * and the three folds shape them for the four cards. No new RPC — the log
 * is already on disk.
 * @param session - the session namespace.
 * @param sessionId - the session to read.
 * @param signal - the reader's cancel line (the tab closing stops the read).
 * @returns the shaped dashboard data, oldest first.
 */
export async function loadSessionInsights(
  session: SessionRemote,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionInsights> {
  const events = await collectEvents(session, sessionId, signal)
  return {
    steps: stepsFromEvents(events),
    feed: feedFromEvents(events),
    files: fileActivityFromEvents(events),
  }
}
