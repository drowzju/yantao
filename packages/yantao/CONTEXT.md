# yantao 工作台

个人单机知识工作台：以 agent 调用与调度为核心，PARA+P 组织个人知识网络，让流入的信息沉淀为 agent 可用的上下文。运行于 dsh 底座之上。

## Language

### 知识库

**知识库 (Knowledge Base)**:
本地 markdown 仓库根，含 resources/、entities/、sessions/ 三个目录。
_Avoid_: 笔记库

**Resource**:
不可变的原始输入材料，进入知识库后不被修改。
_Avoid_: 资料、素材

**影子笔记 (Shadow Note)**:
与 Resource 同名的 .md 文件，携带元数据、摘要与提炼产物。
_Avoid_: 元笔记

**Entity**:
PARA+P 中的 Project / Area / People 之一；一个实体一个 markdown 文件。
_Avoid_: 条目

**Archive**:
Entity 的一种 frontmatter 状态标签，不是目录。
_Avoid_: 归档目录

**People**:
relation 为 self / subordinate / superior / peer / external 的实体；「我自己」(relation: self) 在首次运行时自动创建。

### 信任边界

**State（状态）**:
Entity 文件中的人类专属区段，agent 不可写。

**流水 (Log)**:
Entity 文件中 agent 唯一可写的区段，只追加。
_Avoid_: 日志、Log 区

**提炼 (Refine)**:
人触发 → agent 提议（建议卡）→ 人批准 的合并流程；禁止无值守自动写入。
_Avoid_: 整理、归纳

### 运行时

**工作台 (Workbench)**:
本产品；三栏布局（导航 / 内容 / agent 面板）。
_Avoid_: 桌面应用（Flutter 时代已终结）

**LLM 网关 (Model Gateway)**:
公司内网的 OpenAI 兼容模型端点（现接 GLM 系列推理模型），工作台唯一的 LLM 来源，经 dsh 的 ctx.llm adapter 接入。
_Avoid_: Agent 后端（旧 ACP/codebuddy 方案已弃）

**Session**:
dsh 平台概念：事件溯源的会话日志流。
_Avoid_: 会话

**会话 (Conversation)**:
用户与 agent 的一次交互，UI 层概念；落盘形态为 Session。
_Avoid_: Session（该词留给 dsh 平台义）
