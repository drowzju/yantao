/**
 * Wire payload vocabulary for the yantaoKb Remote namespace. Every value is
 * plain JSON: paths are KB-relative with forward slashes, and section labels
 * stay out of the payload (the Client owns its locale).
 * @module @deepseek-ai/dsh-api-yantao-kb-controller/types
 */
// The relation vocabulary is the KB domain's, not this package's: one list,
// read by the agent's tool and by the workbench's picker alike.
import type { PersonRelation } from '@deepseek-ai/dsh-yantao-kb'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** One file row in a KB tree section. */
export interface KbTreeFile {
  /**
   * Display name (file basename; entity notes drop the `.md` suffix; a
   * resource nested under `resources/` carries its directory prefix).
   */
  readonly name: string
  /** KB-relative path with forward slashes. */
  readonly path: string
  /** Present (and true) when the entity's frontmatter carries `archive: true`. */
  readonly archived?: boolean
  /** For a resource: the path of its companion note, when one exists. */
  readonly notePath?: string
  /** For a person entity: the declared relation, when present. */
  readonly relation?: string
  /** For a person entity: the declared e-mail address, when present. */
  readonly email?: string
}

/**
 * Stable section identifiers across both trees. The intake tree carries
 * `resources` + `todos`, the workspace tree `projects` + `areas` + `people`
 * + `meetings` — one union keeps the Client's label map total.
 */
export type KbTreeSectionId = 'resources' | 'meetings' | 'todos' | 'projects' | 'areas' | 'people'

/** One KB tree section. */
export interface KbTreeSection {
  /** Stable section id (the Client maps it to a localized label). */
  readonly id: KbTreeSectionId
  /** Files in the section, in directory read order. */
  readonly files: readonly KbTreeFile[]
}

/** One KB tree payload: the sections of the intake or the workspace side, in display order. */
export interface KbTree {
  /** The sections of this tree, every one present even when empty. */
  readonly sections: readonly KbTreeSection[]
}

/** Result of `yantaoKb.read`. */
export interface KbFileContent {
  /** The KB-relative path that was read. */
  readonly path: string
  /** The file's complete UTF-8 content. */
  readonly content: string
}

/** Result of `yantaoKb.write`. */
export interface KbWriteResult {
  /** The KB-relative path that was written. */
  readonly path: string
}

/**
 * Result of `yantaoKb.readResourceBinary` (ADR-0048 决定 3): one image's
 * complete bytes for the reading view. The client turns them into a Blob URL
 * (the ADR-0046 pattern); the RPC returns base64 rather than introducing an
 * HTTP byte-stream route.
 */
export interface KbResourceBinary {
  /** The KB-relative path that was read. */
  readonly path: string
  /** The image's MIME type, e.g. `image/png`. */
  readonly mime: string
  /** The complete file content, base64-encoded. */
  readonly base64: string
  /** Byte length of the decoded content. */
  readonly size: number
}

/** One attachment of a parsed `.eml` view — the listing only, never the content (ADR-0046 取舍台账第 2 行). */
export interface KbEmlAttachment {
  /** The attachment's filename, when the mail carries one. */
  readonly name: string
  /** Its MIME type, e.g. `application/pdf`. */
  readonly contentType: string
  /** Its size in bytes. */
  readonly size: number
}

/**
 * The human render view of one read-only file (ADR-0046 决定 3): the
 * `readResourceView` answer, discriminated so the workbench picks a renderer
 * per kind instead of sniffing extensions again client-side.
 */
export type KbResourceView =
  | { readonly kind: 'text'; readonly path: string; readonly content: string }
  | { readonly kind: 'html'; readonly path: string; readonly content: string }
  | { readonly kind: 'pdf'; readonly path: string; readonly base64: string; readonly size: number }
  | {
    readonly kind: 'eml'
    readonly path: string
    readonly subject?: string
    readonly from?: string
    readonly to?: string
    readonly date?: string
    readonly html?: string
    readonly text?: string
    readonly attachments: readonly KbEmlAttachment[]
  }

/** Parameters of `yantaoKb.setRelation`. */
export interface KbSetRelationArgs {
  /** KB-relative path of the person entity. */
  readonly path: string
  /** The relation to write into its frontmatter. */
  readonly relation: PersonRelation
}

/** Result of `yantaoKb.setRelation`. */
export interface KbSetRelationResult {
  /** The KB-relative path that was rewritten. */
  readonly path: string
  /** The relation the file now carries. */
  readonly relation: PersonRelation
}

/** Result of `yantaoKb.archiveEntity` / `yantaoKb.restoreEntity` (ADR-0041 决定 6). */
export interface KbSetEntityArchivedResult {
  /** The KB-relative path of the entity whose flag flipped. */
  readonly path: string
  /** The archive flag now in effect: true after archiving, false after restoring. */
  readonly archived: boolean
}

/** Result of `yantaoKb.resolveEntity` — the proposal applier's locator normalization. */
export interface KbResolveEntityResult {
  /** The KB-relative path of the entity file the locator names. */
  readonly path: string
}

/** The answer to one resource deletion — the workbench's 「删除」 gesture. */
export interface KbDeleteResourceResult {
  /** The KB-relative path of the resource that no longer exists. */
  readonly path: string
}

/**
 * One `[[…]]` link a file writes out, and where it lands (ADR-0015). The
 * `KbWire` prefix keeps the name unique across the workspace — the kb
 * package's own parser declares the same shape as `KbLinkTarget`, and the
 * catalog generator drops any name declared twice.
 */
export interface KbWireLinkTarget {
  /** The target as written between the brackets. */
  readonly target: string
  /** The resolved KB-relative path; null when it names zero or several files. */
  readonly path: string | null
}

/** One file that links into another (ADR-0015). */
export interface KbWireLinkSource {
  /** KB-relative path of the linking file. */
  readonly from: string
  /** The target that file wrote. */
  readonly target: string
}

/** Result of `yantaoKb.links`: both halves of one file's link graph. */
export interface KbLinksResult {
  /** The file the graph was computed for. */
  readonly path: string
  /** What it links out to, in document order. */
  readonly outgoing: readonly KbWireLinkTarget[]
  /** What links into it. */
  readonly incoming: readonly KbWireLinkSource[]
}

/** One directed edge of the whole-KB `[[…]]` link graph (ADR-0035). */
export interface KbWireGraphEdge {
  /** KB-relative path of the linking file. */
  readonly from: string
  /** The target as written inside the brackets. */
  readonly target: string
  /** The resolved KB-relative path, or null when it names zero or several files. */
  readonly to: string | null
}

/** Result of `yantaoKb.graph`: the whole KB's link graph in one payload (ADR-0035). */
export interface KbGraphResult {
  /** Every entity file, as KB-relative paths, in type-then-directory order. */
  readonly nodes: readonly string[]
  /** Every `[[…]]` occurrence outside fenced blocks; self-links are dropped. */
  readonly edges: readonly KbWireGraphEdge[]
}

