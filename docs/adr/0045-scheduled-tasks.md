---
status: accepted
---

# 定时调度：前端调度器与任务面板实例流

出发点（2026-10-03 裁决，两轮回合）：工作台需要"定时任务"——到点自动在后台跑一段预定义提示词，运行过程与结果在任务面板可见。入口在 footer 左下「配置」按钮右侧，点击后是中栏「调度」tab。

事实基础：

- **后台跑提示词的通道现成**：`remote.session` 的 create → rename → prompt → follow 模式已有四处先例（提炼经验 `capability-distill.ts`、邮件分析 ADR-0019、refine ADR-0029/0030、实体校验 ADR-0035），会话以名字留在会话列表可回看（ADR-0033）。
- **会话发起者全是浏览器前端**（ADR-0031 事实基础：UI 是全部执行 Owner 的唯一发起者）；宿主控制器没有发起模型会话的入口，Electron 主进程只 spawn 宿主子进程。
- **托盘期间渲染进程与宿主都活着**（ADR-0016：关窗最小化到托盘，宿主子进程持续运行）；托盘「退出」后什么都不剩，无开机自启、无守护。
- **任务面板是纯前端内存聚合**（ADR-0031 决定 4/6：各 Owner 经 taskBegin/taskPatch/taskEnd 上报，零后端任务模型，刷新即失；台账 #1 的持久化重开条件与本 ADR 无关——调度只产生实例流，不要求跨刷新任务历史）。
- **机器状态归属 `.dsh/yantao/`**（ADR-0024）；惯用提示词 store（ADR-0040，`prompt-shortcuts.json`，UI 唯一写者）是"人类专属命名提示词"的现成先例。
- **上游 dsh-schedule 语义不符**：它是会话内提醒（固定间隔、无 cron、无外部通道、交付进同一会话），yantao roster 明确未挂载；不直接复用。
- **系统通知桥现成**：`yantao:notify`（`apps/yantao-desktop/main.ts`，窗口隐藏时邮件分析完成已弹通知，点击唤回窗口）。

决定：

1. **定义与实例分离**：调度配置（名称/提示词/cron/启用）是定义，只在调度 tab 管理；每次触发产生一次运行实例，作为普通任务行进任务面板（新 kind `schedule`），历史随前端内存生命周期（ADR-0031 同命）。任务面板不出现定义行。
2. **前端调度器**：调度器住 ui-yantao（Frame 层 setInterval 扫描），触发走现成 `remote.session` 通道建独立会话（命名「调度 · <名称>」），不注入当前对话。零后端任务模型、零宿主改动。关窗到托盘后渲染进程仍活、照跑；刷新/重启即死——语义恰好等于"应用（含托盘）活着才调度"。
3. **重启丢失不补跑**：启动时比对各调度的上次触发与 cron，发现错过的实例只在调度 tab 该行标记"上次错过"+ 一次性 toast 汇总，不补跑。个人工作台不是服务器，补跑会在开机瞬间制造无人盯着的并发花费。
4. **人类专属写入**：定义持久化在 `.dsh/yantao/schedules.json`（与 prompt-shortcuts.json 平级，ADR-0024），UI 是唯一写者；agent 无任何调度工具（不读、不写、不提案）——定时任务会自主消耗模型额度，信任锚必须放人类一次性动作（创建/启停），与"安装即授权"（ADR-0021/0043）同构。后续若要 agent 可见，另行 ADR。
5. **提示词快照语义**：编辑器内自由文本为主，可「从惯用提示词填入」——选中即**拷贝快照**进调度定义，之后改惯用提示词不影响已建调度。拒绝引用语义：改一处别名全调度跟着变是调试灾难，快照让每条调度自包含。
6. **简单选项 + 高级 cron**：UI 默认给"每天 / 每周 / 每隔 N 分钟"简单选项，折叠高级模式直填 cron；存储层统一存 5 字段 cron 字符串，简单选项只是 cron 生成器。cron 匹配器前端自实现（分/时/日/月/周，支持 `* , - /`），不引外部依赖——避免 vendor-manifest 与第三方通告变动。
7. **完成触达复用通知桥**：窗口隐藏时调度跑完弹系统通知（`yantao:notify`，点击唤回窗口），窗口可见时不打扰；不做逐条开关（过度设计，嫌吵再议）。
8. **界面形态**：footer「配置」右侧加「调度」按钮，点开是中栏永久 tab「调度」（同「对话」「任务」先例，ADR-0031 模式），左定义列表右编辑器（名称/提示词/触发规则/启用/上次触发与错过标记）。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 前端刷新会杀死在跑的扫描（实例会话本身在宿主侧继续，但行状态断线） | 零宿主改动，贴着 ADR-0031 哲学 | 刷新成为日常操作且断线感强烈时，再议调度器下移宿主 |
| 2 | 重启后错过即丢（仅标记不补跑） | 开机零自动花费 | 用户明确要求补跑/系统级自启时 |
| 3 | agent 完全看不见调度 | 额度花费的信任锚 100% 在人 | 出现"让 agent 知道有哪些定时任务"的真实需求时 |
| 4 | 快照语义下改惯用提示词不同步到调度 | 每条调度自包含、行为可预测 | 批量同步诉求反复出现时加引用模式选项 |
| 5 | 自实现 cron 匹配器要养测试 | 零依赖变动 | 需要秒级/年时字段或 cron 方言扩展时引库 |
| 6 | 无跨刷新任务历史 | 与 ADR-0031 台账 #1 的一致 | 需要调度历史审计时随台账 #1 一起重开 |

