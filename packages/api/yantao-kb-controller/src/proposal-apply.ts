/**
 * The proposal applier, as the ONE implementation both human channels share
 * (ADR-0060 决定 7): the workbench's ProposalCard and the DingTalk approval
 * card run the same落库链 through this module — the client binds the seams
 * to its remote proxies, the controller binds them to its own methods, and
 * the inbox RPC (`proposalInboxApply`) is the server-side entry both
 * consumers share.
 *
 * The unified proposal schema (ADR-0021 决定 4) moved here with the engine:
 * one shape for everything an agent proposes and a human confirms. A
 * proposal proposes; nothing in this module writes to the KB by itself —
 * applying runs strictly after the human has ticked rows, through the
 * injected {@link ProposalTarget} seams.
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/proposal-apply
 */
import type {
  KbCreatableEntityType, KbDeleteResourceResult, KbMailArchiveResult, KbMailDeleteResult,
  KbMemoryAddResult, KbPersonRelation, KbQueuedProposal, KbSetEntityArchivedResult,
  KbSkillRewriteApplyArgs, KbSkillRewriteApplyResult, KbTodoItem, KbTodosResult, KbWriteTodosArgs,
  KbWriteTodosResult,
} from './types.ts'

/** The entity types `createEntity` accepts, as the controller types them. */
export type ProposalEntityType = KbCreatableEntityType

/** One thing the agent proposes and the human may tick. */
export type ProposalAction =
  | {
    /** Create one entity from the canonical template. */
    readonly kind: 'create-entity'
    readonly entityType: ProposalEntityType
    readonly name: string
    readonly reason: string
    /**
     * The person's relation to the owner, handed to `createEntity` so the
     * frontmatter records what the analysis judged instead of the template's
     * `subordinate` default. Only meaningful for a `person`.
     */
    readonly relation?: KbPersonRelation
    /** The person's e-mail address, written into the frontmatter `email:` field. */
    readonly email?: string
    /**
     * Which analysed mail this came from (ADR-0038): the 1-based batch number,
     * with the mail's subject beside it — the card groups creation rows per
     * source mail, so the human sees which mail asked for which entity.
     */
    readonly mail?: number
    /** That mail's subject line, as the group subtitle the card shows. */
    readonly mailSubject?: string
  }
  | {
    /**
     * Create one project, with the area association in the same confirming
     * breath (ADR-0034 决定 4): the ticked area names are written into the
     * fresh file's frontmatter `areas: []` — the one spot the agent's tools
     * cannot reach but the human channel may. Separate from `create-entity`
     * so the card can group and dress it differently (领域勾选).
     */
    readonly kind: 'create-project'
    readonly name: string
    readonly reason: string
    /** Suggested area names, already filtered to ones the KB holds. */
    readonly areas?: readonly string[]
    /** Which analysed mail this came from — 1-based batch number (ADR-0038). */
    readonly mail?: number
    /** That mail's subject line, as the group subtitle the card shows. */
    readonly mailSubject?: string
  }
  | {
    /** Append one dated bullet to an entity's `## 流水` (the append-only section). */
    readonly kind: 'append-log'
    readonly entityPath: string
    readonly entityName: string
    readonly text: string
    readonly reason: string
    /**
     * When the action targets an entity this same card creates: the create's
     * name. The applier resolves the path as the create runs (ADR-0030) —
     * the create must be ticked and succeed, or the row is skipped.
     */
    readonly afterCreate?: string
    /** Which analysed mail this came from — 1-based batch number (ADR-0038). */
    readonly mail?: number
    /** That mail's subject line, shown on the row's detail (ADR-0038). */
    readonly mailSubject?: string
    /**
     * The resource this statement was distilled from (ADR-0059 决定 1) —
     * mandatory in resource-distillation schedules by convention, enforced
     * by the scheduler's read-closure scan (校验 B); optional at the schema
     * layer because the tool cannot know its caller's context.
     */
    readonly sourcePath?: string
    /** The source's verbatim snippet, when the model quoted one (ADR-0059 决定 1). */
    readonly sourceQuote?: string
  }
  | {
    /** Append one line to an entity's `## 状态`. */
    readonly kind: 'write-state'
    readonly entityPath: string
    readonly entityName: string
    readonly text: string
    readonly reason: string
    /** The distillation source, same convention as `append-log`'s (ADR-0059 决定 1). */
    readonly sourcePath?: string
    /** The source's verbatim snippet (ADR-0059 决定 1). */
    readonly sourceQuote?: string
  }
  | {
    /** Write one file under `resources/` (or anywhere the path names). */
    readonly kind: 'save-resource'
    readonly path: string
    readonly content: string
    readonly reason: string
  }
  | {
    /** Write one `[[…]]` link into an entity's `## 状态` (the backlink is automatic, ADR-0015). */
    readonly kind: 'create-link'
    readonly entityPath: string
    readonly entityName: string
    readonly link: string
    readonly reason: string
    /** Same create-follows-create resolution as `append-log`'s (ADR-0030). */
    readonly afterCreate?: string
    /** The distillation source, same convention as `append-log`'s (ADR-0059 决定 1). */
    readonly sourcePath?: string
    /** The source's verbatim snippet (ADR-0059 决定 1). */
    readonly sourceQuote?: string
  }
  | {
    /** Join one line of work into the todo singleton, under optimistic concurrency. */
    readonly kind: 'add-todo'
    readonly title: string
    readonly due?: string
    readonly body: string
    readonly reason: string
    /** Which analysed mail this came from — 1-based batch number (ADR-0038). */
    readonly mail?: number
    /** That mail's subject line, shown on the row's detail (ADR-0038). */
    readonly mailSubject?: string
  }
  | {
    /**
     * Replace one `## ` section's body in an entity file (ADR-0029 决定 3).
     * `before` is what the model saw (shown on the card); at apply time the
     * file is re-read and the section re-located, so `after` always lands on
     * the current body, never on a snapshot. A section the file does not
     * carry is created (only the human channel may create sections —
     * `kb_edit_section` hard-errors on a missing anchor); `## 流水` is
     * refused at apply time (append-only iron law).
     */
    readonly kind: 'edit-section'
    readonly path: string
    /** The section heading without the `## ` prefix, e.g. `状态`. */
    readonly section: string
    readonly before: string
    readonly after: string
    readonly why: string
    /**
     * When the section lives in an entity this same card creates: the
     * create's name. The applier resolves the path as the create runs
     * (ADR-0030) — the create must be ticked and succeed, or the row is
     * skipped.
     */
    readonly afterCreate?: string
    /** Which analysed mail this came from — 1-based batch number (ADR-0038). */
    readonly mail?: number
    /** That mail's subject line, shown on the row's detail (ADR-0038). */
    readonly mailSubject?: string
  }
  | {
    /**
     * Append one line at the end of a named `## ` section (ADR-0034 决定 4:
     * meeting enrichment lands in 决议/待办). Unlike `edit-section` this never
     * replaces anything — enrichment adds to what the section already holds;
     * a section the file does not carry is created (human channel only).
     */
    readonly kind: 'append-section'
    readonly path: string
    /** The section heading without the `## ` prefix, e.g. `决议`. */
    readonly section: string
    readonly text: string
    readonly why: string
    /** Same create-follows-create resolution as `edit-section`'s (ADR-0030). */
    readonly afterCreate?: string
    /** Which analysed mail this came from — 1-based batch number (ADR-0038). */
    readonly mail?: number
    /** That mail's subject line, shown on the row's detail (ADR-0038). */
    readonly mailSubject?: string
  }
  | {
    /**
     * Remember one behavior rule in a scope (ADR-0032 批次③). The scope is
     * pinned by the UI — the mail analysis's proposals all land in `mail` —
     * so a misjudged rule can never leak into every task as a global memory.
     * The applier routes it through `memoryAdd`; an exact duplicate is
     * rendered as 已记得, not an error.
     */
    readonly kind: 'add-memory'
    readonly scope: string
    readonly text: string
    readonly reason: string
  }
  | {
    /**
     * Move one nominated mail to Outlook's 已删除 folder (ADR-0034 决定 5).
     * The agent only nominates; the knife swings on the human's tick — the
     * applier routes it through the optional `deleteMails` seam, which drives
     * the controller's human-channel-only `verb: 'delete'`. Absent seam ⇒
     * the row is honestly skipped, never silently executed elsewhere.
     */
    readonly kind: 'delete-mails'
    readonly entryId: string
    readonly sender: string
    readonly subject: string
    readonly reason: string
  }
  | {
    /**
     * Save one nominated mail whole (kind id kept as `archive-mails` — stored
     * inbox payloads from before the 2026-10-09 three-nomination merge keep
     * validating): the self-contained `.eml` original *and* its attachments
     * land in `resources/mails/YYYY/MM/`, with one eight-column monthly index
     * row (the model's summary in 摘要). Like the delete knife, the agent only
     * nominates: the applier routes it through the optional `archiveMails`
     * seam, driving the human-channel-only `verb: 'archive'`. Absent seam ⇒
     * the row is honestly skipped.
     */
    readonly kind: 'archive-mails'
    readonly entryId: string
    readonly sender: string
    readonly subject: string
    readonly summary: string
    readonly reason: string
  }
  | {
    /**
     * Rewrite one text file inside a registered capability's directory
     * (ADR-0054). The agent nominates with a full diff envelope (`original`
     * + `new`, 无 diff 不成卡); the card renders the line diff and the
     * human's tick arms the writeback — the optional `skillRewrite` seam
     * drives the controller's `skillRewriteApply`, which backs the pre-write
     * content up and clamps SKILL.md's `metadata.yantao.version` to the
     * original's. Absent seam ⇒ the row is honestly skipped.
     */
    readonly kind: 'skill-rewrite'
    /** The capability's name, as the central routing file keys it. */
    readonly name: string
    /** The file's path relative to the capability's directory. */
    readonly file: string
    /** The file's content as the proposing agent read it — the diff's left side. */
    readonly original: string
    /** The proposed content — the diff's right side. */
    readonly new: string
    /** Why the rewrite is worth a human's attention. */
    readonly why: string
  }