/** One typed relation edge of the whole-KB relation graph (ADR-0049). */
export interface KbWireRelationEdge {
  /** One endpoint, normalized: the person (or area) half of a cross-kind pair. */
  readonly from: string
  /** The other endpoint: the project half of a cross-kind pair. */
  readonly to: string
  /** Which relation this edge carries. */
  readonly kind: 'person-project' | 'area-project' | 'person-person'
}

/** Result of `yantaoKb.relationGraph`: the whole KB's typed relation graph (ADR-0049). */
export interface KbRelationGraphResult {
  /** Every active entity, as KB-relative paths, in type-then-directory order. */
  readonly nodes: readonly string[]
  /** Every relation edge, deduplicated. */
  readonly edges: readonly KbWireRelationEdge[]
}

/** Result of `yantaoKb.root`. */
export interface KbRootResult {
  /** The live knowledge-base root directory. */
  readonly root: string
  /** True when the root comes from a persisted override rather than the plugin's config default. */
  readonly configured: boolean
}

/**
 * Result of `yantaoKb.promptInjection`: the yantao layer's own share of the
 * system prompt, heuristically priced (the meter's fixed 4-characters-per-
 * token density). Figures are composition references, never a total — the
 * provider-anchored occupancy lives in the `contextPressure` projection.
 */
export interface KbPromptInjectionResult {
  /** The four static discipline sections (`prompt/sections/*.md`), priced once. */
  readonly staticTokens: number
  /** The dynamic global behavior-memory section, priced from the live store. */
  readonly behaviorMemoryTokens: number
}

/** Result of `yantaoKb.setRoot`. */
export interface KbSetRootResult {
  /** The knowledge-base root now in force. */
  readonly root: string
  /** Always true: a successful `setRoot` persists the override. */
  readonly configured: boolean
  /** KB-relative paths this initialization created. */
  readonly created: readonly string[]
  /** KB-relative paths that were already there. */
  readonly existing: readonly string[]
}

/** An entity kind the UI may create; `todo` is the singleton `kb_init` owns. */
export type KbCreatableEntityType = 'project' | 'area' | 'person' | 'meeting'

/**
 * The person-to-owner relations the KB knows — the domain's own vocabulary,
 * carried on the wire so the workbench's picker and the agent's tool offer the
 * same five and no others.
 */
export type KbPersonRelation = PersonRelation

/** Parameters of `yantaoKb.createEntity`. */
export interface KbCreateEntityArgs {
  /** The entity kind to create. */
  readonly type: KbCreatableEntityType
  /** The entity display name; a meeting's file name is prefixed with its date. */
  readonly name: string
  /** The meeting's own date (YYYY-MM-DD); defaults to today. */
  readonly date?: string
  /** The person-to-owner relation; only a `person` carries it, and it defaults to the KB's own. */
  readonly relation?: PersonRelation
  /**
   * The person's e-mail address; only a `person` carries it. Mail analysis
   * writes the sender address here so later batches match senders by address.
   */
  readonly email?: string
}

/** Result of `yantaoKb.createEntity`. */
export interface KbCreateEntityResult {
  /** The KB-relative path of the created entity file. */
  readonly path: string
}

/** Result of `yantaoKb.revision` (ADR-0017). */
export interface KbRevisionResult {
  /** The KB root the counter watches; the UI re-reads its trees when this moves. */
  readonly root: string
  /** A counter that only grows while this root is watched; compare, do not interpret. */
  readonly revision: number
}

/** Result of `yantaoKb.openExternal` (ADR-0017). */
export interface KbOpenExternalResult {
  /** The target as handed to the desktop: a KB-relative path or an allowlisted URI. */
  readonly target: string
}

/** One structured todo row of the `entities/todos.md` singleton (ADR-0018). */
export interface KbTodoItem {
  /** Whether the checkbox is checked. */
  readonly done: boolean
  /** The item's title: the line's text after the checkbox and its `[key::value]` fields. */
  readonly title: string
  /** Deadline (YYYY-MM-DD). */
  readonly due?: string
  /** Completion date (YYYY-MM-DD). */
  readonly doneOn?: string
  /** The item's markdown body, carried by the two-space-indented lines below it; no trailing newline. */
  readonly body: string
  /** Unknown `[key::value]` tokens, kept as written so a round trip loses nothing. */
  readonly extra: readonly string[]
}

/** Result of `yantaoKb.todos` (ADR-0018). */
export interface KbTodosResult {
  /** The KB-relative path of the singleton, `entities/todos.md`. */
  readonly path: string
  /** The file's exact current content — an absent file reads as `''`, never an error. */
  readonly text: string
  /** The parsed items, in file order; empty for an absent file. */
  readonly items: readonly KbTodoItem[]
}

/** Parameters of `yantaoKb.writeTodos` (ADR-0018). */
export interface KbWriteTodosArgs {
  /** The whole item list to write, replacing the file's items. */
  readonly items: readonly KbTodoItem[]
  /** Optimistic concurrency: the `text` the caller last read from `yantaoKb.todos`. */
  readonly expectedText: string
}

/** Result of `yantaoKb.writeTodos` (ADR-0018). */
export interface KbWriteTodosResult {
  /** The KB-relative path of the singleton, `entities/todos.md`. */
  readonly path: string
  /** The file's content as it now sits on disk. */
  readonly text: string
}

/** Parameters of `yantaoKb.scheduledRunMark` (ADR-0061 决定 1). */
export interface KbScheduledRunMarkArgs {
  /** The fired run's session, booked before the prompt goes out. */
  readonly sessionId: string
}

/** Result of `yantaoKb.scheduledRunMark` (ADR-0061 决定 1). */
export interface KbScheduledRunMarkResult {
  /** Whether the run is now booked as scheduled. */
  readonly marked: boolean
}

/** Parameters of `yantaoKb.scheduledRunForget` (ADR-0061 决定 1). */
export interface KbScheduledRunForgetArgs {
  /** The fired run's session, released after the turn settles. */
  readonly sessionId: string
}

/** Result of `yantaoKb.scheduledRunForget` (ADR-0061 决定 1). */
export interface KbScheduledRunForgetResult {
  /** Whether a booking existed and was removed. */
  readonly forgotten: boolean
}

/** One DingTalk conversation's session binding (ADR-0061 决定 2). */
export interface KbDingtalkBindingRow {
  /** The DingTalk conversation the session is bound to. */
  readonly conversationId: string
  /** The host session id the conversation resumes. */
  readonly sessionId: string
  /** Which connector runtime family owns the binding. */
  readonly kind: 'robot' | 'digital-employee'
  /** The owning account id (robots) or agent uuid (digital employees). */
  readonly owner: string
}

/** Result of `yantaoKb.dingtalkBindings` (ADR-0061 决定 2). */
export interface KbDingtalkBindingsResult {
  /** The deduplicated binding rows; empty when the connector has none. */
  readonly rows: readonly KbDingtalkBindingRow[]
}

/** Parameters of `yantaoKb.dingtalkBindingSet` (ADR-0062 决定 3). */
export interface KbDingtalkBindingSetArgs {
  /** The DingTalk conversation to rewire. */
  readonly conversationId: string
  /**
   * The workbench session the conversation should drive (`null` severs the
   * binding — the next inbound message creates a fresh session).
   */
  readonly sessionId: string | null
}

