---
status: accepted
---

# 钉钉对话并入工作台会话

出发点（2026-10-17，ADR-0061 验收反馈的口径修正）：0061 把钉钉对话设计成「工作台看得见、
回复回钉钉」的两本账——绑定列表 + 只读镜像。用户验收时明确：**要的不是能看见，而是钉钉
消息直接出现在当前开着的会话窗口里**，和自己说的话连成一串。「两边分开」的口径被推翻，
本篇立案并入。

事实基础（已核实）：

- **绑定本来就是指针**：连接器维护 conversationId → sessionId 的映射（各家族
  `bindings.json`），入站消息按它 resume 会话。把指针改指向工作台会话，钉钉消息天然流进
  那边——不需要发明新路由，只需要给用户一个改绑的手势。
- **回合注入是排队语义**：`followup` 是「排一个普通跟进回合」，不打断在跑的回合；连接器
  自己的队列按 scope 串行。并入后唯一的串线风险是：钉钉消息在用户自己的回合跑到一半时
  到达——renderer 的会话事件监听会把**别人的尾巴**记进钉钉回合的回复。
- **会话事件没有回合归属标签**（`session/event` 只有 type+data），归属只能靠时序推断：
  agent 的 `status`（idle/running）在 followup 注入前后是可靠的（同一同步段内读取）。
- **JsonStore 是内存缓存**：外部改文件连接器感知不到，改绑要么走连接器自己的 RPC，
  要么让它自己发现文件变了。

决定：

1. **改绑即并入**：不新增运行时概念。controller 新 RPC `dingtalkBindingSet`
   （conversationId, sessionId | null）：定位持有该 conversationId 的家族存储
   （扫描顺序与收集器一致），原子改写；`null` 删键（下一条钉钉消息回到自动新建）。
   存储缺失则建目录落默认机器人存储；坏 JSON 重建不炸。连接器的 JsonStore 在 `get`
   时做 mtime 自检——文件变了重读，改绑热生效，无需重启。
2. **来源前缀**：入站文本前置一个文本块 `【钉钉 · 昵称】`（昵称为空不加）。并入共享
   会话后气泡必须能看出是谁在钉钉说话，群聊同理；这也让 agent 知道消息的来路。
3. **回合归属 disarm/armed**：TurnState 增加 `armed` 标志（两个 renderer 都补）。
   bridge 在注入 followup 的同一同步段里读 `agent.status`：idle → 立即武装（后续事件
   都是本回合的）；running → 保持解除，忽略一切事件直到看见第一个 `turn/end`（那是
   用户回合的收尾）——用它完成武装而不是结算。这样并入共享会话后，用户回合的尾巴
   永远不会被误发给钉钉，钉钉回合的输出也不会漏发。
4. **并入手势**：（已被下方修订取代）钉钉对话框绑定行新增「并入当前会话」——目标取 uiWorkspace 当前打开
   的会话（新增 `currentSessionId` 只读取）；行内显示的会话已是当前会话时改为
   「还原独立会话」（传 null 解绑）。成功后重读绑定列表并就地提示。
5. **回复路由不变**：renderer 按回合捕获输出，钉钉回合的回答照旧回钉钉；用户在窗口里
   自己发的 prompt 不经过连接器，回答只落窗口。两条通道在同一会话里交替，互不串线。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 旧自动会话的历史留在原笔记本，并入后钉钉对话从当前会话重新记 | 不搬历史——搬运是又一次有损手术 | 用户要求合并旧史 |
| 2 | 群聊并入意味着群里任何人都能驱动你的主会话（含写待办——`kb_add_todo` 的门只拦定时会话） | 并入是人的一次显式动作，信任锚在人自己手上；群聊默认不并入，想并的人自己并 | 出现同事误用事故 → 并入手势加属主私聊限制 |
| 3 | mtime 自检每 get 一次 stat | 零新协议、零重启；本地磁盘开销可忽略 | 远端存储出现 |
| 4 | 竞态残余：status 读到 idle 后、followup 落队前，理论上可被窗口抢先（同一同步段，窗口极小） | 不引入宿主改造 | 出现真实串发案例 → 宿主事件带回合 id |

原因：

