# 04：跨会话总览

Type: task
Status: ready-for-agent
Blocked by: 02, 03

## 内容

1. `inject` 增加 `'sessions'`（订阅 session-controller list 快照，参照 `ui-workspace/navigation.ts:337` 姿势）。
2. KPI 三卡（范围内会话数/累计 token 四类/cache 命中率）+ 范围筛选 7 天/30 天/全部。
3. 7 天柱状图（`yantaoUsage.dailyUsage`）+ 8 周热力图（同源按周网格）；点热力格 → 过滤会话卡片。
4. 会话卡片：平铺按 `updatedAt` 倒序 + 标题/cwd 搜索；每卡标题、时间、累计 token（`projectionValues`，01 结论若否定则走 `sessionUsage` RPC 兜底）。点击 → `uiWorkspace.openSession(id)` 切对话 tab；卡上次级"查看洞察" → 仪表盘区切到该会话。

## 验收

- 总览四件套齐备；热力图联动生效；卡片两条路径（跳转/就地看）都通。

## Answer

（待填）
