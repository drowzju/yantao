# 02 防御核验层

Type: task
Status: resolved
Blocked by: 01

## 问题

模型言之凿凿地引用不存在的实体是常态而非偶发（llm_wiki issue `#537` 的教训，见 [analysis.md](../analysis.md) 第三节）。现行 prompt 只有恳求（「名单里没有的不要猜」，`validate.ts:230`），解析层不核验——编造的名字照样上卡。

## 要做什么

1. **核验纯函数**（新文件或并入 `validate.ts`，倾向独立小模块便于测试）：
   - 输入：`ValidateVerdict` + 花名册名字集合（规范化后）+ 预扫数据（失链 target 集合）。
   - 规则（ADR-0036 决定 5）：
     - `findings[].subject`：`missing` 类应对得上「花名册中没有此名」这一事实（它是缺席报告）；`stale`/`contradiction` 类 subject 应能解析到点名实体或其失链，解析不到即弃；
     - `targets[].entity` 必须在花名册中，否则整条 target 丢弃；
     - `links[].to` 必须在花名册中（creates 已不存在），否则该 link 行丢弃；
     - 模型复述的 `orphan`/`broken-link` findings 一律丢弃（预扫已直出）。
   - 名字规范化参照 llm_wiki 的 NFKC 折叠思路（`lint.ts:241-247`）：去空白、统一全半角，宽松匹配，宁可放过不可错杀已有实体。
2. **接入点**：`runValidate` 在 `parseValidateVerdict` 之后、`verdictToValidateProposal` 之前调用；被丢弃的行计入一个核验统计（丢弃条数），供 05 的完成汇总展示「已滤除 N 条无效发现」。
3. **立场**：宁缺毋滥，与 v2 解析器「空行丢弃」同一立场；不做「标记低可信」的中间态（ADR-0036 决定 5 定的是丢弃，保留简单）。

## 不要做什么

- 不改 prompt（01 已定稿）；不加 LLM 二次确认轮次。
- 不动预扫直出的行（它们不走核验——零幻觉的东西无需核验）。

## 验收

- 用例覆盖：编造实体名的 finding 被弃、花名册内全半角差异仍命中、复述 orphan 被弃、合法 findings/targets/links 原样通过、丢弃计数正确。
- 核验层不依赖网络/会话，纯函数可在 vitest 中直测。

## Answer

**2026-09-29 完成**。

- **核验纯函数**：新文件 `packages/client/ui-yantao/src/client/validate-verify.ts`，导出 `normalizeEntityName`（NFKC 折叠 + 去空白 + 小写）与 `verifyValidateVerdict`（返回幸存 verdict + 三类丢弃计数 `VerifyCounts`）。`ValidateVerdict` 类型从 `validate.ts` type-only 导入，避免运行时环。
- **规则落地**：`missing` 反转核验（subject 在花名册即弃）；`stale`/`contradiction` 须命中点名集合 ∪ 失链集合（`[[target|alias]]` 先剥壳取 target）；`targets[].entity` 不在花名册整条弃；`links[].to` 不在花名册仅弃该行；`orphan`/`broken-link` 复述一律弃。
- **接入点**：`runValidate` 的 `finish` 在 parse 之后、proposal 之前调用；`ValidateStats` 增加 `filtered` 字段（findings+targets+links 丢弃总数），questions 分支计 0——供 05 汇总「已滤除 N 条无效发现」。
- **测试**：`tests/validate-verify.client.spec.ts` 六组——原样通过、捏造名弃、括号别名解析（含「全角折叠不扩大点名集合」的负例：roster 有但未点名者仍弃）、missing 反转、target/link 级丢弃、复述 kind 弃。
- **一处测试修正**：初版用例期望「全角写法的 Full-Width 命中」——但它只在花名册、不在点名集合，按 ADR-0036 决定 5 本就应弃（模型没读过它的正文，宽度折叠不能替模型补课）。断言改为弃，理由写在用例注释里。

### 环境坑（重要）

期间 vitest 全线瘫痪（所有 ui-yantao 用例报 "failed to find the runner"/"Cannot read properties of undefined (reading 'config')"），与代码无关，根因是 **Windows 盘符大小写分裂**：

- vitest 4 的 worker 把 spec 里对 `vitest` 的裸导入按「canonical 大写 `D:`」外置（`file:///D:/...`），而 worker 自身 bootstrap 的模块 URL 跟随**启动路径的大小写**。若从 `d:\code\yantao`（小写）启动，同一份 `@vitest/runner` 被 Node 当成两个模块：初始化过的 `d:` 副本 + 外置导入命中的未初始化 `D:` 副本——`describe` 拿到的是后者，模块级 `runner` 变量为 undefined。
- 16:56 曾绿过一次，正是当时启动路径恰好是大写；之后全部走小写 cwd 才「莫名」变红。与 Node 24/26、三个 vitest 副本、缓存均无关（逐一排除验证过）。
- **规避**：从大写盘符路径启动即可——`cd "D:/code/yantao" && pnpm vitest run …`。Git Bash 工具默认 cwd 是小写 `d:`，需显式 `cd "D:/code/yantao"`。
- 上游可修的点：`getCachedVitestImport` 的 `id.includes(distDir)` 大小写敏感比较（vitest 4.1.8）。
