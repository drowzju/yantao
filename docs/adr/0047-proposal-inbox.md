---
status: accepted
---

# 提议收件箱：无人值守运行的决策队列

出发点（2026-10-05 裁决，grill 两轮回合）：调度任务到点在后台独立会话跑提示词（ADR-0045），但跑完只剩一条 80 字的系统通知——人工点邮件能力那样「最后弹提议卡让人决策写入」的闭环，在没人盯着的场景里断了。裁决五问：调度照旧后台跑、可回看（问 1 选 C）；决策面复用 ProposalCard 单一面孔（问 2 选 C）；到点直接跑、不先征求同意（问 3 选 A）；完成触达沿用 UI 内通知 + `yantao:notify` 桥（问 4 选 A）；队列放 controller 侧持久化（问 5 选 A）。

事实基础：

- **提议卡至今是纯前端内存物**：mail-run 的 review、Frame 的 `capabilityProposal` useState 都是「deliberately not persisted」——有人守着屏幕时弹卡即决策，无人值守产出的提议没有人守着弹，必须落盘等人回来。
- **统一提议 schema 已有单一权威**：客户端 `proposal.ts`（ADR-0021 决定 4）定义 12 种 action；`applyProposal`（proposal-apply.ts）是人类通道的现成写入器，Frame 的 `applyConfirmed` 缝已在三张卡上服役。
- **机器簿记落 `<kbRoot>/.dsh/yantao/`**（ADR-0024）；`schedules.json` 的 store 配方（全量替换写、写前校验、缺文件即空、坏文件响亮报错、`<前缀>_<base36 ms>_<random>` id）可直接复刻。
- **调度器是前端代码**（ADR-0045 决定 2），天然属于人类通道——让它做队列的唯一生产者不破信任边界。
- **会话回看现成**（ADR-0033 详情抽屉）：提议入队后注明「会话可在任务页回看」，证据不必搬进队列。

决定：

