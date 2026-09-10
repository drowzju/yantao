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
  /** For a resource: its shadow-note path, when the note exists. */
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
/** The full KB tree payload returned by `yantaoKb.tree`. */
interface KbTree {
  /** The five sections in display order. */
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

Remote failures of this namespace classify as `RemoteError` with two domain codes: `yantao-kb/not-found` when the path names no existing file, and `yantao-kb/rejected` for an escape attempt, a non-file target, or an I/O refusal. Both carry the offending `path` in `details`.

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
 * @returns the three intake sections in display order; resource rows pair their shadow notes.
 */
@Remote('intakeTree') async intakeTree(): Promise<KbTree>

/**
 * The workspace side of the KB: projects, areas, people.
 * @returns the three workspace sections in display order, entity rows carrying archive and relation flags.
 */
@Remote('workspaceTree') async workspaceTree(): Promise<KbTree>

/**
 * Read one KB file's complete content.
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
 * @param args - the entity kind, its display name, and the meeting's own date.
 * @returns the KB-relative path of the created file.
 */
@Remote('createEntity') async createEntity(args: KbCreateEntityArgs): Promise<KbCreateEntityResult>

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
```

Source: [`packages/api/yantao-kb-controller/src/index.ts`](../../packages/api/yantao-kb-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
