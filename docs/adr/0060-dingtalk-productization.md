---
status: accepted
---

# 钉钉通道产品化：配置面板与服务端批准闭环

出发点（2026-10-16/17 设计拷问裁决）：钉钉双向通道已在公司网络下打通（机器人收发、心跳、
代理穿透均稳定），但当前是「裸源码工程」形态——使用者要克隆外部仓库、手工 junction 进
node_modules、手改 profile、命令行起宿主，四步缺一不可。这样的东西只有作者能用。同期盘点
钉钉消息管道的能力触达面，发现审批/提议这条最高价值的链路在钉钉侧是断的：提议收件箱
（ADR-0047）的新条目不会推给钉钉，卡片回调也没有批准落库的通路。本篇立案两件事：一是把
安装与配置产品化为工作台内的配置面板（对齐模型配置的交互范式），二是打通「提议入队 →
钉钉推送 → 卡片批准 → 服务端落库」的闭环。

事实基础（已核实）：

- **模型配置范式现成**：`ConfigDialog.tsx`（底部状态条入口）+ `model-config.ts` 接缝；
  `ctx.remote.settings.mutate(namespace, pathOps, revision)` 写入即热生效，不需重启宿主；
  密钥经 `remote.credentials.set()` 进凭据存储，profile 只存引用（`apiKeyEnv` 模式）。
- **PluginManager 有安装能力但没有 UI**：`installBundle` 是 @Remote 且带进度事件，
  reconcile 会自动写 profile bundles 并热加载；但没有任何界面接线，中央路由 `yantao.json`
  也不随安装自动注册。
- **提议收件箱没有事件**：生产方（agent 的 `kb_propose_actions`、前端调度器）经
  `@Remote proposalInboxEnqueue` 入队，UI 靠轮询 revision 感知变化（chokidar watcher +
  REVISION_POLL_MS）；controller 入队/出队两点都不 emit 事件。
- **批准逻辑只在客户端**：`applyProposal`（proposal-apply.ts:326）整个落库执行链活在
  ui-yantao 里；服务端只有丢弃路径（`resolveProposalInboxEntry`）。钉钉侧要批准，必须先把
  这条链移植到服务端。
- **卡片回调已有先例但不通工作台**：钉钉卡片的 interactive 回调目前只驱动敏感操作审批/
  追问（questions.ts:332-366）与忙队列卡（commands.ts:95-122），没有任何通往提议收件箱的
  写回。
- **cordis 事件机制干净可用**：`ctx.emit/on` 进程内事件已有先例（account-controller 的
  session-expired、acp 的审批事件订阅）；最小接线只需 controller 两处 emit。
- **公司网络三层障碍及修法已在 dsh-dingtalk-main 落定**：弱 CA（`rejectUnauthorized:
  false` + 请求级下发）、直连封锁（CONNECT 隧道代理）、https-proxy-agent v9 不透传构造
  选项（请求级兜底）；出站 fetch 已统一走 `proxyFetch`。

决定：

1. **收编为随工作台捆绑的内置插件**：dsh-dingtalk-main 的连接器源码连同公司网络适配一并
   收进本仓，成为 yantao 自己的包（落位实施期定，候选 `packages/yantao/dingtalk-connector`）。
   不做独立安装包、不做 PluginManager 安装流程——桌面版天然携带，启用与否只是配置问题。
   「安装」这个动作从产品里消失。
2. **配置面板沿模型配置范式**：底部状态条加钉钉入口 → 配置对话框。基础区四项：启用开关、
   Client ID、Client Secret、机器人名称；**代理地址与日志级别进「高级」折叠区**——公司
   网关是环境特例，不该占据普通人的视线。写入走 `settings.mutate` 热生效；Secret 经
   `remote.credentials.set()` 落凭据存储，配置命名空间只存凭据引用（沿 `apiKeyEnv` 模式，
   永不落明文）。
3. **生命周期热生效，停用直接断**：启用开关切换即启停 Stream 连接，宿主不重启。停用时若
   有活跃会话，直接断开，重连后的首条消息附带「上次会话因插件停用被中断」的告知——不弹
   二次确认框，个人工具不学企业软件堆确认。
