---
status: accepted
---

# 类型化模板与协作边界重划（模板文件、`kb_edit_section`、`kb_write_resource`、手势即 slash）

四处积压的"性质与机制错位"一次性校正：实体模板按类型写死在代码里且三类正文无差异
（`templates.ts:36`）；agent 对实体的写权限只剩状态区一条缝，且 persona 文案与
ADR-0010 的决定自相矛盾（`cordis.patch.yml:65` 仍宣称状态区人类专属）；agent 连"生成
一个文件放进 resources/"都做不到；右键/选区手势的序列化是**客户端定长拼接**
（`Frame.tsx:530` 把 SKILL.md 原文拼进 prompt），而不是 ADR-0025 决定 3 已经实现的
`/xxx` 自然调用。共同主线：**人机交互协作工作台**——人是全权限通道，agent 的边界留在
tool 层（ADR-0004 精神不动），但工具本身要够用、语义要自然。

事实基础（已核实）：`kb_write_state` 自 ADR-0010 起即可改写状态区，限制在 tool 实现层
（splice 只认两个锚点）；controller 的 `agent/pre-step` hook 已认消息开头的 `/name`
并注入 SKILL.md、剩余文本即为实际请求（ADR-0025 决定 3）；`@path` 由宿主 mentions
机制渲染为上下文（ADR-0013），对任何用户消息生效；`RowMenu`/`SelectionMenu`/
`CapabilityMenu` 三个手势表面均已存在。

决定：

1. **类型化模板 = 用户可编辑的模板文件 + 内置回落**。建实体时优先读
   `<kbRoot>/.yantao/templates/<type>.md`（`.yantao/` 是 KB 本地配置面，与
   ADR-0024 的 state.json 同层；`~/.dsh/` 是用户级设置，两者不混），缺失则回落内置
   模板。模板文件**只提供 frontmatter 之后的正文骨架**；frontmatter 仍由代码按类型
   生成（type 及类型特有键），不引入占位符引擎——schema 键的正确性由代码保证，用户
   调教的是区段结构。**状态以模板为主**：模板写了什么区段，实体就有什么区段——
   `## 状态` 在与不在是模板对这类实体的定性选择，缺失时不补、不校验，事后
   `kb_write_state` 按缺锚点照常报错。**流水由机制保证**：任何实体都必须有流水
   （审计性质），正文缺 `## 流水` 时代码自动补在正文末尾（含创建流水行）；唯一回落
   条件是流水锚点重复（机制无法唯一定位）→ 回落内置并在工具结果提示。锚点名字不随
   模板改（状态/流水是术语表词汇）。内置差异（最小集合）：project 加 `## 目标` +
   `## 下一步`（项目有终点，需要北极星与下一动作）；area 加 `## 标准` + `## 检视`
   （area 是持续维持的水准，PARA 本义）；person **不变**（差异已在 frontmatter 的
   relation/email，不为对称而对称）。内置与自定义模板走同一条"正文骨架 + 机制补
   流水"路径。模板只影响**新建**实体，存量不迁移。

2. **agent 实体写边界：从"状态区一条缝"放开到"区段寻址编辑"**。
   - 修 persona：`cordis.patch.yml:65` 的"状态区人类专属"与 ADR-0010 矛盾，按工具
     实际能力如实重写。
   - 新增 `kb_edit_section`（第九个 `kb_*` 工具）：按 `## 锚点` 整体替换实体正文
     **任意区段**；锚点缺失/重复 → 报错不重建；todo 单例无区段不可用（与
     `kb_write_state` 同）。`kb_write_state` 保留为语义糖。
   - **流水区除外**：历史只可追加（`kb_append_log`），任何工具不得改写——人与 agent
     共用这条铁律。
   - **frontmatter 不可写**：type/areas/relation 是 schema 层，错写代价（类型错乱、
     引用悬空）远超便利；需要调整时人是通道。

3. **`kb_write_resource`（第十个 `kb_*` 工具）**。在 resources/ 下**新建**文本文件
   （可含子目录路径）：目标已存在 → 拒绝并提示，不覆盖、不静默改名（与
   `kb_register_resource` 的撞名语义一致）。resources/ 的"原始材料、原样存放永不
   改写"语义不破——本工具只做新建，不做编辑。告知语义 = 工具调用与结果在会话
   transcript 可见 + 工作台资源树即时刷新；不发明额外通知通道。

4. **手势即 slash 调用**。废除客户端拼接，三种手势统一为**合成一条用户消息**发当前
   会话（无会话则新建），走 ADR-0025 决定 3 的既有管线（pre-step 注入 SKILL.md，
   mentions 渲染 `@path`）：
   - 资源行右键 / 中间区无选中右键（`CapabilityMenu`）→ `/name @path`；
   - 实体行右键获得同一手势（`@path` 指向实体文件）——实体与资源同为 KB 路径，
     序列化零差异；
   - 选区右键 → `/name ` + 选中文字；选中文字含换行时整体包成 `> ` 引用块，保持
     `/name` 在消息开头可识别。
   消息在会话中透明可见（如同用户亲手敲入），可回溯、可追问。选区菜单固定项
   「发送到会话」保留不变（选中文字原样为提示词，不依赖任何能力）。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | agent 不能写 frontmatter | schema 层不被模型手滑击穿 | 批量调整元数据成为高频真实需求 |
