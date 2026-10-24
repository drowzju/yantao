# Assessment B — 确定性扫描与证据（2026-10-23）

范围：`packages/client/ui-yantao/src/client/**`（84 个 ts/tsx + 3 个 css，共 87 文件）、`apps/yantao/src/**`（2 个 ts）+ `apps/yantao/index.html`。
权威：`apps/yantao/DESIGN.md`。已裁决不报项：`.impeccable/critique/ignore.md`（本轮无命中）。

---

## 1. 检测器结果

### 1.1 目标扫描（空集）

```
cd /d/code/yantao
"C:/Users/239895/.codebuddy/skills/impeccable/scripts/impeccable.cmd" detect --json packages/client/ui-yantao/src/client
→ []
EXIT=0
```

- 引擎：`scripts/bin/windows-x64/impeccable.exe`，`--version` 报 **4.0.0**（注意 `scripts/VERSION` 写的是 0.1.11，与实际二进制不符，供排查者注意）。
- findings 数量：**0**，规则名：无，file:line：无。
- 项目配置 `.impeccable/config.json` 只有 `{"buildPath":"code"}`，**没有** `detector.ignoreRules/ignoreFiles/ignoreValues`，不存在"配置把规则关掉"这条解释。

### 1.2 阳性对照（证明空集是检测器失效，不是代码干净）

三组最小违规样本，逐个跑：

| 样本 | 内容 | 结果 |
|---|---|---|
| `probe.html` | 白底 `#f2f2f2` 文字（1.1:1）+ `linear-gradient` + `backdrop-filter: blur(12px)` + `box-shadow: 0 0 40px rgba(255,0,255,.8)` + `border-radius:17px` + `font-size:27px` + `padding:13px` | **2 条**：`low-contrast`(×2)、`dark-glow`(×2)；EXIT=2 |
| `probe.css`（同样违规，纯 CSS 文件） | 1.1:1 文字 + 渐变 + blur + 17px 圆角 + 27px 字号 + 13px padding | **0 条**，EXIT=0 |
| `probe.tsx`（同样违规，内联 style） | `background:'#ff00aa'`、`linear-gradient`、`backdropFilter:'blur(12px)'`、`borderRadius:17`、`fontSize:27`、`padding:13`、`fontFamily:'system-ui, Microsoft YaHei'` | **0 条**，EXIT=0 |

补充对照（真实仓库文件）：`apps/yantao/index.html` → `[]`；`MarkdownView.module.css` → `[]`。

**结论（明确）**：本机 4.0.0 引擎只解析 HTML 内嵌样式，且只实现了 `low-contrast` 与 `dark-glow` 两条规则；**渐变、玻璃、圆角、字号、间距、字体栈这些规则在引擎里根本不存在**。对 `.tsx`（本仓库 97% 的 UI 代码）和 `.css` 一律返回空集，即使写进 1.1:1 的白底白字也不报。
因此 `detect` 返回 `[]` **不能作为"代码干净"的证据**，本仓库该检测器的有效覆盖率约等于 0（只有 HTML 文件才可能触发，而仓库里唯一的 HTML 是 11 行空壳）。以下全部结论来自手工确定性扫描。

---

## 2. 手工确定性扫描（逐项计数）

| # | DESIGN 硬规则 | 命中 | 代表 file:line | 是否误报 |
|---|---|---|---|---|
| 1 | 裸十六进制色值 | **0**（组件代码） | 例外见 2.1 | 例外 5 处均判为非违规 |
| 2 | 阶梯外字号（非 12/13/14/16/20） | **1** | `brand/YantaoMark.tsx:28` `fontSize: 48` | 否（品牌字标，是否豁免需裁决） |
| 3 | 阶梯外间距（非 4/8/12/16/24/32） | **0** | — | — |
| 4 | 圆角档外值（非 2/3/4/6/8/10） | **1** | `WorkspacePanel.tsx:165` `borderRadius: '50%'` | 否 |
| 5 | 内联硬编码字体栈 | **0** | 但有 12 份重复的 token 常量，见 2.5 | 判为非违规 |
| 6 | 装饰性动效（脉冲/打字机/scroll-reveal） | **0** | 见 2.6 | — |
| 7 | 渐变/发光/玻璃/纹理 | **0** | 见 2.7 | — |
| 8 | 卡片套卡片 | **1 确定 + 2 次级** | `WorkspacePanel.tsx:704`（表单卡嵌在空间卡内） | 否 |
| 9 | 时间戳/来源用 ` · ` 缀正文句末 | **25 处 ` · ` 中 1 处疑似** | `SessionDetailDrawer.tsx:307` | 其余 24 处判为豁免，见第 3 节 |
| 10 | select/按钮不限宽挤占主输入 | **1** | `NewEntityRow.tsx:121` | 否 |
| 11 | baseline 对齐致行内动作悬浮 | **0 确定 / 1 候选** | `WorkspacePanel.tsx:595` | 候选，低置信 |

