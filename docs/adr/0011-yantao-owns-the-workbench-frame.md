---
status: accepted
---

# 工作台自绘三栏外框：接管 root 槽位

决定：

1. **`ui-yantao` 注册内置 `root` 槽位，自绘外框。** 三栏是：左栏（intake：资源 / 待办 / 会议 / 连接）| 中栏（`conversation` 槽位）
   | 右栏（workspace：领域 / 人物 / 项目）。两条栏从"槽位条目"退回外框的普通 React 子组件。
2. **中栏继续由上游的会话面占据。** 我们的外框声明两个子槽位：`conversation`（single，session-maybe）和 `shell.overlay`
   （list，root）；中列渲染 `renderSlot('conversation')`。
3. **`yantao-web-app` roster 禁用 `ui-layout` 行。** 它的三列网格、拖拽手柄、断点与 concession 链不再参与本工作台。
4. **`ui-yantao` 接手 `ui-layout` 留下的两个横切职责**：提供 `ctx.layout`（`ILayout` 实现，把 `sidebar` 语义映射到 intake 栏、
   `details` 语义映射到 workspace 栏），以及主题 presenter（订阅 `theme/change` 写 DOM 字段）。
5. **列宽与折叠由我们自己的 store 拥有**，两条栏对称：都能拖、都能收成图标栏、都受同一个窄屏断点影响。

原因：

- `ui-layout` 的外框是"导航列 + 会话列 + 详情列"的非对称模型：左列常年存在，右列（`details`）是 session 级、按需打开的列，且被
  ui-chat 的 `DetailsPanel` 占用。我们要的是**两条常年存在的栏**，借它的几何必然导致左右不对称——左栏能拖能折叠，右栏只能浮在
  `shell.overlay` 上、靠自己的按钮收起（ADR-0010 之后的实际状态）。
- **声明即独占**：`root` 注册里的 `children` 表同时是渲染授权，重复声明会抛错（`ui-slots/src/index.ts:856-861`）。不禁用
  `ui-layout`，我们就无法声明 `conversation`。
- 仍然借用会话面（ui-conversation + ui-chat + ui-tool，约 23k 行）：重写它没有产品理由，ADR-0010 的"shell 逐行退场"本来就是渐进
  的——这次退的是**布局**这一行。
- `shell.overlay` 必须继续声明：ui-commands 的 popupSelect（`/model` 等弹层）注册在它上面，不声明会静默失效。
- 备选方案一（维持 L1，两条栏都走槽位）：几何规则始终不是我们的，右栏永远浮着。不采纳。
- 备选方案二（右栏注册进 `details`）：能拿到真列，但 `details` 是 session 作用域，空白会话时中列不渲染它，且切会话会被
  `AppFrame.tsx:111-118` 自动 `closeDetails()`；为了一条栏去跟会话生命周期打架，不划算。不采纳。
- 备选方案三（中栏也自己画，L3）：要重写会话日志装配、markdown 渲染、工具卡、输入框、命令菜单、审批、模型选择、设置等约 30k 行。
  除非中列的产品形态要变成 KB 文档视图而非对话流水，否则不采纳。

后果：

- `packages/bundle/yantao-web-app/cordis.patch.yml`：新增 `ui-layout` 的 `disabled: true` 行。
- `ui-yantao` 新增：外框组件、列宽 store、`layout` 服务、主题 presenter；`inject` 增加 `theme`。
- 两条栏不再是槽位注册：`IntakeRail` / `WorkspaceRail` 变回普通组件，`sidebar` 的 yantao 占用者与 `shell.overlay` 的 yantao 条目
  都撤销（`shell.overlay` 本身仍由我们声明，供 ui-commands 使用）。
- 客户端槽位目录需重新生成（`root` 占用者变为 yantao，`sidebar` 占用者减少）。
- `ctx.layout` 的三个方法目前只有 ui-chat 的 `openDetails` / `closeDetails` 引用，而 `openDetails` 在全仓库无调用点；我们的映射让
  它变成"展开 workspace 栏"，语义落到了实处。
- 中列宽度不再有上游的 concession 链（中列 ≥640 时压 `details`）。我们按自己的规则实现：中列保底，先压右栏、再压左栏，最后才让中
  列低于保底值。
- 主题：`ui-theme` 的 boot-theme 仍负责插件树激活前的首屏，之后由我们的 presenter 接管。
- 风险：`root` 是 single 槽位，我们的注册是唯一外框。上游升级若引入新的 root 占用者或让 `ui-layout` 变成必需依赖，需要重新评估本
  ADR（判据：我们是否仍需"两条常年存在的栏"）。
- 不受影响：KB Remote 契约、`intakeTree()` / `workspaceTree()`、`kb_*` 工具、详情栏（TODO 中的 read / write 编辑面板）。
