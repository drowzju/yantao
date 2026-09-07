---
status: superseded
---

# 工作台 UI 形态：bundle + client 插件组合，复用 apps/web 的 dist

（已被 ADR-0009 取代：前端改为自研，dsh 退居后端。保留本文以记录为何先试这条路、又为何放弃。)

调研证实：apps/web 只是通用 Vite 壳（7 行入口），全部 UI 在 packages/client/ui-* 的 Cordis 插件中，运行时按 bundle 的 `dsh.client` 名单装载；`ui-layout` 自带 sidebar | conversation | details 三栏槽位。决定：不新建 Vite 工程、不 fork apps/web。工作台 = `yantao-web` profile + `dsh-yantao-web-app` bundle（定制 dsh.client 名单）+ `packages/client/ui-yantao-kb` 客户端插件（KB 树进 sidebar 槽、markdown 编辑/预览居中、ui-chat 保留在右侧 conversation.view)。编辑器 v1 用 textarea + ui-primitives/MarkdownText 预览，零新依赖。本 ADR 细化 ADR-0003 的"独立 app"为上述组合形态（不 fork 的判断维持）；fork 触发条件（需要不同的 `__DSH_BOOT__` 或非 Cordis UI)v1 不满足。