/** Result of `yantaoKb.dingtalkBindingSet` (ADR-0062 决定 3). */
export interface KbDingtalkBindingSetResult {
  /** The bindings.json that was rewritten (diagnostics only). */
  readonly file: string
}

/**
 * One mail as the mail capability reports it (ADR-0019; since ADR-0021 the
 * `result` of `capabilityRun('mail', …)`). Mirrors the capability's entry
 * script (`capability/builtin/mail/scripts/entry.py`) rather than importing
 * it: `types.ts` is the contract the Client reads.
 */
export interface KbMailMessage {
  /** Stable dedup key: `sha1("receivedAt|senderAddress|subject")`. */
  readonly id: string
  /** Outlook's MAPI EntryID; useful for follow-up work, never as a primary key. */
  readonly entryId: string
  /** Reception time as an ISO 8601 string, normalized to UTC. */
  readonly receivedAt: string
  /** The sender's display name. */
  readonly senderName: string
  /** The sender's address as Outlook reports it. */
  readonly senderAddress: string
  /** Subject line, empty when the mail has none. */
  readonly subject: string
  /** Plain text body, at most 12000 characters. */
  readonly body: string
  /** True when `body` was cut at the 12000-character limit. */
  readonly truncated: boolean
  /**
   * Where the mailbox's owner sat in this mail's recipient list: `to`
   * (addressed directly), `cc` (copied only), `none`, or `unknown` when the
   * account could not be resolved. The recipients themselves are not
   * reported — only this one relationship.
   */
  readonly toMe?: 'to' | 'cc' | 'none' | 'unknown'
  /**
   * Whether one of this mail's recipients matches an address the caller
   * declared as a `superior` person's (ADR-0034 批次②). Like `toMe`, the
   * recipients themselves are never reported — only this one flag. Absent
   * from reads that ran without a superior address set.
   */
  readonly superiorInvolved?: boolean
  /**
   * Outlook's stable conversation key (`ConversationID`, Outlook 2010+).
   * Empty when the client could not read it; the UI then falls back to
   * grouping by normalized subject.
   */
  readonly conversationId?: string
  /**
   * The conversation's topic (`ConversationTopic`) — usually the original
   * subject with RE/FW prefixes stripped. Empty alongside `conversationId`.
   */
  readonly conversationTopic?: string
}

/** Input of the mail capability (ADR-0019): handed to `capabilityRun('mail', …)` as `input`. */
export interface KbMailFetchArgs {
  /**
   * Lower bound (exclusive) on reception time, as an ISO 8601 string.
   * Defaults to the connector's watermark, or to 30 days ago when there is
   * none: a first run must not try to read a whole inbox.
   */
  readonly since?: string
  /**
   * Upper bound (exclusive) on reception time, as an ISO 8601 string. With
   * `since` it names the window the human is paging through — 往前读 hands
   * the older end as `since` and the batch it just saw as `until`.
   */
  readonly until?: string
  /** How many of the newest mails to return; defaults to 50. */
  readonly limit?: number
  /**
   * The SMTP addresses of the people the KB holds with relation `superior`
   * (ADR-0034 批次②). The collector matches recipients against this set and
   * reports only a per-mail `superiorInvolved` flag — the recipient list
   * itself never crosses the boundary (ADR-0019's privacy rule). Absent: the
   * flag reads false everywhere.
   */
  readonly superiorAddresses?: readonly string[]
}

/** Result of the mail capability (ADR-0019): the `result` of `capabilityRun('mail', …)`. */
export interface KbMailFetchResult {
  /** The bound the read actually used. */
  readonly since: string
  /** The upper bound the read used, when the caller named one. */
  readonly until?: string
  /** The watermark before this read, absent when the connector has never run. */
  readonly lastReadAt?: string
  /**
   * Whether a gap may have opened: no watermark, or one older than 30 days.
   * The UI asks whether to re-read the older stretch — it never silently
   * skips it and never silently fills it in.
   */
  readonly stale: boolean
  /** The mails, newest first. */
  readonly messages: readonly KbMailMessage[]
  /**
   * Whether the read hit its cap, so older mails are still waiting. Exact
   * totals would mean scanning the whole folder over COM; a page boundary
   * answers the only question the UI asks.
   */
  readonly hasMore: boolean
}

/** Parameters of `yantaoKb.mailMarkRead` (ADR-0019). */
export interface KbMailMarkReadArgs {
  /** The new watermark: the newest mail that has been read. Defaults to now. */
  readonly lastReadAt?: string
  /** The oldest mail of the batch just dealt with; the range's start, kept as the minimum ever seen. */
  readonly firstReadAt?: string
}

/**
 * Input of the mail capability's delete verb (ADR-0034 决定 5): handed to
 * `capabilityRun('mail', …)` as `input` with `verb: 'delete'`. The knife is
 * human-channel-only — the entry script refuses it unless the host injected
 * `channel: 'human'`, which the agent's `kb_run_capability` never carries.
 */
export interface KbMailDeleteArgs {
  /** The mail capability's verb selector; the fetch verb is the default. */
  readonly verb: 'delete'
  /** The Outlook EntryIDs of the mails to move to the Deleted Items folder. */
  readonly ids: readonly string[]
}

/** Result of the mail capability's delete verb (ADR-0034 决定 5). One COM run, per-mail outcomes. */
export interface KbMailDeleteResult {
  /** The EntryIDs that were moved to the Deleted Items folder. */
  readonly moved: readonly string[]
  /** The EntryIDs Outlook could not resolve (already gone, store rebuilt). */
  readonly missing: readonly string[]
  /** The EntryIDs whose move failed, each with the reason. */
  readonly failed: readonly { readonly id: string; readonly message: string }[]
}

/**
 * One mail the archive verb should keep (ADR-0037 决定 2): the EntryID
 * locates the original in Outlook, the summary lands in the index's 摘要
 * column. Everything else (headers, recipients, attachments) the script
 * re-reads from Outlook itself.
 */
export interface KbMailArchiveItem {
  /** The mail's Outlook EntryID, from the analysed batch. */
  readonly entryId: string
  /** The analysis's summary for the index; empty when the model gave none. */
  readonly summary?: string
}

/**
 * Input of the mail capability's save verb (`verb: 'archive'`; ADR-0037
 * established it as 归档, the 2026-10-09 three-nomination merge made it
 * 保存). Human-channel-only, like the delete knife.
 */
export interface KbMailArchiveArgs {
  /** The mail capability's verb selector. */
  readonly verb: 'archive'
  /** The mails to save, each located by EntryID. */
  readonly mails: readonly KbMailArchiveItem[]
}

