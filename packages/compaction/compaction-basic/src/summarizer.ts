/**
 * Default one-shot summarization and durable checkpoint framing.
 *
 * @module @deepseek-ai/dsh-compaction-basic/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, BlockAssembler, CONTEXT_WINDOW_EXCEEDED_CODE, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, TokenUsage, ToolSchema,
} from '@deepseek-ai/dsh-llm'
// Type-only: the `ctx.tokenMeter` Context merge for the summarizer's estimation helpers.
import type {} from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface SummaryConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

/**
 * Head-room subtracted from the model window before sizing the auxiliary
 * summarization call's input and output budgets (ADR-0058). The auxiliary call
 * shares the conversation's window; without a margin, input plus the output
 * reservation can exceed it and the provider rejects the call outright.
 */
const SUMMARIZE_SAFETY_MARGIN = 8_192

/** Smallest usable summary output reservation; below this a checkpoint would be unusably truncated. */
const MIN_SUMMARY_TOKENS = 1_024

/** Maximum reactive halving retries after the provider still rejects the degraded call. */
const MAX_SUMMARY_DEGRADATIONS = 4

/** Tags wrapping the structured summary inside the landed checkpoint node. */
const SUMMARY_OPEN_TAG = '<compacted-summary>'
const SUMMARY_CLOSE_TAG = '</compacted-summary>'

/**
 * The summarization directive, delivered as the FINAL user message after the
 * replayed conversation rather than as a distinct summarizer system prompt.
 * Keeping the conversation's own system prompt, tools, and message prefix in
 * front of it makes the auxiliary call a genuine prefix of the last routed
 * request, so the provider's KV cache is reused instead of invalidated.
 */
const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`,
].join('\n')

/** Framing that makes the replacement user message established context. */
const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/**
 * The replayed conversation surface the summarizer condenses. Reproducing the
 * last routed request's system prompt, tools, and leading messages verbatim
 * lets the auxiliary call reuse the provider's warm prefix cache; the trailing
 * compaction instruction is then the only novel input.
 */
export interface SummarizationInput {
  /** The conversation's tool schemas, reused for prefix-cache alignment; absent when the request carried none. */
  readonly tools?: readonly ToolSchema[]
  /** The derived system head, when present, followed by the shadowed region in surface order. */
  readonly messages: readonly Message[]
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  /** Provider-reported usage for this summarization request. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the text-only summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked result does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

/**
 * Run the default cache-reusing `ctx.llm.stream()` summarization call: replay
 * the conversation prefix, then append the compaction instruction as the final
 * user message so the provider's warm prefix cache is reused.
 *
 * The auxiliary call shares the conversation's context window (ADR-0058), so
 * the replay is sized defensively before dispatch: the output reservation is
 * clamped to whatever the window still affords, and when even a minimal
 * reservation does not fit, the oldest replayed messages are elided (keeping
 * the system head and never splitting a tool-call/result pair) with an
 * omission note prepended to the instruction. If the provider still rejects
 * the call with a context-window failure, the replay is reactively halved and
 * retried up to {@link MAX_SUMMARY_DEGRADATIONS} times; exhaustion propagates
 * the failure (fail-closed, unchanged).
 * @param ctx - context providing the LLM service and token meter.
 * @param config - resolved backend configuration.
 * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
 * @param agent - supplies routed-model history, fallback model, and session id.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe text-only summary blocks and the exact call envelope and output.
 */
export async function summarizeWithLlm(
  ctx: Context,
  config: SummaryConfig,
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const latest = agent.session.requestHeader()?.config
  const configured = config.summarizationProvider.length === 0
    ? undefined
    : { provider: config.summarizationProvider, model: config.summarizationModel }
  const agentTarget = agent.options.provider !== undefined
    && agent.options.provider.length > 0
    && agent.options.model !== undefined
    && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
    )
  }

  const meter = ctx.tokenMeter
  const window = await contextWindowOf(ctx, target)
  const toolsTokens = estimateToolsCost(input.tools)

  let replay: readonly Message[] = input.messages
  let elidedCount = 0
  let degradations = 0

  for (;;) {
    // Proactive degradation: fit the replay into the window minus the safety
    // margin and a minimal output reservation before dispatching.
    if (window !== undefined) {
      const truncated = truncateReplay(meter, replay, window - SUMMARIZE_SAFETY_MARGIN - MIN_SUMMARY_TOKENS - toolsTokens)
      if (truncated === null) {
        throw new Error('summarization replay cannot fit the model context window even when fully elided')
      }
      replay = truncated.messages
      elidedCount += truncated.elided
    }

    const instructionText = elidedCount === 0
      ? COMPACTION_INSTRUCTION
      : `${elisionNote(elidedCount)}\n\n${COMPACTION_INSTRUCTION}`
    const instruction = createUserMessage({ content: [{ type: 'text', text: instructionText }], source: { kind: 'user' } })

    // Clamp the output reservation so input plus reservation stays inside the
    // same window; with unknown capacity the configured cap is used as-is.
    let maxTokens = config.maxTokens
    if (window !== undefined) {
      const inputEstimate = replay.reduce((total, message) => total + meter.estimateMessage(message), 0)
        + meter.estimateMessage(instruction)
        + toolsTokens
      maxTokens = Math.max(1, Math.min(config.maxTokens, window - SUMMARIZE_SAFETY_MARGIN - inputEstimate))
    }

    // A fresh assembler per attempt: a degraded retry must not inherit the
    // failed attempt's partial accumulation.
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: target.provider,
      model: target.model,
      messages: [
        ...replay,
        deepFreeze({
          role: 'user',
          content: [{ type: 'text', text: instructionText }],
        }),
      ],
      toolHistory: agent.session.toolHistory(),
      ...input.tools === undefined ? {} : { tools: [...input.tools] },
      maxTokens,
      sessionId: agent.session.id,
      purpose: 'compaction',
      ...signal === undefined ? {} : { signal },
    }
    try {
      for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
      const error = finishError(assembler.finish)
      if (error !== undefined) throw error

      const rawOutput = assembler.blocks()
      const summary = summaryText(rawOutput)
      if (!summary.some(block => block.text.trim().length > 0)) {
        throw new Error('summarization produced no text summary content')
      }
      return {
        summary,
        rawOutput,
        llmStreamCall: true,
        provider: options.provider,
        model: options.model,
        maxTokens,
        ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
      }
    } catch (error) {
      if (
        (error as { code?: string }).code !== CONTEXT_WINDOW_EXCEEDED_CODE
        || signal?.aborted
        || degradations >= MAX_SUMMARY_DEGRADATIONS
      ) throw error
      const halved = halveReplay(replay)
      if (halved === null) throw error
      degradations += 1
      replay = halved.messages
      elidedCount += halved.elided
      ctx.logger.warn(
        'summarization call exceeded the context window; retrying with %d older messages elided (degradation %d/%d)',
        halved.elided,
        degradations,
        MAX_SUMMARY_DEGRADATIONS,
      )
    }
  }
}

/**
 * Wrap raw summary blocks in the durable checkpoint framing.
 * @param summary - safe text-only model output.
 * @returns content for the synthesized replacement user message.
 */
export function frameSummary(summary: readonly ContentBlock[]): ContentBlock[] {
  return [
    { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}` },
    ...summary,
    { type: 'text', text: SUMMARY_CLOSE_TAG },
  ]
}