### 2.1 裸十六进制（0）

组件代码里 **0 处**。全仓 hex 命中 54 行，全部落在允许位置：

- `frame/yt-tokens.ts:13-80` — token 正典定义处（DESIGN.md §2 的机器可读副本），允许。
- `frame/theme-presenter.ts:49,53,57` — 注入样式里的 `var(--yt-*, #hex)` **兜底值**（`#3a66b5`/`#726c5e`）。严格读 §2"禁止裸十六进制"算 3 处，但它们是 `var()` 的第二参数、且与 token 值相同，判为**非违规**（若要清理，删掉兜底即可，token 由同一 presenter 写入，兜底永不生效）。
- `editor/ReadOnlyFile.tsx:77`、`validate-verify.ts:8` — 注释里的历史说明与 issue 编号 `#537`，非色值。

对比度基础值（用于后文判断）：`--yt-text-primary` 压 `--yt-surface-primary` = 13.51:1，`--yt-text-muted` 压 surface = 5.00:1，`--yt-text-secondary` 压 raised = 5.77:1，全部过 AA。

### 2.2 阶梯外字号（1）

- `brand/YantaoMark.tsx:28` `capsStyle = { fontSize: 48, fontWeight: 700, lineHeight: 1.1, letterSpacing: '0.06em' }`
  - 48px 不在五档内；`fontWeight: 700` 是全仓**唯一**一处超出 regular/medium/semibold 三档；`lineHeight: 1.1` 不在 1.4/1.6；`letterSpacing: 0.06em` + 全大写 `PARAP` 是 §3 明令禁止的"全大写 + 装饰小标"姿势。
  - 该组件挂在 `conversation.hero.brand.mark` 槽位（`index.ts:522`），即中栏对话首屏，**每个用户每次开新会话都会看到**。
  - 同一文件 `:30` 的副行 `fontSize: 16, opacity: 0.55` 造成对比度问题，见 2.12。
  - 修法（照 §3）：字标本身若必须保留 48px，应在 DESIGN.md §3 明确列为唯一豁免并写进正典；`fontWeight` 回到 600、`lineHeight` 回到 1.4、去掉 `letterSpacing`。三选一由裁决定，但当前状态是"组件私自越档且正典未记录"。
- CSS 侧 `MarkdownView.module.css:13/19/25/31` 的 16/14/13/13px 均在档内。

### 2.3 阶梯外间距（0）

`padding/margin/gap/rowGap/columnGap` 的取值分布：token 引用 300+ 处，数字只剩 `0`（53 处）与 `auto`（13 处），**没有任何裸 px 常量**。CSS 侧 `MarkdownView.module.css` 用 24/8/16/4px，均在六档内。
位置类 px（`bottom: 10`、`width: 8`、`height: 14`、`width: 18`、`width: 260/220/180/72`、`maxHeight: 120`）不属于"间距"，未计入；如需统一治理，这些散落在 `Frame.tsx:368-372`、`SchedulePane.tsx:842`、`WorkspacePanel.tsx:161-167` 等处的布局常量是下一批。

### 2.4 圆角档外值（1）

- `WorkspacePanel.tsx:165` `borderRadius: '50%'`（`circledIconStyle`，18×18 的 − 手势圆钮）。六档里没有 50%，§5 的 2 号档是"≤8px 的小圆点"。同一常量被 `deleteStyle`(:181) 继承，武装态 `armedDeleteStyle`(:188) 才改回 3。
- 其余 91 处 `borderRadius` 全部落在 2/3/4/6/8/10（4→31 处，6→27 处，8→13 处，3→9 处，10→9 处，2→2 处）。

### 2.5 内联硬编码字体栈（0）

