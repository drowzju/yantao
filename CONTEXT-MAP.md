# Context Map

本 repo（main 分支）承载两个上下文。

## Contexts

- [dsh 平台](./docs/glossary.md) — DeepSeek Harness 底座：plugin / profile / bundle / session / agent loop 等词汇（上游文档）
- [yantao 工作台](./packages/yantao/CONTEXT.md) — PARA+P 个人知识工作台：知识库 / 影子笔记 / Entity / State / 流水 / 提炼 / Agent 后端

## Relationships

- **yantao → dsh**：yantao 以插件（packages/yantao/kb）与独立 app（apps/yantao）运行于 dsh 底座之上；agent loop 为 dsh 进程内，LLM 经内网 LLM 网关（OpenAI 兼容）提供
- 分支级架构决策记录于 [docs/adr/](./docs/adr/)
