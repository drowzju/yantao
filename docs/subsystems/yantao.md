# yantao 知识库与 yantaoKb

[`@deepseek-ai/dsh-yantao-kb`](../../packages/yantao/kb) owns the PARA+P personal knowledge base and the agent's trust-boundary `kb_` tool family; [`@deepseek-ai/dsh-api-yantao-kb-controller`](../../packages/api/yantao-kb-controller) owns the workbench UI's direct channel over the `yantaoKb` Typert Remote namespace. Two Cordis services bind the surface together: `ctx.yantaoKb`, the resolved KB root published by the kb plugin, and `ctx.yantaoKbController`, the controller itself.

## The shared root

The kb plugin resolves `kbRoot` from its composition config and publishes it as `ctx.yantaoKb` so host-side consumers share the one configuration point instead of duplicating it. The controller activates only after that publication (`static inject = ['yantaoKb']`).

```ts type-equiv
/**
 * The resolved KB root, published while the yantao-kb plugin is mounted so
 * host-side consumers (the yantao-kb-controller Remote) share this one
 * configuration point instead of duplicating it.
 */
interface YantaoKbService {
  /** Resolved knowledge-base root directory. */
  readonly root: string
}
```

## Wire payloads

Every value the namespace carries is plain JSON. Paths are KB-relative with forward slashes, confined to the root at the controller boundary; section labels stay out of the payload (the Client owns its locale).

```ts type-equiv
/** One file row in a KB tree section. */
interface KbTreeFile {
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
```

```ts type-equiv
/** Stable section identifiers of the KB tree, in display order. */
type KbTreeSectionId = 'resources' | 'projects' | 'areas' | 'people' | 'sessions'
```

```ts type-equiv
/** One KB tree section. */
interface KbTreeSection {
  /** Stable section id (the Client maps it to a localized label). */
  readonly id: KbTreeSectionId
  /** Files in the section, in directory read order. */
  readonly files: readonly KbTreeFile[]
}
```

```ts type-equiv
/** The tree payload returned by `yantaoKb.intakeTree` / `yantaoKb.workspaceTree`. */
interface KbTree {
  /** The sections in display order. */
  readonly sections: readonly KbTreeSection[]
}
```

```ts type-equiv
/** Result of `yantaoKb.read`. */
interface KbFileContent {
  /** The KB-relative path that was read. */
  readonly path: string
  /** The file's complete UTF-8 content. */
  readonly content: string
}
```

```ts type-equiv
/** Result of `yantaoKb.write`. */
interface KbWriteResult {
  /** The KB-relative path that was written. */
  readonly path: string
}
```

## Failure vocabulary

Remote failures of this namespace classify as `RemoteError` with two domain codes: `yantao-kb/not-found` when the path names no existing file, and `yantao-kb/rejected` for an escape attempt, a non-file target, or an I/O refusal. Both carry the offending `path` in `details`. Connector failures classify as `yantao-kb/mail` and extraction failures as `yantao-kb/extract`, each carrying the failure's `kind` and a `hint` naming the remedy in `details`.

The UI is the human channel, so `write` is a full-file write with no frontmatter validation — the ADR-0004 trust boundary binds only the agent's `kb_` tools, never this surface. The generated Cordis API below is the method-level authority.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxyantaokb--yantaokbservice"></a>

### `ctx.yantaoKb` — `YantaoKbService`

The live KB root, published while the yantao-kb plugin is mounted so host-side consumers (the yantao-kb-controller Remote) share this one configuration point instead of duplicating it. The root starts as the settings-plane pointer when one is recorded (an imported legacy pointer included), and otherwise as the config default; `setRoot` retargets the whole host at a new root by writing the settings namespace, and an external edit of that namespace retargets the live root through the watcher.

```ts cordis-catalog
/**
 * Retarget the live KB at `next` and persist it as the settings-plane pointer.
 * @param next - the new knowledge-base root directory (absolute).
 */
setRoot(next: string): void
```

Source: [`packages/yantao/kb/src/index.ts`](../../packages/yantao/kb/src/index.ts)

