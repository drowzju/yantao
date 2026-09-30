---
status: accepted
---

# 邮件原文归档：.eml 与月度索引

现有的邮件保存能力（ADR-0021 提议流、ADR-0034 v2）落盘的是纯 Markdown 笔记：frontmatter 加 `## 要点`/`## 原文`，正文截断 12000 字（`proposal.ts` 的 `resourceNote()`）——没有头字段、没有附件、没有图片。高价值邮件留了摘要，丢了原件。本 ADR 把「保存」升级为「归档」：一封完整保真的 `.eml` 原件，加一份按月组织的索引，让人和 agent 日后都能检索、能读回。

事实基础（已核实，2026-09-30）：

- 账户环境：Outlook 只挂一个 **olExchange** 账户（缓存模式）；公司 Exchange 服务器 IMAP 993/143 端口关闭，EWS 端点存在（401 要求认证）但需要另行管理域凭据。
- COM 的 `MailItem.SaveAs` 支持 `olMSG`，**不支持导出 RFC822 `.eml`**——想拿 `.eml` 必须经一次 `.msg` → MIME 的本地转换。
- 工具层边界（ADR-0026/0028）：`kb_write_resource` 只建 UTF-8 文本、拒覆盖；`kb_read_resource` 读到 NUL 字节即判二进制拒绝（`.msg` 是 OLE2 复合文档，必含 NUL，agent 读不回）；`.eml` 是纯文本 MIME（附件 base64 编码后无 NUL），**可以被当作文本全文读回**。
- 二进制入库的人通道旁路早已存在（`registerResource` 接收 `Uint8Array`，ADR-0020 拖放入库用）；ADR-0026 明确把「二进制产出」列为遗留问题，ADR-0028 预留了「能力脚本抽取」这条出路。
- 隐私纪律（ADR-0019/0034）：取数通道至今不输出其他收件人的名字或地址，只回 `toMe`/`superiorInvolved` 旗标。

决定：

1. **归档格式为 `.eml`，获取走 COM 原生导出加本地转换**：`SaveAs(.msg)` 落临时文件，能力脚本在同一进程内把 `.msg` 重组为 MIME `.eml`（正文、头字段、内嵌图片、附件全部进同一个自包含文件）。转换失败的个别邮件降级存 `.msg` 原件，索引备注 `msg 兜底`。不引入 EWS/IMAP 通道，不新增任何凭据管理。
2. **触发沿用提案批准流**：邮件分析产出归档提案（连同现有资源提案一起出现在提案卡上），人勾选批准后才执行；agent 无自主归档权，`kb_*` 保持十一，工具面纪律不破。
3. **附件只内嵌，不单独落盘**：不为此扩 `kb_write_resource` 的能力，不新增 agent 工具。「能力脚本直写 `resources/`」在此限定为归档场景——这是 ADR-0026 遗留问题的首个落地，走的是能力（人批准）通道而非工具通道，与既有边界相容。
4. **存储布局**：邮件原件落 `resources/mails/YYYY/MM/`，索引落 `resources/mail-index/mailsYYYYMM.md`（每月一个文件，当月首封归档时带头创建）。索引由执行归档的能力脚本读-改-写维护，**不给 `kb_write_resource` 开「可覆盖」口子**。子目录按月分区同时规避 `kb_read_resource` 目录列举封顶 100 的限制。
5. **命名规则**：`YYYY-MM-DD_HHMM_主题_发件人显示名.eml`。主题净化：`\ / : * ? " < > |` 替换为 `_`、截 60 字符、中文保留；发件人用显示名（公司 AD 已用数字尾缀区分重名，如 `zhang_wei31`）。撞名兜底：仅当目标文件名已存在**且内容确属另一封**（稳定哈希不同）时追加 `-短哈希` 后缀；同一名下的重复保存不发生（见决定 6）。
6. **幂等去重**：归档以 `mail_id`（sha1(收件时间|发件地址|主题)，`read_outlook.py` 既有去重键）为稳定标识，文件已存在即整封跳过——不写文件、不加索引行，运行报告里如实回报「已存在」。第二次批准等于无害空操作。
7. **逐封串行的一致性语义**：一批归档按封串行执行——`.eml` 写成功后立刻追加索引行，再做下一封；任何一封失败不拖垮整批，跳过并列运行报告。中途崩溃留下的每一对（文件＋索引行）都自洽，不存在「有文件没索引」的孤儿。
8. **索引表规范**：表头固定为 `| 标题 | 发件人 | 收件人 | 时间 | 保存路径 | 摘要 | 线程 | 备注 |`。取值：时间为本地时区 `YYYY-MM-DD HH:MM`；保存路径写相对 `resources/` 的路径（工作台挪目录不失效）；线程取 `ConversationTopic`（人读的会话主题，非 GUID）；摘要复用分析阶段 LLM 已产出的摘要，缺失时退回正文前 80 字；**收件人记完整列表**（主送＋抄送）——这是本 ADR 对 ADR-0019 的一次显式例外而非无声违背：0019 约束的是自动取数通道的输出，归档是逐封经人批准落盘的私人档案，性质不同，特此界定。备注列三态：空（正常）、`msg 兜底`（决定 1）、`过大未存`（决定 9）。
9. **单封上限 25MB**（`.eml` 序列化后计）：超限拒绝归档，索引里记一行「过大未存」（只有元信息、没有文件），运行报告同步提示。资源目录要进个人远端同步，不能被巨型附件撑爆。
10. **改 builtin 脚本必须同提交抬 sidecar 版本号**（ADR-0034 落地注记二的教训，此处预先入账）。

