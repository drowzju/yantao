---
status: accepted
---

# 钉钉工作台桥第二批：时钟、对话直写待办与会话镜像

出发点（2026-10-17，ADR-0060 P0+P1 验收通过后的追加批次）：钉钉通道已产品化且推送闭环
跑通，但四个日常摩擦仍在——agent 不知道今天几号（定时任务写「本周五」全靠猜）；人在对话
里说「帮我记个待办」却只能得到一张提议卡（明明人就坐在屏幕前，批准是多余仪式）；钉钉群里
@机器人 的对话落进了哪个会话、工作台里完全看不出来；反过来，钉钉那边聊了什么，工作台也
看不到。本篇立案四件事：时钟注入、对话直写待办（含无人值守的门）、钉钉会话可辨、只读镜像。

事实基础（已核实）：

- **agent 没有时钟**：系统提示词是静态组装的，没有任何一节告诉模型今天的日期；相对时间
  词（「今晚」「下周一」）全靠猜，定时任务的提名尤其受害。
- **待办的 agent 写面只有提名**：`kb_propose_actions` 的 `add-todo` 动作进 ADR-0047 收件
  箱等人批。对话场景下这是一次多余的仪式——用户亲口说的要求就是授权本身。
- **但无人值守场合不一样**：调度任务（ADR-0056 链执行、定时 prompt）也在「对话」里跑，
  agent 无法区分自己是被人盯着还是无人值守；若无门，直写待办会在无人在场时绕过人决。
- **绑定关系已落盘**：钉钉连接器把 conversationId → sessionId 的绑定写在三个家族的
  `bindings.json` 里（缺省机器人 / accounts/<id> / digital-employees/<uuid>，均在
  `~/.dsh-dingtalk` 下），工作台只是从来没读过。
- **会话实录的读面现成**：ADR-0033 的 `session-detail.ts`（follow 取快照 + page 回溯 +
  `detailFromEvents` 整形）是纯模块，「详情」抽屉与 ADR-0050 洞察共用，零新 RPC 可复用。

决定：

1. **时钟注入（动态 section）**：新小节 `yantao:clock`（order 110，先于 filesystem 纪律
   120——日期是小节纪律赖以运转的地面真相）。每次组装现算一行
   「今天是 YYYY 年 M 月 D 日 星期X。」（`renderClockLine` 纯函数，测试钉格式）；午夜
   翻日在下一步组装时自动生效，零重建。
2. **调度运行登记簿（直写的门）**：controller 内存 `Map<sessionId, expiresAt>`
   （`ScheduledRunRegistry`，TTL 30 分钟、负值钳 0、惰性逐出、重登以最后一次为准），
   `scheduledRunMark` / `scheduledRunForget` 两个 RPC。前端调度器在每次发起 prompt 前
   mark、在**每一轮** `askTurn`（主回合与修复回合 alike）的 `finally` 里 forget；
   mark 失败降级为警告后照跑（调度不能被 RPC 故障瘫痪），漏掉的 forget 靠 TTL 过期兜底。
3. **对话直写待办（`kb_add_todo`，第十六个工具）**：信任裁决——**对话里的明确要求本身就
   是授权**（人就在场，看着它写）。工具在交互会话直接追加 `entities/todos.md`（读最新再
   追加，无乐观并发回声——agent 从不持有旧副本；空文件播种 preamble；due/body 修剪）；
   登记簿命中的定时会话拒绝并指路 `kb_propose_actions`（无人值守的待办仍走提议队列人批）。
   提示词纪律同步：philosophy 的「禁止无值守自动写入」补 ADR-0061 例外条款，
   filesystem 的待办小节改述对话直写路径（勾掉/改期/删项仍走 `kb_propose_actions`）。
4. **钉钉会话可辨**：controller 新 `dingtalkBindings` RPC，容错收割三家族 `bindings.json`
   （缺失/损坏/非对象/非字符串一律跳过、绝不炸 RPC；同 sessionId 多绑下去重 last-wins）。
   两个消费面：任务总览的会话卡片戴「钉钉」徽标（随总览加载并行拉取，失败只是没有徽标、
   永不拖垮总览）；钉钉对话框新增「绑定会话」折叠区（展开时懒读一次），每行列
   类型 · 属主 · 会话 id，「打开」经 uiWorkspace 跳进该会话。