4. **凭据下发：扫码优先、手填兜底**：面板内嵌二维码扫码授权为首选路径；受钉钉开放平台
   能力所限若扫码取凭证不可行，退化为引导式手填 AppKey/AppSecret（此路径必保）。凭据一律
   进凭据存储。一期**单账号**：一个钉钉组织一个机器人，多账号等真需求出现再议。
5. **收件箱补事件**：controller 在 `proposalInboxEnqueue` 与 `proposalInboxResolve` 两点
   emit cordis 事件（载荷：条目摘要 + 动作类型）。首个消费者是钉钉插件（订阅后推卡片）；
   UI 轮询机制不动（它有自己的 revision 语义，另立 ADR 才改）。
6. **推送首批只做提议入队**：调度任务提议与周报/定时批准请求（即 ADR-0047 收件箱新
   pending 条目）推钉钉卡片；会话完成通知、错误告警后置。理由：这类条目的时效价值最高——
   人不在电脑前时它们只能在队列里干等，定时任务的价值随之断电；而通知类消息晚看无损。
7. **批准闭环：applyProposal 移植服务端**：把 ui-yantao 的落库执行链移植进 controller，
   钉钉卡片「批准/丢弃」回调在服务端执行与工作台 ProposalCard 完全相同的逻辑（含 ADR-0059
   的结算三分与 dry-run 预检——移植的是最新语义，不带旧账）。**钉钉处理 ≡ 工作台操作**：
   同一队列两个入口，已处理条目的重复回调幂等返回。移植完成后 ui-yantao 改调服务端 RPC，
   落库逻辑回归单一实现。不做深链——卡片即终态交互。
8. **安全边界原样平移**：钉钉侧的人决走卡片点按，等价于工作台 UI 的人类通道（ADR 信任锚
   不变：机器提名、人类批准）；危险动作（批量丢弃、改配置）一期不出现在卡片上。agent 侧
   的 kb_* 工具信任边界完全不受本篇影响。

分期：P0 = 决定 1/2/3/4（收编 + 配置面板 + 热生效生命周期，安装产品化）；P1 = 决定 5/6/7
（事件、推送、服务端批准闭环）；P2 = 其余推送事件、多账号、卡片动作扩充。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 外部连接器工程失去独立迭代节奏，升级钉钉官方 connector 需走收编流程 | 一键可用、版本与工作台严格一致、不再有 junction 手工仪式 | 官方 connector 高频升级且我们频繁跟进 → 再评估外置安装 |
| 2 | 扫码取凭证受制于钉钉开放平台能力，可能落空 | 手填兜底必保，最坏情况退化为带引导的手填 | ——（兜底即底线） |
| 3 | 停用直接断活跃会话，无确认框 | 少一个企业软件式的打断 | 出现误触实际困扰 → 加撤销式 toast，不加确认框 |
| 4 | 过渡期落库逻辑双份（客户端旧链 + 服务端新链）并存 | P1 即可交付钉钉批准，不等 UI 改造 | 移植完成的同一批次内切 UI 走 RPC，双份不跨版本存活 |
| 5 | 事件一期只喂钉钉插件，UI 维持轮询 | 最小接线，不动已稳定的 revision 轮询 | UI 要吃事件 → 另立 ADR |
| 6 | 危险动作不上卡，钉钉侧能力少于工作台 | 误触半径受控，信任锚清晰 | 单账号个人使用证明低风险 → 逐步放开 |

原因：

- **为什么收编而不是做安装 UI**：拷问裁决（Q2）选了「随工作台捆绑」。PluginManager 安装
  链路（installBundle + 中央路由手工注册）是为第三方能力设计的，套在自己身上是负资产——
  多一层安装仪式，换不来任何隔离收益。内置插件的正确形态是：它在，就能用；关了，就没了。