取舍台账——为控制牺牲的便利性：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | `.msg`→`.eml` 转换，极端格式（RTF 特殊排版、OLE 对象）可能降质 | 零凭据管理、零网络改动，复用现有 COM 会话；agent 能全文读回归档件 | 转换质量问题实际出现，或愿意接管一份域凭据时改走 EWS `MimeContent`（无损） |
| 2 | 附件不单独落盘，agent 读不到附件内容 | 不破 ADR-0026/0028 的工具层纪律，归档件单一自包含 | agent 出现真实的「读附件」需求，届时按 ADR-0028 预留的能力脚本抽取路线补 |
| 3 | base64 使附件体积膨胀约 33%，且 25MB 封顶 | 资源目录可安心进个人同步 | 个人同步空间告急时再议分级存储 |
| 4 | 收件人完整入索引，突破了 ADR-0019 的输出克制 | 索引作为档案的完整性（谁参与过的会话一眼可见） | 无——已用「人工批准的归档 ≠ 自动取数通道」界定，不算违背 |

原因：

- **为什么 `.eml` 而非 `.msg`**：归档的目的是「日后能读回」。`.msg` 是微软私有复合文档，`kb_read_resource` 判二进制拒绝，agent 面对着索引里的路径却打不开黑盒，「保存」只剩半个意义；`.eml` 是开放标准（RFC 822/5322），任何邮件客户端能开，本项目的工具能全文读回，长期归档不绑生态。
- **为什么经 `.msg` 转换而不直连 EWS/IMAP**：IMAP 已核实不可行（服务端端口关闭）；EWS 可行但要求在凭据存储里养一份域账号密码，密码轮换即断，认证形式（NTLM）还需联调。转换路径复用已登录的 COM 会话，失败模式清晰（转不动就留 `.msg`），是工程上最便宜的合规路径。
- **为什么索引由能力脚本维护而非新增工具能力**：「追加一行索引」本质上是归档动作的一部分，和人批准的删除（ADR-0034 决定 5）同属能力通道行为；为它给 `kb_write_resource` 开覆盖权限，是把一个一次性场景的需求固化进所有人都要遵守的工具契约，得不偿失。
- **为什么撞名兜底平时不挂哈希**：文件名是给人扫的目录用的，满屏哈希毁掉可读性；日期时间＋主题＋发件人在现实中几乎不可能撞（同分钟、同主题、同人），哈希只在真撞车时出场。

后果：

- `packages/api/yantao-kb-controller`：`builtin/mail/scripts/` 新增归档动词（`.msg` 导出＋`.eml` 转换＋索引维护，含 25MB 闸与幂等检查），`yantao.json` sidecar 抬版本号（决定 10），能力声明按需扩展。
- `packages/client/ui-yantao`：`mail-analysis.ts` 输出 schema 增归档提案槽位、`proposal.ts` 新提案类型与归档动作、`ProposalCard.tsx` 归档确认卡、locales。
- 文档同步：`docs/yantao/README.md` ADR 索引（本条）、`docs/yantao/TODO.md` 入 next。
- 零新 agent 工具、零上游文件改动、零新 yantaoKb RPC（归档复用既有能力运行通路）。
- 遗留给实现期的开放点：`.msg`→`.eml` 转换选型（自研重组或引入解析库）在施工时定，若引入第三方依赖须过 vendor manifest 门禁。

