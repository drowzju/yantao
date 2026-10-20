/**
 * The turn-stopping safety net behind the staging file (2026-10-20): a run
 * that ends with rows still staged would otherwise leave them orphaned — the
 * 11:43 run did exactly that with fourteen validated actions and no card. The
 * flush merges whatever is staged into ONE card, clears the file, and leaves
 * the human's approval as the only write authority. Idempotent: an empty (or
 * missing) staging file is a no-op.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/capability/staging-flush
 */

import { enqueueProposal } from '@deepseek-ai/dsh-yantao-kb'
import { withDerivedEntityNames } from './proposal-actions.ts'
import { clearStagedActions, readStagedActions, stagingPathOf } from './proposal-staging.ts'

/** Human-readable labels for the card title's per-kind tally. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  'delete-mails': '删除',
  'archive-mails': '归档',
  'create-entity': '建实体',
  'append-log': '流水',
  'add-todo': '待办',
}

/** What one flush answered: the card id (absent when nothing was staged) and the row count. */
export interface StagingFlushResult {
  readonly id?: string
  readonly count: number
  /** The freshly enqueued inbox entry (for the enqueue broadcast). */
  readonly entry?: unknown
}

/**
 * Turn a run's leftover staging rows into one proposal card and clear the
 * file. Rows were validated when they were staged, so they enqueue as-is
 * (display names derived like the tool does). The title carries a per-kind
 * tally so the card is readable without opening it.
 * @param kbRoot - the live KB root.
 * @param runToken - the run's key (the session id).
 * @returns the card id and how many rows it carried.
 */
export async function flushStagedProposal(kbRoot: string, runToken: string): Promise<StagingFlushResult> {
  const path = stagingPathOf(kbRoot, runToken)
  const staged = await readStagedActions(path)
  if (staged.length === 0) return { count: 0 }
  const counts = new Map<string, number>()
  for (const row of staged) {
    const kind = typeof row === 'object' && row !== null && typeof (row as { kind?: unknown }).kind === 'string'
      ? (row as { kind: string }).kind
      : '其他'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const summary = [...counts].map(([kind, count]) => `${KIND_LABELS[kind] ?? kind} ${count}`).join('、')
  const title = `邮件处置（自动收尾）：${summary}`
  const stored = await enqueueProposal(kbRoot, {
    source: 'agent:staging-flush',
    sourceName: '自动收尾',
    title,
    note: `运行结束时仍有 ${staged.length} 项暂存未提交，已自动合并成一张卡；暂存时已逐项校验，请核对后裁决。`,
    proposal: { title, actions: withDerivedEntityNames(staged) },
  })
  await clearStagedActions(path)
  const fresh = stored.at(-1)
  return fresh === undefined ? { count: staged.length } : { id: fresh.id, count: staged.length, entry: fresh }
}