<a id="ctxyantaokbcontroller--yantaokbcontroller"></a>

### `ctx.yantaoKbController` — `YantaoKbController`

UI-direct KB operations over the `yantaoKb` Remote namespace.

```ts cordis-catalog
/**
 * The intake side of the KB: resources and the todo singleton.
 * Every section is present even when its directory is absent or empty.
 * @returns the two intake sections in display order; a resource row pairs its companion note when one exists.
 */
@Remote('intakeTree') async intakeTree(): Promise<KbTree>

/**
 * The workspace side of the KB: projects, areas, people, meetings.
 * @returns the four workspace sections in display order, entity rows carrying archive and relation flags.
 */
@Remote('workspaceTree') async workspaceTree(): Promise<KbTree>

/**
 * Read one KB file's complete content.
 *
 * A resource original is often binary (pdf/epub/…). Decoding it as UTF-8
 * yields a mojibake string the size of the file, which the RPC channel then
 * serializes and the workbench renders — the freeze behind left-clicking a
 * pdf row. A NUL byte is the cheapest reliable marker: every format ADR-0020
 * classifies as binary carries one, while no note does. A binary file is
 * refused instead.
 * @param path - KB-relative path with forward slashes.
 * @returns the path and the file's complete UTF-8 content.
 */
@Remote('read') async read(path: string): Promise<KbFileContent>

/**
 * The human render view of one read-only file (ADR-0046 决定 3): the
 * workbench's `ReadOnlyFile` picks its renderer from the answer's `kind`
 * instead of sniffing extensions again client-side. `.pdf` answers base64
 * bytes (the client turns them into a Blob URL for the built-in PDFium
 * viewer), `.html` its raw text (the client sandboxes it), `.eml` the
 * parsed mail (headline fields, bodies, attachment listing — never
 * attachment content), everything else plain text with the same NUL
 * refusal `read` has. The agent's read plane transpiles `.pdf`/`.eml`
 * through the same kernel functions (`@deepseek-ai/dsh-yantao-kb`'s
 * resource-content), so both faces agree on what a file "says".
 * @param path - KB-relative path with forward slashes.
 * @returns the discriminated render view.
 */
@Remote('readResourceView') async readResourceView(path: string): Promise<KbResourceView>

/**
 * One image's complete bytes for the reading view (ADR-0048 决定 3): the
 * client turns the answer into a Blob URL for an `<img src>` — the same
 * base64-over-RPC pattern `readResourceView` established for PDFs (its
 * 决定 4 explains why no HTTP byte route exists). Image extensions only:
 * the reading view's image pathway is the sole caller, and bounding the
 * answer to pictures keeps this RPC from becoming a general binary read.
 * @param path - KB-relative path with forward slashes.
 * @returns the image's MIME type and base64 bytes.
 */
@Remote('readResourceBinary') async readResourceBinary(path: string): Promise<KbResourceBinary>

/**
 * Both halves of one file's `[[…]]` link graph (ADR-0015): what it links out
 * to, resolved to entity files, and which files link back into it.
 *
 * The scan lives here rather than in the Client because it reads every
 * entity note — one round trip instead of one per file — and because
 * resolution is a host-side rule (`类型:名字` locators, dated meetings).
 * @param path - KB-relative path with forward slashes.
 * @returns the file's outgoing and incoming links.
 */
@Remote('links') async links(path: string): Promise<KbLinksResult>

/**
 * The whole KB's `[[…]]` link graph in one payload (ADR-0035): every entity
 * file as a node, every link as an edge with its resolution. The scan lives
 * here for the same reason `links` does — it reads every entity note — and
 * the 实体校验 gesture consumes it for its deterministic pre-scan (orphans,
 * broken links); a future related-entities panel is its natural second
 * consumer.
 * @returns every entity path plus every resolved-or-not edge.
 */
@Remote('graph') async graph(): Promise<KbGraphResult>

/**
 * The whole KB's typed relation graph (ADR-0049): the three relations the
 * 图谱 tab draws — person–project, area–project (the project frontmatter
 * `areas` list included), person–person — as one payload. Edges touching
 * meetings, the todo singleton, archived entities, or unresolved targets
 * never appear; the scan reuses `linkGraphOf` so the two graphs agree on
 * every resolution rule.
 * @returns every active entity path plus every deduplicated relation edge.
 */
@Remote('relationGraph') async relationGraph(): Promise<KbRelationGraphResult>

/**
 * The live KB root and whether the human has chosen one yet.
 * @returns the root in force and `configured` — true when a persisted root override exists.
 */
@Remote('root') root(): Promise<KbRootResult>

/**
 * The yantao layer's own share of the system prompt, for the workbench's
 * context meter (ADR-0039): the static discipline sections priced from
 * the same files the plugin registers, the filesystem discipline priced
 * as rendered (ADR-0042: `{{kbRoot}}` resolved against the live root),
 * plus the dynamic global behavior-memory section priced from the live
 * store. Priced with the meter's fixed density heuristic (4 characters
 * per token) so the figures speak the same vocabulary as the
 * `contextBreakdown` projection's system bucket, of which they are the
 * yantao-attributable slice.
 * @returns the static and behavior-memory shares, in heuristic tokens.
 */
@Remote('promptInjection') promptInjection(): Promise<KbPromptInjectionResult>

/**
 * Choose the knowledge base: initialize `path` as a KB and hand it to the
 * `yantaoKb` service, which makes it the live root for every host-side
 * consumer and persists it as the root override.
 * @param path - absolute path of the knowledge-base root directory.
 * @returns the root now in force plus what the initialization created or found.
 */
@Remote('setRoot') async setRoot(path: string): Promise<KbSetRootResult>

/**
 * Create one entity note from the canonical template.
 * @param args - the entity kind, its display name, the meeting's own date,
 *   and the person's relation to the KB's owner and e-mail address.
 * @returns the KB-relative path of the created file.
 */
@Remote('createEntity') async createEntity(args: KbCreateEntityArgs): Promise<KbCreateEntityResult>

/**
 * Copy one dropped file into `resources/` (ADR-0020) — the drag-and-drop
 * intake. The browser cannot hand over a filesystem path, so the content
 * arrives base64-encoded and is decoded here; the copy is pure (no shadow
 * note), and an existing resource is refused rather than overwritten.
 * @param args - the file's name and its base64-encoded content.
 * @returns the KB-relative path of the copied resource.
 */
@Remote('registerResource') async registerResource(args: KbRegisterResourceArgs): Promise<KbRegisterResourceResult>

/**
 * Write one KB file's complete content (the human channel's full-file
 * write; missing parent directories are created). The file is not
 * validated — the human owns its structure, and the agent's tools
 * re-validate on their next read.
 * @param path - KB-relative path with forward slashes.
 * @param content - the complete new UTF-8 content.
 * @returns the written path.
 */
@Remote('write') async write(path: string, content: string): Promise<KbWriteResult>

/**
 * Rewrite one person entity's `relation` — the workbench's right-click
 * 「关系」 on a 人物 row.
 *
 * Only a person carries the field, so anything else is refused rather than
 * silently given one: the relation is how the KB knows who somebody is to
 * its owner, and a project with a `relation:` line is a mistake a later
 * reader would have to guess about. The value is checked against the
 * domain's five, and the write is a line splice inside the frontmatter —
 * the rest of the document, human-written, is left byte-identical.
 * @param args - the entity's path and the relation to write.
 * @returns the path and the relation it now carries.
 */
@Remote('setRelation') async setRelation(args: KbSetRelationArgs): Promise<KbSetRelationResult>

/**
 * Archive one entity — the workbench's 「归档」 gesture (ADR-0041 决定 6/8).
 *
 * Entities are never deleted: archiving flips the frontmatter's
 * `archive: true`, which retires the entity from the active roster
 * (`listEntities` hides it by default) while the file — and every link
 * into it — stays put. The kb layer appends one dated 「归档」 bullet to
 * the entity's own 流水 section; the flip is idempotent, so archiving an
 * archived entity writes nothing. The todo singleton has no archive
 * semantics and is refused (ADR-0041 决定 2).
 * @param locator - entity locator: `type:name` or an entity file path, resolved exactly like the kb layer's.
 * @returns the KB-relative path and the flag now in effect.
 */
@Remote('archiveEntity') async archiveEntity(locator: string): Promise<KbSetEntityArchivedResult>

/**
 * Restore one archived entity — the same mechanism, the other direction
 * (ADR-0041 决定 6): the frontmatter flag comes off and the entity rejoins
 * the active roster, one dated 「还原」 bullet appended to its 流水.
 * Idempotent like archiving: restoring an active entity writes nothing.
 * @param locator - entity locator: `type:name` or an entity file path.
 * @returns the KB-relative path and the flag now in effect.
 */
@Remote('restoreEntity') async restoreEntity(locator: string): Promise<KbSetEntityArchivedResult>

/**
 * Delete one resource file — the workbench's 「删除」 gesture on a resource
 * row. Resources are dumb raw material (ADR-0020): unlike entities (ADR-0041
 * 决定 8 — never deleted, only archived) a resource can go away for good.
 * The trust boundary is untouched: this lives on the UI's Remote namespace,
 * which the agent's tool layer never sees — the agent keeps its creation-
 * only / read-only resource tools (ADR-0028). Confined twice over: the KB
 * confinement, then a `resources/` prefix — entity notes, the todo
 * singleton and anything else in the KB are refused. The UI confirms
 * before invoking (the menu's armed second click); the server does not
 * second-guess a confirmed human gesture.
 * @param path - KB-relative path with forward slashes, under `resources/`.
 * @returns the deleted path.
 */
@Remote('deleteResource') async deleteResource(path: string): Promise<KbDeleteResourceResult>

/**
 * The structured todo board (ADR-0018): the `entities/todos.md` singleton
 * parsed into items, plus the file's exact text — the UI echoes that text
 * back as `writeTodos`'s `expectedText`, which is what makes the board's
 * optimistic concurrency work. The parse lives here because the Client
 * cannot import the kb package's values (bundle purity).
 * @returns the singleton's path, its exact current text, and its items in file order.
 */
@Remote('todos') async todos(): Promise<KbTodosResult>

/**
 * Write the whole todo list back (ADR-0018), replacing the file's items but
 * keeping its preamble: a heading the human wrote above the checklist is
 * theirs, and the UI sends items only.
 *
 * `expectedText` is the optimistic-concurrency check — the same pre-save
 * comparison the editor's autosave uses (ADR-0012), not a second model: a
 * stale value means somebody else (Obsidian, an agent, another tab) got
 * there first, and the UI refreshes rather than clobbering.
 * @param args - the new item list and the text the caller last read.
 * @returns the singleton's path and what is on disk now.
 */
@Remote('writeTodos') async writeTodos(args: KbWriteTodosArgs): Promise<KbWriteTodosResult>

/**
 * The KB's change counter (ADR-0017). The UI compares it across polls to learn
 * that something changed **outside** the workbench — an edit in Obsidian, a
 * `git checkout`, an agent write. An edit made inside the workbench does not
 * move it, because the UI already knows about those.
 *
 * The watcher is (re-)pointed at the live root on every call: the root is
 * mutable through `setRoot`, and a watcher left behind would watch a
 * directory nobody edits any more.
 * @returns the root being watched and the counter's current value.
 */
@Remote('revision') revision(): Promise<KbRevisionResult>

/**
 * Hand one target to the desktop's own handler (ADR-0017) — the whole
 * "borrow Obsidian" bridge.
 *
 * `target` is either a KB-relative path (opened with whatever the desktop
 * associates with `.md`) or a URI of an allowlisted scheme, which is how the
 * UI asks for `obsidian://open?path=…`. Anything else is refused: an
 * open-ended "run this string on the host" would be a shell, not a bridge,
 * and the trust boundary is the whole point of this project.
 * @param target - a KB-relative path, or a URI (see `open.ts`).
 * @returns the target that was opened.
 */