- **为什么配置面板沿模型配置范式而不新造**：settings.mutate 热生效 + 凭据存储引用化已经
  解决了「改了就生效」「密钥不落盘」两个最难的问题，交互心智也已建立（用户已知右下角能配
  模型）。钉钉配置复用同一骨架，学习成本趋零。
- **为什么批准必须移植服务端而不是让钉钉「提醒后回桌面批」**：钉钉通道的核心价值是人不
  在电脑前时事情照样推进。「钉钉提醒、回桌面批」把这个价值砍半——提醒到了、事没办成，
  比不提醒更添堵。applyProposal 是纯数据操作，依赖全在 controller 侧，移植是一次性成本。
- **为什么先补事件再做推送**：没有事件，钉钉插件只能自己轮询收件箱文件，时序与 UI 轮询
  叠加出竞态；controller 两处 emit 是十行级别的改动，却是推送链路的地基。事件是收件箱
  本来就该有的公共设施，钉钉只是第一个受益者。
- **为什么推送首批只有提议入队**：推送的纪律是「只推需要人动手的事」。提议卡是唯一的
  「不推就停滞」类目——其余（完成通知、告警）都是「知道了也无须立即动作」的信息，晚看
  无损。

后果：

- 新包 `packages/yantao/dingtalk-connector`（候选名）：收编 dsh-dingtalk-main 全部源码与
  公司网络适配；随桌面版 bundle 分发；启用开关读 settings 命名空间。
- `packages/client/ui-yantao`：底部状态条钉钉入口 + 配置对话框（沿 ConfigDialog 范式）；
  凭据写入走 `remote.credentials`。
- `packages/api/yantao-kb-controller`：`proposalInboxEnqueue`/`proposalInboxResolve` 两处
  emit；applyProposal 移植（含 ADR-0059 结算语义）；批准/丢弃 RPC 面向卡片回调与 UI 双
  消费者。
- dsh-dingtalk-main 仓库冻结为历史参考，后续演进一律在本仓进行。
- 测试：applyProposal 移植的等价性测试（同输入同落库）；事件 emit 的单测；卡片回调 →
  服务端批准的集成冒烟；幂等重复回调用例。
- 生效条件：宿主持旧模块，需**重启工作台**。
- 关联：ADR-0047（提议收件箱）、ADR-0055（提议工具）、ADR-0059（管线可靠性——移植时
  以其结算语义为准）。

## 落地注记（2026-10-17，P0+P1 全量）

P0 六任务与 P1 五任务全部落地（包名定为 `packages/yantao/dingtalk-connector`，@deepseek-ai/dsh-yantao-dingtalk）。
超出原文的关键实施裁决：

- **上游文件触碰一处（合并面新增，须知悉）**：`packages/client/tsdown.client.ts` 的
  INLINE_SAFE 名单登记 `dsh-api-yantao-kb-controller/proposal-apply`——applyProposal 的纯函数
  引擎（预检/结算/流水）内联进 ui-yantao client bundle，消除对外部包的运行时引用。这是
  决定 7「移植服务端」的配套动作，已按合并面纪律在此记录。
- **typert 远程边界拒绝闭包**：`proposalInboxApply` 的返回最初直接携带 `ProposalApplyResult`，
  首次构建宿主 face 即被 Typert 拒绝（undo 的逆步骤是闭包）。新增线格式
  `KbProposalApplyTrail`（written/skipped/perAction/undo?.irreversible，剥掉步骤闭包）作为
  RPC 结果；闭包留在服务端 `proposalUndos` 暂存，撤销走独立 RPC `proposalInboxUndo`。
  客户端 `confirmWritten` 放宽为接受两种形状，卡片段落的 `runUndo` 断言恢复完整 undo。
- **Frame 全面切 RPC**：`confirmInboxEntry` 改调 `proposalInboxApply`，客户端的结算编舞与
  结算失败补偿分支整体删除——服务端是唯一实现（取舍台账 #4 的「同一批次内切 UI」兑现）。
- **推送不需要 conversationId 库**：OwnerBinding 已持久化属主 staffId（owner.json），主动
  私聊经 `openSpaceId: dtv1.card//IM_ROBOT.{staffId}` 直达，省一层存储。