/** One mail the analysis flagged, shown on the card without a checkbox. */
export interface ProposalHighlight {
  /** Who sent it. */
  readonly sender: string
  /** Its subject line. */
  readonly subject: string
  /** One line of why it was flagged. */
  readonly why: string
}

/**
 * The mail range one proposal's task covered (ADR-0047 验收修正 2): the
 * envelope's optional `mails` field, copied by the model from the batch it
 * actually fetched. When the human settles the inbox entry — approving or
 * discarding, the same "seen and judged" sense the manual panel's
 * confirm/dismiss carries — the frame moves the mail watermark past the
 * range, so the next read never re-offers the batch.
 */
export interface ProposalMailRange {
  /** The newest covered mail's `receivedAt` — where the watermark moves to. */
  readonly lastReadAt: string
  /** The oldest covered mail's `receivedAt` — extends the processed range's start. */
  readonly firstReadAt?: string
}

/**
 * One finding of the validate gesture (ADR-0035 决定 3): a pure display row
 * on the card — never ticked, never an action. The fix, when the model
 * proposed one, lives in the action groups on its own.
 */
export interface ProposalFinding {
  /** What kind of finding: `orphan`, `broken-link`, `stale`, `contradiction`, `missing`. */
  readonly kind: string
  /** The entity or link the finding names. */
  readonly subject: string
  /** One line of why. */
  readonly why: string
}

/** One orphan the prescan found, as the deterministic block shows it. */
export interface ProposalOrphan {
  readonly name: string
  readonly type: string
  /** How many links resolve into it. */
  readonly incoming: number
}

/**
 * The validate gesture's deterministic block (ADR-0036 决定 6): everything
 * the code computed and the model never saw — orphan entities, broken links
 * that found no credible fix, and the tickable fix-candidate rows. Kept as
 * its own object so a prescan row and a model row cannot meet in one array;
 * the card renders it above the model block, in a calmer style.
 */
export interface ProposalPrescan {
  /** Entities at most one link resolves into. */
  readonly orphans: readonly ProposalOrphan[]
  /** Broken links (and the 流水/小节外 strays) that degrade to display rows. */
  readonly findings: readonly ProposalFinding[]
  /**
   * The fix-candidate rows, tickable like any action. The applier resolves
   * ticked indices against `[...prescan.actions, ...actions]` — these sit
   * at the front of the execution order.
   */
  readonly actions: readonly ProposalAction[]
}

