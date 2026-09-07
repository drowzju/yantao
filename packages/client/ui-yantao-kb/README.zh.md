---
description: "yantao 工作台 Client 插件：侧栏的五节知识库树与详情列的 Markdown 源码/预览编辑器，面向 yantao-web 表层的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-yantao-kb

[English](README.md) | 中文

## 概述

`dsh-client-ui-yantao-kb` 是 yantao 工作台的浏览器插件。它以五节知识库树占据布局的 `sidebar` 槽位——覆盖 `resources/`、`entities/{projects,areas,people}/` 与 `sessions/` 的 资源/项目/领域/人物/会话——并以一个 Markdown 编辑器遮蔽 `details` 槽位：源码 textarea、`MarkdownText` 预览、脏标记与保存。树与编辑器通过插件提供的 cordis 服务共享同一份选择与树载荷，所有文件操作都走 `yantaoKb` Remote。编辑器是人类进入知识库的通道：`resources/` 原件渲染为只读（知识库自身的契约），其余一切都可以整文件保存。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`yantao-web` profile 的 roster 会自动挂载本插件；工作台布局无需任何配置。

### 工作台布局

| 列 | 占据者 | 内容 |
|---|---|---|
| 左（`sidebar`） | 本插件的知识库树 | 五节；「会话」节内有进行中的聊天会话与「新建会话」；品牌与设置槽位为 stock 占据者重新声明 |
| 中（`conversation`） | stock ui-conversation + ui-chat | 聊天，原样保留 |
| 右（`details`） | 本插件的知识库编辑器 | 源码/预览切换、脏标记、保存 |

在树中选择一个文件会立即在编辑器中打开——两者共享插件的 `yantaoKbWorkbench` 服务，每次保存后树也会保持新鲜。

### 人类在这里能做什么

- 以五节浏览知识库；已归档实体带「已归档」徽标，带影子笔记的资源带「笔记」徽标。
- 在编辑器中打开任何文件、编辑完整文本并保存——保存是通过 `yantaoKb.write` 的整文件写入，在宿主侧被限制在知识库根目录内。
- 从「会话」节打开或新建聊天会话；人类直接编辑「状态」区的同时，agent 通过自己的 `kb_` 工具在同一个知识库上工作。
- 读取但绝不能编辑 `resources/` 原件；它们的 `.md` 影子笔记才是可编辑表面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

插件在 `apply` 中注册三项贡献：locale 词典（命名空间 `yantao-kb`）、`yantaoKbWorkbench` cordis 服务，以及两个槽位占据者。服务存在的原因：侧栏（root scope）与编辑器（session scope）不能共享同一个 store 句柄；cordis 服务可以跨 scope，因此两者通过各自的 inject 面消费同一个可观察源（`selection`、`tree`、`treeError`）与同一组 RPC 动作。槽位选择及其理由：

- `sidebar` 以默认优先级占据，因为 yantao-web roster 禁用了 ui-sidebar；它本会声明的品牌与设置槽位空出来了，因此本插件重新声明 `sidebar.brand.mark`、`sidebar.brand.name` 与 `sidebar.settings`，stock 的 brand-official 与 ui-settings 占据者原样挂载。
- `details` 以优先级 `-10` 占据，遮蔽 ui-chat 的 `DetailsPanel`——在工作台上详情列就是知识库编辑器（不同优先级共存，最低者渲染）。
- 刻意不实现自定义 `conversation` 根：槽位系统每个槽位只允许一个声明者，而 ui-conversation 的根已经声明了 view/composer 子树，遮蔽它的根会让聊天输入路径无处安放。stock 聊天列保持原样。

编辑器把内容状态保持在组件局部（选择变化时加载并以过期票据丢弃迟到的解析，saved/draft 对，保存后建立新基线）。`resources/` 原件按知识库契约只读；其余路径都可编辑。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件入口：inject 声明、服务提供、槽位注册 |
| [`src/client/service.ts`](src/client/service.ts) | `KbWorkbench`：同一个可观察源背后的选择、树载荷与 RPC 动作 |
| [`src/client/KbSidebar.tsx`](src/client/KbSidebar.tsx) | 侧栏外壳：品牌行、树滚动区、设置脚部 |
| [`src/client/KbTree.tsx`](src/client/KbTree.tsx) | 五节树的展示 |
| [`src/client/KbEditor.tsx`](src/client/KbEditor.tsx) | 编辑器面板：加载/保存流程、源码/预览切换、脏标记 |
| [`src/client/editor-state.ts`](src/client/editor-state.ts) | 纯 saved/draft 转换与只读路径规则 |
| [`src/client/locales.ts`](src/client/locales.ts) | 中英词典（命名空间 `yantao-kb`） |
| [`src/client/contract/slots.ts`](src/client/contract/slots.ts) | 两个占据者的 props 组合 |
| [`src/index.ts`](src/index.ts) | Node 半：宿主侧行的空 apply |
| — | 不发布运行时不变量伴生包；插件的状态转换（编辑器 saved/draft、只读规则）由包内单元测试覆盖，槽位组合由槽位注册表在加载时校验。 |
| [`tests/`](tests/) | editor-state 转换、只读规则，以及 KbEditor 的加载/脏标记/保存行为（jsdom） |

### 不变量归属

不发布不变量伴生包，因为插件的可变状态要么是组件局部的（编辑器），要么由单一服务持有，其发布纪律（单步、两个身份稳定）由单元测试检验。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解本插件所乘的通道或挂载它的表层时，阅读这些页面。

- [dsh-api-yantao-kb-controller](../../api/yantao-kb-controller/README.zh.md)——每个文件操作背后的 `yantaoKb` Remote。
- [dsh-yantao-web-app](../../bundle/yantao-web-app/README.zh.md)——roster 挂载本插件的 bundle。
- [dsh-yantao-kb](../../yantao/kb/README.zh.md)——知识库领域与边界的 agent 侧。
- [Slots 参考](../../../docs/subsystems/slots.zh.md)——本插件遵循的声明、遮蔽与 props 份额规则。
- [dsh-client-ui-primitives](../ui-primitives/README.zh.md)——`MarkdownText` 与图标集。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本插件是浏览器侧的知识库树与编辑器展示，不注册任何面向模型的内容；聊天列自己的包拥有面向模型的表面。

#### KV Cache 影响

本插件不向任何请求前缀添加内容；它从不参与模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了工作台 UI 暂时刻意不做的事。它们是本包当前的约束，不是任务清单。

- **没有实时刷新**——树在刷新手势与本表面自身的保存后重新加载；人类的外部修改在下一次刷新时可见，而非实时（文件监听是延期的决定）。
- **只有整文件编辑**——编辑器不提供小节级编辑辅助；人类编辑完整的 Markdown 文本。
- **没有聊天轮次详情**——本表面上编辑器遮蔽了 `DetailsPanel`，因此逐轮详情视图在这里不可达（它在 stock web 表面上仍然可用）。
- **折叠侧栏是朴素轨道**——只有品牌标与切换钮；没有复刻 stock 侧栏的滑动/渐隐编排。
- **二进制原件按文本展示**——非文本资源渲染为替换字符而不是解码查看器；只读横幅是护栏。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
