---
status: accepted
---

# 技能改写提议（skill 自进化第一程）

出发点（2026-10-08 拷问会）：台账「skill 自进化」自 2026-09-17 挂起——"dsh 侧暂无自进化设计，
目前靠人改 SKILL.md + 版本号驱动重播种。等真实使用中出现『改了技能想立刻生效』的痛点再设计。"
本次拷问会在裁决能力配置单文件化（ADR-0052 改写稿）的过程中，用户提出：技能执行后，除记忆
提议外，还应增加 **skill 改写提议**——agent 用出一个技能、发现了它的毛病，可以提名改写；
人批准后由系统落笔。本篇立案清偿。

事实基础（已核实）：

- **改写即时生效**：外部技能的 agent 调用是即时读 SKILL.md 正文（ADR-0052 改写稿决定 3 后
  成为唯一语义），无 prompt 缓存、无播种环节——批准落笔后下一次调用就用新文，不需要任何
  生效机制。
- **备份基础设施已存在**（ADR-0023 决定 7）：`backupIfDrifted` + `.dsh/yantao/capability-backups/
  <name>/<时间戳>/`——Windows 安全的可排序时间戳（冒号点替换为连字符）、漂移检测、"备份是
  保险不是闸门"（失败吞掉，不挡主流程）的语义都已就位。
- **提案队列已存在**（ADR-0047）：proposal-inbox.json 队列 + 提议 tab + ProposalCard 人决；
  ADR-0044 的 `kb_propose_memory` 确立了"提名永不直达 prompt/文件，人批准才生效"的信任锚
  位置。
- **当前 agent 无任何写技能目录的通道**：`kb_write_resource` 只能在 `resources/` 创建新文件；
  技能目录整体在可写平面之外。改写提议是第一个触碰技能文件的 agent 动议，必须有人的闸。

决定：

1. **新工具 `kb_propose_skill_rewrite`**：agent 提名对某个已注册技能目录内文件的改写，提案
   进入 ADR-0047 提案队列，与记忆提议、调度提议并列。工具描述与提示词分层（ADR-0022）告知
   agent：发现技能的指令缺陷、工作流漏洞、模板问题时可提名改写；提案是提名，不催办不自动
   重试。
2. **作用域：技能目录内任意文本文件**，排除运行产物目录（`state/`、`downloads/`、`reports/`、
   `out/`、`__pycache__/` 等按目录黑名单）。指令、脚本、模板都在射程内。**无 diff 不成卡**：
   提案信封必须携带原文与改文（或等价 diff），ProposalCard 以 diff 视图呈现，人看着差异批准
   或丢弃。
3. **批准写回**：人批准 = 信任锚所在；controller 执行写回，被改文件的原样先拷入
   `capability-backups/<name>/<stamp>/`（复用既有惯例，技能目录保持干净，不采用原地
   时间戳后缀——那会污染目录、干扰源头比对与漂移检测）。
4. **version 保护**：提名 diff 若触及 SKILL.md frontmatter 的 `metadata.yantao.version`，
   批准时剥离该改动——播种版本只能随 builtin 包发版走，agent 抬高副本版本会让未来更低版本
   的包永远播不进来。
5. **与升级相遇不设闸**：源头重拷会冲掉改写，备份兜底；不记 `rewrittenAt`、不加分叉标记、
   不阻止重拷。重拷是人的故意动作，冲掉了去 backups 找。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 任意文本文件的代码风险面（脚本被改坏可能静默破坏能力） | 指令/脚本/模板全覆盖的自进化面 | 出现频繁改坏脚本的事故时收缩为 SKILL.md-only |
| 2 | 改写与升级的一致性无保障（重拷冲掉，靠人记得去 backups 找） | 零闸门、零标记、零提醒负担 | 重拷频繁到冲突常见时，考虑 CapabilityRecord 记 `rewrittenAt` 做再采用提醒 |
| 3 | 备份与原件不同址（要去 backups 目录找旧文） | 技能目录保持纯净 | 无 |
| 4 | version 只能随包发版走，agent 改 builtin 技能不改版本号 | 播种比较不被提案污染 | 无 |

原因：

- **为什么走提案队列而不是直接授权写**：技能文件是能力的定义本身，agent 自改自的定义等于
  让被监管者改写监管规则。信任锚放在人类批准动作是 ADR-0044 以来的一贯裁决；提案队列的
  卡片、批量处置、留痕全部现成，边际成本只是一张新卡型。
- **为什么作用域放开到任意文本文件**：最少限制最少动作（一贯裁决偏好）——agent 积累的经验
  不只落在指令层，模板错字、脚本参数缺省、schema 字段都可能是"用出来的毛病"；diff 审查本身
  就是防线，事前的文件类型 whitelist 是替人预设不信任。
