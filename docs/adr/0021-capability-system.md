---
status: accepted
---

# 能力系统（连接重构为能力：skill 目录 + 宿主入口）

ADR-0010 预留了 connector（"从外部系统拉取 Resource 的一种接法"），此后 ADR-0019（邮件）和
ADR-0020（电子书抽取）各自落地了一个实例——而两者不约而同长成了同一副骨架：
**Python 子进程取数/抽取 → dsh session 分析 → 提议卡 → 人批准写库 → 断点推进**。
第三个连接器出现之前，把这个重复的模式提炼成平台概念，就是本 ADR 的全部内容。

同时，dsh 上游有一套现成的 skill 机制（`ctx.skills` 注册表 + 文件系统发现 + 会话目录 +
`skill` 加载工具，见 `docs/subsystems/skills.md`）：skill 是"渐进式披露的指令包"——目录里是
SKILL.md 加资源文件，模型按需加载正文。能力借它的**目录形态与发现机制**，但不借它的
模型侧调用——这是本 ADR 最核心的一条取舍（见取舍台账第 1 条）。

决定：

1. **能力 = skill 目录 + 声明式宿主入口**。一个能力是一个合法的 dsh skill 目录：
   `SKILL.md`（指令正文，供人读与未来模型读）+ `scripts/`（宿主可执行入口）。能力层声明
   放在 frontmatter 的 `metadata.yantao` 段——skill-filesystem 只保留 frontmatter 的
   `metadata` 键，顶层自定义键会被丢弃，所以必须嵌在这里（不影响 skill 本身的语义）：

   ```yaml
   metadata:
     yantao:
       entry: scripts/entry.py      # 宿主执行入口
       runtime: python              # v1 仅 python
       appliesTo:
         resource: ['.epub', '.pdf']  # 按扩展名匹配资源文件
         entity: ['project']          # 可作用于某类实体
         external: ['mailbox']        # 或声明接某个外部源
   ```

   **"添加能力"因此有两种**：全新写一个（手建或脚手架生成目录），或注册一个下载好的
   目录（往 `Config.customSkillDirs` 加路径）。不改 controller 代码就能装新能力——这是
   选 skill 目录而不是"每个连接器一个 RPC"的根本原因。

2. **仅人可调用**。能力一律 `modelInvocable: false`：`tool-skill` 继续禁用，能力目录不进
   模型的会话目录，agent 的 `kb_*` 工具集一个不加。下载的能力本质是任意来源的注入指令，
   让它对模型可见等于把信任边界从"七个工具"扩张到"任意下载内容"。SKILL.md 的指令正文
   在 v1 **可选**——能力 tab 详情态以 frontmatter `description` 为主，正文有则展示；
   写正文的收益要等模型侧放开（取舍台账第 1 条）才出现。

3. **执行仅发生在会话之前**。人点「应用」→ controller spawn 子进程（JSON 走 stdin/stdout、
   UTF-8 管道、超时、失败分类枚举 + 中文提示——泛化 mail/extract 已验证两次的模式）→
   产物缓存进知识库根旁的 `.yantao/capabilities/<name>/`（同 `.yantao/extracts/` 待遇：
   机器簿记，不进树）→ agent session 分析产物。**没有 `kb_run_capability`**：agent 不获得
   "请求执行下载代码"的通道。

4. **统一提议流**。任何能力的"应用"都走同一五拍：人触发 → 脚本取数/抽取 → session 分析 →
   提议卡 → 人批准写库。断点只在批准后推进。提议卡用**统一 schema**，五类动作恰好映射
   现有 `kb_*` 写工具的全部面：新建实体、追加流水、写状态、存资源、建关联，各带理由字段。
   MailReview 泛化为通用提议卡组件；读书收尾提议（ADR-0020 决定 9）并入同一 schema。
   批准后的写库直接走现有工具实现，**不新增任何写路径**。

5. **元数据与断点在知识库之外**。能力是管道不是知识：不进 `resources/`、不进 `entities/`、
   不可被 `[[…]]` 引用。已安装能力清单与各自状态存 `~/.dsh/yantao-kb.json`——现有
   `connectors.mail.lastReadAt` 槽泛化为 `capabilities.<name>.state`（任意 JSON，由各能力
   自解释）。

6. **发现挂 skill-filesystem，消费层自建**。启用 dsh `skill-filesystem`（目录扫描、chokidar
   监听、项目 `.dsh/skills` → `customSkillDirs` → 用户目录的 rank 优先级是现成的）；
   `tool-skill` 继续禁用。yantao 写自己的消费者（能力面板 + 执行缝）从 `ctx.skills` 读目录。
   自建扫描/监听等于复制一段容易出错的文件监听代码，没有必要。

7. **appliesTo 声明式匹配**。UI 据此在资源右键菜单（按扩展名）、实体面板（按类型）、能力
   tab 里过滤可用能力。`external` 源由 controller 内置登记（v1 只有 mailbox）——外部源是
   controller 的知识，不是能力的。

8. **UI：连接 tab 改能力 tab**。清单 + 详情两态：清单列名称、来源目录、appliesTo 摘要、
   上次运行/断点摘要；详情态含描述、入口脚本、状态 JSON、运行按钮。邮箱作为
   `external: ['mailbox']` 能力出现在同一清单里，**没有特权区**——连接 tab 的旧语义被
   完全吸收。添加：tab 上「添加目录」按钮（写配置）+「新建能力」脚手架（生成带注释模板的
   SKILL.md + entry.py 存根，默认落项目 `.dsh/skills/`；不生成玩具示例——迁移后的邮件和
   电子书就是最好的对照样本）。

