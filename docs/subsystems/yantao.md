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

The resolved KB root, published while the yantao-kb plugin is mounted so host-side consumers (the yantao-kb-controller Remote) share this one configuration point instead of duplicating it.

Source: [`packages/yantao/kb/src/index.ts`](../../packages/yantao/kb/src/index.ts)

<a id="ctxyantaokbcontroller--yantaokbcontroller"></a>

### `ctx.yantaoKbController` — `YantaoKbController`

UI-direct KB operations over the `yantaoKb` Remote namespace.

```ts cordis-catalog
/** The five-section KB tree; every section is present even when its directory is absent or empty.
 * @returns the five sections in display order, resource rows pairing their shadow notes and entity rows carrying flags.
 */
@Remote('tree') async tree(): Promise<KbTree>

/**
 * Read one KB file's complete content.
 * @param path - KB-relative path with forward slashes.
 * @returns the path and the file's complete UTF-8 content.
 */
@Remote('read') async read(path: string): Promise<KbFileContent>

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
```

Source: [`packages/api/yantao-kb-controller/src/index.ts`](../../packages/api/yantao-kb-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
