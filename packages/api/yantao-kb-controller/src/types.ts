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

/** One `[[…]]` link a file writes out, and where it lands (ADR-0015). */
export interface KbLinkTarget {
  /** The target as written between the brackets. */
  readonly target: string
  /** The resolved KB-relative path; null when it names zero or several files. */
  readonly path: string | null
}

/** One file that links into another (ADR-0015). */
export interface KbLinkSource {
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
  readonly outgoing: readonly KbLinkTarget[]
  /** What links into it. */
  readonly incoming: readonly KbLinkSource[]
}

/** One directed edge of the whole-KB `[[…]]` link graph (ADR-0035). */
export interface KbGraphEdge {
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
  readonly edges: readonly KbGraphEdge[]
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

/** Input of the mail capability's archive verb (ADR-0037). Human-channel-only, like the delete knife. */
export interface KbMailArchiveArgs {
  /** The mail capability's verb selector. */
  readonly verb: 'archive'
  /** The mails to archive, each located by EntryID. */
  readonly mails: readonly KbMailArchiveItem[]
}

/** Result of the mail capability's archive verb (ADR-0037 决定 7): per-mail outcomes, serial semantics. */
export interface KbMailArchiveResult {
  /** The mails that landed, each with its `resources/`-relative path and the format it took (`eml` or the `msg` fallback). */
  readonly saved: readonly { readonly id: string; readonly entryId: string; readonly path: string; readonly format: 'eml' | 'msg'; readonly remark: string }[]
  /** The mails over the 25 MB cap: refused on disk, recorded in the index as 过大未存 (决定 9). */
  readonly oversized: readonly { readonly id: string; readonly entryId: string; readonly title: string }[]
  /**
   * The mails skipped without a write (already archived, not a mail item, no receivable time), each with the reason.
   * Note the `id` caliber differs per bucket: skipped/failed carry the raw Outlook EntryID, while
   * saved/oversized carry the stable mail_id hash (with the raw EntryID alongside in `entryId`);
   * `missing` is a bare EntryID array (评审 2026-09-30 注记).
   */
  readonly skipped: readonly { readonly id: string; readonly reason: string }[]
  /** The EntryIDs Outlook could not resolve (already gone, store rebuilt). */
  readonly missing: readonly string[]
  /** The EntryIDs whose archive failed, each with the reason. */
  readonly failed: readonly { readonly id: string; readonly message: string }[]
  /** Batch-level hints for the human (converter missing, per-mail degradations). */
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

/** Parameters of `yantaoKb.capabilityRun` (ADR-0021). */
export interface KbCapabilityRunArgs {
  /** The capability's skill name, as `ctx.skills` knows it. */
  readonly name: string
  /** The caller's input, handed to the capability's entry script verbatim. */
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

/** Result of `yantaoKb.capabilityRun` (ADR-0021; agent channel ADR-0023). */
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

/** One capability as the 能力 tab lists it (ADR-0021 决定 8). */
export interface KbCapabilitySummary {
  /** The capability's skill name, as `capabilityRun` addresses it. */
  readonly name: string
  /** The SKILL.md description. */
  readonly description: string
  /** Where the skill directory was discovered (`project`, `user`, …). */
  readonly source: string
  /** Absolute path of the capability's directory, when the provider reported one. */
  readonly directory?: string
  /** Entry script path, relative to the capability's directory; absent = instruction capability (ADR-0023 决定 6). */
  readonly entry?: string
  /** The only runtime in v1: `python`; absent on an instruction capability. */
  readonly runtime?: string
  /** Who may invoke the capability (ADR-0023 决定 2): a subset of `['human', 'agent']`. */
  readonly invocation: readonly string[]
  /** What the capability accepts; absent means "offered from the 能力 tab only". */
  readonly appliesTo?: KbCapabilityAppliesTo
  /** When the capability last ran, as an ISO 8601 string; absent when never run. */
  readonly lastRunAt?: string
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
   * inside the KB's own `.dsh/skills/` whose declaration is missing or
   * invalid — those carry `inKb` and registration routes them in the central
   * routing file (ADR-0025 落地注记二). Greyed rows carry the reason in their
   * flags.
   */
  readonly unregistered: readonly KbUnregisteredSkill[]
}

/**
 * One skill in `capabilityList`'s 未注册 group (ADR-0025 决定 1): either a
 * skill `ctx.skills` discovered outside the KB's own `.dsh/skills/` that
 * adoption can copy into it, or an in-KB skill without a valid yantao
 * declaration that registration can route in the central routing file.
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
  /** True for a flat `xxx.md` skill: no directory to carry a sidecar, so adoption is unsupported. */
  readonly flat: boolean
  /**
   * The skill lives inside `<kbRoot>/.dsh/skills/` — registration routes it
   * in the central routing file (no copy); absent for an out-of-KB adoption
   * candidate.
   */
  readonly inKb?: boolean
  /** Why the skill is not a capability — missing or invalid declaration; only in-KB rows carry it. */
  readonly reason?: string
  /**
   * The directory is a dropped plugin repository (no top-level `SKILL.md`,
   * but `skills/<name>/SKILL.md` inside): registration writes one central
   * route entry per nested skill, the repository tree untouched.
   */
  readonly plugin?: boolean
  /** The nested skill directory names a plugin repository carries; only plugin rows carry it. */
  readonly pluginSkills?: readonly string[]
  /** The skill's own `yantao.json` sidecar, when it carries one — the adopt confirm box previews it. */
  readonly sidecar?: JsonValue
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

/** Parameters of `yantaoKb.capabilityDeclaration` (ADR-0043 决定 7). */
export interface KbCapabilityDeclarationArgs {
  /** The capability's skill name, as `capabilityList` reports it. */
  readonly name: string
}

/**
 * One valid declaration in its resolved form (ADR-0043 决定 7): the parsed
 * fields flat, plus what the declaration *means* — instruction or script —
 * and where the entry actually lands on disk.
 */
export interface KbCapabilityResolvedDeclaration {
  /** Instruction (no entry, ADR-0023 决定 6) or script capability. */
  readonly kind: 'instruction' | 'script'
  /** The declared entry, relative as written; script kind only. */
  readonly entry?: string
  /** The declared runtime (`python` in v1); script kind only. */
  readonly runtime?: string
  /** The SKILL.md frontmatter's version, when it declares one. */
  readonly version?: string
  /** Who may invoke the capability, as declared (ADR-0023 决定 2). */
  readonly invocation: readonly string[]
  /** What the capability accepts, as declared. */
  readonly appliesTo?: KbCapabilityAppliesTo
  /**
   * Every absolute path the entry may resolve to, nearest root first: inside
   * the skill directory, then inside the `.dsh/` adapter plane (ADR-0043
   * 决定 2). Script kind only; an empty list means the entry escapes both roots.
   */
  readonly entryCandidates?: readonly string[]
  /** The first candidate that exists on disk; absent means the entry file is missing. */
  readonly entryPath?: string
}

/**
 * The sidecar channel's answer for one capability name (ADR-0043 决定 7):
 * the directory's own `yantao.json` (raw text included) or the legacy
 * `metadata.yantao` frontmatter section. A missing or invalid declaration is
 * spelled out in `problem`, never thrown — the panel must render it.
 */
export interface KbCapabilitySidecarAnswer {
  /** True when any declaration exists — a sidecar file or a frontmatter section. */
  readonly present: boolean
  /** Which channel the declaration came from; absent when `present` is false. */
  readonly source?: 'sidecar' | 'frontmatter'
  /** The sidecar file's raw text, when the file exists. */
  readonly raw?: string
  /** The validated, resolved declaration; absent when missing or invalid. */
  readonly resolved?: KbCapabilityResolvedDeclaration
  /** Why the channel has no resolved declaration: none declared, invalid shape, entry problems. */
  readonly problem?: string
}

/**
 * The central routing channel's answer for one capability name (ADR-0025
 * 落地注记二; ADR-0043 决定 7): whether `.dsh/skills/yantao.json` carries an
 * entry for it, and that entry's declaration. A broken routing file is
 * spelled out in `problem`, never thrown.
 */
export interface KbCapabilityRouteAnswer {
  /** True when the routing file carries an entry for this name. */
  readonly registered: boolean
  /** The route's skill-directory path, relative to `.dsh/skills/`. */
  readonly path?: string
  /** Who may invoke the capability, as the route declares. */
  readonly invocation?: readonly string[]
  /** What the capability accepts, as the route declares. */
  readonly appliesTo?: KbCapabilityAppliesTo
  /** When the routing file itself is unreadable/invalid, its error. */
  readonly problem?: string
}

/**
 * Result of `yantaoKb.capabilityDeclaration` (ADR-0043 决定 7): both
 * declaration channels, parsed and resolved, with every miss stated in data
 * so the 能力 tab — and an agent troubleshooting a refused call — can see a
 * broken or missing registration without provoking one.
 */
export interface KbCapabilityDeclarationResult {
  /** The queried name, echoed. */
  readonly name: string
  /** Absolute path of the skill directory the registry resolved inside the KB; absent when nothing resolved. */
  readonly directory?: string
  /** The sidecar/frontmatter channel's answer. */
  readonly sidecar: KbCapabilitySidecarAnswer
  /** The central routing channel's answer. */
  readonly route: KbCapabilityRouteAnswer
  /**
   * Whether the agent may invoke this capability — the same dual-gate
   * precedence `kb_run_capability` and `kb_exec_capability_script` apply: a
   * valid sidecar declaration wins, the central route answers otherwise.
   */
  readonly agentInvocable: boolean
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

/** Result of `yantaoKb.memoryProposalList` (ADR-0044): every scope that has a queue. */
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