原因：

- **为什么前端调度器而不是宿主侧**：宿主没有发起会话的入口，给它开这个口子会打破"UI 是唯一会话发起者"的 ADR-0031 事实基础；而宿主只当闹钟、执行仍靠前端的折中方案与纯前端方案能力相等（两者都死于宿主退出），复杂度翻倍。前端调度器的存活语义（含托盘）精确匹配裁决的生命周期预期。
- **为什么独立会话**：定时触发本质是"没人盯着的自动化"，注入当前对话会打断人的思路，且应用重启后"当前会话"可能不存在；独立会话还白得 ADR-0033 的详情抽屉回看。
- **为什么 UI 唯一写者**：调度是"会自动花钱跑模型"的东西，信任锚放人类一次性动作是全库一贯的协作边界（邮件删除、实体归档、记忆提案同构）。
- **为什么存 cron 而不是结构化规则**：单一存储格式消除"简单/高级"两套序列化；UI 简单选项退化为生成器，存储与匹配只有一条路径。

后果：

- `packages/yantao/kb`：新增 `schedules.ts`（仿 prompt-shortcuts.ts）：读写 `.dsh/yantao/schedules.json`，全量替换写、写前校验、缺文件即空、坏文件报错；定义 id 稳定（创建时生成）。
- `packages/api/yantao-kb-controller`：`yantaoKb` remote 增 `scheduleList` / `scheduleSave`（全量替换模式，同 promptShortcutList/Save）。
- `packages/client/ui-yantao`：新增 cron 匹配器（含单测）、调度执行 Owner（扫描/触发/上报 kind=`schedule`/通知/错过标记）、SchedulePane（左列表右编辑器）、footer「调度」按钮与中栏永久 tab 注册；Frame 持调度定义状态。
- `packages/yantao/CONTEXT.md`：增补「调度」「调度实例」词条。
- 文档：docs/yantao/README.md 的 ADR 索引入列；AGENTS.md 无需动（agent 工具面零变化）。
- 测试：schedules 读写校验、cron 匹配器边界（*/步进/范围/列表/月末）、Owner 触发与上报、错过检测，随施工补齐。

