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

## next

1. **初始化真实知识库** —— 确认根目录(默认 `%USERPROFILE%/yantao-kb`),跑一次 `kb_init`,让树里出现「我自己」与 README。
2. **三栏骨架** —— 左:resources + sessions;中:agent(默认 tab)与编辑器 tab;右:people / project / area。数据全部走
   `yantaoKb.tree/read/write`。
3. **逐行让共享 shell 退场** —— 每次只禁用一个 `ui-*` 行,重启,确认页面正常,再继续。`slots` 是运行时基础设施,不是 UI,必须留到无人需要为止。
4. **补齐两篇生成目录的中文侧。** `docs/config-catalog.md` 与 `docs/capability-seams.md` 已重新生成(加入了我们的 kb 插件与
   web-app 条目),但对应的 `.zh.md` 没有跟上,于是两对都是红的:config-catalog 缺 2 个新章节 + 2 个目录条目 + 3 个列表项;
   capability-seams 缺 2 行表格、一处 mermaid 差异和 1 个链接。先把中文侧补到一致,再
   `pnpm run verify-translation-pairing --write <文件>` 重新记录。在此之前,这两个配对记录刻意保持不动。

## deferred(附原因)

| 项 | 为什么搁置 |
|---|---|
| Resource 入库 watcher(放入文件 → 自动生成影子笔记) | 需要一个监听任务;先决定用 dsh 的 `jobs`/schedule 还是普通 watcher |
| 提炼闭环 v1(人触发 → agent 提议 → 人批准) | 真正的价值所在;需要先有编辑器面板与提议 UI |
| 会话转写落 `sessions/` | dsh 已经把每个会话事件溯源(`session.vN.jsonl`),这活儿应变成"投影"而非新机制 |
| FTS 与 backlinks 索引 | 等知识库有真实内容后再定存储(drift/sqlite 还是 dsh `session-query`) |
| *(已移入 done)* —— 注意:单包 `tsc -b` 会**重新生成**这些残留 | 用仓库自带的 `pnpm run clean` 再清,或先 `git clean -n -- packages` 预览、再 `git clean -f -- packages` |
| 精简 profile(减少 base 行)以缩短约 35 秒启动 | 先测量;等 UI 完全归我们再做 |
| `docs/config-catalog.md` 已重新生成但中文侧未同步 | 生成页;在中文侧重新生成或加入豁免前,该对的配对检查是红的。未随本次文档工作提交。 |

## 这份清单的规矩

- 每个搁置项都必须带**原因**——没有原因的项不叫搁置,叫丢失。
- 完成一项 = 移入 **done** 并附上测试/验证记录,而不是删掉。
- 任何改变架构的新想法先写 [docs/adr/](../adr/),再落到这里成为工作项。
