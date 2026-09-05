---
description: "The yantao PARA+P knowledge-base plugin: six kb_ tools that are the agent's only write path into a file-backed personal KB, for users and maintainers of the yantao profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-yantao-kb

English | [中文](README.zh.md)

## Summary

`dsh-yantao-kb` is the domain plugin of the yantao profile: six model-facing tools over a plain-file personal knowledge base (PARA+P). The KB is a directory of Markdown entity notes (`entities/projects|areas|people/*.md`), immutable original materials (`resources/`), and session archives (`sessions/`). Every entity file has a human-only `## 状态` (State) section and an append-only `## 流水` (Log) section; the tools enforce that boundary structurally — creation always writes the canonical template, and afterwards the only mutation is appending a dated bullet at the end of the Log section, leaving every other byte untouched. Mounted by the `yantao` profile bundle, which removes the generic write tools so this family is the agent's only write path.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The yantao profile mounts this plugin automatically; `kb_init` then prepares a fresh KB.

### A first session

```text
> 初始化知识库，然后创建一个名为「dsh 学习」的项目实体，并往它的流水里追加一条：今天完成了 yantao profile 接入。
```

The agent calls `kb_init` (layout + root README + the owner entity「我自己」), `kb_create_entity` (the project file from the canonical template), and `kb_append_log` (a `- YYYY-MM-DD …` bullet at the end of the `## 流水` section). The State section of the new file stays empty and byte-identical to the template no matter what the agent does afterwards.

### The six tools

| Tool | Signature | Effect |
|---|---|---|
| `kb_init` | `()` | Create the KB layout, root README, and owner entity (idempotent) |
| `kb_create_entity` | `(type, name, relation?)` | Write one entity file from the template; refuses an existing file |
| `kb_append_log` | `(entity, text)` | Append a dated bullet at the end of the entity's `## 流水` section |
| `kb_read_entity` | `(type, name)` | Return the entity file's complete content |
| `kb_list_entities` | `(type?, includeArchived?)` | List entity names; `archive: true` frontmatter hides unless asked |
| `kb_register_resource` | `(path)` | Copy an original into `resources/` and write its shadow-note skeleton |

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `kbRoot` | `~/yantao-kb` | Knowledge-base root directory, created by `kb_init` |

Override it in the profile's own `cordis.patch.yml` (the patch replaces the plugin's whole config):

```yaml
- id: yantao-kb
  config:
    kbRoot: D:/path/to/your-kb
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is stateless: it keeps only the resolved `kbRoot` and every operation re-reads the files it touches, so human edits between calls always win. Registration is effect-based through `ctx.tools.register(defineTool(...))`; disposing the plugin fiber unregisters the family.

### The trust boundary is a splicer, not an editor

`kb_append_log` never rewrites a file: it splits the text on `\n`, requires exactly one `## 流水` anchor heading (missing or duplicated anchors are hard errors, never recreated), and inserts the bullet lines directly after the section's last non-blank line. Rejoining the rows with the same separator preserves everything else byte-for-byte — the State section above all. Multi-line text becomes one bullet with two-space-indented continuation lines. The frontmatter envelope must parse (js-yaml) before any write, and entity names pass `sanitizeFileName` (`\/:*?"<>|` → `_`, trimmed, trailing dots/spaces stripped, `未命名` fallback) before they become file names; the path-form locator is confined to kbRoot.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: Config (`kbRoot`) and the six `defineTool` registrations |
| [`src/core.ts`](src/core.ts) | The six filesystem operations behind the tools |
| [`src/splice.ts`](src/splice.ts) | The Log-section splicer and bullet builder |
| [`src/frontmatter.ts`](src/frontmatter.ts) | Read-only frontmatter envelope parsing (js-yaml) |
| [`src/paths.ts`](src/paths.ts) | `sanitizeFileName`, date stamps, kbRoot-confined path resolution |
| [`src/templates.ts`](src/templates.ts) | The canonical entity / shadow-note / root-README file layouts |
| [`src/types.ts`](src/types.ts) | Entity taxonomy and `KbError` |
| — | No runtime invariant companion is published; the plugin is a stateless tool family whose mutation contract (template-once creation, byte-preserving Log appends) is covered by the package's unit tests. |
| [`tests/kb.spec.ts`](tests/kb.spec.ts) | Splicer, template, and operation coverage over real temp directories |

### Invariant ownership

No invariant companion is published because the plugin holds no mutable in-process relation: its entire write contract lives in the file formats and the splicer, which the unit tests exercise directly.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the surface that mounts this plugin or the tool contracts it builds on.

- [dsh-yantao](../../bundle/yantao/README.md) — the profile bundle that mounts this plugin and removes the generic write tools.
- [dsh-base](../../bundle/base/README.md) — the shared core under the yantao profile.
- [dsh-headless](../../bundle/headless/README.md) — the one-shot surface the profile reuses.
- [Tool authoring reference](../../../docs/cookbook/adding-a-tool.md) — the `defineTool` contract these tools follow.
- [dsh-tools](../../core/tools/README.md) — the registry and execution pipeline behind the family.

-----

<a id="model-experience"></a>
## Model Experience

### Tools and results

#### What the model sees

The six `kb_` schemas (`kb_init`, `kb_create_entity`, `kb_append_log`, `kb_read_entity`, `kb_list_entities`, `kb_register_resource`) with Chinese descriptions that name the trust boundary (`kb_append_log` states it only appends to the Log section and errors instead of recreating a missing anchor). Successful results are compact JSON carrying KB-relative paths; `kb_read_entity` returns the whole entity file. Failures arrive as Chinese `KbError` messages naming the exact problem (missing anchor, existing entity, malformed frontmatter, path escaping the KB root).

#### Token effect

Fixed schema cost for the six tools, plus one compact result per call; `kb_read_entity` results are data-dependent (the entity file's full text) and unbounded by this package.

#### KV Cache effect

Schemas are prefix-stable while their definitions and the mounted composition are unchanged. Calls and results append after the reusable request prefix without invalidating earlier entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where the KB tools need human care by design. They are current package constraints, not a task backlog.

- **The splicer is line-based, not structure-aware** — a hand-edited file with a missing or duplicated `## 流水` heading fails hard and is never repaired by the tools; fixing the file is human work.
- **No archive mutation tool** — archiving is a human frontmatter edit (`archive: true`); the tools only read the flag, so the agent cannot archive or unarchive an entity.
- **Resources are copied, never moved or deduplicated by content** — the original stays in place, and a second registration of the same basename is refused even when it names a different source file.
- **One KB root per mounted instance** — multiple KBs require separate profiles or a config patch swap; there is no per-call root override.
- **Entity references inside prose are not validated** — `areas: []` and free-text mentions in Log bullets are plain text; link checking and backreferences are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
