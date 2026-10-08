---
name: mail
description: 读取本地 Outlook 桌面客户端的邮件，按断点增量拉取最新邮件列表。
disable-model-invocation: true
---

# 邮件能力

yantao 工作台的邮件能力（ADR-0019 建立，ADR-0021 迁移为能力目录）。它挂到当前已登录的
经典 Outlook 桌面版 profile 上（pywin32/COM），按人的断点增量读取邮件，交给工作台的
分析流程；断点只在人批准写库后推进。

能力声明（入口、运行时、appliesTo）在本目录的 `yantao.json`，不在本文件里——
SKILL.md 保持纯净，方便直接复用开源 skill 目录。

## 执行契约

入口是 `scripts/entry.py`，由工作台以子进程调用：stdin 收一个 JSON 对象
`{name, kbRoot, input, state, channel}`，stdout 回一个 JSON 对象。按
`input.verb` 分派，缺省是取数；`channel` 由宿主按真实调用方注入（人的确认
卡是 `human`，agent 的 kb_run_capability 是 `agent`），删除、归档、附件下载
三个特权动词只认前者。

### 取数（缺省动词）

- `input`：`{since?, until?, limit?, folder?, superiorAddresses?}`——`since`/`until`
  是显式翻页边界（半开区间 `[since, until)`）；都不给时用 `state.lastReadAt`，
  再没有就用 30 天前。`superiorAddresses` 是知识库里关系为 superior 的人物的
  SMTP 地址集合，只为给每封邮件算 `superiorInvolved` 旗标（ADR-0034 批次②），
  不给时旗标恒为 false。
- `state`：`{lastReadAt?}`——上次读到的水印，由工作台持久化，脚本只读不写
  （推进水印是批准后的另一个动作）。
- 成功：`{ok: true, result: {since, until?, lastReadAt?, stale, messages, hasMore}}`，
  `messages` 每封 `{id, entryId, receivedAt, senderName, senderAddress, subject, body, truncated, toMe, superiorInvolved, conversationId, conversationTopic}`；
  `body` 至多 12000 字；`toMe` 是我与这封邮件的关系（to 主送 / cc 抄送 / none 都不是 /
  unknown 认不出）；`superiorInvolved` 是收件人中是否命中上级地址集合（布尔，ADR-0034
  批次②）——两者都只回关系或旗标，不含其他收件人的名字或地址；`conversationId`/`conversationTopic`
  是 Outlook 的会话键与会话主题（Outlook 2010+），读不到时为空串，客户端据此前提
  归并线程、缺失时回退按主题剥 RE/FW 前缀分组。

### 删除（`verb: 'delete'`，仅人通道，ADR-0034 决定 5）

- `input`：`{verb: 'delete', ids: [entryId, …]}`——要移走的邮件的 Outlook
  EntryID 列表，来自提案卡上人勾选的删除提名。
- `channel` 必须是人通道：信封里的 `channel` 由宿主注入、调用方伪造不了，
  agent 通道在此被拒（`not-invocable`）——agent 只有删除提名权，没有执行权。
- 去处是「已删除」文件夹（移动，不是永久删除，回收站里可捞回）。
- 成功：`{ok: true, result: {moved, missing, failed}}`——`moved`/`missing` 是
  EntryID 列表，`failed` 是 `{id, message}`；单封失败不影响其余。
- 失败：与取数同词表（python-missing / outlook-unavailable / other）。

### 归档（`verb: 'archive'`，仅人通道，ADR-0037）

- `input`：`{verb: 'archive', mails: [{entryId, summary}, …]}`——要归档的
  邮件的 Outlook EntryID（定位原件）与分析摘要（落索引「摘要」列），来自
  提案卡上人勾选的归档提案。本体在 `scripts/archive_mail.py`。
