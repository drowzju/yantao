# Issue tracker：本地 Markdown

本仓库的 issue 与 spec 以 markdown 文件形式存放在 `.scratch/` 下（本 fork 无托管 issue 跟踪器，origin 为本地同步 bundle）。

## 约定

- 每个 feature 一个目录：`.scratch/<feature-slug>/`
- spec 为 `.scratch/<feature-slug>/spec.md`
- 实现 issue 一票一文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 起编号，绝不合并成单个 tickets 文件
- triage 状态记录在每个 issue 文件顶部的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 评论与会话历史追加到文件底部的 `## Comments` 标题下

## 当技能说「发布到 issue tracker」

在 `.scratch/<feature-slug>/` 下新建文件（必要时先建目录）。

## 当技能说「取相关工单」

读取对应路径的文件。用户通常会直接给出路径或 issue 编号。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一个文件，每个工单一个 **child** 文件。

- **Map**：`.scratch/<effort>/map.md`（正文为 Notes / Decisions-so-far / Fog）。
- **Child 工单**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 起编号，正文写问题。`Type:` 行记录工单类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记录 `claimed`/`resolved`。
- **Blocking**：顶部附近一行 `Blocked by: NN, NN`。当其列出的所有文件均为 `resolved` 时该工单解除阻塞。
- **Frontier**：扫描 `.scratch/<effort>/issues/` 中开放、未阻塞且未被认领的文件；编号最小者优先。
- **Claim**：开工前先置 `Status: claimed` 并保存。
- **Resolve**：在 `## Answer` 标题下追加答案，置 `Status: resolved`，然后向 `map.md` 的 Decisions-so-far 追加一条上下文指针（要点 + 链接）。
