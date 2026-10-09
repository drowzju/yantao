---
status: accepted
---

# 能力配置单文件化与执行统一（路由只存可达，技能保持原样）

出发点（2026-10-08 两次拷问会）：本篇初稿裁定"形态归 SKILL.md frontmatter、可达归中央路由"的
两轨单轨化。同日二次拷问会推翻了初稿的一半——用户裁决**一处集中管理**与**技能保持原样**，
追下去发现初稿保留的"形态声明"整层都是多余的：解剖 dingtalk-docs 适配器后证实，entry/runtime
的存在理由全部依附于"宿主 spawn 一个说信封的脚本"这一执行模型，而通用执行通道
`kb_exec_capability_script` 早已存在且更普适。执行模型一换，形态声明失去存在理由。
本篇改写后裁定：**配置只有一个文件，条目只剩可达；执行只有一条通道；技能目录一个字节都不为我们改。**

事实基础（已核实）：

- 历史三载体：① 能力目录内 `yantao.json` sidecar；② SKILL.md frontmatter `metadata.yantao`
  段；③ 中央路由 `.dsh/skills/yantao.json`（ADR-0025）。判定曾是双闸门（声明优先、路由兜底），
  初稿已裁定废除 sidecar、收敛单轨。
- 真实环境（`D:\yantao-data\.dsh\skills\`）：七个技能目录，五个在路由表；dingtalk-docs、mail
  带 sidecar；**mail 不在路由表**（agent 可达全靠仓库内 sidecar）；`ljg-xray-book` 是悬空条目
  （指向的目录不存在，全库无引用）；book-master、book-to-skill 未注册（无 sidecar 无路由，
  完全不可达）。
- **适配器解剖**（`capability-adapters/dingtalk-docs/entry.py`，245 行，对照源头 dd.py 1069 行
  零改动）：适配器干了五件事——信封契约翻译（stdin/stdout JSON）、verb→argv 映射（约 80 行
  技能专属知识）、kbRoot 消费（get 缺省落 `<kbRoot>/resources/`，ADR-0028「最后一米」）、技能
  目录定位（因适配器住在技能目录外）、杂务（stdout 捕获/win32 UTF-8/错误分类）。其中四件的
  存在前提是"宿主要 spawn 一个说信封的脚本"。
- **通用执行通道已存在**：`kb_exec_capability_script` 语义即"在该能力目录内执行脚本"——cwd
  锁定技能目录，KB_ROOT 等环境事实经环境变量与 stdin 送达，且这段指引已注入每个技能的指令
  （`capability/exec.ts`）。`python dd.py list` 今天就能经它原样执行，无需任何适配。
- **改写即时生效**：外部技能的 agent 调用是即时读 SKILL.md 正文，无 prompt 缓存、无播种环节；
  "版本号驱动重播种"只关乎 builtin 播种（builtin.ts 以声明 version 比较包内 master 与 KB 副本
  新旧）。
- ADR-0053 的落地注记声称决定 1/3/4 完工，经复核 main 上无对应实现——该注记为虚假，已更正。

决定：

1. **路由文件 = 唯一能力配置文件**。条目收为 `{path, invocation, appliesTo}`——纯可达。
   entry/runtime/形态声明**全部消失**，"脚本型 vs 指令型"从声明层面蒸发：技能是不是脚本型，
   只看它的 SKILL.md 教不教你跑命令。全局唯一叫 `yantao.json` 的文件只有中央路由这一个。
2. **sidecar 废除，frontmatter 声明通道同步废除**。`resolveCapability` 单信源化（只认路由条目，
   无条目即不可达），不再解析任何形态字段。唯一例外见决定 6。
3. **执行统一**：`kb_run_capability` 单一语义 = 校验可达后返回 SKILL.md 指令正文；一切脚本执行
   走 `kb_exec_capability_script`，并放宽为对任何已注册技能可用（不再要求脚本型声明）。
   capability-adapters 目录与"spawn 说信封的脚本"路径整体退役。信任边界不变：entry.py 与
   任意脚本同为任意代码，exec 的 cwd 锁定不弱于现状。
4. **产出落点由指令层保证**：技能的 SKILL.md 写明"产出到 `$KB_ROOT/resources/`、过程临时文件
   到 `resources/temp/`"，exec 工具负责把 KB_ROOT 放进环境并展开 argv 中的环境变量引用。
   不做临时文件追踪清理（同 sync-out 不入账的裁决偏好）。
5. **mail 走专用链**：builtin envelope 脚本保留，但由 controller 内部专用 RPC 服务 mail 面板的
   取数/删除/归档按钮，不占通用能力执行链；路由条目只登可达。builtin 可达条目首启幂等 seed
   （缺则补，人工改过的不覆盖）。
6. **builtin 播种的版本基座**：播种比较改读 SKILL.md frontmatter 的 `metadata.yantao.version`
   ——一个惰性数字，仅为"包比副本新"的比较存在，无任何权限语义，其余场合不生效。
7. **迁移与数据卫生**：删除 dingtalk-docs、mail 目录内 sidecar；删除悬空条目 ljg-xray-book；
   采用流程的 `adoptSidecarNote` 等防外带声明特殊处理随 sidecar 退役；mail 的 SKILL.md 补
   `metadata.yantao.version`（供播种比较）；book-master、book-to-skill 维持休眠，等真实使用
   意图再走注册。
8. **呈现联动**：形态徽章、入口解析、sidecar 呈现全部退役，详情页只剩使用语义（description、
   可达三勾选+注销、运行摘要、折叠的路由原文）——细则归 ADR-0053，其决定 2 的开关自此
   解除等待、可以施工。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | `kb_run_capability` 不能再直接执行脚本，确定性脚本调用只剩 builtin 专用 RPC 一种范式 | 执行通道两条收敛一条，适配器基础设施整体退役 | 出现"技能即服务"式确定性调用需求时，按 builtin 专用 RPC 模式扩展，不恢复声明执行 |
| 2 | 产出落点从机械保证降为指令约定，agent 不听指令就落错地方 | 技能原样、零适配、零宿主入口 | 指令层屡屡失效时给 exec 加机械落点参数 |
| 3 | 路由文件成为配置单点（损坏波及全部能力） | 一处集中管理，所存即所见 | 出现多机/多 profile 需求时考虑分片，不做备份壳 |
| 4 | 外来技能彻底失去"放下即用" | 信任锚统一到注册，配置面即所存即所见 | 自用脚本懒得注册的场景增多时，做注册批量化而非恢复隐式开放 |
| 5 | 初稿"形态跟技能走、耐升级"的可携性论点作废 | 论点对象（形态声明）本身消失了，可携性以另一种方式达到满分 | 无 |

原因：

- **为什么 entry/runtime 全废而不是集中存放**：解剖适配器得到的五项职责中，信封翻译、目录
  定位、输出杂务三项依附于 spawn 执行模型，模型一换即死；verb→argv 映射的本体知识本来就写
  在技能自己的 SKILL.md/dd.py 文档里，适配器只是重复了一遍；唯一有真实价值的 resources/
  落盘引导，由 SKILL.md 指令承担后适配器再无不可替代职责。为一个失去存在理由的字段找住处
  （哪怕集中存放）仍是在养负担。
- **为什么执行统一到 exec**：cwd 锁定与 KB_ROOT 环境供给已是现状，exec 是现成的、已注入指引
  的通道；两条执行通道收敛为一条后，能力调用的心智模型从"两种形态两种跑法"变为"读指令、
  按指令办事"一种——与人读 SKILL.md 后动手干活的方式同构。
- **为什么产出落点交给指令层**：机械保证的唯一持有者是适配器，而适配器已无存在理由；
  dd.py 本有 `--out`，教用法是技能说明书的天职。风险（agent 不守指令）由指令质量承担，
  取舍台账留了机械化的重开口。
- **为什么 builtin 播种 version 留在 frontmatter**：整包发版会把"单技能改一行"放大成版本事件；
  惰性数字躺在技能自己的文件里，与"技能自带自己的事实"同向。
- **为什么不留任何兼容壳**：单用户 fork（ADR-0027），迁移对象清单明确（两个 sidecar、一个
  悬空条目、一个 builtin frontmatter），留壳只会让"哪个文件生效"的问题再活十年。

后果：

- `packages/api/yantao-kb-controller`：`resolveCapability` 单信源化（形态解析全删）、
  `runDeclared` 的 spawn 路径退役（指令化）、`kb_exec_capability_script` 放宽注册门槛、
  路由读写 RPC 的 schema 收紧、builtin 播种版本基座切换、mail 专用 RPC 与可达 seed、
  `adoptSidecarNote` 等采用特殊处理删除。
- `packages/client/ui-yantao`：形态徽章、入口解析、sidecar 分支及文案退役；可达性配置区与
  注销施工（ADR-0053 决定 2）。
- `packages/yantao/kb`：`CapabilityRecord` 扩 `runCount`/`lastFailAt`（ADR-0053 决定 3）。
- 数据面迁移：两个 sidecar 删除、悬空条目清理、mail SKILL.md 补 version。
- 源头仓库联动：dingdocs-pack 的 SKILL.md 补产出落点指引（`--out $KB_ROOT/resources`）。
- 修订注记挂到 ADR-0023（执行模型：声明 spawn 通道退役）、ADR-0025（中央路由由"可达唯一
  信源"再升格为"能力配置唯一文件"）、ADR-0043（信封契约：spawn 通道消失，环境事实由 exec
  的环境变量供给承接）。
