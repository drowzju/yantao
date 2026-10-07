---
status: accepted
---
# 钉住上游版本,刻意升级

dsh 处于 developer preview,官方明示将有 breaking changes,上游约 4 周 4,680 次提交。决定:本地 main 分支钉在 master@d347e70390(0.1.3-alpha.1),不追 master;升级为刻意事件,逐版本评估后再合入。代价是错过上游修复与能力;换来的是自定义不被合并冲突拖垮。缓解:所有自定义只落在插件接缝与新增 app 内,不改核心源码。

## 落地注记

### 2026-10-07:0.1.3-alpha.1 → 0.2.1-alpha.1(master@d347e70390 → master@5badb15009)

首个钉版本周期(约 5 周)。升级在分支 `upgrade/0.2.1` 完成后并回 `main`。破坏性变更与我们适配的要点:

- **消息源模型**:0.2.1 以 producer kind 取代笼统的 `plugin` 消息源。我们的注入改为自有 source kind(`yantao-kb` 的 recall、`yantao-kb-controller` 的 catalog/notice);首轮 pre-step 守卫从「跳过 plugin 消息」改为「跳过 runtime-context 快照」。
- **kbRoot 端口迁移(ADR-0024 决定 3 的新落地形态)**:`kbRoot` 成为 `yantao-kb` 插件自身的 volatile 配置字段,settings UI 写进活跃 profile 的 patch,`loader/volatile-update` 实时生效。上游废弃 `~/.dsh/settings.yaml`(一次性改名 `.imported` 并迁入当时的活跃 profile)——**各 profile 各自为政**,桌面栈 `yantao-web` profile 与 headless `yantao` profile 的配置互不相通,升级后需手工迁移(实机踩过:配置过却走首启流程)。
- **patchReload 移除**:profile 模板不再声明 `patchReload`,patch 变更走 HMR/live 通道。
- **客户端装配链**:上游把 shortcuts 焊进 ui-workspace 的服务依赖(bundle 补一行);ui-chat/ui-reference 新依赖 `sidebarRight` 座位,其原提供者 ui-sidebar-right 依赖我们移除的 ui-layout,由 ui-yantao 自带最小适配器替代(openResource → 中栏文件 tab);ui-workspace/ui-conversation/ui-yantao 四方形成服务级循环依赖,ui-yantao 以动态 inject(引用座 + `whenUiWorkspace` 辅助)破环。教训:`dsh.client.inject`(package.json,包名预取清单)≠ 模块源码的服务级 `inject`,后者不能用 patch yml 覆盖。
- **输入面重构**:编辑器内核从 facade.ts 迁至 `input/editor/runtime.ts`(chip 退格展开随之移植);提交链引入 PartialArguments 参数模型,MemoryProposalCard 等改经 ToolArgs 视图读参;上游新增 ContextMeter,因页脚状态条(ADR-0039)摘除。
- **内容槽改名**:ui-conversation 的会话面从名为 `conversation` 的 single 槽改占 keyed 的 `main` 槽(`name:'main', key:'conversation'`),Frame 渲染随之切到 `renderSlot('main', {}, { entryKey: 'conversation' })`。漏改的症状极安静:中栏「对话」tab 只剩标签,内容区全空白(2026-10-07 实机踩过——冒烟只验了 tab 标签没验内容,教训已并入方法论条)。
- **layout 面重塑**:0.2.1 的 `ILayout` 换血——新增会话导航协议 `beginNavigation()`(ui-workspace 在每次建会话/恢复会话前后调用,信号用于作废过期导航)与全局面板选择(`panelInfo` + `selectPanel`),`openDetails`/`closeDetails` 溶解进 ui-sidebar-right 的 `openRightbar`/`closeRightbar` 上报(该插件不在我们栈)。WorkbenchLayout 替身若停留 0.1.3 面,建会话即抛 `ctx.layout.beginNavigation is not a function`,症状是会话永远建不起来、中栏停在「选择工作区」hero(2026-10-07 实机踩过)。现补齐:`beginNavigation` 照上游语义实现,`panelInfo` 恒为「会话选中」,`selectPanel` 对非 null id 照上游报「未注册」错。
- **agent 平面移到 preset 之后**:0.2.1 的会话 agent 从 preset 注册表(`agent-preset-registry`,`default: yantao`)按 id 取组合,preset 本体是独立的 `@deepseek-ai/dsh-agent-preset` 声明行。只声明注册表而不插 preset 本体,建会话即报 `agent-preset/not-found: Unknown agent preset: yantao`(2026-10-07 实机踩过,紧随 layout 修复之后露出)。现把 yantao preset(compaction 组,无工具行无人格行——边界不变)作为 `preset-yantao` 插入 yantao-web-app 补丁,并补 `@deepseek-ai/dsh-agent-preset` 依赖;旧 discovery 格式的 `agent.cordis.yml` 不再被装载,留存作 persona.spec 闸门的读侧与历史参照。
- **其它核对项**:孤儿条目清理语义变化、会话导航 UI 重做、ui-primitives markdown 的 diagrams 钩子与 fragment 锚点(ADR-0048 一期顺势落地)、xlsx 临时降级 0.18.5(cdn.sheetjs.com 不可达,见 pnpm-workspace.yaml 注释)。
- **方法论沉淀**:单元全绿挡不住装配级故障——pending 的服务环与陈旧的前端 shell(seed.ts 静态模块表)都要实机 CDP 探针才能暴露;客户端两步构建序(per-package client 库先 `build:lib:client`、前端 shell 后 build)是硬前提。
