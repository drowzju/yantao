# yantao 工作台

个人单机知识工作台：以 agent 调用与调度为核心，PARA+P 组织个人知识网络，让流入的信息沉淀为 agent 可用的上下文。运行于 dsh 底座之上。

## Language

### 知识库

**知识库 (Knowledge Base)**: 本地 markdown 仓库根，含 `resources/`、`entities/`（`projects/`、`areas/`、`people/`、`meetings/` 四个目录加 `todos.md` 单例）、`sessions/`（保留但当前不使用）。

_Avoid_: 笔记库

**Resource**: 不可变的原始输入材料，进入知识库后不被修改。

_Avoid_: 资料、素材

**影子笔记 (Shadow Note)**: 与 Resource 同名的 .md 文件，携带元数据、摘要与提炼产物。

_Avoid_: 元笔记

**Entity**: PARA+P 中的 Project / Area / People / Meeting 之一（Todo 是单例，单独一条）；一个实体一个 markdown 文件。

_Avoid_: 条目

**会议 (Meeting)**: 一种 Entity；文件是 `entities/meetings/<YYYY-MM-DD> <会议名>.md`，frontmatter 只有 `type` / `date` / `title`，正文与其他实体同构（有 状态 与 流水 区段）。

_Avoid_: 会议记录（那说的是内容，不是实体）

**待办 (Todo)**: 单例 Entity：整个知识库只有一个 `entities/todos.md`，没有区段结构，正文是 obsidian 语法的 checkbox 列表（`- [ ]` / `- [x]`）。

_Avoid_: 任务清单、TODO.md

**连接 (Connector)**: 预留的资源接口抽象：从外部系统（邮箱等）拉取 Resource 的一种接法。不落盘、不进 tree；现在只有 ADR-0010 的描述，没有实现。

_Avoid_: 集成、插件

**Archive**: Entity 的一种 frontmatter 状态标签，不是目录。

_Avoid_: 归档目录

**People**: relation 为 self / subordinate / superior / peer / external 的实体；「我自己」(relation: self) 在首次运行时自动创建。

### 信任边界

**State（状态）**: Entity 文件中的区段，**人与 agent 都可编辑**（agent 经 `kb_write_state` 写入）。ADR-0010 取消了 ADR-0004 的「人类专属」：边界仍在工具层——agent 只能走 `kb_*` 工具写文件。

_Avoid_: Status、状态段

**流水 (Log)**: Entity 文件中只追加的区段（agent 用 `kb_append_log` 追加，人用编辑器改）。

_Avoid_: 日志、Log 区

**提炼 (Refine)**: 人触发 → agent 提议（建议卡）→ 人批准 的合并流程；禁止无值守自动写入。

_Avoid_: 整理、归纳

### 运行时

**工作台 (Workbench)**: 本产品；三栏（输入栏 / 中栏 / 工作栏）。中栏是 tab 化的：「对话」常驻不可关，打开的文件各占一个可关闭 tab（ADR-0012）。

_Avoid_: 桌面应用（Flutter 时代已终结）

**LLM 网关 (Model Gateway)**: 公司内网的 OpenAI 兼容模型端点（现接 GLM 系列推理模型），工作台唯一的 LLM 来源，经 dsh 的 ctx.llm adapter 接入。

_Avoid_: Agent 后端（旧 ACP/codebuddy 方案已弃）

**Session**: dsh 平台概念：事件溯源的会话日志流。

_Avoid_: 会话（该词随会话功能一并移除，见 ADR-0010）
