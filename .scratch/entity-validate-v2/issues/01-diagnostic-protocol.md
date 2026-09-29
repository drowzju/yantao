# 01 协议瘦身与诊断 prompt 重写

Type: task
Status: resolved

## 问题

现行 `ValidateVerdict`（`packages/client/ui-yantao/src/client/validate.ts:55-62`）有五个槽位，`validatePrompt`（:185-237）让模型在一次调用里同时找问题、建页（creates）、建链、提 todo——ADR-0036 决定 1/3 判定为批准率低的根因。

## 要做什么

全部在 `packages/client/ui-yantao/src/client/validate.ts`：

1. **协议瘦身**：`ValidateVerdict` 移除 `creates`/`todos` 字段及配套类型（`ValidateTodoVerdict` 等）；`parseValidateVerdict`（:248-283）相应简化（不再解析 todos，透传 creates 的分支删除）；`verdictToValidateProposal`（:300-318）去掉 creates 通路。`RefineCreateVerdict` 等提炼侧类型不动（提炼手势还在用）。
2. **诊断 prompt 重写**（`validatePrompt`，:185-237）：
   - 保留：视角限定的开头、预扫两清单、花名册、点名实体全文（8k 截断）、JSON-only 结尾。
   - 新增**勿复述声明**：明告模型「预扫出的问题系统已直接呈现给用户，不要在 findings 里复述 orphan/broken-link 类发现；你只做清单之上的语义判断（例如两个孤儿其实是同一实体、失链原本想指向花名册里的谁）」。
   - **维度窄化为三**，规则逐条硬编码（判据写具体，风格参照 llm_wiki `lint.ts:277-280`）：
     - `stale`（过期）：点名实体 `## 状态` 等小节声称的事与其正文其它部分/近期内容冲突；
     - `contradiction`（矛盾）：实体内或点名实体之间互相打架的陈述；
     - `missing`（缺实体）：多处指向一个尚不存在的主语，值得去提炼手势建实体（只提示，不产建页提案）。
   - findings 的 `kind` 白名单收缩为 `stale/contradiction/missing`（`orphan`/`broken-link` 归预扫，模型报了也会被核验层丢弃——见 02）。
   - targets 条目只允许 `links[]`（`edits` 字段从协议示例中删掉）；`questions` 两段式语义不变。
3. **REASK 更新**（:286）：字段清单同步为新协议。
4. **runValidate 接线**（:343-463）：`jsonRound`/`continueWithAnswers` 逻辑不变，`finish` 里的 stats 口径核对（findings 计数只算模型 findings，预扫计数另有来源）。

## 不要做什么

- 不动 `refine.ts`/`proposal.ts` 的 v2 机制（02/03/04 各自接入）。
- 不动预扫计算（`preScanOf`）与 `yantaoKb.graph()` RPC。
- 不动 Frame 入口与统计通知文案（05 收尾统一核对）。

## 验收

- `ValidateVerdict` 类型无 `creates`/`todos`；全仓 grep 无残留引用编译通过。
- prompt 原文含勿复述声明与三维度判据；JSON 示例里无 creates/todos/edits。
- `pnpm vitest run packages/client/ui-yantao` 绿；为 `parseValidateVerdict` 补用例：creates/todos 键出现时静默忽略、未知 kind 丢弃、questions 保留。

## Answer

**2026-09-29 完成**。`packages/client/ui-yantao/src/client/validate.ts`：

- `ValidateVerdict` 移除 `creates`/`todos`（`ValidateTodoVerdict` 删除）；`FINDING_KINDS` 收缩为 `stale/contradiction/missing`（模型复述 orphan/broken-link 即被解析层丢弃）。
- `validatePrompt` 重写：预扫清单降为上下文并附「不需要在回答里复述」声明；三维度判据逐条硬编码（过期/矛盾/缺实体，缺实体明示「建页由提炼手势完成」）；JSON 示例与规则同步（无 creates/todos/edits，links 只指向花名册原文）；REASK 字段清单更新。
- `parseValidateVerdict`：不解析 todos，creates/todos 键静默忽略；`verdictToValidateProposal` 钉 `creates: []` 并继续剥离 targets 的 edits。
- `runValidate` 文档注记更新为 ADR-0035/0036；stats 口径不变（findings 只计模型发现）。

测试：`tests/validate.client.spec.ts` 重写为 v2 协议（12 用例：协议钉死断言、未知 kind/复述丢弃、creates/todos 键忽略、converter 不产 create-entity）。`pnpm vitest run packages/client/ui-yantao` **20 文件 389 用例全绿**。

环境备注：本机 Node 26.5.0（仓库要求 Node 24），`packages/yantao/kb`、`packages/api/yantao-kb-controller` 的 vitest 因基础设施错误（"failed to find the runner"）无法运行——已用 `git stash` 做基线验证：不带本票改动同样失败，属环境问题非本票引入。依赖安装踩坑：公司 npm 镜像在沙箱不可达，需 `pnpm install --registry=https://registry.npmmirror.com` + `ELECTRON_GET_USE_PROXY=1 GLOBAL_AGENT_HTTPS_PROXY=…`（electron 二进制）+ `npm_config_disturl`（fs-ext 原生编译）。