- **trackId 重启可解析**：卡片 `outTrackId = proposal_<entryId>` 确定性编码条目 id，回调
  到达时无需任何映射表即可定位条目——宿主重启后旧卡片仍然有效。
- **危险动作具体化**：决定 8 的「危险动作」落为 `delete-mails`/`archive-mails`/`skill-rewrite`
  三类（卡片模板按钮固定、无法按实例隐藏），推纯 markdown 指引回工作台操作。
- **回调幂等的两条容忍**：批准重复 → 服务端 already-decided 吸收；丢弃重复 → resolve 的
  「已经决策」报文匹配后同样按已决策回报。非属主 userId 一律拒绝（纵深防御，卡片侧另有
  属主校验）。
- **收编源 lint 豁免**：`.oxlintrc.json` 为 `dingtalk-connector/src/{index,outbound}.ts` 关闭
  `typescript/no-explicit-any`（收编保持源码原貌，`(ctx as any)` 宿主服务习语不改写；
  新增代码不享受豁免）。

测试清单（对应后果节的四项承诺）：

- 事件 emit 单测：controller 事件两点（T1 批次）。
- 等价性/幂等/预检：`proposal-inbox-rpc.spec.ts` 四例——批准即落库（含 undo 往返与撤销窗
  关闭）、重复批准幂等（含丢弃后重复、append-log 不重放）、preflight-blocked（不可达实体，
  条目保持 pending）、未知 id 与未配置根目录拒绝。
- 卡片回调集成：`proposal-push.spec.ts` 十二例——payload 摘要三分（安全/危险/畸形静默）、
  推送四态（安全→卡片、危险→markdown、无模板→markdown、无通道无控制器静默）、回调五态
  （批准落库、already-decided 幂等、preflight 待定＋失败映射丢弃、丢弃幂等、非属主与外来
  trackId 拒绝）。
- 全量验证：三包（controller + ui-yantao + connector）1099 例全绿；窄 tsc 三包干净；宿主
  face tsdown、remotes 聚合、client bundle 全部重建通过；staged oxlint 五文件 0/0。

生效条件不变：宿主持旧模块，需重启工作台。P2 待办：其余推送事件（完成通知/告警）、多
账号、卡片动作扩充、secret-only 变更的 reconcile 收口。

**补记（同日验收排障）**：首次真实调度任务的提议未推送到钉钉。根因是收尾验证的盲区——
连接器的运行时产物 `lib/index.js` 由根目录 tsdown host 面生成（`npx tsdown
--env.DSH_BUILD_FACE host -F "@deepseek-ai/dsh-yantao-dingtalk"`），窄 tsc 只校验类型不发
JS；改连接器后若只跑窄 tsc，产物静默滞旧，宿主重启也加载不到新代码。已重建（产物含
ProposalPusher 与事件订阅）。另设定预期：当日两条提议均含危险动作（delete-mails /
archive-mails），按决定 8 本就不上卡片，重启后会收到的是 markdown 提醒而非交互卡；推送
只在入队时刻触发，不补发历史条目。

**补记二（同日三轮排障收官）**：重建产物后推送依然沉默，继续挖出两层真正的根因：

1. **可观测性缺陷**：桌面壳（apps/yantao-desktop bootHost）只扫宿主 stdout 里的
   URL 行、其余全部丢弃——连接器的每一条故障日志都被无声吞掉，排障只能靠猜。
   已给连接器三处日志口（apply 级 / startAccount 栈级 / 数字员工级）统一加文件
   出口：`~/.dsh-dingtalk/connector.log`（ISO 时间戳，appendFileSync 同步落盘）；
   推送链路的每个分支（事件到达、payload 不可解析、无绑定属主、markdown 发送
   结果、卡片创建）全部点亮，sendMarkdown 的布尔返回值不再被忽略。
