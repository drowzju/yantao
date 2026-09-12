# yantao 知识库与 yantaoKb

English | [中文](yantao.zh.md)

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

The live KB root, published while the yantao-kb plugin is mounted so host-side consumers (the yantao-kb-controller Remote) share this one configuration point instead of duplicating it. The root starts as the persisted override when the workbench has chosen one, and otherwise as the config default; `setRoot` retargets the whole host at a new root.

```ts cordis-catalog
/**
 * Retarget the live KB at `next` and persist it as the override.
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
 * The intake side of the KB: resources, meetings, and the todo singleton.
 * Every section is present even when its directory is absent or empty.
 * @returns the three intake sections in display order; a resource row pairs its companion note when one exists.
 */
@Remote('intakeTree') async intakeTree(): Promise<KbTree>

/**
 * The workspace side of the KB: projects, areas, people.
 * @returns the three workspace sections in display order, entity rows carrying archive and relation flags.
 */
@Remote('workspaceTree') async workspaceTree(): Promise<KbTree>

/**
 * Read one KB file's complete content.
 *
 * A resource original is often binary (pdf/epub/…). Decoding it as UTF-8
 * yields a mojibake string the size of the file, which the RPC channel then
 * serializes and the workbench renders — the freeze behind left-clicking a
 * pdf row. A NUL byte is the cheapest reliable marker: every format the
 * extractor (ADR-0020) calls binary carries one, while no note does. A
 * binary file is refused instead; its text route is the extract.
 * @param path - KB-relative path with forward slashes.
 * @returns the path and the file's complete UTF-8 content.
 */
@Remote('read') async read(path: string): Promise<KbFileContent>

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
 * The live KB root and whether the human has chosen one yet.
 * @returns the root in force and `configured` — true when a persisted root override exists.
 */
@Remote('root') root(): Promise<KbRootResult>

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
 *   the person's relation to the KB's owner, and — for a reading project —
 *   the resource it reads (ADR-0020), written into the frontmatter as `source:`.
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
 * Delete one KB file — the workbench's right-click 「删除」 on an entity row.
 *
 * The human channel owns the KB's files, so this is a real unlink and not an
 * archive: a row the human created and no longer wants is gone. The path is
 * confined like every other one, and a missing file is
 * `yantao-kb/not-found` rather than a silent success, so the UI can tell
 * "already deleted" from "deleted just now".
 * @param path - KB-relative path with forward slashes.
 * @returns the deleted path.
 */
@Remote('deleteFile') async deleteFile(path: string): Promise<KbDeleteFileResult>

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
 * Move the mail connector's watermark (ADR-0019): everything at or before
 * `lastReadAt` has been seen, so the next `mailFetch` starts after it.
 *
 * The cursor lives in `~/.dsh`, next to the KB root it was read for, and
 * never in the KB itself — that is markdown for humans.
 * @param args - the stamp to store; defaults to now.
 * @returns the watermark as it now stands.
 */
@Remote('mailMarkRead') async mailMarkRead(args: KbMailMarkReadArgs): Promise<KbMailMarkReadResult>

/**
 * Run one capability's host entry (ADR-0021) — the human channel's execution
 * seam, the mail connector's and the extractor's subprocess pattern
 * generalized. The capability is resolved through `ctx.skills` (the
 * skill-filesystem provider discovers the directories; this controller only
 * consumes the winner), its `metadata.yantao` declaration picks the entry
 * script, and the run is one Python subprocess with a JSON stdin/stdout
 * contract (`capability/run.ts`).
 *
 * The controller, not the script, owns every write: artifacts land under
 * `.yantao/capabilities/<name>/` at paths the script cannot choose, and the
 * returned state is persisted under `capabilities.<name>.state` in
 * `~/.dsh/yantao-kb.json` — metadata outside the KB, which stays markdown
 * for humans. Execution exists only here, before a session: the agent gets
 * no `kb_run_capability` tool (ADR-0021 取舍台账第 2 条).
 * @param args - the capability's skill name and the caller's input, handed
 *   to the entry script verbatim.
 * @returns what the run answered, when it ran, and which artifact paths were written.
 */
@Remote('capabilityRun') async capabilityRun(args: KbCapabilityRunArgs): Promise<KbCapabilityRunResult>

/**
 * List the capabilities the workbench's 能力 tab shows (ADR-0021 决定 8):
 * every skill `ctx.skills` discovers at the KB root that declares a
 * `metadata.yantao` entry — plain skills without one are not capabilities
 * and are skipped, not errors. Shipped capabilities are seeded first, so a
 * fresh KB answers with 邮件 and 读书 on its very first open.
 *
 * Each row merges the skill's declaration with the persisted record
 * (`capabilities.<name>` in `~/.dsh/yantao-kb.json`): when it last ran and
 * the state that run left behind, so the panel can show a real 断点 without
 * running anything.
 * @returns the capability summaries, in discovery order.
 */
@Remote('capabilityList') async capabilityList(): Promise<KbCapabilityListResult>

/**
 * Add one directory to the capability search path (ADR-0021 决定 8's
 * 「添加目录」): the human points the workbench at a folder of capability
 * directories they manage outside the KB, and from then on `ctx.skills`
 * discovers them like any other root.
 *
 * The list persists in `~/.dsh/yantao-kb.json` (`capabilityDirs`) and this
 * controller re-registers its single provider over it — see
 * `registerCapabilityDirs` for why there is exactly one.
 * @param path - absolute path of the directory to add.
 * @returns the full list of registered directories as it now stands.
 */
@Remote('capabilityRegisterDir') async capabilityRegisterDir(path: string): Promise<KbCapabilityRegisterDirResult>

/**
 * Scaffold a new capability directory (ADR-0021 决定 8's 「新建能力」):
 * `<kbRoot>/.dsh/skills/<name>/` with a SKILL.md frontmatter that already
 * declares the host entry, and an entry script that speaks the run protocol
 * and echoes its input — a working capability on the first run, for the
 * human to grow into theirs.
 * @param args - the capability's name (kebab-case; it becomes the skill name).
 * @returns the KB-relative path of the scaffolded directory.
 */
@Remote('capabilityCreate') async capabilityCreate(args: KbCapabilityCreateArgs): Promise<KbCapabilityCreateResult>
```

Source: [`packages/api/yantao-kb-controller/src/index.ts`](../../packages/api/yantao-kb-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
