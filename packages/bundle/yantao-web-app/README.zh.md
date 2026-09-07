---
description: "yantao 工作台浏览器表层 bundle：yantao-web profile 层，以知识库工作台 roster 提供 stock web 前端 dist，面向组合或定制 yantao-web profile 的用户。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-yantao-web-app

[English](README.md) | 中文

## 概述

`dsh-yantao-web-app` 是 `yantao-web` profile 的浏览器表层：`dsh --profile yantao-web` 以与 stock 表层完全相同的已构建 web 前端 dist 提供服务——不开新 Vite 应用、不做 fork——并在其上叠加工作台组合。这个 bundle 是一份静态 patch 文档加一个解析 dist 的小型运行时胶合插件：它挂载 web 传输与控制器行、一套把编码 agent 装饰换成 KB 工作台的 roster（侧栏的知识库树、详情列的知识库 Markdown 编辑器、中央原样保留的 stock 聊天）、`yantaoKb` Remote 控制器，以及作为默认的 `yantao` agent preset——只有 persona、没有工具行，因此聊天 agent 恰好只看到遵守边界的 `kb_` 工具。GLM 路由、默认模型、中文 persona 与 kb 插件都来自更早的 `dsh-base` 与 `dsh-yantao` 层。

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

启动工作台，使用打印出的 URL 并打开。第一次执行 `dsh --profile yantao-web` 会按内置模板创建 profile 目录（依次组合 `dsh-base`、`dsh-yantao`、`dsh-yantao-web-app` 三个 bundle）。

### 运行工作台

```sh
MODEL_GATEWAY_API_KEY=<key> dsh --profile yantao-web
```

命令会打印 `dsh web: <url>` 并打开默认浏览器（用 `--no-open` 抑制；`--port` 与 `--host` 与 stock 表层相同）。页面是 stock web shell；工作台是它背后的 roster：左侧知识库树，中间聊天，右侧知识库 Markdown 编辑器。

### 本 bundle 逐层改动了什么

| 行组 | 内容 | 效果 |
|---|---|---|
| Web 宿主与传输 | 与 stock web 层相同的行（webserver、web-runtime、各控制器、workspace、feedback、references、stats），外加 `yantao-kb-controller` | 浏览器表面与 `yantaoKb` 命名空间以与 stock 相同的方式就绪 |
| 浏览器 roster | stock roster 减去编码 agent 装饰（ui-sidebar、ui-cordis、ui-workflow-run、ui-deliverables、ui-subagent、ui-skill、ui-jobs、ui-goal、ui-plan、ui-user-questions、ui-trajectory、ui-schedule），加上 `ui-yantao-kb` | 工作台布局：树 \| 聊天 \| 编辑器 |
| base agent 层行 | 与 stock web 表层完全一致地禁用（shell、fs、jobs、goal、plan、subagent、workflow、ralph、todo、web、compaction、instructions、skill） | 工具重新按 preset 分配 |
| `agent-presets` | `default: yantao` | 新会话挂载 yantao preset：中文 persona、无工具行——agent 只看到宿主层的 `kb_` 工具 |

### 修改默认值

编辑该 profile 自己的 `cordis.patch.yml`，或再叠加一个 bundle。profile 模板设置 `patchReload: 'live'`，因此用户 patch 无需重启即可重载。每条 patch 会整体替换目标的配置，因此想保留的每项设置都要重述。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

这个 bundle 主要是一份静态 patch 文档；它唯一的代码是从 `dsh-web-app` 克隆的运行时胶合（dist 解析、frontend-static 挂载、web-surface 提示小节、`DSH_WEB_URL` bash 变量、URL 行与默认浏览器交接）以及 `web-startup` 命令行提供方（同样的标志、同样的 `webStartup` 服务键——本组合从不挂载 stock web-app，因此不会冲突）。

### roster 差异及理由

