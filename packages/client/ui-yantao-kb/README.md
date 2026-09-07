---
description: "The yantao workbench client plugin: the five-section KB tree in the sidebar and the markdown source/preview editor in the details column, for users and maintainers of the yantao-web surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao-kb

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-yantao-kb` is the yantao workbench's browser plugin. It occupies the layout `sidebar` slot with a five-section KB tree — 资源/项目/领域/人物/会话 over `resources/`, `entities/{projects,areas,people}/`, and `sessions/` — and shadows the `details` slot with a markdown editor: source textarea, `MarkdownText` preview, dirty flag, and save. The tree and editor share one selection and one tree payload through a plugin-provided cordis service, and every file operation rides the `yantaoKb` Remote. The editor is the human's channel into the KB: `resources/` originals render read-only (the KB's own contract), everything else is a full-file save.

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

The `yantao-web` profile's roster mounts this plugin automatically; the workbench layout needs no configuration.

### The workbench layout

| Column | Occupant | Content |
|---|---|---|
| Left (`sidebar`) | This plugin's KB tree | Five sections, live chat sessions plus 新建会话 in 会话, brand and settings seats re-declared for the stock occupants |
| Center (`conversation`) | Stock ui-conversation + ui-chat | The chat, untouched |
| Right (`details`) | This plugin's KB editor | Source / preview toggle, dirty flag, save |

Selecting a file in the tree opens it in the editor immediately — the two share the plugin's `yantaoKbWorkbench` service, which also keeps the tree fresh after every save.

### What the human can do here

- Browse the KB as five sections; archived entities carry an 已归档 badge, resources with a shadow note carry 笔记.
- Open any file in the editor, edit the complete text, and save — the save is a whole-file write through `yantaoKb.write`, confined to the KB root on the host.
- Open or start chat sessions from the 会话 section; the agent works the same KB through its `kb_` tools while the human edits State sections directly.
- Read but never edit `resources/` originals; their `.md` shadow notes are the editable surface.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers three contributions in its `apply`: the locale dictionaries (namespace `yantao-kb`), the `yantaoKbWorkbench` cordis service, and the two slot occupants. The service exists because the sidebar (root scope) and the editor (session scope) may not share a store handle; a cordis service crosses scopes, so both consume one observable source (`selection`, `tree`, `treeError`) and one set of RPC actions through their own inject faces. Slot choices and their reasons:

- `sidebar` is occupied at the default priority because the yantao-web roster disables ui-sidebar; the brand and settings holes it would declare are free, so this plugin re-declares `sidebar.brand.mark`, `sidebar.brand.name`, and `sidebar.settings`, and the stock brand-official and ui-settings occupants mount unchanged.
- `details` is occupied at priority `-10`, shadowing ui-chat's `DetailsPanel` — on the workbench the details column IS the KB editor (distinct priorities coexist; the lowest renders).
- A custom `conversation` root was deliberately NOT built: the slot system allows one declarer per slot, and ui-conversation's root already declares the view/composer subtree, so a shadowing root would strand the chat input path. The stock chat column stays untouched.

The editor keeps its content state component-local (load on selection change with a stale-resolve ticket, saved/draft pair, save flips to a fresh baseline). `resources/` originals are read-only per the KB contract; every other path is editable.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: inject declaration, service provision, slot registrations |
| [`src/client/service.ts`](src/client/service.ts) | `KbWorkbench`: selection, tree payload, and RPC actions behind one observable source |
| [`src/client/KbSidebar.tsx`](src/client/KbSidebar.tsx) | Sidebar shell: brand row, tree scroll region, settings foot |
| [`src/client/KbTree.tsx`](src/client/KbTree.tsx) | The five-section tree presentation |
| [`src/client/KbEditor.tsx`](src/client/KbEditor.tsx) | The editor panel: load/save flow, source/preview toggle, dirty flag |
| [`src/client/editor-state.ts`](src/client/editor-state.ts) | Pure saved/draft transitions and the read-only path rule |
| [`src/client/locales.ts`](src/client/locales.ts) | zh/en dictionaries (namespace `yantao-kb`) |
| [`src/client/contract/slots.ts`](src/client/contract/slots.ts) | Props compositions for the two occupants |
| [`src/index.ts`](src/index.ts) | Node half: an empty apply for the host-side row |
| — | No runtime invariant companion is published; the plugin's state transitions (editor saved/draft, read-only rule) are covered by the package's unit tests, and its slot composition is load-time validated by the slot registry. |
| [`tests/`](tests/) | editor-state transitions, read-only rule, and KbEditor load/dirty/save behavior (jsdom) |

### Invariant ownership

No invariant companion is published because the plugin's mutable state is either component-local (editor) or held in one service whose publication discipline (single step, both identities stable) is exercised by the unit tests.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the channel this plugin rides or the surface that mounts it.

- [dsh-api-yantao-kb-controller](../../api/yantao-kb-controller/README.md) — the `yantaoKb` Remote behind every file operation.
- [dsh-yantao-web-app](../../bundle/yantao-web-app/README.md) — the bundle whose roster mounts this plugin.
- [dsh-yantao-kb](../../yantao/kb/README.md) — the KB domain and the agent's side of the boundary.
- [Slots reference](../../../docs/subsystems/slots.md) — the declaration, shadowing, and props-share rules this plugin follows.
- [dsh-client-ui-primitives](../ui-primitives/README.md) — `MarkdownText` and the icon set.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin is browser-side KB tree and editor presentation and registers nothing model-facing; the chat column's own packages own the model-facing surface.

#### KV Cache effect

The plugin adds nothing to any request prefix; it never participates in a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what the workbench UI deliberately does not do yet. They are current package constraints, not a task backlog.

- **No live refresh** — the tree reloads on the refresh gesture and after this surface's own saves; a human's external edit appears on the next refresh, not live (file watching is a deferred decision).
- **Whole-file editing only** — the editor offers no section-scoped editing aids; the human edits the complete markdown text.
- **No chat turn details** — the editor shadows `DetailsPanel` on this surface, so the per-turn details view is unreachable here (it remains on the stock web surface).
- **Collapsed sidebar is a plain rail** — brand mark and toggle only; the stock sidebar's slide/crossfade choreography was not replicated.
- **Binary originals are shown as text** — a non-text resource renders replacement characters rather than a decoded viewer; the read-only banner is the guard.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
