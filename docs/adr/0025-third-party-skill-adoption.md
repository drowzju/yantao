---
status: accepted
---

# 三方技能接入（采纳、`/xxx`、资源右键、选区右键）

ADR-0023 决定 6 给上游开源 skill 生态开了 agent 侧的门（指令型能力），但人的通道缺三块：
无 sidecar 的技能在能力面板不可见；`/xxx` 手势不工作（`tool-skill` 在 yantao 禁用，是
ADR-0023 决定 4 的既定状态）；资源右键和选区右键没有指令型能力的语义。本 ADR 补齐人的
通道。地基是 ADR-0024 的两条结论：技能单一来源（只认 `<kbRoot>/.dsh/skills/`）、
采纳 = 拷贝进 KB。

事实基础（已核实）：发现机制免费（`skill-filesystem` 发现 + chokidar 热监听，frontmatter
必填 `name`/`description`）；`RowMenu` 的能力组已按 `appliesTo.resource` 后缀过滤，零 UI
代码获得右键菜单项；input-trigger 按 `(trigger, name)` 键合，`/` 上可与 ui-commands 的
命令源共存；controller 已能从 `resourceBase` 拿到每个技能的目录路径。

决定：

1. **采纳机制**。能力面板新增「未注册」分组：无 sidecar 的**目录束**技能（名字母序、
   不设上限、排已注册之后）。点「注册为能力」= 把技能目录**拷贝**到
   `<kbRoot>/.dsh/skills/<name>/` 并写默认 sidecar（`invocation: ["human"]`，无 `entry`
   = 指令型）。三条护栏：
   - **拷贝不移动**——`~/.dsh/skills` 等源目录与其他 dsh 用法共享，移动等于偷；
   - 目标名已存在（撞内置能力或已采纳技能）→ 拒绝并提示，不静默覆盖；
   - 目录**自带** sidecar 且声明了 `entry`（python 脚本）或 `"agent"` → 采纳确认框
     显式过目——外带声明不能静默生效。
   扁平单文件技能（`xxx.md`，无目录可写 sidecar）灰显标注「不支持」，不做自动转目录。
   sidecar 仍是能力的唯一凭证（ADR-0021 决定 6 不放松）：采纳动作本身就是审计点。
   **落地注记（2026-09-15）**：KB **内**的技能（`.dsh/skills/` 下无 sidecar 或 sidecar
   无效的开源目录）也进未注册分组——带 `inKb: true` 与校验失败原因，注册走第二十一个
   RPC `capabilityRegister`：**原地**写 sidecar（不拷贝，技能目录本来就在归宿里）。
   **落地注记二（2026-09-15，注册交互重设计）**：指令型/脚本型的选择不留给用户——注册
   恒写指令型 sidecar（无 `entry`；三方技能不认 stdin/stdout 运行协议，脚本型只来自
   手写 sidecar），RPC 的 `entry` 参数移除。对话框改为三个勾选（reach）：允许 agent
   调用（→ `invocation: ["human","agent"]`，默认仅 human）、出现在所有资源的右键菜单
   （→ `appliesTo.resource: true`）、出现在中间区右键菜单（→ `appliesTo.selection: true`）；
   `/xxx` 由指令型 + human-invocable 免费保证（决定 3/6），无需勾选。**插件仓库分支**：
   顶层无 SKILL.md 但 `skills/<child>/SKILL.md` 存在的投放目录（Claude 插件市场形态，
   带 `.claude-plugin/plugin.json`）进未注册分组时带 `plugin: true` 与 `pluginSkills`
   清单；注册 = **提取**——把每个内含技能目录**移动**到 `.dsh/skills/<child>/` 并各自写
   sidecar（全有或全无的撞名检查），掏空的仓库壳原地保留；内含技能与仓库同名的常见形态
   （`<repo>/skills/<repo>/`）无法移出，改为**拍平**——内层内容合并上移一层（仓库顶层
   本就不是空的：插件仓库自带 `commands/`、`scripts/`、`docs/` 等，同名目录递归合并、
   文件落到已有文件上则整体拒绝），仓库目录本身成为技能。已是能力的技能拒绝覆盖（修复无效 sidecar 才是注册的用途）。
   **落地注记三（2026-09-15，中央路由重写）**：落地注记二的**提取/拍平**机制整体退役——注册
   不再移动、改名或合并任何目录。声明位改为**中央路由文件** `<kbRoot>/.dsh/skills/yantao.json`：
   单一 JSON（`{ "version": 1, "capabilities": { <名>: { "path", "invocation", "appliesTo"? } } }`），
   `path` 相对技能根、正斜杠、禁 `..` 与绝对路径；路由只声明指令型能力（`entry`/`runtime` 拒收）。
   注册 = **纯配置写入**：KB 内技能写一条 `path: <名>` 的路由；插件仓库为每个内含技能各写一条
   `path: <repo>/skills/<child>` 的路由——仓库原地保留，目录一个字节不动；自带无效 sidecar 的
   目录拒绝注册（请先删除或修复它）。两条声明通道并存、优先级固定：**有效 sidecar 永远压过
   同名路由**；路由只在 sidecar 缺失/无效或注册表看不见技能时生效（`capabilityList` 跳过路由
   已认领的未注册行；仓库的子技能全部被路由后才整体离开未注册分组）。「sidecar 是能力的唯一
   凭证」（ADR-0021 决定 6）由此修订为「sidecar 或中央路由条目」。采纳同步改写：拷贝后**删除
   副本自带的 `yantao.json`**（外带声明不静默生效）并写中央路由。中央路由文件损坏时，运行路径
   报 `bad-manifest` 硬错误，清单/目录注入路径降级为「无路由」——运行暴露问题，浏览保持可用。