/** Result of the mail capability's save verb (ADR-0037 决定 7): per-mail outcomes, serial semantics. */
export interface KbMailArchiveResult {
  /**
   * The mails that landed, each with its `resources/`-relative path, the
   * format it took (`eml` or the `msg` fallback), and the `resources/`-relative
   * paths of the attachments that landed beside it (2026-10-09 三提名合一:
   * one mail, one index row, all its files).
   */
  readonly saved: readonly {
    readonly id: string
    readonly entryId: string
    readonly path: string
    readonly format: 'eml' | 'msg'
    readonly remark: string
    readonly attachments: readonly string[]
  }[]
  /** The mails over the 25 MB cap: the original refused on disk (attachments still land), recorded in the index as 过大未存 (决定 9). */
  readonly oversized: readonly { readonly id: string; readonly entryId: string; readonly title: string }[]
  /**
   * The mails skipped without a write (already saved, not a mail item, no receivable time), each with the reason.
   * Note the `id` caliber differs per bucket: skipped/failed carry the raw Outlook EntryID, while
   * saved/oversized carry the stable mail_id hash (with the raw EntryID alongside in `entryId`);
   * `missing` is a bare EntryID array (评审 2026-09-30 注记).
   */
  readonly skipped: readonly { readonly id: string; readonly reason: string }[]
  /** The EntryIDs Outlook could not resolve (already gone, store rebuilt). */
  readonly missing: readonly string[]
  /** The EntryIDs whose save failed, each with the reason. */
  readonly failed: readonly { readonly id: string; readonly message: string }[]
  /** Batch-level hints for the human (converter missing, per-mail degradations, attachment failures). */
  readonly warnings: readonly string[]
}

/** Result of `yantaoKb.mailMarkRead` (ADR-0019). */
export interface KbMailMarkReadResult {
  /** The watermark as it now stands. */
  readonly lastReadAt: string
  /** The oldest mail ever processed, when it is known — the range's start. */
  readonly firstReadAt?: string
}

/** Parameters of `yantaoKb.registerResource` (ADR-0020): the drag-and-drop intake. */
export interface KbRegisterResourceArgs {
  /** The dropped file's name (basename only; the host sanitizes it). */
  readonly name: string
  /** The file's complete content, base64-encoded. */
  readonly contentBase64: string
}

/** Result of `yantaoKb.registerResource` (ADR-0020). */
export interface KbRegisterResourceResult {
  /** The KB-relative path of the copied resource, `resources/…`. */
  readonly resource: string
}

/**
 * One file a capability run asks the controller to write (ADR-0021). Mirrors
 * `capability/run.ts`'s script contract rather than importing it: `types.ts`
 * is the contract the Client reads, and `run.ts` drags `node:child_process`
 * in with it.
 */
export interface KbCapabilityArtifact {
  /** File name inside `.dsh/yantao/capabilities/<name>/`; a bare name, never a path. */
  readonly name: string
  /** The file's complete content, base64-encoded. */
  readonly contentBase64: string
}

/**
 * Parameters of `yantaoKb.mailRun` (ADR-0052 决定 5): the mail capability's
 * dedicated RPC — the one survivor of the execution unification, driving the
 * mail entry script on the human channel's behalf. The capability name is
 * not a parameter: the RPC serves exactly one capability, `mail`.
 */
export interface KbCapabilityRunArgs {
  /** The caller's input, handed to the mail entry script verbatim. */
  readonly input?: JsonValue
}

/**
 * The observable envelope of one capability run (ADR-0044 决定 6), captured
 * by the host around the subprocess: what the 能力 tab's 提炼经验 gesture
 * feeds its distiller. Rides the human channel only — the agent channel's
 * `kb_run_capability` strips it.
 */
export interface KbCapabilityExec {
  /** The command line the host ran (interpreter + entry script). */
  readonly command: string
  /** The process exit code; null when the host killed it or the spawn failed. */
  readonly exitCode: number | null
  /** Wall-clock duration of the run, milliseconds. */
  readonly durationMs: number
  /** The last characters of stdout (capped at 2000). */
  readonly stdoutTail: string
  /** The last characters of stderr (capped at 2000). */
  readonly stderrTail: string
}

/** Result of `yantaoKb.mailRun` (ADR-0052 决定 5). */
export interface KbCapabilityRunResult {
  /** The capability that ran. */
  readonly name: string
  /** When the run completed, as an ISO 8601 string. */
  readonly runAt: string
  /** The capability's answer to its caller; opaque to the controller. */
  readonly result?: JsonValue
  /**
   * The SKILL.md body of an *instruction capability* (ADR-0023 决定 6) —
   * the run's whole answer when there is no entry script. Mutually exclusive
   * with `result`.
   */
  readonly content?: string
  /**
   * The capability scope's behavior memory (ADR-0032 决定 4), read from
   * `.dsh/yantao/memory/capabilities/<name>.md` at run time — the rules the
   * human approved across earlier runs, which this run must obey. Absent
   * when the capability has none. The agent channel's tool render appends it
   * to the answer; the human channel's client-driven flows (mail analysis)
   * read it from the result.
   */
  readonly memory?: string
  /** KB-relative paths of the files the run wrote under `.dsh/yantao/capabilities/<name>/`. */
  readonly artifacts: readonly string[]
  /**
   * The run's observable envelope (ADR-0044 决定 6), present when the run
   * actually spawned a script; the raw material the 提炼经验 gesture hands
   * its distiller. Instruction-type answers carry none.
   */
  readonly exec?: KbCapabilityExec
}

/**
 * What a capability accepts (ADR-0021), as declared by its
 * `metadata.yantao.appliesTo`. Mirrors `capability/run.ts`'s
 * `CapabilityAppliesTo` rather than importing it: `types.ts` stays free of
 * `run.ts`'s subprocess machinery.
 */
export interface KbCapabilityAppliesTo {
  /**
   * Resource suffixes (with dot, lowercase), e.g. `['.epub', '.pdf']` — or
   * `true` for *every* resource (the registration checkbox writes this).
   */
  readonly resource?: readonly string[] | boolean
  /** Entity types the capability accepts, e.g. `['project']`. */
  readonly entity?: readonly string[]
  /** External sources the capability reads, e.g. `['mailbox']`. */
  readonly external?: readonly string[]
  /** Opted into the selection right-click menu (ADR-0025 决定 5). */
  readonly selection?: boolean
}

/** One capability as the 能力 tab lists it (ADR-0021 决定 8; ADR-0053 决定 4). */
export interface KbCapabilitySummary {
  /** The capability's skill name, as the central route addresses it. */
  readonly name: string
  /** The SKILL.md description. */
  readonly description: string
  /** Where the skill directory was discovered (`project`, `user`, …). */
  readonly source: string
  /** Absolute path of the capability's directory, when the provider reported one. */
  readonly directory?: string
  /** The route entry's `path` as the routing file stores it (ADR-0053 决定 1's 技术细节 section shows it). */
  readonly routePath?: string
  /** Who may invoke the capability (ADR-0023 决定 2): a subset of `['human', 'agent']`. */
  readonly invocation: readonly string[]
  /** What the capability accepts; absent means "offered from the 能力 tab only". */
  readonly appliesTo?: KbCapabilityAppliesTo
  /** When the capability last ran, as an ISO 8601 string; absent when never run. */
  readonly lastRunAt?: string
  /** How many runs were accounted (ADR-0053 决定 3); absent when never run. */
  readonly runCount?: number
  /** When the capability last failed, as an ISO 8601 string; kept across later successes. */
  readonly lastFailAt?: string
  /** The state the last run left behind; opaque to the controller. */
  readonly state?: JsonValue
}

