---
name: mail
description: 读取本地 Outlook 桌面客户端的邮件，按断点增量拉取最新邮件列表。
disable-model-invocation: true
metadata:
  yantao:
    version: 23
---

# 邮件能力

yantao 工作台的邮件能力（ADR-0019 建立，ADR-0021 迁移为能力目录；ADR-0052 起
由工作台内部的邮件专用 RPC 驱动，不占通用能力执行链）。它挂到当前已登录的
经典 Outlook 桌面版 profile 上（pywin32/COM），按人的断点增量读取邮件，交给工作台的
分析流程；断点只在人批准写库后推进。

## 执行契约

入口是 `scripts/entry.py`，由工作台以子进程调用：stdin 收一个 JSON 对象
`{name, kbRoot, input, state, channel}`，stdout 回一个 JSON 对象。按
`input.verb` 分派，缺省是取数；`channel` 由宿主按真实调用方注入（人的确认
卡是 `human`，agent 通道是 `agent`），删除、保存两个特权动词只认前者。

### 取数（缺省动词）

- `input`：`{since?, until?, limit?, folder?, superiorAddresses?}`——`since`/`until`
  是显式翻页边界（**开区间 `(since, until)`，两端都不含**：`since` 取上批末封的
  receivedAt 正好不会重读它，`until` 同理排除）。都不给时用 `state.lastReadAt`，
  再没有就用 30 天前。`superiorAddresses` 是上级人物的 SMTP 地址集合，只为给每封
  邮件算 `superiorInvolved` 旗标（ADR-0034 批次②），不给时旗标恒为 false。
  **agent 场景直接省略这个参数**：知识库的人物实体不保存邮箱地址，构造不出可靠的
  集合；上级关联改为在分析时按发件人身份（对照人物实体的关系标注）判断，
  不要为凑这个参数去读实体。
- **agent 通道缺省 slim（2026-10-20）**：`entry.py` 在 agent 信封下默认不取正文
  （回执 `slim: true`、每封 `body` 为空串），人通道保持整页正文。要正文时显式
  传 `slim: false`，或按下面的纪律单封小页取——别整页重拉。
- `state`：`{lastReadAt?}`——上次读到的水印，由工作台持久化，脚本只读不写
  （推进水印是批准后的另一个动作）。
- 成功：`{ok: true, result: {since, until?, lastReadAt?, stale, messages, hasMore}}`，
  `messages` 每封 `{id, entryId, receivedAt, senderName, senderAddress, subject, body, truncated, toMe, superiorInvolved, conversationId, conversationTopic}`；
  `body` 是**正文开头摘要，至多 512 字**（2026-10-10 裁决）；`toMe` 是我与这封邮件的关系
  （to 主送 / cc 抄送 / none 都不是 / unknown 认不出）；`superiorInvolved` 是收件人中是否
  命中上级地址集合（布尔，ADR-0034 批次②）——两者都只回关系或旗标，不含其他收件人的
  名字或地址；`conversationId`/`conversationTopic` 是 Outlook 的会话键与会话主题
  （Outlook 2010+），读不到时为空串，客户端据此前提归并线程、缺失时回退按主题剥
  RE/FW 前缀分组。
- **正文摘要就够了，不要整读**：分诊（删除/保存提名）与写提议理由靠元数据加开头
  512 字足矣。整封原文不靠取数通道留存——值得留存的邮件由人批准后走保存动词落
  .eml 原件（见下），数据不会丢。不要为了「看清正文」把大批邮件拉进上下文：
  实测整页正文灌入会让上下文几分钟顶满，压缩开销达到工作时间的近三倍
  （2026-10-10 调度任务实测，压缩占墙钟 73%）。

### 翻页与巡扫纪律（2026-10-10 立）

- **巡扫/翻页一律用 `--slim`**（CLI）或不带正文的方式：正文是输出的体积大头，
  带正文的大页会撞上工作台 64KB 输出截断，页底（时间最早）那封的
  id/receivedAt 被裁掉，翻页锚点就丢了。
- **已知事实，不必再探测**：`--slim` 输出按收件时间**新→旧**排序（页底=最早），
  单封约 0.7KB——`--limit 40` 的一页约 28KB，远离截断线。巡扫直接从断点起
  `--slim --json --since <断点> --limit 40` 一页扫到底（`--since` 可省，缺省
  30 天前）：返回封数少于 limit 即触底，无需先用小页探序。
- 翻页锚定协议：区间两端都不含（见上），下一页 `--until` 取当前页底时间
  **+1 秒**（越过开区间下界的同秒兄弟信才不丢），重叠出现的邮件按 `id` 去重；
  返回单封且与上页重复即证明区间触底。
- **运行级正文去重（2026-10-20）**：agent 会话里宿主给每次脚本执行注入
  `CAPABILITY_RUN_LEDGER`（本次会话专用的正文账本）。带正文的取数（entry.py
  缺省动词、CLI 不带 `--slim`）里，**本运行已经带正文送过的邮件只回桩行**
  （`{id, entryId, receivedAt, senderName, senderAddress, subject, deduped: true}`，
  没有正文）——重扫窗口、翻页重叠、修复轮重拉都不再重复付正文的价钱，见到
  `deduped: true` 就说明这封的正文你已经有了，不必再要。slim 行不进账本也不
  被桩掉（翻页锚点依赖完整行）；人通道没有账本，行为不变。
