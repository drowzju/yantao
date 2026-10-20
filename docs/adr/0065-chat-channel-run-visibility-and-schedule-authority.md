---
status: accepted
---

# 会话通道的运行可见性与调度全权

出发点（2026-10-19 事故裁决）：用户在钉钉里让 agent 触发了一条工作空间指令（`kb_run_workspace_instruction`，
ADR-0063），转头追问「跑得怎么样」，agent 答不上来——它能拿到 runId（扳机），却没有任何后视镜：
`kb_list_workspaces` 只回指令定义，运行历史、提议收件箱、调度名册、会话洞察四个面 agent 连只读都够不着。
同期盘点左下角按钮背后的工作台能力（运行历史/停止/清理、提议收件箱、调度页、会话洞察），按「追问什么就放开什么」
的最小面原则立案本篇。

事实基础：

- **运行记录的存储与日志早已落盘**（ADR-0056）：`.dsh/yantao/workspace-runs.json` 全量行 + 逐步日志
  `sessions/workspace/<runId>.log`，UI 的运行历史面板就是它们的读者——缺的只是 agent 工具面。
- **提议收件箱同理**（ADR-0047）：`proposal-inbox.json` 有 store 有 RPC，agent 只有提名工具
  （`kb_propose_actions`/`kb_propose_skill_rewrite`），看不见自己提的案子如今是什么状态。
- **调度面 agent 零工具**（ADR-0045 决定 4：「agent 无任何调度工具（不读、不写、不提案）」，台账 #3 写明
  重开条件——「出现让 agent 知道有哪些定时任务的真实需求时」）。这个条件今天成立了：用户在钉钉里问
  「收邮件是不是每天 8 点？」并进一步要求「改成每天 8 点」。
- **在场即授权已是现行法**（ADR-0061 决定 1、ADR-0063 推广）：对话里的明确要求本身就是授权；定时会话
  （无人监督）由 `assertInteractiveSession` 闸拒绝——这套闸在 ADR-0063 已经受住了待办/记忆/工作空间
  三族的检验。
- **推送的 P2 欠账在案**（ADR-0060 补记四）：提议入队推送已通，运行完结推送与裁决知会列 P2 待办。
- **cordis 事件广播配方现成**（ADR-0060 补记二教训）：广播必须挂在最底层写点——runtime 的终态补丁点，
  而不是某个 RPC 入口。

决定：

1. **三个只读工具，不设闸**：`kb_list_workspace_runs`（按 runId/workspaceId 过滤、limit 封顶 20、可选带回
   日志尾 100 行与失败步错误）、`kb_list_proposals`（pending/decided/all 过滤、落库失败计数；载荷本身
   不过线——那是不透明 JSONValue，钉钉侧只需要知道有几件、什么状态）、`kb_list_schedules`（全字段含
   簿记戳）。读不消耗额度、不写任何东西，与 `kb_list_workspaces` 同待遇。
2. **调度全权写入（推翻 ADR-0045 决定 4 的写半边）**：`kb_add_schedule`/`kb_update_schedule`/
   `kb_remove_schedule` 三工具，增删改都行（用户裁决「全权」，超出「只许改 cron」的保守案）。门 =
   `assertInteractiveSession`（ADR-0063 在场即授权）：人在对话里提的要求就是授权；定时会话三件全拒。
   更新是单行补丁且永不携带簿记戳（`lastFiredAt`/`lastMissedAt` 只在库内流转，陈旧快照回不去——
   ADR-0045 落地注记二的配方延伸）；`capability:''` 显式清空关联能力。台账 #3 的重开条件就此兑现，
   额度信任锚从「定义创建时的人」转移到「对话现场的人」。
3. **运行完结推送钉钉（ADR-0060 补记四 P2 落地一半）**：runtime 三个终态补丁点（success/failed/stopped）
   各 emit 一次 `yantao-kb/workspace-run` 事件，连接器的 `RunPusher` 订阅后给属主推 markdown 结果卡
   （指令/触发/耗时/结果摘要/失败原因 + 「完整日志见工作台」指路）——纯知会富明细，决策仍在工作台
   （ADR-0060 补记四的定稿姿态）。
4. **不推的两种状态**：`interrupted` 意味着控制器自己死了（dispose 直补存储、不经广播点），推也没人推；
   `missed` 是簿记噪音。两者都不 emit、不推。
5. **提议裁决知会 + 回声抑制**：`proposalInboxResolve` 广播的 resolve 事件由连接器转译为四态裁决 markdown
   （✅ 已批准 / 🟡 部分批准带失败计数 / 🔴 零写入 / ⚪ 已丢弃）。卡片回调发起的裁决不回推——回调前把
   条目 id 记入 `selfResolvedIds`，resolve 事件到达即消费跳过；回调失败撤销登记，他处（工作台）做出的
   裁决照常推。
6. **调度定义热生效**：agent 经三写工具改完 `schedules.json` 后，前端调度器不必重启——Frame 的 tick 在
   每拍重拉一次调度清单，且这次重拉尾链进既有的串行写队列：重拉永远排在在途本地写之后，谁也踩不
   了谁的 `lastFiredAt`（ADR-0045 落地注记二「两类写不互踩」的第三种写加入同一队列）。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | agent 能自主增删会花钱的调度（现场有人盯着，但事后无复核） | 「收邮件改成每天 8 点」一句话直达，不必人开工作台 | 出现误改/意外花费时，把三写工具降回只读或加提名制 |
