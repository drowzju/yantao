# yantao 待办

[English](TODO.md) | 中文

活的清单。状态词:**done**(已合入 `main`)、**next**(已排队)、**blocked**(已排队但跑不起来,附原因)、**deferred**(有意搁置,附原因)。

## done — v0 骨架

| 项 | 位置 |
|---|---|
| `yantao` profile:模型网关路由 + 中文 persona + KB 工具 | `packages/bundle/yantao/` |
| 基于 `llm-pi-ai` 的模型网关(`model-gateway`,与厂商无关) | `packages/bundle/yantao/cordis.patch.yml`,ADR-0007 |
| PARA+P 领域插件:六个 `kb_*` 工具、状态/流水信任边界(33 个测试) | `packages/yantao/kb/`,ADR-0004 |
| 给 UI 的 `yantaoKb` Typert Remote(`tree` / `read` / `write`) | `packages/api/yantao-kb-controller/` |
| 由 dsh 伺服的自研前端 + 我们的客户端插件打通 `ctx.remote.yantaoKb` | `apps/yantao/`、`packages/client/ui-yantao/`,ADR-0009 |
| 启动/停止脚本(常驻,无超时) | `scripts/yantao-web-{start,stop}.ps1` |
| 工作区已清理:`packages/*/src` 下 297 个生成文件已删除 | 单包 `tsc -b` 留下的 `.js` / `.d.ts` / `.map`;上游在那里只跟踪 `.ts`/`.tsx` |
| 中文目录侧补齐(`config-catalog.zh.md`、`capability-seams.zh.md`)+ 配对重新记录 | `docs/config-catalog.zh.md`、`docs/capability-seams.zh.md`;加入 yantao 条目与英文侧一致 |
| `ui-yantao` 加入 client 包地图 | `packages/client/README.md`、`README.zh.md` |
| ADR-0008 frontmatter 标记 `status: superseded` | `docs/adr/0008-workbench-ui-as-bundle-plus-client-plugins.md` |
| 中文专属 yantao 文档豁免双语配对 | `scripts/translation-pairing.manifest.json` —— ADR + CONTEXT-MAP + CONTEXT.md 加入 excluded 列表 |
| 领域模型扩展:`meeting` + `todo` 两类 | `packages/yantao/kb/src/types.ts`(`EntityType`、`ENTITY_DIRS`、`SINGLETON_FILES`)、`paths.ts`(单例 `entityFilePath`,五类全部进入 `normalizeEntityType` / 定位器)、`templates.ts`(meeting 模板 + `todoFileContent` + `KB_README` 文案) |
| `kb_init` 创建 `entities/meetings/` 与 `entities/todos.md`(幂等);`kb_create_entity` 接受 `meeting`、拒绝单例 | `packages/yantao/kb/src/core.ts`、`index.ts`(meeting 新增 `date` 参数) |
| `kb_write_state` —— 第七个 `kb_*` 工具,经 `replaceStateSection` 拼接器改写 `状态`;`kb_append_log` 描述不再声称状态人类专属 | `packages/yantao/kb/src/splice.ts`、`core.ts`、`index.ts`;ADR-0010 |
| KB 测试 33 → 51:meeting 模板、todo 单例、`replaceStateSection`、`kb_write_state`、单例列出 | `packages/yantao/kb/tests/kb.spec.ts` |
| KB 包 README 双语对更新为七个工具、状态可由 agent 写入 | `packages/yantao/kb/README.md`、`README.zh.md`(+ 重录 `.i18n.yaml`) |
| `yantaoKb.tree()` 拆为 `intakeTree()`(resources + meetings + todos)与 `workspaceTree()`(projects + areas + people);`sessions` section 移除 | `packages/api/yantao-kb-controller/src/{index,types}.ts`;`packages/yantao/kb/src/paths.ts` 导出 `entityDisplayPath`,使 todo 单例解析到 `entities/todos.md` |
| controller spec 按双树重写(9 个测试),Cordis API surface 重新生成 | `packages/api/yantao-kb-controller/tests/controller.spec.ts`、`docs/subsystems/yantao.md`、`packages/extensions/tool-cordis/src/api-catalog.ts` |
| 侧边栏与 spike probe 跟进两个 RPC;新增 会议 / 待办 section 标签 | `packages/client/ui-yantao-kb/src/client/{service,KbTree,editor-state,locales}.ts(x)`、`packages/client/ui-yantao/src/client/index.ts` |
| `ui-yantao` 三栏骨架:输入栏(资源/待办/会议/连接)+ 工作栏(领域/人物/项目 三个 tab),走 `intakeTree()` / `workspaceTree()`;覆盖层点击穿透,中间一列仍是宿主的 agent 交互区 | `packages/client/ui-yantao/src/client/{index,Workbench.tsx,remote.ts}` |
| `ui-yantao` client spec(3 个测试)与通过两个包门禁的 README 双语对 | `packages/client/ui-yantao/tests/workbench.client.spec.tsx`、`README.md`、`README.zh.md` |
| 共享 shell 第一行退场:`ui-yantao-kb` 移出 yantao-web roster,目录重新生成 | `packages/bundle/yantao-web-app/cordis.patch.yml`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| 两条侧栏改为通过宿主自己的槽位贡献:`IntakeRail` 注册进 `sidebar`(框架自带的拖拽手柄可改宽度,`toggleSidebar` 可收成图标栏),`WorkspaceRail` 注册进 `shell.overlay`(可收成把手);挂在 body 上的 React root 已删除 | `packages/client/ui-yantao/src/client/{index,Workbench.tsx,remote.ts}`、`tsconfig.base.json`(补上缺失的 `ui-yantao` 别名)、`packages/client/ui-yantao/tsconfig.json`(项目引用)、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| **外框归我们(ADR-0011)**:`ui-yantao` 把自绘三栏外框注册进运行时内置的 `root` 槽位,声明 `conversation` + `shell.overlay`,并提供 `ctx.layout` 与主题 presenter;`ui-layout` 移出 yantao-web roster,两条侧栏都是真正的网格列——拖拽与折叠重新对称 | `packages/client/ui-yantao/src/client/{index,Workbench.tsx,frame/*}`、`packages/bundle/yantao-web-app/cordis.patch.yml`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`、`docs/adr/0011-yantao-owns-the-workbench-frame.md` |
| **文档同步到当下世界**:`CONTEXT.md` 词条(meeting / todo / connector、`状态` agent 可编辑、移除 `会话`)与架构页的架构图 + ADR 索引(七个 `kb_*` 工具、ADR-0010/0011/0012) | `packages/yantao/CONTEXT.md`、`docs/yantao/README.md` + `.zh.md`(`.i18n.yaml` 重录);提交 `d2f088387b` |
| **我们自己的 id 在 `tsconfig.base.json` 的映射** —— `dsh-client-ui-yantao`(及 `/client`)与 `dsh-yantao-web-app/startup`;`verify-cordis-config` 不再报 yantao 问题(仍在报的 `apps/cli/tests/profiles/acp/cordis.yml` 是上游 CLI 夹具) | `tsconfig.base.json` |
| **`[[双链]]` 与反向链接(ADR-0015)** —— `[[名字]]` / `[[类型:名字]]` / `[[名字|显示名]]`,按已有 `type:name` 规则解析且只在唯一命中时成立,绝不指向 `resources/`;未解析保留方括号。新增 `yantaoKb.links(path)` RPC 返回 `{ outgoing, incoming }`,由宿主计算(树加载本来就会读全文);已解析的链接渲染到保留域 `kb.invalid` 并由阅读视图接住点击,顶部「反向链接 N」列出引用了本文件的条目 | `packages/yantao/kb/src/links.ts`、`packages/api/yantao-kb-controller/src/{index,types}.ts`、`packages/client/ui-yantao/src/client/{markdown.ts,remote.ts,editor/MarkdownView.tsx,frame/Frame.tsx}`、`docs/adr/0015-*`(新增 19 个测试) |
| **阅读视图 v2 —— 任务框可勾选 + 标题大纲** —— `MarkdownText` 把 checkbox 渲染成 disabled(且浏览器不给禁用控件派发点击),所以视图渲染后重新启用它们并自己接住点击:第 N 个渲染出来的框对应源码第 N 个 `- [ ]` 行,翻转交给编辑器的单命令 `patch()`,和打字走同一次保存前比对;冲突时自动切到源码视图,免得冲突条被阅读视图藏起来。「大纲」列出正文标题(跳过围栏代码块)并可跳转。两处按序号的映射在数量对不上时一律拒绝 | `packages/client/ui-yantao/src/client/{markdown.ts,editor/MarkdownView.tsx,editor/FileEditor.tsx,frame/Frame.tsx}`(新增 18 个测试) |
| **文件默认打开为阅读视图(ADR-0014,v1)** —— `.md` 默认用 `MarkdownText` 渲染,tab 条上给「阅读 / 源码」开关;`splitFrontmatter()` 把 YAML 信封折成一行摘要、点开是字段表格;源码编辑器保持挂载(隐藏)并上报草稿,两个视图共用一次加载;非 md 原件仍是原文;待办内联清单不动 | `packages/client/ui-yantao/src/client/{markdown.ts,editor/MarkdownView.tsx,editor/FileEditor.tsx,frame/CenterPane.tsx,frame/Frame.tsx}`、`docs/adr/0014-*`(新增 20 个测试) |
| **品牌、工作目录与 `@` 引用(ADR-0013)** —— 中栏工作目录跟随知识库根目录(`workspaces.create` + `uiWorkspace.startSession`,首启/更改目录后重跑);hero 文案改为 `PARAP`、经 `conversation.hero.brand.mark` 槽位换成我们自己的标、并去掉 Preview 徽章;`@` 按 section 列出知识库实体,`agent/pre-step` 展开器把插入的 `@路径` 解析成被引用文件的内容 | `packages/client/ui-yantao/src/client/{index,kb-workspace,kb-reference}.ts`、`src/client/brand/YantaoMark.tsx`、`src/client/frame/frame.module.css`、`packages/yantao/kb/src/{index,mentions}.ts`、`docs/adr/0013-*`(新增 12 个测试) |
| **两条侧栏共用一个选中项** —— 中栏当前文件即选中项:归属本栏时该栏把对应 tab 推到前台(高亮行因此可见),不归属本栏时不动用户自己选的 tab;切换 tab 时高亮跟随,恢复的 tab 也能找回自己的行 | `packages/client/ui-yantao/src/client/{Workbench.tsx,frame/Frame.tsx}`(新增 4 个测试:揭示、忽略、跟随当前 tab,见 `tests/workbench.client.spec.tsx`) |
| **工作台能打开、编辑、新建文件(ADR-0012)**:中栏 tab(常驻「对话」+ 可关闭的文件 tab,从 localStorage 恢复)、原文 markdown 自动保存与保存前冲突比对、会议 / 领域 / 人物 / 项目的 inline「+ 新建」走 `yantaoKb.createEntity`、会议文件名带日期前缀、基于 `entities/todos.md` 的待办内联清单、资源只读、首启目录选择器持久化到 `~/.dsh/yantao-kb.json` | `packages/client/ui-yantao/src/client/{frame/CenterPane,editor/*,TodoList,NewEntityRow,Onboarding,tabs}.tsx`、`packages/yantao/kb/src/{core,paths,root-store,index}.ts`、`packages/api/yantao-kb-controller/src/{index,types}.ts`、`docs/adr/0012-*` |
| **`ADR-0015` 的双链真正到达浏览器** — 之前只跑了 `build:lib:client`，把上一版没有 `links` 的契约内联进了 `packages/api/remotes/lib/client.js`，浏览器端 `ctx.remote.yantaoKb.links` 因此不存在，`[[…]]` 渲染成字面量方括号。按 `build:lib`（host 先生成 Typert face、client 再内联）重建并重启后生效 | 验证：Playwright 驱动系统 Edge 冒烟，`/api/yantaoKb/links` 返回 200 且 `outgoing`/`incoming` 正确，`[[我自己]]` 渲染成 `https://kb.invalid/…` 锚点，工具条出现 `反向链接 1`；截图 `.dsh-build/smoke.png` |
| **`pnpm run lint` 转绿** — 21 处 `toThrowError` → `toThrow`（消除 deprecation）；`unbound-method`：把 `Element.prototype.scrollIntoView` 的 mock 持有为变量再断言，不再从元素上读回方法 | `packages/yantao/kb/tests/kb.spec.ts`，`packages/client/ui-yantao/tests/markdown-view.client.spec.tsx`。验证：3153 文件、90 规则、`typeAware: true`（tsgolint 已启用）、0 warnings / 0 errors；yantao 三个包 214 个测试全通过 |
| **测试文件名补上 face 后缀** — `markdown.spec.ts` 没有后缀，被 `tsconfig.host.json` 的 `packages/*/*/tests/**/*.ts` 扫进 host 程序，而它 import 的 `src/client/markdown.ts` 属 client 面 → TS6307，host 构建直接失败 | 重命名为 `packages/client/ui-yantao/tests/markdown.client.spec.ts`（host 排除、client 包含）；`pnpm run build:lib` 与 `tsc -b tsconfig.client.json` 均通过 |
| **Obsidian 桥接（ADR-0017）** — `yantaoKb.revision()`（chokidar 常驻 watcher + debounce 计数器，随 `setRoot` 重建）与 `yantaoKb.openExternal(target)`（只接受 KB 内路径或 `obsidian:`/`vscode:`/http(s)/mailto: 白名单协议，并拒绝 shell 元字符）；UI 侧 3 秒轮询比对 revision、窗口 focus 也查一次 | `packages/api/yantao-kb-controller/src/{watch,open}.ts`；控制器测试 16 → 36。验证：234 个测试全通过、lint 0/0 |
| **链接图随内容变化重算** — `Frame.tsx` 里算 `linkGraph` 的 effect 依赖加上文件正文（350ms 防抖，`linksOf` 会重读全库算 `incoming`）。原先只有 `activePath`/`treeKey`，所以敲完 `[[…]]` 仍是字面量方括号，要切走再切回才生效 | `packages/client/ui-yantao/src/client/frame/Frame.tsx`；阅读视图工具条另有「在 Obsidian 中打开」按钮 |
| **Electron 桌面外壳（ADR-0016）** — `apps/yantao-desktop`：宿主作为**子进程**跑在系统 Node 上（`spawn` + `--expose-internals` + 从 stdout 抓 URL + `--port 0`），窗口先弹「正在启动」再加载，`file://` 不用（过不了 Origin 围栏），托盘「打开/重启宿主/退出」，不做热键/自启/签名/打包 | 验证：窗口 3.2 s 出现、`yantao: workbench ready` 于 26 s、宿主 stderr 干净（HMR 行加载成功）、**CLI 与桌面版同时可用**。原「同进程」方案已验证能跑但被废弃，原因见 ADR-0016：一个 `.node` 文件服务不了两个 Node（CLI 与桌面互斥）、重建件内网拿不到、同进程会丢 HMR。**子进程不提速**（CLI 22.6s / 同进程 22.2s / 子进程 26.1s），提速靠先弹窗口（22.2s → 3.2s） |

| **外壳收口** —— Electron 去掉默认菜单栏(`Menu.setApplicationMenu(null)`,DevTools 入口一并放弃);两条 rail 去掉「刷新」与「更改目录」;`setRoot` 与首启 `Onboarding` 保留作后门 | `apps/yantao-desktop/src/main.ts`、`packages/client/ui-yantao/src/client/Workbench.tsx` |
| **待办真正成为面板(ADR-0018)** —— 宿主侧唯一的解析器/序列化器处理 `[due::]`/`[done::]` 行(preamble 保留、往返无损);`yantaoKb.todos` / `writeTodos` 走乐观并发(`expectedText`);待办 tab 变成 TODO / DONE 双面板:按 due 升序、无 due 沉底、过期标红、DONE 灰显、内联展开编辑、底部「+」、逐条删除;「打开全文」仍然打开文件本身 | `packages/yantao/kb/src/todo.ts`、`packages/api/yantao-kb-controller/src/{index,types}.ts`、`packages/client/ui-yantao/src/client/TodoBoard.tsx`(取代 `TodoList.tsx`) |
| **邮件连接器:读取与断点(ADR-0019)** —— `read_outlook.py` 拷入 `src/mail/` 并扩展(`--since` 在 Python 侧按 datetime 过滤、JSON 输出、`sha1(时间\|发件人\|主题)` 作为 id、不输出抄送、正文截断 3000、`HTMLBody` 回落、错误分类退出码),由一层封装 spawn,把每种失败都翻成中文提示 + 处理建议;`mailFetch`(仅收件箱、单页 50 封、缺省下界 30 天,带 `stale` / `hasMore`)与 `mailMarkRead` 推进 `connectors.mail.lastReadAt` 断点;未选知识库目录时两者都拒绝 | `packages/api/yantao-kb-controller/src/mail/{fetch.ts,read_outlook.py}`、`packages/api/yantao-kb-controller/src/{index,types}.ts`、`packages/yantao/kb/src/root-store.ts` |

| **邮件分析打通(ADR-0019)** —— 连接 tab 经 `mailFetch` 读取 Outlook,把整批邮件交给一个真实的 dsh session(`session.create` → `rename`「邮件分析 YYYY-MM-DD」→ `prompt` → `follow`),最后落到一个汇总窗口:四块(新人 / 建议待办 / 项目动态 / 值得留存的资源),**默认一条都不勾选**——确认后新人变成实体、待办带着 `expectedText` 并入单例、项目动态追加到该实体的流水、被挑中的邮件落成 resource 笔记;断点只在这一轮判断被处理完之后才往前走 | `packages/client/ui-yantao/src/client/{MailPanel,MailReview,mail-analysis,mail-apply}.tsx`、`packages/client/ui-yantao/src/client/{Workbench.tsx,frame/Frame.tsx,index.ts,remote.ts}` |

| **读书项目与资源入库(ADR-0020)** —— 拖拽到资源栏经 `yantaoKb.registerResource`(`{ name, contentBase64 }`:纯复制、重名即拒、逐文件中文报错);资源行右键或只读横幅 → 应用级弹窗(书名 + 「是否需要我读取书籍内容为你整理大纲?」)→ 带 `source:` frontmatter 的普通 `project` 实体;惰性 py 抽取(txt/md/pdf/epub/doc/docx/ppt/pptx)缓存于 `.yantao/extracts/`,失败明确分类报错(`yantao-kb/extract`,v1 不做 OCR);第八个工具 `kb_read_resource` 按偏移/分块返回抽取文本;读书流程跑真实 session(大纲写状态区、过程记流水),以 MailReview 式提议卡收尾,确认 `[[领域:…]]` 关联或新建领域 | `packages/yantao/kb/src/{core,index,templates}.ts`、`packages/api/yantao-kb-controller/src/{index,types}.ts` + `src/extract/`、`packages/client/ui-yantao/src/client/{ReadingDialog,ReadingProposal,reading-flow}.tsx` + `{Workbench,remote,frame/Frame,editor/ReadOnlyFile}`、`docs/adr/0020-*`。验证:kb + controller + ui-yantao 三包测试全绿(controller 92、ui-yantao 182),`build:lib` 与 client bundle 通过 |

| **能力执行缝(ADR-0021 第 1 条)** —— 第十九个 `yantaoKb` RPC `capabilityRun`:控制器经 dsh skill 注册表解析能力(`ctx.skills.get`),`resolveEntry` 读 `metadata.yantao` 声明(entry 限制在 skill 目录内、runtime、`appliesTo` 后缀),`runCapability` 拉起子进程(JSON stdin/stdout、UTF-8 管道、超时、失败分类带中文提示,走 `yantao-kb/capability` RemoteError 类别);产物落 `.yantao/capabilities/<name>/`,状态槽泛化为 `capabilities.<name>.state` —— 邮件断点迁入,遗留 `connectors.mail` 仍可读并在写入时迁移。不加 `kb_*` 工具:能力只由人调用,执行发生在会话前 | `packages/api/yantao-kb-controller/src/capability/run.ts` + `src/{index,types}.ts`、`packages/yantao/kb/src/root-store.ts`、`packages/bundle/yantao-web-app/cordis.patch.yml`(`skill-filesystem` 保持启用,`tool-skill` 保持禁用)。验证:三包 428 测试全绿(`capability-rpc.spec.ts` 10 个),`build:lib` host+client 通过(tsdown 需 `NODE_OPTIONS=--max-old-space-size=4096`,默认堆 ~2.4GB 在无页面文件机器上 OOM),`verify-cordis-catalog` 与 `verify-translation-pairing` 通过 |

## next

### 阶段 2 —— 三栏 UI(ADR-0010)

1. **了结 `ui-yantao-kb` 的去向** —— 它已移出 roster:要么把 `KbEditor` 的 markdown 编辑能力移植进栏内(见下),然后删除该包;
    要么保留为可组合包。不要留下一个已挂载却不再使用的包。
2. **逐行让共享 shell 退场** —— 每次只禁用一个 `ui-*` 行,重启,确认页面正常,再继续。`slots` 是运行时基础设施,不是 UI,
    必须留到无人需要为止。`ui-layout` 已退场(ADR-0011);剩下的大头是 `ui-conversation` 与 `ui-chat`。只有 shell 退场后,中间一列才归我们并承载 agent 交互。
3. **给工作台自己的词典** —— `Workbench.tsx` 里的文案是硬编码中文;等面板文案多起来就注册一个 locale 命名空间。
4. **阅读视图 v4 —— Mermaid 与本地图片** —— 两者都要付代价:客户端包是单文件 CJS,mermaid 会被内联成 ~3.5MB(或要改宿主模块表);
   本地图片需要新 RPC + 宿主路由,因为 `read()` 是 utf8,二进制会被解坏。等知识库里真出现一个再开工。
5. **启动耗时分段测量** — 冷启动约 22–26 秒,但未拆过段。已知不等于结论的两点：慢的是 dsh 的
   profile boot（与同进程/子进程无关：CLI 22.6s、同进程 22.2s、子进程 26.1s）。
   下一步：在宿主启动时打时间戳，分清 **tsx 现转译** 与 **cordis 逐行挂载插件** 各占多少；
   转译占大头就预编译宿主为 JS，挂载占大头就瘦身 profile（见 deferred 那条「~35s boot」）。
   **先量再动。**

### 能力系统(ADR-0021)

1. **提议卡泛化** —— 统一提议 schema(新建实体 / 追加流水 / 写状态 / 存资源 / 建关联 五类动作,
    各带理由),MailReview 泛化为通用提议卡;读书收尾提议并入。
2. **mail / ebook 能力迁移** —— 两个能力目录(SKILL.md + scripts/ + `yantao:` frontmatter),读书项目
    创建流程改写为 ebook 能力的应用实例;两者落地后 `mailFetch` / `extractResource` 退役。
3. **能力 tab** —— 连接 tab 改清单 + 详情两态;「添加目录」按钮(写 `customSkillDirs`)与「新建能力」
    脚手架;`skill-filesystem` 挂载(`tool-skill` 保持禁用)。
4. **应用入口** —— 资源右键(按扩展名)与实体面板(按类型)按 `appliesTo` 过滤;拖入不弹询问。

## blocked(附原因)

_无。(曾在此的三项 —— 客户端 face 重建、`tsgolint`、`toThrowError` 改名 —— 已于 2026-09-09 全部解除：OOM 前提不再成立，
内存回到 65%，`pnpm run build:lib` 与 `pnpm run lint` 均通过。)_

## deferred(附原因)

| 项 | 为什么搁置 |
|---|---|
| 提炼闭环 v1(人触发 → agent 提议 → 人批准) | 真正的价值所在;需要先有编辑器面板与提议 UI |
| 会话转写落 `sessions/` | dsh 已经把每个会话事件溯源(`session.vN.jsonl`),这活儿应变成"投影"而非新机制 —— **且:会话功能已移除(ADR-0010),待重新设计后再启** |
| FTS 与 backlinks 索引 | 等知识库有真实内容后再定存储(drift/sqlite 还是 dsh `session-query`) |
| *(已移入 next)* Connector 实现 → 能力系统(ADR-0021) | 连接概念已被能力取代;邮件已实现,剩余工作排在 next 的「能力系统」小节 |
| *(已移入 done)* —— 注意:单包 `tsc -b` 会**重新生成**这些残留 | 用仓库自带的 `pnpm run clean` 再清,或先 `git clean -n -- packages` 预览、再 `git clean -f -- packages` |
| 把中间一列也收归我们(ADR-0011 里的 L3) | 会话面在上游约 23k 行(ui-conversation + ui-chat + ui-tool);中间还是对话流水时没有产品理由重写。若中列变成 KB 文档视图再议。 |
| 精简 profile(减少 base 行)以缩短约 35 秒启动 | 先测量;等 UI 完全归我们再做 |

## 这份清单的规矩

- 每个搁置项都必须带**原因**——没有原因的项不叫搁置,叫丢失。
- 完成一项 = 移入 **done** 并附上测试/验证记录,而不是删掉。
- 任何改变架构的新想法先写 [docs/adr/](../adr/),再落到这里成为工作项。
