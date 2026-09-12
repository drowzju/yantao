---
description: "yantao workbench client plugin: the whole browser shell — its own three-column frame in the runtime's root slot, the host conversation surface in the middle, and the two KB rails over ctx.remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao

English | [中文](README.zh.md)

## Overview

The yantao workbench's own client plugin. dsh is used as a **backend**: this plugin talks to `ctx.remote.yantaoKb` (and, later, the session namespace) and **owns the browser shell** — it registers the runtime's built-in `root` slot with a bespoke three-column frame (ADR-0011). The middle column is still the host's agent surface, rendered through the `conversation` seat; the two rails are plain children of our frame, so both are real grid columns that drag and collapse alike.

## Use this package

Mounted by the `yantao-web-app` bundle's `dsh.client` roster, alongside `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-api-yantao-kb-controller`, `@deepseek-ai/dsh-client-ui-layout` and `@deepseek-ai/dsh-client-ui-renderer`. It activates once `slots`, `theme`, and `remote` are available. `ui-layout` is **not** in that roster: this plugin replaces its frame and takes over the two cross-cutting things it owned — the `ctx.layout` service and the theme presenter.

## Surface

- `apply(ctx)` — provides `ctx.layout` and the theme presenter, registers the `root` frame, and drives the rails from `ctx.remote`.
- `Frame` — the `root` occupant: intake | conversation | workspace as one grid, with a drag handle per rail, a narrow breakpoint that collapses both, and a click-through `shell.overlay` layer. It declares exactly two child seats: `conversation` (the host's agent surface) and `shell.overlay` (ui-commands' popupSelect).
- `IntakeRail` / `WorkspaceRail` — 资源 / 待办 / 会议 / 能力 and 领域 / 人物 / 项目, fed by `intakeTree()` / `workspaceTree()`. Both take the same `collapsed` prop and render the same compact icon column, so the two sides stay symmetric. A row opens its file in the centre pane (资源 originals read-only); 会议 and each workspace tab create their own entity kind inline, and 待办 edits the singleton checklist line by line.
- `CenterPane` — the middle column's tabs: one permanent 对话 tab over the `conversation` seat plus one closeable tab per open file, with a save-status dot (保存中 / 已保存 / 失败). An inactive tab is hidden, never unmounted, so the host's composer draft and each file's draft survive a switch.
- `FileEditor` / `ReadOnlyFile` — a raw-markdown textarea with 2s debounced autosave (and a save on blur), and the read-only view for 资源 originals. A save first re-reads the server copy: if it moved since the file was loaded, the draft is held back behind a 覆盖 / 放弃我的修改 / 查看差异 bar instead of clobbering it.
- `Onboarding` — the first-run directory choice over `root()` / `setRoot()` and `ctx.uiWorkspace.pickDirectory()`. The UI asks once and never again: a later root change is a `setRoot` call from outside the workbench.
- `WorkbenchLayout` — the `ctx.layout` face: upstream's `sidebar` / `details` names map onto the intake and workspace rails.

## Understand the implementation

The plugin is deliberately thin: `remote.ts` reaches the `yantaoKb` namespace defensively (a missing namespace is a reported state, not a crash), `Workbench.tsx` is pure presentation over plain data, and each rail owns only its own load state and selection. `tabs.ts` (open/close/activate/dedupe plus the localStorage round-trip) and `TodoBoard.tsx` (the TODO/DONE board, ADR-0018) are pure modules, so their rules are pinned by unit tests rather than by a rendered tree. `frame/columns.ts` is a pure width solver (both rails concede, the wider one first); `frame/Frame.tsx` measures itself with a ResizeObserver and never reads the window. The `root` registration is a bare `register`, not `slots.inject`: `root` is the runtime's own built-in slot, seeded when the registry is constructed. ADR-0010 steps the shared shell aside one row at a time — the layout row was the one that stepped aside here. The 能力 tab is ADR-0021's capability surface: `CapabilityPanel.tsx` lists the registered capabilities (「添加目录」 registers a skill directory, 「新建能力」 scaffolds one under `.dsh/skills/`), and the mail capability's detail embeds `MailPanel.tsx` — ADR-0019's connector, whose reads now travel through `capabilityRun('mail', …)`. `mail-analysis.ts` drives a real dsh session, `mail-apply.ts` lands the writes, and `MailReview.tsx` is the one window where a verdict becomes KB content — nothing is written until a row is ticked.

**Runtime invariant:** No companion is published. The plugin holds no process-global state and no event stream of its own; its only relations are the Remote results it renders, and the two rails' shape plus the load/select/refresh behavior are asserted by the package's client spec.

## Model Experience

### Tools and results

#### What the model sees

None. The plugin registers no model-facing surface — it renders `intakeTree()` / `workspaceTree()` payloads from the `yantaoKb` Remote on the human's side of the boundary, and the `kb_*` tools own everything the model sees of the KB.

#### Token effect

No token cost. Nothing this plugin renders enters a request prefix.

#### KV Cache effect

The plugin adds nothing to any request prefix; it never participates in a model request.

## Known Limitations and Deferred Work

These limits define what the workbench UI deliberately does not do yet. They are current package constraints, not a task backlog.

- The middle pane is still the host's agent surface — the workbench does not own agent interaction until the shared shell's rows are stepped aside.
- No `details` column: this frame declares only `conversation` and `shell.overlay`, so ui-chat's tool-detail panel has no seat (nothing in the shipped source calls `ctx.layout.openDetails()` anyway).
- Each rail keeps its own selection; one shared selection arrives with a cross-rail selection model.
- Open file paths are persisted in `localStorage` under `yantao.center.tabs`; a path that no longer reads is dropped on restore, and a tab's draft is not persisted (only the file is).
- The 能力 panel lists the registered capabilities (ADR-0021); the mail capability's detail embeds the connector panel, the others show their manifest read-only.
- Labels are hardcoded Chinese; this plugin does not yet register a locale dictionary.
- Trust-boundary enforcement lives in the tool layer (ADR-0004), not here: this UI is the human channel and may edit any section.
