---
status: accepted
---

# 惯用提示词与能力的柔性调用：`/` 三入口一套语义

两条同源的诉求（2026-09-30，grilling 对齐）：

- **dingtalk-docs 进聊天**：dingdocs-pack（钉钉知识库 CLI，`D:\dingdocs\dingdocs-pack`）已整编为能力目录 `.dsh/skills/dingtalk-docs/`（ADR-0025 决定 1 的采纳路径），但人在工作台聊天里说不出一句能让 agent 用上它的提示——技能名太长、参数格式要背、`/` 菜单里也没有它；而能力 tab 是一张死的清单，除了「运行」没有任何个人化的东西。
- **惯用提示词**：人有几组反复手打的 `/xxx xxx` 组合（技能/能力＋固定参数），希望像输入法自定义短语一样存起来、一键填入。

经十项共识收敛，本 ADR 把这两件事统一为一个模型：**展开的权威全在 agent，宿主只负责把 `/别名` 送进 composer**。

事实基础：

- dsh 的 pre-step 技能注入（`dsh-tool-skill`）对消息开头 `/name` 自动注入 SKILL.md 正文，对一切 user-invocable 技能生效（含 `disable-model-invocation: true`）——`/dingtalk-docs ls 软件工程化` 这类调用**今天就能走通**，宿主零代码。
- 能力 tab（ADR-0021）首屏是能力清单，无任何用户自定义空间。
- `/` 菜单的 source 有 `order` 字段（`InputTriggerSource.order`，小者在上）：ui-commands 默认 0、ui-skill 为 2，置顶只需更小的 order。

决定：

1. **柔性调用走既有 pre-step 注入**：`/dingtalk-docs xxx` 的解析规则、动词语义、执行通道全部写进 SKILL.md 正文（调用解析＋动词语义表＋执行通道二选一），宿主不加任何 `/` 特判。SKILL.md 改写为**双通道自适应**：通道 A shell 直跑 `python dd.py …`，通道 B 工作台内 `kb_run_capability` 信封（`scripts/entry.py`），两通道共享同一 `config.json`/`state/`。源头包（`D:\dingdocs\dingdocs-pack`）与能力目录双份同步；源头包原有的 MCP 40 工具地图与 curl 兜底流程移入同目录 `MCP-REFERENCE.md`（不注入 agent 上下文，SKILL.md 尾部指针引用）。
2. **惯用项 = 别名＋展开文本**：一条惯用项就是 `{alias, text}`——alias 是 `/` 后的一个 token，text 是人想让它代表的完整文本（通常是某个 `/技能名 参数` 组合）。v1 不做占位符/参数模板，展开就是纯文本。
3. **存储**：`<kbRoot>/.dsh/yantao/prompt-shortcuts.json`，`{version:1, shortcuts:[{alias,text}]}`；alias 校验 `^[^\s/\\]+$` 且 ≤32 字，text ≤2000 字，全表 ≤30 条软帽；保存一律全量替换（增删改排序一个缝隙）。**UI 是唯一写者**（人类通道，硬规则 2），agent 不经工具接触这份文件。
4. **别名防撞**：保存时宿主侧前置校验 alias 不得与既有技能/能力同名（`ctx.skills.list({cwd})`），撞名拒绝并指名冲突方——否则 `/` 菜单同一名出现两个来源，歧义无法裁决。
5. **展开权威在 agent**：三个入口（`/` 菜单点选、能力 tab 点击、手打）都只把 `/别名 ` 文本填进 composer，**不发送、不做任何本地展开**；agent 收到消息后按惯用表自行把 `/别名` 当作展开文本执行。系统提示新增 `yantao:prompt-shortcuts` 小节（order 155，紧邻行为记忆），同步 provider 用 `readPromptShortcutsSync` 读取，损坏时降级为空小节（不阻断组装）。
6. **能力 tab 首屏惯用化**：tab 名仍叫「能力」。list 态首屏是惯用提示词区（增删改、上移/下移手动排序、点击行把 `/别名 ` 填入 composer 不发送），能力清单与未注册技能折叠在其后的「能力清单」开关下，详情态与 mail 面板不动。
7. **`/` 菜单惯用分组置顶**：新 source `prompt-shortcut`，`order: −10`（小于 commands 的 0 与 skill 的 2），候选 section「惯用」；无 matchEnter/matchSpace，与能力 source 同一立场（enter/space 裁决权留给 ui-commands）。
8. **composer 填入走公开面**：rail 拿当前会话（`sessions.list` → `sessions.scope`）→ `ctx.conversation.input.for(actx)` → 读 `draft` 后 `setDraft(追加 '/别名 ')`。不走 `slash/input-insert-text` 事件——那是 session-scope bail 事件＋draftRev CAS，rail 侧无法伪造 pick-time span；setDraft 追加式拼接（草稿非空且不以空白结尾时补一格）是共识允许的等效通道。
9. **RPC 面**：`yantaoKb.promptShortcutList` / `promptShortcutSave` 两个 Remote 端点；校验失败以 `yantao-kb/rejected` KbError 映射（details 只带 `{path}`，与既有惯例一致）。
10. **提案卡「存为惯用」延后**：从提案卡一键沉淀惯用项是真需求，但涉及提案卡结构改动，留作后续独立小步，本轮不做。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 惯用项 v1 无占位符，参数每次手补 | 数据结构与心智模型都是纯文本，零模板引擎 | 出现高频「只换日期/库名」的组合时加 `{}` 占位 |
| 2 | 展开靠 agent 自觉（读系统提示小节），宿主不强制改写消息 | 零宿主拦截代码、三条入口共用一个语义 | agent 漏展开成为常态时，考虑 composer 发送前的本地展开 |
| 3 | 能力清单默认折叠，老用户多点一下 | 惯用区拿到首屏 | 折叠被证明碍事后改记忆化初态 |
| 4 | 惯用文件 UI 唯一写者，agent 不能代管 | 信任边界不破（硬规则 2） | 有明确诉求时以新的 kb_* 工具开缝并过 ADR |
| 5 | 别名禁撞技能名，少一层命名自由 | `/` 菜单单一来源无歧义 | 无——撞名场景没有正当用例 |