- 需要补充判断依据时，再单独小页（limit 1-3）拉取那一封——回来的同样是 512 字
  摘要；摘要仍不够下判断，就按元数据判断，不要反复重读。

### 删除（`verb: 'delete'`，仅人通道，ADR-0034 决定 5）

- `input`：`{verb: 'delete', ids: [entryId, …]}`——要移走的邮件的 Outlook
  EntryID 列表，来自提案卡上人勾选的删除提名。
- `channel` 必须是人通道：信封里的 `channel` 由宿主注入、调用方伪造不了，
  agent 通道在此被拒（`not-invocable`）——agent 只有删除提名权，没有执行权。
- 去处是「已删除」文件夹（移动，不是永久删除，回收站里可捞回）。
- 成功：`{ok: true, result: {moved, missing, failed}}`——`moved`/`missing` 是
  EntryID 列表，`failed` 是 `{id, message}`；单封失败不影响其余。
- 失败：与取数同词表（python-missing / outlook-unavailable / other）。

### 保存（`verb: 'archive'`，仅人通道；ADR-0037 建立「归档」，2026-10-09 三提名合一后即「保存」）

- `input`：`{verb: 'archive', mails: [{entryId, summary}, …]}`——要保存的
  邮件的 Outlook EntryID（定位原件）与分析摘要（落索引「摘要」列），来自
  提案卡上人勾选的保存提案。本体在 `scripts/archive_mail.py`。
- `channel` 必须是人通道，同删除刀（agent 只有提名权，没有执行权）。
- 每封的处理：COM `SaveAs` 导出 .msg → 重组为自包含 .eml（正文、头字段、
  内嵌图片、附件全在一个文件里；头字段优先取 .msg 内嵌传输头、缺项退 COM
  值，正文过 Latin-1→GBK 乱码反演——extract_msg 会把 GBK 正文流误解成
  Latin-1；依赖 `pip install extract-msg`，缺库或重组
  失败时降级存 .msg，索引备注「msg 兜底」）→ 落
  `<kbRoot>/resources/mails/YYYY/MM/YYYY-MM-DD_HHMM_主题_发件人.eml` →
  该封的全部附件逐个 `Attachment.SaveAsFile` 落原件旁边
  （`<原件名去扩展>_<附件名>`；附件名只取 basename 防路径穿越并清洗非法
  字符；同名旧附件静默跳过，单个附件失败记 warnings 不拖垮这封）→
  立刻往 `<kbRoot>/resources/mail-index/mailsYYYYMM.md` 追加**一行**八列索引
  （标题｜发件人｜收件人｜时间｜保存路径｜摘要｜线程｜备注）——「保存路径」
  列放 .eml 与本次新落附件的相对路径（多个用「；」相连）。一封信一行账。
  逐封串行，单封失败不拖垮整批（决定 7）。
- 幂等与撞名（决定 5/6）：同名同信（解析既有 .eml 头字段验身）整封跳过，
  附件也不再摸；确属另一封才追加 mail_id 前 8 位短哈希；.msg 兜底件一律按
  已保存跳过。
- 上限（决定 9）：.eml 序列化后超 25MB 拒绝落盘原件，附件照存，索引记一行
  「过大未存」。
- 收件人完整列表（主送＋抄送）只在此动词读取、只落入经人批准的索引——
  对 ADR-0019 取数通道纪律的显式例外（决定 8）。
- 成功：`{ok: true, result: {saved, oversized, skipped, missing, failed,
  warnings}}`——`saved` 每项 `{id, entryId, path, format, remark, attachments}`
  （path 相对 `resources/`；`attachments` 是本次新落附件的相对路径列表），
  `oversized`/`skipped` 带明细，`missing` 是 EntryID 列表，
  `failed` 是 `{id, message}`，`warnings` 是整批提示。
- 失败：与取数同词表，外加 KB 根未设置的 other。

两类动词共用的失败：`{ok: false, kind, message, hint}`，kind ∈
python-missing / outlook-unavailable / folder-missing / not-invocable / other。

## 提议的邮件扩展（ADR-0047/0055）

调度任务的提示词末尾带有统一的「调度约定」，教用 `kb_propose_actions`
工具提交提议（`title` + `actions` 列表，只提名值得人批准的写入、不自行
执行、没有提议就不调用）。那个统一约定只教能力无关的 KB 写入类别；
**邮件专属的动作扩展只在本能力里教**——也就是说，只有真正加载了本能力、
实际读取过邮件的任务才可使用：

- `{"kind":"delete-mails","entryId":"<邮件 EntryID>","sender":"<发件人>",
  "subject":"<主题>","reason":"<缘由>"}` ← 删除提名：只对广告、失效通知这类
  不值得留存的邮件提名。agent 只有提名权；执行在人批准后走上面的人通道
  `delete` 动词。