@Remote('openExternal') openExternal(target: string): Promise<KbOpenExternalResult>

/**
 * Move the mail capability's processed range (ADR-0019): everything at or
 * before `lastReadAt` has been seen, so the next `mailFetch` starts after
 * it; `firstReadAt` names the oldest mail of the batch just dealt with and
 * is kept as the minimum ever seen, so the UI can show the processed range
 * (e.g. 2025-12-31 到 2026-01-31) without re-deriving it.
 *
 * The cursor lives in the KB's `.dsh/yantao/state.json` (ADR-0024) — machine
 * state next to the KB it was read for, never in the KB's markdown.
 * @param args - the stamps to store; `lastReadAt` defaults to now.
 * @returns the processed range as it now stands.
 */
@Remote('mailMarkRead') async mailMarkRead(args: KbMailMarkReadArgs): Promise<KbMailMarkReadResult>

/**
 * The memory store's listing (ADR-0032): every scope that has a markdown
 * file under `.dsh/yantao/memory/` — `global.md` first, then the capability
 * scopes name-sorted — each with its exact text and parsed entries. The
 * scan is directory-driven, so a file the human created by hand is a scope
 * like any other. Injection (batch ②) reads the same files.
 * @returns the scopes, global first.
 */
@Remote('memoryList') async memoryList(): Promise<KbMemoryListResult>