/** Everything one run proposes; the human ticks actions, not blocks. */
export interface Proposal {
  /** The card's heading — which judgement these actions came from. */
  readonly title: string
  /** One line under the title, e.g. that the session is kept for re-reading. */
  readonly note?: string
  /**
   * The model block's actions, in the order the applier executes them —
   * after any {@link Proposal.prescan} rows, which precede them in the
   * applier's resolution order.
   *
   * Invariant: these rows and `prescan.actions` must be disjoint — both the
   * applier and the card resolve over `[...prescan.actions, ...actions]`
   * (see {@link allProposalActions}), so a row carried in both arrays would
   * render twice and execute twice.
   */
  readonly actions: readonly ProposalAction[]
  /**
   * The 重点提醒 mails: serious, directly addressed, or involving a superior.
   * Informational — they sit above the action groups, never ticked.
   */
  readonly highlights?: readonly ProposalHighlight[]
  /** The 汇总类 mails (邮催、通知), merged into one block instead of per-mail alarms. */
  readonly digest?: readonly ProposalHighlight[]
  /**
   * The KB's area names, offered to the create-project rows' 领域勾选
   * (ADR-0034 决定 4). Absent when the KB holds no areas.
   */
  readonly areas?: readonly string[]
  /**
   * The model block's findings (ADR-0036 决定 6): the diagnostician's
   * semantic rows, styled as before. Deterministic prescan rows live in
   * {@link Proposal.prescan}, never here.
   */
  readonly findings?: readonly ProposalFinding[]
  /**
   * The deterministic prescan block (ADR-0036 决定 2/4/6): zero-token
   * findings and fix candidates, rendered above — and visually apart
   * from — everything the model said. Absent for the other gestures.
   */
  readonly prescan?: ProposalPrescan
  /**
   * The mail range the task covered (ADR-0047 验收修正 2), when the answer's
   * envelope carried one — the inbox verdict moves the mail watermark past
   * it. Absent for non-mail proposals and for envelopes that named no range.
   */
  readonly mails?: ProposalMailRange
}

/**
 * Every tickable row in the applier's execution order: prescan fixes first,
 * then the model's. THE canonical concatenation — the card's tick indices
 * and `applyProposal`'s resolution both read it, so the disjointness
 * contract between the two arrays lives in exactly one place.
 */
export function allProposalActions(proposal: Proposal): readonly ProposalAction[] {
  return [...(proposal.prescan?.actions ?? []), ...proposal.actions]
}

/** Today as a YYYY-MM-DD stamp, in the human's own timezone. */
export function stamp(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const date = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

/* ── the seam types ───────────────────────────────────────────────────────
 * The same seams the panes use, stated once here: the workbench binds them
 * to remote proxies, the controller binds them to its own methods. */

/** Read one KB file's content. */
export type FileReader = (path: string) => Promise<string>

/** Write one KB file's full content. */
export type FileWriter = (path: string, content: string) => Promise<void>

/** Create one entity and resolve its KB-relative path. */
export type EntityCreator = (
  type: KbCreatableEntityType,
  name: string,
  relation?: KbPersonRelation,
  email?: string,
) => Promise<string>

/** Read the todo singleton. */
export type TodoLoader = () => Promise<KbTodosResult>

/** Write the todo singleton under optimistic concurrency. */
export type TodoWriter = (args: KbWriteTodosArgs) => Promise<KbWriteTodosResult>

/** Remember one behavior rule; an exact duplicate is refused. */
export type MemoryAdder = (scope: string, text: string) => Promise<KbMemoryAddResult>

/** Forget one behavior rule by id. */
export type MemoryDeleter = (scope: string, id: string) => Promise<void>

/** Move nominated mails to Outlook's 已删除 folder (ADR-0034 决定 5). */
export type MailDeleter = (ids: readonly string[]) => Promise<KbMailDeleteResult>

/** One mail the archive verb should keep (ADR-0037): EntryID + index summary. */
export type ArchiveMail = { readonly entryId: string; readonly summary?: string }

/** Arm the archive (ADR-0037 决定 2): keep nominated mails as `.eml` + index rows. */
export type Archiver = (mails: readonly ArchiveMail[]) => Promise<KbMailArchiveResult>

/** Write one approved skill rewrite back (ADR-0054). */
export type SkillRewriteApplier = (args: KbSkillRewriteApplyArgs) => Promise<KbSkillRewriteApplyResult>

/** Archive one entity (ADR-0041) — the undo safety net's retract verb. */
export type EntityArchiver = (locator: string) => Promise<KbSetEntityArchivedResult>

/** Delete one resource file under `resources/` (ADR-0020) — undo-only. */
export type ResourceDeleter = (path: string) => Promise<KbDeleteResourceResult>

/** Resolve one entity locator (`type:name` or a path) to its KB-relative path. */
export type EntityResolver = (locator: string) => Promise<string>

/** What the writes need of the KB: the same seams the panes already use. */
export interface ProposalTarget {
  /** Create one entity and resolve its path. */
  readonly createEntity: EntityCreator
  /** Read one KB file's content. */
  readonly read: FileReader
  /** Write one KB file's full content. */
  readonly write: FileWriter
  /** Read the todo singleton. */
  readonly todos: TodoLoader
  /** Write the todo singleton under optimistic concurrency. */
  readonly writeTodos: TodoWriter
  /** Remember one behavior rule (ADR-0032 批次③); an exact duplicate is refused. */
  readonly memoryAdd: MemoryAdder
  /**
   * Move nominated mails to Outlook's 已删除 folder (ADR-0034 决定 5) —
   * optional, because only the human channel carries the knife: a caller
   * without it (the refine loop's target) skips delete-mails rows honestly
   * instead of executing them somewhere unseen.
   */
  readonly deleteMails?: MailDeleter
  /**
   * Save nominated mails (2026-10-09 三提名合一): the `.eml` original plus
   * all attachments land in `resources/mails/` with one monthly index row
   * (ADR-0037 决定 2) — optional, same reason as `deleteMails`.
   */
  readonly archiveMails?: Archiver
  /**
   * Write one approved skill rewrite back (ADR-0054) — optional, same reason
   * as the mail verbs: only the human channel carries the writeback (backup,
   * version clamp, atomic write live in the controller).
   */
  readonly skillRewrite?: SkillRewriteApplier
  /**
   * Archive one entity (the frame's 归档 gesture, ADR-0041) — optional,
   * because it exists only for the undo safety net: a target without it
   * reports created entities as irreversible instead of pretending.
   */
  readonly archiveEntity?: EntityArchiver
  /** Delete one memory entry by id — likewise undo-only, hence optional. */
  readonly memoryDelete?: MemoryDeleter
  /** Delete one resource file — likewise undo-only, hence optional. */
  readonly deleteResource?: ResourceDeleter
  /**
   * Resolve one entity locator (`type:name` or an entity file path) to its
   * KB-relative path — optional: a caller without it keeps the literal-path
   * behavior. The nomination examples teach the locator form, so without
   * this seam an approved `project:某项目` row dies on a literal read
   * (2026-10-13 周报流水事故) — the human channel wires it.
   */
  readonly resolveEntity?: EntityResolver
}

/** True when the failure is the memory duplicate refusal (ADR-0032 批次③). */
export function isDuplicateMemory(error: unknown): boolean {
  return error instanceof Error && error.message.includes('已经存在')
}

/* ── the engine ─────────────────────────────────────────────────────────── */

/** One reversible write's inverse: what it was, and how to take it back. */
export interface ProposalUndoStep {
  /** The written line this step retracts (mirrors the notice's wording). */
  readonly label: string
  /** The inverse operation; throws on failure, one step's failure isolates. */
  readonly run: () => Promise<unknown>
}

/** What a confirmed card left behind that the human can still take back. */
export interface ProposalUndo {
  /** Inverse steps in application order — execute in reverse. */
  readonly steps: readonly ProposalUndoStep[]
  /** Writes that landed but cannot be retracted, named honestly. */
  readonly irreversible: readonly string[]
}

/** One action's settlement record (ADR-0059 决定 5). */
export interface ProposalActionResult {
  /** The action's index in the canonical concatenation the card ticks over. */
  readonly index: number
  /** Whether the write landed. */
  readonly ok: boolean
  /** The failure's reason, verbatim, when `ok` is false. */
  readonly error: string
}

/** What one confirmed card produced. */
export interface ProposalApplyResult {
  /** One line per thing written, for the caller's summary. */
  readonly written: readonly string[]
  /** Actions that could not be written, with the reason. */
  readonly skipped: readonly string[]
  /** Per-action trail (ADR-0059 决定 5), one record per ticked action in index order. */
  readonly perAction: readonly ProposalActionResult[]
  /** Present only when at least one write is reversible. */
  readonly undo?: ProposalUndo
}

/**
 * Raised before the first write when every probeable entity target in the
 * batch is unreachable (ADR-0059 决定 6): an all-unreachable batch is an
 * environmental root cause (the 2026-10-13 incident's stale bundle taught
 * exactly this shape), and per-row skips would bury it — the whole batch is
 * blocked, nothing is written, and the caller keeps the row pending.
 */
export class ProposalPreflightError extends Error {
  /** The failed actions' display lines. */
  readonly unreachable: readonly string[]
  constructor(unreachable: readonly string[]) {
    super(
      `全部 ${unreachable.length} 项实体定位都不可达，本批一字未落。`
      + '此批提议可能产生于旧版客户端，请重启工作台后重试。不可达项：'
      + unreachable.join('；'),
    )
    this.name = 'ProposalPreflightError'
    this.unreachable = unreachable
  }
}

/** One statically-addressable entity target the preflight probes (ADR-0059 决定 6). */
interface ProbeRow {
  readonly index: number
  readonly action: Exclude<ProposalAction, { kind: 'add-todo' }>
  readonly locator: string
}

/**
 * Take back what a confirmed card wrote: the steps run in reverse order (a
 * later write to a file restores over an earlier one, so unwinding must walk
 * back through them), and one failing step is collected, not fatal — the
 * rest of the retraction still lands.
 * @param undo - the undo record `applyProposal` returned.
 * @returns the steps that failed, with reasons.
 */
export async function runUndo(undo: ProposalUndo): Promise<{ readonly failed: readonly string[] }> {
  const failed: string[] = []
  for (let index = undo.steps.length - 1; index >= 0; index -= 1) {
    const step = undo.steps[index] as ProposalUndoStep
    try {
      await step.run()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push(`${step.label}：${message}`)
    }
  }
  return { failed }
}

/**
 * Append one bullet to an entity's `## 流水` — the append-only section, which
 * is why this is an append and not a rewrite.
 * @param content - the file's current content.
 * @param note - the line to add.
 * @returns the new content.
 */
export function appendLog(content: string, note: string): string {
  return `${content.replace(/\s*$/, '')}\n- ${stamp()} ${note}\n`
}

/**
 * Append one line at the end of a markdown section: after the section's
 * heading, before the next heading of the same or higher level. A section the
 * file does not carry (a human may have deleted it) falls back to appending
 * at the end of the file — the line is not lost to a missing heading.
 * @param content - the file's current content.
 * @param heading - the section heading to insert into, e.g. `## 状态`.
 * @param text - the line(s) to insert.
 * @returns the new content.
 */
export function insertIntoSection(content: string, heading: string, text: string): string {
  const lines = content.replace(/\s*$/, '').split('\n')
  const start = lines.findIndex(line => line.trim() === heading)
  if (start === -1) return `${content.replace(/\s*$/, '')}\n${text}\n`
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2} /.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  let sectionEnd = end
  while (sectionEnd > start + 1 && lines[sectionEnd - 1]?.trim() === '') sectionEnd -= 1
  return [...lines.slice(0, sectionEnd), text, ...lines.slice(sectionEnd), ''].join('\n')
}

