---
description: "The yantaoKb Typert Remote controller: the workbench UI's direct KB channel (tree/read/write confined to kbRoot), for users and maintainers of the yantao-web surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-yantao-kb-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-yantao-kb-controller` is the Typert Remote controller behind the yantao workbench UI: nineteen unary methods over the `yantaoKb` namespace — `intakeTree`, `workspaceTree`, `read`, `write`, `deleteFile`, `setRelation`, `root`, `setRoot`, `createEntity`, `links`, `revision`, `openExternal`, `todos`, `writeTodos`, `mailMarkRead`, `registerResource`, `capabilityList`, `capabilityRun`, and `capabilityCreate` — that let the browser list, edit, and extend the knowledge base directly. Every path is KB-relative and confined to the kbRoot the `yantao-kb` plugin publishes as the `yantaoKb` service, so the controller shares the plugin's one configuration point and never duplicates it; `setRoot` re-points that one root. The UI is the human channel, so `write` is a full-file write; the ADR-0004 trust boundary binds only the agent's `kb_` tools, never this surface.

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
| `yantaoKb.intakeTree` | `()` | The intake sections (`resources`, `meetings`, `todos`); resources are listed as plain files — originals keep their file name's suffix, so `周报.eml` and `周报.eml.md` never read as the same thing |
| `yantaoKb.workspaceTree` | `()` | The workspace sections (`projects`, `areas`, `people`); entity rows add `archived`, and on people `relation` and `email` |
| `yantaoKb.read` | `(path)` | `{ path, content }` — the file's complete UTF-8 content |
| `yantaoKb.write` | `(path, content)` | `{ path }` — full-file write, creating missing parent directories |
| `yantaoKb.deleteFile` | `(path)` | `{ path }` — removes one KB file; the path is confined like every other one, and an absent file is `not-found` |
| `yantaoKb.setRelation` | `({ path, relation })` | `{ path, relation }` — rewrites one person entity's `relation` inside its frontmatter, leaving the rest of the document byte-identical |
| `yantaoKb.root` | `()` | `{ root, configured }` — the live KB root, and whether the human has chosen one |
| `yantaoKb.setRoot` | `(path)` | `{ root, configured, created, existing }` — initializes `path` as a KB, makes it the live root, and remembers it |
| `yantaoKb.createEntity` | `({ type, name, date?, relation?, email?, source? })` | `{ path }` — one entity note from the KB's canonical template; `source` only means anything for a reading project (ADR-0020) |
| `yantaoKb.links` | `(path)` | `{ outgoing, incoming }` — the file's `[[wiki link]]` graph, resolved host-side and never into `resources/` (ADR-0015) |
| `yantaoKb.revision` | `()` | `{ root, revision }` — a counter that bumps whenever a file under the KB root changes; it follows `setRoot` (ADR-0017) |
| `yantaoKb.openExternal` | `(target)` | `{ target }` — hands a KB path or a whitelisted URL scheme to the OS shell, refusing shell metacharacters (ADR-0017) |
| `yantaoKb.todos` | `()` | `{ path, text, items }` — the `entities/todos.md` singleton parsed into structured items, plus its exact text (ADR-0018) |
| `yantaoKb.writeTodos` | `({ items, expectedText })` | `{ path, text }` — replaces the singleton's items, keeping its preamble (ADR-0018) |
| `yantaoKb.mailMarkRead` | `({ lastReadAt?, firstReadAt? })` | `{ lastReadAt, firstReadAt? }` — moves the mail capability's cursor forward and keeps the earliest `firstReadAt` as the processed range's start; `lastReadAt` defaults to now (ADR-0019) |
| `yantaoKb.registerResource` | `({ name, contentBase64 })` | `{ resource }` — copies one dropped file into `resources/` byte-for-byte, sanitizing the name and refusing a duplicate; no note is generated beside it (ADR-0020) |
| `yantaoKb.capabilityRun` | `({ name, input? })` | `{ name, runAt, result?, content?, artifacts }` — runs one capability's host entry (a dsh skill directory declaring itself through a `yantao.json` sidecar, legacy `metadata.yantao` frontmatter accepted) as a Python subprocess, writes its artifacts under `.yantao/capabilities/<name>/`, and persists its state under `capabilities.<name>.state` in `<kbRoot>/.yantao/state.json` (ADR-0024); an instruction capability (no `entry`) answers with its SKILL.md body as `content` instead of spawning (ADR-0021, ADR-0023) |
| `yantaoKb.capabilityList` | `()` | `{ capabilities, unregistered }` — every skill at the KB root that declares a capability manifest, each row merged with its persisted record (`lastRunAt`, `state`), plus the `unregistered` group: skill directories without a sidecar, adoptable into the KB (ADR-0025 决定 1); the shipped capabilities are seeded into `<kbRoot>/.dsh/skills/` first (ADR-0021) |
| `yantaoKb.capabilityCreate` | `({ name })` | `{ path }` — scaffolds `.dsh/skills/<name>/` with a clean SKILL.md, a declaring `yantao.json` sidecar, and a protocol-speaking `scripts/entry.py`; a working capability on the first run (ADR-0021 决定 8) |
| `yantaoKb.capabilityAdopt` | `({ name })` | `{ path }` — copies one out-of-KB skill directory into `.dsh/skills/<name>/` and writes a default human-invocable instruction sidecar; refuses an existing target, a `user-invocable: false` skill, and anything that is not a flat directory bundle with a SKILL.md (ADR-0025 决定 1; a source sidecar declaring an `entry` or the agent is surfaced by the panel's confirm dialog, not blocked here) |

`setRelation` only answers for a person file: anything else is `yantao-kb/rejected` without being rewritten, and so is a relation outside the domain's five. It is a line splice inside the frontmatter, never a YAML round trip — a re-emitted mapping would drop the comments and ordering the human wrote.

`setRoot` takes an absolute path (a relative or empty one is refused) and hands it to the `yantaoKb` service, which persists the choice in the settings plane — the `yantao-kb` namespace of `~/.dsh/settings.yaml` (ADR-0024 决定 3). `createEntity` accepts `project`, `area`, `person`, and `meeting`; a meeting's file name is prefixed with its own date, and a person carries the `relation` it was given — `self` / `subordinate` / `superior` / `peer` / `external`, the KB domain's own five — defaulting to the domain's own choice when the caller names none, plus an optional `email` the workspace tree reads back so the mail analysis can match a sender to a person.

`todos`/`writeTodos` (ADR-0018) are the structured way to edit the `entities/todos.md` singleton — the pair exists because the Client cannot import the kb package's parser (bundle purity). `todos` reports an absent file as `text: ''` and no items rather than an error, and `writeTodos` compares the file against `expectedText`: a mismatch is `yantao-kb/rejected`, so an edit made outside the workbench is refreshed, never clobbered. The file's preamble — a heading above the checklist — survives the write; only the items are replaced.

`mailMarkRead` (ADR-0019) is what remains of the first connector's RPC surface: the cursor write. Reading mails moved into the `mail` capability (ADR-0021) — its result carries the same bounds, `stale`, and `hasMore` bookkeeping `mailFetch` used to answer — but advancing the cursor is an approval-time act, so it stays a plain RPC over `writeMailWatermark`. The batch's oldest mail rides along as `firstReadAt` and is kept as the minimum ever seen, so the panel can show the processed range (e.g. 2025-12-31 到 2026-01-31) straight from the capability's persisted state. It refuses before a KB root has been chosen, because the cursor is persisted next to it.

`registerResource` (ADR-0020) is the drag-and-drop intake: the browser sends the file's complete content base64-encoded, and the host copies it into `resources/` unchanged — the same sanitize-and-refuse-duplicate semantics the agent's `kb_register_resource` has, minus the absolute-path input. (The `ebook` extraction capability that ADR-0021 seeded here was retired on 2026-09-14 together with the reading-project flow — ADR-0020's landing note — and a leftover seeded copy is backed up to `.yantao/capability-backups/` and removed at seed time.)

`capabilityRun` (ADR-0021) is the mail/extract subprocess pattern generalized into the capability system: a capability is a dsh skill directory whose declaration lives in a `yantao.json` sidecar at the directory root (`entry`/`runtime`/`appliesTo`/`invocation` — out-of-band, so an unmodified open-source skill directory can be dropped in; the legacy `metadata.yantao` frontmatter section still answers when no sidecar is present), discovery is `ctx.skills`' business, and this controller owns only the execution seam — one Python subprocess with a JSON stdin/stdout contract, artifacts written by the controller (never by the script, which cannot choose its own write paths), and the returned state persisted as the next run's starting point. Since ADR-0023 the same seam serves both channels: the human calls it here, the agent through the `kb_run_capability` tool — but only for capabilities whose sidecar declared `"invocation": ["agent"]` (the default is human-only), and a capability without an `entry` is an instruction capability whose SKILL.md body is the whole answer. `tool-skill` stays disabled so the model never sees a raw skill catalog; the agent learns what it may run from the per-turn injected catalog instead.

`capabilityList` / `capabilityCreate` (ADR-0021 决定 8) are the 能力 tab's management half. `capabilityList` seeds the shipped capabilities into the KB first (copy-on-missing, version-driven, so script fixes reach the KB), then lists every skill that declares a capability manifest — plain skills are skipped, not errors — merged with each one's persisted record. Installing a capability has no RPC: the human copies the directory into `<kbRoot>/.dsh/skills/` (or any other skill root) and discovery picks it up. `capabilityCreate` scaffolds a new capability inside the KB with a working protocol-speaking entry script.

Failures are `RemoteError`s: `yantao-kb/not-found` when the path names no file, `yantao-kb/rejected` for an escape attempt, a non-file target, an I/O refusal, or a KB domain refusal (an existing entity, the `todo` singleton) — each carrying the offending `path` in `details` — and `yantao-kb/mail` when the watermark write fails for want of a root, carrying the failure's `kind` and `hint`. `yantao-kb/capability` is the capability counterpart (`not-found` / `not-invocable` / `bad-manifest` / `python-missing` / `timeout` / `bad-output` / `capability-failed`), and the capability's own failure `kind` and remedy ride in `details` too; `not-invocable` (ADR-0023) is the agent calling a capability whose sidecar did not declare `"agent"`.

### Client consumption

The calling plugin declares both `remote` and `remote.yantaoKb` in its `inject`, then writes `ctx.remote.yantaoKb.intakeTree()` / `ctx.remote.yantaoKb.workspaceTree()` directly; the result is a `RemoteResult<T>` branched with `if (!result.ok)` in place. See the [Remote API cookbook](../../../docs/cookbook/adding-a-remote-api.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller is a `TypertRemoteService` with `static inject = ['yantaoKb', 'skills', 'tools']`: it activates only after the `yantao-kb` plugin has published the resolved KB root (and the skill registry is mounted, so `capabilityRun` can resolve capability directories), reads that root per call, and registers the `kb_run_capability` tool plus the pre-step catalog listener through the injected tool layer (ADR-0023). Path confinement reuses the kb package's `resolveWithinKb` (escape attempts classify as `yantao-kb/rejected` at the boundary), and the entity sections of the two trees reuse `listEntities`, so the wire view and the agent's tools read the same files the same way. `resources/` and `sessions/` sections are fresh directory reads per call — the UI always sees what a human editor just wrote. `write` performs no frontmatter validation: the human owns the file's structure, and the agent's tools re-validate on their next read.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The controller: service declaration, path confinement, and the RPC methods |
| [`src/capability/builtin.ts`](src/capability/builtin.ts) | The shipped capability directories' seeder (ADR-0021): copy-on-missing, version-driven, into `<kbRoot>/.dsh/skills/`; a drifted copy is backed up before a version bump overwrites it (ADR-0023 决定 7) |
| [`src/capability/builtin/`](src/capability/builtin/) | The `mail` capability master: SKILL.md + `yantao.json` declaration + `scripts/` (the Python subprocess the old `mail/` module shelled out to) |
| [`src/capability/run.ts`](src/capability/run.ts) | The capability runner (ADR-0021): `yantao.json` sidecar manifest validation (legacy frontmatter fallback), entry confinement inside the skill directory, the spawn wrapper with `CapabilityError{kind,message,hint}`, artifact-name validation |
| [`src/types.ts`](src/types.ts) | Wire payload vocabulary (tree sections, file rows, read/write results) |
| — | No runtime invariant companion is published; the controller is a stateless adapter whose confinement and shaping contracts are covered by the package's unit tests. |
| [`tests/controller.spec.ts`](tests/controller.spec.ts) | Tree shaping, read/write round trips, root/setRoot/createEntity, not-found classification, and escape rejection over real temp directories |
| [`tests/intake-rpc.spec.ts`](tests/intake-rpc.spec.ts) | The intake RPCs over real temp directories: base64 round trips, duplicate refusal |
| [`tests/capability-rpc.spec.ts`](tests/capability-rpc.spec.ts) | The capability RPCs over a fake registry and a mocked runner: no-root/not-found/bad-manifest refusals, entry confinement, artifact write-out, state round trip, list/merge, dir registration, scaffolding, instruction capabilities and the sidecar `invocation` declaration |
| [`tests/capability-tool.spec.ts`](tests/capability-tool.spec.ts) | The `kb_run_capability` tool and the pre-step catalog (ADR-0023): registration, the agent gate, the instruction answer, and the catalog injection over a fake registry |
| [`tests/capability-builtin.spec.ts`](tests/capability-builtin.spec.ts) | The seeder over real temp directories: fresh seeding, up-to-date no-op, version-driven overwrite, newer-human-copy preservation, drift backup, and lossless retirement of a capability that no longer ships |

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

### Tools and prompt-side effects

#### What the model sees

The `kb_run_capability` tool: the model names a capability from the per-turn catalog and may pass a free-form JSON `input`; a script capability answers with `{ name, runAt, result?, artifacts }`, an instruction capability with its SKILL.md body as `content` for the model to follow. A capability whose sidecar did not declare `"invocation": ["agent"]` fails `not-invocable` with a Chinese remedy hint. On every user-prompted step, an `agent/pre-step` listener appends one catalog message listing the agent-open capabilities, re-derived from the skill registry that turn.

#### Token effect

Fixed schema cost for the one tool, plus one compact result per call; an instruction capability's answer is its SKILL.md body, bounded only by that document. The catalog message adds one short row per agent-invocable capability on each user-prompted turn.

#### KV Cache effect

The catalog message rides at the end of the user-prompted step's messages, so it enters that turn's request suffix and stays in the prefix of later requests in the same turn chain; its text changes whenever the agent-invocable set changes, invalidating the cached prefix from that point. With no agent-invocable capability nothing is injected and the prefix is untouched.

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
