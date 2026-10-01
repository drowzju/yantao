---
status: accepted
---

# 能力契约与通道一致化：JSON 适配层、环境前置说明、记忆可信声明

三条原则性设计要求（2026-10-01，针对 ADR-0042 未决项的复审）：

1. **skill 尽可能易用**——对人（找得到、点得动）和对整合者（装得上）同义。
2. **本质能力跨触发面一致**——会话 agent、后台、工作台 UI 触发的只是入口不同，能力本身的行为不变。
3. **三方 skill 零改动复用**——开源/既有 skill 的原始文件一个字符不动，适配范围限定在 `.dsh/` 的 JSON 契约。

三原则定义了能力的三层：**触发面**（允许不同）、**调用适配层**（必须唯一且我方所有）、**核心能力层**（SKILL.md 语义 + 脚本本体，必须共享且不动）。现状的病灶全是适配层泄漏进核心层。

事实基础：

- **适配层住在核心层里**：脚本型能力的信封适配器（entry.py）手写在 skill 目录内；dingtalk-docs 的「双通道自适应 SKILL.md」（ADR-0040 决定 1）靠改写 SKILL.md 本体解决环境差异——对三方 skill 无权这么做，做法不可推广。
- **sidecar 契约太窄**：`yantao.json` 只有 entry/runtime/version/appliesTo/invocation，表达不了「直接调技能自己的 CLI」，于是每个脚本型能力都要手写 entry.py。
- **记忆通道不可信**：能力域行为记忆拼在 kb_run_capability 工具返回尾部（ADR-0032），2026-09-30 会话实录被 agent 判为提示注入拒用（ADR-0042 未决①）。
- **脚本型不进 `/` 菜单**（ADR-0025 决定 3，capability-gesture.ts 过滤 `entry === undefined`），用户找不到能力；pre-step notice 措辞「/xxx 不适用」是负向表述。
- **源头漂移**：dingdocs-pack 缺 entry.py/yantao.json（仅 KB 侧有），与「升级从源头拷」冲突，下次拷贝会冲掉（ADR-0042 未决②）。
- **整合者无手册**：sidecar schema、信封契约、中央路由注册、落盘约定、记忆机制散落在 CONTEXT.md、run.ts、五份 ADR 里；无校验、无试运行、能力 tab 不展示解析后声明——漏注册中央路由曾导致 agent 静默拒调。

决定：