- **为什么备份复用 capability-backups**：同址、同类、同语义（保险不是闸门），时间戳格式已
  为 Windows 路径做过净化；另起炉灶只会制造"备份到底在哪"的第二种答案。
- **为什么现在是时候**：ADR-0052 改写稿落地后，技能目录回归"完全原样"，改写的影响面变得
  可以推理（改的就是源头那份的本地副本，没有适配器、没有声明、没有隐藏机制）——地基不稳
  时上自进化，diff 审查人会看不懂自己在批什么。

后果：

- `packages/api/yantao-kb-controller`：新工具注册（含工具描述）、提案队列新类型（技能改写：
  name/file/original/new）、批准写回 RPC（先备份后写、version 剥离校验）。
- `packages/client/ui-yantao`：ProposalCard 新卡型（diff 视图、批准/丢弃并排卡底，遵循
  ADR-0038/0047 的卡片纪律）。
- `packages/yantao/kb`：proposal-inbox schema 扩展。
- 提示词层：`kb_*` 工具清单与技能指令模板补一句提名指引。
- 依赖：第一批（ADR-0052 改写稿：单文件配置 + 执行统一）落地后施工——本篇的 diff 审查
  语义建立在"技能原样"的地基上。
- 台账「skill 自进化」就此清账：接入/注册/调用设计（ADR-0025）+ 改写提议（本篇）；
  "改了技能想立刻生效"的痛点由"改写即时生效"的事实直接消解，无需设计。

落地注记（2026-10-09，第二批施工 22a4a429e6，23 文件 +1242/−14；三包 1186 例全绿）：

- **kb 工具**（决定 1/2）：`kb_propose_skill_rewrite`（第十三→十四个 `kb_*` 工具，kb 插件
  12 个 + controller 2 个）——路由校验（未注册/路由 path 越界 → `skill-not-routed`）、
  file 围栏（越出/绝对路径/黑名单产物目录 → `bad-skill-file`）、ENOENT/二进制/漂移/
  同文/空字段/20 万字上限各有专名错误码；提名只追加 ADR-0047 收件箱（source
  `skill-rewrite:<name>`），目标磁盘字节不动。
- **批准写回**（决定 3/4）：controller `skillRewriteApply` RPC——批准时重解析路由（提名
  的有效性不随注销存活）、漂移守卫（磁盘 ≠ original 拒绝并要求重新提名）、best-effort
  备份到 `.dsh/yantao/capability-backups/<name>/<stamp>/`（失败吞掉不挡写）、版本钳制
  `stripVersionChange`（bump 扣回/整 nest 删除按原版重建/version 行删除插回/原版无版本
  则剥净——孤儿 `metadata:`/`yantao:` 壳连壳摘除，钳制输出字节等于原文）、原子写 0o644。
- **diff 面**（决定 2）：朴素逐行 `-`/`+`/空格两行 diff，自实现 LCS（`ui-yantao/diff.ts`，
  无 diff 库）；300 行帽、首尾各留 20 行、中段折叠为**本地化**的计数省略（`omitted`
  出计数、卡片渲染词条，diff 层不藏中文）；卡片 `SkillDiffBlock` 默认折叠，
  「查看改动/收起改动」开合；skill-rewrite 行批准即生效、记为不可逆——不出撤销步骤。
- **提示层**：skills.md 礼仪条——改说明书走提名、`original` 必须是最近一次实读全文、
  version 不归 agent 管、产物目录不接受提名。
- **顺手修复的历史缺口**：Frame 的 `applyConfirmed` 目标（收件箱确认与提案确认共用）
  自 ADR-0047 第三批起从未携带 mail 三动词（deleteMails/archiveMails/downloadAttachments）
  ——经收件箱批准的删除/归档/下载行一直在静默跳过；本次随 `skillRewrite` 缝接线一并补上
  （`git show f5e74b0e16` 考古确认）。
- **测试中抓出的真 bug 两枚**：① 两侧 `confinedRelativeOf` 都是先剥前导 `/` 再判
  isAbsolute，`/etc/passwd` 被静默相对化成 `etc/passwd` 走到 ENOENT——改为先判原始路径；
  ② diff 回溯比较写反（后缀表下应向较大邻居走），致 LCS 失配、行数虚胖——一并修正，
  并统一尾部换行语义（结尾 `\n` 是终止符不是空行，空串零行，同 git diff 口径）。
- **文档收尾**（第三批）：ADR-0023/0025/0043 修订注记（spawn 通道退役/路由升格/信封契约
  退役）、ADR-0053 落地注记补完工、CONTEXT「能力」词条改写、TODO 台账行。
