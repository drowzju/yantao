---
status: accepted
---

# 提炼闭环 v2（提炼到实体与裁决协议 v2）

ADR-0029 落地了一条管线两个手势，但拿它真正整理知识库时暴露出四个同源缺口：(1) **入口反着**——归入要求人先知道资源属于谁，可「我有一份纪要/周报，不知道该放进哪个实体」才是常态，让人先回答「这份材料跟谁有关」恰恰免除了要问模型的那件事；(2) **裁决是单实体的**——一次提炼只能触碰一个实体，跨实体的 `[[双链]]` 只能内联在 `after` 正文里靠人眼核对，链接面板（ADR-0015）收不到结构化的行；(3) **模型有疑问只能瞎猜**——「纪要里的『飞书迁移』指哪个项目？」猜错了人就得多删，猜对了也说不清为什么；(4) **零命中没有出路**——资源值得留但花名册里没人承接，v1 只能给出一句「无关」。另有独立的一处：会议实体的内置骨架只有 `## 状态`，决议与待办无处安放。

本 ADR 给管线加上第三个手势——**提炼到实体 (Distill)**：一份资源对整个实体花名册的碰撞；并把裁决协议升级为 v2（多目标、可新建、可提问），同时把会议模板的窟窿补上。管线、卡、确认语义仍然是那一条——手势只是触发源，这条立场从 ADR-0029 原样继承。

事实基础（已核实）：ADR-0029 的管线只有两个手势，裁决是单实体的——裁决对象没有 `targets`，顶层 `edits/log` 直接绑到手势实体，`verdictToProposal` 里没有 creates；applier 按动作顺序执行，但对「本卡新建的实体」无感知——邮件分析的做法是提前用 `entities.files.find` 按名字解析路径，解析不到就留空、apply 时报 miss，「先建后写」无路可走；`create-link` 动作已在（状态区插一行，反向链接由 ADR-0015 的 `links(path)` 宿主解析自动出现）；会议类型的内置骨架只有 `## 状态`（宿主 `builtinEntityBody`，客户端 `BUILTIN_BODIES` 镜像由测试保持同步）；ADR-0026 的模板读法（用户模板优先、内置回落）与「状态以模板为主」已生效；`kb_read_resource` 的 32k 截断与 NUL 二进制判定（错误码 `yantao-kb/binary`）是 ADR-0028 现状；资源树的目录行已按 `file.path` 前缀分组渲染（ADR-0028），目录下文件清单由 `resources` 区段的树状数据携带，右键手势没有技术障碍。

决定：

