---
status: accepted
---

# 提议提名工具化：kb_propose_actions

出发点（2026-10-10 晨间邮件调度事故复盘采纳项，任务 #7）：散文信封时代的结构性弱点再次暴露——提议能否产生，
取决于模型是否记得在回答末尾附一段符合 schema 的 JSON。ADR-0047 验收当天就出现过命中率 0%（决定 7 的由来），
靠调度器强制附加约定段续命；本次事故中信封再度失约（惯性输出散文报告、信封畸形），且解析失败只能事后追问修复，
错误反馈隔了一整轮。裁决：提议提名从「散文末尾手写 JSON 信封」迁移到真正的工具调用 `kb_propose_actions`——
服务端校验、失败当轮修复；散文路径降级为回退。本篇立案并对 ADR-0047 决定 2 作出修订。

事实基础（已核实）：

- **「agent 填队列、人 drain」已有两次先例**：`kb_propose_memory`（ADR-0044）与
  `kb_propose_skill_rewrite`（ADR-0054）确立了同一信任叙事——提名工具只追加 ADR-0047 收件箱，
  批准权始终在人。本篇是第三个成员，复刻同一模式，不新设信任机制。
- **队列与决策面现成**：`enqueueProposal`（软帽 50/硬帽 200/原子写/framing 校验，中文报错）
  + 提议 tab 的 ProposalCard + `proposalInboxList`，零新存储、零新 RPC。
- **工具失败即当轮修复**：`defineTool` 的 execute 抛错 → 工具失败消息带诊断回模型，同一轮内自纠；
  散文时代的「解析失败 → 追问回合」要多花一整轮且命中率无保证。
- **ToolRunContext 没有 sessionId**：工具无法自证来自哪个调度 run，来源只能靠约定。
- **词汇表的归属矛盾**：动作词汇表（kinds/必填/可空字段）权威在客户端 `capability-match.ts`
  （ADR-0021/0047 一脉），而 controller 因 web bundle 纯度不能反向依赖客户端包。
- **散文解析链不能拆**：`proposalOfAnswer` + 信封拒绝诊断 + 一轮修复仍在服役——旧 prompt 快照
  与模型惯性下，总有 run 不调工具；拆掉回退等于把迁移风险押在单一路径上。

决定：

1. **新工具 `kb_propose_actions`**（第十五个 `kb_*` 工具，controller 第三个）：参数
   `title`（必填）、`actions`（对象数组，必填）、`note`、`mails`（`lastReadAt` 必填 +
   `firstReadAt` 可选，水位规范化为 ISO Z 戳防幻觉游标）、`source`、`sourceName`。
   execute 先校验（失败抛错，逐项中文诊断自然成为工具失败回执），通过即 `enqueueProposal`
   入队并返回 `{ok, id}`；渲染成功文案提醒「入队成功后不要再重复输出提议信封」。
   工具**只入队、不执行**——批准权仍在人的提议 tab，与另两个提名工具同一信任锚。
2. **修订 ADR-0047 决定 2**：「agent 没有任何收件箱工具」改为「agent 只有只写的提名通道
   `kb_propose_actions`」——不读队列、不裁决、不能改撤已入队行；生产者从「前端调度器唯一」
   变为「前端调度器 + agent 提名工具，两者都只入队」。信任锚不变：创建调度 + 批准提议两级
   人类动作照旧，agent 提名额外受工具 schema 与服务端校验约束。
3. **词汇表孪生 + parity 测试钉漂移**：`KINDS` / `REQUIRED_FIELDS` / `EMPTY_OK_FIELDS`
   在 controller（`capability/proposal-actions.ts`）与客户端（`capability-match.ts`）各持
   一份，`tests/proposal-tool.spec.ts` 的 parity 组跨包比对两张表逐一相等、并以全部 kind 的
   正反样本过校验——bundle 纯度的代价是一张必须成对维护的表，靠测试而不是自觉钉住。
   校验语义：空 `actions` 数组=通过（允许沉默归约定层管，工具层只管形状）；逐项点名
   「第 N 项缺必填字段 ×、×」/「不是已知的动作类别」；可空字段显式空串放行、缺席不点名。
4. **来源靠约定透传**：工具拿不到 sessionId，调度约定行教模型随调用透传
   `source="schedule:<id>"`、`sourceName=<调度名>`；缺省落 `agent:kb_propose_actions` /
   「会话提议」。信任强度与信封时代持平——模型自报来源，伪造面没有变大；队列行的来源本就
   只作展示与通知分流，不作安全判断。
5. **调度器双路径互斥**：run 结束先扫事件日志，检出 `tool/call` 且 name=`kb_propose_actions`
   → 走工具路径：跳过散文解析与追问兜底（防双入队），从 `proposalInboxList` 倒序查
   `source=schedule:<id>` 且 pending 的最新行取 proposalId 供通知分流（查询失败降级纯通知）；
   未检出 → 原散文路径原样保留。事件读取相应从「stats 专用」提前到 askTurn 之后
   （`eventsRead` 标志门控统计），修复回合发生后重取。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 词汇表双份维护，靠 parity 测试钉住 | controller web bundle 纯度不破 | parity 测试漏报两次即改共享包 |