2. **frontmatter 映射**。上游字段各管各的命名空间：`user-invocable: false` → 不可采纳、
   不可 `/xxx`，未注册分组里灰显并给原因；`disable-model-invocation` → **忽略**——
   yantao 里 `tool-skill` 本就禁用，模型不会自动加载任何技能，agent 调用只由 sidecar 的
   `invocation` 白名单管（ADR-0023 决定 2），两套字段互不越界。

3. **`/xxx` 手势**。扩展 controller 现有的 `agent/pre-step` hook（动态目录注入就在那里，
   ADR-0023 决定 5）：消息**开头**的 `/name` 命中「指令型 + human-invocable + 已采纳」的
   能力时，原消息照常入会话，另注入一条 `source: { kind: 'skill-invocation' }` 的用户消息
   承载 SKILL.md 正文（与上游 tool-skill 的双消息形态一致）；原消息里的剩余文本就是用户的
   实际请求，跟在说明书之后。名字未命中 → 普通文本；命中脚本型能力 → 普通错误提示
   （"该能力为脚本型，请通过资源菜单或 agent 调用"）；撞内置命令名（`/compact` 等）时
   命令注册表照旧先赢（既定让位规则），采纳时警告不阻止。`tool-skill` 保持禁用。

4. **资源右键的指令型行为**。菜单项已由 `appliesTo.resource` 免费获得（ADR-0021 决定 7），
   补的是点击后的语义：指令型能力 → prompt（SKILL.md 正文 + `@path` 文件引用，与
   `@` 引用 chip 的序列化同格式）发**当前会话**，无会话则新建——三方技能的本质是"换个
   提示词做事"，用户预期在正看着的会话里看到过程和结果。脚本型能力行为不变
   （`capabilityRun` → 提案卡），那是为结构化产出设计的流程。
   **落地注记（2026-09-15）**：`appliesTo.resource` 增加**布尔变体**——`true` = 接受
   **所有**资源（注册勾选「出现在所有资源的右键菜单」的落点），列表仍按后缀过滤；
   run 侧校验同步：`true` 直通，非布尔非列表拒绝。
   **落地注记二（2026-09-16，ADR-0026 决定 4）**：指令型能力经资源/实体行右键与中间区
   无选中右键的运行不再取 `capabilityRun` 的 `content` 做客户端拼接——直接合成
   `/name @path` 用户消息发当前会话（无会话则新建），SKILL.md 注入完全交给决定 3 的
   pre-step，消息在 transcript 透明可见（如同用户亲手敲入）；脚本型能力照旧
   `capabilityRun` → 提案卡。