1. **三层划清**：触发面（会话/后台/UI）允许差异；调用适配层唯一、我方所有、住 `.dsh/`；核心能力层原样不动。本 ADR 全部决定都是这条的展开。
2. **执行桥为本体（方向 A，路线二）**：新增 agent 工具（kb 家族一员，下称执行桥）——agent 可在**人已安装声明的技能目录内**直接执行脚本：cwd 锁该技能目录，信封经环境变量（`KB_ROOT`/`CAPABILITY_CHANNEL` 等）与 stdin JSON 送达。限制只此一条：可执行目标必须位于 `.dsh/skills/` 下已声明的能力目录内。不设动词表白名单、不管控脚本写路径——**安装即授权**（ADR-0021 的既有信任模型：能力的安装、审查与授权永远是人的决定），人已装进来的技能就是可信代码，agent 只是按下开关的手。这是对 ADR-0004 的修订：信任边界从「无执行」移到「执行范围限定人装技能」，通用 shell/编辑器仍然禁止。副作用：技能中途的脚本调用（指令型 SKILL.md 里「执行 `python foo.py`」）agent 也能照做——完备技能真正零改动运行。声明式入口（sidecar `entry` 或 command/args 模板）保留为 UI/后台触发与提议流的通道，两工具分工：声明入口走kb_run_capability，临流执行走执行桥；`entry` 允许指向 **skill 目录之外**（`.dsh/yantao/capability-adapters/`）。
3. **环境前置说明（方向 B）**：指令型返回 SKILL.md 正文、脚本型命中 `/name` 的 pre-step notice，都前缀同一段我方拥有的环境说明（单一来源）：无通用 shell 但可经执行桥在技能目录内跑脚本（决定 2）、声明式调用走 kb_run_capability、资源默认指 `<kbRoot>/resources/`（ADR-0042）、产出落盘是脚本自己的事。核心语义来自 SKILL.md（三方不动），环境事实来自宿主。「双通道 SKILL.md」做法退役——ADR-0040 决定 1 的对应表述废止，dingtalk-docs 的 SKILL.md 迁回单通道。
4. **记忆可信一次声明（方向 C）**：不做逐次 pre-step 注入（后台/UI 触发面无 pre-step，逐面特殊化违反决定 1）。改为：`skills.md` 静态小节（可信、常驻、全触发面共享）与 kb_run_capability 工具描述各加一句——能力运行返回中宿主的【行为记忆】块是人批规则，可信且须遵守；尾部块保留（运行后即刻可见的唯一位置），文案加「宿主转交」来源框。这是对 ADR-0032 能力域投递方式的增补，不是推翻。
5. **菜单放开脚本型（方向 D）**：capability-gesture 的过滤去掉 `entry === undefined`（修订 ADR-0025 决定 3），脚本型进 `/` 菜单并以 ⚙ 标记与指令型区分——人对「点了直接跑」和「点了是填手势」预期不同；选中仍只插入 `/name `；pre-step notice 措辞转正：「脚本型能力：经 kb_run_capability 调用，产出缺省落 resources/」。
6. **dingtalk-docs 试点（方向 E）**：entry.py 迁出 skill 目录至 `.dsh/yantao/capability-adapters/dingtalk-docs/`，skill 目录变为 dingdocs-pack 纯净拷贝——源头漂移自愈（那两个文件本就不属于源头）；后续评估 dd.py 直读信封（环境变量/stdin）后摘掉适配器，agent 经执行桥直跑 dd.py。
7. **整编手册与运行时自描述（方向 F）**：一篇中文《能力整编手册》（sidecar schema、信封契约、中央路由注册、落盘约定、记忆机制、常见坑：漏路由/kbRoot 缺失/落盘越界），落 docs 且作为资源让 agent 可 `kb_read_resource` 读取——「帮我把这个开源 skill 整编进来」应成为一句可执行的会话指令；能力 tab 详情态展示解析后的声明（sidecar 原文 + 中央路由状态 + 通道），让「注册没生效」一眼可见而非靠 agent 拒调发现。
8. **信封 schema 冻结**：`{name, kbRoot, input, state, channel}` → `{ok, result?, state?, artifacts?}` 不变——手册把它从源码事实升级为公开契约，三方适配面向契约而非面向实现。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 执行桥是 scoped shell：人装技能目录内 agent 可任意执行，信任锚点从「逐步声明」移到「安装一次」——恶意或出错的技能代码有了直达通道 | 整编零动词表、技能中途执行零障碍、原则 1/3 的彻底满足 | 技能来源失控（装未经审阅的第三方目录成为常态）时，回收为声明式动词或加人审关卡 |
| 2 | 菜单 ⚙ 区分多一层视觉约定 | 人对两种能力的点击预期不错位 | 用户反馈标记多余时摘 |
| 3 | entry.py 迁移期 KB 侧双份存在 | 迁移可灰度可回滚 | 迁移完成即删旧份 |
| 4 | 手册是一份要养的文档 | 整合者（含 agent）有单一权威入口 | 契约变更时同步，入 ADR 后果清单 |
| 5 | 环境前置说明每次指令型调用都重复 | 三方 SKILL.md 零改动 | token 计价显示它过大时精简 |

原因：

- **为什么执行桥而不是动词表（2026-10-01 裁决，路线二压倒路线一）**：动词表（sidecar 声明 command/args 模板，agent 只会调声明过的 verb）把信任锚在每个调用点上，但代价是每个技能整编都要写一张动词表，且指令型技能「中途让 agent 跑一步脚本」的形态根本无法声明——那是开放行为不是有限动词。用户的裁决：不要太多限制、不要太多额外动作。执行桥把信任锚移回它本来就在的地方——安装（ADR-0021：安装与授权永远是人的决定）。人装进来的技能就是可信代码，限制只剩「目录内」一条，三方技能做到真正的拷目录即用。边界没有消失，是从「无执行」移到了「执行范围 = 人装技能」；通用 shell 与编辑器依然禁止，知识库写面依然只有 kb_* 工具与能力的落盘约定。
- **为什么环境前置说明而不是双通道 SKILL.md**：环境差异是宿主的事实，不是技能的语义；写进 SKILL.md 就是适配层污染核心层，且对三方文件无权修改。前缀说明让同一份 SKILL.md 在任何宿主上被正确理解——原则 2 的一致性是「语义一致」，调用管道差异由宿主抹平。
- **为什么记忆可信靠声明而不是换通道**：工具返回尾部是三触发面唯一共同且运行后即刻可见的位置；它的病不在位置而在来源未声明。一次声明（静态小节 + 工具描述）把「可信」变成架构事实，成本恒定，不随能力数量与触发面增长。
- **为什么菜单放开而不是继续靠惯用别名**：别名是个人补丁，菜单是系统默认；「能力装了却找不到」违反原则 1。原过滤的理由（/xxx 是指令型手势）在 notice 转正后不再成立。