| 2 | 来源靠模型自报，理论上可伪 | 零基建（不动 ToolRunContext）；与信封时代同等信任强度 | 来源伪造造成实际损害时给工具上下文补 sessionId |
| 3 | 调度器双路径并存，复杂度上升 | 旧快照/模型惯性有回退，迁移零风险 | 散文路径连续数周零命中后删除解析回退 |
| 4 | 约定段仍占提示词篇幅（还加了工具教学） | 工具目录持续曝光替代纯文字约定的脆弱性 | 工具提名稳定命中后约定瘦身为一句指路 |

原因：

- **为什么工具化**：散文信封的事故史（0047 验收日 0% 命中、2026-10-09 教学错位修订、本次晨间
  事故）指向同一根因——提议的产生依赖模型遵守输出格式约定，而格式约定是最容易被惯性磨掉的
  约束。工具调用把 schema 校验挪进服务端、把修复周期压到当轮、把「记得附信封」变成「记得调
  工具」——后者有工具目录的持续曝光撑着，前者只有一段拼在提示词末尾的文字。
- **为什么正面修订 0047 而不是绕开**：决定 2 明文「agent 没有任何收件箱工具」，工具化与之直接
  冲突；不留修订指针，0047 的读者会拿着过期地图走路。
- **为什么校验在 controller**：入队前的服务端校验让错误在模型当轮就被看见（散文时代入队前只有
  客户端解析器的 known-kind 过滤，畸形信封静默变纯通知）；回读校验（`proposalOfPayload`）
  继续保留，两端各拿一半的既有分工不变。
- **为什么现在是时候**：晨间事故是直接动因；两个提名先例使模式成熟，边际成本只是第三个提名
  工具与一张 parity 表。

后果：

- `packages/api/yantao-kb-controller`：`capability/proposal-actions.ts`（孪生表 + 校验器 +
  水位规范化 + mailSpanNote）；`index.ts` 注册 `kb_propose_actions`。
- `packages/client/ui-yantao`：`capability-match.ts` 三表加 export；`scheduler.ts`
  `withProposalEnvelope` 更名 `withProposalConvention`（改教工具）、`runScheduledTask`
  双路径互斥。
- mail 能力 SKILL.md v16：「提议的邮件扩展」节从信封 JSON 改教工具参数形态（逐封字段、
  mails 水位、批量形态整单被拒）。
- 测试：`proposal-tool.spec.ts`（校验器 / parity / 工具 harness 三组）、
  `scheduler.client.spec.ts` 工具提名路径三例。
- 生效条件：宿主持旧模块，需**重启工作台**；builtin SKILL.md 播种在重启时覆写数据目录副本。

落地注记（2026-10-10，施工完成）：controller 侧 `proposal-actions.ts` 新建（KINDS 十三种 /
REQUIRED_FIELDS / EMPTY_OK_FIELDS、`validateProposedActions` 逐项中文诊断、
`normalizeMailRange`、`mailSpanNote` 沿用「覆盖邮件 M-D → M-D」措辞）；`kb_propose_actions`
注册于 `kb_exec_capability_script` 之后，缺省来源 `agent:kb_propose_actions`/「会话提议」。
客户端 `withProposalConvention`（约定教工具：title/actions 教学、能力无关类别清单保留、
允许沉默、入队成功后勿重复输出信封、provenance 透传行）；`runScheduledTask` 事件提前读取 +
工具路径检测 + inbox 回查分流 + 散文回退原样保留；stats 由 `eventsRead` 门控。
mail SKILL.md v15→v16 已同步数据目录。验证：controller/ui-yantao 窄 tsc 干净；controller tsdown host
产物与 client bundle 重刷；vitest 两文件 53 例全过（proposal-tool 12 + scheduler.client 41）。测试期间
修了三处自伤：DSL 的 object 节点必须显式 `additionalProperties`（两个不合规格节点曾把整个 InferArgs
退化成宽松 JsonValue）、scheduler 的事件变量需 readonly、harness 的 follow 需区分 askTurn 与
collectEvents 的来访（事件收集裸跟进不得消费脚本回复，否则修复回合拿不到回答）。

修订（2026-10-10，逐项容错 + 一跑一卡）：整单制在实践中把一次邮件调度的提名逼成六七张小卡
（27 项大单被整单拒修三轮的事故应激），人要在提议页挨张点。裁决两项：(1) 校验器改逐项容错——
`partitionProposedActions` 把合格项与坏项分开，合格项照常入队、坏项诊断随工具结果带回
（`dropped` 字段），全军覆没才整单拒绝；(2) mail SKILL.md v19 把「小批量提名」纪律改回
「一跑一卡」——收尾汇总一次提交，被剔项修正后补提，不预防性拆批。信任锚不动：入队的每一项
仍等人在卡上逐封勾选批准。
