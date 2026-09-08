---
description: "yantao workbench client plugin: the bespoke three-pane UI over ctx.remote, rendered without the shared shell or slot system."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao

English | [中文](README.zh.md)

## Overview

The yantao workbench's own client plugin. dsh is used as a **backend**: this plugin talks to `ctx.remote.yantaoKb` (and, later, the session namespace) and renders a React tree of its own — no `ui-layout`, no `ui-chat`, no slot registration (ADR-0009).

## Use this package

Mounted by the `yantao-web-app` bundle's `dsh.client` roster, alongside `@deepseek-ai/dsh-api-remotes` and `@deepseek-ai/dsh-api-yantao-kb-controller`. It activates once `remote` is available and renders into its own container.

## Surface

- `apply(ctx)` — mounts the workbench React tree and drives it from `ctx.remote`.
- `Workbench` — the three-pane skeleton: the intake rail (资源 / 待办 / 会议 / 连接) on the left, the workspace rail (领域 / 人物 / 项目 as tabs) on the right, both fed by `intakeTree()` / `workspaceTree()`.

## Understand the implementation

The plugin is deliberately thin: `remote.ts` reaches the `yantaoKb` namespace defensively (a missing namespace is a reported state, not a crash), `Workbench.tsx` is pure presentation over plain data, and `index.ts` owns the only state — the two trees, the selection, and the last failure. While the shared shell still owns the page, the overlay is click-through and only the rails take pointer events, so the middle column stays the host's agent surface.

**Runtime invariant:** No companion is published. The plugin holds no process-global state and no event stream of its own; its only relations are the Remote results it renders, and the three-pane shape plus the load/select/refresh behavior are asserted by the package's client spec.

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
- Rails list files but do not open them: `read` / `write` are wired for the detail pane, which arrives with the editor.
- The 连接 panel is a placeholder; ADR-0010 reserves the connector abstraction but no implementation exists.
- Labels are hardcoded Chinese; this plugin does not yet register a locale dictionary.
- Trust-boundary enforcement lives in the tool layer (ADR-0004), not here: this UI is the human channel and may edit any section.