5. **选区右键**。sidecar 新增 `appliesTo.selection: true` opt-in——只有声明的指令型能力
   出现在选区菜单（默认全量出现会让菜单随能力数无限膨胀，且多数技能对裸文本无意义）。
   prompt = SKILL.md 正文 + 选中文字**固定拼接**，不引入占位符模板系统（现有能力系统的
   唯一入参缝是自由form的 `input` 对象，模板等真实需求出现再加）。v1 两个表面：
   `FileEditor` 的 textarea（`selectionStart/End`）与阅读视图 `MarkdownView`
   （`window.getSelection()`），复用 `RowMenu` 的固定定位菜单模式。菜单另含固定项
   「发送到会话」：选中文字原样发当前会话——不依赖任何能力，是"选中文字作为提示词"的本义。
   **落地注记（2026-09-15，无选中变体）**：中间区（markdown 阅读视图 / kb 编辑器
   textarea）右键**无选中文字**时弹能力菜单（`CapabilityMenu`）：列出勾选了
   `appliesTo.selection` 的指令型能力，点击 = 对**当前打开的文件**调用——SKILL.md 正文
   + `@path`（与决定 4 的资源右键同一序列化）。有选中时既有的选区菜单照旧赢。
   **落地注记二（2026-09-16，ADR-0026 决定 4）**：选区能力的 prompt 不再是"SKILL.md
   正文 + 选中文字固定拼接"——客户端合成 `/name ` + 选中文字（含换行时整体包成 `> `
   引用块，保持 `/name` 在消息开头可识别）发当前会话，注入归决定 3 的 pre-step。
   「发送到会话」固定项不变。

6. **`/` 自动补全**。注册 `('/','capability')` input-trigger 源（照 `kbReferenceSource`
   的 `('@','kb')` 模式），列出可 `/xxx` 的能力。**不定义** `matchEnter`/`matchSpace`
   ——这两个方法按注册顺序首个命中生效，不定义就把回车裁决完全让给现有流程，避免与
   ui-commands 抢序。

7. **agent 开启方式**。采纳后想对 agent 开放（进动态目录 + 可被 `kb_run_capability`
   调用）= 手工把 `"agent"` 加进 sidecar 的 `invocation` 数组。低频操作，sidecar 本就是
   用户可编辑的声明文件；面板开关等真有需求再加。
   **落地注记（2026-09-15）**：注册对话框的「允许 agent 调用」勾选把这一步前移到了
   注册时刻（→ `invocation: ["human","agent"]`）；已注册能力的开关仍是手工编辑 sidecar。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 全局技能须拷贝才能用，不搞引用/链接 | KB 自包含（ADR-0024）；单一事实来源 | 同 ADR-0024 台账第 2 条 |
| 2 | `/xxx` 对脚本型能力不可用 | 语义单一：`/xxx` = 把说明书念给模型听 | 脚本能力的会话内触发成为真实需求时再议 |
| 3 | 无模板占位符（`{selection}`/`{path}`） | 零新机制，固定拼接可解释 | 出现"同一能力按输入不同拼装不同"的需求 |
| 4 | 撞内置命令名只警告不阻止 | 能力注册不被单一通道的失效绑架 | 用户真的被 `/xxx` 失效困扰时升级为阻止 |

原因：

- **为什么采纳是拷贝**：ADR-0024 的约束决定了归宿必须在 KB 内；源目录是共享的，拷贝是
  唯一不干扰其他 dsh 用法的方式。原位置的技能继续服务 CLI 等用法，互不相欠。
- **为什么不启用 `tool-skill`**：启用 = 免费得到模型目录注入 + `skill` 工具 + 手势全套，
  但与 `kb_run_capability` 双轨（两个目录、两条执行路径），且 `skill` 工具可加载**任何**
  技能正文，绕过 sidecar 的 `invocation` 白名单——信任边界倒退。
- **为什么双消息**：来源标记让 transcript 可审计（哪句是说明书、哪句是人话），渲染层
  以后加技能徽章有缝；单消息拼接省的那点体积不值。
- **为什么选区 opt-in 而不是默认全量**：菜单是稀缺注意力资源；声明位与 `appliesTo.resource`
  同构，学习成本为零。

后果：

- 修订 ADR-0021 决定 6 措辞（"完全没有能力声明的 skill 目录仍然不是能力"保持不变，但
  面板展示未注册分组——采纳动作即审计点）、决定 7（`appliesTo` 增加 `selection` 键）
  ——随实现同步改注记。
- `capabilityList` RPC 面扩展（未注册分组、采纳动作）→ `pnpm run gen-cordis-catalog` 与
  controller README 对随实现同步。
- 前端增量：CapabilityPanel 未注册分组 + 采纳确认框；RowMenu 指令型行为分支；
  FileEditor/MarkdownView 的 `onContextMenu`；ui-yantao 注册 `('/','capability')` 源。
- 采纳确认框显示将写入的 sidecar 预览与目标路径（预告—确认两道提示）。
- `AGENTS.md` 硬规则 2 不动：`/xxx` 是人的通道，agent 侧仍只有 `kb_run_capability` 一扇门。
- 未做：模板占位符系统、聊天输入框选区、扁平技能自动转目录、能力面板 agent 开关。
