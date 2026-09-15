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
 * pdf row. A NUL byte is the cheapest reliable marker: every format ADR-0020
 * classifies as binary carries one, while no note does. A binary file is
 * refused instead.
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
 * Move the mail capability's processed range (ADR-0019): everything at or
 * before `lastReadAt` has been seen, so the next `mailFetch` starts after
 * it; `firstReadAt` names the oldest mail of the batch just dealt with and
 * is kept as the minimum ever seen, so the UI can show the processed range
 * (e.g. 2025-12-31 到 2026-01-31) without re-deriving it.
 *
 * The cursor lives in the KB's `.yantao/state.json` (ADR-0024) — machine
 * state next to the KB it was read for, never in the KB's markdown.
 * @param args - the stamps to store; `lastReadAt` defaults to now.
 * @returns the processed range as it now stands.
 */
@Remote('mailMarkRead') async mailMarkRead(args: KbMailMarkReadArgs): Promise<KbMailMarkReadResult>

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
 * `.yantao/capabilities/<name>/` at paths the script cannot choose, and the
 * returned state is persisted under `capabilities.<name>.state` in the KB's
 * `.yantao/state.json` (ADR-0024) — machine state inside the KB, which stays
 * markdown for humans. The agent has its own channel into the same seam:
 * `kb_run_capability` (ADR-0023), gated per capability by the sidecar's
 * `invocation` declaration.
 * @param args - the capability's skill name and the caller's input, handed
 *   to the entry script verbatim.
 * @returns what the run answered, when it ran, and which artifact paths were written.
 */
@Remote('capabilityRun') async capabilityRun(args: KbCapabilityRunArgs): Promise<KbCapabilityRunResult>

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
 * (`capabilities.<name>` in the KB's `.yantao/state.json`, ADR-0024): when it last ran and
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
