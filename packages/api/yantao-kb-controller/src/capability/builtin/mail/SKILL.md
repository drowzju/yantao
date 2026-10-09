---
name: mail
description: 读取本地 Outlook 桌面客户端的邮件，按断点增量拉取最新邮件列表。
disable-model-invocation: true
metadata:
  yantao:
    version: 13
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

## 提议信封的邮件扩展（ADR-0047）

调度任务的提示词末尾带有统一的「调度约定」，教一个提议信封（`{"title":…,
"actions":[…]}`，只提名值得人批准的写入、不自行执行、没有提议就沉默）。
那个统一约定只教能力无关的 KB 写入类别；**邮件专属的信封扩展只在本能力里
教**——也就是说，只有真正加载了本能力、实际读取过邮件的任务才可使用：

- `{"kind":"delete-mails","entryId":"<邮件 EntryID>","sender":"<发件人>",
  "subject":"<主题>","reason":"<缘由>"}` ← 删除提名：只对广告、失效通知这类
  不值得留存的邮件提名。agent 只有提名权；执行在人批准后走上面的人通道
  `delete` 动词。
- `{"kind":"archive-mails","entryId":"<邮件 EntryID>","sender":"<发件人>",
  "subject":"<主题>","summary":"<摘要>","reason":"<缘由>"}` ← 保存邮件：批准后
  .eml 原件与其全部附件一起落入 `resources/mails/` 并记入邮件索引（即上面的
  人通道 `archive` 动词）。只提名值得长期留存的邮件，宁缺勿滥。

若本任务读取或处理过邮件，信封再加一个 `"mails"` 水位字段，抄自实际取到的
批次首尾：`"mails":{"lastReadAt":"<最新一封的 receivedAt>","firstReadAt":
"<最早一封的 receivedAt>"}`——人裁决提议后，这批邮件就计为已处理，不再重推。
没读过邮件就不要带这个字段：水位随人批准的提议推进，误报的范围会把那批邮件
永久计为已处理。

## 前提

1. 经典 Outlook 桌面版（「新版 Outlook」没有 COM 接口，读不了）。
2. Python 位数与 Office 一致（64 位 Office 配 64 位 Python）。
3. `pip install pywin32`。

`scripts/read_outlook.py` 也可以单独在命令行跑（`--since/--until/--limit/--folder --json`），
便于脱离工作台排查。
