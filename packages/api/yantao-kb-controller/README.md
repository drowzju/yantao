---
description: "The yantaoKb Typert Remote controller: the workbench UI's direct KB channel (tree/read/write confined to kbRoot), for users and maintainers of the yantao-web surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-yantao-kb-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-yantao-kb-controller` is the Typert Remote controller behind the yantao workbench UI: fifteen unary methods over the `yantaoKb` namespace — `intakeTree`, `workspaceTree`, `read`, `write`, `deleteFile`, `root`, `setRoot`, `createEntity`, `links`, `revision`, `openExternal`, `todos`, `writeTodos`, `mailFetch`, and `mailMarkRead` — that let the browser list, edit, and extend the knowledge base directly. Every path is KB-relative and confined to the kbRoot the `yantao-kb` plugin publishes as the `yantaoKb` service, so the controller shares the plugin's one configuration point and never duplicates it; `setRoot` re-points that one root. The UI is the human channel, so `write` is a full-file write; the ADR-0004 trust boundary binds only the agent's `kb_` tools, never this surface.

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

The `yantao-web` profile mounts this controller automatically; the workbench UI consumes it through the [`dsh-api-remotes`](../remotes/README.md) assembly.

### The namespace

| Method | Signature | Result |
|---|---|---|
| `yantaoKb.intakeTree` | `()` | The intake sections (`resources`, `meetings`, `todos`); resource rows pair their shadow note, entity rows carry `archived`/`relation` flags |
| `yantaoKb.workspaceTree` | `()` | The workspace sections (`projects`, `areas`, `people`); same row shape as above |
| `yantaoKb.read` | `(path)` | `{ path, content }` — the file's complete UTF-8 content |
| `yantaoKb.write` | `(path, content)` | `{ path }` — full-file write, creating missing parent directories |
| `yantaoKb.deleteFile` | `(path)` | `{ path }` — removes one KB file; the path is confined like every other one, and an absent file is `not-found` |
| `yantaoKb.root` | `()` | `{ root, configured }` — the live KB root, and whether the human has chosen one |
| `yantaoKb.setRoot` | `(path)` | `{ root, configured, created, existing }` — initializes `path` as a KB, makes it the live root, and remembers it |
| `yantaoKb.createEntity` | `({ type, name, date?, relation? })` | `{ path }` — one entity note from the KB's canonical template |
| `yantaoKb.links` | `(path)` | `{ outgoing, incoming }` — the file's `[[wiki link]]` graph, resolved host-side and never into `resources/` (ADR-0015) |
| `yantaoKb.revision` | `()` | `{ root, revision }` — a counter that bumps whenever a file under the KB root changes; it follows `setRoot` (ADR-0017) |
| `yantaoKb.openExternal` | `(target)` | `{ ok }` — hands a KB path or a whitelisted URL scheme to the OS shell, refusing shell metacharacters (ADR-0017) |
| `yantaoKb.todos` | `()` | `{ path, text, items }` — the `entities/todos.md` singleton parsed into structured items, plus its exact text (ADR-0018) |
| `yantaoKb.writeTodos` | `({ items, expectedText })` | `{ path, text }` — replaces the singleton's items, keeping its preamble (ADR-0018) |
| `yantaoKb.mailFetch` | `({ since?, until?, limit? })` | `{ since, until?, lastReadAt?, stale, messages, hasMore }` — the newest mails in `[since, until)`, read through a Python/COM subprocess (ADR-0019) |
| `yantaoKb.mailMarkRead` | `({ lastReadAt? })` | `{ lastReadAt }` — moves that cursor forward; defaults to now (ADR-0019) |

`setRoot` takes an absolute path (a relative or empty one is refused) and hands it to the `yantaoKb` service, which persists the choice under `~/.dsh`. `createEntity` accepts `project`, `area`, `person`, and `meeting`; a meeting's file name is prefixed with its own date, and a person carries the `relation` it was given — `self` / `subordinate` / `superior` / `peer` / `external`, the KB domain's own five — defaulting to the domain's own choice when the caller names none.

`todos`/`writeTodos` (ADR-0018) are the structured way to edit the `entities/todos.md` singleton — the pair exists because the Client cannot import the kb package's parser (bundle purity). `todos` reports an absent file as `text: ''` and no items rather than an error, and `writeTodos` compares the file against `expectedText`: a mismatch is `yantao-kb/rejected`, so an edit made outside the workbench is refreshed, never clobbered. The file's preamble — a heading above the checklist — survives the write; only the items are replaced.

