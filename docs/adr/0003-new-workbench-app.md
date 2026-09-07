# 工作台 UI 另起新 app，不原地改 apps/web

apps/web 是「编码 agent UI」（diff、终端、工具卡片），改成知识工作台要背着它的组件遗产拆墙。决定：新建独立 app `apps/yantao`，复用 `packages/client`、`packages/api`(BFF + Typert RPC)、`packages/host` 底座，三栏页面（导航/内容/agent 面板）从零按工作台设计；apps/web 保持原样，作为参考实现。回退条款：若调研发现 client/api 耦合过死、复用成本高于收益，则退回对 apps/web 做最小 fork，并修订本 ADR。

补充（2026-09-05）：复用度调研完成——不触发回退；「独立 app」的形态细化为 bundle + client 插件组合、复用 apps/web 的 dist，见 ADR-0008。