**补记（2026-10-17 验收反馈）**：决定 4 落地后用户仍报「会话窗口看不到钉钉交互消息」。排查证实会话一直在侧栏列表里（持久层、host、客户端三层都无过滤），真正的问题是**辨认**：钉钉会话首条消息是问候语，首条消息自动起名器（fallback）把它命名为「你好」，侧栏里根本认不出。补强：连接器在机器人运行时的 `onAgentMessage` 里调 session-title 服务的 `rename` 落一次「钉钉对话」——仅当当前标题来源不是 `user`（rename 本身钉住标题并压制后续自动起名，故与新会话的 LLM 起名器和用户的手动改名都不打架）；代价是新钉钉会话不再获得 LLM 生成的描述性标题，统一叫「钉钉对话」，靠徽标与绑定列表区分多个。

5. **只读镜像**：绑定行新增「对话」开关，就地展开该会话的实录——复用 ADR-0033 的
   `sessionDetail` loader（同一个 follow/page 读面、同一套气泡整形），用户/注入/助手气泡
   沿「详情」抽屉样式、工具调用一行摘要不展开。头部固定注记「只读镜像——回复请在钉钉
   进行」；换行/收起/关闭即 abort 上一个读取（与抽屉同一取消纪律）。工作台看得见钉钉聊了
   什么，回复永远回钉钉去发。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 登记簿纯内存：漏 forget 的登记最多脏 30 分钟，期间该会话待办直写被拒（偏保守方向） | 零落盘状态、重启自清、无清理仪式 | 误拒实际困扰 → 落盘登记或调 TTL |
| 2 | mark 失败降级放行：理论上定时任务可在无门状态下跑 | 调度永不被 RPC 故障瘫痪 | 出现真实绕过事故 → 改硬失败 |
| 3 | 徽标 last-wins：一会话换绑新群只显一枚徽标 | 总览不噪 | 一会话多群的辨识成为真需求 |
| 4 | 镜像只读：工作台不能替钉钉回话 | 通道归属清晰（回复属于钉钉），信任锚不扩散 | 真需求出现另立 ADR |

原因：

- **为什么对话直写不算破信任边界**：硬规则 2 的信任锚是「机器提名、人类批准」，前提是
  无人看守。人在场亲口下的指令本身就是批准——为它再设一道卡是把仪式当安全。真正的风险
  场景只有一个：无人值守的定时运行。登记簿就是把这唯一场景钉死的门，其余场合不加锁。
- **为什么门做在 controller 而不是靠提示词**：提示词是劝，登记簿是拦。定时任务的会话
  id 由前端调度器独知，mark/forget 两端都在它手里，门在工具 execute 里查登记簿即可
  精确命中；agent 无法自证「我是交互会话」，也就无从绕过。
- **为什么镜像复用 sessionDetail 而不做实时 follow**：绑定会话的对话节奏是人的节奏
  （群里 @一句、隔一阵再看），快照式读取足够「一眼看清」；常驻 follow 流是给运行中任务
  的实时面板用的，为镜像常开流是过度工程。复读靠再点一次「对话」。
- **为什么绑定收割做成容错静默**：三家族目录是连接器的内部布局，未来还会演化；工作台
  的徽标与列表是纯增益信息，任何一家读不到都不该变成用户的报错。

后果：

- `packages/yantao/kb`：`CLOCK_SECTION` + `renderClockLine` + `registerClockSection`；
  philosophy/filesystem 两小节改述。
- `packages/api/yantao-kb-controller`：`kb_add_todo` 工具（第十六个）、
  `ScheduledRunRegistry`（`scheduled-runs.ts`）、`collectDingtalkBindings`
  （`dingtalk-bindings.ts`）、`scheduledRunMark/Forget` + `dingtalkBindings` 三个 RPC
  与线类型。
- `packages/client/ui-yantao`：调度器 mark/forget 编舞（scheduler.ts）；DingTalkDialog
  绑定列表 + 只读镜像；SessionOverview 钉钉徽标；remote.ts 三个新 face。
- AGENTS.md 硬规则 2 的工具清单与数目同步（十五 → 十六）。
- 测试：新增 13 例（scheduled-runs 4、add-todo-tool 5、dingtalk-bindings 4）+
  prompt-sections 时钟 3 例；三包 1459 例全绿，窄 tsc、staged oxlint 干净。
- 生效条件：宿主持旧模块，需**重启工作台**。
- 关联：ADR-0047（提议收件箱）、ADR-0055（kb_propose_actions）、ADR-0033（sessionDetail
  读面）、ADR-0060（钉钉产品化——本篇是其 P2 之前的日常体验补课）。