/** Result of `yantaoKb.capabilityList` (ADR-0021; unregistered group ADR-0025 决定 1). */
export interface KbCapabilityListResult {
  /** The capabilities, in discovery order. */
  readonly capabilities: readonly KbCapabilitySummary[]
  /**
   * Skills that are not yet capabilities (ADR-0025 决定 1), name-sorted,
   * registered capabilities excluded. Two origins share the group: skills
   * discovered outside the KB that adoption could copy in, and skills living
   * inside the KB's own `.dsh/skills/` that no route claims yet — those
   * carry `inKb` and registration writes their central-route entry
   * (ADR-0052 决定 1). Greyed rows carry the reason in their flags.
   */
  readonly unregistered: readonly KbUnregisteredSkill[]
}

/**
 * One skill in `capabilityList`'s 未注册 group (ADR-0025 决定 1): either a
 * skill `ctx.skills` discovered outside the KB's own `.dsh/skills/` that
 * adoption can copy into it, or an in-KB skill no central route claims that
 * registration can route in place. Home-directory discoveries
 * (`~/.dsh/skills`, `~/.agents/skills`) are excluded — the workbench's
 * capability plane is KB-scoped, and the owner's own installs are not
 * third-party finds (2026-10-09).
 */
export interface KbUnregisteredSkill {
  /** The skill's frontmatter name. */
  readonly name: string
  /** The SKILL.md description. */
  readonly description: string
  /** Where the skill was discovered (`user`, `project`, …). */
  readonly source: string
  /** Absolute path of the skill's directory; absent on a flat single-file skill. */
  readonly directory?: string
  /** False when the frontmatter declared `user-invocable: false` — not adoptable, not /xxx-able. */
  readonly userInvocable: boolean
  /** True for a flat `xxx.md` skill: no directory to route, so adoption is unsupported. */
  readonly flat: boolean
  /**
   * The skill lives inside `<kbRoot>/.dsh/skills/` — registration routes it
   * in the central routing file (no copy); absent for an out-of-KB adoption
   * candidate.
   */
  readonly inKb?: boolean
  /** Why the skill is not a capability — no route claims it; only in-KB rows carry it. */
  readonly reason?: string
  /**
   * The directory is a dropped plugin repository (no top-level `SKILL.md`,
   * but `skills/<name>/SKILL.md` inside): registration writes one central
   * route entry per nested skill, the repository tree untouched.
   */
  readonly plugin?: boolean
  /** The nested skill directory names a plugin repository carries; only plugin rows carry it. */
  readonly pluginSkills?: readonly string[]
}

/** Parameters of `yantaoKb.capabilityAdopt` (ADR-0025 决定 1). */
export interface KbCapabilityAdoptArgs {
  /** The unregistered skill's name, as `capabilityList`'s 未注册 group reported it. */
  readonly name: string
}

/** Result of `yantaoKb.capabilityAdopt` (ADR-0025 决定 1). */
export interface KbCapabilityAdoptResult {
  /** KB-relative path of the adopted capability directory, `.dsh/skills/<name>`. */
  readonly path: string
}

/** Parameters of `yantaoKb.capabilityRegister` (ADR-0025 决定 1's in-KB registration). */
export interface KbCapabilityRegisterArgs {
  /** The in-KB skill's name, as `capabilityList`'s 未注册 group reported it. */
  readonly name: string
  /**
   * Open the capability to the agent — `invocation: ['human', 'agent']` —
   * instead of the default human-only `['human']` (ADR-0023 决定 2).
   */
  readonly agentInvoke?: boolean
  /** Offer the capability from every resource's right-click menu (`appliesTo.resource: true`). */
  readonly resourceMenu?: boolean
  /** Opt the capability into the middle-pane right-click menu (`appliesTo.selection: true`). */
  readonly selectionMenu?: boolean
}

/** Result of `yantaoKb.capabilityRegister` (ADR-0025 决定 1's in-KB registration). */
export interface KbCapabilityRegisterResult {
  /**
   * KB-relative path of the central routing file the call wrote,
   * `.dsh/skills/yantao.json` (ADR-0025 落地注记二) — one route entry per
   * registered skill, the skill directories untouched.
   */
  readonly path: string
}

/** Parameters of `yantaoKb.capabilityCreate` (ADR-0021 决定 8's 「新建能力」). */
export interface KbCapabilityCreateArgs {
  /** The capability's name (kebab-case); it becomes the skill name. */
  readonly name: string
}

/** Result of `yantaoKb.capabilityCreate` (ADR-0021 决定 8's 「新建能力」). */
export interface KbCapabilityCreateResult {
  /** KB-relative path of the scaffolded directory, `.dsh/skills/<name>`. */
  readonly path: string
}

/**
 * Parameters of `yantaoKb.capabilityRouteUpdate` (ADR-0053 决定 2): one
 * registered capability's reachability, collapsed onto the route entry's
 * `invocation` and `appliesTo`. Absent fields mean "leave as-is".
 */
export interface KbCapabilityRouteUpdateArgs {
  /** The capability's name, as the central route addresses it. */
  readonly name: string
  /** Who may invoke the capability after the update (ADR-0023 决定 2). */
  readonly invocation?: readonly ('human' | 'agent')[]
  /** What the capability accepts after the update. */
  readonly appliesTo?: KbCapabilityAppliesTo
}

/** Result of `yantaoKb.capabilityRouteUpdate` (ADR-0053 决定 2). */
export interface KbCapabilityRouteUpdateResult {
  /** KB-relative path of the routing file the call rewrote, `.dsh/skills/yantao.json`. */
  readonly path: string
}

/** Parameters of `yantaoKb.capabilityUnregister` (ADR-0053 决定 2). */
export interface KbCapabilityUnregisterArgs {
  /** The capability's name, as the central route addresses it. */
  readonly name: string
}

/** Result of `yantaoKb.capabilityUnregister` (ADR-0053 决定 2). */
export interface KbCapabilityUnregisterResult {
  /** KB-relative path of the routing file the call removed the entry from, `.dsh/skills/yantao.json`. */
  readonly path: string
}

/**
 * One remembered behavior rule of the memory store (ADR-0032): a `- ` bullet
 * in the scope's markdown file, id-addressable for deletion.
 */
export interface KbMemoryEntry {
  /** Stable id: `sha1("<scope>|<text>")`; `memoryDelete` addresses this. */
  readonly id: string
  /** Creation stamp (YYYY-MM-DD) when the line carries one. */
  readonly date?: string
  /** The rule's text, as written after the bullet (and optional stamp). */
  readonly text: string
}

/** One scope's memory: the global file, or one capability's file. */
export interface KbMemoryGroup {
  /** The scope: `global`, or the capability's skill name. */
  readonly scope: string
  /** KB-relative path of the scope's markdown file, forward slashes. */
  readonly path: string
  /** The file's exact current text — an absent file reads as `''`, never an error. */
  readonly text: string
  /** The parsed entries, in file order; empty for an absent file. */
  readonly entries: readonly KbMemoryEntry[]
}

