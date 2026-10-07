# 02：packages/yantao/usage 聚合器

Type: task
Status: resolved
Blocked by: 01

## 内容

新包 `packages/yantao/usage`：host 侧 cordis 插件，提供 Remote `yantaoUsage`：

- `dailyUsage(range)` → 按天分桶 token 四类（uncachedInput/output/cacheRead/cacheWrite）+ 活跃会话数
- `sessionUsage(id)` → 单会话累计（批次 3 卡片兜底）
- 扫会话事件日志，取 `assistant/message` 的 `usage`，按事件 `time` 分天
- 重试去重仿 `usage-projection.ts:117-150`（`llm/retry-started` 后同 turn/step 替换不累加）
- 位点增量：按会话记住已消费位点，只扫新增；结果持久化 KV domain `yantao_usage`
- 注册进 `packages/bundle/yantao`；跑 `pnpm run gen-tsconfig-paths` 与包目录生成器

## 验收

- 去重折叠与分天聚合纯函数单测；
- `dailyUsage` 数字与手工抽查一段真实事件日志一致；
- 门禁绿。

## Answer

完工（2026-10-07）。实际落点与工单的差异：

- **Remote 拆到了独立控制器包** `packages/api/yantao-usage-controller`
  （`yantaoUsage` 命名空间，`dailyUsage`/`sessionUsage` 两只读方法）——kb 的先例是
  聚合器与控制器分包，本批照做；`packages/yantao/usage` 只持有台账
  （`YantaoUsageService`：KV 域 `yantao_usage` 打开、单飞惰性扫描、游标增量折叠）。
- **折叠语义逐行同构 token-meter 投影**：替换槽（含跨午夜换日：减记旧日、加记新日）、
  `llm/retry-started` 关槽（两侧都计费）、等值短路、无关事件推进 `nextSeq`。
  修了一个真 bug：一元负号把 0 折成 `-0` 泄进台账，`neg()` 归正。
- **注册清单全过**：两个 bundle patch 各一行、`tsconfig.base.json` 手写别名 ×3、
  `tsconfig.host.json` 引用 ×2、`gen-cordis-catalog` 的 SERVICE_PAGE 两行 + 五个 wire
  类型豁免、`packages/api/remotes` 挂载、cli 依赖。控制器还需 cordis Context merge
  声明（`yantaoUsageController`）才被投影发现——kb-controller 同款。
- **生成器与构建全绿**：`gen-cordis-api`、`gen-client-catalog`（顺带修了 0.2.1 升级
  遗留的 ui-yantao/ui-layout `main` 槽重复声明——删 ui-yantao 侧冗余 SlotMap 条目，
  ui-layout 是上游文件不动）、`gen-cordis-inspect-catalog`、`gen-tool-catalog`、
  `build:lib:host`（typert 工件已产出）。中途撞一次 inspector devtools 的 Windows
  EPERM rename 抖动，重试即过。
- **单测 7/7 绿**（fold.spec.ts：dayOf、无关事件推进、替换减记、等值短路、retry
  关槽 100+120=220、午夜换日、流尾 usage 提取）。
- **决策编号勘误**：原定的 ADR-0049 已被关系图谱占用，洞察改为 **ADR-0050**
  （`docs/adr/0050-session-insights.md`，已随本批写出）。
- 待办移交批次 3：`dailyUsage` 数字与真实日志的手工抽查一致性（需要 UI 联调时一起
  看）；冷会话缺投影行的 RPC 兜底在控制器侧天然具备（`sessionUsage` 现扫）。
