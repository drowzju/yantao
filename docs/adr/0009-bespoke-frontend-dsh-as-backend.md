---
status: accepted
---

# 工作台前端自研，dsh 退居后端（引擎 + 远程 API)

决定：放弃 dsh 自带的客户端插件与槽位 UI(`ui-layout` / `ui-conversation` / `ui-chat`,以及我们已建的 `ui-yantao-kb` 客户端插件),工作台前端改为**完全自研**的应用；dsh 只作后端——提供 agent loop、`kb_*` 工具、session 事件日志与远程 API(RPC),前端经 API 与事件流驱动。

原因：槽位模型把三栏形态、交互流程与「编码 agent」的组件语义绑在一起——一个槽只能有一个声明者，导致编辑器只能挤进 details 区（见 ADR-0008),无法贴合个人工作台的设计要求。与其在别人的 UI 框架里改造，不如把 UI 变成自己的应用，只复用 dsh 的引擎能力；这仍符合「学习 dsh」的动机，只是重心从客户端插件转向引擎与远程 API。

后果：

- 三栏布局回归 yantao 原本的设计（导航 | 内容 | agent 右),不再受槽位约束
- `packages/client/ui-yantao-kb` 与 yantao-web-app 的客户端 roster 需重定位：KB 树/编辑器逻辑可移植到新前端；后端侧的 `yantao-kb` 工具插件与 `yantaoKb` RPC 控制器保留不动
- 信任边界由工具层保证（ADR-0004),与前端无关——换 UI 不削弱边界
- 本决定取代 ADR-0008（其"复用 dist + 槽位组合"的结论不再适用)。技术栈、伺服方式、API 与事件传输细节由后续调研确定
