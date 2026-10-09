---
description: "yantaoKb Typert Remote 控制器：工作台 UI 直连知识库的通道（限制在 kbRoot 内的 tree/read/write），面向 yantao-web 表层的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-yantao-kb-controller

## 概述

`dsh-api-yantao-kb-controller` 是 yantao 工作台 UI 背后的 Typert Remote 控制器：`yantaoKb` 命名空间下的四十五个一元方法——`intakeTree`、`workspaceTree`、`read`、`readResourceView`、`readResourceBinary`、`write`、`deleteResource`、`archiveEntity`、`restoreEntity`、`setRelation`、`root`、`setRoot`、`createEntity`、`links`、`graph`、`relationGraph`、`revision`、`openExternal`、`todos`、`writeTodos`、`mailMarkRead`、`mailRun`、`registerResource`、`promptInjection`、`promptShortcutList`、`promptShortcutSave`、`scheduleList`、`scheduleSave`、`scheduleMark`、`proposalInboxList`、`proposalInboxEnqueue`、`proposalInboxResolve`、`skillRewriteApply`、`capabilityList`、`capabilityCreate`、`capabilityAdopt`、`capabilityRegister`、`capabilityRouteUpdate`、`capabilityUnregister`、`memoryList`、`memoryAdd`、`memoryDelete`、`memoryProposalList`、`memoryProposalApprove`、`memoryProposalDiscard`——让浏览器直接列出、编辑与扩充知识库。所有路径都是知识库相对路径，并被限制在 `yantao-kb` 插件以 `yantaoKb` 服务发布的 kbRoot 之内，因此控制器共享插件的唯一配置点，绝不重复配置；`setRoot` 则重新指向这个唯一的根目录。UI 是人类通道，所以 `write` 是整文件写入；ADR-0004 信任边界只约束 agent 的 `kb_` 工具，从不约束本表面。

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

`yantao-web` profile 会自动挂载本控制器；工作台 UI 通过 [`dsh-api-remotes`](../remotes/README.zh.md) 组装消费它。

### 命名空间