/** Result of `yantaoKb.memoryList` (ADR-0032): every scope that has a file. */
export interface KbMemoryListResult {
  /** The global scope first, then the capability scopes name-sorted. */
  readonly groups: readonly KbMemoryGroup[]
}

/** Parameters of `yantaoKb.memoryAdd` (ADR-0032). */
export interface KbMemoryAddArgs {
  /** The scope to remember in: `global`, or the capability's skill name. */
  readonly scope: string
  /** The rule's text; trimmed before it is stored, and refused when empty or already remembered. */
  readonly text: string
}

/** Result of `yantaoKb.memoryAdd` (ADR-0032). */
export interface KbMemoryAddResult {
  /** KB-relative path of the scope's markdown file. */
  readonly path: string
  /** The entry as it now sits in the file. */
  readonly entry: KbMemoryEntry
}

/** Parameters of `yantaoKb.memoryDelete` (ADR-0032): removal is human-only. */
export interface KbMemoryDeleteArgs {
  /** The scope the entry lives in. */
  readonly scope: string
  /** The entry's id, as `memoryList` reported it. */
  readonly id: string
}

/** Result of `yantaoKb.memoryDelete` (ADR-0032). */
export interface KbMemoryDeleteResult {
  /** KB-relative path of the scope's markdown file. */
  readonly path: string
}

/**
 * One proposed (not yet approved) memory entry of the proposal queue
 * (ADR-0044): a `- ` bullet in the scope's queue file under
 * `.dsh/yantao/memory/proposals/`, carrying a trailing 〔source〕 annotation
 * naming where the lesson came from. The queue is never injected — it waits
 * for the human's verdict.
 */
export interface KbMemoryProposal {
  /** Stable id: `sha1("<scope>|<text>")` — identical to the id the entry carries in memory after promotion. */
  readonly id: string
  /** Proposal stamp (YYYY-MM-DD); a hand-written line may omit it. */
  readonly date?: string
  /** The distilled text, source annotation stripped. */
  readonly text: string
  /** Where the lesson came from (会话 / UI 运行摘要); `''` for a hand-written line without one. */
  readonly source: string
}

/** One scope's proposal queue (ADR-0044). */
export interface KbMemoryProposalGroup {
  /** The scope: `global`, or the capability's skill name. */
  readonly scope: string
  /** KB-relative path of the queue's markdown file, forward slashes. */
  readonly path: string
  /** The file's exact current text — an absent file reads as `''`, never an error. */
  readonly text: string
  /** The parsed pending proposals, in file order; empty for an absent file. */
  readonly entries: readonly KbMemoryProposal[]
}

/** Result of `yantaoKb.memoryProposalList` (ADR-0044): every scope whose queue still holds at least one
 * pending proposal — a scope whose queue was fully decided is omitted. */
export interface KbMemoryProposalListResult {
  /** The global scope first, then the capability scopes name-sorted. */
  readonly groups: readonly KbMemoryProposalGroup[]
}

/** Parameters of `yantaoKb.memoryProposalApprove` (ADR-0044): promote one pending proposal. */
export interface KbMemoryProposalApproveArgs {
  /** The scope whose queue holds the proposal. */
  readonly scope: string
  /** The proposal's text, as the queue (or the approval card) reported it. */
  readonly text: string
  /** Optional re-judged destination scope; defaults to the source scope. */
  readonly targetScope?: string
}

/** Result of `yantaoKb.memoryProposalApprove` (ADR-0044). */
export interface KbMemoryProposalApproveResult {
  /** KB-relative path of the queue the proposal left. */
  readonly path: string
  /** KB-relative path of the memory file the text landed in. */
  readonly targetPath: string
  /** The entry as it now sits in the memory file. */
  readonly entry: KbMemoryEntry
}

/** Parameters of `yantaoKb.memoryProposalDiscard` (ADR-0044): drop one pending proposal. */
export interface KbMemoryProposalDiscardArgs {
  /** The scope whose queue holds the proposal. */
  readonly scope: string
  /** The proposal's text, as the queue (or the approval card) reported it. */
  readonly text: string
}

/** Result of `yantaoKb.memoryProposalDiscard` (ADR-0044). */
export interface KbMemoryProposalDiscardResult {
  /** KB-relative path of the queue the proposal left. */
  readonly path: string
}

/** One saved favorite (ADR-0040): the slash alias and the text it expands to. */
export interface KbPromptShortcut {
  /** The alias as typed after `/` — one token, no whitespace or slash. */
  readonly alias: string
  /** The expansion the agent performs when it sees `/alias`. */
  readonly text: string
}

/** Result of `yantaoKb.promptShortcutList` (ADR-0040). */
export interface KbPromptShortcutListResult {
  /** The shortcuts in display (stored) order. */
  readonly shortcuts: readonly KbPromptShortcut[]
}

/** Parameters of `yantaoKb.promptShortcutSave` (ADR-0040): full-list replace. */
export interface KbPromptShortcutSaveArgs {
  /** The complete new list, in display order; validation refuses bad aliases. */
  readonly shortcuts: readonly KbPromptShortcut[]
}

