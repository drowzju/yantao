---
description: "The yantao PARA+P knowledge-base plugin: eight kb_ tools that are the agent's only write path into a file-backed personal KB, for users and maintainers of the yantao profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-yantao-kb

English | [中文](README.zh.md)

## Summary

`dsh-yantao-kb` is the domain plugin of the yantao profile: eight model-facing tools over a plain-file personal knowledge base (PARA+P). The KB is a directory of Markdown entity notes (`entities/projects|areas|people|meetings/*.md`, plus the singleton checklist `entities/todos.md`), immutable original materials (`resources/`), and session archives (`sessions/`). Every entity file carries a `## 状态` (State) section the agent may rewrite in full and an append-only `## 流水` (Log) section; the tools enforce that boundary structurally — creation always writes the canonical template, and afterwards the only mutations are rewriting State and appending a dated bullet at the end of Log, leaving every other byte untouched. Mounted by the `yantao` profile bundle, which removes the generic write tools so this family is the agent's only write path.

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

The agent calls `kb_init` (layout + root README + the owner entity「我自己」+ the todo singleton), `kb_create_entity` (the project file from the canonical template), and `kb_append_log` (a `- YYYY-MM-DD …` bullet at the end of the `## 流水` section). The State section of the new file stays byte-identical to the template unless the agent calls `kb_write_state`.

### The eight tools

| Tool | Signature | Effect |
|---|---|---|
| `kb_init` | `()` | Create the KB layout, root README, owner entity, and todo singleton (idempotent) |
| `kb_create_entity` | `(type, name, relation?, date?)` | Write one entity file from the template (a meeting's file name is prefixed with its own date, `<YYYY-MM-DD> <name>`); refuses an existing file and the `todo` singleton |
| `kb_append_log` | `(entity, text)` | Append a dated bullet at the end of the entity's `## 流水` section |
| `kb_write_state` | `(entity, text)` | Replace the whole `## 状态` section body; Log and frontmatter are preserved |
| `kb_read_entity` | `(type, name)` | Return the entity file's complete content; a meeting is found by its bare name, dated file name and all |
| `kb_list_entities` | `(type?, includeArchived?)` | List entity names; `archive: true` frontmatter hides unless asked |
| `kb_register_resource` | `(path)` | Copy an original into `resources/` unchanged, sanitizing its name; refuses a duplicate (ADR-0020) |
| `kb_read_resource` | `(path, offset?, length?)` | Return one paginated chunk of the resource's extracted text (`chunk`, `hasMore`), reading from the `.yantao/extracts/` cache the workbench fills; a resource without an extract is an error (ADR-0020) |

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

The workbench can override this at runtime: a root it chooses is persisted as
`{ "root": … }` in `~/.dsh/yantao-kb.json` and wins over `kbRoot` from then on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin is stateless: it keeps only the resolved `kbRoot` and every operation re-reads the files it touches, so human edits between calls always win. Registration is effect-based through `ctx.tools.register(defineTool(...))`; disposing the plugin fiber unregisters the family.

### The trust boundary is a splicer, not an editor

`kb_append_log` never rewrites a file: it splits the text on `\n`, requires exactly one `## 流水` anchor heading (missing or duplicated anchors are hard errors, never recreated), and inserts the bullet lines directly after the section's last non-blank line. Rejoining the rows with the same separator preserves everything else byte-for-byte — the State section above all. `kb_write_state` mirrors that splicer on the `## 状态` anchor: it swaps the rows between the heading and the next section, so Log and frontmatter survive unchanged and an empty `text` restores the template's empty State section. Multi-line text becomes one bullet with two-space-indented continuation lines. The frontmatter envelope must parse (js-yaml) before any write, and entity names pass `sanitizeFileName` (`\/:*?"<>|` → `_`, trimmed, trailing dots/spaces stripped, `未命名` fallback) before they become file names; the path-form locator is confined to kbRoot.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: Config (`kbRoot`) and the eight `defineTool` registrations |
| [`src/core.ts`](src/core.ts) | The eight filesystem operations behind the tools |
| [`src/splice.ts`](src/splice.ts) | The State/Log section splicer and bullet builder |
| [`src/frontmatter.ts`](src/frontmatter.ts) | Read-only frontmatter envelope parsing (js-yaml) |
| [`src/paths.ts`](src/paths.ts) | `sanitizeFileName`, date stamps, kbRoot-confined path resolution, and the dated-meeting locator |
| [`src/root-store.ts`](src/root-store.ts) | The persisted KB root override (`~/.dsh/yantao-kb.json`) |
| [`src/templates.ts`](src/templates.ts) | The canonical entity / root-README file layouts |
| [`src/types.ts`](src/types.ts) | Entity taxonomy and `KbError` |
| — | No runtime invariant companion is published; the plugin is a stateless tool family whose mutation contract (template-once creation, byte-preserving State rewrites and Log appends) is covered by the package's unit tests. |
| [`tests/kb.spec.ts`](tests/kb.spec.ts) | Splicer, template, and operation coverage over real temp directories |
| [`tests/root-store.spec.ts`](tests/root-store.spec.ts) | The persisted root override, over a throwaway dsh home |

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

The eight `kb_` schemas (`kb_init`, `kb_create_entity`, `kb_append_log`, `kb_write_state`, `kb_read_entity`, `kb_list_entities`, `kb_register_resource`, `kb_read_resource`) with Chinese descriptions that name the trust boundary (`kb_append_log` states it only appends to the Log section and errors instead of recreating a missing anchor; `kb_write_state` states it replaces State and never touches Log). Successful results are compact JSON carrying KB-relative paths; `kb_read_entity` returns the whole entity file, and `kb_read_resource` returns one bounded chunk of an extracted text. Failures arrive as Chinese `KbError` messages naming the exact problem (missing anchor, existing entity, malformed frontmatter, path escaping the KB root).

#### Token effect

Fixed schema cost for the eight tools, plus one compact result per call; `kb_read_entity` and `kb_read_resource` results are data-dependent (an entity file's full text, one bounded text chunk) and unbounded by this package.

#### KV Cache effect

Schemas are prefix-stable while their definitions and the mounted composition are unchanged. Calls and results append after the reusable request prefix without invalidating earlier entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where the KB tools need human care by design. They are current package constraints, not a task backlog.

- **The splicer is line-based, not structure-aware** — a hand-edited file with a missing or duplicated `## 状态` / `## 流水` heading fails hard and is never repaired by the tools; fixing the file is human work.
- **The todo singleton has no sections** — `entities/todos.md` is a plain checkbox list, so `kb_append_log` and `kb_write_state` refuse it; the agent reads it with `kb_read_entity` and the human edits it as a whole file.
- **No archive mutation tool** — archiving is a human frontmatter edit (`archive: true`); the tools only read the flag, so the agent cannot archive or unarchive an entity.
- **Resources are copied, never moved or deduplicated by content** — the original stays in place, and a second registration of the same basename is refused even when it names a different source file.
- **One KB root per mounted instance** — the root can be re-chosen at runtime (persisted under `~/.dsh`) and every tool then follows it, but there is no per-call root override; several KBs at once still need separate profiles.
- **Entity references inside prose are not validated** — `areas: []` and free-text mentions in Log bullets are plain text; link checking and backreferences are deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
