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
  /** Display name (file basename; entity notes drop the `.md` suffix). */
  readonly name: string
  /** KB-relative path with forward slashes. */
  readonly path: string
  /** Present (and true) when the entity's frontmatter carries `archive: true`. */
  readonly archived?: boolean
  /** For a resource: the path of its companion note, when one exists. */
  readonly notePath?: string
  /** For a person entity: the declared relation, when present. */
  readonly relation?: string
}

/**
 * Stable section identifiers across both trees. The intake tree carries
 * `resources` + `meetings` + `todos`, the workspace tree `projects` +
 * `areas` + `people` — one union keeps the Client's label map total.
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

/** Result of `yantaoKb.deleteFile`. */
export interface KbDeleteFileResult {
  /** The KB-relative path that was deleted. */
  readonly path: string
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

/** Result of `yantaoKb.root`. */
export interface KbRootResult {
  /** The live knowledge-base root directory. */
  readonly root: string
  /** True when the root comes from a persisted override rather than the plugin's config default. */
  readonly configured: boolean
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
   * The resource the entity is *about*, as a KB-relative path (ADR-0020);
   * only a reading project carries it, written into its frontmatter as
   * `source:` — the field that makes `读书-《书名》` a reading project.
   */
  readonly source?: string
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
  /** Plain text body, at most 3000 characters. */
  readonly body: string
  /** True when `body` was cut at the 3000-character limit. */
  readonly truncated: boolean
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

/** Input of the 读书 capability (ADR-0020): handed to `capabilityRun('ebook', …)` as `input`. */
export interface KbExtractArgs {
  /** KB-relative path of the resource to extract, `resources/…`. */
  readonly path: string
}

/** Result of the 读书 capability (ADR-0020): the `result` of `capabilityRun('ebook', …)`. */
export interface KbExtractResult {
  /** KB-relative path of the cached extract text, `.yantao/extracts/….txt`. */
  readonly extractPath: string
  /** The format the extractor ran with. */
  readonly format: string
  /** The extract's character count. */
  readonly chars: number
  /** True when an existing cache answered and no extraction ran. */
  readonly cached: boolean
}

/**
 * One file a capability run asks the controller to write (ADR-0021). Mirrors
 * `capability/run.ts`'s script contract rather than importing it: `types.ts`
 * is the contract the Client reads, and `run.ts` drags `node:child_process`
 * in with it.
 */
export interface KbCapabilityArtifact {
  /** File name inside `.yantao/capabilities/<name>/`; a bare name, never a path. */
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

/** Result of `yantaoKb.capabilityRun` (ADR-0021). */
export interface KbCapabilityRunResult {
  /** The capability that ran. */
  readonly name: string
  /** When the run completed, as an ISO 8601 string. */
  readonly runAt: string
  /** The capability's answer to its caller; opaque to the controller. */
  readonly result?: JsonValue
  /** KB-relative paths of the files the run wrote under `.yantao/capabilities/<name>/`. */
  readonly artifacts: readonly string[]
}

/**
 * What a capability accepts (ADR-0021), as declared by its
 * `metadata.yantao.appliesTo`. Mirrors `capability/run.ts`'s
 * `CapabilityAppliesTo` rather than importing it: `types.ts` stays free of
 * `run.ts`'s subprocess machinery.
 */
export interface KbCapabilityAppliesTo {
  /** Resource suffixes (with dot, lowercase), e.g. `['.epub', '.pdf']`. */
  readonly resource?: readonly string[]
  /** Entity types the capability accepts, e.g. `['project']`. */
  readonly entity?: readonly string[]
  /** External sources the capability reads, e.g. `['mailbox']`. */
  readonly external?: readonly string[]
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
  /** Entry script path, relative to the capability's directory. */
  readonly entry: string
  /** The only runtime in v1: `python`. */
  readonly runtime: string
  /** What the capability accepts; absent means "offered from the 能力 tab only". */
  readonly appliesTo?: KbCapabilityAppliesTo
  /** When the capability last ran, as an ISO 8601 string; absent when never run. */
  readonly lastRunAt?: string
  /** The state the last run left behind; opaque to the controller. */
  readonly state?: JsonValue
}

/** Result of `yantaoKb.capabilityList` (ADR-0021). */
export interface KbCapabilityListResult {
  /** The capabilities, in discovery order. */
  readonly capabilities: readonly KbCapabilitySummary[]
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