/**
 * Remember one behavior rule (ADR-0032): append a stamped `- ` bullet to the
 * scope's markdown file, creating the file with its heading when absent.
 * This is the human channel's write — the UI's `add-memory` proposal row
 * lands here after the human ticks it — and an already-remembered text is
 * refused rather than duplicated, so the caller shows the human what is
 * already there. The agent has no tool into this surface: its route is a
 * proposal the human approves, never a direct write.
 * @param args - the scope (`global` or a capability name) and the rule's text.
 * @returns the scope's path and the entry as written.
 */
@Remote('memoryAdd') async memoryAdd(args: KbMemoryAddArgs): Promise<KbMemoryAddResult>

/**
 * Forget one behavior rule (ADR-0032): removal is human-only, addressed by
 * the entry's id. A stale id — the human edited the line meanwhile — is a
 * `not-found`, and the caller refreshes rather than guessing.
 * @param args - the scope and the entry's id.
 * @returns the scope's path.
 */
@Remote('memoryDelete') async memoryDelete(args: KbMemoryDeleteArgs): Promise<KbMemoryDeleteResult>

/**
 * The proposal queue's listing (ADR-0044): every scope that has a queue
 * file under `.dsh/yantao/memory/proposals/` — `global.md` first, then the
 * capability scopes name-sorted — each with its exact text and parsed
 * pending proposals, source annotations included for the human's judgment.
 * The queue is never injected into any prompt; this listing and the
 * conversation approval cards are its only readers.
 * @returns the scopes, global first.
 */