- 没有任何组件写 `system-ui`/`Microsoft YaHei`/`ui-monospace` 字面量；全部走 `var(--yt-font-ui)` / `var(--yt-font-code)`。
- 但存在 **10 份重复的一行常量** `const FONT = 'var(--yt-font-ui)'`：`CenterPane.tsx:63`、`Frame.tsx:267`、`InboxPane.tsx:43`、`SessionDashboard.tsx:43`、`SessionOverview.tsx:65`、`TasksPane.tsx:25`、`SchedulePane.tsx:127`、`SelectionMenu.tsx:15`、`Workbench.tsx:143`，以及 2 份 `const CODE_FONT`（`CapabilityPanel.tsx:119`、`SchedulePane.tsx:130`）。这是 §3 当年想消灭的"同一件事抄 N 处"的形状，但因为指向 token，不构成违规，仅记录。
- `--yt-*` token 使用 1194 处；token 定义与使用集合做差集：**无未定义引用、无定义未使用**（`--yt-control-min-h` 已定义并使用，但 DESIGN.md 正文未收录该 token，属正典缺条）。

### 2.6 装饰性动效（0）

全仓 `animation/@keyframes/transition/transform` 命中仅 4 类：

- `TodoBoard.module.css:13-19` `opacity 0→1 + transition 120ms`：hover 显形删除钮。**属于 ignore.md 第 6 条 P3 挂起项**，不报。
- `GraphPane.tsx:184-199` `animateView`：300ms 视口补间，解释"聚焦到某个节点"的状态变化。
- `GraphPane.tsx:229-241` 力学布局循环：alpha 衰减到 floor 自动停。
- `Frame.tsx:373` `transform: translateX(-50%)`：居中定位，非动效。
  无脉冲、无打字机光标、无 scroll-reveal、无自动滚动。

### 2.7 渐变/发光/玻璃/纹理（0）

`linear-gradient|radial-gradient|backdrop-filter|backdropFilter|filter: blur` 全仓 **0 命中**。`boxShadow` 12 处全部引用 `--yt-shadow-menu`(5) / `--yt-shadow-overlay`(7)，无一处自造投影。`Onboarding.tsx:31` 用 `color-mix(in srgb, var(--yt-surface-primary) 94%, transparent)` 做半透明底，不是渐变。

### 2.8 卡片套卡片（1 确定 + 2 次级）

**确定 1 处**：`WorkspacePanel.tsx:704` 的 `<InstructionForm>` 渲染在 `:594` 的 `spaceCardStyle` 卡片**内部**；两者是同一副面孔——`spaceCardStyle`(:111) 与 `formStyle`(:186) 都是 `surface-raised` + `1px border-subtle` + `borderRadius 8`。
伤害可复现：工作空间卡片本身已是浮起白卡，点「＋ 添加指令」后在卡内再长出一张同色同边的卡，边界只能靠 8px 间距区分，用户看到的是"卡片边缘里又套一层卡片边缘"，正是 §5「禁止卡片套卡片」要消灭的形状；且 `spaceCardStyle` 的 `gap: space-1`(4px) 让内卡与外卡的下沿几乎贴在一起。
修法（照 §5/§7）：内层表单不穿卡片皮——去掉 `formStyle` 的 `background/border/borderRadius`，用 `space-2` 上间距 + 一条 `borderTop: 1px border-subtle` 表达"卡内分区"。

**次级 2 处**（判为"内容面"而非卡片，供裁决）：
- `SessionDetailDrawer.tsx:130` 用户气泡（raised + accent-border + r6）、`:188` 用量条（raised + border-subtle + r6），都在 `:130` 前定义的 drawer 面板卡（r10）内。
- `DingTalkDialog.tsx:129` 镜像气泡（raised + border + r6）在对话框卡（r10）内。

### 2.9 时间戳/来源 ` · ` 缀正文句末（25 处 ` · `，1 处疑似）