/**
 * Write one line into an entity's `## 状态`, creating the section when the
 * file does not carry it — ahead of `## 流水` (the append-only journal stays
 * last), or at the end when there is no `## 流水` either.
 * @param content - the file's current content.
 * @param text - the line to write.
 * @returns the new content.
 */
export function insertIntoStateSection(content: string, text: string): string {
  const lines = content.replace(/\s*$/, '').split('\n')
  if (lines.some(line => line.trim() === '## 状态')) return insertIntoSection(content, '## 状态', text)
  const block = ['', '## 状态', '', text, '']
  const flow = lines.findIndex(line => line.trim() === '## 流水')
  if (flow === -1) return [...lines, ...block].join('\n')
  return [...lines.slice(0, flow), ...block, ...lines.slice(flow)].join('\n')
}

/**
 * Replace one markdown section's body: everything between the section's
 * heading and the next heading of the same or higher level becomes `after`.
 * A heading the file does not carry creates the section at the end of the
 * file — only the human channel may create sections (`kb_edit_section`
 * hard-errors on a missing anchor, ADR-0026), and this runs on the human
 * channel after the tick. A heading carried twice is an error, not a guess.
 * @param content - the file's current content.
 * @param heading - the full section heading, e.g. `## 状态`.
 * @param after - the new body (trimmed of surrounding blank lines).
 * @returns the new content.
 */
export function replaceSection(content: string, heading: string, after: string): string {
  const lines = content.replace(/\s*$/, '').split('\n')
  const starts: number[] = []
  for (const [index, line] of lines.entries()) {
    if (line.trim() === heading) starts.push(index)
  }
  if (starts.length === 0) {
    return `${content.replace(/\s*$/, '')}\n\n${heading}\n\n${after.trim()}\n`
  }
  if (starts.length > 1) throw new Error(`小节 ${heading} 在文件中出现 ${starts.length} 次，无法定位`)
  const start = starts[0] as number
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2} /.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  return [...lines.slice(0, start + 1), '', after.trim(), ...lines.slice(end), ''].join('\n')
}

