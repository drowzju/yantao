# yantao 待办

[English](TODO.md) | 中文

活的清单。状态词:**done**(已合入 `main`)、**next**(已排队)、**deferred**(有意搁置,附原因)。

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

## next

### 阶段 1 —— 三栏 UI(ADR-0010)

1. **了结 `ui-yantao-kb` 的去向** —— 它已移出 roster:要么把 `KbEditor` 的 markdown 编辑能力移植进栏内(见下),然后删除该包;
    要么保留为可组合包。不要留下一个已挂载却不再使用的包。
2. **逐行让共享 shell 退场** —— 每次只禁用一个 `ui-*` 行,重启,确认页面正常,再继续。`slots` 是运行时基础设施,不是 UI,
    必须留到无人需要为止。`ui-layout` 已退场(ADR-0011);剩下的大头是 `ui-conversation` 与 `ui-chat`。只有 shell 退场后,中间一列才归我们并承载 agent 交互。
3. **给工作台自己的词典** —— `Workbench.tsx` 里的文案是硬编码中文;等面板文案多起来就注册一个 locale 命名空间。
4. **阅读视图 v4 —— Mermaid 与本地图片** —— 两者都要付代价:客户端包是单文件 CJS,mermaid 会被内联成 ~3.5MB(或要改宿主模块表);
   本地图片需要新 RPC + 宿主路由,因为 `read()` 是 utf8,二进制会被解坏。等知识库里真出现一个再开工。

## deferred(附原因)

| 项 | 为什么搁置 |
|---|---|
| Resource 入库 watcher(放入文件 → 自动生成影子笔记) | 需要一个监听任务;先决定用 dsh 的 `jobs`/schedule 还是普通 watcher |
| 提炼闭环 v1(人触发 → agent 提议 → 人批准) | 真正的价值所在;需要先有编辑器面板与提议 UI |
| 会话转写落 `sessions/` | dsh 已经把每个会话事件溯源(`session.vN.jsonl`),这活儿应变成"投影"而非新机制 —— **且:会话功能已移除(ADR-0010),待重新设计后再启** |
| FTS 与 backlinks 索引 | 等知识库有真实内容后再定存储(drift/sqlite 还是 dsh `session-query`) |
| Connector 实现(邮件、脚本、CLI) | ADR-0010 描述了抽象;具体实现推迟到需要邮件集成时 |
| *(已移入 done)* —— 注意:单包 `tsc -b` 会**重新生成**这些残留 | 用仓库自带的 `pnpm run clean` 再清,或先 `git clean -n -- packages` 预览、再 `git clean -f -- packages` |
| 把中间一列也收归我们(ADR-0011 里的 L3) | 会话面在上游约 23k 行(ui-conversation + ui-chat + ui-tool);中间还是对话流水时没有产品理由重写。若中列变成 KB 文档视图再议。 |
| 精简 profile(减少 base 行)以缩短约 35 秒启动 | 先测量;等 UI 完全归我们再做 |

## 这份清单的规矩

- 每个搁置项都必须带**原因**——没有原因的项不叫搁置,叫丢失。
- 完成一项 = 移入 **done** 并附上测试/验证记录,而不是删掉。
- 任何改变架构的新想法先写 [docs/adr/](../adr/),再落到这里成为工作项。