| 方法 | 签名 | 结果 |
|---|---|---|
| `yantaoKb.intakeTree` | `()` | 收集侧的小节（`resources`、`todos`）；资源按普通文件列出——原件保留文件名的后缀，因此 `周报.eml` 与 `周报.eml.md` 不会被看成同一个东西；递归含子目录（`kb_write_resource` 写进子目录的文件也会出现），嵌套文件的显示名带相对 `resources/` 的目录前缀，伴生笔记配对仍在同一目录内 |
| `yantaoKb.workspaceTree` | `()` | 工作侧的小节（`projects`、`areas`、`people`、`meetings`）；实体行额外携带 `archived`，人物行还有 `relation` 与 `email` |
| `yantaoKb.read` | `(path)` | `{ path, content }`——文件完整 UTF-8 内容 |
| `yantaoKb.write` | `(path, content)` | `{ path }`——整文件写入，自动创建缺失的父目录 |
| `yantaoKb.archiveEntity` | `(locator)` | `{ path, archived }`——归档一个实体：frontmatter 置 `archive: true` 并在「流水」追加一条「归档」（ADR-0041 决定 6/10）；幂等，重复归档不写盘；实体永不删除，工作台没有删除入口（决定 8） |
| `yantaoKb.restoreEntity` | `(locator)` | `{ path, archived }`——还原一个归档实体：去掉 frontmatter 标志并在「流水」追加一条「还原」；同样幂等 |
| `yantaoKb.setRelation` | `({ path, relation })` | `{ path, relation }`——改写人物实体 frontmatter 里的 `relation`，文件其余部分逐字节保持原样 |
| `yantaoKb.root` | `()` | `{ root, configured }`——当前生效的知识库根目录，以及人类是否已经选过 |
| `yantaoKb.setRoot` | `(path)` | `{ root, configured, created, existing }`——把 `path` 初始化为知识库、设为当前根目录并记住它 |
| `yantaoKb.createEntity` | `({ type, name, date?, relation?, email?, source? })` | `{ path }`——按 canonical 模板创建一个实体笔记；`source` 只对读书项目有意义（ADR-0020） |
| `yantaoKb.links` | `(path)` | `{ outgoing, incoming }`——该文件的 `[[双链]]` 图，在宿主侧解析，且绝不指向 `resources/`（ADR-0015） |
| `yantaoKb.graph` | `()` | `{ nodes, edges }`——全库 `[[双链]]` 图一次拿全：nodes 为全部实体路径，edges 每条 `{ from, target, to }`（`to` 为 null 即失链；自链丢弃）；实体校验手势的确定性预扫吃它（ADR-0035） |
| `yantaoKb.relationGraph` | `()` | `{ nodes, edges }`——全库带类型的关系图（ADR-0049）：只收图谱页签画的三种关系（person-project、area-project、person-person），双向采集并规范化去重，领域-项目并读项目 frontmatter 的 `areas` 列表；触及会议、待办、归档实体或失链目标的边一概不出现 |
| `yantaoKb.revision` | `()` | `{ root, revision }`——知识库根目录下任何文件变动就自增的计数器，随 `setRoot` 重建（ADR-0017） |
| `yantaoKb.openExternal` | `(target)` | `{ target }`——把知识库内路径或白名单协议的 URL 交给系统打开，拒绝 shell 元字符（ADR-0017） |
| `yantaoKb.todos` | `()` | `{ path, text, items }`——`entities/todos.md` 单例解析出的结构化条目，外加文件原文（ADR-0018） |
| `yantaoKb.writeTodos` | `({ items, expectedText })` | `{ path, text }`——替换单例的条目，保留 preamble（ADR-0018） |
| `yantaoKb.mailMarkRead` | `({ lastReadAt?, firstReadAt? })` | `{ lastReadAt, firstReadAt? }`——把邮件能力的断点往前推，并把最早的 `firstReadAt` 记为已处理范围的起点；`lastReadAt` 缺省为当前时刻（ADR-0019） |
| `yantaoKb.registerResource` | `({ name, contentBase64 })` | `{ resource }`——把一个拖入的文件逐字节复制进 `resources/`，清理文件名并拒绝重复；旁边不生成任何笔记（ADR-0020） |
| `yantaoKb.mailRun` | `({ input? }, signal?)` | `{ name, runAt, result?, content?, memory?, artifacts, exec }`——邮件能力的专用 RPC（ADR-0052 决定 5）：执行统一后信封子进程机器仅存的角色，替人类通道驱动 `mail` 这一个能力（能力名不是参数）；一次 Python 子进程、stdin/stdout 走 JSON 信封，产物写入 `.dsh/yantao/capabilities/mail/`，状态记到 `<kbRoot>/.dsh/yantao/state.json`（ADR-0024）；`signal` 中止杀子进程并以 `cancelled` 类失败拒绝（ADR-0031）；结果附 `memory`（能力作用域行为记忆，ADR-0032）与 `exec` 运行信封（提炼经验的矿藏，ADR-0044 决定 6）。通用能力执行已退役：指令能力的运行就是读 SKILL.md 正文（`/` 手势注入与 agent 的 `kb_run_capability`，共用私有 `runInstructions` 缝），脚本步骤走 agent 的 `kb_exec_capability_script`（ADR-0052 决定 3） |
| `yantaoKb.capabilityList` | `()` | `{ capabilities, unregistered }`——知识库根目录下每个声明了能力清单的技能，每行合并它的持久化记录（`lastRunAt`、`state`），被中央路由文件认领的技能也以能力行出现（描述读自其 SKILL.md，ADR-0025 落地注记三），外加 `unregistered` 分组：KB 外可采纳进知识库的技能目录、KB 内尚未被路由的技能（灰显行携带 `inKb` 与原因），以及投放进来的插件仓库（顶层无 SKILL.md 但有内嵌 `skills/<child>/SKILL.md`——行携带 `plugin: true` 与 `pluginSkills` 清单；注册时在中央路由文件为每个内含技能各写一条路由）（ADR-0025 决定 1）；内置能力会先被播种进 `<kbRoot>/.dsh/skills/`（ADR-0021） |
| `yantaoKb.capabilityCreate` | `({ name })` | `{ path }`——在 `.dsh/skills/<name>/` 脚手架出一个干净的 SKILL.md（正文自带「给 agent 的指令」段落，教 agent 用 `kb_exec_capability_script` 跑脚本步骤、产出落 `resources/`），并在中央路由文件写一条 `invocation: ['human']` 的路由；第一次运行就能工作的能力（ADR-0021 决定 8；ADR-0052 后不再脚手架 sidecar 与入口脚本——执行形态由 SKILL.md 指令本身表达） |
| `yantaoKb.capabilityAdopt` | `({ name })` | `{ path }`——把一个 KB 外的技能目录拷贝进 `.dsh/skills/<name>/`（永远是拷贝不是移动），并在中央路由文件 `.dsh/skills/yantao.json` 写一条 `invocation: ['human']` 的路由（ADR-0025 落地注记三）；源目录自带的 `yantao.json` 随行但惰性——sidecar 已不是声明通道，没有任何东西读它（ADR-0052）；拒绝已存在的目标、`user-invocable: false` 的技能，以及一切不是「带 SKILL.md 的扁平目录束」的东西 |
| `yantaoKb.capabilityRegister` | `({ name, agentInvoke?, resourceMenu?, selectionMenu? })` | `{ path }`——把一个技能注册成能力：在中央路由文件 `<kbRoot>/.dsh/skills/yantao.json` 写入一条路由（`{path, invocation, appliesTo?}`），**不移动、不改名、不拷贝任何目录**；KB 内技能写 `path: <名>`，投放的插件仓库（顶层无 SKILL.md、内嵌 `skills/<child>/SKILL.md`）为每个内含技能各写 `path: <repo>/skills/<child>`——仓库原地保留；三个布尔是对话框收集的 reach——`agentInvoke` 把 `invocation` 写成 `['human','agent']`，`resourceMenu`/`selectionMenu` 分别写 `appliesTo.resource: true`（所有资源）/ `appliesTo.selection: true`；拒绝已是能力的技能、`user-invocable: false` 的技能与扁平单文件技能；重复注册覆盖旧路由条目（幂等）（ADR-0025 决定 1、落地注记三；ADR-0052 后路由是唯一配置，无 sidecar 可言） |
| `yantaoKb.memoryList` | `()` | `{ groups }`——`.dsh/yantao/memory/` 下每个有文件的记忆作用域（`global.md` 在前，能力作用域名排序），每组携带文件原文与解析出的条目（ADR-0032） |
| `yantaoKb.memoryAdd` | `({ scope, text })` | `{ path, entry }`——往作用域的 markdown 文件追加一条带日期戳的 `- ` 条目，文件缺失则先建（含标题）；内容为空或该作用域已记得同文时拒绝（ADR-0032） |
| `yantaoKb.memoryDelete` | `({ scope, id })` | `{ path }`——按 id 删除一条记忆；id 过期（人行间编辑过）报 `not-found`，调用方刷新而不是猜测（ADR-0032） |

