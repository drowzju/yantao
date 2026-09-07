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

## Known limitations

- Spike state: the current tree renders one `yantaoKb.tree()` round trip to prove the wiring; the three-pane workbench (resources/sessions | agent | entities, with an editor tab) replaces it.
- Trust-boundary enforcement lives in the tool layer (ADR-0004), not here: this UI is the human channel and may edit any section.
