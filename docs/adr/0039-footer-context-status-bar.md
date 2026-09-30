---
status: accepted
---

# footer 上下文状态栏：工作台自己的 context 占用读数

上游对话界面在 composer 右下角有一个 14px 的 ContextMeter 圆环（`ui-conversation` 的 `contextPressure` 投影驱动），它有三个与 yantao 工作台不合的形状：

- **太小且位置不对**：14px 圆环缩在输入框右下角，不是「常驻、一眼可读」的状态栏；
- **首轮前不渲染**：`pressureTokens` 只来自 provider 上报的 usage，首轮请求前整个圆环是 `null`——而工作台的典型用法恰恰是能力执行（邮件、提炼、校验）这类**不体现为对话**的场景，人需要在发起前就知道预算；
- **语义混杂**：圆环属于上游 composer，而工作台的主要消耗发生在工作台自己驱动的会话里，人需要的是一个**干净的、只盯当前主会话**的读数，而不是嵌在输入框里的附属物。

经 grilling 对齐（2026-09-30），决定：

1. **位置与形态**：footer 条（窗口底部 reserved row）左下角「配置」按钮旁，常驻一段 72×4px 分段细条＋百分比数字；占用 >80% 转警告色、>95% 转危险色；无会话或尚无 provider 样本时显示灰色 `--`（title 说明原因）。
2. **点击详情**：popover 自下而上弹出，列出——系统提示（单列一行「其中 yantao 注入」子行）、工具定义、对话历史、剩余可用，各带 token 数与占窗口百分比；底注说明「首轮前为启发式估算（~），首轮后为模型实测」。
3. **数据面**：条与三行组成读 `contextPressure` / `contextBreakdown` 投影（token-meter 已有，fold 自会话事件流）；yantao 注入份额**不走投影**——`system-prompt/assemble` 是宿主侧 cordis 瀑布事件，不在会话事件流里，投影 fold 观测不到，故新增 `yantaoKb.promptInjection` Remote 端点，宿主侧用 meter 的固定密度（4 字符/token）对 yantao 静态节与行为记忆渲染文本估价，面板打开时拉取一次。
4. **会话语义**：只盯当前主会话（`session-maybe` scope 的投影座位）；能力（`kb_run_capability`）在主会话 agent loop 内执行，天然计入；UI 自己发起的后台会话（邮件分析、提炼、校验）是独立会话，不纳入本读数。
5. **摘除上游圆环**：`InputBar.tsx` 不再挂载 ContextMeter——工作台不需要两个 context 读数；`ContextMeter.tsx` 组件本身保留（上游升级面最小化）。
6. **落地形式**：`footer.status` 作为 root 注册的新 children 声明（`session-maybe` scope 的 list 槽），由 ui-yantao 注册唯一的 `yantao-context` 条目；Frame 的 footerStrip 渲染之。这是**上游文件的一处删除性改动**（InputBar 摘除挂载），除此之外全部发生在我们自己的包里。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 上游 composer 失去自带圆环（嵌入上游工作台的场景少了一个读数） | 工作台单一、显著、语义正确的 context 入口 | 有第三方嵌入场景需要 composer 内读数时，以 slot 形式回归而非恢复硬挂载 |
| 2 | yantao 注入份额是宿主侧估价（4 字符/token），非模型实测 | 不动 system-prompt 组装管线，零事件流侵入 | 投影体系将来能观测 assemble 瀑布时改走投影 |
| 3 | 组成三行是启发式密度，与锚定的总量不完全可加（上游已知误差，CJK 系统性低估） | 零新协议——复用既有投影 | 同上 |

原因：

- **为什么是 Remote 端点而不是 fork 侧投影**：曾考虑 fork 侧注册投影吃 `request/header` 的全文 system prompt，但它不带 section 边界，无法分离「yantao 注入了多少」；而 yantao 注入的内容恰好只有 yantao 自己知道（静态节文件＋行为记忆条目），自估自报是最短的真相通道。
- **为什么摘除而不共存**：同一语义两个读数必然漂移（一个在 composer、一个在 footer，刷新时机不同），单用户工作台（ADR-0027）没有并存的受益方。
- **为什么详情面板懒拉取**：注入份额跟随行为记忆变化，缓存必撒谎；但每次渲染都拉则是浪费——折中为面板打开时拉一次，重开重拉。

