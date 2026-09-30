# yantao 工作台

yantao 是一个**个人知识工作台**:以纯 Markdown 存放 PARA+P 知识库,并让 agent 写入知识库的唯一通道是一小组可审计的工具。

它构建在 **DeepSeek Harness(`dsh`)** 之上——本仓库**就是** `deepseek-harness`(上游:github.com/deepseek-ai/deepseek-harness),我们在从上游 `master@d347e70390`(发布版 `0.1.3-alpha.1`,ADR-0002)切出的本地分支 `main` 上工作,并**刻意钉住**上游。我们把 dsh 当作**引擎与后端**;yantao 的一切都是增量添加的。日常开发(构建、运行、停止、测试、门禁、坑)见 [development.md](development.md)。

## 1. 本工程与 DeepSeek Harness 的关系(先读这段)

| | |
|---|---|
| 本仓库是什么 | `deepseek-harness` 本身(上游:`github.com/deepseek-ai/deepseek-harness`),不是复制式分叉 |
| 我们在哪工作 | 本地分支 `main`,自上游 `master` 的 `d347e70390` 切出(发布版 `0.1.3-alpha.1`) |
| 上游跟踪 | `origin/master` 仍指向上游;我们**钉版本**、按节奏刻意升级(ADR-0002)——上游每周都有破坏性变更 |
| 远端 | `origin` = 上游 dsh(只 fetch,永不 push)。`yantao` = **你自己的远端**,本地 `main` 推到这里。`master` 跟踪 `origin`,`main` 跟踪 `yantao`。 |
| 我们的原则 | yantao 需要的一切都**增量添加**(新包、新 profile 模板),或在上游文件里做**有据可查的一行登记**。绝不重构上游内部。 |
| agent 运行时 | 用 dsh 自己的:agent loop、工具、session 事件日志、Typert RPC。我们只加插件与 profile,不分叉引擎。 |

### 合并面:我们改动的上游文件

以下是目前工程触及的全部上游文件。请保持这个清单短小——**它就是我们升级上游的成本**。

| 文件 | 为什么动 |
|---|---|
| `packages/boot/app-boot/src/profile.ts` | 注册 profile 模板 `yantao` 与 `yantao-web` |
| `apps/cli/package.json` | workspace 依赖,让 profile 树能解析我们的包 |
| `packages/api/remotes/{package.json,src/client/index.ts,tsconfig.*.json}` | 在两个平面挂载 `yantaoKb` Remote 命名空间 |
| `packages/client/ui-conversation/src/client/input/facade.ts` | 引用 chip 退格逐级展开为父目录提及(ADR-0028 决定 5):`KEY_BACKSPACE_COMMAND` CRITICAL 注册 |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 我们 Remote 的生成式目录条目 |
| `tsconfig.base.json`、`tsconfig.client.json`、`tsconfig.host.json` | 我们包的生成别名与项目引用 |
| `docs/capability-seams.md`、`docs/config-catalog.md` | 重新生成的文档 |
| `scripts/gen-cordis-catalog.ts`、`scripts/gen-doc-graphs.ts`、`scripts/type-equiv.manifest.json`、`scripts/verify-subsystem-pages.ts`、`scripts/verify-package-readme-model-experience.ts` | 生成器与门禁旁车,必须知道我们的包存在 |
| `packages/{api,bundle,client}/README{,.zh}.md` 及配对记录 | 包地图列出每个成员 |
| `pnpm-workspace.yaml` | 一条 `allowBuilds` 条目:`electron: true`;没有它 pnpm 拒绝执行 Electron 的 postinstall,二进制根本不会下载(ADR-0016) |
| `pnpm-lock.yaml`、`.gitignore` | 依赖链接;`apps/yantao/dist/` 忽略规则 |

其余完全属于我们:`packages/yantao/**`、`packages/client/ui-yantao/**`、`packages/bundle/yantao/**`、`packages/bundle/yantao-web-app/**`、`packages/api/yantao-kb-controller/**`、`packages/preset/agent-presets/presets/yantao/**`、`apps/yantao/**`、`docs/adr/**`、`docs/yantao/**`、`docs/subsystems/yantao*`、`CONTEXT-MAP.md`、`.env.example`、`.npmrc`。

### 升级上游

1. 读上游发布说明;默认有破坏性变更。
2. 把 `origin/master` 合并/rebase 到 `main`,只解决上面合并面里的文件。
3. 重跑生成器(`pnpm run gen-tsconfig-paths`、文档/目录生成器)与门禁套件。
4. 重跑 [development.md](development.md) 里的冒烟测试——headless 作答 + 工作台 `intakeTree()`。