/** Map a terminal summarization finish to its fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      return new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Reject visual output and keep only text before synthesizing a user message. */
function summaryText(
  blocks: readonly ContentBlock[],
): Array<Extract<ContentBlock, { type: 'text' }>> {
  if (contentHasImage(blocks)) {
    throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
}

/** Split the replay into the preserved system head and the condensable body. */
function splitHead(messages: readonly Message[]): { head: readonly Message[]; body: readonly Message[] } {
  let headEnd = 0
  for (; headEnd < messages.length; headEnd += 1) {
    const role = messages[headEnd]?.role
    if (role !== 'system' && role !== 'developer') break
  }
  return { head: messages.slice(0, headEnd), body: messages.slice(headEnd) }
}

/**
 * Advance a cut point past orphaned tool results so the kept suffix never opens
 * with a tool result whose assistant tool-call message was elided.
 */
function skipOrphanedToolResults(messages: readonly Message[], start: number): number {
  let index = start
  for (; index < messages.length; index += 1) {
    if (messages[index]?.role !== 'tool') break
  }
  return index
}

/**
 * Elide the oldest body messages that do not fit `budgetTokens`, keeping the
 * system head and the newest suffix intact (pair-safe). The newest message is
 * always kept even when oversized, as a best effort the reactive path can
 * still learn from.
 * @returns the possibly shortened replay with the elision count, or `null`
 * when the body is empty and nothing was elidable.
 */
function truncateReplay(
  meter: { estimateMessage(message: Message): number },
  messages: readonly Message[],
  budgetTokens: number,
): { messages: readonly Message[]; elided: number } | null {
  const { head, body } = splitHead(messages)
  if (body.length === 0) return { messages: head, elided: 0 }
  const bodyTokens = body.reduce((total, message) => total + meter.estimateMessage(message), 0)
  if (bodyTokens <= budgetTokens) return { messages, elided: 0 }
  let keptFrom = body.length
  let keptTokens = 0
  while (keptFrom > 0) {
    const message = body[keptFrom - 1]
    if (message === undefined) break
    const cost = meter.estimateMessage(message)
    if (keptFrom < body.length && keptTokens + cost > budgetTokens) break
    keptFrom -= 1
    keptTokens += cost
  }
  const start = skipOrphanedToolResults(body, keptFrom)
  if (start >= body.length) return { messages: head, elided: body.length }
  return { messages: [...head, ...body.slice(start)], elided: start }
}

/**
 * Drop the oldest half of the body for a reactive retry, pair-safe. Fails when
 * nothing condensable remains (body under two messages, or the survivors are
 * all orphaned tool results).
 */
function halveReplay(messages: readonly Message[]): { messages: readonly Message[]; elided: number } | null {
  const { head, body } = splitHead(messages)
  if (body.length < 2) return null
  const start = skipOrphanedToolResults(body, Math.floor(body.length / 2))
  if (start >= body.length) return null
  return { messages: [...head, ...body.slice(start)], elided: start }
}

/** Prepend an omission note so the summarizer knows the replay is partial. */
function elisionNote(count: number): string {
  return `[System note: ${count} older message(s) of the conversation were omitted so this checkpoint request fits the model's context window.]`
}

/**
 * Resolve the summarization target's context window. Unknown capacity (no
 * declared context or resolution failure) disables proactive clamping and
 * leaves the reactive ladder as the only defense.
 */
async function contextWindowOf(
  ctx: Context,
  target: { provider: string; model: string },
): Promise<number | undefined> {
  try {
    const info = await ctx.llm.resolveModelInfo(target.provider, target.model)
    return info.context?.contextWindow
  } catch {
    return undefined
  }
}

/** Rough char-density estimate of the tools schema cost (≈4 chars/token). */
function estimateToolsCost(tools: readonly ToolSchema[] | undefined): number {
  if (tools === undefined || tools.length === 0) return 0
  return Math.ceil(JSON.stringify(tools).length / 4)
}