1. **第三个手势：提炼到实体（distill）**。资源行右键「提炼到实体」、目录行右键同款（目录 = 对其下每个文件各发一个 distill 手势）；实体行的「提炼」（refine）不变，资源行不设单向「提炼」。distill 把管线倒过来：不再是「资源对着一个实体」，而是「一份资源对着整个花名册」——花名册由左右两棵实体树现算（`meetings→meeting`、`areas→area`、`people→person`、`projects→project` 四个区段映射；resources/todos 不参与），每个实体带当前内容注入。会话命名「提炼 <资源名>」。**目录提炼是逐文件独立会话、UI 串行排队**，不做合并裁决（台账 #5）。
2. **裁决协议 v2**：`{ relevant, reason, targets[], creates[], questions[] }`。`targets[]` 每条 `{ entity, edits[], links[], log }`，entity 必须用花名册名字原文；`creates[]` 每条 `{ entityType, name, why, edits[], links[], log }`；`questions[]` 每条 `{ question, why }`。**旧形状兼容**：模型沿 v1 单实体形状回答（顶层 edits/log）仍被解析，绑定为一条无名 target（落到手势自己的实体）——协议升级不撕毁旧回答习惯。**空行一律丢弃**（宁可少，不可错）：没有 edits/links/log 的 target、entityType 或名字非法的 create、没有正文的提问。distill 的提示词钉死 `relevant` 恒为 true——提炼不判相关性（台账 #1）。
3. **creates 先行，create-follows-create**。`verdictToProposal` 先展开 creates 再展开 targets；追随 create 的动作（`edit-section`/`create-link`/`append-log`）带 `afterCreate: <create 名>`，applier 边跑边把新建实体的路径记进 `created` 映射按名字解析——create 行未被勾选或执行失败，追随行整行跳过。勾选粒度不变：create 与它的追随行各自可见、各自勾选。
4. **双链成为结构化行**。targets/creates 的 `links[]` 逐条变成 `create-link` 动作行——卡上有独立分组、单独勾选、单独失败标红；`after` 正文里的内联 `[[…]]` 照旧允许。`to` 由提示词约束为花名册名字原文或 creates 里的新实体名。
5. **questions 两段式**。带 questions 的裁决**不提议任何东西**——run 暂停，Frame 弹 QuestionDialog（问题 + why 提示、逐题作答、可放弃）；提交后答案经 `answersPrompt` 送回**同一个会话**再走一轮 `jsonRound` 拿最终裁决；**至多一轮提问**——第二轮裁决即使再带 questions 也被丢弃（台账 #3）。放弃 = 本次提炼结束，无卡无写入。提示词约束：提问至多三个，且提问时 targets/creates 必须为空。
6. **体积防线**：资源沿用 ADR-0028 的 32k 截断与二进制占位（`yantao-kb/binary` → 显式占位「只凭文件名与路径判断」）；花名册实体每个 8k 截断（`ENTITY_CLIP`）——花名册整体注入，大库不能炸提示词（台账 #2）。二进制不转码不摘要的立场（ADR-0029 台账 #3）不变。
7. **UI：串行手势队列**。Frame 维护提炼手势队列，严格逐个执行——下一个手势在前一个的**人类终点**（卡确认/卡取消/对话框提交完成/放弃/无关 toast/失败）之后才开始；裁决带问题时队列闸门保持扣住，直到对话框有了结局。目录提炼把多个手势入队，一次只见一张卡或一个对话框。
8. **会议模板内置骨架改为 `## 状态` + `## 决议` + `## 待办`**。修在内置骨架（宿主与客户端镜像两处，测试保持同步）而非用户模板文件——版本化、可测、立即生效；ADR-0026 的读取顺序不变（用户模板仍优先），写过自有骨架的存量库不受影响。「状态以模板为主、流水由机制保证」的立场不破。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | distill 不判相关性（relevant 恒 true） | 一份资源对整个花名册的全面裁决，不因「看起来不搭」漏掉冷门实体 | 花名册大到裁决质量下降时引入预筛 |
| 2 | 花名册整体注入、每实体 8k 截断 | 无需检索/嵌入，行为完全可预测 | 库大到 8k 截断伤判断时做检索式花名册 |
| 3 | 提问至多一轮，第二轮问题直接丢弃 | 交互深度有限，人不会被卷进问答循环 | 多轮澄清成为真实需求时做有界多轮 |
| 4 | 名字解析不到的 target 行丢弃，不猜文件名 | 模型拿到了名字原文，猜路径比漏一行更危险 | 无——这是立场不是缺陷 |
| 5 | 目录提炼 = 每文件一个独立会话串行排队 | 一文件一卡一裁决，人逐个确认，失败互不牵连 | 「一批文件合并成一次裁决」成为真实需求时再设计 |
| 6 | 会议模板修在内置骨架而非用户模板文件 | 版本化、可测、立即生效；用户模板优先级不破 | 想自定义会议骨架时写 `<kbRoot>/.dsh/yantao/templates/meeting.md` 即可 |
| 7 | 空文件（剥掉 frontmatter 与标题行后无正文）直接跳过，不进裁决 | 扫目录时不为一个空壳文件烧一次模型轮；队列照常前进 | 「标题本身也是信息」的场景出现时改为照常送审 |

原因：

- **为什么 distill 而不是让人先找实体**：信息组织的入口应该长在信息上。「这份材料跟谁有关」正是要交给模型判断的那个问题；让人先把它回答了，提炼就只剩誊写。资源行与目录行是「我手上有一堆东西」这个心智的自然落点。
- **为什么协议升级带着兼容垫片**：模型偶尔沿旧形状回答，解析层兜住比弹「无法解析」重问一轮便宜；垫片把顶层 edits/log 绑定为无名 target，之后的行为与 v1 完全一致，没有第二条语义。
- **为什么 creates 先行**：追随行的路径要在 create 落地后才知道，顺序执行 + `created` 映射是最短的正确做法；不引入两阶段提交，也不预生成路径（撞名处理是 controller 的事）。
- **为什么一轮提问封顶**：提问轮是人机交互里最贵的一段——人在等。一轮足以解决指代不明；无限轮会把工作台变成问卷。第二轮的问题丢弃而不是再问，是为了让「终点」永远可达。
- **为什么目录不合一次裁决**：十份文件的相关性判断混进一个裁决，卡的规模与失败的爆炸半径都失控；逐文件会话还天然留下可回读的独立痕迹，与「会话保留供回读」的既有立场同构。
- **为什么会议模板修在内置骨架**：模板文件是用户数据（KB 根下，不在仓库），改它既不入版本库也无法对其他库生效；内置骨架是代码，有测试看着。用户已有模板的优先级不受影响——这正是 ADR-0026 设计的分层。