@Remote('memoryProposalList') async memoryProposalList(): Promise<KbMemoryProposalListResult>

/**
 * Approve one pending proposal (ADR-0044 决定 7): the bare text lands in
 * the target scope's memory file through `appendMemoryEntry` — dedup,
 * ordering and line format come for free — and only then leaves the queue.
 * The target scope is re-judgeable per approval (default: the source
 * scope). An already-remembered text is refused (`duplicate-memory`) and
 * the pending copy stays for the human to discard explicitly; a stale text
 * (processed meanwhile) is a `not-found` and the caller refreshes.
 * @param args - the source scope, the proposal's text, and the optional re-judged target scope.
 * @returns the queue path, the memory path, and the entry as written.
 */
@Remote('memoryProposalApprove') async memoryProposalApprove(args: KbMemoryProposalApproveArgs): Promise<KbMemoryProposalApproveResult>

/**
 * Discard one pending proposal (ADR-0044 决定 7): the line leaves the
 * queue and nothing is remembered. Addressed by text — the conversation
 * approval card holds the tool args (scope+text), and per-scope dedup
 * makes text unique within a queue.
 * @param args - the source scope and the proposal's text.
 * @returns the queue path.
 */
@Remote('memoryProposalDiscard') async memoryProposalDiscard(args: KbMemoryProposalDiscardArgs): Promise<KbMemoryProposalDiscardResult>