| 位置 | 内容 | 判定 |
|---|---|---|
| `SessionDetailDrawer.tsx:307` | `{`${row.title} · 会话详情`}` | **疑似**：把"会话详情"这个面板体裁名用 ` · ` 挂在标题后面。§7 禁的是"从属尾巴挂正文句末"，这里是"体裁名挂标题句末"，同一类尾巴；且 §3 明禁"命名文档体裁"的小标。标题本身已在 `aria-label`，后缀只做视觉补充 |
| `SessionDashboard.tsx:94` | `~${tokens} · ${percent}%` | 统计行，豁免 |
| `SessionDashboard.tsx:272`、`SessionOverview.tsx:194/249/250` | `title=`/`aria-label=` 里的 ` · ` | 属性文本，不参与排版，豁免 |
| `SessionOverview.tsx:164-166` | 图表 tooltip 的 ` · 输出 … · 缓存读 …` | 统计枚举，豁免 |
| `SessionDetailDrawer.tsx:315` | `输入 X · 输出 Y · 共 Z tokens（N 步）` | 统计行，豁免 |
| `WorkspacePanel.tsx:660/754/755` | `触发 · 状态 · 起始时间` | 统计行，豁免 |
| `WorkspacePanel.tsx:617` | `{directory} · {model}` | 两者皆元数据，独立 meta 行，豁免 |
| `TasksPane.tsx:97` | `{stage} · {detail}` | 状态枚举，豁免 |
| `CapabilityPanel.tsx:647` | `segments.join(' · ')`（运行摘要） | DESIGN §7 明文豁免的统计行，豁免 |
| `DingTalkDialog.tsx:413` | `{kind} · {owner}` | 元数据对，豁免 |
| `ReadOnlyFile.tsx:281` | `{contentType} · {size} 字节` | 元数据对，豁免 |
| `ProposalCard.tsx:252` | `${owner} · ${action.section}` | 元数据对，豁免 |

### 2.10 select/按钮不限宽（1）

- `NewEntityRow.tsx:121` `<select aria-label={t('relation.label')} …>` — **完全没有 style**。同一行（`rowStyle`:45，flex）里主输入是 `flex: 1, minWidth: 0`(:99)，这个 select 用浏览器原生外观：原生字体（不是 `--yt-font-ui`）、原生边框、原生高度、宽度由最长选项决定。
- 触发路径：右侧实体栏的 **人物** tab，点「新建」后 `Workbench.tsx:1609/1633` 传入 `choice`，编辑行就是"输入框 + 裸 select"。
- 伤害可复现：右栏默认宽 280px（`rail-widths.ts` `RAIL_FALLBACK`），减去栏内 padding 后约 250px；原生 select 吃掉箭头 + UA 内边距后，姓名输入只剩约 170px 可视宽；同时那枚 select 的字体/边框/高度与紧邻的输入框、与整站其它 select（`ConfigDialog.tsx:254`、`SchedulePane.tsx:694` 都穿 `inputStyle`）**明显不是一套控件**。
- 修法（照 §7）：给它 `style={{ ...inputStyle, width: 96, flexShrink: 0 }}` 一类的紧凑定宽 + 与其它表单一致的输入面；长选项截断、`title` 兜底。

### 2.11 baseline 对齐（0 确定 / 1 候选）

全仓 `alignItems: 'baseline'` 40 处，逐处核对配对内容：绝大多数配对的是**单行**文本（`whiteSpace: nowrap` 或 `textOverflow: ellipsis`），按钮不会被拖到文本块中部，判为非违规（`TasksPane.tsx:44`、`MailPanel.tsx:125/137`、`SessionDetailDrawer.tsx:151`、`ProposalCard.tsx:89`、`Workbench.tsx:336`、`TodoBoard.tsx:83`、`CapabilityPanel.tsx:404`、`ReadOnlyFile.tsx:108`、`SessionDashboard.tsx:90/234/329/354/415`、`SessionOverview.tsx:321/340/589/682`）。

**候选 1 处**：`WorkspacePanel.tsx:595` — 该行 `display:flex; alignItems:'baseline'` 里放的是空间标题（`:596` `flex:1, minWidth:0`，**没有 nowrap/ellipsis**）与两个 18px 圆钮（`:597-613`）。空间名一长就折成两行，动作钮按首行基线摆放，与第二行文字并排；这行没有像同文件其它行那样做单行省略，也违反 §5「列表行一律单行省略」。置信度：中（取决于实际空间名长度）。

### 2.12 清单外、但同属 DESIGN 硬规则的确定性发现（可量化）

