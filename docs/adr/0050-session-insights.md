---
status: accepted
---

# 会话洞察（洞察 tab）

出发点（2026-10-07 裁决）：工作台的用量感知只有两块残片——底部状态条的上下文占用条
（ADR-0039，只见「当前会话此刻」）与会话列表的零散数字——人对「我这些天花了多少、花在
哪、缓存效率如何」没有任何面。第三方 `dsh-context` 插件评估结论是不装（其四个 UI 面
全部长在上游 slot 式 web UI 上，ADR-0009 已拆掉那层；0.2.1 兼容风险另计），改为借其
设计自建。本轮交付：左下「调度」按钮右侧一枚洞察按钮，点开第六个常驻 tab「洞察」，
双区块——当前会话仪表盘与跨会话总览。

事实基础（已核实）：

- token-meter 的 `tokenUsage` 投影（`packages/llm/token-meter/src/usage-projection.ts`）
  已把每个会话折成四桶终身总量（未缓存输入/输出/缓存读/缓存写），随 checkpoint 落在
  `~/.dsh/storages/session_projcache/`；真实快照核验 100/100 个已存会话都带该行。
  冷会话（从未 checkpoint）可能整列缺席——卡片层需容忍并用 RPC 兜底。
- 投影的折叠语义（replacement 槽、`llm/retry-started` 关槽、等值短路）在
  usage-projection.ts:117-150 已服役；重试两侧都计费是上游既定语义。
- 会话事件日志可经 `ctx.sessionPersistence` 增量读取（`stat` 带 `eventCount`，
  `open(id,'read')` + `read(offset)`）；KV 域机制（ADR-0024 一族）提供宿主侧持久化。
- 工作台图表至今零依赖；个人规模数据（数百会话、几十天）使手绘 SVG 足够。

决定：

1. **第六个常驻 tab「洞察」，不做成弹层**：沿 ADR-0047 提议 tab 的全套先例（tabs
   常量、CenterPane 页签、Frame 装配、locales 键）。入口按钮在 Frame 左下 footer，
   「调度」按钮右侧；按钮图标自身承担告警色（>80% 琥珀、>95% 红）——这是 ADR-0039
   常驻红线的继任者。
2. **host 侧日用量聚合器，不重放投影**：新包 `packages/yantao/usage`
   （`YantaoUsageService`），init 打开 KV 域 `yantao_usage`（days/sessions 两张表，
   ADR-0048 的 kbRoot 圣域不沾），惰性增量扫描全部会话日志：每会话一根游标
   （`nextSeq`/`last` 替换槽/终身总量），只读游标之后的切片，折叠语义与 token-meter
   的投影逐行同构（同一替换槽、同一 retry 关槽、同一等值短路），差异仅在按事件自身
   时间戳做本地日归属。读前先刷新，扫描单飞。选自建折叠而非读 projcache 快照，是
   因为快照只有终身总量没有日分布，而重放整个投影管线会把 token-meter 的状态机拖进
   聚合器。
3. **两个只读 RPC，新控制器包**：`packages/api/yantao-usage-controller` 挂
   `yantaoUsage` 命名空间——`dailyUsage({sinceDay?, untilDay?})`（日账行旧日在前+
   四桶合计）与 `sessionUsage({sessionId})`（单会话终身总量；未知会话报
   `yantao-usage/not-found`）。只读：台账是宿主算的遥测，无写路径过此命名空间。
4. **双区块一次做全**：当前会话仪表盘四卡（四桶、缓存命中、上下文占用、文件活动）；
   跨会话总览三枚 KPI（会话数/累计 tokens/缓存命中率）+ 7 天日用量柱状 + 8 周热力图
   （点击联动过滤会话列表）+ 近会话卡列表（最近优先+搜索框；卡片点击
   `uiWorkspace.openSession` 切对话 tab，卡上「查看洞察」就地切回本 tab 会话区块）。
   手绘 SVG，零图表依赖；不做费用估算（无可靠单价来源）；不做压缩重建。
5. **ADR-0039 退役**：删除 ContextStatusBar 与 `footer.status` 槽；其独家数据——
   yantao 注入份额（`yantaoKb.promptInjection`）——并入洞察组成卡；ADR-0039 标注被
   本 ADR 取代。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 聚合器与投影折叠语义双份维护（同构非同码） | 聚合器不依赖投影内部、可独立增量扫描任意会话存储 | 折叠语义变更时两处必须同批改（fold 单测锁语义） |
| 2 | 惰性全扫（每次读前追尾，无后台定时） | 实现极简、无常驻开销 | 会话数量级上千导致首读延迟可感时改后台增量 |
| 3 | 本地日归属（时区随机器走） | 「我的哪一天」直觉正确 | 跨时区使用且日界敏感时再议 UTC 化 |
| 4 | 无费用估算 | 不必维护汇率表，避免误导性精确 | 出现本地记账的真实需求 |
| 5 | 冷会话缺投影行时以 RPC 现扫兜底 | 卡片永不空白 | 无 |

原因：

- **为什么自建而不是装 dsh-context**：其价值全在 UI 面，而那些面挂在我们已拆除的
  上游 slot 框架上；设计可借，代码不可挂（ADR-0009）。
- **为什么 KV 域而不是写 kbRoot**：ADR-0048 把 kbRoot 定为用户的圣域，遥测台账进去
  就是污染；KV 域天生属于宿主。
- **为什么折叠语义要逐行同构**：台账的终身总量要与 token-meter 投影可互证（同一会话
  两个数字必须相等，否则洞察在撒谎）；同构 + 共享测试语义是达成一致的最低成本。
- **为什么入口是按钮加 tab 而不是常驻面板**：洞察是低频深读，不是监控屏；footer 的
  常驻职责（红线感知）由按钮告警色继承，面积成本趋近于零。

后果：

- `packages/yantao/usage`：聚合器包（fold 纯函数 7 例单测 + service）。
- `packages/api/yantao-usage-controller`：`yantaoUsage` 命名空间两方法 + wire 类型。
- `packages/bundle/yantao`、`packages/bundle/yantao-web-app`：各一行 insert。
- `packages/client/ui-yantao`：洞察 tab 全套接线、四卡仪表盘、总览区块、footer 按钮；
  ContextStatusBar 删除。
- `scripts/gen-cordis-catalog.ts`：五个 wire 类型的归属豁免。