/**
 * The prompt-shortcut store's listing (ADR-0040): the human's favorite
 * slash aliases in display order. The `/` menu's shortcut group and the
 * capability tab's home list both read through this; the agent's own view
 * is the injected prompt section, never this RPC.
 * @returns the shortcuts as stored.
 */
@Remote('promptShortcutList') async promptShortcutList(): Promise<KbPromptShortcutListResult>

/**
 * Save the whole shortcut list (ADR-0040): the UI edits a handful of rows,
 * so a full-list replace keeps reorder and delete trivially correct.
 * Human-channel only — the agent has no tool into this surface. An alias
 * that would shadow a registered skill or capability is refused (ADR-0040
 * 决定 8): the host pre-step claims skill names first, so such a shortcut
 * could never fire, and a confusing duplicate is worse than a refusal.
 * @param args - the complete new list, in display order.
 * @returns the list as stored (normalized).
 */
@Remote('promptShortcutSave') async promptShortcutSave(args: KbPromptShortcutSaveArgs): Promise<KbPromptShortcutSaveResult>

/**
 * The schedule store's listing (ADR-0045): the human's timed tasks in
 * display order. The 调度 tab and the frontend scheduler both read through
 * this; the agent has no tool into this surface at all (决定 4).
 * @returns the schedules as stored.
 */
@Remote('scheduleList') async scheduleList(): Promise<KbScheduleListResult>

/**
 * Save the whole schedule list (ADR-0045): the UI edits a handful of rows,
 * so a full-list replace keeps reorder and delete trivially correct.
 * Human-channel only. The scheduler-owned stamps (`lastFiredAt` /
 * `lastMissedAt`) never travel through this save: an editor's stale
 * snapshot must not rewind the bookkeeping, so existing rows keep the
 * stamps the store holds — the scheduler patches them through
 * `scheduleMark` instead.
 * @param args - the complete new list, in display order.
 * @returns the list as stored (normalized, stamps preserved).
 */
@Remote('scheduleSave') async scheduleSave(args: KbScheduleSaveArgs): Promise<KbScheduleSaveResult>

/**
 * Patch one row's scheduler-owned stamps (ADR-0045): the scheduler's own
 * write path — single-row patches, so bookkeeping never rides (or races) a
 * full-list replace. `null` clears a stamp (a real fire clears the missed
 * mark); an absent field is left alone.
 * @param args - the row id and the stamp changes.
 * @returns the full list as stored after the patch.
 */
@Remote('scheduleMark') async scheduleMark(args: KbScheduleMarkArgs): Promise<KbScheduleMarkResult>

/**
 * The proposal inbox's listing (ADR-0047): structured proposals produced
 * outside a human-initiated card flow — today, a schedule's background
 * session — pending and decided alike, in enqueue order. The 提议 tab and
 * the frontend scheduler both read through this; the agent has no tool
 * into this surface (the scheduler is human-channel code).
 * @returns the entries as stored.
 */
@Remote('proposalInboxList') async proposalInboxList(): Promise<KbProposalInboxListResult>

/**
 * Append one proposal to the inbox (ADR-0047): the producer's write path —
 * today the frontend scheduler, after a fired session's answer parsed into
 * a unified proposal. The store assigns the id, the enqueue stamp, and the
 * pending status; the payload rides opaquely (ADR-0021 决定 4's schema
 * authority stays with the client).
 * @param args - the proposal and its provenance.
 * @returns the full list as stored, plus the fresh entry's id.
 */
@Remote('proposalInboxEnqueue') async proposalInboxEnqueue(args: KbProposalInboxEnqueueArgs): Promise<KbProposalInboxEnqueueResult>