原因：

- **为什么展开权威放 agent**：本地展开要在三个入口各自实现且互相漂移，还要处理「展开后再编辑」的光标地狱；agent 侧展开只有一处逻辑（读惯用表→匹配→执行），且天然支持「半匹配、容错、追问」这些文本规则做不到的事。
- **为什么 order 155 而不是塞进行为记忆**：惯用表是结构化、低频变更、需要稳定呈现的指令性内容，与行为记忆的自由文本积累性质不同；独立小节让 token 计价（ADR-0039 的注入份额）也能分开算账。
- **为什么 SKILL.md 双通道而不是全面 workbench 化**：源头包要在任意 Windows 环境（CodeBuddy/Claude 会话）独立可用，能力目录只是它的一个宿主；双通道自适应让一份正文伺候两个家，拷贝升级仍然是一条 `cp`。

后果：

- `packages/yantao/kb`：新增 `prompt-shortcuts.ts`（存储、校验、同步读）、`sections.ts` 增 `yantao:prompt-shortcuts`（order 155）及 system-prompt 模板小节。
- `packages/api/yantao-kb-controller`：`promptShortcutList`/`promptShortcutSave` 双 RPC 与类型；保存前技能名撞车前置拦截。
- `packages/client/ui-yantao`：`remote.ts`（RPC 封装＋`fillComposerWithShortcut`）、`prompt-shortcut-gesture.ts`（`/` 新 source，order −10）、`CapabilityPanel.tsx`（`ShortcutSection` 首屏＋清单折叠）、`Workbench.tsx`/`frame/Frame.tsx`（props 透传）、`locales.ts`（`shortcut.*` 与 `capability.inventoryHeading` 中英成对）、`index.ts`（inject 增 `conversation`，注册新 source）。
- 能力资产：`.dsh/skills/dingtalk-docs/`（SKILL.md 双通道化、`yantao.json`、`scripts/entry.py` 信封、`dd.py` 含代理 fallback）；源头包同步并新增 `MCP-REFERENCE.md`。
- 文档同步：`docs/yantao/README.md` ADR 索引（本条）。

## 落地注记（2026-09-30）

十项决定当日全部落地。

- **宿主侧（决定 2/3/4/9）**：`yantao-kb` 新增 `prompt-shortcuts.ts`（`PROMPT_SHORTCUTS_DISPLAY_PATH`/`PROMPT_SHORTCUTS_SOFT_CAP`=30/`readPromptShortcutsSync` 损坏降级），`sections.ts` 增 `PROMPT_SHORTCUTS_SECTION`（order 155）与 system-prompt 小节模板；`yantao-kb-controller` 增 `@Remote('promptShortcutList')`/`@Remote('promptShortcutSave')`，保存前 `ctx.skills.list({cwd})` 取技能名集合前置拦撞名，`shortcutError()` 把 KbError 映射为 `yantao-kb/rejected`（details `{path}`）；typert 产物再生成。
- **客户端（决定 5/6/7/8）**：`ui-yantao` 新增 `prompt-shortcut-gesture.ts`（trigger `/`、order −10、section「惯用」、无 match 钩子）；`CapabilityPanel.tsx` 首屏 `ShortcutSection`（增删改＋↑↓ swap 排序＋点击行填入，错误就地呈现）＋能力清单 `inventoryOpen` 默认折叠；`remote.ts` 增三 RPC 封装与 `fillComposerWithShortcut`（`sessions.scope` → `conversation.input.for(actx)` → `setDraft` 追加式拼 `/别名 `）；`index.ts` inject 增 `'conversation'`、注册 `/` 惯用 source；`locales.ts` 增 `shortcut.*` 十一键与 `capability.inventoryHeading`（中英成对）。
- **dingtalk-docs（决定 1）**：SKILL.md 双份同步改写（调用解析＋动词语义表＋执行通道二选一＋排障要点）；源头包旧 MCP 地图整体迁入 `MCP-REFERENCE.md`；`dd.py` 代理 fallback（内网代理不通即直连并进程内粘住）已在源头落地。
- **验证**：三包（yantao/kb / yantao-kb-controller / ui-yantao）vitest 43 文件 865 测试全绿；`tsc -b` 三包窄构建干净；oxlint 0/0（CapabilityPanel 清单折叠块的缩进级联与三处超长 import 由 `lint:fix` 自动修复，`shortcut?.alias` 冗余可选链手修）；`dsh-client-ui-yantao` bundle 与 `dsh-yantao-frontend` build 通过。工作台测试夹具（`workbench.client.spec.tsx`）补齐惯用三 face 桩与 `unfoldInventory` 展开——能力清单默认折叠后，16 个既有能力用例先展开再断言。
