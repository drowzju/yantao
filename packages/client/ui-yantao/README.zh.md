---
description: "yantao 工作台客户端插件：基于 ctx.remote 的自研三栏界面，不依赖共享 shell 与槽位系统。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao

[English](README.md) | 中文

## 概述

yantao 工作台自己的客户端插件。dsh 在这里只作**后端**：插件通过 `ctx.remote.yantaoKb`（后续再加会话命名空间）取数，并渲染**自己的** React 树——不用 `ui-layout`、不用 `ui-chat`、不注册任何槽位（ADR-0009)。

## 使用本包

由 `yantao-web-app` bundle 的 `dsh.client` 名单挂载，与 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-yantao-kb-controller` 一起激活；注入 `remote` 后渲染到自己的容器。

## 对外接口

- `apply(ctx)` — 挂载工作台 React 树，并由 `ctx.remote` 驱动。

## 已知限制与延期工作

- 当前是 spike 状态：只渲染一次 `yantaoKb.tree()` 往返以证明链路；三栏工作台（左 resource/session ｜ 中 agent（默认)与编辑器 tab ｜ 右其他实体）随后替换它。
- 信任边界的执行在工具层（ADR-0004),不在本包：本 UI 是人类通道，可编辑任意区段。