/**
 * Record the human's decision on one pending proposal (ADR-0047): approve
 * or discard. The apply itself is the UI's business (the human channel's
 * `applyProposal`), this only settles the row — a decision is final, an
 * already-decided entry refuses.
 * @param args - the entry id and the decision.
 * @returns the full list as stored after the resolve.
 */
@Remote('proposalInboxResolve') async proposalInboxResolve(args: KbProposalInboxResolveArgs): Promise<KbProposalInboxResolveResult>

/**
 * Run one capability's host entry (ADR-0021) — the human channel's execution
 * seam, the mail connector's and the extractor's subprocess pattern
 * generalized. The capability is resolved through `ctx.skills` (the
 * skill-filesystem provider discovers the directories; this controller only
 * consumes the winner), its `yantao.json` declaration (legacy
 * `metadata.yantao` frontmatter accepted) picks the entry
 * script, and the run is one Python subprocess with a JSON stdin/stdout
 * contract (`capability/run.ts`).
 *
 * The controller, not the script, owns every write: artifacts land under
 * `.dsh/yantao/capabilities/<name>/` at paths the script cannot choose, and the
 * returned state is persisted under `capabilities.<name>.state` in the KB's
 * `.dsh/yantao/state.json` (ADR-0024) — machine state inside the KB, which stays
 * markdown for humans. The agent has its own channel into the same seam:
 * `kb_run_capability` (ADR-0023), gated per capability by the sidecar's
 * `invocation` declaration.
 * @param args - the capability's skill name and the caller's input, handed
 *   to the entry script verbatim.
 * @param signal - the human channel's cancel line (ADR-0031): an abort
 *   kills the entry script's subprocess and rejects with the `cancelled`
 *   kind. The agent channel has no cancel — its runs answer or time out.
 * @returns what the run answered, when it ran, and which artifact paths were written.
 */
@Remote('capabilityRun') async capabilityRun(args: KbCapabilityRunArgs, signal?: AbortSignal): Promise<KbCapabilityRunResult>

/**
 * One capability's declaration, parsed and resolved (ADR-0043 决定 7):
 * both declaration channels answered in data — the directory's own
 * sidecar (raw text included, legacy frontmatter accepted) and the
 * central routing file — plus the same dual-gate agent-invocability the
 * run paths apply. A registration problem (missing sidecar, unregistered
 * route, missing entry file, broken routing file) is stated in the
 * answer, never thrown: the 能力 tab renders it, and an agent
 * troubleshooting a refused call reads the very same resolution the run
 * would have applied. Only an unconfigured KB throws — then nothing
 * could resolve anyway.
 * @param args - the capability's skill name.
 * @returns the parsed declaration, both channels, and the gate's answer.
 */
@Remote('capabilityDeclaration') async capabilityDeclaration(args: KbCapabilityDeclarationArgs): Promise<KbCapabilityDeclarationResult>

/**
 * The capabilities the workbench's 能力 tab shows (ADR-0021 决定 8):
 * every skill under the KB's own `.dsh/skills/` (ADR-0024 决定 4) that
 * declares a
 * capability manifest (`yantao.json` sidecar, legacy `metadata.yantao`
 * frontmatter accepted) — plain skills without one are not capabilities
 * and are skipped, not errors. Shipped capabilities are seeded first, so a
 * fresh KB answers with 邮件 on its very first open.
 *
 * Each row merges the skill's declaration with the persisted record
 * (`capabilities.<name>` in the KB's `.dsh/yantao/state.json`, ADR-0024): when it last ran and
 * the state that run left behind, so the panel can show a real 断点 without
 * running anything.
 *
 * The answer also carries the 未注册 group (ADR-0025 决定 1): skills
 * discovered outside the KB that adoption could copy in — directory
 * bundles, name-sorted, after the registered list — and skills living
 * inside the KB's own `.dsh/skills/` whose declaration is missing or
 * invalid, greyed rows carrying the reason; registration (ADR-0025 决定 1)
 * writes their sidecar in place. Bundled skills (dsh's own) are not
 * third-party finds and never appear.
 * @returns both groups.
 */
