---
description: "yantao workbench client plugin: the two workbench rails over ctx.remote, contributed into the host layout's sidebar slot and the frame-wide overlay layer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao

English | [中文](README.zh.md)

## Overview

The yantao workbench's own client plugin. dsh is used as a **backend**: this plugin talks to `ctx.remote.yantaoKb` (and, later, the session namespace) and renders React trees of its own (ADR-0009) — contributed into two slots the host layout already owns, so the frame's own geometry applies to them.

## Use this package

Mounted by the `yantao-web-app` bundle's `dsh.client` roster, alongside `@deepseek-ai/dsh-api-remotes`, `@deepseek-ai/dsh-api-yantao-kb-controller`, `@deepseek-ai/dsh-client-ui-layout` and `@deepseek-ai/dsh-client-ui-renderer`. It activates once `slots` and `remote` are available and contributes two entries — it owns no container of its own.

## Surface

- `apply(ctx)` — contributes both rails through `ctx.slots.inject` and drives them from `ctx.remote`.
- `IntakeRail` — the `sidebar` slot occupant: 资源 / 待办 / 会议 / 连接, fed by `intakeTree()`. It receives the frame's `collapsed` / `width` owner share, so the sidebar drag handle sizes it and `toggleSidebar` collapses it to an icon rail.
- `WorkspaceRail` — a `shell.overlay` entry: 领域 / 人物 / 项目 as tabs, fed by `workspaceTree()`. It floats over the frame's right edge and retracts to a handle.

## Understand the implementation

The plugin is deliberately thin: `remote.ts` reaches the `yantaoKb` namespace defensively (a missing namespace is a reported state, not a crash), `Workbench.tsx` is pure presentation over plain data, and each rail owns only its own load state and selection. Registration goes through `slots.inject`, not a bare `register`: the two keys are declared by `ui-layout`'s root registration, which may not have run when this plugin applies, and inject waits for the declaration lifetime instead of throwing. The middle column stays the host's agent surface — ADR-0010 steps the shared shell aside one row at a time.

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
- The workspace rail floats: the host's only right-hand column (`details`) is occupied by ui-chat's tool details, so it rides `shell.overlay` and retracts to a handle rather than reserving a column.
- Each rail keeps its own selection; one shared selection arrives with the detail pane.
- Rails list files but do not open them: `read` / `write` are wired for the detail pane, which arrives with the editor.
- The 连接 panel is a placeholder; ADR-0010 reserves the connector abstraction but no implementation exists.
- Labels are hardcoded Chinese; this plugin does not yet register a locale dictionary.
- Trust-boundary enforcement lives in the tool layer (ADR-0004), not here: this UI is the human channel and may edit any section.