落地注记（2026-09-30）：

- **转换选型**：采用 `extract_msg` 库解析 `.msg`，脚本内用标准库 `email.message.EmailMessage`（`policy=SMTP`）重组 MIME——html/纯文本走 `add_alternative`，内嵌图片按 `content-id` 挂 `add_related`，其余附件 `add_attachment`。`extract_msg` 是**可选依赖**：能力运行环境未安装时整批降级存 `.msg` 原件（警告 `converter-missing`），归档永不为转换器缺席而失败；单封转换异常同样降级（`conversion-failed`，备注 `msg 兜底`）。
- **幂等的落地形态**（决定 6 的细化）：文件名不含哈希，故「已存在即跳过」升格为身份核对——用 `BytesParser(headersonly)` 读已存 `.eml` 的头（主题、发件人地址、分钟级时间戳）与当前邮件比对，相同才是重复保存；不同则走决定 5 的 `-hash8` 兜底。`.msg` 兜底件无头可读，保守视为已归档直接跳过。
- **归档动词**：`entry.py` 新增 `archive` 动词，与人批删除同款宿主证词门（`channel` 非 `human` 一律 `not-invocable`，决定 2 的机制面）；输入 `{mails:[{entryId, summary}]}`，输出 saved/oversized/skipped/missing/failed/warnings 六桶，`saved` 行带落盘路径与备注，`oversized` 带 entryId 供客户端对账。
- **客户端链路**：`mail-analysis.ts` schema 增 `archives` 槽位（模型只提名永久有价值邮件，宁缺勿滥）；`proposal.ts` 增 `archive-mails` 动作组（确认卡上独立分组「归档邮件（.eml 原件）」，标签显主题）；`proposal-apply.ts` 逐封调 `remote.archiveMails`（一次一封，决定 7），`skipped` 如实呈现。缝为可选（`mailArchive?: Archiver`），无脸的嵌入方诚实跳过，与 `mailDelete` 同款。
- **隐私边界复核**：取数/分析通道依旧不碰收件人列表；收件人完整入索引发生在归档脚本从 COM 现读的那一刻（决定 8 的显式例外，逐封经人批准）。
- **sidecar 版本**：`yantao.json` 6 → 7（决定 10），播种器按版本比对自动重播。
- 验证：三包 845 测试全绿，`tsc -b packages/client/ui-yantao` 干净，scoped oxlint 0/0，client bundle 重建，Python 脚本 `py_compile` 通过。

落地注记补遗（2026-09-30 评审修复）：首轮代码评审的七条发现逐一落实——
- **防撞验身的 Date 解析**：既有 `.eml` 的 Date 头是 RFC 2822 形状，原先按 ISO `strptime` 解析必然失败、防撞恒走「不同一封」误判分支；改用 `parsedate_to_datetime`（解析不动按 None 保守处理）。
- **内嵌图片挂点**：`add_alternative` 之后 root 已是 multipart/alternative，`add_related` 直挂会把图片挂成第三个兄弟分支、严格客户端解析不到 cid；改挂到 text/html 所在的 multipart/related 子件（`get_payload()[-1]`）。
- **重组段整体保护**：头组装、正文挂载、附件循环到 `as_bytes()` 整体纳入同一 try，组件期任何普通异常统一译成 `conversion-failed`，保住 `.msg` 兜底承诺。
- **From 地址守卫**：X.500 型地址不进 `formataddr`，只写显示名。
- **To/Cc 分写**：`recipients_of` 改返回 (主送对, 抄送对)，`.eml` 头按 To/Cc 分写，索引「收件人」格仍是合并视图。
- **索引原子替换**：`append_index_row` 改同目录临时文件 + `os.replace`，中途崩溃不会把已有行截断在半路。
- **杂项**：未用变量清理（`conversation_id` 弃用、`datetime` 导入回收）；`types.ts` 的 `KbMailArchiveResult` 注释注明各桶 `id` 口径（skipped/failed 是原始 EntryID，saved/oversized 是 mail_id 稳定哈希、另带 entryId 字段）。`py_compile` 复验通过。