- `{"kind":"archive-mails","entryId":"<邮件 EntryID>","sender":"<发件人>",
  "subject":"<主题>","summary":"<摘要>","reason":"<缘由>"}` ← 保存邮件：批准后
  .eml 原件与其全部附件一起落入 `resources/mails/` 并记入邮件索引（即上面的
  人通道 `archive` 动词）。只提名值得长期留存的邮件，宁缺勿滥。

**每封邮件一条动作**，逐封展开 `entryId`/`sender`/`subject`——不要把多封合并成
一个批量动作（如 `mailIds` 数组或 `targets` 列表）：服务端校验器只认逐封字段，
批量形态整单被拒（2026-10-10 早晨事故）。

**`entryId` 填 `entryId` 字段，不是 `id`**：取数结果里 `id` 是 40 位 sha1 指纹
（去重键），`entryId` 是长十六进制串（Outlook 的定位键）。删除/保存刀只认
`entryId`；填成指纹会被服务端整批剔除（2026-10-20 事故，32 项全废）。
用 `stage_actions.py` 就不必手工抄——它只收 `id`，`entryId` 由脚本解析。

**一跑一卡（2026-10-10 裁决）**：整个任务的提名在收尾时汇总为**一次**
`kb_propose_actions` 调用——人只在一张卡上逐封勾选裁决。校验是逐项容错的：
不合格的项被点名剔除（诊断随工具结果返回），合格项照常入队；只有全部项都
不合格才整单拒绝。被剔除的项修正后随收尾的下一次调用补提即可。

**分批暂存（2026-10-20，一跑一卡的落地方式）**：积压几十封时不要「全读完
再凭记忆组装一张大卡」——上下文会被压缩吞掉，组装时只能凭记忆抄 id，正是
2026-10-20 那次 32 项全被剔除的原因。改为**每处理完一批（约 20 封）就把这一批
的动作暂存**，收尾时一次提交：

- 邮件动作（删除/归档）用 `scripts/stage_actions.py`：只给 id，脚本自己从
  Outlook 解析 `entryId`/`sender`/`subject` 并直接写进本运行的暂存文件——
  动作 JSON 不经过上下文，也就不存在抄错 id 的可能。照抄这个调用（换掉 id 与时间）：
  ```
  kb_exec_capability_script(
    name="mail",
    command="python scripts/stage_actions.py",
    input="{\"delete\":[\"<40 位 id>\"],\"archive\":[{\"id\":\"<40 位 id>\",\"summary\":\"<一句话摘要>\"}],\"since\":\"2026-10-18T00:00:00Z\"}"
  )
  ```
  `input` 放计划 JSON（字符串）；脚本从执行桥信封的 `input` 字段取它。回执只有一行
  `{ok, staged, delete, archive, total, missing}`；`missing` 非空说明有 id 不在
  该窗口里，换窗口或核对 id 后补跑一次。`delete`/`archive` 都只写 id——
  `entryId` 由脚本解析，**不要自己拼动作 JSON**。
  不确定形状时直接跑 `python scripts/stage_actions.py --help`（不读 stdin，回接口说明）——
  **不要读脚本源码、不要用 python -c 试探模块路径**：每一步都要付一轮压缩。

**一页一暂存（2026-10-20 实测节奏）**：`read_outlook.py --slim` 翻一页（40 封内）→
当场判断这一页的删除/归档 → 立刻 `stage_actions.py` 暂存 → 再翻下一页。
不要「先扫完全部、再统一判断」：上下文留不住几十封的细节，压缩一过就只剩
记忆，而记忆正是抄错 id 的来源。`entry.py` 在 agent 通道已缺省 slim（回执里
`slim: true`，`body` 为空串）——需要正文的只有少数几封，用 2 秒窗单独取。
- 其他动作（新建实体、流水、待办）数量少，照常直接调用 `kb_propose_actions`，
  但加 `draft:true` 先暂存，不要每批建卡。
- 收尾：`kb_propose_actions`（**不带 draft**）把暂存与本次 actions 合并成一张
  卡。卡建好后暂存自动清空；中途重跑某一批不会重复入卡（同一封按 entryId 合并）。
- 上下文里只记「已暂存多少项、覆盖到哪个时间」，不要记动作明细。

若本任务读取或处理过邮件，调用时再加一个 `mails` 水位参数，抄自实际取到的
批次首尾：`mails:{"lastReadAt":"<最新一封的 receivedAt>","firstReadAt":
"<最早一封的 receivedAt>"}`——人裁决提议后，这批邮件就计为已处理，不再重推。
没读过邮件就不要带这个参数：水位随人批准的提议推进，误报的范围会把那批邮件
永久计为已处理。

## 前提

1. 经典 Outlook 桌面版（「新版 Outlook」没有 COM 接口，读不了）。
2. Python 位数与 Office 一致（64 位 Office 配 64 位 Python）。
3. `pip install pywin32`。

`scripts/read_outlook.py` 也可以单独在命令行跑（`--since/--until/--limit/--folder/--slim --json`），
便于脱离工作台排查。
