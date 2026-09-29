# Map：实体校验 v2（validate 回归纯体检）

## Notes

- 起点：对 ADR-0035 L1 管线不满（提议卡批准率低、单 prompt 四职责），参考 `D:\code\llm_wiki` 的 lint 实现做了一轮 grilling 对齐（2026-09-29）。
- 对照分析全文：[analysis.md](analysis.md)。
- **2026-09-29 施工拆票**：[spec.md](spec.md) 总纲 + [issues/01–05](issues/) 五张票（01 协议地基 → 02 核验/03 失链修复/04 双区块卡并行 → 05 收尾），全部 `ready-for-agent`。
- **2026-09-29 票 01 resolved**：协议瘦身与诊断 prompt 重写落地，ui-yantao 389 用例全绿。环境注意：本机 Node 26 触发 kb/controller 包 vitest 基础设施故障（与本票无关，已基线验证）；依赖安装需绕公司镜像（见票 01 Answer）。
- **2026-09-29 票 02 resolved**：防御核验层落地——`validate-verify.ts` 纯函数 + `runValidate` 接入（新增 `filtered` 统计）+ 六组直测，ui-yantao 396 用例全绿。重大环境发现：此前一天内 vitest「全线瘫痪」的真凶是 **Windows 盘符大小写分裂**（小写 `d:` 启动 → worker 内 vitest 模块分裂成两个身份，`describe` 绑到未初始化副本）；与大写的 `D:` 启动即愈，与 Node 版本/缓存/代码均无关——之前归咎 Node 26 的判断有误。见票 02 Answer。
- **2026-09-29 票 03 resolved**：失链修复候选落地——`broken-link-suggest.ts`（相似度 0.74 阈/CJK 半价/至多 3 候选 + 幂等改写）+ `brokenLinkFixesOf`/`verdictToValidateProposal` 接入（edit-section 动作行，流水与小节外降级展示行）+ 24 例直测含端到端落盘，ui-yantao 420 用例全绿。两项用户拍板：流水失链降级纯展示；类型定位符整体替换为裸候选名。实现坑：wikilink 正则须以 `\]\]` 收尾，单 `\]` 会残留半个括号且 `toContain` 察觉不到。见票 03 Answer。
- **2026-09-29 票 04 resolved**：提议卡双区块落地——`Proposal.prescan?` 子对象（orphans/findings/actions 三数组，类型系统上与模型块互斥，提炼/邮件卡零影响）+ 修复动作前置 + applier 与卡片各自按 `[...prescan.actions, ...proposal.actions]` 拼接序解析勾选索引（Frame/applyProposal 签名零改动）+ 卡片确定性区块用平静样式、全空整块隐藏；死词条 `proposal.findings` 删除。ui-yantao 428 用例全绿（净增 8）。见票 04 Answer。
- **2026-09-29 票 05 resolved，五票收官**：跨包回归 41 文件/801 例全绿；完成通报改口径「实体 · 预扫 · 模型 · 滤除 · token · 耗时」（`ValidateStats` 增 `prescan` 计数）；TODO/CONTEXT/ADR-0036 落地注记三处台账齐；bundle 重建成功。两条环境教训：**改 tsx 后须补 `tsc -b packages/client/ui-yantao`**（vitest 不查类型，漏过一个 keyPrefix 误用）；本机全量 `yantao:refresh` 被上游包测试文件的陈年类型错误绊住，恢复路径是 `build:lib:host` → 窄构建 → 插件 bundle。手动冒烟（预扫→诊断→卡→批准补链一条龙）留待人验收。见票 05 Answer。
  - 同日提交台账：票 01–03 已随三笔提交入库（`16a35596` ADR+台账、`43bd2716` agent skills、`a7c6bbc2` 三票代码），票 04 随 `4794c7f9` 入库。
- **2026-09-29 review 修正（票 04 缺陷）**：外部 review 抓出 `verdictToValidateProposal` 把修复动作同时放进 `prescan.actions` 与 `proposal.actions` 前部——卡片/applier 都按两数组不相交的拼接契约处理，真实运行时每条修复行渲染两次、勾满双重写入（正是待做的冒烟路径）。生产端修正：修复行只居 `prescan.actions`，执行序前位由 applier 拼接给出；两处钉死重复的断言改写为「actions 不含修复行 + 拼接序首位是它」。tsc + 428 例绿，bundle 重建。教训：拼接契约的三处消费方（prescan 文档/卡片/applier）都对了，唯独生产方违了约——**两端各自独立测试合不出来时，要有一条贯穿生产者的断言**。
- **2026-09-29 review 二轮（针对 `4794c7f9`，4 条）**：#1 双写与前一轮同一问题，已修；#2 拼接契约三处手写 → 收敛为 `proposal.ts` 的 `allProposalActions()` 规范助手（applier/卡片 `all()`/`nothing()`/模型行偏移全部从它推导），越界索引补注释说明「卡片两侧同源，陈旧勾选丢弃不猜」；#3 孤儿行硬编码「入链」绕过 locale 层 → 新词条 `proposal.orphanIncoming`（入链 {count} / {count} incoming links）；#4 `Proposal.actions` 文档钉死与 `prescan.actions` 的不相交不变式。tsc + 428 例绿，bundle 重建。

## Decisions-so-far

- **2026-09-29 设计共识定格为 ADR-0036**（`docs/adr/0036-entity-validation-v2-pure-diagnosis.md`）：validate 回归纯体检——预扫直出不过模型、creates 移除（建页归提炼手势）、诊断窄化为过期/矛盾/缺链机会三维度、代码侧防御核验、提议卡分确定性/模型两区块、失链修复候选由代码相似度匹配生成。协议保持 JSON verdict。L2 重构想另立 ADR。
- 本轮零代码改动；施工拆票待启动。

## Fog

- 诊断调用内部是否进一步按维度拆分（llm_wiki 式）——等 v2 落地的真实误报数据。
- L2（分批通读、解锁 edits/todos）在新管线前提下如何重构想——原 ADR-0035 决定 5 前提已动摇。
- 冗余/疑似重复检测的按对窄任务——暂缓，重复问题实测突出时再立项。
- 「一键带上下文转提炼」——跳转摩擦实测伤人时再议（0036 台账 #2）。