@Remote('capabilityList') async capabilityList(): Promise<KbCapabilityListResult>

/**
 * Scaffold a new capability directory (ADR-0021 决定 8's 「新建能力」):
 * `<kbRoot>/.dsh/skills/<name>/` with a clean SKILL.md, a `yantao.json`
 * sidecar that declares the host entry, and an entry script that speaks the
 * run protocol and echoes its input — a working capability on the first
 * run, for the human to grow into theirs.
 * @param args - the capability's name (kebab-case; it becomes the skill name).
 * @returns the KB-relative path of the scaffolded directory.
 */
@Remote('capabilityCreate') async capabilityCreate(args: KbCapabilityCreateArgs): Promise<KbCapabilityCreateResult>

/**
 * Adopt one unregistered skill (ADR-0025 决定 1): copy its directory into
 * `<kbRoot>/​.dsh/skills/<name>/` and declare it in the central routing
 * file (`invocation: ['human']`, no `entry` — an instruction capability;
 * ADR-0025 落地注记二). The copy, never a move: the source directory is
 * shared with every other dsh usage, and moving would steal it. Any
 * `yantao.json` sidecar the source carried is removed from the copy —
 * outside declarations never take effect silently; the confirm box showed
 * them before this call existed.
 *
 * Guards: the name must be a single safe path segment, the target must not
 * exist (a collision with a builtin or an adopted capability is refused,
 * never overwritten), and the skill must be a directory bundle that its
 * frontmatter has not marked `user-invocable: false`.
 * @param args - the unregistered skill's name.
 * @returns the adopted directory's KB-relative path.
 */
@Remote('capabilityAdopt') async capabilityAdopt(args: KbCapabilityAdoptArgs): Promise<KbCapabilityAdoptResult>

/**
 * Register one in-KB skill as a capability (ADR-0025 决定 1) by writing a
 * route entry into the central routing file `.dsh/skills/yantao.json`
 * (ADR-0025 落地注记二) — pure configuration: no copy, no move, no rename,
 * the skill directory stays byte-identical. Registration always writes an
 * *instruction capability* (no `entry`, ADR-0023 决定 6): a third-party
 * skill's essence is its SKILL.md instructions, and nothing in the drop
 * speaks the run protocol, so the type is never a question the human
 * answers. The three boolean args are the reach of the capability:
 * `agentInvoke` widens `invocation` to `['human', 'agent']`,
 * `resourceMenu` writes `appliesTo.resource: true` (every resource's
 * right-click menu), `selectionMenu` writes `appliesTo.selection: true`
 * (the middle-pane right-click menu).
 *
 * A dropped **plugin repository** (no top-level `SKILL.md`, but nested
 * `skills/<name>/SKILL.md` bundles) registers as one route entry per
 * nested child, `path` pointing at `<repo>/skills/<child>` — any depth
 * works, because instruction capabilities run entirely controller-side and
 * never need the scanner to see the directory. The repository tree is
 * never touched, so updating it is a plain re-drop, and un-registering is
 * deleting the entry.
 *
 * Guards: the name must be a single safe path segment; a plain skill must
 * be a directory bundle inside the KB's own `.dsh/skills/` whose
 * frontmatter does not mark it `user-invocable: false`; a valid
 * declaration (sidecar or frontmatter) is never silently overwritten; and
 * a directory carrying an *invalid* `yantao.json` refuses too — delete or
 * fix that file first, a central route must not quietly shadow a
 * declaration the human left in place.
 * @param args - the in-KB skill's name and the capability's reach.
 * @returns the KB-relative path of the central routing file.
 */
@Remote('capabilityRegister') async capabilityRegister(args: KbCapabilityRegisterArgs): Promise<KbCapabilityRegisterResult>
```

Source: [`packages/api/yantao-kb-controller/src/index.ts`](../../packages/api/yantao-kb-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
