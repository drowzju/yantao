---
status: accepted
---

# 品牌、工作目录与 @ 引用

决定：

1. **中栏的工作目录就是知识库根目录。** 借用宿主的会话面，但它的工作目录原本是"服务器进程 cwd"（仓库根），
   而 `kb_*` 工具认的是 `kbRoot`——两个目录不是同一个。现在插件启动时（以及首启/更改目录之后）
   走一次对齐：`yantaoKb.root()` 拿到根目录 → `workspaces.create({ path })`（幂等，已注册就复用）
   → `uiWorkspace.startSession(id)`，宿主据此建/开会话，会话 cwd 即知识库根目录。
2. **中栏品牌换成我们的。** hero 文案改 `PARAP`（`hero.headline`，中英两侧）；
   鲸鱼 logo 由 `ui-yantao` 占用 `conversation.hero.brand.mark` 槽位替换成自绘的 PARAP 字母标（currentColor，跟随主题）；
   `Preview` 徽章用我们自己的一条 CSS 规则隐藏（该徽章无条件渲染、没有开关、也没有槽位）。
3. **`@` 能选到知识库实体，且 agent 知道指的是哪个文件。** 客户端在 `ui-yantao` 里注册一个 `@` 源
   （`inputTriggers.registerSource`），候选来自两条栏已经在读的 `intakeTree()` / `workspaceTree()`，按 领域/人物/项目/会议/资源 分组；
   选中插入的 chip 只带 KB 相对路径，序列化成 `@entities/people/张三.md`。
   主机侧 `yantao-kb` 挂 `agent/pre-step`：扫最后一条用户消息里的 `@路径`，读出这些文件，
   拼成一条 `<kb-file path="…">` 上下文消息追加在这轮之前。

原因：

- 工作目录必须对齐：工作台"管的文件"就是 KB 里的文件。让会话落在仓库根，人看到的目录和 agent 写入的目录是两个地方，
  迟早出现"我改的是哪个副本"的问题。dsh 的 workspace 是它自己的概念（kv 表 + 会话 cwd），没有"默认 workspace"配置，
  只能在客户端建好再切过去；`create` 幂等，所以重复跑不会攒出一堆同路径 workspace。
- 品牌走槽位而不是改上游：`conversation.hero.brand.mark` 当前无人占用（`ui-brand-official` 只占 sidebar 两个槽），
  占用它不需要动上游任何文件。唯一例外是 `hero.headline` 那两行字符串——locale 命名空间是单一占用、
  重复注册会抛错且没有 override API，改文案只能改上游那两行（已改，同步更新了上游那条断言）。
- `@` 两条腿都要：只做客户端源，模型拿到的是一串裸路径（本 profile 禁用了所有 fs 工具，
  上游解释 `@` 的 `FILE_REFERENCE_PROMPT` 根本没安装）；只在客户端 serialize 时内联内容，
  又会把一次读失败挡在"发送"之前。路径进消息（人读得到、日志留得下）+ 主机侧 pre-step 展开内容（失败只丢这一条引用），
  两头都不脆。

后果：

- 会话日志目录随之改变：`sessionDir(root, cwd, id)` 按 cwd 派生，切换后新会话落在知识库根目录对应的目录里，旧会话留在原处。
  fs 类工具在本 profile 已禁用，所以对齐不会额外放开权限；`workspaces.create` 要求目录已存在，缺目录时报 `workspace/invalid-path`（只记 warn）。
- `ui-yantao` 多了三个 inject：`workspaces` / `inputTriggers` /（已有的）`uiWorkspace`，并新增两个依赖
  （`dsh-client-ui-conversation`、`dsh-client-ui-input-trigger`）——类型合并只进编译期，不打进运行时。
- `packages/yantao/kb` 新增 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-llm` 两个 devDependency（pre-step 与消息构造的类型）。
- mention 的解析是信任边界：`kbMentions` 只接受 `entities/` 与 `resources/` 前缀，拒绝 `..` 与盘符/绝对路径，
  主机侧读之前再校验一次解析结果仍在根目录内。
- 未做：`@` 菜单的模糊排序与拼音匹配、引用内容的缓存（每轮重读）、资源原件的内容展开（只按路径引用，原件可能不是文本）。
