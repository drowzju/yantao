---
status: accepted
---

# 编辑器策略：先借 Obsidian，自己那一套以后再说

决定：

1. **不自建所见即所得编辑器**（至少现在不）。KB 就是磁盘上的纯 Markdown（ADR-0005），
   **让 Obsidian 直接把这个目录当 vault 打开**，yantao 保留它真正独特的东西：
   agent、`kb_*` 工具集、`状态`/`流水` 边界、PARA+P 结构与双链。
2. **桥接只有两件事**：
   - 「在 Obsidian 中打开」——从 yantao 跳到当前文件（`obsidian://open?path=…`，绝对路径，
     要求 KB root 已被 Obsidian 注册为 vault）。
   - **外部改动自动刷新**——宿主用 chokidar 监听 KB root，debounce 后 bump 一个 `revision`
     计数器；UI 在窗口 focus 与低频轮询上比对它，变化就刷新两棵树与当前文件的链接图。
3. **KB root 成为一个 Obsidian vault 是人的一次性动作**：由用户在 Obsidian 里
   "Open folder as vault" 完成。**yantao 不写 `.obsidian/`**——`kb_init` 不创建它，
   任何时候都不创建。
4. **变更通知用轮询 `revision`，不用 Typert 事件推流**。推流需要把 `yantao-kb/changed`
   加进上游白名单 `packages/api/remotes/src/remote-events.ts`，那个文件不在 merge surface 里。
5. **自研编辑器（CM6 之类）是长期项，等撞墙再说**。墙必须由真实使用来定义，
   不能由"想要 Obsidian 体验"这个愿望来定义。

原因：

- **为什么借用而不是自研**：目标如果是"完整的 Obsidian 体验"（所见即所得、双链、图谱、
  全文检索、图片、插件生态），借用的成本是一个 RPC 加一个 watcher，自研的成本是一个
  编辑器内核集成 + 增量链接索引 + 资产路由 + 冲突处理的前端工程。这两笔账差两个数量级。
- **为什么 Obsidian 能做到而我们要很久**：它是 Chromium 渲染 + Node 主进程（和我们同构），
  它的 Live Preview 就是 CodeMirror 6——**能力来自编辑器内核，不来自"它是桌面应用"**。
  所以"变成桌面应用"换不来这套能力，这一点在 ADR-0016 里已经论证过。
- **为什么禁止写 `.obsidian/`**：ADR-0005 承诺 KB 是纯 Markdown 的目录。往里塞工具私有目录
  就是把这份承诺改成"纯 Markdown + 一个 Obsidian 配置目录"。让 vault 注册成为人的动作，
  成本只是一次点击。
- **为什么轮询而不是推流**：README 写着"merge surface 就是我们的升级成本"，
  而上游每周发破坏性变更（ADR-0002）。`remote-events.ts` 里多一行，就是每次 rebase
  都要重新对齐的一行。个人 KB 上轮询一个计数器开销可以忽略。**等真的需要亚秒级联动再付这笔账。**
- **为什么用 chokidar 而不是 dsh 的 jobs/schedule**：TODO 里那条"二选一"现在有答案——
  `packages/jobs/jobs` 是 session 级、一次性、settle-once 的任务注册表，
  `packages/schedule` 是 cron 类，都不适合常驻 watcher。而 chokidar 已是仓库依赖，
  `packages/skill/skill-filesystem` 的 `ctx.effect()` + teardown 就是现成的长驻范式。
- **为什么还要修"链接图不随内容变化重算"**：这是同一个洞的两半——
  轮询 `revision` 只覆盖**外部**改动；在 yantao 里敲 `[[…]]` 不会改 revision，
  所以 `linkGraph` 的 effect 还必须把正文纳入依赖（带防抖，因为 `linksOf` 会重读全库算
  `incoming`）。两半都做了，"打完字就能看到链接生效"才成立。

后果：

- `yantaoKb` Remote 多两个方法：`openExternal(path)` 与 `revision()`。
  **改 Remote 契约意味着必须跑 `pnpm run build:lib`（host → client 顺序）**，
  否则浏览器拿到旧方法表——这正是 ADR-0015 曾经"在服务端存在、在浏览器不存在"的原因。
- watcher 必须随 `setRoot` 重建：KB root 是可变的，watcher 不能只在激活时建一次。
- watcher 是常驻的：它随插件生命周期存在，关在 `ctx.effect()` 里，dispose 时关闭。
- 首次接 Obsidian 需要用户自己注册 vault，yantao 不引导也不检测——
  若未注册，`obsidian://open?path=…` 的行为由 Obsidian 决定（可能打开仓库选择器）。
  这是已知的可接受行为，等实际使用时再决定是否加提示。
- 未做：粘贴/拖拽图片直接入库（TODO 里那条前提仍是"等 KB 里真出现一张图"）、
  Mermaid 渲染、自研编辑器、重命名实体时改写 `[[…]]` 引用。