`setRelation` 只对人物文件作答：其它文件一律 `yantao-kb/rejected` 且不被改写，五种关系之外的取值同样拒绝。它是对 frontmatter 的一行拼接，绝不重排 YAML——重新生成映射会丢掉人类写的注释与顺序。

`setRoot` 只接受绝对路径（相对或空路径会被拒绝），并把它交给 `yantaoKb` 服务——服务负责把选择持久化到 settings plane，即 `~/.dsh/settings.yaml` 的 `yantao-kb` 命名空间（ADR-0024 决定 3）。`createEntity` 接受 `project`、`area`、`person`、`meeting`；会议文件名会冠以它自己的日期。人物实体会写入调用方给出的 `relation`——`self` / `subordinate` / `superior` / `peer` / `external`，即 kb 领域自己的五种关系；调用方不指定时，沿用领域自己的缺省值。还可以给出可选的 `email`，工作树会把它读回来，供邮件分析把发件人匹配到人员。

`todos` / `writeTodos`（ADR-0018）是编辑 `entities/todos.md` 单例的结构化方式——这一对方法存在的原因是 Client **不能** import kb 包的解析器（bundle purity）。`todos` 把缺失的文件报成 `text: ''` 与空条目，而不是报错；`writeTodos` 拿 `expectedText` 与磁盘上的当前文本比对，不一致就是 `yantao-kb/rejected`——于是工作台之外的修改会被刷新，绝不会被覆盖。文件的 preamble（清单上方人类写的标题）原样保留，只替换条目。

