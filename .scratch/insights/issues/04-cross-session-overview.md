# 04：跨会话总览

Type: task
Status: resolved
Blocked by: 02, 03

## 内容

1. `inject` 增加 `'sessions'`（订阅 session-controller list 快照，参照 `ui-workspace/navigation.ts:337` 姿势）。
2. KPI 三卡（范围内会话数/累计 token 四类/cache 命中率）+ 范围筛选 7 天/30 天/全部。
3. 7 天柱状图（`yantaoUsage.dailyUsage`）+ 8 周热力图（同源按周网格）；点热力格 → 过滤会话卡片。
4. 会话卡片：平铺按 `updatedAt` 倒序 + 标题/cwd 搜索；每卡标题、时间、累计 token（`projectionValues`，01 结论若否定则走 `sessionUsage` RPC 兜底）。点击 → `uiWorkspace.openSession(id)` 切对话 tab；卡上次级"查看洞察" → 仪表盘区切到该会话。

## 验收

- 总览四件套齐备；热力图联动生效；卡片两条路径（跳转/就地看）都通。

## Answer

已完工（2026-10-07）。要点：

- **新槽位 `insights.overview`**（root 作用域，`center.insights` 的第一个孩子）：SlotMap 扩充 + children 声明 + `slots.inject` 注册三件套齐备；`remote.yantaoUsage` 进静态 inject 清单。`useSessions` 走全局标准 prop（catalog 重生成后 standardProps 已列出，无需自取）。package.json 的 `dsh.client.inject` 与 devDependencies 补上 `@deepseek-ai/dsh-client-ui-session` 和 `@deepseek-ai/dsh-api-yantao-usage-controller`。
- **单次全量拉取**：一个 `dailyUsage({})` 喂 KPI 三卡 + 柱状图 + 热力图（个人规模几百行），范围筛选是客户端切片，「刷新」重拉。`fetchTotals`（`sessionUsage` RPC）只作冷卡兜底。
- **纯函数面 `overview.ts`**：日历算术全部 UTC 正午空间（DST 不重不漏）；`barsForRange` 滑窗零填充安静日、`all` 直通；`heatmapCellsOf` 8 列×7 行周一起始、未来格标 `future`；`sessionRowsOf` 滤空白、`displayTitle` 作题、直读 `projectionValues?.tokenUsage`（票 01 结论）、`updatedAt` 倒序；`filterSessionRows` 大小写不敏感搜标题/cwd + 活跃日 sessionIds 交集。10 个时区无关的单测钉死（`overview.client.spec.ts`）。
- **卡片两条路径**：主点击 = `openSession(id)` + Frame 经 owner prop 传入的 `onSwitchToConversation`（`activateTab(CONVERSATION_TAB)`）；次级「查看洞察」= 只 `openSession(id)`——`useProjection` 座位绑定当前会话，`insights.session` 槽自动重穿线到新当前会话，仪表盘区"切换"免费获得。
- **热力联动**：点格切换 `activeDay` 再点解除；过滤后的脚注提示；未来格禁用。
- **坑**：① `uiWorkspace.openSession` 要品牌化的 `SessionTarget`，边界处 `as SessionTarget`（同 `cancelSessionTurn` 先例）；② 冷卡兜底 state 用 `undefined` 不用 `null`（exactOptionalPropertyTypes + 收窄）；③ `KpiCard` children 放宽到 `ReactNode`（tokens 卡两行）；④ Remote 解包统一走既有 `unwrapRemote`，命名空间缺失防御性 `usageRemoteOf`。
- **门禁**：vitest 932/932 绿（+10 新测试）；窄构建 tsc 自有文件干净（9 处上游 SessionStore 预存噪音不变，见票 03）；staged 配置 lint 零错（修了 4 处 arrow-parens）；catalog 重生成含新槽位；ui-yantao bundle 与前端构建成功。