## 2. 架构

```
apps/yantao-desktop (Electron)  ──spawns & loads──►  dsh profile yantao-web
                                                     = dsh-base + dsh-yantao + dsh-yantao-web-app
apps/yantao (React + Vite)  ──served by──►                │
   own three-pane UI                                      ├─ agent loop, kb_* tools, session log
   talks to ctx.remote only                               ├─ packages/yantao/kb ....... PARA+P domain + the kb_* tool set
                                                          ├─ packages/api/yantao-kb-controller ... yantaoKb Remote
                                                          │    (intakeTree / workspaceTree / read / write
                                                          │     root / setRoot / createEntity)
                                                          └─ llm-pi-ai route `model-gateway` ..... intranet LLM gateway (ADR-0007)

profile `yantao` = the same stack without the web surface (one-shot headless runs)
```

- **dsh 是后端。** 我们的 UI 通过 Typert RPC 与转发事件流消费它,而浏览器外壳归我们:工作台插件注册运行时内置的 `root` 槽位、自绘三栏外框(ADR-0011),`ui-layout` 已退出名单。中间一列是 tab 化的:常驻的「对话」tab 通过 `conversation` 座位承载宿主的会话面(ADR-0009),每个打开的 KB 文件各占一个可关闭 tab,自动保存并带冲突检查(ADR-0012)。
- **信任边界在工具层。** agent 有十一个 `kb_*` 工具、没有通用写能力;它现在可以通过 `kb_write_state` 写实体的「状态」区——这正是 ADR-0010 对 ADR-0004 的修订:边界是工具集,不是区段;它读写 `resources/` 分别走 `kb_write_resource`(只新建)与 `kb_read_resource`(只读,ADR-0028);它运行能力也只能通过 `kb_run_capability`,由 sidecar 的 `invocation` 字段逐能力把关(ADR-0023)。**UI 是人类通道**,可以编辑任何内容。
- **知识存在文件里**,不是数据库:KB 根下的 `resources/`、`entities/{projects,areas,people,meetings}/`、`entities/todos.md` 单例,以及暂不使用的 `sessions/`(ADR-0005,目录结构调整见 ADR-0010)。每个实体文件里的「状态」/「流水」两区就是人与 agent 的边界。
- **知识库根目录由人选。** 首次进入会要求选一个目录并持久化到 `~/.dsh/yantao-kb.json`(`yantaoKb.root()` / `setRoot()`);两条侧栏通过 `yantaoKb.createEntity()` 就地新建实体(ADR-0012)。

## 3. 领域用语(请用这些词)

规范术语在 [CONTEXT-MAP.md](../../CONTEXT-MAP.md)(上下文地图)与[packages/yantao/CONTEXT.md](../../packages/yantao/CONTEXT.md)(词汇表)。承重词:

**知识库 / Resource / 影子笔记 / Entity / 会议(Meeting) / 待办(Todo) / 连接(Connector) / State(状态) / 流水(Log) / 提炼(Refine) / LLM 网关 / Session(事件日志)**

不要在代码、提交与文档里自造同义词;也不要用厂商名称呼 LLM 路由(它是 `model-gateway`,不是 `glm-gateway`,见 ADR-0007)。

## 4. 决策(ADR 索引)