- **为什么不做成「钉钉消息追着当前窗口跑」**：让连接器每条消息去问「UI 现在开着哪」是
  跨进程追逐一个易变状态——切换会话、多窗口都会让路由漂移。改绑是一次显式动作，落盘
  之后稳定指向；用户想让钉钉进哪个本子，就把哪个本子的名字给它。
- **为什么归属做在 renderer 而不是宿主**：宿主的 `session/event` 契约不动（上游面），
  连接器在自己注入的瞬间就知道该不该开始听——时序信息本来就在 bridge 手里。
- **为什么前缀无条件加**：专用钉钉会话里群聊本来就该知道谁在说话（此前 agent 看不到
  昵称）；并入场景更是必需。这不是并入的附属品，是对群聊欠账的补课。

后果：

- `packages/yantao/dingtalk-connector`：`jsonstore.ts`（mtime 自检）、`bridge.ts`
  （来源前缀 + arm 时序 + TurnRenderer 接口）、`renderer.ts` /
  `digital-employee-renderer.ts`（disarm/armed 状态机）。
- `packages/api/yantao-kb-controller`：`setDingtalkBinding`（`dingtalk-bindings.ts`）、
  `dingtalkBindingSet` RPC 与线类型（`types.ts`）。
- `packages/client/ui-workspace`：UiWorkspace 增 `currentSessionId` 只读取。
- `packages/client/ui-yantao`：remote.ts 新 face `dingtalkBindingSet`；DingTalkDialog
  绑定行并入/还原按钮与状态提示；Frame/index 接线；locales 六词条。
- 测试：dingtalk-bindings 新增 3 例（改写落原家族、解绑、缺失/坏存储重建）。
- 生效条件：宿主与客户端 bundle 都要重建，**重启工作台**。
- 关联：ADR-0061（其决定 2 的绑定读面是本篇的写面对偶；台账 #4 的「镜像只读」仍然
  成立——工作台依旧不能替钉钉回话，本篇改的是**会话归属**，不是回复通道）、
  ADR-0047（并入会话里的 `kb_add_todo` 直写不受定时门拦截，见台账 #2）。

## 修订（2026-10-17，决定 4 被用户推翻）

验收反馈：决定 4 的行内「并入当前会话/还原独立会话」按钮太难懂——用户不知道那是在干什么，
也从未点过（消息因此一直落在独立的自动会话里，引发「窗口看不到钉钉消息」的误判）。用户
原话定案：**「直接一个选择框，对应的文字是：钉钉消息并入工作台会话，默认勾选。」**

- **新手势**：钉钉对话框顶部一枚勾选框，标签「钉钉消息并入工作台会话」，默认勾选。
  勾选 = 所有已知绑定全部指向当前打开的工作台会话，且此后**每次切换会话自动跟到新打开
  的那个**（客户端订阅 `onMainSelectionChange`，导航即改绑）；取消勾选 = 所有绑定解绑
  （传 null），钉钉对话回到各自独立。行内按钮删除。
- **「追着窗口跑」的旧顾虑如何消化**：上面的反对理由针对的是「连接器每条消息去问 UI
  开着哪」。现在的做法不是追逐易变状态——每次导航仍是一次显式的 `dingtalkBindingSet`
  落盘改绑，指针语义不变，只是把「人动手改绑」自动化成了「跟着导航改绑」。稳定性由
  串行化保证：导航风暴经 promise 链依次收敛，失败只 warn 不打扰导航。
- **持久化与重启**：勾选状态存 settings 命名空间 `dingtalk-channel` 的
  `mergeIntoOpenSession` 字段（`Volatile<boolean>`——settings 平台只收挥发性字段写，
  连接器本体不消费此字段，路由只读 bindings.json）；指针存 bindings.json。重启后
  勾选还在、指针还在；开机首次导航触发一次对齐，绑定自动指到当时打开的会话。
- **实现**：`packages/client/ui-workspace` 的 UiWorkspace 新增
  `onMainSelectionChange(listener)`（`replaceMain`/`clearMain` 末尾触发）；
  `packages/client/ui-yantao` 的 index.ts 挂导航跟随，DingTalkDialog 换勾选框
  （`toggleMergeFollow`，失败回滚勾选态），行内并入/还原按钮与相关 locale 键删除；
  连接器 config 增 `mergeIntoOpenSession` 投影（仅为 settings 放行）。
