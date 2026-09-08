---
description: "yantao 工作台客户端插件：基于 ctx.remote 的两条侧栏，分别贡献到宿主布局的 sidebar 槽位与框架级浮层。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao

[English](README.md) | 中文

## 概述

yantao 工作台自己的客户端插件。dsh 在这里只作**后端**：插件通过 `ctx.remote.yantaoKb`（后续再加会话命名空间）取数，并渲染**自己的** React 树（ADR-0009）——贡献到宿主布局已经拥有的两个槽位里，因此框架自身的几何规则对它们生效。

## 使用本包

由 `yantao-web-app` bundle 的 `dsh.client` 名单挂载，与 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-yantao-kb-controller`、`@deepseek-ai/dsh-client-ui-layout`、`@deepseek-ai/dsh-client-ui-renderer` 一起激活；`slots` 与 `remote` 就绪后贡献两条侧栏——它不拥有自己的容器。

## 对外接口

- `apply(ctx)` — 通过 `ctx.slots.inject` 贡献两条侧栏，并由 `ctx.remote` 驱动。
- `IntakeRail` — `sidebar` 槽位占用者：资源 / 待办 / 会议 / 连接，数据来自 `intakeTree()`。它接收框架的 `collapsed` / `width` 属主参数，因此侧栏拖拽手柄能调整它的宽度，`toggleSidebar` 能把它收成图标栏。
- `WorkspaceRail` — `shell.overlay` 条目：领域 / 人物 / 项目 三个 tab，数据来自 `workspaceTree()`。它浮在框架右缘，可收成一个把手。

## 理解实现

插件刻意做得很薄：`remote.ts` 以防御式方式取 `yantaoKb` 命名空间（命名空间缺失是要报告的状态，不是崩溃），`Workbench.tsx` 是纯展示层，只吃普通数据，每条侧栏只持有自己的加载状态与选中项。注册走 `slots.inject` 而不是裸 `register`：这两个键由 `ui-layout` 的 root 注册声明，本插件 apply 时它可能还没运行，inject 会等声明生命周期而不是抛错。中间一列仍是宿主提供的 agent 交互区——ADR-0010 让共享 shell 逐行退场。

**运行时不变量：** 不发布伴生包。本插件不持有进程级全局状态，也没有自己的事件流；它唯一的关系就是所渲染的 Remote 结果，两条侧栏的结构与加载/选中/刷新行为由包内的 client spec 断言。

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
- 右侧工作栏是浮层：宿主唯一的右列（`details`）被 ui-chat 的工具详情占用，因此它走 `shell.overlay` 并可收成把手，而不是占据一列。
- 两条侧栏各自持有选中项；统一的选中项随详情栏一起到来。
- 侧栏只列出文件、不打开它们：`read` / `write` 已为详情栏做好准备，详情栏随编辑器一起到来。
- 「连接」面板是占位：ADR-0010 预留了 connector 抽象，但尚无实现。
- 文案是硬编码中文：本插件还没有注册词典命名空间。
- 信任边界的执行在工具层（ADR-0004），不在本包：本 UI 是人类通道，可编辑任意区段。
