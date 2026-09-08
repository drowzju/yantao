---
description: "yantao PARA+P 知识库插件：七个 kb_ 工具，是 agent 写入文件型个人知识库的唯一途径，面向 yantao profile 的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-yantao-kb

[English](README.md) | 中文

## 概述

`dsh-yantao-kb` 是 yantao profile 的领域插件：建立在纯文件个人知识库（PARA+P）之上的七个模型侧工具。知识库是一个由 Markdown 实体笔记（`entities/projects|areas|people|meetings/*.md`，以及单例清单 `entities/todos.md`）、永不改写的原始材料（`resources/`）与会话归档（`sessions/`）组成的目录。每个实体文件都有 agent 可整体改写的 `## 状态` 区与只许追加的 `## 流水` 区；工具在结构上执行这条边界——创建永远写入 canonical 模板，此后仅允许改写『状态』区与在『流水』区末尾追加一条带日期的条目，其余每个字节都原样保留。yantao profile bundle 挂载本插件时会移除通用写入工具，使这组工具成为 agent 的唯一写入口。

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

yantao profile 会自动挂载本插件；随后用 `kb_init` 准备一个全新的知识库。

### 第一个会话

```text
> 初始化知识库，然后创建一个名为「dsh 学习」的项目实体，并往它的流水里追加一条：今天完成了 yantao profile 接入。
```

agent 会依次调用 `kb_init`（目录结构 + 根 README + 库主实体「我自己」+ 待办单例）、`kb_create_entity`（按 canonical 模板写入项目文件）、`kb_append_log`（在『流水』区末尾追加 `- YYYY-MM-DD …` 条目）。除非 agent 调用 `kb_write_state`，新文件的『状态』区始终与模板逐字节一致。

### 七个工具

| 工具 | 签名 | 作用 |
|---|---|---|
| `kb_init` | `()` | 创建知识库目录结构、根 README、库主实体与待办单例（幂等） |
| `kb_create_entity` | `(type, name, relation?, date?)` | 按模板写入一个实体文件；文件已存在时拒绝，`todo` 单例也拒绝 |
| `kb_append_log` | `(entity, text)` | 在实体的『流水』区末尾追加一条带日期的日志 |
| `kb_write_state` | `(entity, text)` | 整体替换『状态』区正文；『流水』区与 frontmatter 原样保留 |
| `kb_read_entity` | `(type, name)` | 返回实体文件的完整内容 |
| `kb_list_entities` | `(type?, includeArchived?)` | 列出实体名；frontmatter 含 `archive: true` 的默认隐藏 |
| `kb_register_resource` | `(path)` | 把原始材料复制进 `resources/` 并创建影子笔记骨架 |

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `kbRoot` | `~/yantao-kb` | 知识库根目录，由 `kb_init` 创建 |

在 profile 自己的 `cordis.patch.yml` 中覆盖（patch 会整体替换插件配置）：

```yaml
- id: yantao-kb
  config:
    kbRoot: D:/path/to/your-kb
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本插件是无状态的：只持有解析后的 `kbRoot`，每个操作都重新读取它触及的文件，因此两次调用之间人类对文件的修改永远生效。注册通过 `ctx.tools.register(defineTool(...))` 以 effect 方式进行；插件 fiber 销毁时整组工具随之注销。

### 信任边界是拼接器，不是编辑器

`kb_append_log` 从不改写文件：它按 `\n` 切分文本，要求『## 流水』锚点标题恰好出现一次（缺失或重复都是硬错误，绝不重建），并把日志行直接插入该小节最后一个非空行之后。按同样的分隔符重新拼合行序列，其余内容逐字节保留——尤其是上方的『状态』区。`kb_write_state` 是同一拼接器在『## 状态』锚点上的镜像：它替换标题与下一小节之间的行，因此『流水』区与 frontmatter 不受影响，`text` 为空则恢复模板中的空『状态』区。多行文本会成为一条日志，后续行缩进两格。任何写入之前 frontmatter 信封必须能解析（js-yaml）；实体名先经 `sanitizeFileName` 处理（`\/:*?"<>|` 替换为 `_`、去首尾空白、去掉结尾点与空格、空名回退 `未命名`）才成为文件名；路径形式的实体定位被限制在 kbRoot 之内。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：Config（`kbRoot`）与七个 `defineTool` 注册 |
| [`src/core.ts`](src/core.ts) | 工具背后的七个文件系统操作 |
| [`src/splice.ts`](src/splice.ts) | 『状态』/『流水』区拼接器与日志条目构造 |
| [`src/frontmatter.ts`](src/frontmatter.ts) | 只读的 frontmatter 信封解析（js-yaml） |
| [`src/paths.ts`](src/paths.ts) | `sanitizeFileName`、日期戳、限制在 kbRoot 内的路径解析 |
| [`src/templates.ts`](src/templates.ts) | canonical 实体 / 影子笔记 / 根 README 文件布局 |
| [`src/types.ts`](src/types.ts) | 实体分类与 `KbError` |
| — | 不发布运行时不变量伴生包；本插件是无状态工具族，其修改契约（仅一次模板创建、逐字节保留的『状态』改写与『流水』追加）由包内单元测试覆盖。 |
| [`tests/kb.spec.ts`](tests/kb.spec.ts) | 基于真实临时目录的拼接器、模板与操作覆盖 |

