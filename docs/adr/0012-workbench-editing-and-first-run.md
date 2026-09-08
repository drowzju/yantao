---
status: accepted
---

# 工作台能打开文件、能新建、能自选目录

决定：

1. **中栏是 tab 化的。** 一个常驻、不可关闭的「对话」tab 承载宿主的会话面（`conversation` 座位，切走时用 `display: none` 保活、从不卸载），
   其余是可关闭的文件 tab。同一个文件重复打开只激活已有 tab；打开的 tab 记在 localStorage，刷新后恢复，读不到的路径静默丢掉；切换会话不影响它们。
2. **文件编辑是原文编辑。** 纯 textarea，frontmatter 一起露出来，不做渲染切换、不做分区块表单。
   改动后 2 秒防抖自动保存，失焦立即保存。保存前先 `read` 一次与打开时的基线比对，不一致就停下来给「覆盖 / 放弃我的修改 / 查看差异」。
3. **左栏四个 tab**：资源 / 待办 / 会议 / 连接（连接仍是占位）。右栏三个 tab：领域 / 人物 / 项目。
4. **会议、领域、人物、项目都能 inline 新建**（「+ 新建」→ 输入框 → 回车），走新增的 `yantaoKb.createEntity()`，宿主复用
   `templates.entityFileContent`——模板只有一份，UI 不抄。建完刷新树并自动打开新文件。
5. **会议文件带日期前缀**：`entities/meetings/<YYYY-MM-DD> <会议名>.md`，frontmatter `title` 保持干净的会议名、`date` 为当天。
   补录往日的会交给 agent（`kb_create_entity` 支持 `date`），UI 只做今天。
6. **待办就是 `entities/todos.md`**（沿用既有单例）。左栏内联 checklist：勾选/加行只回写那一个文件；另给「打开全文」用编辑器打开。
7. **资源是只读的**，打开后没有编辑入口。
8. **首次进入可以指定目录**：`yantaoKb.root()` 报告是否已持久化过；没有（或目录不在）就出首启浮层，用 `ctx.uiWorkspace.pickDirectory()`
   选目录，`yantaoKb.setRoot()` 落盘到 `~/.dsh/yantao-kb.json`、立刻 `kb_init` 建骨架，并让宿主服务换根（agent 的 `kb_*` 工具跟着走）。
   两条栏头部都留了「更改目录」入口。

原因：

- 中栏选 tab 而不是"详情列"或"分屏"：知识工作台里"人改文件"和"agent 改文件"是同一条流水，你得能一边看着 agent 刚写的 `状态` 一边改它；
  分屏在 1440 宽的屏上两块都不够用，而卸载式切换会丢掉会话的滚动位置和输入草稿。
- 原文编辑而不是渲染切换/分区块：KB 文件本来就是给人用 Obsidian 打开的 markdown，任何结构化编辑都会把文件格式钉死在 UI 上——
  以后模板加字段，UI 就得跟着改。这一条和"新建走宿主模板"是同一个原则。
- 保存前比对：Remote 只有 `read` / `write`，没有版本号；而人开着文件的时候 agent 完全可能正在写同一实体的 `状态`。
  一次额外 `read` 换一个"不会丢东西"的保证，代价十几行，而丢的是最贵的那类——人和 agent 各写一半的内容。
- 新建走宿主而不是前端拼内容：模板在 `packages/yantao/kb/src/templates.ts` 且已被 `kb_create_entity` 使用，前端再抄一份必然漂移。
- 日期前缀：同一主题周周开（`周会` 重名），前缀天然去重，文件管理器里按时间排序也对。代价是 `type:name` 定位需要后缀回退——
  已在 `resolveEntityLocator` 里补上（精确命中 → ` <name>` 后缀命中 → 多个则 `ambiguous-entity`）。
- 待办沿用 `entities/todos.md` 而不是改成大写 `TODO.md`：KB 里所有实体文件都是小写 + 中文名，为一个文件开例外不值得。
- 首启目录落 profile 而不是设置页：今天 `kbRoot` 是宿主插件配置，schema 默认 `~/yantao-kb`，**界面上没有任何入口**（设置页那张卡片从未存在，
  `yantao-kb` 没调过 `settings.installSection`）。一个 `~/.dsh/yantao-kb.json` + 一个 Remote 方法就能让"换台机器重新选"成立，
  比给 upstream 的设置页补一套 section 便宜得多。

后果：

- `yantaoKb` Remote 多了三个方法：`root()` / `setRoot(path)` / `createEntity({ type, name, date? })`。
  **改 Remote 契约意味着客户端 face 必须整体重编**（`pnpm run build:lib`），否则浏览器拿到旧方法表——这就是上次 `intakeTree is not a function` 的成因。
- 会议命名变了，既有 kb 断言（约 3–5 条）随之更新；`kb_read_entity` 原先按裸名精确匹配，已改为走 locator，否则带日期的会议读不到。
- 首启浮层只在没有持久化根时出现：只靠配置默认值的机器第一次打开也会看到它（这是有意的——那正是"首次进入"）。
- 中栏现在由我们渲染：宿主的会话面仍在，但它是第一个 tab，不再独占整列。ADR-0011 的 L3（重写会话面）依然没做，也没必要做。
- 待办内联勾选引入了一处 markdown 解析与局部回写，是全清单里唯一"看着小、做起来不小"的东西，也是最容易出边界情况的一块（多行、缩进、嵌套）。
- 文档：`packages/client/ui-yantao` 的 README 对里"只列文件、打不开"那条限制已删除；`docs/yantao/TODO.md` 的"详情栏 read/write"一项随本次落地。
- 未做：文件 tab 的拖拽排序、多文件搜索、编辑器的 markdown 预览（有意不做，见原因第 2 条）。
