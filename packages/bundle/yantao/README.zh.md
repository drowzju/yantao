---
description: "yantao profile bundle：叠加在 dsh-base 与 dsh-headless 之上的 patch 层，把一次性表层路由到内网模型网关，供需要对网关运行 dsh 的用户使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-yantao

[English](README.md) | 中文

## 概述

`dsh-yantao` 是 `yantao` profile 的提供方与领域层：`dsh --profile yantao "你的任务"` 启动一次性 headless 表层，通过内网模型网关（GLM5.1）而非默认的 DeepSeek 路由作答，并把一个 PARA+P 个人知识库作为 agent 的唯一写入目标。这个 bundle 是一份静态 patch 文档——它把网关注册为 pi-ai 提供方路由，把该路由选为默认模型，挂载来自 `dsh-yantao-kb` 的六个 `kb_` 工具，设定中文工作台 persona，并禁用通用写入工具（shell、编辑器），使 kb_ 工具族成为 agent 的唯一写入口；共享核心与一次性 runner 则原样来自更早的 `dsh-base` 与 `dsh-headless` 层。API key 永不内联：该路由只点名 `MODEL_GATEWAY_API_KEY` 凭据引用，每次请求时从启动环境或受管凭据存储解析。

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

通过网关运行一个任务，获得最终答案，然后退出。第一次执行 `dsh --profile yantao` 会按内置模板创建 profile 目录（依次组合 `dsh-base`、`dsh-headless`、`dsh-yantao` 三个 bundle）；此后只需要 key。

### 运行一次性任务

```sh
MODEL_GATEWAY_API_KEY=<key> dsh --profile yantao "run the tests"
```

运行行为与 headless 表层完全一致——提供方推理流式写入 stderr，最终答案打印到 stdout，退出码报告结果——只是每个模型请求都发往本 bundle 注册的网关路由。缺少 key 时请求会以 missing-credential 错误失败；请在启动环境中提供，或通过凭据界面存入。

### 本 bundle 改动了什么

patch 按 id 覆盖 base 配置项并挂载一个插件，每处替换都完整重述：

| 配置项 | 覆盖内容 | 效果 |
|---|---|---|
| `llm-pi-ai` | `providers.model-gateway` | 注册内网模型网关路由：对网关端点使用 OpenAI completions 协议，单个 `GLM5.1` 模型条目，以及 `deepseek` 推理有线格式 |
| `agent-default-model` | `provider: model-gateway`、`model: GLM5.1` | 未显式选择模型而创建的 Agent——包括 headless runner 的那个——使用网关路由 |
| `system-prompt` | 中文 persona | 以硬规则陈述工作台身份与信任边界：『状态』区是人类专属，读写知识库只能使用 kb_ 工具，`kb_append_log` 只能向『流水』区追加 |
| `yantao-kb`（插入） | `@deepseek-ai/dsh-yantao-kb` | 挂载六个 kb_ 工具——agent 写入知识库的唯一途径 |
| `tool-bash`、`tool-pwsh`、`tool-str-replace-editor` | `disabled: true` | 移除所有通用写能力（shell 命令、编辑器）；读与搜索保留 |

### 修改默认值

编辑该 profile 自己的 `cordis.patch.yml`，或再叠加一个 bundle。每条 patch 会整体替换目标的配置，因此想保留的每项设置都要重述——只点名单个字段的覆盖会悄悄丢掉路由的其余部分。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

这个 bundle 是一份静态 patch 文档：在 base 与 headless 层之后，对 `dsh-base` 配置项施加两条按 id 定位的 config patch。它不挂载服务、不发出事件、不持有可变状态；被配置项所属的包各自拥有其行为与不变量。

### 提供方路由

base 的 `llm-pi-ai` 配置项以休眠方式挂载 pi-ai 适配器——在配置提供 provider profile 之前没有任何路由。本层提供了一个。`model-gateway` 路由不指名任何已安装的 pi-ai 目录提供方，因此该 profile 就是完整的提供方声明：`openai-completions` 有线协议、网关端点、单条目模型目录（`GLM5.1`，上下文窗口 131,072 token、输出能力 32,768 token），以及 `deepseek` 推理格式兼容开关。`MODEL_GATEWAY_API_KEY` 引用在每次请求时经 `ctx.credentials` 解析，其中继承的进程环境优先于受管凭据文档，所以 `MODEL_GATEWAY_API_KEY=… dsh --profile yantao …` 无需任何已存状态即可完成认证。