| 2 | 流水区对一切写者 append-only | 历史不可抵赖、人机审计同源 | 永不（铁律） |
| 3 | 模板不管 frontmatter、无占位符 | 无模板引擎，schema 键永由代码生成 | 出现"按场景变 frontmatter"的真实需求 |
| 4 | 手势消息直接发送、不经输入框确认 | 透明可回溯；少一次点击 | 误触成为真实困扰时改为填框待发 |
| 5 | `kb_write_resource` 只新建文本、拒覆盖 | resources/ 原始性不腐蚀；无误删面 | 二进制产出（图、表）成为真实需求 |
| 6 | 存量实体不迁移到新模板 | 零迁移风险 | 用户手工调教个别老实体即可 ——已由 ADR-0029 重开（逐实体人工触发形态：提炼的模板对照即逐实体迁移，不做批量） |

原因：

- **为什么边界仍在 tool 层而不是放开通用编辑器**：`str-replace-editor` 作用于实体 =
  放弃区段语义，模型全文自由写会冲掉人的排版与锚点结构；区段寻址既给了 agent 实质
  协作能力，又保住"状态可替换、流水只追加"的语义骨架。hard rule 2 的**精神**（无
  通用写能力）不变，变的是 kb 工具集的表达力。
- **为什么手势走消息管线而不是继续客户端拼接**：拼接形态下 SKILL.md 原文进了
  prompt 却不在 transcript 留痕为"一次调用"，审计与心智模型都别扭；`/name @path`
  是用户自己也会敲的形态，手势与手敲同构后，pre-step 一条管线服务两种入口，UI
  侧的序列化代码（取说明书 + 拼接）整体删除。
- **为什么状态归模板、流水归机制**：流水是审计性质——历史不可抵赖，任何实体都
  必须有，缺了是机制缺陷，由代码补齐；状态是定性结构——"这个实体现在怎么样"放在
  哪、要不要，属于主人对这类实体的定义，归模板。校验失败即弃用整个模板是"替主人
  做主"，与 `kb_write_resource` 拒覆盖的理由同源——所以只剩"流水重复"这一种机制
  无法自救的病理才回落内置。锚点按标题定位、与位置无关（splice.ts），补在文末即可
  工作，成本近零。
- **为什么模板是文件而不是代码分支**：个人工作台的模板注定被主人反复调教；写死在
  `templates.ts` 意味着每次调整改包发版。文件 + 内置回落与 sidecar/中央路由的双通道
  哲学（ADR-0025 落地注记三）同构：代码给兜底，KB 内声明优先。
- **为什么 `kb_write_resource` 拒覆盖而非自动改名**：静默改名让"告诉我一声"变成
  "替我做了主"；拒绝把决策交回会话里的人。

后果：

- `AGENTS.md` 硬规则 2 措辞修订：「八个 `kb_*` 工具」→「十个」（随实现同步）；
  "no generic write capability" 不变。
- ADR-0025 决定 4/5 加落地注记：客户端拼接序列化退役，手势统一走决定 3 管线。
- ADR-0010 加注记：区段级限制进一步放开为 `kb_edit_section`，流水铁律重申。
- 新增两个工具 → `pnpm run gen-cordis-catalog`、controller README、ADR 索引、
  `docs/yantao/TODO.md` 随实现同步。
- `packages/yantao/kb` 增量：模板文件读取 + 流水锚点机制保证（缺失补齐、重复回落）；
  splice 的区段定位从两个硬编码锚点泛化为任意 `## ` 区段（流水区在工具层拒绝写入）。
- 前端增量：RowMenu/CapabilityMenu/SelectionMenu 的派发改为合成 slash 消息；实体行
  右键菜单获得能力组；删除 capabilityRun 取说明书拼接路径（UI 侧）。
- 未做：frontmatter 写权限、二进制资源新建、模板占位符/引擎、存量实体迁移、手势
  消息填框待发模式。

落地注记（2026-09-16）：四条决定全部落地。决定 1：`buildEntityFile` 前置读
`<kbRoot>/.yantao/templates/<type>.md`（`templateBodyOf` 只取 frontmatter 之后的正文骨架），
正文缺 `## 流水` 自动补在末尾（含创建行），唯一回落条件是流水锚点重复；决定 2：拼接器
泛化为 `replaceSection`，`kb_edit_section` 落地为第九个 `kb_*` 工具（『流水』在拼接层拒绝
`log-append-only`，todo 单例与坏 frontmatter 照旧拒收），persona 的"状态区人类专属"按
实际能力重写；决定 3：`kb_write_resource` 落地为第十个工具（KB 相对路径必须以 `resources/`
开头，逐段 `sanitizeFileName`，撞名拒绝不覆盖不静默改名；资源树刷新走 ADR-0017 的
revision 轮询，零新增代码）；决定 4：三手势统一合成 `/name …` 用户消息
（`capabilityGestureMessage`：路径 → `/name @path`，多行选区包 `> ` 引用块），脚本型
照旧 `capabilityRun` → 提案卡，UI 侧 SKILL.md 拼接退役。验证：kb 150 + controller 155 +
ui-yantao 207 测试全绿，`tsc -b`、scoped oxlint、`verify-cordis-catalog` 通过。

复验追记（2026-09-16）：persona 的重写最初只落在部署默认一份，工作台会话朗读的预设拷贝
（`agent.cordis.yml`）仍念旧规则。按"单用户单部署"定位改为**单一来源**：预设不再携带人设行
（空组合，`[]`），会话落回部署默认——`packages/bundle/yantao/tests/persona.spec.ts` 门禁钉住
"预设无人设行 + 部署人设非空"。若将来把该预设挂到不加载 yantao bundle 的宿主，需在人设行
加回的同时把门禁翻回相等断言。