后果：

- `packages/client/ui-yantao` 增量：`refine.ts` 重写（v2 协议、distill 提示词、花名册注入、questions 续答）；`proposal.ts` 三类动作增 `afterCreate`；`proposal-apply.ts` 增 `created` 映射与追随行跳过；`Workbench.tsx` 增 `DirMenu`、`useMenuDismiss`、资源行「提炼到实体」；`frame/Frame.tsx` 增串行队列、QuestionDialog 挂载、花名册现算；新增 `QuestionDialog.tsx`；locales 增六对词条。
- `packages/yantao/kb/src/templates.ts`：meeting 内置骨架增 `## 决议`、`## 待办`。
- **零新工具、零新 RPC**：`kb_*` 保持十一、`yantaoKb` RPC 保持二十一；controller README 与 `gen-cordis-catalog` 不漂移；AGENTS.md 硬规则 2 不动。
- 文档同步：`docs/yantao/README.md` ADR 索引（本条）、`docs/yantao/TODO.md` done 行、`packages/yantao/CONTEXT.md` 增「提炼到实体 (Distill)」词条。
- 未做：合并裁决的目录提炼、多轮澄清、双链的反向建议（backlink 面板已有展示）、distill 的预筛、资源行单向「提炼」。

落地注记（2026-09-21）：全部落地，分四批提交。批次 1 会议模板（56c2b1ca41）：`templates.ts` 的 meeting 骨架改为 `## 状态` + `## 决议` + `## 待办`，客户端 `BUILTIN_BODIES` 镜像同步，同步由既有镜像测试看住。批次 2 协议 v2（bfe162f679）：`refine.ts` 全量重写（`RefineVerdict` v2、旧形状兼容绑定无名 target、空行丢弃、distill 提示词与花名册注入、`continueWithAnswers` 同会话续答且第二轮问题丢弃），`verdictToProposal` creates 先行 + `afterCreate`，`proposal-apply.ts` 增 `created` 映射与追随行跳过——refine 36 测试 + proposal-apply 22 测试。批次 3 UI（a5ffc4c122）：`QuestionDialog.tsx` 新增，`Workbench.tsx` 增 `useMenuDismiss`/`DirMenu`/资源行「提炼到实体」（目录手势对其下每个文件各发一个 distill），`Frame.tsx` 增串行手势队列（闸门只在人类终点释放）与花名册现算（`rosterOfTrees`，两树并集 × 四区段映射）——workbench 86 测试。验证：ui-yantao 280 测试全绿（14 文件），`tsc --noEmit` 干净，scoped oxlint 0/0。零新工具、零新 RPC。

落地注记二（2026-09-21，用户验收反馈）：**空文件跳过（台账 #7）**。distill 手势读到资源正文为空——剥掉 frontmatter 与标题行（`isEmptyBody`）后什么都不剩——时在建会话之前直接返回 `skippedEmpty: true` 的 run，不烧模型轮；Frame 收到后 toast「是空文件（只有标题），已跳过。」并放行队列。二进制占位不算空（照常送审，凭文件名判断）。动机：扫目录提炼时一个只有标题的空壳笔记不该花一次会话裁决。验证：ui-yantao 285 测试全绿（refine 40 + workbench 87，新增 isEmptyBody 2 + runRefine 2 + Frame 队列跳过 1），`tsc --noEmit` 干净，scoped oxlint 0/0，client bundle 重建。

落地注记三（2026-09-21，用户验收反馈）：**人的进展落「近期工作动态」**。用户的 person 用户模板（`<kbRoot>/.dsh/yantao/templates/person.md`）自带该区段、实体里已在使用，故内置骨架不动（模板优先的分层不破）；约定写进 distill 提示词——资源里的工作进展涉及相关「人」时，给该人一个 targets 条目，在其「近期工作动态」小节追加一行带日期的简述（既有内容保留、区段缺失确认后新建），与进展无关的人不动；洞见落点规则同步补「person 的近况用 近期工作动态」，creates 的 person 常用小节同步列出。机制零改动——`edit-section` 的既有语义（保留正文、缺区段补建、落盘重读重定位）恰好承载「追加简述」。验证：refine 40 测试全绿（提示词断言 +2），`tsc --noEmit` 干净，scoped oxlint 0/0，client bundle 重建。
