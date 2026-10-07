# Spec：会话洞察 tab（ADR-0050）

- **设计裁定**：ADR-0050（实施批次 1 落笔，本文先行）
- **被取代**：ADR-0039（footer 上下文占用条删除，注入份额并入组成卡，告警色转移洞察按钮）
- **范围**：`packages/yantao/usage`（新，host 侧聚合器）+ `packages/client/ui-yantao`（洞察 tab）。零上游文件改动（新包按惯例跑生成器登记）。

## 背景

借鉴 [dsh-context](https://github.com/bowenliang123/dsh-context)（Apache-2.0）的分析层，不自装插件——其 UI 长在 dsh 槽位式 web UI 上，ADR-0009 自研前端无处渲染。2026-10-07 经 grilling 定案（详见记忆 project_insights_tab）。

## 已定裁决

| 分叉 | 裁决 |
| --- | --- |
| 入口 | 第 6 个永久中栏 tab「洞察」，footer 按钮在「调度」右边 |
| 范围 | 当前会话仪表盘 + 跨会话总览，一次做完 |
| 仪表盘卡 | 组成条 / 逐步趋势 / 事件流 / 文件活动（四张） |
| 总览 | KPI 三卡（会话数/累计token/cache命中）+ 7 天柱状图 + 8 周热力图（点击联动筛选）+ 会话卡片平铺搜索 |
| 不做 | 货币成本、压缩后上下文重建（趋势图 ✂ 标记即可） |
| 数据管线 | host 侧日用量聚合器：扫事件日志按天分桶、重试去重仿 `usage-projection.ts`、位点增量、KV domain `yantao_usage`，**不落 kbRoot** |
| 图表 | 手绘 SVG，不引图表库 |
| 旧状态条 | 删 ContextStatusBar；yantao 注入份额（`yantaoKb.promptInjection`）并入组成卡；洞察按钮图标承担告警色（>80% 琥珀 >95% 红） |

## 验收标准（整体）

1. 洞察 tab 六步注册齐备（tabs 常量 / CenterPane 头+pane / Frame 按钮 / locales zh+en），与「调度」同构。
2. 当前会话仪表盘四卡可用，且组件接受任意 `sessionId`（总览"查看洞察"复用）。
3. 总览页 KPI/柱状图/热力图/卡片齐备；点卡片 `openSession` 切对话 tab。
4. `yantaoUsage.dailyUsage` 数字与手工抽查事件日志一致（含重试去重）。
5. ContextStatusBar 及 `footer.status` 注入彻底移除，无悬挂引用。
6. 门禁全绿：`pnpm vitest run packages/yantao packages/client/ui-yantao`（PowerShell、大写盘符）、lint、ui-yantao bundle 重建、前端构建。

## 票一览

| # | 票 | 依赖 |
|---|---|---|
| 01 | [projectionValues 真实快照验证](issues/01-projection-values-snapshot.md) ✅ | — |
| 02 | [packages/yantao/usage 聚合器](issues/02-usage-aggregator.md) ✅（ADR 改编号 0050） | 01 |
| 03 | [tab 骨架 + 当前会话仪表盘](issues/03-insights-tab-dashboard.md) ✅ | 02 |
| 04 | [跨会话总览](issues/04-cross-session-overview.md) | 02, 03 |
| 05 | [删旧状态条 + 收尾门禁](issues/05-closeout.md) | 03, 04 |