落地注记(2026-10-03,施工完成):全链路一批落地。**kb 包**:`schedules.ts` 读写 `.dsh/yantao/schedules.json`(与 prompt-shortcuts 同构:全量替换写、写前校验、缺文件即空、坏文件响亮报错),`cronShapeError` 形状校验(五段、范围、步进,中文报错 UI 原样展示),`newScheduleId` 格式 `sch_<base36 ms>_<8hex>`——下划线分隔时间戳与随机后缀(无分隔时随机后缀的十六进制字母会被 base36 解析吞掉,测试抓出)。**controller**:`yantaoKb` 增 `scheduleList`/`scheduleSave` 双 RPC(host 校验 cron 形状),typert host 产物与 `remotes/lib/client.js` 聚合层均已窄重建(grep 验证调度方法入产物)。**前端**:`cron.ts` 自实现五段匹配器(Vixie 日/周或语义,周日 0/7 等价;`distinct` 计数修复了周字段 `*`(0-7→0-6)不归并导致的"全匹配" bug,测试抓出);`scheduler.ts` 扫描决策(`scheduleScan`:新鲜到点 fire/超容忍 missed/未来 wait;基线=lastFiredAt、lastMissedAt、id 内创建时间三者最晚,错过只标记不重复提醒不补跑)+`runScheduledTask`(create→rename「调度 · <名称>」→askTurn,取消桥同 refine 纪律);Frame 持定义状态与 30s 扫描 interval,触发即先把基线前移再跑(长跑不会被下一拍重火),任务行 kind=`schedule`(task-view 第五类),取消/查看两臂接入既有 cancelTask/jumpTask;窗口隐藏时完成/失败经 `yantao:notify` 弹系统通知(shell 按可见性裁决)。**UI**:footer「配置」右侧「调度」按钮→中栏第三常驻 tab;`SchedulePane` 左列表(启用勾选/cron/下次触发/上次触发/上次错过标黄)右编辑器(名称/提示词 textarea+「从惯用提示词填入」快照拷贝/每天每周每隔N分钟简单选项+高级 cron/启用),全部写路径走全量替换 save,host 校验失败经 frame notice 回报。**测试** 1019 例全绿(新增 schedules.spec 12、cron.client.spec 18、scheduler.client.spec 12;workbench spec 的 Frame 桩补 schedule 三件套——SchedulePane 挂载即调 promptShortcutList,旧桩缺 props 的隐患一并补齐);tsc 窄构建、oxlint、ui-yantao bundle、remotes 聚合重建全部干净。**文档**:CONTEXT「调度」词条+「工作台」三常驻 tab 修订、docs/yantao/README ADR 索引入列;AGENTS.md 无需动(agent 工具面零变化)。

落地注记二(2026-10-03,ocr 评审修订,10 项):评审(temp/ocr-review-2026-10-03.txt,24 发现)后按裁决修 8 项、搁置次要项。**写路径三分**:新增 `scheduleMark` RPC(调度器专用单行时间戳补丁,`null` 清除、缺省不动)——`scheduleSave` 对已有行强制保留库内时间戳(陈旧编辑快照永不回退簿记),调度器簿记不再走全量替换,两类写在语义上不再互踩(评审 #10);`writeSchedules` 先 `mkdir recursive`(新 KB 首存 ENOENT,评审 #1)。**Frame 串行写队列**:面板 save 与调度器 mark 尾链入同一队列,失败即重读 store 对齐乐观态(评审 #4)。**错过语义加固**:错过标记钳到 `now`,一次消化全部停机积压、不再逐 tick 回放(评审 #3),且每 tick 聚合持久化(评审 #7);触发容忍 60s→300s——托盘隐藏 5 分钟后 Chromium 节流至约 1 tick/分钟,60s 容忍会把招牌场景的到点误判为错过(评审 #6)。**门控与边界**:`schedulesLoaded` 前调度 tab 只渲染占位、不出任何可写控件(未加载即保存会清空全部定义,评审 #5);「每隔 N 分钟」上限 720→60(分钟字段步进 >60 非法、存不进,评审 #2)。**未修**(次要,台账):cron 搜索视界 5y<8y(2096→2104 闰日)、`enabled` 非布尔静默化、读侧不查 version、写入非原子、周日 7 未归一、四元三元、checkbox 嵌 button、Window.yantao 双声明、controller 错误门控第三份拷贝、CenterPane 常驻 tab 第三份拷贝、notify 解引用无防护、#8/#9 面板内 draft 陈旧合并。评审另检出 controller pre-step 扫描白名单(`'plugin'` 单 kind)会吞 `skill-catalog`/`agent-instructions` 下游注入——那是另一条在途修复的代码,未动,建议改"跳过一切非 user 消息"。测试 1028 例全绿(新增 schedule-rpc.spec 6:stamps 保留/mark 设清/未知 id;schedules.spec +3:mkdir、markSchedule);tsc/oxlint/bundle/remotes 重建干净。
