---
status: accepted
---

# 任务会话详情

「任务」tab（ADR-0031）给了一次执行一行概览——标题、阶段、耗时——但审计时要回答的问题不止于此：这次提炼到底发了什么提示词？邮件分析的模型调用了哪些工具、参数是什么、结果如何？这些答案已经全部躺在盘上——提炼与邮件分析各自跑在一个真实的 dsh 会话里，会话日志是逐事件溯源的——只是任务行从未记下自己在哪个会话，UI 也没有一个读它的窗口。本 ADR 补上这个窗口：任务行获得「详情」，一只只读抽屉，把那次执行的会话原样摊开——提示词逐条、回复逐条、工具调用做成可折叠的节点链。发起路径零改动：详情纯粹是回头看，不影响任何运行中的东西。

事实基础（已核实）：dsh 会话的全部事件（`user/message`、`assistant/message`、`tool/call`、`tool/result`、回合括号）都已持久化在会话日志里，冷读不需要任何新机制；上游 session controller 的生成客户端 face 里已有 `page` RPC（按消息对齐的历史分页，`throughSeq`/`beforeSeq`/`maxMessages`）与 `follow` 流（开头的 snapshot 帧携带 cursor、当前窗口与 `hasMore`），两者正是传输层自己用来做冷读的组合；`session-controller` 是上游包、不在合并面，不能给它加方法；`TaskRow` 此前没有 sessionId；提炼与邮件分析本来就把会话 id 留在手里（`RefineRun.sessionId`、`runMailAnalysis` 的返回与进度回调），只是没人消费；指令型能力（无 entry）走 `promptSession` 后不建任务行（ADR-0031 既定行为），脚本能力是裸子进程、根本没有会话日志。

决定：

1. **任务行带会话锚点**：`TaskRow` 增 `sessionId: string | null`，由运行 Owner 在会话建立后尽快回填——提炼在 run 落回时（空会话的跳过哨兵 `''` 映射为 null），邮件分析经进度回调携带、store 透传、Frame effect 镜像进行。锚点为 null 的行不渲染「详情」。
2. **详情入口只覆盖有会话的两类行**：提炼与邮件分析。「查看」与「详情」并存——前者跳到结果的归宿（会话 tab / 能力页签），后者摊开会话流水本身。脚本能力行既无锚点也无流水，天然缺席；指令型能力不建行，无须处理。
3. **零新 RPC、零上游改动**：读盘走上游已有的两个面——开一条 `follow`，取其开头 snapshot（对进行中的任务即已落盘的部分），随即中止弃流；`hasMore` 时用 `page` 以 `beforeSeq = 已有最老 seq` 向前回溯直至穷尽。客户端 `remote.ts` 的手写 `SessionRemote` 镜像只补 `page` 的类型声明（生成的 face 本就有它）。
4. **只读结构化视图，识别规则钉死在纯模块**：`detailFromEvents` 把事件流整形为三类条目——用户消息逐条原文（`source.kind !== 'user'` 的注入消息——技能正文、系统通知——弱化显示）、助手回复逐条原文（纯工具步无文本则跳过）、工具调用按 `callId` 与结果配对成节点（默认收起，头部显示工具名 + 参数摘要，点开展开参数与结果全文，失败带错误标识）；回合之间画分隔线。回合括号、步进标记、请求头、未提交任何内容的助手尝试一律不算条目。**系统提示词不展示**——它在请求时分层注入（ADR-0022），从来不是一个事件，隐藏它零成本。
5. **裁剪上限**：单条用户/助手文本 16k、工具参数 4k、工具结果 8k，截断处追加「（过长，已截断）」标记——审计读的是轮廓与证据，不是全文转写。
6. **抽屉形态**：任务 tab 盒内的绝对定位浮层（tab 盒本就是 positioning 上下文），独立滚动，不溢出到相邻 tab；Esc、关闭钮、点遮罩三种方式收回；`key` 绑定行 id，换行重开即重读。进行中的任务读到已落盘的部分为止，重开刷新。
7. **任务行仍是前端记忆**（ADR-0031 决定 6 不动摇）：重启后行没了，「详情」也就无处安放——但会话本身还在盘上，会话列表与对话 tab 依然找得到它。「任务落盘登记」记入 TODO 的 deferred。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 快照到手即弃流，不实时跟流 | 进行中的任务显示「已落盘部分」这一语义足够简单；不用管理流的取消与重连 | 需要「开着抽屉看实时流出」时保留 follow 并随帧追加 |
| 2 | 无会话锚点的行没有详情 | 不给裸子进程伪造流水 | 脚本能力改走会话化执行时补锚点 |
| 3 | 文本/参数/结果裁剪 | 抽屉不被单条巨型消息撑爆 | 需要全文取证时点「查看」进宿主会话面 |
| 4 | 行不落盘，重启不可回看 | 零后端任务模型（ADR-0031 台账 #1 维持） | 见 deferred「任务落盘登记」 |

原因：

- **为什么复用 `page` 而不加 read RPC**：最初设想给 session namespace 加一个 `read(sessionId)`。读码后发现上游已经把这件事做完了——`follow` snapshot + `page` 正是它自己传输层的冷读路径，语义（消息对齐、独占上界、hasMore）齐全且有官方用法先例。借现成的面，合并面一寸不涨，`yantaoKb` RPC 个数不动。
- **为什么整形规则放纯模块**：哪些事件算条目、什么算注入、怎么配对——这些是审计语义，错了比崩溃更糟（悄悄误导）。纯模块 + 单测钉死，React 不掺和。
- **为什么工具调用默认收起**：一次提炼动辄几十次工具调用，全展开是噪音；名字 + 参数摘要在收起态已够扫读，证据在点开后。
- **为什么注入消息要弱化而非隐藏**：审计恰恰要看见「模型其实被告知了什么」——技能正文、系统注入的通知都是答案的一半；只是它们不是人说的，视觉上要分开。

后果：

- `packages/client/ui-yantao` 增量：`session-detail.ts`（纯模块：`DetailItem`/`detailFromEvents`/`loadSessionDetail`）、`SessionDetailDrawer.tsx`（抽屉）、`task-view.ts`（`TaskRow.sessionId`）、`remote.ts`（`SessionRemote.page` 声明）、`mail-analysis.ts`（进度回调带 `sessionId`）、`mail-run.ts`（state 透传）、`frame/Frame.tsx`（回填两路 + `detailRow` 状态 + 装配）、`frame/CenterPane.tsx` 与 `frame/TasksPane.tsx`（入口与挂载）、`index.ts`（`sessionDetail` 装配）。
- **零新工具、零新 RPC、零上游文件改动**：`kb_*` 保持十一，`yantaoKb` RPC 个数不动，session-controller 不碰。
- 文档同步：`docs/yantao/README.md` ADR 索引（本条）、`docs/yantao/TODO.md`（done 行 + deferred「任务落盘登记」）、`packages/yantao/CONTEXT.md` 工作台词条补「详情」。

落地注记（2026-09-23）：全部落地，单批提交。`loadSessionDetail` 的取数顺序：`follow` snapshot（cursor/records/hasMore）→ `opener.abort()` 弃流 → `while (hasMore)` 以 `beforeSeq` 回溯拼页 → `detailFromEvents` 整形。验证：ui-yantao 测试全绿（session-detail 8 例：配对/注入判定/裁剪/脚手架剔除 + 分页循环三例），`tsc -b tsconfig.client.json` 干净，client bundle 重建。