2. **事件漏广播（最终根因）**：控制器只在 RPC 入口 `proposalInboxEnqueue` 广播
   `yantao-kb/proposal-inbox`，而调度任务/交互会话的提名走 agent 工具
   `kb_propose_actions` 直接调 `enqueueProposal`——该入队点不广播。于是**调度
   来源的提议从不触发推送**，RPC 来源才会。已在工具 execute 的入队点补上同权
   emit（index.ts kb_propose_actions 内）。skill-rewrite 的提名（kb 层
   `proposeSkillRewrite`）同样旁路广播，生产调用经能力脚本，暂未接线，列入 P2。
3. **顺带修掉的插件激活崩溃**：连接器 `inject` 未声明 `yantaoKbController`，
   ctx 代理拦截属性读取抛 "cannot get property without inject"——此前藏在
   resolveController 闭包里，异常进被吞的 stdout，推送无声死亡；提升到挂载日志
   后当场现形（启动横幅 "1 entry did not activate"）。已声明进 inject，插件改为
   等控制器就绪再激活，竞态从根上消除。

教训沉淀：跨插件读 ctx 服务必须进 inject 声明；入队有多条生产路径时，广播必须
挂在最底层的写点上（或在每个写点同权补发），只挂 RPC 入口等于只覆盖 UI 来源。

**补记三（同日决定 8 修订：武装卡）**：推送打通后用户指出——危险提议只发
markdown 知会，手机端完全无法决策，恰与「人不在电脑前事情照样推进」的核心
价值冲突（调度提名几乎必然含邮件刀具）。用户裁决采纳**武装卡两击确认**：

- 危险动作提议照常上交互卡（明细尾行固定警示「批准需两次点击确认」）；批准
  首击不落库，只把按钮翻成「⚠️ 确认执行？」，再击才走 `proposalInboxApply`。
  丢弃仍单击（可撤销语义）。信任锚从「不许上卡」改为「刻意的第二次点击」。
- 武装簿（armedApprovals）与危险登记（dangerousTracks）都在内存：重启即清，
  首击重新武装，方向永远偏保守；批准遇真故障只解除武装、保留危险标记——
  故障不得撕开两击防线；轨道终态（落库/点灭/丢弃）结算后双簿清空防累积。
- 无卡片模板时危险提议仍退化 markdown 知会（保留去向指引）。
- 实施在连接器 `proposal-push.ts`，测试 16 例（新增武装五态：首击/再击/重
  挂重武装/武装后丢弃/故障保防线）。

**补记四（同日决定 8 再修订：推送定位收敛为纯知会）**：武装卡复测暴露前置条件
——本部署无法在钉钉卡片平台建模板（企业应用卡片不可改），于是当日两度调整：

1. 第一版把审批闭环整体搬到纯文字（markdown 编号列表 + 「批准/拒绝 <编号>」
   + 危险项「总结→同意」两步确认，状态机挂在 `handleInbound`）。已实现并
   17 测全绿后，用户再裁决：**不在手机端通过钉钉消息操作**——消息只做知会，
   决策回归工作台提议页；但知会内容必须足够详细，便于用户了解情况。
2. 定稿形态：markdown 知会带**逐动作可读明细**（`describeAction`：邮件带
   主题与发件人、待办带标题与正文、动态带目标与正文，超长截断 60 字），
   危险动作带警示行并指路「工作台的提议页决策」。文字决策状态机（编号登记/
   批准拒绝语法/确认回合）整建制撤除，入站管线不留钩子。
3. 模板交互卡（武装两击）降级为可选增强：需要卡片平台模板，本部署不可用；
   代码保留，模板一旦配上自动启用。
4. 排障副产物教训：根 tsdown 配置的宿主面入口是 `lib/types/{index,startup}.js`
   ——tsdown 吃的是 tsc 窄构建的中间产物，跳过 `tsc -b` 直接 tsdown 会打出
   陈旧旧包（字节数不变是鉴别特征）。构建仪式必须完整：tsc -b → tsdown →
   字符串探针。
- 最终测试 17 例（武装五态保留，供模板可用部署回归；markdown 知会断言改为
  富明细 + 工作台指路 + 无决策指令）。
