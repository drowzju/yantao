---
description: "yantao 工作台客户端插件：基于 ctx.remote 的自研三栏界面，不依赖共享 shell 与槽位系统。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao

[English](README.md) | 中文

## 概述

yantao 工作台自己的客户端插件。dsh 在这里只作**后端**：插件通过 `ctx.remote.yantaoKb`（后续再加会话命名空间）取数，并渲染**自己的** React 树——不用 `ui-layout`、不用 `ui-chat`、不注册任何槽位（ADR-0009）。

## 使用本包

由 `yantao-web-app` bundle 的 `dsh.client` 名单挂载，与 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-yantao-kb-controller` 一起激活；注入 `remote` 后渲染到自己的容器。

## 对外接口

- `apply(ctx)` — 挂载工作台 React 树，并由 `ctx.remote` 驱动。
- `Workbench` — 三栏骨架：左侧输入栏（资源 / 待办 / 会议 / 连接），右侧工作栏（领域 / 人物 / 项目 三个 tab），数据来自 `intakeTree()` / `workspaceTree()`。

## 理解实现

插件刻意做得很薄：`remote.ts` 以防御式方式取 `yantaoKb` 命名空间（命名空间缺失是要报告的状态，不是崩溃），`Workbench.tsx` 是纯展示层，只吃普通数据，`index.ts` 持有唯一的状态——两棵树、当前选中与最后一次失败。共享 shell 仍占据页面时，覆盖层是点击穿透的，只有两条侧栏接收指针事件，因此中间一列仍是宿主提供的 agent 交互区。

**运行时不变量：** 不发布伴生包。本插件不持有进程级全局状态，也没有自己的事件流；它唯一的关系就是所渲染的 Remote 结果，三栏结构与加载/选中/刷新行为由包内的 client spec 断言。

## 模型体验

### 工具与结果

#### 模型看到什么

无。本插件不注册任何模型侧能力——它在边界的人类一侧渲染来自 `yantaoKb` Remote 的 `intakeTree()` / `workspaceTree()` 载荷；知识库里模型能看到的一切都由 `kb_*` 工具拥有。

#### Token 影响

没有 token 开销：本插件渲染的内容不进入任何请求前缀。

#### KV Cache 影响

本插件不向任何请求前缀追加内容，也从不参与模型请求。

## 已知限制与延期工作

这些限制定义了工作台 UI 当下刻意不做的事。它们是本包当前的约束，不是任务清单。

- 中间一栏仍是宿主的 agent 交互区——共享 shell 的行逐条退场之前，工作台并不拥有 agent 交互。
- 侧栏只列出文件、不打开它们：`read` / `write` 已为详情栏做好准备，详情栏随编辑器一起到来。
- 「连接」面板是占位：ADR-0010 预留了 connector 抽象，但尚无实现。
- 文案是硬编码中文：本插件还没有注册词典命名空间。
- 信任边界的执行在工具层（ADR-0004），不在本包：本 UI 是人类通道，可编辑任意区段。