`mailFetch` / `mailMarkRead` (ADR-0019) are the first connector. `mailFetch` reads only the inbox, caps one page at 50 mails, and bounds itself below with the cursor in `~/.dsh/yantao-kb.json` — or with 30 days ago when the connector has never run, so a first read never walks a whole inbox over COM. `until` is the matching upper bound: without it every read lands on the newest page, so a workbench could never step 往前 into older mail. It answers `stale` when that cursor is missing or older than 30 days (the UI asks whether to re-read the older stretch; it neither skips nor fills it in silently) and `hasMore` when the page came back full — an exact count of what is left would mean touching every item in the folder. Both refuse before a KB root has been chosen, because the cursor is persisted next to it.

Failures are `RemoteError`s: `yantao-kb/not-found` when the path names no file, `yantao-kb/rejected` for an escape attempt, a non-file target, an I/O refusal, or a KB domain refusal (an existing entity, the `todo` singleton) — each carrying the offending `path` in `details` — and `yantao-kb/mail` when the connector fails, carrying the failure's `kind` and the `hint` that tells the human what to install or start.

### Client consumption

The calling plugin declares both `remote` and `remote.yantaoKb` in its `inject`, then writes `ctx.remote.yantaoKb.tree()` directly; the result is a `RemoteResult<T>` branched with `if (!result.ok)` in place. See the [Remote API cookbook](../../../docs/cookbook/adding-a-remote-api.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller is a `TypertRemoteService` with `static inject = ['yantaoKb']`: it activates only after the `yantao-kb` plugin has published the resolved KB root, and reads that root per call. Path confinement reuses the kb package's `resolveWithinKb` (escape attempts classify as `yantao-kb/rejected` at the boundary), and the entity sections of `tree` reuse `listEntities`, so the wire view and the agent's tools read the same files the same way. `resources/` and `sessions/` sections are fresh directory reads per call — the UI always sees what a human editor just wrote. `write` performs no frontmatter validation: the human owns the file's structure, and the agent's tools re-validate on their next read.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The controller: service declaration, path confinement, and the three methods |
| [`src/types.ts`](src/types.ts) | Wire payload vocabulary (tree sections, file rows, read/write results) |
| — | No runtime invariant companion is published; the controller is a stateless adapter whose confinement and shaping contracts are covered by the package's unit tests. |
| [`tests/controller.spec.ts`](tests/controller.spec.ts) | Tree shaping, read/write round trips, root/setRoot/createEntity, not-found classification, and escape rejection over real temp directories |

### Invariant ownership

No invariant companion is published because the controller holds no mutable in-process relation: it re-reads the filesystem per call, and its confinement and tree-shaping contracts are exercised directly by the unit tests.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the plugin that owns the KB or the surface that mounts this controller.

- [dsh-yantao-kb](../../yantao/kb/README.md) — the KB domain plugin whose root and operations this controller shares.
- [dsh-yantao-web-app](../../bundle/yantao-web-app/README.md) — the bundle that mounts this controller.
- [dsh-client-ui-yantao-kb](../../client/ui-yantao-kb/README.md) — the workbench UI consuming this namespace.
- [Remote API cookbook](../../../docs/cookbook/adding-a-remote-api.md) — the five-step contract this package follows.
- [dsh-api-remotes](../remotes/README.md) — the Client assembly mounting this contribution.

-----

<a id="model-experience"></a>
## Model Experience

None, as the controller is a UI-facing API and transport owner that registers no prompt, tool, or session event; the kb_ tools and the chat agent own every model-visible effect.

#### KV Cache effect

The controller adds nothing to any request prefix; it never participates in a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what the controller deliberately does not do. They are current package constraints, not a task backlog.

- **Change detection is a poll, not a push** — `revision()` publishes a counter the UI polls (ADR-0017); the rails themselves still refresh on gesture and after their own writes, so a human's external edit surfaces on the next poll, not live.
- **No frontmatter validation on write** — the human channel owns file structure; a malformed entity file is reported by the agent's tools on their next read, not by this surface.
- **Whole-file writes only** — there is no section-scoped edit; the human edits the complete text (the agent's append-only channel is the kb_ tools', not this one's).
- **Binary resources are served as UTF-8 text** — `read` of a non-text original returns replacement-character content; the editor marks originals read-only rather than decoding them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