/** Result of `yantaoKb.promptShortcutSave` (ADR-0040). */
export interface KbPromptShortcutSaveResult {
  /** The list as stored (normalized). */
  readonly shortcuts: readonly KbPromptShortcut[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** One timed task definition (ADR-0045): fires its prompt as a background session when the cron hits. */
export interface KbSchedule {
  /** Stable identity, assigned at creation. */
  readonly id: string
  /** Display name; the fired session is titled 「调度 · <name>」. */
  readonly name: string
  /** The prompt fired — a snapshot, not a reference (ADR-0045 决定 5). */
  readonly prompt: string
  /** Five-field cron (分 时 日 月 周). */
  readonly cron: string
  /** Disabled entries stay in the list but never fire. */
  readonly enabled: boolean
  /** ISO timestamp of the last reported fire; absent when never fired. */
  readonly lastFiredAt?: string
  /** ISO timestamp of the most recent missed fire detected at startup. */
  readonly lastMissedAt?: string
  /**
   * An optional capability binding (首跳直通)：when set, the fired session's
   * prompt is prefixed with that capability's full instruction text (fetched
   * through `capabilityInstructions` on the human channel), sparing the
   * agent its first `kb_run_capability` hop. Empty/absent = no binding.
   */
  readonly capability?: string
}

/** Result of `yantaoKb.scheduleList` (ADR-0045). */
export interface KbScheduleListResult {
  /** The schedules in display (stored) order. */
  readonly schedules: readonly KbSchedule[]
}

/** Parameters of `yantaoKb.scheduleSave` (ADR-0045): full-list replace. */
export interface KbScheduleSaveArgs {
  /** The complete new list, in display order; validation refuses bad crons. */
  readonly schedules: readonly KbSchedule[]
}

/** Result of `yantaoKb.scheduleSave` (ADR-0045). */
export interface KbScheduleSaveResult {
  /** The list as stored (normalized). */
  readonly schedules: readonly KbSchedule[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Parameters of `yantaoKb.capabilityInstructions` (调度首跳直通). */
export interface KbCapabilityInstructionsArgs {
  /** The capability's skill name, as registered in the central routing file. */
  readonly name: string
}

/**
 * Result of `yantaoKb.capabilityInstructions` (调度首跳直通): the assembled
 * instruction text exactly as the agent would receive it from
 * `kb_run_capability` — 导语 + environment note + SKILL.md body + behavior
 * memory — so the scheduler can inline it ahead of the prompt.
 */
export interface KbCapabilityInstructionsResult {
  /** The capability that was resolved. */
  readonly name: string
  /** The fully assembled instruction text, ready to inline. */
  readonly instructions: string
}

/** Parameters of `yantaoKb.scheduleMark` (ADR-0045): patch one row's scheduler-owned stamps. */
export interface KbScheduleMarkArgs {
  /** The row to patch. */
  readonly id: string
  /** ISO stamp of a real fire; null clears. Absent leaves the field untouched. */
  readonly lastFiredAt?: string | null
  /** ISO stamp of a detected miss; null clears. Absent leaves the field untouched. */
  readonly lastMissedAt?: string | null
}

/** Result of `yantaoKb.scheduleMark` (ADR-0045). */
export interface KbScheduleMarkResult {
  /** The full list as stored after the patch. */
  readonly schedules: readonly KbSchedule[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** One instruction inside a workspace (ADR-0056 决定 3): an optional cron plus a prompt chain. */
export interface KbWorkspaceInstruction {
  /** Stable identity, assigned at creation; edits keep it. */
  readonly id: string
  /** Display name, shown on cards and run rows. */
  readonly name: string
  /** Five-field cron (分 时 日 月 周); absent = manual trigger only. */
  readonly cron?: string
  /** Disabled instructions stay in the list but never fire. */
  readonly enabled: boolean
  /** The prompt chain — snapshots, not references; ≥1 step, ≤10. */
  readonly steps: readonly string[]
  /** ISO timestamp of the last cron fire; absent when never fired. Tick-owned, never authored by the editor. */
  readonly lastFiredAt?: string
  /** ISO timestamp of the most recent missed fire; a real fire clears it. Tick-owned. */
  readonly lastMissedAt?: string
}

/** One workspace (ADR-0056 决定 2): a directory binding plus its instructions. */
export interface KbWorkspace {
  /** Stable identity, assigned at creation; edits keep it. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** The bound directory (absolute); the agent's cwd, and the human's grant of territory. */
  readonly directory: string
  /** The executor family; today only `codebuddy`. */
  readonly agent: 'codebuddy'
  /** Optional model selector, passed through as `--model`. */
  readonly model?: string
  /** The instructions this workspace carries. */
  readonly instructions: readonly KbWorkspaceInstruction[]
}

/** Where one run's distilled process log lives, relative to the KB root —
 * the UI joins `<dir>/<runId>.log` to open a run's log tab. Re-exported from
 * the kb store so the location has a single authoritative source. */
export { WORKSPACE_RUN_LOG_DIR } from '@deepseek-ai/dsh-yantao-kb'

/** One chain step's record inside a workspace run (ADR-0056 决定 6). */
export interface KbWorkspaceRunStep {
  /** Zero-based position in the chain. */
  readonly index: number
  /** The prompt as fired — a snapshot, not a reference. */
  readonly promptSnapshot: string
  /** ISO timestamp the step's process started; absent before it spawns. */
  readonly startedAt?: string
  /** ISO timestamp the step ended (any ending); absent while running. */
  readonly finishedAt?: string
  /** The process exit code; null when killed or never cleanly exited. */
  readonly exitCode?: number | null
  /** The agent session this step ran in — later steps resume it. */
  readonly sessionId?: string
  /** The final result text, trimmed to an excerpt for the history card. */
  readonly resultExcerpt?: string
  /** Why the step failed, when it did. */
  readonly error?: string
}

/** One execution of one instruction (ADR-0056 决定 6). */
export interface KbWorkspaceRun {
  /** Stable identity, assigned at trigger time. */
  readonly id: string
  /** The owning workspace; dangling after a workspace deletion — rows are history, not references. */
  readonly workspaceId: string
  /** The instruction that produced this run. */
  readonly instructionId: string
  /** The instruction's name at trigger time (snapshots survive renames). */
  readonly instructionName: string
  /** What pulled the trigger (`agent` = kb_run_workspace_instruction, ADR-0063). */
  readonly trigger: 'manual' | 'cron' | 'agent'
  /** Lifecycle: `running` until a terminal status replaces it. */
  readonly status: 'running' | 'success' | 'failed' | 'stopped' | 'missed' | 'interrupted'
  /** ISO timestamp the run was created. */
  readonly startedAt: string
  /** ISO timestamp the run reached a terminal status; absent while running. */
  readonly finishedAt?: string
  /** Zero-based index of the step that broke the chain, when one did. */
  readonly failedStep?: number
  /** The last successful step's result text, for the history card. */
  readonly finalResult?: string
  /** Per-step records, in chain order. A `missed` row has none. */
  readonly steps: readonly KbWorkspaceRunStep[]
}

/** Result of `yantaoKb.workspaceList` (ADR-0056). */
export interface KbWorkspaceListResult {
  /** The workspaces in display (stored) order. */
  readonly workspaces: readonly KbWorkspace[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Parameters of `yantaoKb.workspaceSave` (ADR-0056): full-list replace. */
export interface KbWorkspaceSaveArgs {
  /** The complete new list, in display order; validation refuses bad crons/chains. */
  readonly workspaces: readonly KbWorkspace[]
}

/** Result of `yantaoKb.workspaceSave` (ADR-0056). */
export interface KbWorkspaceSaveResult {
  /** The list as stored (normalized, tick stamps preserved). */
  readonly workspaces: readonly KbWorkspace[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Parameters of `yantaoKb.workspaceRun` (ADR-0056): manual trigger. */
export interface KbWorkspaceRunArgs {
  /** The workspace holding the instruction. */
  readonly workspaceId: string
  /** The instruction to run now. */
  readonly instructionId: string
}

/** Result of `yantaoKb.workspaceRun` (ADR-0056). */
export interface KbWorkspaceRunResult {
  /** The new run's id — the row the 历史 list will show. */
  readonly runId: string
}

/** Parameters of `yantaoKb.workspaceRunStop` (ADR-0056): kill the chain's process tree. */
export interface KbWorkspaceRunStopArgs {
  /** The run to stop. */
  readonly runId: string
}

/** Result of `yantaoKb.workspaceRunStop` (ADR-0056). */
export interface KbWorkspaceRunStopResult {
  /** The full run history as stored after the stop patch. */
  readonly runs: readonly KbWorkspaceRun[]
}

/** Result of `yantaoKb.workspaceRunsList` (ADR-0056): the run-history ring. */
export interface KbWorkspaceRunsListResult {
  /** The runs, newest first. */
  readonly runs: readonly KbWorkspaceRun[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Result of `yantaoKb.workspaceRunsClear`: the history after the human's clear gesture. */
export interface KbWorkspaceRunsClearResult {
  /** How many finalized rows were dropped. */
  readonly cleared: number
  /** The runs that remain (still-running rows), newest first. */
  readonly runs: readonly KbWorkspaceRun[]
}

/** Parameters of `yantaoKb.workspaceRunDelete`: drop one history row. */
export interface KbWorkspaceRunDeleteArgs {
  /** The run row to delete. */
  readonly runId: string
}

/** Result of `yantaoKb.workspaceRunDelete`: the history after the deletion. */
export interface KbWorkspaceRunDeleteResult {
  /** The runs that remain, newest first. */
  readonly runs: readonly KbWorkspaceRun[]
}

/**
 * One action's settlement record (ADR-0059 决定 5): `index` positions the
 * action in the unified proposal's canonical action order, `ok` says whether
 * its write landed, `error` carries the failure reason when `ok` is false.
 */
export interface KbProposalApplyRecord {
  readonly index: number
  readonly ok: boolean
  readonly error: string
}

/**
 * One queued proposal in the inbox (ADR-0047): a structured proposal produced
 * outside a human-initiated card flow — today, a schedule's background
 * session — awaiting the human's decision. The `proposal` payload is the
 * unified proposal (ADR-0021 决定 4) carried opaquely: its schema authority
 * is the client, the store persists it verbatim.
 */
export interface KbQueuedProposal {
  /** Stable identity, assigned at enqueue. */
  readonly id: string
  /** ISO timestamp of the enqueue moment. */
  readonly createdAt: string
  /** Where it came from, e.g. `schedule:sch_xxx`. */
  readonly source: string
  /** The producer's display name, shown on the card's provenance line. */
  readonly sourceName: string
  /** The card's heading. */
  readonly title: string
  /** One line under the title, when the producer added one. */
  readonly note?: string
  /** The unified proposal, opaque on this wire. */
  readonly proposal: JsonValue
  /**
   * Pending until the human decides; a decision is final. ADR-0059 决定 5
   * splits the approve verdict by outcome: `approved` (everything landed),
   * `approved-with-errors` (partial), `failed` (nothing landed).
   */
  readonly status: 'pending' | 'approved' | 'approved-with-errors' | 'failed' | 'discarded'
  /** ISO timestamp of the decision; present exactly when status is not `pending`. */
  readonly decidedAt?: string
  /** Per-action settlement trail (ADR-0059 决定 5); present on rows settled from a non-clean apply. */
  readonly applyResults?: readonly KbProposalApplyRecord[]
}

/**
 * One proposal-inbox mutation, broadcast for in-host consumers (ADR-0060
 * 决定 5): the DingTalk connector is the first subscriber (pushes the card),
 * the UI keeps its revision polling. One event name, the action discriminates
 * the two emit points; the entry always rides in its post-write state.
 */
export interface KbProposalInboxEvent {
  /** Which emit point fired: an append or a human's settlement. */
  readonly action: 'enqueue' | 'resolve'
  /** The affected entry as stored after the write. */
  readonly entry: KbQueuedProposal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The proposal inbox mutated (ADR-0060 决定 5): an entry was appended
     * (`enqueue`) or a human settled it (`resolve`). Emitted after the store
     * write succeeds; listeners must not throw the RPC.
     * @mode emit
     * @param update - the action and the affected entry's post-write state.
     */
    'yantao-kb/proposal-inbox'(update: KbProposalInboxEvent): void
  }
}

/** Result of `yantaoKb.proposalInboxList` (ADR-0047). */
export interface KbProposalInboxListResult {
  /** The entries in enqueue order — pending and decided alike. */
  readonly proposals: readonly KbQueuedProposal[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Parameters of `yantaoKb.proposalInboxEnqueue` (ADR-0047). */
export interface KbProposalInboxEnqueueArgs {
  /** Where it came from, e.g. `schedule:sch_xxx`. */
  readonly source: string
  /** The producer's display name. */
  readonly sourceName: string
  /** The card's heading. */
  readonly title: string
  /** One line under the title, optional. */
  readonly note?: string
  /** The unified proposal, opaque on this wire. */
  readonly proposal: JsonValue
}

/** Result of `yantaoKb.proposalInboxEnqueue` (ADR-0047). */
export interface KbProposalInboxEnqueueResult {
  /** The full list as stored after the append. */
  readonly proposals: readonly KbQueuedProposal[]
  /** The freshly assigned entry id. */
  readonly id: string
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Parameters of `yantaoKb.proposalInboxResolve` (ADR-0047; ADR-0059 决定 5). */
export interface KbProposalInboxResolveArgs {
  /** The entry to resolve. */
  readonly id: string
  /**
   * The decision: `approved` / `approved-with-errors` / `failed` (an apply
   * ran beforehand and reports through `applyResults`) or `discarded`.
   */
  readonly status: 'approved' | 'approved-with-errors' | 'failed' | 'discarded'
  /** The applier's per-action trail, carried on apply settlements (ADR-0059 决定 5). */
  readonly applyResults?: readonly KbProposalApplyRecord[]
}

/** Result of `yantaoKb.proposalInboxResolve` (ADR-0047). */
export interface KbProposalInboxResolveResult {
  /** The full list as stored after the resolve. */
  readonly proposals: readonly KbQueuedProposal[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** One machine verification's warning on a pending card (ADR-0059 决定 2). */
export interface KbInboxAnnotation {
  /** The warning's issuer, e.g. `读取闭合`. */
  readonly sender: string
  /** The warned-at thing: a resource path or an action summary. */
  readonly subject: string
  /** What the machine saw that a human should double-check. */
  readonly why: string
}

/** Parameters of `yantaoKb.proposalInboxAnnotate` (ADR-0059 决定 2). */
export interface KbProposalInboxAnnotateArgs {
  /** The pending entry to annotate. */
  readonly id: string
  /** The warnings to append to the payload's `highlights`. */
  readonly highlights: readonly KbInboxAnnotation[]
}

/** Result of `yantaoKb.proposalInboxAnnotate` (ADR-0059 决定 2). */
export interface KbProposalInboxAnnotateResult {
  /** The full list as stored after the merge. */
  readonly proposals: readonly KbQueuedProposal[]
  /** KB-relative path of the store, for the UI's error copy. */
  readonly path: string
}

/** Parameters of `yantaoKb.skillRewriteApply` (ADR-0054): one approved rewrite's writeback. */
export interface KbSkillRewriteApplyArgs {
  /** The capability's name, as the central routing file keys it. */
  readonly name: string
  /** The file's path relative to the capability's directory, forward slashes. */
  readonly file: string
  /** The file's content as the proposing agent read it — must still match on disk. */
  readonly original: string
  /** The approved content to write. */
  readonly new: string
}

/** Result of `yantaoKb.skillRewriteApply` (ADR-0054). */
export interface KbSkillRewriteApplyResult {
  /** The written file's path relative to the capability directory, forward slashes. */
  readonly file: string
  /** Where the pre-write content was backed up, when the copy succeeded. */
  readonly backupPath?: string
}
