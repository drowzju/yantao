---
status: accepted
---

# 能力的模型侧调用（`kb_run_capability` 与指令型能力）

ADR-0021 把能力定为"仅人可调用"（取舍台账第 1、2 条），并写明了重开条件："能力白名单
机制落地后，可对白名单内能力开 `modelInvocable`"。本 ADR 兑现那个条件：门控机制设计
完成（决定 2），真实需求出现——会话中补拉邮件/重抽取（第 2 条牺牲的场景）、复用上游
开源 skill 生态、以及技能系统提示词需要 agent 至少知道能力存在（ADR-0022）。

决定：

1. **推翻 ADR-0021 取舍台账第 2 条**：新增 `kb_run_capability` 工具，agent 可以在会话中
   调用能力。信任边界从八个 `kb_*` 工具变为九个——这是有意识的扩张，不是泄漏：执行的
   仍是"人安装并审定过的能力脚本"，agent 获得的只是选择执行时机的通道。

2. **门控：sidecar 逐能力显式 opt-in**。`yantao.json` 增加 `invocation` 字段：

   ```json
   {
     "entry": "scripts/entry.py",
     "runtime": "python",
     "invocation": ["human", "agent"]
   }
   ```

   缺省 `["human"]`——不声明即对 agent 不可见、不可调。内置 mail/ebook 在仓库里声明打开。
   `capabilityList` 照旧列全部能力（人类通道不变）；agent 侧的目录注入与工具解析只认
   声明了 `"agent"` 的能力。声明即白名单，粒度到能力而非全局开关。

3. **无审批直接执行**。agent 发起的运行不过审批：脚本是人安装时审定过的，agent 只是选
   时机；每次运行都加确认，会话中的自主取数就失去意义——而那正是本次重开要买的东西。

4. **管道：自己的工具，不借上游 skill 机制**。`tool-skill` 继续禁用，能力不进 dsh 的
   `<available_skills>` 目录，`disable-model-invocation: true` 保持。`kb_run_capability`
   在 controller 内解析（`ctx.skills.get`）并复用 `capabilityRun` 的执行缝（同一子进程
   契约：JSON stdin/stdout、UTF-8、超时、失败分类枚举）。门控粒度、目录注入格式、结果
   渲染都是 yantao 的知识。

5. **动态目录注入**。agent 侧的能力清单不写死在任何提示词里：pre-step 时列出所有声明了
   `"agent"` 的能力（名字 + frontmatter `description` 一句话），以注入消息进上下文。
   能力是运行时可创建的（`capabilityCreate`），静态目录必然漂移。`yantao:skills` section
   （ADR-0022）只写使用纪律，不写清单。

6. **指令型能力**。有显式能力声明（`yantao.json` sidecar，或旧版 `metadata.yantao`
   frontmatter）但**缺 `entry`** 的目录视为**指令型能力**：没有脚本，"运行"= 把 SKILL.md
   正文作为工具结果返回，agent 照指令行事。完全没有能力声明的 skill 目录**仍然不是能力**
   （现状不变）——没有声明就没有 `invocation` 门控位，放行它等于绕过审计。这是给上游
   开源 skill 生态开的门：拷一个 skill 目录进来、补一个几行的 `yantao.json`
   （声明 `invocation: ["agent"]`、不写 `entry`）就能被 agent 使用——sidecar 的显式声明
   保住可审计性，与 ADR-0021 决定 1 的修订同一逻辑（外带声明让复用零侵入）。指令型能力
   同样受决定 2 的门控约束；能力 tab 详情态对它展示 SKILL.md 正文、不提供运行按钮。

7. **播种保护**。`ensureBuiltinCapabilities` 在版本比对触发整目录覆盖前，先检测 KB 副本
   与 master 的差异，有差异则把现副本备份（`<name>.pre-update-<时间戳>/`）再覆盖——
   人的手改不再被静默清空。备份是防丢失，不是合并；手改与新版本如何取舍仍由人做。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 信任边界 7→8 个工具，agent 获得"选时机执行脚本"的通道 | 会话中取数/重抽取成立；技能系统提示词有了真实对象 | 出现执行滥用（频率失控、越权输入）时加 `requireApproval` 位 |
| 2 | 任意下载的指令型 SKILL.md 正文可进模型上下文（正是 0021 第 2 条当初防的） | 上游开源 skill 生态零代码复用 | 出现提示注入事故时，收紧为"指令型能力需人工审查后声明" |
| 3 | 无审批直接执行 | 会话自主性完整 | 同第 1 条 |
| 4 | 播种备份只防丢，不合并不提示 | 几行代码消掉静默丢失 | 手改与新版本的合并成为真实痛点时做 diff 呈现 |

原因：

- **为什么现在重开**：0021 写明重开条件是"白名单机制落地"。sidecar opt-in（决定 2）就是
  那个白名单——条件兑现，需求真实，且窗口与 ADR-0022 的提示词分层重合，一次把"yantao
  如何对模型说话"说清。
- **为什么无审批**：审批的价值在"拦住没见过的东西"。能力脚本是安装时见过的；运行时审批
  拦的是时机，而时机判断正是交给 agent 的全部内容——拦了等于没开。
- **为什么指令型用"缺 entry"而不是新字段**：sidecar 已经是能力的身份证明；缺 `entry` 的
  目录本来就无法走脚本契约，与其报错不如给出明确语义。新增 `mode` 字段是第二套表达同一
  件事的方式，留给真出现"有脚本但按指令用"的场景再说。
- **为什么备份而不是放弃覆盖**：播种的版本比对语义（"版本化 master 永远赢"）是 ADR-0021
  落地注记确认过的正确行为，手改不该阻断升级；该消灭的只是"静默"。

后果：

- 新工具 = 新 RPC 面：`pnpm run build:lib` + `pnpm run gen-cordis-catalog` 必须跑；
  controller README 对（RPC 表 + "N unary methods" 句）与 `docs/subsystems/yantao.md`
  **随实现同步**，不提前。
- `AGENTS.md` 硬规则 2 的"八个 `kb_*` 工具"措辞随实现改为九个（`kb_read_resource` 落地时已到八个，起草时按旧账写作七个）。
- mail/ebook sidecar 加 `invocation` 字段，版本 bump 到 3，播种机制自动覆盖旧副本
  （配合决定 7，人改过的副本先备份）。
- 「新建能力」脚手架生成的 sidecar 模板加 `invocation` 注释示例。
- ADR-0021 取舍台账第 1、2 条标注"已由 ADR-0023 重开"——随实现一起改，不提前。
- 未做：运行时审批、指令型能力的人工审查流、第二 runtime、能力市场/签名。