| ADR | 决策 |
|---|---|
| 0001 | 以 dsh 插件形态重建 yantao,放弃旧 Flutter 应用 |
| 0002 | 钉住上游 0.1.3-alpha.1,刻意升级 |
| 0003 | 工作台 UI 作为独立 app(机制后被 0008/0009 细化) |
| 0004 | 信任边界 = 工具集;「状态」原为人类专属,现已改为 agent 可写(ADR-0010);流水区仍只追加 |
| 0005 | 沿用纯 Markdown 知识库格式 |
| 0006 | yantao 包仅中文文案,放宽该范围的双语配对门 |
| 0007 | LLM 走内网模型网关;ACP/codebuddy 不是运行时路径 |
| 0008 | *(被 0009 取代)* 用 dsh 客户端插件组合 UI |
| 0009 | 自研前端、dsh 退居后端。**已验证**,并记录了教训 |
| 0010 | 领域模型扩张:`meeting` 实体、`todo` 单例、预留 `connector`;三栏布局、两棵树、`kb_write_state` |
| 0011 | 工作台外框归我们:`ui-yantao` 注册运行时 `root` 槽位,`ui-layout` 退出名单 |
| 0012 | 中栏 tab 化:原文编辑 + 自动保存 + 冲突检查、就地新建实体、首启自选知识库目录 |
| 0013 | 品牌(PARAP + 自绘 hero 标)、中栏工作目录跟随知识库根目录、`@` 引用解析为知识库文件 |
| 0014 | 文件默认打开为渲染后的阅读视图,YAML 信封折叠,编辑仍走原文编辑器 |
| 0015 | 实体间 `[[双链]]`:由新增的 `links(path)` RPC 在宿主侧解析,并给出反向链接面板 |
| 0016 | 桌面外壳:Electron 把 dsh 宿主作为**子进程**拉起(同进程方案已被否决);`file://` 过不了 Origin 围栏,所以加载 loopback HTTP |
| 0017 | 编辑器策略:先借 Obsidian 做重编辑(`openExternal`)+ `revision()` 监听,而不是现在就自研编辑器 |
| 0018 | 待办载体:`[due::]`/`[done::]` 结构化行 + 左栏 TODO/DONE 双面板;解析只在宿主侧,agent 不写待办 |
| 0019 | 第一个连接器:Outlook 邮件(COM 子进程读邮件,dsh session 分析,人工确认后才写库) |
| 0020 | 读书项目与资源入库:拖放入库、`source:` 字段判别的读书项目、惰性 py 脚本抽取、废除影子笔记配对(读书项目与 `ebook` 能力已于 2026-09-14 退役——见该 ADR 落地注记) |
| 0021 | 能力系统:连接重构为能力(skill 目录 + 宿主入口 + appliesTo 声明),统一提议流,mail/extract 全量迁移;取舍台账独立成节 |
| 0022 | 系统提示词分层:yantao 的系统指令以命名 section 叠加在 dsh 注册表上,源文件为仓库 Markdown;persona 保持薄身份声明 |
| 0023 | 能力的模型侧调用:`kb_run_capability` 按 sidecar `invocation` 字段逐能力门控,动态目录注入,缺 entry 的指令型能力,播种覆盖前备份;重开 ADR-0021 台账第 1、2 条 |
| 0024 | KB 自包含:yantao 自有数据只落 KB 根——能力状态迁至 `<kbRoot>/.dsh/yantao/state.json`(原 `.yantao/`,2026-09-17 修订并入 `.dsh/yantao/`,KB 根只留一个机器簿记目录;一次性导入,旧文件改名 `.bak`),KB 指针进 settings plane,技能只认 `<kbRoot>/.dsh/skills/` |
| 0025 | 三方技能接入:未注册分组 + 拷贝进 KB 的采纳动作,`/xxx` 手势(pre-step 双消息注入),资源右键对指令型能力发当前会话,选区右键 opt-in,`/` 自动补全源,注册 = 在中央路由文件 `.dsh/skills/yantao.json` 写路由条目(不移动、不改名) |
| 0026 | 类型化模板与协作边界重划:实体模板文件 `<kbRoot>/.dsh/yantao/templates/<type>.md`(原 `.yantao/templates`,随 ADR-0024 修订迁移) + 内置回落(状态以模板为主——模板没写该区段就不补、不校验;流水由机制保证——缺失自动补齐、重复才回落),`kb_edit_section` 区段寻址编辑(流水仍只追加、frontmatter 封存),`kb_write_resource` 只新建不覆盖,右键/选区手势统一为合成 `/name @path` slash 消息走 pre-step 管线(客户端拼接退役) |
| 0027 | 单人项目的门禁降级:yantao 自有文档与包 README 中文单语化(删 twins 与配对记录,豁免目录化),model-experience 门摘除 yantao 包,pre-push 全仓 typecheck 移除;staged lint、whitespace、vendor manifest、notices、生成目录检查与测试保留 |
| 0028 | 资源读取与目录提及:`kb_read_resource` 第十一个工具(文件 UTF-8 全文/二进制拒绝报大小,目录递归清单封顶 100),`@` 目录提及展开为清单+内容(96k 预算、二进制占位行),资源栏树状展示(可折叠、零 wire 变更),`@` 菜单合成目录候选 + serialize 空格引号 |
| 0029 | 提炼闭环 v1:资源归入(拖资源到实体行,系统拖入先登记再分析)与实体提炼(右键)共用一条管线——UI 直驱专用会话(mail 分析先例,非 pre-step、不声明能力、零新 RPC/工具),JSON 裁决解析为提议卡;卡新增 `edit-section` 动作(缺区段补建、流水拒绝、frontmatter 不碰),落盘重读重定位逐动作失败标红;无关 toast 不留痕,逐实体 opt-in 不批量迁移(ADR-0026 台账 #6 的兑现形态) |
| 0030 | 提炼闭环 v2:第三手势「提炼到实体」(资源行/目录行右键,一份资源对整个实体花名册的碰撞,目录逐文件独立会话串行排队);裁决协议 v2(targets[]/creates[]/questions[],旧单实体形状兼容,空行丢弃);creates 先行 + create-follows-create(`afterCreate` + applier `created` 映射);双链成结构化 `create-link` 行;questions 两段式(同会话续答,至多一轮);花名册整体注入(实体 8k/资源 32k 截断、二进制占位);UI 串行手势队列 + QuestionDialog;会议内置骨架补 `## 决议`/`## 待办` |
| 0031 | 任务统一视图与取消:三类后台执行(提炼/邮件分析/能力)各有取消语义——提炼中止会话清队列、邮件停 chunk 保判定不动水位、能力杀子进程(刷新=杀任务),AbortSignal 作宿主方法尾参;中央栏常驻「任务」tab(运行数徽标、运行中置顶的扁平单列,行=动作+对象/阶段/进展/耗时/取消/查看),前端聚合三态、仅前端记忆,零后端任务模型;agent 发起的执行不可见为已记录局限 |
| 0032 | 记忆系统:行为规则层——记忆 = 影响 agent 行为的规则与偏好(「怎么做」),实体知识(「是什么」)仍落实体;三类作用域(全局/能力域/实体域),一期只做前两档、实体域挂起观察,注入全走动态(ADR-0022 增补动态 section),写入走提案卡人批且永不免审(低频高杠杆、自我强化);首个验证场景邮件分诊;实现期增量与五项待决记于 ADR,零立即代码改动 |
| 0033 | 任务会话详情:「任务」行的只读审计抽屉——行带会话锚点(提炼/邮件分析回填,脚本能力无锚点无入口),读盘走上游现成的 follow snapshot + `page` 回溯(零新 RPC、零上游改动),整形规则钉死纯模块(user 原文/注入弱化、assistant 逐条、tool 按 callId 配对成可折叠节点链、系统提示词不展示),16k/4k/8k 裁剪,任务 tab 盒内浮层 Esc/关闭/遮罩收回;任务行仍仅前端记忆(deferred「任务落盘登记」) |
| 0034 | 邮件三分拣 v2:行为记忆与执行层对齐——注入剥日期(存储保留)、清单分组清洗(项目/领域分列、去 self、无邮箱标注)、注入围栏(正文定界符+不可信声明)、focus 判据改合取(主送我或含 superior+真人发件+严重内容语义判定)+安全告警例外;schema 增 `newProjects`/`meetings`/`deletions` 三槽(`projects` 收紧为只挂已存在),提案扩展 create-project 带领域勾选写 frontmatter;删除刀仅人通道(COM 移入已删除文件夹,agent 只有提名权,kb_* 保持十一);渐进加载/agentic 化记 deferred |
| 0035 | 实体校验(validate 手势):第四手势补上 Ingest/Query 之外的 Lint——新 RPC `yantaoKb.graph()` 全库双链图,客户端确定性预扫(孤儿条目/失效双链)作模型研判线索;`ValidateVerdict`(findings 纯展示行 + targets/creates 复用 v2 条目形状 + todos + questions 两段式);L1 只许建页建链、L2 解锁 edit-section/add-todo(write-state 永不在白名单);L2=超集、按类型分批接力、失败部分交付,施工另立 ADR-0036;只弹卡不落盘、无调度无口令、等级不持久化;汇总给 token/耗时 |
| 0036 | 实体校验 v2 回归纯体检:ADR-0035 决定 3/4 被取代——预扫(孤儿/失链)绕过模型直出确定性区块,`creates` 移除(建页归提炼手势,validate 只发现+补链);诊断调用窄化为过期/矛盾/缺链机会三维度(规则硬编码,冗余检测暂缓);代码侧防御核验(findings/targets 引用对花名册与图校验,解析不到即弃);失链修复候选由代码相似度匹配生成;提议卡分确定性/模型两区块不混排;协议保持 JSON verdict+reask;L2 重构想另立 ADR。设计背景见 `.scratch/entity-validate-v2/analysis.md`(llm_wiki 对照) |
| 0037 | 邮件原文归档:高价值邮件存自包含 `.eml`(COM SaveAs `.msg`→本地转 MIME,失败降级 `.msg` 兜底)落 `resources/mails/YYYY/MM/`,月度索引 `mail-index/mailsYYYYMM.md`(八列表,收件人完整入档是对 ADR-0019 的显式例外);能力脚本直写资源=ADR-0026 遗留首个落地,沿用提案批准流,幂等去重、逐封串行、25MB 封顶,零新工具零新 RPC |
| 0038 | 提案卡易用性修订:汇总块默认折叠+剔除删除提名+合并键降级(发件人+裸主题)+digest why 限 20 字;分析 schema 五槽位增 `mail` 溯源,实体组按来源邮件分层子标题全选;新建实体的决议/待办补充行与创建行同框一个复选框(依赖可见,不再静默跳过);章节补充行 label=`实体名·章节`、detail 显实际文本、提示词禁复述 why;分组级全选三态;「点开 Outlook 原邮件」列为未来独立 ADR 候选 |
| 0039 | footer 上下文状态栏:配置按钮旁常驻分段条+百分比(>80% 警告/>95% 危险,无数据显示 `--`),点击弹详情(系统提示+yantao 注入子行/工具定义/对话历史/剩余可用);读 `contextPressure`/`contextBreakdown` 投影,yantao 注入份额走新 `yantaoKb.promptInjection` Remote(assemble 瀑布不进事件流,自估自报);只盯当前主会话,UI 后台会话不计入;摘除上游 InputBar 的 ContextMeter 圆环(唯一上游改动) |

## 5. 快速上手

```bash
cp .env.example .env          # then fill in MODEL_GATEWAY_API_KEY
pnpm install

# workbench (Electron window + tray; spawns the dsh host as a child process, ADR-0016)
pnpm --filter @deepseek-ai/dsh-yantao-desktop start

# headless smoke test: one prompt through the GLM gateway
pnpm dsh --profile yantao "用一句话回答：1+1等于几？"
```

完整的构建/验证命令、门禁与坑:[development.md](development.md)。

## 6. 文档地图

**入口文件归我们,上游的以 `_dsh` 后缀保留。**

根目录的 [README.md](../../README.md) 与 [AGENTS.md](../../AGENTS.md) 描述的是 **yantao**,不是上游 dsh。上游原文件原样保留为[docs/upstream/README_dsh.md](../upstream/README_dsh.zh.md) / `README_dsh.zh.md`,以及 [AGENTS_dsh.md](../../AGENTS_dsh.md)。

为什么 `_dsh` 副本放在 `docs/upstream/` 而不是根目录:双语配对门(`scripts/verify-translation-pairing.ts` 及其清单)把**改名后的根README** 视为范围外,于是根级 `README_dsh.md` 无法作为一对被记录,提交会被拒绝;放在 `docs/` 下则是范围内,可以正常记录。以后移动文档请记住:**文件放在哪,决定了它能不能成为一对。**

**我们的**

| 文档 | 内容 |
|---|---|
| [development.md](development.md) | 构建、运行、停止、测试、门禁、坑 |
| [design.md](design.md) | UI 设计规则:`--yt-*` token、排版与间距阶梯、表面与构图纪律、迁移路径 |
| [TODO.md](TODO.md) | 待办:done / next / deferred(每个搁置项都带原因) |
| [../adr/](../adr/) | ADR 0001–0039(索引见第 4 节) |
| [../subsystems/yantao.md](../subsystems/yantao.md) | 知识库与 `yantaoKb` Remote 子系统页(上游子系统格式) |
| [CONTEXT-MAP.md](../../CONTEXT-MAP.md) | 上下文地图:yantao 工作台 ↔ dsh 平台 |
| [packages/yantao/CONTEXT.md](../../packages/yantao/CONTEXT.md) | 词汇表(规范用词) |

**上游 dsh —— 对我们包以外的一切仍然权威**

| 文档 | 内容 |
|---|---|
| [README_dsh.zh.md](../upstream/README_dsh.zh.md) | 上游项目 README(原样保留) |
| [AGENTS_dsh.md](../../AGENTS_dsh.md) | 上游 agent/开发指引(原样保留) |
| [../architecture.md](../architecture.zh.md) | dsh 架构:profile、bundle、能力接缝 |
| [../cordis-primer.md](../cordis-primer.zh.md) · [../cordis-tutorial/](../cordis-tutorial/) | Cordis loader、配置与 patch 语言 |
| [../cookbook/](../cookbook/) | 如何加包、加工具、加 LLM adapter、加 Remote API |
| [../i18n/README.zh.md](../i18n/README.zh.md) | 双语文档契约(三文件一对) |