`mailMarkRead`（ADR-0019）是第一个连接器的 RPC 表面剩下的那一半：断点写入。读邮件这件事搬进了 `mail` 能力（ADR-0021）——它的结果携带与从前 `mailFetch` 相同的边界、`stale` 与 `hasMore` 簿记——但推进断点是批准时的动作，所以它仍是一个普通 RPC，落在 `writeMailWatermark` 上。这一批里最旧的一封作为 `firstReadAt` 一并带来，并按历史最小值保留，面板因此能直接从能力的持久化状态里显示出已处理范围（如 2025-12-31 到 2026-01-31）。它要求先选过知识库目录，因为断点就记在它旁边。

`registerResource`（ADR-0020）是拖拽摄入：浏览器把文件的完整内容 base64 编码后发来，宿主把它原样复制进 `resources/`——与 agent 的 `kb_register_resource` 相同的清理并拒绝重复语义，只是不接受绝对路径输入。（ADR-0021 在此播种的 `ebook` 抽取能力已于 2026-09-14 随读书项目流程一并退役——见 ADR-0020 落地注记；残留的已播种副本会在播种时先备份到 `.dsh/yantao/capability-backups/` 再移除。）

`mailRun`（ADR-0021 起、ADR-0052 决定 5 收窄成型）是执行统一后信封子进程机器仅存的那个角色：邮件能力的专用 RPC。能力曾经是一条泛化的「宿主 spawn 一个会说话的脚本」通道——sidecar 或 frontmatter 声明入口、控制器代写产物、状态持久化——ADR-0052 把它整编掉：`kb_run_capability` 只回答 SKILL.md 正文（私有 `runInstructions` 缝，`/` 手势注入与 agent 工具共用），脚本步骤由 agent 经 `kb_exec_capability_script` 自己执行，而 mail 作为唯一还需要子进程的能力拿到了这条专用 RPC——能力名不是参数，它只服务 `mail`。一次 Python 子进程、stdin 进一个 JSON 对象（`name`/`kbRoot`/`input`/`state`/`channel`）、stdout 出一个 JSON 对应答；产物由控制器写入，状态持久化为下一次运行的起点。运行结果携带可选的 `memory` 字段——该能力作用域的行为记忆（`<kbRoot>/.dsh/yantao/memory/capabilities/<名>.md`，人在以往运行中批准沉淀的规则），渲染成一段「本次运行遵守」的提示块随结果返回；作用域没有规则时字段缺省，记忆读取失败不阻断运行。`AbortSignal` 尾参中止杀子进程（ADR-0031）。`tool-skill` 保持禁用，模型永远看不到裸技能目录；agent 能运行什么，由中央路由条目的 `invocation` 决定（ADR-0052 决定 1）。

`capabilityList` / `capabilityCreate`（ADR-0021 决定 8）是「能力」页签的管理半边。`capabilityList` 先把内置能力播种进知识库（缺失才复制、按版本覆盖，让脚本的修复真正到达 KB），再列出中央路由文件认领的每个技能——未路由的普通技能被跳过而不是报错——并与各自的持久化记录合并。安装一个能力没有 RPC：人把能力目录拷进 `<kbRoot>/.dsh/skills/`（或任何其他 skill 根目录），再注册一条路由即接入。`capabilityCreate` 在知识库内脚手架一个新能力——一个 SKILL.md 加一条人类路由；ADR-0052 后指令本身就是执行形态，不再脚手架 sidecar 与入口脚本。`capabilityRegister`（ADR-0025 决定 1、落地注记三）为已经在 KB 内的技能补上闭环：拷进来的开源 skill 目录若还没被路由，不再是无声的不可见——它会带着原因出现在未注册分组里，注册就是在中央路由文件 `.dsh/skills/yantao.json` 写入一条路由条目（reach 来自对话框的三个勾选），技能目录原地保留——不移动、不改名。投放的插件仓库（Claude 插件市场形态）不再被提取：每个内嵌的 `skills/<child>/` 技能各得一条 `path: <repo>/skills/<child>` 的路由，仓库目录一个字节不动。

`memoryList` / `memoryAdd` / `memoryDelete`（ADR-0032）是记忆系统的存储半边：记忆是影响 agent 行为方式的规则与偏好，一行一条地住在 `<kbRoot>/.dsh/yantao/memory/` 下的 markdown 里（`global.md` 是全局作用域，`capabilities/<名>.md` 是能力作用域；注入侧由批次②接线）。`memoryAdd` 是人类通道的写入——提案卡的 `add-memory` 行经它落盘；同文已存在即拒绝，让调用方把已记得的展示给人看而不是写重。`memoryDelete` 是唯一的删除通道（agent 没有删除记忆的工具），按 `memoryList` 报告的 id 寻址；人行间编辑会让 id 过期，此时报 `not-found` 请调用方刷新。三个方法都要求先选过知识库目录——记忆就存在它旁边。

