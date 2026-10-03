# yantao 工作台

个人单机知识工作台：以 agent 调用与调度为核心，PARA+P 组织个人知识网络，让流入的信息沉淀为 agent 可用的上下文。运行于 dsh 底座之上。

## Language

### 知识库

**知识库 (Knowledge Base)**: 本地 markdown 仓库根，含 `resources/`、`entities/`（`projects/`、`areas/`、`people/`、`meetings/` 四个目录加 `todos.md` 单例）、`sessions/`（保留但当前不使用）。

_Avoid_: 笔记库

**Resource**: `resources/` 下的文件——原始输入材料（登记是纯复制，旁边不生成任何笔记，ADR-0020）与能力产出的共同家，进入后不被修改（kb_write_resource 只新建不覆盖，ADR-0028）。用户说「资源」「资料」「放到资源目录」默认指 `resources/`（ADR-0042）。

_Avoid_: 资料、素材

**Entity**: PARA+P 中的 Project / Area / People / Meeting 之一（Todo 是单例，单独一条）；一个实体一个 markdown 文件。

_Avoid_: 条目

**会议 (Meeting)**: 一种 Entity；文件是 `entities/meetings/<YYYY-MM-DD> <会议名>.md`，frontmatter 只有 `type` / `date` / `title`，正文与其他实体同构（有 状态 与 流水 区段）。

_Avoid_: 会议记录（那说的是内容，不是实体）

**待办 (Todo)**: 单例 Entity：整个知识库只有一个 `entities/todos.md`，没有区段结构，正文是 obsidian 语法的 checkbox 列表（`- [ ]` / `- [x]`）。

_Avoid_: 任务清单、TODO.md

**能力 (Capability)**: 一个 dsh skill 目录（`SKILL.md` 指令 + `scripts/` 宿主入口），目录根的 `yantao.json` sidecar 声明入口、运行时与 `appliesTo`（资源扩展名 / 实体类型 / 外部源）——声明外带，开源 skill 目录可原样复用。由人触发、宿主在会话前执行、经统一提议流写库；清单与断点存 `~/.dsh/yantao-kb.json`，不进 tree（ADR-0021）。

_Avoid_: 连接（旧称，已被能力取代，见 ADR-0021）、集成、插件

**Archive**: Entity 的一种 frontmatter 状态标签（`archive: true`），不是目录——归档的实体永不删除、随时可还原（去掉标志即还原）。归档 = 退出活跃：提炼花名册默认隐藏它，关联/校验图谱过滤它的节点连同边；但指向它的 `[[链接]]` 保留解析，历史文档仍可读可跳转，人类指引下 agent 仍可读取它（可作为输入被引用）。写面非对称：agent 的 kb_edit_section / kb_write_state / kb_append_log 对归档实体拒绝（「已归档，先还原」），人通过 UI 不受限；agent 无归档工具，只有纯文本提名权，归档/还原由人经 UI 执行，各在「流水」留一条。实体没有删除入口（ADR-0041 废弃了右键删除与 deleteFile RPC），终极删除只能人在文件系统层动手。

_Avoid_: 归档目录（ADR-0041 否决了「移动到 resources/归档/」路线——全库死链、agent 写面丧失、与邮件域「归档」(ADR-0037) 撞词）

**People**: relation 为 self / subordinate / superior / peer / external 的实体；「我自己」(relation: self) 在首次运行时自动创建。

### 信任边界

**State（状态）**: Entity 文件中的区段，**人与 agent 都可编辑**（agent 经 `kb_write_state` 写入）。ADR-0010 取消了 ADR-0004 的「人类专属」：边界仍在工具层——agent 只能走 `kb_*` 工具写文件。

_Avoid_: Status、状态段

**流水 (Log)**: Entity 文件中只追加的区段（agent 用 `kb_append_log` 追加，人用编辑器改）。

_Avoid_: 日志、Log 区

**归入 (Intake)**: 把资源文件拖到实体行上让 agent 分析相关性的手势；系统拖入先经 `registerResource` 落入 `resources/` 再分析，无关只 toast 不留痕。

_Avoid_: 拖入整理、自动分类

**提炼 (Refine)**: 人触发 → agent 提议（建议卡）→ 人批准 的合并流程；禁止无值守自动写入。