从 stock roster 中省略（每一项都是 web-app 侧的插入行，缺席即足够）：ui-sidebar（被知识库树替换）、ui-cordis（本表面未挂载其可选工具）、ui-workflow-run / ui-deliverables（这里没有生产者的 workflow/产物文件装饰）、ui-subagent / ui-skill / ui-jobs / ui-goal / ui-plan / ui-user-questions / ui-trajectory（编码 agent 装饰，在本表面是惰性）、ui-schedule（在别处按需启用）。保留：传输与框架行、ui-conversation/ui-chat/ui-approval、settings 家族、ui-workspace（其服务支撑树中「会话」节的会话创建）、composer 触发管线、ui-message-feedback、ui-model-selection、ui-permission、ui-agent-preset，以及 ui-settings-plugins（kbRoot 卡片在此渲染）。

### 本表面上的信任边界

web 表面上的工具是按 preset 分配的。base agent 层行与 stock 一样被禁用，而默认 preset 只带中文 persona，因此会话的合并目录恰好是全局（宿主）层：来自 `dsh-yantao-kb` 的六个 `kb_` 工具。shipped preset 在通用设置中仍然可选——切换 preset 是人类知情后的行为；边界是默认姿态。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | bundle 本体：web 宿主体、传输、roster、禁用与 preset 默认值 |
| [`src/index.ts`](src/index.ts) | 运行时胶合插件（`web-runtime` 行），克隆自 `dsh-web-app` |
| [`src/startup.ts`](src/startup.ts) | `web-startup` 命令行提供方（标志与 `--help`） |
| — | 不发布运行时不变量伴生包；patch 列表与胶合不持有挂载包所拥有之外的可变关系。 |

### 不变量归属

不发布不变量伴生包，因为本 bundle 是 patch 列表载体加无状态胶合：每个被挂载行的不变量由其所属包承担，bundle 自身不拥有可检查的可变关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解本 bundle 所叠加的层，或拥有被挂载行的包时，阅读这些页面。

- [bundle 包地图](../README.zh.md)——构建在同一核心之上的各个表层。
- [dsh-web-app](../web-app/README.zh.md)——本 bundle 的胶合与 roster 所源自的 stock 浏览器表层。
- [dsh-yantao](../yantao/README.zh.md)——下方的提供方与领域层（GLM 路由、persona、kb 插件、工具禁用）。
- [dsh-yantao-kb](../../yantao/kb/README.zh.md)——KB 领域插件。
- [dsh-api-yantao-kb-controller](../../api/yantao-kb-controller/README.zh.md)——本 bundle 挂载的 `yantaoKb` Remote 控制器。
- [dsh-client-ui-yantao-kb](../../client/ui-yantao-kb/README.zh.md)——工作台 roster 的中心件。

-----

<a id="model-experience"></a>
## 模型体验

### Harness 源码与 Web 表层上下文

#### 模型看到什么

当 `surfaceContext` 为 true 时，`harness:source` 小节标识磁盘上的 Harness 实现（不声称它就是工作目录），`app:web-surface` 全局小节让模型面向 GUI：规范的本地 URL、"this page" 的所指、更新契约（重载接收器始终开启；免刷新重载还需要 `pnpm run dev:web` 监视器），以及不要启动替代服务器的指示。`DSH_WEB_URL` 还会连同其描述出现在受管 bash 环境中，每次调用时从在线服务器解析。当它为 false 时，两个小节与变量都不会注册。

#### Token 影响

每个会话一行源码说明与一段提示，外加两行受管环境变量；每个进程恒定。

#### KV Cache 影响

提示小节位于系统提示的头部附近，并且在进程的生命周期内稳定（端口是启动事实），因此不会在轮次间使缓存失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制告诉你本表面何时需要额外留意。它们是本包当前的约束，不是泛泛的比较或任务清单。

- **边界是默认 preset，不是锁**——shipped 的编码 preset 在通用设置中仍然可选；人类切换 preset 是刻意为会话授予更宽工具集的行为。
- **覆盖会整体替换设置块**——之后的 patch 层一旦触及 `agent-presets` 或任何传输行，就会替换其全部配置，因此必须重述要保留的值。
- **详情列属于编辑器**——ui-chat 的轮次详情面板在本表面被遮蔽；它在 stock web profile 上仍然可用。
- **没有 fork 保证**——本 bundle 原样复用 stock dist 与胶合；stock web UI 若改变 `sidebar`/`details` 槽位契约，会流入这里并需要刻意调和。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
