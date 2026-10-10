---
status: accepted
---

# 工作空间：人编排的外部 agent 运行面

出发点（2026-10-10 设计讨论裁决）：yantao 现有的能力体系是「给 agent 供指令」的面——SKILL.md +
sidecar + 中央路由，消费者是 dsh agent。反面一直缺一块：**人想在自己的目录里编排一个外部 agent
干活**——绑定目录与 agent/model，定义指令（可选定时调度 + 提示词链条），到点或随手在指定目录下
拉起 agent 吃一条命令。目前的执行者是 codebuddy cli（无头模式）。这块面与能力的方向恰好相反
（能力：agent 用能力干活；工作空间：人指挥 agent 干活），硬塞进能力路由是错配。裁决为并列子系统，
本篇立案。

事实基础（已核实）：

- **「能力」不是中栏 tab**：它是左侧 intake rail 的分区（`CapabilityPanel.tsx`）；中栏现有六个
  常驻 tab（会话/任务/调度/提议/图谱/洞察，键定义于 `ui-yantao/src/client/tabs.ts`）。「能力
  右边加 tab」落在左侧 rail：能力分区旁新增工作空间分区。
- **配置惯例现成**：controller 侧 JSON（`<kbRoot>/.dsh/yantao/*.json`，如 ADR-0047 的
  `proposal-inbox.json`、ADR-0045 的 `schedules.json`）+ `yantaoKb` remote RPC 供前端读写。
- **现有调度 tick 在前端**（`Frame.tsx` 的 setInterval），但它只做「判定到点 → 提名」，真正干活
  的是人。工作空间指令到点要真的拉起一个可能跑几分钟的子进程，前端（渲染进程）spawn 长驻进程
  会随页面刷新/崩溃而死，不可接受。
- **codebuddy 非交互模式必须 `-y`**：`-p` 模式下不带它则一切需授权操作被阻止；`--output-format
  json` 的最终 result 自带 `session_id`，可供后续步骤续接。
- **信任叙事分层已有先例**：ADR-0047 的提议队列防的是 agent 自作主张；人自己写的配置（如
  schedules.json 的创建）从来都是直接生效、不过队列。

决定：

1. **并列子系统，纯人通道**：工作空间不走能力路由、不进 `yantao.json`、无 sidecar；agent
   不可见、不可触发（一期）。空间是「人编排 agent 运行」的面，与能力「给 agent 供指令」方向
   相反，复用注册/路由体系是错配。
2. **空间模型 = 目录 + agent/model 绑定**：agent 目前仅支持 codebuddy cli；model 经 `--model`
   传给子进程，凭据由 codebuddy 自己的 `.env`/凭据库管理，yantao 不代管 key。resource 目录可以
   注册为空间——空间只是目录绑定，人不外溢 kb 工具层的规矩（creation-only 等）到外部进程；
   人的绑定动作本身就是授权。
3. **指令 = 可选 cron 调度 + 步骤链**。配置了调度则定期触发，不配置则在 UI 上立即触发。链条
   采用**会话延续链**：逐步 spawn `codebuddy -p -y --output-format json`（cwd = 空间目录），
   第 N 步带 `--resume` 第 N-1 步的 `session_id`，上下文自然延续。任一步失败（非零退出/进程
   异常）即**断链**：UI 标出断在哪一步，剩余步骤不动。
4. **执行在 controller 侧**：controller spawn 并持有子进程，不随 UI 生命周期死。权限姿态为
   `-y` 全开，不加 `--allowedTools`（信任锚在人创建空间的一次性动作）。**不设超时、并发不设限**
   （明确裁决：风险自担，台账在案）。提供中止能力：RPC `workspaceRunStop` kill 子进程树。
5. **人写指令直执行，不过提议队列**：ADR-0047 的批准流程约束 agent 提名，不约束人的既定安排；
   人建指令本身就是批准动作。错过调度窗口（controller 重启/休眠）**不补跑**：记录一条 missed，
   UI 可见并可手动触发——补跑过期任务产出未必有意义，且会在人不知情时突然拉起进程。
6. **数据两文件**：`<kbRoot>/.dsh/yantao/workspaces.json`（空间与指令定义）+
   `workspace-runs.json`（运行历史，环形截断只留最近约 100 条）。定义与日志读写频率、失效语义
   不同，分家各自截断。经 `yantaoKb` remote 新增 RPC 供前端读写，沿 proposal-inbox 惯例。
7. **一期可见性**：状态翻转（排队/运行中/成功/失败/missed）+ 完成后的最终结果 + 历史记录。
   stream-json 流式输出转发到 UI **列入 TODO**，一期不做。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | `-y` 全开 + 无超时 + 并发不设限，子进程失控只能靠手动中止 | 零配置摩擦，符合「信任锚在人的一次性动作」 | 造成实际损害（跑飞/写坏目录）时加 allowedTools、超时或并发闸 |
| 2 | 一期只见最终结果，运行过程黑盒 | 免去 controller→前端推送链路 | 长指令盯不住时上 stream-json 转发 |
| 3 | 错过的 cron 不补跑 | 不会在人不知情时突然拉起过期任务 | 出现「错过就必须补」的真实场景 |
| 4 | 纯人通道，agent 不能触发空间指令 | 完全绕开信任边界设计，零新工具 | 出现「让 agent 替人跑某条空间指令」的需求时再设计提名通道 |
| 5 | 只做会话延续链，流水线语义（独立会话 + `{{prev}}` 模板）缺位 | 不背模板转义/截断的坑（kb_exec 换行教训） | 出现「只需产物不需记忆」的链式需求 |

原因：

- **为什么并列而不进能力体系**：能力的信任叙事是「agent 经声明过的通道使用能力」，方向是
  agent 发起；工作空间的信任叙事是人在 UI 上定义并触发，发起者是人。方向相反的两块东西共用
  注册表只会互相污染 schema。
- **为什么执行在 controller**：运行状态的存活不应依赖 UI 页面；controller 侧持久化顺带解决
  运行历史的归属，与既有 JSON + RPC 惯例无缝。
- **为什么断链不容错**：链条后半段的输入依赖前半段产出，带失败状态续跑大概率产出垃圾；断点
  清晰比假完成诚实（与 2026-10-10 校验逐项容错的裁决不冲突——那里坏项是独立个体，这里步骤
  是依赖链）。
- **为什么现在立案**：外部 agent（codebuddy）的无头调用面已验证可行（`-p` + `-y` + json
  输出 + `--resume`），差的只是 yantao 侧的空间/指令/调度编排层。

后果：

- `packages/api/yantao-kb-controller`：workspaces 读写与运行历史持久化、codebuddy 子进程
  spawn/kill、`yantaoKb` remote 新增 RPC（定义 CRUD、触发、中止、历史查询）。
- `packages/client/ui-yantao`：左侧 rail 新分区（能力旁）、空间/指令 CRUD、触发与中止按钮、
  状态与历史展示。
- TODO 台账三条：① stream-json 流式输出转发到 UI；② 流水线链条语义；③ 超时/并发限制
  （现为不设限）。
- 生效条件：新 RPC 与持久化需重启工作台。