后果：

- `packages/api/yantao-kb-controller`：新增 `promptInjection` Remote 方法与 `KbPromptInjectionResult`（`staticTokens` / `behaviorMemoryTokens`）。
- `packages/client/ui-yantao`：`ContextStatusBar.tsx` + `.module.css`（新组件）、`remote.ts`（`loadPromptInjection`）、`index.ts`（children 声明＋插槽注册）、`frame/Frame.tsx`（`footer.status` 座位）、`locales.ts`（`context.*` 词条）、`package.json`（devDependency：`@deepseek-ai/dsh-token-meter`）。
- 上游改动（唯一一处）：`packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` 摘除 ContextMeter 挂载与 import。
- 文档同步：`docs/yantao/README.md` ADR 索引（本条）。

## 落地注记（2026-09-30）

全部六项决定当日落地。

- **宿主侧（决定 3）**：`yantao-kb-controller` 新增 `@Remote('promptInjection')`，静态份额按 `YANTAO_SECTIONS` 逐节读文件计价、行为记忆份额按全局记忆条目渲染后计价，均用 4 字符/token 固定密度；未配置 KB 根时行为记忆记 0。typert 产物已再生成（`typert.host.js` / `typert.remote-client.js` 含 `promptInjection` schema）。
- **客户端（决定 1/2/4/6）**：`ui-yantao` 新增 `ContextStatusBar.tsx` + `.module.css`——72×4 分段条＋百分比，>80%/`--yt-warning`、>95%/`--yt-error`，无会话/无样本灰 `--`；详情 popover 自下而上，四行组成＋yantao 注入子行＋剩余可用＋估算底注，yantao 份额在面板打开时拉取一次（重开重拉）。`index.ts` 做 `SlotMap` 声明合并（`'footer.status': list / session-maybe`）并以 `ctx.slots.inject` 注册 `yantao-context` 条目；`Frame.tsx` 的 `PropsRenderSlots` 加入 `footer.status` 并在 footerStrip 渲染；`remote.ts` 新增 `loadPromptInjection`；`locales.ts` 新增 `context.*` 十词条（中英成对）；`package.json` 增 devDependency `@deepseek-ai/dsh-token-meter`（投影键类型合并）。
- **上游摘除（决定 5）**：`InputBar.tsx` 删除 ContextMeter 的 import 与挂载（各一行）；`ContextMeter.tsx` 组件保留。
- **文档**：本 ADR 与 README 索引。
- **验证**：受影响四包（ui-yantao / ui-conversation / yantao-kb-controller / yantao/kb）vitest 73 文件 1237 测试全绿；`tsc -b packages/client/ui-yantao` 与 `tsc -b packages/api/yantao-kb-controller` 干净；oxlint 0/0；`dsh-client-ui-yantao` bundle 与 `dsh-yantao-frontend` build 通过。

落地注记补遗（2026-09-30，旁路会话用量读数）：footer 状态栏只盯主会话，旁路会话（邮件分析/提炼/校验）的消耗原本无处可见。补在任务 tab 的「详情」抽屉顶部：`loadSessionDetail` 本就遍历全部持久事件，`assistant/message` 自带 provider 上报的逐步 `usage`、`request/context` 带路由容量——顺势折算出 `SessionUsage`（Σ输入/Σ输出/步数/末次输入规模/窗口），抽屉头部一条用量带呈现「输入 · 输出 · 共 N tokens（N 步）｜末次上下文 X / Y（Z%）」，>80% 警告色、>95% 危险色，与 footer 状态栏同一套阈值语义。零新 RPC、零 run owner 改动——纯读回侧折叠；运行中任务读到的是已落盘部分，重开即刷新。