失败是 `RemoteError`：路径没有对应文件时为 `yantao-kb/not-found`；路径逃逸、目标不是文件、I/O 拒绝或知识库领域拒绝（实体已存在、`todo` 单例）时为 `yantao-kb/rejected`——两者的 `details` 都携带出问题的 `path`；断点写入失败时为 `yantao-kb/mail`，`details` 带失败种类 `kind` 与 `hint`。`yantao-kb/capability` 是能力对应物（`not-found` / `not-invocable` / `bad-manifest` / `python-missing` / `timeout` / `bad-output` / `capability-failed`），能力自己的失败 `kind` 与补救 `hint` 也一并放在 `details` 里；`not-invocable`（ADR-0023）指 agent 调用了路由未声明 `"agent"` 的能力。

### Client 消费

调用方插件在 `inject` 中同时声明 `remote` 与 `remote.yantaoKb`，然后直接写 `ctx.remote.yantaoKb.intakeTree()` / `ctx.remote.yantaoKb.workspaceTree()`；结果是 `RemoteResult<T>`，就地用 `if (!result.ok)` 分支。见 [Remote API 手册](../../../docs/cookbook/adding-a-remote-api.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

控制器是一个 `TypertRemoteService`，`static inject = ['yantaoKb', 'skills', 'tools']`：只有当 `yantao-kb` 插件发布了解析后的 KB 根目录（且技能注册表已挂载，能力解析与播种才能进行）它才激活，在每次调用时读取该根目录，并通过注入的工具层注册 `kb_run_capability` 工具与 pre-step 目录监听（ADR-0023）。路径限制复用 kb 包的 `resolveWithinKb`（逃逸尝试在边界被归类为 `yantao-kb/rejected`），两棵树的实体节复用 `listEntities`，因此 wire 视图与 agent 的工具以同样方式读同样的文件。`resources/` 与 `sessions/` 节是每次调用都重新读取的目录——UI 永远看到人类刚写入的内容。`write` 不做 frontmatter 校验：人类拥有文件结构，agent 的工具会在下次读取时重新校验。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 控制器：服务声明、路径限制与 RPC 方法 |
| [`src/capability/builtin.ts`](src/capability/builtin.ts) | 内置能力目录的播种器（ADR-0021）：缺失才复制、按版本覆盖，落进 `<kbRoot>/.dsh/skills/`；版本升级覆盖前先备份漂移的副本（ADR-0023 决定 7） |
| [`src/capability/builtin/`](src/capability/builtin/) | `mail` 能力的母本：SKILL.md + `scripts/`（即 `mailRun` 专用 RPC 驱动的那个 Python 子进程；sidecar 已随 ADR-0052 废除） |
| [`src/capability/run.ts`](src/capability/run.ts) | 信封子进程机器（ADR-0021）：ADR-0052 执行统一后仅存的角色是 `mailRun` 专用 RPC 的 spawn 契约；共享词汇同住于此——`CapabilityError{kind,message,hint}`、路由校验用的 reach 类型、`CapabilityExec` 运行信封（ADR-0044 决定 6） |
| [`src/capability/routing.ts`](src/capability/routing.ts) | 中央路由文件（ADR-0025 落地注记三；ADR-0052 决定 1 升格为唯一能力配置）：`.dsh/skills/yantao.json` 的读取/校验/追加写入（version 1，条目纯可达性 `{path, invocation, appliesTo?}`，path 相对技能根且禁逃逸）、路由技能的 SKILL.md 读取 |
| [`src/types.ts`](src/types.ts) | wire 载荷词汇（树节、文件行、读写结果） |
| — | 不发布运行时不变量伴生包；控制器是无状态适配器，其限制与树形契约由包内单元测试覆盖。 |
| [`tests/controller.spec.ts`](tests/controller.spec.ts) | 基于真实临时目录的树形、读写往返、root/setRoot/createEntity、not-found 归类与逃逸拒绝覆盖 |
| [`tests/intake-rpc.spec.ts`](tests/intake-rpc.spec.ts) | 摄入 RPC 基于真实临时目录的覆盖：base64 往返、重复拒绝 |
| [`tests/capability-rpc.spec.ts`](tests/capability-rpc.spec.ts) | 能力 RPC 基于假注册表与被 mock 的运行器：no-root/not-found/bad-manifest 拒绝、产物写盘、状态往返、列表合并、中央路由注册（含插件仓库逐子技能路由）、采纳、路由更新与注销、指令能力作答、路由唯一信源 |
| [`tests/capability-tool.spec.ts`](tests/capability-tool.spec.ts) | `kb_run_capability` 工具与 pre-step 目录（ADR-0023）：注册、agent 门（含路由能力）、SKILL.md 正文作答、目录注入（含路由追加），基于假注册表 |
| [`tests/capability-builtin.spec.ts`](tests/capability-builtin.spec.ts) | 播种器基于真实临时目录的覆盖：全新播种、已最新则不动、按版本覆盖、保留人类更新的新版本、漂移备份、不再随船的能力的无损退役 |

### 不变量归属

不发布不变量伴生包，因为控制器不持有进程内的可变关系：每次调用都重新读取文件系统，其限制与树形契约由单元测试直接检验。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解拥有知识库的插件或挂载本控制器的表层时，阅读这些页面。

- [dsh-yantao-kb](../../yantao/kb/README.md)——本控制器共享其根目录与操作的 KB 领域插件。
- [dsh-yantao-web-app](../../bundle/yantao-web-app/README.md)——挂载本控制器的 bundle。
- [dsh-client-ui-yantao](../../client/ui-yantao/README.md)——消费本命名空间的工作台 UI。
- [Remote API 手册](../../../docs/cookbook/adding-a-remote-api.zh.md)——本包遵循的五步契约。
- [dsh-api-remotes](../remotes/README.zh.md)——挂载本贡献的 Client 组装。

-----

<a id="model-experience"></a>
## 模型体验

### 工具与提示侧效果

#### 模型看到什么

`kb_run_capability` 工具：模型从每轮注入的目录里点名一个能力，可附自由 JSON `input`；被路由能力以其 SKILL.md 正文作答（`content`）供模型照办，脚本步骤由模型经 `kb_exec_capability_script` 自己执行（ADR-0052 决定 3）。路由未声明 `"agent"` 的能力一律 `not-invocable`，附中文补救提示。每个用户提示的步骤，`agent/pre-step` 监听器追加一条目录消息，按中央路由文件重新推导列出对 agent 开放的能力。

#### Token 影响

一个工具的固定模式开销，外加每次调用一条紧凑结果；答案就是能力的 SKILL.md 正文，上界只在该文档本身。目录消息在每个用户提示的回合为每个 agent 可调用能力增加一行短条目。

#### KV Cache 影响

目录消息挂在用户提示步骤的消息末尾，因此进入该轮请求的后缀，并在同一轮链的后续请求中留在前缀里；只要 agent 可调用集合变化，其文本随之变化，缓存前缀从该点失效。没有任何 agent 可调用能力时不注入任何内容，前缀不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本控制器刻意不做的事。它们是本包当前的约束，不是任务清单。

- **变更检测是轮询,不是推送**——`revision()` 公开一个计数器供 UI 轮询(ADR-0017);两条侧栏本身仍在操作手势与自身写入后刷新,因此人类的外部修改在下一次轮询时可见,而非实时。
- **写入不做 frontmatter 校验**——人类通道拥有文件结构；实体文件不合法时由 agent 的工具在下次读取报告，而非本表面。
- **只有整文件写入**——没有小节级编辑；人类编辑完整文本（agent 的只追加通道在 kb_ 工具侧，不在本表面）。
- **二进制资源按 UTF-8 文本提供**——对非文本原件调用 `read` 会得到替换字符内容；编辑器把原件标记为只读而不是解码它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

RPC 表落后于实现：`readResourceView`、`readResourceBinary`、`deleteResource`、`promptInjection`、`promptShortcutList/Save`、`scheduleList/Save/Mark`、`proposalInboxList/Enqueue/Resolve`、`memoryProposalList/Approve/Discard`、`skillRewriteApply`、`capabilityRouteUpdate`、`capabilityUnregister` 尚无表格行（语义权威在各自主 ADR）。逐行补齐属独立的文档任务，2026-10-09 文档收尾批只同步了能力面（ADR-0052 单信源现实）。

</details>