| 2 | 调度写不走提议收件箱（不像 `kb_propose_actions` 那样人批后执行） | 对话即时生效；提议流对「改个时间」这类琐碎太重 | 现场授权滥用出现时改走 ADR-0047 |
| 3 | 运行推送只有三终态，interrupted/missed 静默 | 控制器死亡时无人被误导；簿记噪音不扰手机 | 用户要求「停机也告诉我」时给桌面壳补遗言通道 |

原因：

- **为什么读不设闸、写设闸**：全库一致的信任梯度——读无害（ADR-0063 的 `kb_list_*` 先例），写有额度和
  副作用。调度写的特殊性在于它会自主消耗模型额度，所以门比待办/记忆更严一格：必须在场（ADR-0063 闸），
  且只对交互会话开放。
- **为什么广播挂 runtime 不挂 RPC**：ADR-0060 补记二的教训原样适用——运行的终态写点在 runtime
  （成功/失败/停止三条路径），RPC 入口（`workspaceRun`）只覆盖手动触发一种来源，定时与 agent 触发都会
  旁路。挂在 `patchAndNotify` 单点上，三种触发来源同权。
- **为什么推送纯知会**：ADR-0060 补记四的用户裁决（不在手机端操作）直接延伸到运行结果——日志与重跑
  都在工作台，消息只负责「跑完了、结果如何、去哪看」。

后果：

- `packages/api/yantao-kb-controller`：六个新工具（二十五→三十一）+ `WorkspaceRuntime.onFinalized` 回调 +
  `yantao-kb/workspace-run` 事件（types.ts Events 接口）。
- `packages/yantao/dingtalk-connector`：`run-push.ts` 新增（RunPusher）+ `proposal-push.ts` 增 resolve 分支
  与回声抑制 + `index.ts` 接线（订阅事件、账户启停时挂/摘通道）。
- `packages/client/ui-yantao`：Frame tick 重拉调度清单（尾链写队列）。
- AGENTS.md 硬规则 2 同步（三十一工具 + 调度条款）；ADR-0045 台账 #3 与决定 4 标注「已由 ADR-0065 重开」。
- 测试：controller 六工具（direct-write-tools/capability-tool 顺序断言）、runtime 三终态广播与 interrupted
  静默（workspace-rpc）、连接器三终态推送与四态裁决（run-push/proposal-push）。
- 生效条件：宿主持旧模块，需重启工作台。

落地注记（2026-10-19，施工完成）：全链路一批落地。**controller**：六工具按 ADR-0063 的
`kb_list_workspaces`/`kb_run_workspace_instruction` 之后注册（`kb_list_workspace_runs` 支持
runId/workspaceId 过滤、limit 缺省 10 封顶 20、`includeLog` 带回日志尾 100 行（读不到优雅降级）与失败步
error 提取；`kb_list_proposals` 默认 pending、载荷只出摘要字段不透传 proposal 体；`kb_add_schedule` 默认
启用、cron 形状校验复用 `cronShapeError`；`kb_update_schedule` 单行重建、簿记戳永不经过编辑器、
`capability:''` 显式重建行清绑定；未知 id 一律报错并列出既有行）；三写工具全过 `assertInteractiveSession`。
runtime 增 `onFinalized` 回调 + `patchAndNotify` 单点（三终态补丁后查行 emit，监听器 try/catch 包裹——
单个订阅者炸不掉运行链）；`yantao-kb/workspace-run` 事件入 types.ts Events 接口。**连接器**：`run-push.ts`
新增（RunPusher：三终态映射、时长行秒/分钟自适应、失败原因取失败步、尾行指路工作台）；`proposal-push.ts`
增 resolve 分支（四态裁决 markdown + 失败计数行）与 `selfResolvedIds` 回声抑制（卡片回调先登记、resolve
到达即消费跳过、回调失败撤销登记）；`index.ts` 订阅事件并在 effect disposer 里一并摘除（lint 抓住初版的
未消费 `offRunEvent`——真 bug：插件重挂会泄漏订阅）。**前端**：Frame tick 在 loadInbox 后调
`reloadSchedules`——尾链进 `scheduleWriteQueue` 保证与面板保存/调度器簿记的全序，重拉失败静默。**测试**
1538 例全绿（新增：workspace-rpc 广播四例——三终态各 emit 一次、dispose 的 interrupted 不 emit；
run-push 6 例；proposal-push 裁决四例含回声抑制与幽灵防护；direct-write-tools 三 describe 12 例；
capability-tool 顺序断言 25→31）。施工自纠三处：`kb_list_proposals` 测试忘传 `status:'decided'`（默认
pending 筛走了夹具行）、非法 cron 断言对错文案（实际报「超出 0-59 范围」）、连接器 disposer 漏接线。
**构建仪式**：窄 tsc 三包干净；宿主 face 两个重建（注意包名是 `@deepseek-ai/dsh-api-yantao-kb-controller`
——`-F` 写成 `dsh-yantao-kb-controller` 会报 "No valid configuration found"）；产物探针
（controller `lib/index.js` 含六个新工具名、connector `lib/index.js` 含 RunPusher）通过；ui-yantao client
bundle 重建；staged oxlint 12 文件 0/0。待重启工作台人工验收（重点：钉钉追问运行结果、
「收邮件改成每天 8 点」一句话改调度、重启后调度页热生效）。