/** The label one written action reports, for the caller's summary. */
function writtenLine(action: ProposalAction): string {
  switch (action.kind) {
    case 'create-entity': return `实体 ${action.name}`
    case 'create-project': return `项目 ${action.name}`
    case 'append-log': return `项目动态 ${action.entityName}`
    case 'write-state': return `状态 ${action.entityName}`
    case 'save-resource': return `资源 ${action.path}`
    case 'create-link': return `关联 ${action.entityName} → ${action.link}`
    case 'add-todo': return `待办 ${action.title}`
    // A create-following section action carries no path until the applier
    // resolves it; the create's name is what the human ticked.
    case 'edit-section': return `章节 ${action.section}（${action.path !== '' ? action.path : action.afterCreate ?? ''}）`
    case 'append-section': return `章节 ${action.section}（${action.path !== '' ? action.path : action.afterCreate ?? ''}）`
    case 'add-memory': return `记忆（${action.scope}）${action.text}`
    case 'delete-mails': return `删除邮件 ${action.subject}`
    case 'archive-mails': return `保存邮件 ${action.subject}`
    case 'skill-rewrite': return `技能改写 ${action.name}/${action.file}`
  }
}

/** The message one failed action reports, for the card's 标红 list. */
function failedLine(action: ProposalAction, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${writtenLine(action)}：${message}`
}

/**
 * Write everything the human ticked, in index order.
 *
 * Todos go through one `writeTodos` call carrying the text the board last
 * read, so a concurrent edit in Obsidian is reported rather than clobbered
 * (ADR-0018). An entity action whose path could not be resolved at proposal
 * time (`entityPath: ''`) is skipped, not guessed: the prompt told the model
 * to match existing names, and guessing a filename is worse than reporting
 * the miss.
 * @param options - the proposal, the ticked indexes, the create-project rows'
 *   adjusted 领域勾选 keyed by action index (absent: keep the model's
 *   suggestion, ADR-0034 决定 4), and the KB seams.
 * @returns what was written, what was skipped, and the per-action trail
 *   (ADR-0059 决定 5) the caller settles the card with. Throws
 *   {@link ProposalPreflightError} before the first write when every
 *   probeable entity target is unreachable (ADR-0059 决定 6).
 */
export async function applyProposal(options: {
  readonly proposal: Proposal
  readonly ticked: readonly number[]
  readonly areaPicks?: Readonly<Record<number, readonly string[]>>
  readonly target: ProposalTarget
}): Promise<ProposalApplyResult> {
  const { proposal, ticked, target } = options
  // The canonical concatenation (ADR-0036 决定 6): the card ticks indices
  // over this same order, so one resolution serves both blocks.
  const allActions = allProposalActions(proposal)
  const picked = ticked
    // Out-of-range indices cannot arise from the card (both sides derive
    // from the same arrays); a stale one is dropped, not guessed at.
    .map(index => ({ index, action: allActions[index] }))
    .filter((row): row is { index: number; action: ProposalAction } => row.action !== undefined)
  const written: string[] = []
  const skipped: string[] = []
  // Per-action settlement trail (ADR-0059 决定 5): every ticked action is ok
  // unless one of its failure sites marked it; the todos batch settles as a
  // whole further down.
  const failures = new Map<number, string>()
  const failAction = (index: number, message: string): void => {
    if (!failures.has(index)) failures.set(index, message)
  }
  const reportedWarnings = new Set<string>()
  // The undo safety net: every branch that can be taken back records its
  // inverse here; the knife kinds (mails) and the append-only 流水 name
  // themselves irreversible instead.
  const undoSteps: ProposalUndoStep[] = []
  const irreversible: string[] = []

  const todos = picked
    .map(row => row.action)
    .filter((action): action is Extract<ProposalAction, { kind: 'add-todo' }> => action.kind === 'add-todo')
  // An explicit predicate: TS 5.5 only infers one when the check narrows the
  // parameter itself, and here the discriminant sits on `row.action`.
  const rest = picked.filter(
    (row): row is { index: number; action: Exclude<ProposalAction, { kind: 'add-todo' }> } =>
      row.action.kind !== 'add-todo',
  )

  // ADR-0059 决定 6, the dry-run: resolve every statically-addressable
  // entity target before the first write. All-unreachable blocks the batch
  // (an environmental root cause — the row stays pending for a restart);
  // partially unreachable marks its rows dead and lets the rest land (个案
  // 容错不连坐，ADR-0037 决定 7's precedent). Resolved paths are cached —
  // the main loop reuses them instead of paying the RPC twice.
  let live = rest
  const prefetched = new Map<number, string>()
  if (target.resolveEntity !== undefined) {
    const resolver = target.resolveEntity
    const probeable = rest
      .map((row): ProbeRow | null => {
        const action = row.action
        if ((action.kind === 'append-log' || action.kind === 'write-state' || action.kind === 'create-link')
          && action.entityPath !== '') {
          return { index: row.index, action: row.action, locator: action.entityPath }
        }
        if ((action.kind === 'edit-section' || action.kind === 'append-section') && action.path !== '') {
          return { index: row.index, action: row.action, locator: action.path }
        }
        return null
      })
      .filter((row): row is ProbeRow => row !== null)
    if (probeable.length > 0) {
      const probed = await Promise.all(probeable.map(async probe => ({
        index: probe.index,
        label: writtenLine(probe.action),
        path: await resolver(probe.locator).catch(() => null),
      })))
      const dead = probed.filter(entry => entry.path === null)
      if (dead.length === probed.length) {
        throw new ProposalPreflightError(dead.map(entry => entry.label))
      }
      if (dead.length > 0) {
        const deadIndexes = new Set(dead.map(entry => entry.index))
        live = rest.filter(row => !deadIndexes.has(row.index))
        for (const entry of dead) {
          skipped.push(`${entry.label}：实体定位不可达（入笔前预检）`)
          failures.set(entry.index, '实体定位不可达')
        }
      }
      for (const entry of probed) {
        if (entry.path !== null) prefetched.set(entry.index, entry.path)
      }
    }
  }

  // The paths of the entities this very card created, by name: a create's own
  // edits, links, and log follow it (ADR-0030). A create that was not ticked
  // or that failed leaves no entry, and its followers are skipped, not guessed.
  const created = new Map<string, string>()
  const resolveAfterCreate = (name: string): string | undefined => created.get(name)

  for (const { index, action } of live) {
    try {
      if (action.kind === 'create-entity') {
        // Only the mail path names a person's address; its analysis also
        // judges the relation, which must ride along or the template's
        // `subordinate` default records every person as a 下属.
        const path = await target.createEntity(
          action.entityType,
          action.name,
          action.relation,
          ...action.email !== undefined ? [action.email] : [],
        )
        created.set(action.name, path)
        written.push(writtenLine(action))
        // Undo retracts a fresh entity by archiving it — recoverable, never
        // a delete; a target without the verb reports honestly instead.
        if (target.archiveEntity !== undefined) {
          const archiver = target.archiveEntity
          undoSteps.push({ label: writtenLine(action), run: () => archiver(path) })
        } else {
          irreversible.push(writtenLine(action))
        }
        continue
      }
      if (action.kind === 'create-project') {
        const path = await target.createEntity('project', action.name)
        created.set(action.name, path)
        // ADR-0034 决定 4: the area association rides in the same confirming
        // breath, so no orphan project is born. The template emits
        // `areas: []`; a file without that line (a user-template quirk) is
        // reported, not guessed at.
        const areas = options.areaPicks?.[index] ?? action.areas ?? []
        if (areas.length > 0) {
          try {
            const content = await target.read(path)
            if (!/^areas: \[\][ \t]*$/m.test(content)) throw new Error('frontmatter 里没有 areas: [] 可写')
            await target.write(
              path,
              content.replace(/^areas: \[\][ \t]*$/m, `areas: [${areas.map(area => JSON.stringify(area)).join(', ')}]`),
            )
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            skipped.push(`项目 ${action.name} 的领域关联：${message}`)
          }
        }
        written.push(writtenLine(action))
        // The 领域 association rode the same breath into the same fresh
        // file — archiving the entity retracts both.
        if (target.archiveEntity !== undefined) {
          const archiver = target.archiveEntity
          undoSteps.push({ label: writtenLine(action), run: () => archiver(path) })
        } else {
          irreversible.push(writtenLine(action))
        }
        continue
      }
      if (action.kind === 'save-resource') {
        if (action.path.endsWith('/.md')) {
          skipped.push(`资源「${action.reason}」：名字不能作为文件名`)
          failAction(index, '名字不能作为文件名')
          continue
        }
        // A resource that already exists rolls back to its prior bytes; a
        // fresh one is removed outright. "Fresh" is only what the read RPC
        // answers with its not-found code — anything else (a binary
        // occupant's `yantao-kb/binary`, a transient IO failure) means the
        // path is occupied but unreadable, never classifiable as fresh: the
        // step goes to the irreversible bucket rather than to a deleting
        // undo that could destroy a file the read simply could not see.
        let existing: string | undefined
        let knownFresh = false
        try {
          existing = await target.read(action.path)
        } catch (error: unknown) {
          // Shape-guard before reading `.code`: a rejection with null or a
          // primitive must degrade to "occupied, unreadable", not blow up
          // inside this catch and garble the row's report.
          knownFresh = typeof error === 'object' && error !== null
            && (error as { code?: unknown }).code === 'yantao-kb/not-found'
          existing = undefined
        }
        await target.write(action.path, action.content)
        written.push(writtenLine(action))
        if (existing !== undefined) {
          const path = action.path
          const prior = existing
          undoSteps.push({ label: writtenLine(action), run: () => target.write(path, prior) })
        } else if (knownFresh && target.deleteResource !== undefined) {
          const remover = target.deleteResource
          undoSteps.push({ label: writtenLine(action), run: () => remover(action.path) })
        } else {
          irreversible.push(writtenLine(action))
        }
        continue
      }
      if (action.kind === 'add-memory') {
        // ADR-0032 批次③: the host refuses an exact duplicate — that is the
        // rule already being remembered, which reads as 已记得, not a failure;
        // the trail counts it ok.
        try {
          const added = await target.memoryAdd(action.scope, action.text)
          written.push(writtenLine(action))
          if (target.memoryDelete !== undefined) {
            const remover = target.memoryDelete
            const scope = action.scope
            undoSteps.push({ label: writtenLine(action), run: () => remover(scope, added.entry.id) })
          } else {
            irreversible.push(writtenLine(action))
          }
        } catch (error: unknown) {
          if (isDuplicateMemory(error)) {
            skipped.push(`${writtenLine(action)}：已记得，无需重记`)
          } else {
            const message = error instanceof Error ? error.message : String(error)
            skipped.push(failedLine(action, error))
            failAction(index, message)
          }
        }
        continue
      }
      if (action.kind === 'delete-mails') {
        // ADR-0034 决定 5: the agent nominated, the human ticked; the knife
        // itself is the controller's human-channel-only delete verb. One mail
        // per call keeps the report per-row — a batch miss marks only its own
        // row, not the group.
        const deleter = target.deleteMails
        if (deleter === undefined) {
          skipped.push(`${writtenLine(action)}：这条通道没有挂删除刀`)
          failAction(index, '这条通道没有挂删除刀')
          continue
        }
        const outcome: KbMailDeleteResult = await deleter([action.entryId])
        if (outcome.moved.includes(action.entryId)) {
          written.push(writtenLine(action))
          // The knife has no sheath: Outlook's 已删除 folder is not ours to
          // reach into, so a retraction cannot be promised here.
          irreversible.push(writtenLine(action))
        } else if (outcome.missing.includes(action.entryId)) {
          skipped.push(`${writtenLine(action)}：邮箱里找不到这封邮件（可能已被移走）`)
          failAction(index, '邮箱里找不到这封邮件（可能已被移走）')
        } else {
          const failure = outcome.failed.find(entry => entry.id === action.entryId)
          const message = failure?.message ?? '未知原因'
          skipped.push(`${writtenLine(action)}：${message}`)
          failAction(index, message)
        }
        continue
      }
      if (action.kind === 'archive-mails') {
        // ADR-0037 决定 2 + 2026-10-09 三提名合一: the agent nominated, the
        // human ticked; the save itself is the controller's human-channel-only
        // archive verb — .eml 原件与全部附件一起落盘，一行索引。One mail per
        // call keeps the report per-row, same as the delete knife.
        const archiver = target.archiveMails
        if (archiver === undefined) {
          skipped.push(`${writtenLine(action)}：这条通道没有挂保存动词`)
          failAction(index, '这条通道没有挂保存动词')
          continue
        }
        const outcome: KbMailArchiveResult = await archiver([{ entryId: action.entryId, summary: action.summary }])
        const saved = outcome.saved.find(entry => entry.entryId === action.entryId)
        if (saved !== undefined) {
          const parts = [saved.path, ...saved.attachments]
          const suffix = saved.remark !== '' ? `（${saved.remark}）` : ''
          written.push(`${writtenLine(action)} → ${parts.join('；')}${suffix}`)
          // Same honesty as delete-mails: the save box is not ours to
          // reach back into within an undo window.
          irreversible.push(writtenLine(action))
        } else if (outcome.oversized.some(entry => entry.entryId === action.entryId)) {
          // Over the 25 MB cap: the original was refused, but the index row
          // was written (决定 9) and the attachments still landed — the
          // human asked for a record, and got one.
          written.push(`${writtenLine(action)}：原件过大未存（已记入索引，附件照存）`)
        } else if (outcome.missing.includes(action.entryId)) {
          skipped.push(`${writtenLine(action)}：邮箱里找不到这封邮件（可能已被移走）`)
          failAction(index, '邮箱里找不到这封邮件（可能已被移走）')
        } else {
          const skip = outcome.skipped.find(entry => entry.id === action.entryId)
          const failure = outcome.failed.find(entry => entry.id === action.entryId)
          const message = skip?.reason ?? failure?.message ?? '未知原因'
          skipped.push(`${writtenLine(action)}：${message}`)
          failAction(index, message)
        }
        // 降级/环境类提示（缺转换器、单封降级）是给人看的批级信息，此前落
        // 在结果里无人消费；并入报告且去重，避免同一条提示随行重复刷屏。
        for (const warning of outcome.warnings) {
          if (!reportedWarnings.has(warning)) {
            reportedWarnings.add(warning)
            skipped.push(warning)
          }
        }
        continue
      }
      if (action.kind === 'skill-rewrite') {
        // ADR-0054: the agent nominated with a full diff envelope, the human
        // ticked; the writeback itself is the controller's human-channel-only
        // RPC — it re-checks routing and confinement, refuses a drifted
        // `original`, backs the pre-write bytes up and clamps the SKILL.md
        // version before landing the new content atomically.
        const applier = target.skillRewrite
        if (applier === undefined) {
          skipped.push(`${writtenLine(action)}：这条通道没有挂技能写回动词`)
          failAction(index, '这条通道没有挂技能写回动词')
          continue
        }
        const outcome: KbSkillRewriteApplyResult = await applier({
          name: action.name, file: action.file, original: action.original, new: action.new,
        })
        const suffix = outcome.backupPath !== undefined ? `（原内容已备份 → ${outcome.backupPath}）` : ''
        written.push(`${writtenLine(action)}${suffix}`)
        // The rewrite is a done deed on disk: the undo window cannot promise
        // a restore (the inbox entry keeps the original bytes, and the
        // backup is the human's fallback), so it names itself irreversible.
        irreversible.push(writtenLine(action))
        continue
      }
      if (action.kind === 'edit-section') {
        // Domain data, not UI copy: `## 流水` is the glossary's append-only
        // section; the human channel must not become its bypass (ADR-0029).
        const heading = action.section.startsWith('#') ? action.section : `## ${action.section}`
        if (heading === '## 流水') {
          skipped.push(`${writtenLine(action)}：流水只增不改`)
          failAction(index, '流水只增不改')
          continue
        }
        // A create-following edit lands in the freshly created entity; an
        // unticked or failed create leaves nothing to edit.
        let path = action.path
        if (path === '' && action.afterCreate !== undefined) {
          const fresh = resolveAfterCreate(action.afterCreate)
          if (fresh === undefined) {
            skipped.push(`${writtenLine(action)}：前置的新建「${action.afterCreate}」没有落地`)
            failAction(index, `前置的新建「${action.afterCreate}」没有落地`)
            continue
          }
          path = fresh
        }
        // The same locator normalization the entity-bodied kinds get
        // (ADR-0059 决定 6's preflight caches the resolved path).
        if (action.path !== '' && target.resolveEntity !== undefined) {
          path = prefetched.get(index) ?? await target.resolveEntity(path)
        }
        // Re-read at apply time: the proposal's `before` may be stale — the
        // section is re-located in the current file, never snapshot-written.
        const content = await target.read(path)
        await target.write(path, replaceSection(content, heading, action.after))
        written.push(writtenLine(action))
        undoSteps.push({ label: writtenLine(action), run: () => target.write(path, content) })
        continue
      }
      if (action.kind === 'append-section') {
        // Same iron law as edit-section: the human channel never becomes the
        // 流水 bypass (ADR-0029).
        const heading = action.section.startsWith('#') ? action.section : `## ${action.section}`
        if (heading === '## 流水') {
          skipped.push(`${writtenLine(action)}：流水只增不改`)
          failAction(index, '流水只增不改')
          continue
        }
        let path = action.path
        if (path === '' && action.afterCreate !== undefined) {
          const fresh = resolveAfterCreate(action.afterCreate)
          if (fresh === undefined) {
            skipped.push(`${writtenLine(action)}：前置的新建「${action.afterCreate}」没有落地`)
            failAction(index, `前置的新建「${action.afterCreate}」没有落地`)
            continue
          }
          path = fresh
        }
        if (path === '') {
          skipped.push(`${writtenLine(action)}：知识库里没有这个实体`)
          failAction(index, '知识库里没有这个实体')
          continue
        }
        if (action.path !== '' && target.resolveEntity !== undefined) {
          path = prefetched.get(index) ?? await target.resolveEntity(path)
        }
        // Re-read at apply time and append at the section's end: enrichment
        // adds to what the section holds, it never replaces (ADR-0034 决定 4).
        const content = await target.read(path)
        await target.write(path, insertIntoSection(content, heading, action.text))
        written.push(writtenLine(action))
        undoSteps.push({ label: writtenLine(action), run: () => target.write(path, content) })
        continue
      }
      // The entity-bodied kinds: an unresolved path is reported, not written.
      let entityPath = action.entityPath
      if (entityPath === '' && 'afterCreate' in action && typeof action.afterCreate === 'string') {
        const fresh = resolveAfterCreate(action.afterCreate)
        if (fresh === undefined) {
          skipped.push(`${writtenLine(action)}：前置的新建「${action.afterCreate}」没有落地`)
          failAction(index, `前置的新建「${action.afterCreate}」没有落地`)
          continue
        }
        entityPath = fresh
      }
      if (entityPath === '') {
        skipped.push(`实体 ${action.entityName}：知识库里没有这个实体`)
        failAction(index, '知识库里没有这个实体')
        continue
      }
      // Locator normalization (2026-10-13 周报流水事故): the examples teach
      // `project:某项目`, which a literal read cannot find — resolve it to
      // the entity's real path first. A target without the seam (the refine
      // loop) keeps the literal-path behavior; a locator that resolves to
      // nothing fails the read below and is skipped, never guessed. The
      // preflight (决定 6) already resolved the statically-addressable rows —
      // reuse its answer instead of paying the RPC twice.
      if (target.resolveEntity !== undefined) {
        entityPath = prefetched.get(index) ?? await target.resolveEntity(entityPath)
      }
      const content = await target.read(entityPath)
      if (action.kind === 'append-log') {
        await target.write(entityPath, appendLog(content, action.text))
        // 流水只增不改 (ADR-0029): even a byte-exact restore is a rewrite of
        // the journal, so the undo net never promises one back.
        irreversible.push(writtenLine(action))
      } else {
        // Domain data, not UI copy: `## 状态` is the KB's own section heading
        // (the glossary's 状态), independent of the workbench locale. A file
        // without the section gets it created (ahead of `## 流水`) — never a
        // bare line stranded at the file's end.
        const line = action.kind === 'create-link' ? action.link : action.text
        await target.write(entityPath, insertIntoStateSection(content, line))
        undoSteps.push({ label: writtenLine(action), run: () => target.write(entityPath, content) })
      }
      written.push(writtenLine(action))
    } catch (error) {
      // One failed action is marked, not fatal: the rest of the human's
      // ticks still land (ADR-0029 决定 4) — and the trail records it
      // (ADR-0059 决定 5).
      const message = error instanceof Error ? error.message : String(error)
      skipped.push(failedLine(action, error))
      failAction(index, message)
    }
  }

  if (todos.length > 0) {
    try {
      const current: KbTodosResult = await target.todos()
      const items: readonly KbTodoItem[] = todos.map(todo => ({
        done: false,
        title: todo.title,
        body: todo.body,
        extra: [],
        ...todo.due !== undefined ? { due: todo.due } : {},
      }))
      const result: KbWriteTodosResult = await target.writeTodos({
        items: [...current.items, ...items],
        expectedText: current.text,
      })
      written.push(`待办 ${todos.length} 条（${result.path}）`)
      // Retraction reads the board afresh and lifts the just-added titles —
      // matched from the end, so a repeated title lifts its own twin first.
      undoSteps.push({
        label: `待办 ${todos.length} 条`,
        run: async () => {
          const now: KbTodosResult = await target.todos()
          let remaining = [...now.items]
          for (const todo of [...todos].reverse()) {
            let at = -1
            for (let index = remaining.length - 1; index >= 0; index -= 1) {
              if (remaining[index]?.title === todo.title) { at = index; break }
            }
            if (at >= 0) remaining = [...remaining.slice(0, at), ...remaining.slice(at + 1)]
          }
          await target.writeTodos({ items: remaining, expectedText: now.text })
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      skipped.push(`待办 ${todos.length} 条：${message}`)
      // The batch is the unit of settlement here (ADR-0018's optimistic
      // concurrency): one failure marks every todo row in the trail.
      for (const row of picked) {
        if (row.action.kind === 'add-todo') failAction(row.index, message)
      }
    }
  }

  const perAction = picked.map((row): ProposalActionResult => {
    const error = failures.get(row.index)
    return error === undefined
      ? { index: row.index, ok: true, error: '' }
      : { index: row.index, ok: false, error }
  })

  return {
    written,
    skipped,
    perAction,
    ...(undoSteps.length > 0 ? { undo: { steps: undoSteps, irreversible } } : {}),
  }
}

/* ── the inbox RPC's wire shapes (ADR-0060 决定 7) ────────────────────────
 * The server-side entry both human channels share. The preflight block is a
 * RESULT VARIANT, not a thrown error: an `instanceof` class cannot survive
 * the RPC serialization, so the caller discriminates on `kind` instead. */

/** The wire-safe projection of {@link ProposalApplyResult} an RPC may carry
 * (ADR-0060 决定 7): the undo's inverse steps are closures bound to the
 * controller's own seams — they live in the server-side stash and never
 * cross the boundary; the wire keeps only the reversible-presence and the
 * irreversible names the 撤销 chip renders. */
export type KbProposalApplyTrail = {
  /** One line per thing written, for the caller's summary. */
  readonly written: readonly string[]
  /** Actions that could not be written, with the reason. */
  readonly skipped: readonly string[]
  /** Per-action trail (ADR-0059 决定 5), one record per ticked action in index order. */
  readonly perAction: readonly ProposalActionResult[]
  /** Present only when at least one write is reversible (its steps stay server-side). */
  readonly undo?: { readonly irreversible: readonly string[] }
}

/** Parameters of `yantaoKb.proposalInboxApply` (ADR-0060 决定 7). */
export interface KbProposalInboxApplyArgs {
  /** The pending inbox entry to apply. */
  readonly id: string
  /** The ticked action indices; absent means every action (a card 批准 button ticks all). */
  readonly ticked?: readonly number[]
  /** The create-project rows' adjusted 领域勾选, keyed by action index (ADR-0034 决定 4). */
  readonly areaPicks?: Readonly<Record<number, readonly string[]>>
}

/** What one inbox apply turned out to be. */
export type KbProposalInboxApplyResult = {
  /** The writes ran and the row settled — in the SAME call (apply+settle in one RPC). */
  readonly kind: 'applied'
  /** The three-way settlement (ADR-0059 决定 5), computed server-side. */
  readonly status: 'approved' | 'approved-with-errors' | 'failed'
  /** The applier's trail, projected wire-safe (undo steps stay in the server stash), for the written report and the undo chip. */
  readonly apply: KbProposalApplyTrail
  /** The full list as stored after the settle. */
  readonly proposals: readonly KbQueuedProposal[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
} | {
  /** Every probeable entity target was unreachable (ADR-0059 决定 6); nothing was written and the row stays pending. */
  readonly kind: 'preflight-blocked'
  /** The block's own remedy text (names the restart). */
  readonly message: string
  /** The failed locators' display lines. */
  readonly unreachable: readonly string[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
} | {
  /** The row was already decided (a repeated card callback, a double-click) — idempotent no-op. */
  readonly kind: 'already-decided'
  /** The decision it already carries. */
  readonly status: KbQueuedProposal['status']
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Parameters of `yantaoKb.proposalInboxUndo` (ADR-0060 决定 7). */
export interface KbProposalInboxUndoArgs {
  /** The entry whose apply is being taken back. */
  readonly id: string
}

/** What the server-side undo managed. */
export interface KbProposalInboxUndoResult {
  /** Steps that could not be retracted, `标签：原因` each — mirrors the client's `runUndo`. */
  readonly failed: readonly string[]
  /** Writes that were never retractable, named honestly. */
  readonly irreversible: readonly string[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}