_Avoid_: 整理、归纳

**提炼到实体 (Distill)**: 资源行或目录行右键发起的手势（ADR-0030）：一份资源对整个实体花名册的碰撞，可触及多个实体、提议新建实体、先提问再结论。与「归入」「提炼」共用同一条管线、同一张卡。

_Avoid_: 批量归类、自动打标签

**实体校验 (Validate)**: 第四个手势（ADR-0035/0036）：一次手动操作对全库做纯体检——零 token 的确定性预扫直接产出卡的确定性区块（孤儿条目、失效双链及其代码相似度修复候选），模型只在一个真 Session 里研判预扫窄化后的清单（过期/矛盾/缺链机会），其结论先过代码侧防御核验再进卡的模型区块。两区块在提议卡上分列（`Proposal.prescan` 与模型 findings/actions 类型上互斥）；只弹卡不落盘，不注册指令型能力。L1 白名单没有建页（建页归提炼手势）；todos 与内容陈旧/矛盾属 L2（重新构想后另立 ADR）。

_Avoid_: 体检（口语可用但词条从全）、全库整理、自动修复

**记忆 (Memory)**: 影响 agent 行为方式的规则与偏好（「怎么做」，ADR-0032），与实体知识（「是什么」，落实体章节/流水）划清边界。存 `<kbRoot>/.dsh/yantao/memory/` 行式 markdown：`global.md` 全局 + `capabilities/<能力名>.md` 能力域。写入永远过人批（agent 只能提案，永不免审），删除只经人；注入全动态——全局拼系统 prompt 动态 section，能力域随 `kb_run_capability` 运行上下文。

_Avoid_: 笔记（那是 Resource）、长期记忆（含混「是什么」与「怎么做」）、用户画像

**提案 (Proposal)**: agent 经 `kb_propose_memory` 提名的候选记忆（ADR-0044）：凝练正文 + 来源注记（会话 / UI 运行摘要），住 `<kbRoot>/.dsh/yantao/memory/proposals/<scope>.md` 行式队列，与记忆文件同构，挂起软帽 20 条。队列**永不注入**——毒性输出至多躺在队列里等人过目；人批准即转正（可改判目标作用域，复用 `appendMemoryEntry`），丢弃即移除。批准入口：会话内批准卡片、记忆视图「待批准」区；UI 面另有「提炼经验」按钮替一次运行批量提名。

_Avoid_: 建议（泛）、草稿（暗示可自动生效）、待办（那是 Todo）

### 运行时

**工作台 (Workbench)**: 本产品；三栏（输入栏 / 中栏 / 工作栏）。中栏是 tab 化的：「对话」「任务」「调度」三个常驻 tab 不可关（任务列本会话的后台执行，ADR-0031，行上「详情」摊开该次执行的会话流水，ADR-0033；调度管定时任务定义，ADR-0045），打开的文件各占一个可关闭 tab（ADR-0012）。

_Avoid_: 自维护 agent 基建（这才是 ADR-0001 放弃 Flutter 的真实理由；「桌面应用」不是禁用词，见 ADR-0016）

**LLM 网关 (Model Gateway)**: 公司内网的 OpenAI 兼容模型端点（现接 GLM 系列推理模型），工作台唯一的 LLM 来源，经 dsh 的 ctx.llm adapter 接入。

**调度 (Schedule)**: 定时任务定义（ADR-0045）：名称 + 提示词快照 + 五段 cron + 启用开关，存 `.dsh/yantao/schedules.json`，UI 是唯一写者（agent 无任何调度工具）。前端调度器随渲染进程存活（托盘期间照跑、刷新/重启即死），到点把提示词作为独立后台会话（「调度 · <名称>」）运行；每次触发是一次**调度实例**，作为普通任务行进任务面板，不持久化。重启后错过的触发只标记「上次错过」，不补跑。

_Avoid_: 定时器（实现细节）、闹钟（无执行）、提醒（那是上游 dsh-schedule 的语义，yantao 未挂载）
_Avoid_: Agent 后端（旧 ACP/codebuddy 方案已弃）

**Session**: dsh 平台概念：事件溯源的会话日志流。

_Avoid_: 会话（该词随会话功能一并移除，见 ADR-0010）
