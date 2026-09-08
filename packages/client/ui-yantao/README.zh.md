---
description: "yantao 工作台客户端插件：整个浏览器外壳——在运行时 root 槽位上自绘三栏外框，中列放宿主会话面，两条侧栏基于 ctx.remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao

[English](README.md) | 中文

## 概述

yantao 工作台自己的客户端插件。dsh 在这里只作**后端**：插件通过 `ctx.remote.yantaoKb`（后续再加会话命名空间）取数，并**拥有整个浏览器外壳**——它把自绘的三栏外框注册进运行时内置的 `root` 槽位（ADR-0011）。中间一列仍是宿主的 agent 交互区，通过 `conversation` 座位渲染；两条侧栏是外框的普通子组件，都是真正的网格列，拖拽与折叠行为一致。

## 使用本包

由 `yantao-web-app` bundle 的 `dsh.client` 名单挂载，与 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-yantao-kb-controller`、`@deepseek-ai/dsh-client-ui-layout`、`@deepseek-ai/dsh-client-ui-renderer` 一起激活；`slots`、`theme`、`remote` 就绪后开始工作。`ui-layout` **不在**这份名单里：本插件替换了它的外框，并接手它原本的两个横切职责——`ctx.layout` 服务与主题 presenter。

## 对外接口

- `apply(ctx)` — 提供 `ctx.layout` 与主题 presenter，注册 `root` 外框，并由 `ctx.remote` 驱动两条侧栏。
- `Frame` — `root` 占用者：输入栏 | 会话 | 工作栏 一条网格，每条侧栏一个拖拽手柄，窄屏断点同时收起两侧，外加一层点击穿透的 `shell.overlay`。它只声明两个子座位：`conversation`（宿主的 agent 面）与 `shell.overlay`（ui-commands 的 popupSelect）。
- `IntakeRail` / `WorkspaceRail` — 资源 / 待办 / 会议 / 连接 与 领域 / 人物 / 项目，数据来自 `intakeTree()` / `workspaceTree()`。两者收同样的 `collapsed` 属性、渲染同样的图标列，因此左右对称。
- `WorkbenchLayout` — `ctx.layout` 的实现：上游的 `sidebar` / `details` 语义分别映射到输入栏与工作栏。

## 理解实现

插件刻意做得很薄：`remote.ts` 以防御式方式取 `yantaoKb` 命名空间（命名空间缺失是要报告的状态，不是崩溃），`Workbench.tsx` 是纯展示层，只吃普通数据，每条侧栏只持有自己的加载状态与选中项。`frame/columns.ts` 是纯宽度求解器（两侧都让位，宽的先让）；`frame/Frame.tsx` 用 ResizeObserver 量自己，不读 window。`root` 注册用裸 `register` 而不是 `slots.inject`：`root` 是运行时内置的槽位，注册表构造时就已声明。ADR-0010 让共享 shell 逐行退场——这次退的是布局这一行。

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
- 没有 `details` 列：本外框只声明 `conversation` 与 `shell.overlay`，因此 ui-chat 的工具详情面板没有座位（现有源码里也没有任何地方调用 `ctx.layout.openDetails()`）。
- 两条侧栏各自持有选中项；统一的选中项随详情栏一起到来。
- 侧栏只列出文件、不打开它们：`read` / `write` 已为详情栏做好准备，详情栏随编辑器一起到来。
- 「连接」面板是占位：ADR-0010 预留了 connector 抽象，但尚无实现。
- 文案是硬编码中文：本插件还没有注册词典命名空间。
- 信任边界的执行在工具层（ADR-0004），不在本包：本 UI 是人类通道，可编辑任意区段。
