---
description: "The yantaoKb Typert Remote controller: the workbench UI's direct KB channel (tree/read/write confined to kbRoot), for users and maintainers of the yantao-web surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-yantao-kb-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-yantao-kb-controller` is the Typert Remote controller behind the yantao workbench UI: three unary methods over the `yantaoKb` namespace — `tree`, `read`, and `write` — that let the browser list and edit the knowledge base directly. Every path is KB-relative and confined to the kbRoot the `yantao-kb` plugin publishes as the `yantaoKb` service, so the controller shares the plugin's one configuration point and never duplicates it. The UI is the human channel, so `write` is a full-file write; the ADR-0004 trust boundary binds only the agent's `kb_` tools, never this surface.

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
| `yantaoKb.tree` | `()` | The five-section tree (`resources`, `projects`, `areas`, `people`, `sessions`); resource rows pair their shadow note, entity rows carry `archived`/`relation` flags |
| `yantaoKb.read` | `(path)` | `{ path, content }` — the file's complete UTF-8 content |
| `yantaoKb.write` | `(path, content)` | `{ path }` — full-file write, creating missing parent directories |

Failures are `RemoteError`s: `yantao-kb/not-found` when the path names no file, `yantao-kb/rejected` for an escape attempt, a non-file target, or an I/O refusal — each carrying the offending `path` in `details`.

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
| [`tests/controller.spec.ts`](tests/controller.spec.ts) | Tree shaping, read/write round trips, not-found classification, and escape rejection over real temp directories |

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

- **No change notification** — `tree` is a pull read; the UI refreshes on gesture and after its own writes, so a human's external edit surfaces on the next refresh, not live.
- **No frontmatter validation on write** — the human channel owns file structure; a malformed entity file is reported by the agent's tools on their next read, not by this surface.
- **Whole-file writes only** — there is no section-scoped edit; the human edits the complete text (the agent's append-only channel is the kb_ tools', not this one's).
- **Binary resources are served as UTF-8 text** — `read` of a non-text original returns replacement-character content; the editor marks originals read-only rather than decoding them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