1. **持久化队列在 controller 侧**：`.dsh/yantao/proposal-inbox.json`，store 仿 schedules.json——`enqueueProposal`（追加）/ `resolveProposalInboxEntry`（决策）两类写，写前全量校验；未决软帽 50（满了拒收，逼人去决策）、总量硬帽 200；条目 id `prp_<base36 ms>_<random>` 同配方。`yantaoKb` remote 增 `proposalInboxList` / `proposalInboxEnqueue` / `proposalInboxResolve` 三 RPC。
2. **生产者唯一且是人类通道代码**：前端调度器在 run 结束时解析答案（裸 / ```json 围栏 / 尾随散文的 JSON 信封均可，unknown-kind 行静默剔除、剔光不算提议）入队；**agent 没有任何收件箱工具**——不读、不写、不提案。信任锚仍是两级人类动作：创建调度 + 批准提议。
3. **载荷不透明**：store 层只校验形状（对象带非空 `actions` 数组，加上来源/标题/状态配对等框架校验），schema 权威留在客户端 `proposal.ts`；wire 上是 `JsonValue`，controller 边界一次 cast。行动词汇演进时 store 永远不用改。
4. **决策面零新面孔**：中栏第四常驻 tab「提议」，待决行在前、已决策带章（已批准/已丢弃 + 时间）在后；点击待决行弹出同一张 ProposalCard——卡底的取消即丢弃（2026-10-05 验收修正：原案「取消只关卡、行保持待决」逼人再点第二次丢弃，废弃；卡一关必有裁决，丢弃钮与取消合并为一枚，Esc 同裁），批准（写入 N 项）为主行动钮；批准先走 `applyConfirmed` 人类通道写入，成功才落 `approved`；丢弃直接落 `discarded`；**决策终局，不可重开**。
5. **解析失败逐级降级**：答案不含提议 → 纯通知不变；入队失败 → 纯通知兜底（run 本身算成功，答案活在会话里）；已入库载荷回读解析不了（手工改文件、旧词汇）→ 行内降级对话框，只可丢弃。
6. **触达指向决策面**：落了提议的通知正文改为「产生了待决策的提议，去『提议』页处理」（卡片才是答案，不复述）；收件箱读取搭调度扫描便车（30s 一拍）+ run 落提议后立即拉取；tab 徽标显示未决数。
7. **提示词约定随 fire 附加**（2026-10-05 验收修订，原为「入文档靠作者自觉」）：调度器在每次 fire 时把信封约定段（`withProposalEnvelope`）拼到提示词末尾——约定教 schema、要求值得拍板的写入不自行执行、允许无提议沉默。首次验收即证明靠作者自觉不可行：邮件调度按旧约定未写约定段，run 产出散文报告，解析命中率 0%，台账 #4 的重开条件当场命中。
8. **邮件水位随裁决联动**（2026-10-05 验收修正 2）：信封约定含可选 `mails` 范围字段（模型抄实际批次首尾的 `receivedAt`），随载荷入队、显示在队列行 note 上（覆盖邮件 9-17 → 10-1）；人**批准或丢弃**该提议时，Frame 经 `mailMarkRead` 把水位推过范围——与手动面板 confirm/dismiss 的「看过即处理」完全同义，下次读邮件不再重推同批。丢弃也计处理是刻意的对称：人打开了卡、看到了裁决面，与手动 dismiss 不写也计读一致；水位写入失败静默，下次读取以主机水位为准（手动 `moveCursor` 的既有纪律）。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 队列文件在 KB 内，离线同步会连已决策行一起带走 | 与 ADR-0024 一致的落点、controller 侧持久化免费获得 | 已决策行膨胀拖累同步体积时加清理策略 |
| 2 | 批准是「先写后标」两步，标记失败期间行仍待决、再批会双写 | 零新事务 RPC，apply 失败行保待决可重试 | 出现真实双写事故时合并为单事务 RPC |
| 3 | agent 完全看不见收件箱 | 信任锚纯粹、工具面零增长 | 需要 agent 感知待决提议时另立 ADR |
| 4 | 每次调度 fire 的提示词多出一段固定约定（数百 token） | 解析命中率不再依赖作者自觉，任何调度零成本产出提议卡 | 约定段显著干扰任务本身时改为按调度开关 |
| 5 | 未决满 50 条直接拒收新提议 | 队列腐化的硬预警 | 出现高频正当产能时调帽 |

原因：

- **为什么队列在 controller 而不是前端 localStorage**：提议是「人还没做的决定」，必须活过刷新与重启——这恰与任务行（ADR-0031 前端内存）相反；controller 侧文件还顺带被离线 bundle 同步带到另一台机器。
- **为什么坚持一张卡**：邮件卡/校验卡两副面孔的教训（2026-10-05 样式统一裁决）——第二张决策卡就是第二套心智；收件箱卡只多了来源行与丢弃钮，其余与能力卡的肌肉记忆完全共享。
- **为什么 store 层不认识 action 词汇**：词汇在长（12 kinds 之后还会有），opaque 载荷让存储与 wire 永不随词汇改动；校验职责两端各拿一半——入队时客户端解析器把关，回读时客户端再验一遍，中间谁都不信任。
- **为什么决策终局**：批准即写入知识库，撤销要靠逆向动作而不是重开队列；重开会让「已批准」变成可协商状态，队列就不再是承诺而是草稿。

后果：

- `packages/yantao/kb`：新增 `proposal-inbox.ts`（store 全套 + 校验 + 软帽），index 再导出。
- `packages/api/yantao-kb-controller`：`yantaoKb` 增三 RPC 与 wire 类型（载荷 `JsonValue`），typert host 产物与 remotes 聚合层重建。
- `packages/client/ui-yantao`：tabs 第四常驻键；CenterPane 徽标与 pane 盒；新 `InboxPane`；ProposalCard 可选 `onDiscard`；capability-match 增 `proposalOfAnswer`（答案解析）与 `proposalOfPayload`（回读校验）；scheduler run 末尾入队；Frame 持收件箱状态、批准/丢弃接缝与轮询接线。
- `packages/yantao/CONTEXT.md`：工作台 tab 枚举扩为四个，「提议收件箱」词条。
- 文档：docs/yantao/README.md ADR 索引入列；development.md 记提示词约定。
- 测试：store 校验/往返/软帽/决策流（17 例）、RPC 面（6 例）、答案解析与载荷回读、InboxPane 渲染与两裁决、ProposalCard 丢弃钮，随施工补齐。

落地注记(2026-10-05,施工完成,三批):**批次1 kb+controller**:`proposal-inbox.ts` 仿 schedules 配方(normalizeInboxEntries 全量校验:id 唯一/ISO 日期/来源标题长度帽/载荷非空 actions/status-decidedAt 配对,中文报错 UI 原样展示;ENOENT 即空、坏文件响亮;软帽 50 硬帽 200);controller 三 RPC + `inboxError` 映射(not-found 归 not-found),wire 载荷 `JsonValue`、边界一次 cast;proposal-inbox.spec 17 例、proposal-inbox-rpc.spec 6 例。**批次2 调度入队**:`proposalOfAnswer` 解析(jsonCandidatesOf:围栏→全文→最外层花括号;首段解析出非空已知 kind 行即胜);scheduler run 末尾解析入队(source=`schedule:<id>`、note 指回任务页),入队失败静默降级纯通知;ScheduleRunner 增 id/proposalId;client/index 贡献面挂三 RPC;通知文案分流;scheduler.client.spec 增 5 例。**批次3 决策面**:INBOX_TAB + CenterPane 第四 tab(未决徽标)+ InboxPane(待决在前、点击弹共享卡、行级丢弃、不可解析降级对话框)+ ProposalCard 可选 onDiscard(丢弃鬼钮并排主行动钮)+ proposalOfPayload 回读校验 + Frame 收件箱状态/装载(启动+扫描便车+run 落提议即拉)/批准(applyConfirmed 成功才 resolve approved)/丢弃直 resolve;inbox-pane.client.spec 8 例、proposal-card/scheduler/workbench spec 相应扩充;tsc 窄构建、oxlint、ui-yantao bundle、remotes 聚合重建全部干净。**验收修正(同日)**:首封调度邮件 9:20 触发,run 成功但答案无信封、命中率 0%——调度提示词 `/mail 向后解析邮件` 未带约定段,决定 7 原案(作者自觉)失效;依台账 #4 重开条件改为调度器 fire 时经 `withProposalEnvelope` 统一附加约定(schema 教学 + 不自行执行 + 允许沉默),scheduler.client.spec 增 2 例,development.md 约定条目同步改写。**验收修正 2(同日,第二轮反馈)**:①取消即丢弃——决定 4 原案(取消只关卡)被否,ProposalCard 的 onDiscard 存在时取消钮合并为丢弃、Esc 同裁,InboxPane 两裁决均关卡;②邮件水位联动——决定 8 新增:信封可选 `mails` 范围(proposalOfAnswer/proposalOfPayload 透传,mailsOf 宽松校验),入队 note 显范围,Frame 批准/丢弃后 mailMarkRead 推水位(失败静默);scheduler.client.spec 增 4 例、inbox-pane spec 改 1 增 1。