- `channel` 必须是人通道，同删除刀（ADR-0037 决定 2：agent 无自主归档权）。
- 每封的处理：COM `SaveAs` 导出 .msg → 重组为自包含 .eml（正文、头字段、
  内嵌图片、附件全在一个文件里；头字段优先取 .msg 内嵌传输头、缺项退 COM
  值，正文过 Latin-1→GBK 乱码反演——extract_msg 会把 GBK 正文流误解成
  Latin-1；依赖 `pip install extract-msg`，缺库或重组
  失败时降级存 .msg，索引备注「msg 兜底」）→ 落
  `<kbRoot>/resources/mails/YYYY/MM/YYYY-MM-DD_HHMM_主题_发件人.eml` →
  立刻往 `<kbRoot>/resources/mail-index/mailsYYYYMM.md` 追加一行八列索引
  （标题｜发件人｜收件人｜时间｜保存路径｜摘要｜线程｜备注）。逐封串行，
  单封失败不拖垮整批（决定 7）。
- 幂等与撞名（决定 5/6）：同名同信（解析既有 .eml 头字段验身）整封跳过；
  确属另一封才追加 mail_id 前 8 位短哈希；.msg 兜底件一律按已归档跳过。
- 上限（决定 9）：.eml 序列化后超 25MB 拒绝落盘，索引记一行「过大未存」。
- 收件人完整列表（主送＋抄送）只在此动词读取、只落入经人批准的索引——
  对 ADR-0019 取数通道纪律的显式例外（决定 8）。
- 成功：`{ok: true, result: {saved, oversized, skipped, missing, failed,
  warnings}}`——`saved` 每项 `{id, entryId, path, format, remark}`（path 相对
  `resources/`），`oversized`/`skipped` 带明细，`missing` 是 EntryID 列表，
  `failed` 是 `{id, message}`，`warnings` 是整批提示。
- 失败：与取数同词表，外加 KB 根未设置的 other。

两类动词共用的失败：`{ok: false, kind, message, hint}`，kind ∈
python-missing / outlook-unavailable / folder-missing / not-invocable / other。

### 附件下载（`verb: 'download-attachments'`，仅人通道，2026-10-08 提案驱动修订）

- `input`：`{verb: 'download-attachments', mails: [{entryId, summary?}, …]}`——
  要抓附件的邮件的 Outlook EntryID 列表；`summary`（分析提名的理由）落索引
  「摘要」列。本体在 `scripts/download_attachments.py`。
- `channel` 必须是人通道，同删除刀与归档刀——这是邮件能力的第三把刀：
  agent 只能在分析里提名（答复 JSON 的 `attachments` 块 → 提案卡的
  「下载附件」组），人的勾选才是落盘的扳机，agent 通道在此被拒
  （`not-invocable`）。
- 每封的处理：COM `GetItemFromID` 定位 → 非 MailItem 跳过 → 逐个
  `Attachment.SaveAsFile` 落与归档原件同目录的
  `<kbRoot>/resources/mails/YYYY/MM/YYYY-MM-DD_HHMM_主题≤40字_附件名`。
  附件名只取 basename（防路径穿越）并清洗非法字符；逐封串行，单封失败不拖垮整批。
- 索引：有新附件落地的当月，往 `<kbRoot>/resources/mail-index/mailsYYYYMM.md`
  追加一行八列（与归档同表，复用其索引函数）——「保存路径」列放本次新落的
  附件路径（多个用「；」相连），「摘要」列放 `summary`，「备注」列记
  「附件下载」。全是同名跳过的封不追行，不重复记账。
- 幂等：目标路径同名已存在就保守跳过（不比对内容，宁多跳不覆盖）。
- 成功：`{ok: true, result: {saved, skipped, missing, failed, warnings}}`——
  `saved` 每项 `{id, entryId, path, filename}`（path 相对 `resources/`），
  `skipped` 带 `{id, reason}`（无附件 / 同名已存在），`missing` 是 EntryID
  列表，`failed` 是 `{id, message}`，`warnings` 是整批提示。
- 失败：与其他动词同词表。

## 前提

1. 经典 Outlook 桌面版（「新版 Outlook」没有 COM 接口，读不了）。
2. Python 位数与 Office 一致（64 位 Office 配 64 位 Python）。
3. `pip install pywin32`。

`scripts/read_outlook.py` 也可以单独在命令行跑（`--since/--until/--limit/--folder --json`），
便于脱离工作台排查。