### 默认选择

`agent-default-model` 配置项承载入口点创建 Agent 时与传输无关的默认选择；headless runner 创建其一次性 Agent 时读取该选择。本层的组合条目把选择指向 `model-gateway`/`GLM5.1`。网关地址、模型 id 与显示名在这里是字面量，这是刻意的：它们是开箱即用的实例值，换模型应当在你自己的 profile patch(`~/.dsh/profiles/yantao/cordis.patch.yml`)里覆盖本行，或在「设置 → 模型」中添加提供方，而不是改动本 bundle。只有密钥走环境——`apiKeyEnv` 是凭据引用而非密钥本身（见 `.env.example`)。与所有 profile 一样，用户设置文档中已保存的选择仍然优先于组合条目。

### 信任边界

一个插入的配置项挂载 [`dsh-yantao-kb`](../../yantao/kb/README.zh.md) 工具族，另有三条按 id 的 patch 禁用会为 agent 提供通用写入路径的配置项：两个 shell 工具（可执行任意命令）与字符串替换编辑器。shell 沙箱后端保持挂载——它们不注册模型侧工具，`dsh-permission-presets` 注入了 `ctx.shell`、没有提供方就永远无法激活，而且它们同时是约束 `tool-fs` 写入的文件效果边界。留下的是刻意为之的：`tool-fs` 保留 `read`（其 `write`/`edit` 受工作区沙箱约束，对在工作区之外的知识库根目录会失败关闭），`tool-fs-search` 保留 grep/glob，知识库的一切写入都归 kb_ 工具族。中文 persona 把同一条边界以硬规则陈述给模型。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | bundle 本体：两条配置项覆盖，理由以内联注释说明 |
| [`src/index.ts`](src/index.ts) | 包入口；不承载运行时 API |
| — | 不发布运行时不变量伴生包；本包是静态 patch 列表载体（一份对其他包所拥有的配置项做 config 覆盖的 YAML 文档），不挂载服务、不发出事件、不拥有可检查的可变关系。每个被配置项的不变量由其所属包承担。 |

### 不变量归属

不发布不变量伴生包，因为本包是静态 patch 列表载体：每个被配置项的不变量由其所属包承担，bundle 自身不拥有可检查的可变关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解本 bundle 所叠加的层，或拥有被配置项的包时，阅读这些页面。

- [bundle 包地图](../README.zh.md)——构建在同一核心之上的各个表层。
- [dsh-yantao-kb](../../yantao/kb/README.zh.md)——本 bundle 挂载的 PARA+P 知识库工具族。
- [dsh-base](../base/README.zh.md)——yantao profile 所基于的共享核心。
- [dsh-headless](../headless/README.zh.md)——该 profile 原样复用的一次性表层。
- [dsh-llm-pi-ai](../../llm/llm-pi-ai/README.zh.md)——拥有提供方路由配置形状的适配器。
- [dsh-agent-default-model](../../core/agent-default-model/README.zh.md)——拥有默认模型选择的服务。
- [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)——profile 如何解析、分层与定制。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过它所配置的配置项与挂载的插件，其所属包拥有所有面向模型的行为。

#### KV Cache 影响

本 bundle 自身不向请求前缀添加任何内容；它只是选择组合树与哪个提供方路由、哪个模型通信。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制告诉你 yantao 层何时需要额外留意，或覆盖应当写到哪里。它们是本包当前的约束，不是泛泛的比较或任务清单。

- **key 必须存在于 bundle 之外**——`MODEL_GATEWAY_API_KEY` 在启动环境与受管凭据存储中都未设置时，每个网关请求都会以 missing-credential 错误失败；bundle 自身从不存储 key。
- **覆盖会整体替换设置块**——之后的 patch 层一旦触及 `llm-pi-ai` 或 `agent-default-model`，就会替换该配置项的全部配置，因此必须完整重述路由或选择。
- **一条路由、一个模型**——本 bundle 只声明网关路由与 `GLM5.1`；更多提供方或模型属于用户设置文档或其他 bundle 层，不属于这里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
