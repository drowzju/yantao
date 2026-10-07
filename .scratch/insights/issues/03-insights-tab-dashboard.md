# 03：tab 骨架 + 当前会话仪表盘

Type: task
Status: resolved
Blocked by: 02

## 内容

1. `src/client/tabs.ts` 加 `INSIGHTS_TAB`；`CenterPane.tsx` 注册头与 pane（常挂载仅隐藏）；`Frame.tsx` 调度按钮右侧加 footer 按钮；`locales.ts` 加 `center.insights.*`（zh 真源 en 对齐）。仿 ADR-0045 六步注册。
2. InsightPane 上半区 = 当前会话仪表盘，组件签名接受 `sessionId`（为 04 的"查看洞察"留口）：
   - 组成卡：六段堆叠条 + 余量（`contextPressure`/`contextBreakdown`，沿用 ContextStatusBar 解析顺序）+ yantao 注入份额行（开卡时 `promptInjection` 计价，最新应答胜出）
   - 趋势卡：每请求一根堆叠条，Step/Turn 切换，✂ 标压缩；数据走 `SessionRemote.page`
   - 事件流卡：注入/压缩/模型切换 + kind 徽章过滤
   - 文件活动卡：工具调用事件提炼 read/write/edit/search 计数与行增减（参考 dsh-context `fileActivity.ts` 归类）
3. footer 洞察按钮：图标 + 阈值描边（>80% 琥珀 >95% 红，读当前会话 `contextPressure`）。

## 验收

- 六步注册齐备，tab 可开关；四卡对当前会话出数；告警色随占用变化。

## Answer

已完工（2026-10-07）。要点：

- **六步注册齐备**：`tabs.ts` 的 `INSIGHTS_TAB`、CenterPane 第六永久 tab（常挂载仅隐藏）、Frame 调度右侧 footer 按钮、locales zh 真源 en 对齐、`index.ts` 的 SlotMap 扩充（`center.insights` root / `insights.session` session-maybe / `footer.insights` session-maybe）与三处注册。
- **四卡**：`SessionDashboard.tsx`（组成六段条+余量+tantao 注入份额行、趋势 Step/Turn 切换+✂、事件流四过滤器+50 条截断脚注、文件活动四桶+行增减）。数据面在 `insights.ts`：纯折叠函数（`stepsFromEvents`/`feedFromEvents`/`fileActivityFromEvents`）+ `loadSessionInsights`（复用 `session-detail.ts` 抽出的 `collectEvents`，零新 RPC）。
- **告警阈值**：`WARNING_PERCENT=80`/`DANGER_PERCENT=95` 常量化，footer 按钮描边与未来复用共用。
- **顺带迁移**：`formatTokens` 从 ContextStatusBar 迁入 `insights.ts`（批次 5 删状态条的先手），SessionDetailDrawer 同步改导入。
- **坑**：① slot 组合类型不含 owner props，`InsightsFooterButtonProps.onOpen` 须可选（Frame 经 ownerProps 传入，缺省退化为纯指示器）；② `exactOptionalPropertyTypes` 下透传 `sub?: boolean` 须显式 `| undefined`；③ `remotes/tsconfig.client.json` 补 `yantao-usage-controller` 引用（批次 1 漏登记致 TS6059 源码泄漏）；④ `gen-client-catalog` 重跑时顺带清掉了 0.2.1 升级遗留的陈旧 `conversation` single 槽条目（已被 keyed `main` 槽取代却一直没重生目录）。
- **门禁**：vitest 922/922 绿（packages/yantao + ui-yantao）；窄构建 tsc 干净；staged 配置 lint 我的文件零错；client 目录重生并通过 verify；ui-yantao bundle 与前端构建成功。
- **在案噪音（非本票引入）**：HEAD 上 ui-chat/ui-approval/ui-sidebar-right 对 `SessionStore` 有 9 个预存类型错（ui-chat 期望旧版 API：`binding`/`scope`/异步 `fork`/store 型 `list`，与现 `packages/core/session` 不符；经 ui-tool 引用链拖进窄构建），以及全仓 oxlint 431 个预存错——均与本批无关，留待上游对齐或专项处理。
