---
status: accepted
---

# 系统提示词分层（yantao 叠加层走 dsh 的 section 注册表）

yantao 对模型说话的文本目前只有两处：`packages/bundle/yantao/cordis.patch.yml` 里一段
5 行的硬编码 persona，和散在各 `kb_*` 工具 description 里的行为规范。随着工作台长大，
"理念、文件组织、记忆、技能"都该有基础的系统提示词——继续往 persona 里堆字符串不可持续：
没有结构、没有顺序、没有"提示词都住在哪"的单一答案。

dsh 上游对此有现成机制：`@deepseek-ai/dsh-system-prompt` 是一个 section 注册表——
`section()` 按 order 升序拼接、同名 scoped section 遮蔽全局、`deployment:persona` 槽位
专属部署方身份、`system-prompt/assemble` 事件允许按 scope 改写组装结果
（`packages/core/system-prompt/src/index.ts`）。本 ADR 决定 yantao 如何站上去。

决定：

1. **机制用上游注册表，不另造拼接**。yantao 的系统提示词 = dsh 基座 section + yantao
   注册的命名 section，按 order 分层。"yantao 叠加在 dsh 之上"在这套机制里是字面成立的：
   上游升级时我们的层不动，我们的层调整时上游不动。

2. **persona 保持薄的身份声明**。`cordis.patch.yml` 的 persona 槽只留身份与红线
   （"你是谁、工作目录、信任边界一句话、用中文回答"）；成篇幅的内容不进 persona。

3. **yantao 叠加层是命名 section，内容源是仓库里的 Markdown 文件**。初版四个：

   - `yantao:philosophy` —— 工作台理念：PARA+P、人机分工（人批准写库、agent 走 `kb_*`）、
     冷静决定的文化；
   - `yantao:filesystem` —— 知识库文件组织：树结构、实体/资源/『状态』/『流水』各区的语义
     与读写规则；
   - `yantao:memory` —— 知识库使用纪律：何时该向『流水』追加（任务结论、重要变更）vs
     何时不该（琐碎过程）、动手前先 `kb_read`/`kb_list` 不猜内容、结论落库的时机——
     把散在工具 description 里的行为规范上提为连贯叙述；
   - `yantao:skills` —— 能力的使用纪律：何时建议或调用能力、产物如何进库。能力清单
     **不写死在这里**——动态注入见 ADR-0023。

   文件放在注册它们的插件包内（`packages/yantao/kb/prompt/sections/*.md`），插件初始化时
   读取并 `section()` 注册——按 cordis 纪律，kb 插件为此声明 `inject = ['systemPrompt']`。
   Markdown 是唯一源：改提示词 = 改文件，呈现位置统一、可 review、可测试。

4. **order 槽位**：yantao sections 排在 deployment persona（0）之后、工具 section
   （1000+）之前（取 100–200 段），保证"身份 → 领域纪律 → 工具契约"的阅读顺序。

5. **统一呈现**：所有模型可见的 yantao 提示词散文收敛到同一个 sections 目录，配 README
   索引说明每个文件的职责与注入位置。工具 description **不迁移**——它们是工具契约的
   一部分，跟着工具代码走。

6. **不提供运行时改写**。section 内容构建期打包，改了要重新构建。知识库里的 SKILL.md
   （技能提示词）才是运行时可改的层——两者的改写工作流不同是有意的（取舍台账第 1 条）。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 改系统提示词要走构建，不能部署后热改 | git 版本受控、可 review、可测试；不出现"知识库里的提示词和仓库不一致"的漂移面 | 出现"部署后必须调系统提示词"的真实需求时，加知识库覆盖层（waterfall） |
| 2 | persona 仍是硬编码 YAML 而非 Markdown | 部署身份留在部署补丁里，单一来源 | persona 超过十行时迁入 Markdown |
| 3 | 工具 description 不上提（纪律叙述与工具契约两处并存） | 工具契约跟工具代码走，不为统一呈现而搬家 | 出现实际漂移事故时，用生成器从 section 抽取工具描述 |

原因：

- **为什么用注册表而不是继续堆 persona**：persona 是一个字符串槽，堆进去的东西没有顺序、
  没有名字、没法单测。section 有 order、有名字、可被 scoped 遮蔽——分层不是比喻，是机制。
- **为什么源文件在仓库**：这些是系统级、不对用户直接可见的基础提示词，性质上是产品源码
  的一部分。"及时调整"的真实诉求属于技能提示词（SKILL.md 在知识库里、运行时读取、改了
  立即生效），那一层已经成立，本 ADR 不动它。
- **为什么挂在 kb 插件**：理念/文件组织/记忆/技能讲的全是知识库工作台的使用方式，kb 插件
  就是领域层。为提示词单开一个包会触发新包全套簿记（README 三连、catalog 生成器、
  tsconfig references），收益为零。

后果：

- 组装出的系统提示词变化用 headless 冒烟验证：`pnpm dsh --profile yantao "…"`。
- sections 目录与其 README 索引**随实现同步**，不提前。
- 无新 RPC、无 bundle 行增减。kb 插件新增 `inject = ['systemPrompt']` 声明预计不触发
  gen-cordis-catalog；落地时若 catalog 漂移，重跑生成器即可。
- ADR-0023 的 `yantao:skills` section 依赖本 ADR 的机制与 0023 的门控结论，两边互相引用。