9. **拖入不弹询问**。拖放入库仍是纯复制（ADR-0020 决定 1 不动），应用能力永远是人后续
   主动点。入库和加工是两个决定，不耦合。

10. **全量迁移**：邮件（`read_outlook.py` + fetch 封装）改写为 `mail` 能力目录，电子书抽取
    （`extract.py`）改写为 `ebook` 能力目录；`yantaoKb.mailFetch` / `yantaoKb.extractResource`
    退役，换一个通用 `yantaoKb.capabilityRun`。读书项目创建流程改写为"ebook 能力应用到
    该资源"这一个实例，流程本身（弹窗、session、提议卡）不变。

11. **词汇**：「连接 (Connector)」退役，改用「能力 (Capability)」；CONTEXT.md 换词条。

## 取舍台账——为控制牺牲的便利性

本节是台账，不是附录：每条写明牺牲了什么、换来什么、**什么条件下重新打开**。
未来判断"该不该翻案"，看重开条件是否成立，不看心情。

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | agent 不能自主发现/调用能力（模型自主性为零） | 下载的任意指令不进模型上下文，信任边界仍是七个 `kb_*` 工具 | 能力白名单机制落地后，可对白名单内能力开 `modelInvocable` |
| 2 | 会话中不能再取数（分析中途无法补拉邮件、重抽取） | agent 无执行下载代码的通道，宿主执行面只有"人点应用"一个入口 | 同第 1 条，且需设计带人工确认的受控执行工具 |
| 3 | 统一提议 schema（能力不能定制 review 交互） | 批准写库只有一条路径，直接映射现有 `kb_*` 实现，无新写面 | 出现五类动作表达不了的合法动作时——扩 schema，不开旁路 |
| 4 | 声明式 appliesTo（能力不能运行时自荐） | UI 过滤零猜测；拖入后的可用操作列表是免费产出 | — |
| 5 | 元数据不进 tree（能力不可双链引用、不参与实体语义） | 不产生"这个能力算哪个 area"的假问题；管道与知识分离 | 出现"把能力当知识对象管理"的真实需求时 |
| 6 | 拖入即纯复制（少了"顺手加工"的便利） | 入库与加工解耦，守 ADR-0020 的冷静决定 | — |
| 7 | 入口仅 python runtime | 执行契约单一：失败分类、超时、依赖安装只有一套 | 出现第二个 runtime 的真实能力时 |

原因：

- **为什么是 skill 目录**：可添加性。"注册一个下载好的目录就能装新能力"只有站在 dsh
  skill 机制上才成立——发现、监听、rank 合并都是现成的、经过测试的。自建能力清单格式
  意味着把这 300 行易错的文件监听代码重写一遍，还放弃了未来与 dsh skill 生态互通的可能。
- **为什么仅人可调用**：yantao 的信任边界是硬规则（agent 只有 `kb_*` 工具，无通用写能力）。
  能力目录是下载物，其 SKILL.md 是任意指令；`tool-skill` 一旦启用，这些指令就进入模型
  上下文。邮件和读书流程本来就是人触发的，模型自主调用没有真实需求——为不存在的需求
  放弃边界，不值。
- **为什么不进 tree**：ADR-0010 给 connector 的定位（"不落盘、不进 tree"）在能力这里依然
  成立且升级：能力是管道，知识是产物。产物（实体、资源、流水）住在知识库里，管道本身
  住在 `~/.dsh/`。让能力进 tree 会立刻产生"这个能力归哪个 area"的假问题。
- **为什么统一提议流**：mail 和 extract 两个先例已经同构（extract 的代码注释自己承认
  "沿用 mail connector 的先例"）。统一契约让"能力应用到各种实体"有单一含义，新能力的
  成本降到"写 SKILL.md + 脚本 + 提示词"；提议卡和批准写库由平台统一提供，写路径不增。
- **为什么全量迁移而不是包一层**：两个先例的代码本来就按同一模式写，迁移是搬运不是
  重写。留着 `mailFetch`/`extractResource` 与 `capabilityRun` 两套并行执行路径，"能力"这个
  概念从出生起就不纯粹。yantao 是单人工作台，一次到位的窗口成本最低的时刻就是现在。

后果：

- 新 RPC `capabilityRun` 意味着 `pnpm run build:lib` + `pnpm run gen-cordis-catalog` 必须跑，
  controller 的 README 对（RPC 表 + "N unary methods" 句）和 `docs/subsystems/yantao.md`
  **随实现同步**，不提前。
- `packages/bundle/yantao-web-app/cordis.patch.yml` 中 `skill-filesystem: disabled: true` 改为
  挂载（`tool-skill` 保持禁用）。
- `.yantao/capabilities/` 加入知识库树的不显示名单（与 `.yantao/extracts/` 同待遇）。
- ADR-0010 的 connector 预留由本 ADR 取代；ADR-0019/0020 中仍然成立的决定（人工批准、
  默认不落库、断点推进、惰性抽取）被引用而非重写。
- 词汇表「连接」条目改「能力」——**随代码落地一起改，不提前**（文档不能先于行为）。
- 未做：模型可调用（白名单机制）、会话中执行、第二 runtime、多外部源登记、能力市场/签名。
