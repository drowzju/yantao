# yantao 知识库与 yantaoKb

[English](yantao.md) | 中文

[`@deepseek-ai/dsh-yantao-kb`](../../packages/yantao/kb) 拥有 PARA+P 个人知识库与 agent 的信任边界 `kb_` 工具族；[`@deepseek-ai/dsh-api-yantao-kb-controller`](../../packages/api/yantao-kb-controller) 拥有工作台 UI 在 `yantaoKb` Typert Remote 命名空间上的直连通道。两个 Cordis 服务把这个表面粘合在一起：`ctx.yantaoKb`——kb 插件发布的解析后 KB 根目录，以及 `ctx.yantaoKbController`——控制器本身。

## 共享的根目录

kb 插件从组合配置解析 `kbRoot` 并将其发布为 `ctx.yantaoKb`，使宿主侧消费者共享同一个配置点而不是重复配置。控制器只在该发布之后才激活（`static inject = ['yantaoKb']`）。

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

## Wire 载荷

该命名空间承载的每个值都是纯 JSON。路径是带正斜杠的知识库相对路径，在控制器边界被限制在根目录之内；小节标签不进入载荷（Client 拥有自己的语言环境）。

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

## 失败词汇

该命名空间的 Remote 失败归类为 `RemoteError`，有两个领域代码：路径没有对应文件时为 `yantao-kb/not-found`；路径逃逸、目标不是文件或 I/O 拒绝时为 `yantao-kb/rejected`。两者的 `details` 都携带出问题的 `path`。

UI 是人类通道，所以 `write` 是不做 frontmatter 校验的整文件写入——ADR-0004 信任边界只约束 agent 的 `kb_` 工具，从不约束本表面。下方生成的 Cordis API 是方法级权威。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