| 位置 | 事实 | 量化 |
|---|---|---|
| `brand/YantaoMark.tsx:30` | 副行 `fontSize:16` 用 `opacity: 0.55` 压淡 `--yt-text-primary` | 实测对比度 **3.38:1**，16px 正文需 4.5:1，**不过 AA**；§2.2 明文"不用比 muted 更浅的文字凑密度，字号与对比度不可为密度牺牲"（muted 本身是 5.00:1） |
| `SessionDetailDrawer.tsx:283` | 工具调用摘要 `opacity: 0.7` 压淡 `--yt-text-secondary`，12px | 实测 **3.05:1**，12px 需 4.5:1，**不过 AA**；摘要正是用户用来判断"这次工具调了什么"的唯一线索 |
| `WorkspacePanel.tsx:619-627` | 指令表 5 列（名称 + 定时 40 + 步骤 40 + 最近 88 + 动作 72）挤在 360px 栏内 | 固定列占 240px，名称列只剩约 100px（`rail-widths.ts:360` 注释自述"360 leaves the name column ~100px before ellipsis"）。§6「五个及以上列的表不做窄分栏」；该表是管理表（§7），适用范围需裁决 |
| `theme-presenter.ts:69` | 选择器写死上游哈希类 `.PNvALW_placeholder` | 上游改名后规则静默失效（注释自述"honest failure mode"），占位符对比度回落到 2.1:1，且无任何测试会发现 |

---

## 3. 误报清单（为什么是误报）

1. **24 处 ` · ` 里的 24 处**（除 `SessionDetailDrawer.tsx:307`）：DESIGN §7 的豁免条款明确"运行摘要/计数类的统计行不受此限——『手动 · 成功 · 09:30』这类同级事实的并列枚举整行都是元数据"。上表逐条给出内容，全部是同级元数据枚举或 `title/aria-label` 属性文本（属性文本根本不参与排版）。
2. **`yt-tokens.ts` 的 54 个十六进制**：这是 §2 token 表的代码副本，正典的落地点，不是"组件里的裸色值"。DESIGN.md §9 第 1 步要求的正是"theme-presenter 增发 --yt-* 一族"。
3. **`theme-presenter.ts:49/53/57` 的 3 个 hex**：`var(--yt-x, #hex)` 的兜底位，token 由同一个 presenter 写入，兜底永不生效；不构成"组件自行决定颜色"。
4. **`ReadOnlyFile.tsx:77`、`validate-verify.ts:8`**：注释正文（一个是历史说明，一个是 issue 编号 `#537`），正则 `#[0-9a-f]{3,8}` 误匹配。
5. **10 份 `const FONT = 'var(--yt-font-ui)'`**：DESIGN §3 禁的是"内联硬编码字体栈"（把 `system-ui, "Microsoft YaHei", sans-serif` 抄进组件）。这些常量指向 token，换 token 即换全站，规则目的已达成；重复本身是 DRY 问题，不是设计违规。
6. **`GraphPane` 的 rAF 补间与力学循环**：§8 禁的是"自动滚动、打字机光标、脉冲装饰、scroll-reveal"，即**由时间驱动、与用户操作无关**的动效。图视图的补间由点击聚焦触发（`enterFocus`），力学循环在 alpha 低于阈值后自行停止，属"解释状态变化"。
7. **`TodoBoard.module.css:13-19` 的 hover 过渡**：ignore.md 第 6 条 P3 挂起项（删除确认态随 hover 隐形），本轮不报。
8. **`Onboarding.tsx:31` 的 `color-mix(...)`**：半透明混合，不是渐变/玻璃。
9. **`Frame.tsx:373` `transform: translateX(-50%)`**：静态居中定位，不是动效。

---

## 4. 未能完成的步骤及原因

**浏览器证据：不可用。**

- `netstat -ano | grep LISTENING` 在 9222 / 3000 / 5173 / 5174 / 8080 上**无监听**。
- 进程侧：`electron.exe` 有 5 个进程在跑，主进程命令行为 `D:\code\yantao\node_modules\.pnpm\electron@39.8.10\...\electron.exe .` —— **未带 `--remote-debugging-port`**，CDP 无法附着，playwright-cli 连不上。
- 无 dev server：`apps/yantao` 走 Electron 外壳 + profile 装配，单独起 vite 也拿不到 `yantaoKb` 远端，页面会空。
- 结论：本轮**没有**截图、没有 console 采集，也没有把 impeccable 的浏览器内消息记下来。要补这一步，需要用户以 `--remote-debugging-port=9222` 重启工作台（会中断当前会话，属需授权的动作，未执行）。
- 因此 2.12 的对比度数字来自**按 DESIGN.md token 值手工计算 WCAG 相对亮度**（primary 13.51:1 / muted 5.00:1 / secondary 5.77:1 三个基准均与正典自述一致，说明算法对齐），不是从渲染结果采样。若需要渲染态实测，得等端口可用后重跑。

**其余步骤均已执行**：检测器目标扫描 + 三组阳性对照、11 项手工扫描、token 集合双向差集、对比度计算、行号核对（全部 `file:line` 经 grep -n 复核）。