### 不变量归属

不发布不变量伴生包，因为本插件不持有进程内的可变关系：它的全部写入契约都在文件格式与拼接器之中，由单元测试直接检验。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解挂载本插件的表层或其所基于的工具契约时，阅读这些页面。

- [dsh-yantao](../../bundle/yantao/README.zh.md)——挂载本插件并移除通用写入工具的 profile bundle。
- [dsh-base](../../bundle/base/README.zh.md)——yantao profile 之下的共享核心。
- [dsh-headless](../../bundle/headless/README.zh.md)——该 profile 复用的一次性表层。
- [工具编写参考](../../../docs/cookbook/adding-a-tool.zh.md)——这些工具遵循的 `defineTool` 契约。
- [dsh-tools](../../core/tools/README.zh.md)——工具族背后的注册表与执行管线。

-----

<a id="model-experience"></a>
## 模型体验

### 工具与结果

#### 模型看到什么

七个 `kb_` 模式（`kb_init`、`kb_create_entity`、`kb_append_log`、`kb_write_state`、`kb_read_entity`、`kb_list_entities`、`kb_register_resource`）：中文描述会点名信任边界（`kb_append_log` 声明只向『流水』区追加，缺少锚点时报错而非重建；`kb_write_state` 声明只替换『状态』区、不碰『流水』区）。成功的结果是携带知识库相对路径的紧凑 JSON；`kb_read_entity` 返回实体文件全文。失败以中文 `KbError` 消息到达，指明具体问题（缺少锚点、实体已存在、frontmatter 不合法、路径越出知识库根目录）。

#### Token 影响

七个工具的固定模式开销，外加每次调用一条紧凑结果；`kb_read_entity` 的结果是数据相关的（实体文件全文），本包不设上限。

#### KV Cache 影响

模式定义与挂载组合不变时，模式保持前缀稳定。调用与结果追加在可复用请求前缀之后，不会使更早的条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了 KB 工具在哪些地方设计上需要人类照料。它们是本包当前的约束，不是任务清单。

- **拼接器是基于行的，不理解文档结构**——手工编辑后缺失或重复『## 状态』/『## 流水』标题的文件会硬性失败，工具绝不修复；修复文件是人类的工作。
- **待办单例没有区段结构**——`entities/todos.md` 是一个纯复选框清单，`kb_append_log` 与 `kb_write_state` 都会拒绝它；agent 用 `kb_read_entity` 阅读，人类则整体编辑这个文件。
- **没有归档修改工具**——归档是人类对 frontmatter 的编辑（`archive: true`）；工具只读取该标记，agent 无法归档或取消归档实体。
- **资源只复制、不移动、也不按内容去重**——原文件保留在原处；同名资源即使来自不同源文件，第二次登记也会被拒绝。
- **每个挂载实例一个知识库根目录**——多个知识库需要分开的 profile 或更换配置 patch；没有按次调用的根目录覆盖。
- **正文中的实体引用不做校验**——`areas: []` 与『流水』条目里的自由文本提及都是纯文本；链接检查与反向引用属于延期工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