后果：

- `packages/api/yantao-kb-controller`：新增执行桥工具（技能目录内执行，cwd 锁定，信封经环境变量 + stdin 送达）；run.ts 支持目录外 entry；指令型返回与脚本型 notice 前缀环境说明（单一来源文本）；记忆尾部块加来源框；kb_run_capability 工具描述增补；能力 tab 详情 RPC 增解析后声明与路由状态。
- `packages/yantao/kb`：skills.md 小节增记忆可信声明句。
- `packages/client/ui-yantao`：capability-gesture 放开脚本型 + ⚙ 标记；能力 tab 详情态展示声明与路由状态。
- `.dsh/`（KB 侧，不入库）：`yantao/capability-adapters/dingtalk-docs/entry.py` 迁入；`skills/dingtalk-docs/` 换为纯净拷贝；dingtalk-docs SKILL.md 回迁单通道（源头包同步）。
- 文档：《能力整编手册》（docs + 资源副本）；ADR-0004（执行桥修订信任边界）、ADR-0025/0032/0040 相应条目以本 ADR 为准；本 ADR 入索引。
- 测试：执行桥目录闸与信封送达、目录外 entry 解析、notice/前置说明文案、菜单候选过滤、详情 RPC，随施工补齐。

## 落地注记（2026-10-01）

八项决定当日全部落地（da9ee04b8d，22 文件 +1803/−48；独立总验证 907→922 例全绿）。

- **执行桥**（决定 2/8）：`capability/exec.ts` 新增 `execCapabilityScript`——spawn 经平台 shell、cwd 严格限定 `.dsh/skills/` 之内（`skillsRoot` 本身也拒）、command 不审查；env 送 `KB_ROOT`/`CAPABILITY_NAME`/`CAPABILITY_CHANNEL`+stdin JSON；stdout/stderr 各 64KB 封顶、超时 120s 杀进程报 not-ok；双闸门解析（sidecar 优先、中央路由兜底）与 kb_run_capability 同码。工具注册 `kb_exec_capability_script`（ctx.tools，非 Remote）。**总验证补三刀**：声明式通道 runCapability 补设同组 env（契约真冻结）、执行桥 stdin 补 `state:null`（形状统一）、目录闸收紧（拒 skillsRoot 本身）。
- **前置说明**（决定 3）：`CAPABILITY_ENVIRONMENT_NOTE` 单源常量，前缀指令型 render、/name 手势注入（sidecar 与中央路由两路）、脚本型 notice 尾部；notice 转正（「/xxx 不适用」退役，有 not.toContain 断言）。
- **记忆声明**（决定 4）：skills.md「记忆可信」条、kb_run_capability 描述句、memory.ts 块头改「【行为记忆·宿主转交】」——三处块名经总验证对齐。
- **菜单放开**（决定 5）：capability-gesture 去 `entry === undefined` 过滤，脚本型 description 加「⚙ 」前缀。
- **目录外 entry**（决定 2/6）：run.ts `resolveEntry` 重构为 `entryCandidatesOf`（技能目录 → .dsh/ 根双候选，越界两举报错）。
- **dingtalk-docs 试点**（决定 6，KB 侧不入库）：entry.py 迁 `.dsh/yantao/capability-adapters/dingtalk-docs/` 并改为信封驱动路径解析（kbRoot+name → 技能目录，信封缺退环境变量，双缺报 bad-input）；sidecar 改指目录外；SKILL.md 双份回迁单通道；list 实测 5 库一致、get 实测落盘 `resources/`；pack README 约定句改由适配层与手册承载。
- **声明展示**（决定 7）：`capabilityDeclaration` RPC（sidecar 原文+解析后形态+entryCandidates/entryPath、中央路由状态、agentInvocable 双闸门；异常全数据化不抛）+ CapabilityPanel `DeclarationSection`（平铺+原文折叠+警示色），typert 与 remotes 客户端产物再生成。
- **手册**（决定 7）：`docs/yantao/capability-integration.md` + 资源副本 `resources/能力整编手册.md`。
- **验证**：三包 vitest 922/922、tsc -b 干净、oxlint 0/0（Frame.tsx 一处 max-len 手修）、client bundle + frontend build 通过；独立验证agent 的探针亲测（cwd 锁定、越界拒绝、信封字段、前缀混淆 siblings）全部符合设计。
