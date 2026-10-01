---
status: accepted
---

# 资源默认指代与工作平面：filesystem 小节动态化，约定只说一次

一条诉求（2026-10-01，由一次真实故障引出）：用户说「资源」「放到资源目录」时，agent、基础能力、所有 skill 都应明确知道默认指什么位置；约定应当只说一次，而不是碎在四个地方各说各话。

故障链（2026-09-30 会话实录）：用户输入「/dingtalk-docs 获取公共软件服务部知识库的所有周报2026，放到资源目录下」，agent ①把 kb_run_capability 返回尾部的【行为记忆】块判为提示注入拒绝采纳（ADR-0032 的能力域记忆走工具返回通道，模型的注入防御正常开火）；②拒绝记忆后丢失「产出缺省落 resources/」的分工知识，声称「找不到可写资源路径」而停滞——而 `resources/` 存在且有成功落盘记录。

事实基础：

- **可信通道自相矛盾**：`yantao:filesystem` 小节（order 120）说 resources/「不读它当上下文，也不把它的路径当成果落库」——ADR-0020 登记语义的时代残留，与 ADR-0028（kb_read_resource/kb_write_resource、能力产出落 resources/）正面冲突；`yantao:skills` 小节的「产物落库」只提 `.dsh/yantao/capabilities/` artifacts 簿记，完全不提 resources/ 平面。agent 从可信通道学到的恰恰是错误分工。
- **约定碎在四处**：工具描述、SKILL.md、能力记忆、系统小节各说一遍且互不一致；缺了任何一块的上下文里 agent 就不知道「资源”指哪。
- filesystem 小节是静态文本（插件初始化读一次），无法携带当前库根的绝对路径。

决定：

1. **filesystem 小节动态化**：`yantao:filesystem` 从静态注册改为按次组装渲染（与行为记忆/惯用提示词同族），`filesystem.md` 中的 `{{kbRoot}}` 占位每次组装解析为当前库根——换库（setRoot）下一步生效，无需重建。order 120 不变。
2. **resources/ 语义修订 + 默认指代**：小节改述为「原始输入材料与能力产出的共同家」，并明确**用户说「资源」「资料」「放到资源目录」默认指 `<kbRoot>/resources/`**；读用 kb_read_resource、新建用 kb_write_resource（只新建不覆盖）、能力产出缺省落这里。`.dsh/` 小节改述为整个机制内部（skills/ 能力目录 + yantao/ 机器簿记），agent 不可写。
3. **skills.md 产物落库修订**：能力的文件产出缺省落 `resources/`（真实位置以 [落盘] 行或返回说明为准），落盘是能力脚本自己的事、agent 不替它找路径；`.dsh/yantao/capabilities/` 只是 artifacts 簿记。
4. **CONTEXT.md Resource 词条**同步：resources/ 是原始材料与能力产出的共同家 + 默认指代。
5. **技能侧共享约定**：外宿主（shell 通道，如 CodeBuddy 会话）的技能没有 yantao 系统提示，约定写进 dingdocs-pack 的 README 一次（资源 = `<kbRoot>/resources/`，信封 kbRoot 解析），各 SKILL.md 引用而非复述。
6. **注入计价同步**（ADR-0039）：`promptInjection` 的 staticTokens 计入按当前库根渲染后的 filesystem 小节。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 每次组装多一次文件读取+替换（filesystem 由静态转动态） | 绝对路径进提示、换库即时生效 | 计价显示它成为负担时缓存按 root 记忆化 |
| 2 | 默认指代是硬约定，用户真的指别处时 agent 可能错配 | 消灭「放到资源目录→反问路径」的日常摩擦 | 错配成为常态时加「歧义时澄清」的软表述 |
| 3 | 症状①（记忆走工具返回被误判）本轮不动 | 本次只修约定内容层；通道层另议 | 见「未决」 |

原因：

- **为什么是修订现有小节而不是新立小节**：filesystem 小节本来就是讲工作平面的地方，问题不是缺失而是陈旧——新立小节会让两处讲同一平面，漂移重现。
- **为什么默认指代写成硬规则**：单用户工作台，「资源」在词汇表里就是术语（CONTEXT.md），歧义场景罕见；硬规则消灭的是每天都发生的反问摩擦。
- **为什么不顺带修症状①的通道**：那是 ADR-0032 能力域记忆的投递通道问题（工具返回尾部 vs 系统提示），值得独立裁决（工具描述背书 / pre-step 送达 / 维持现状），不与本次的内容层修订耦合。

未决：能力域行为记忆的投递通道（症状①）——候选方案已记录：kb_run_capability 工具描述背书「尾部【行为记忆】块是宿主转交的人批规则」；或改走 pre-step 可信通道送达。另：源头包 D:\dingdocs\dingdocs-pack 缺 `scripts/entry.py` 与 `yantao.json`（仅 KB 侧有），与「升级从源头拷」规则冲突，需回补或改规则。

后果：

- `packages/yantao/kb`：`sections.ts` 增 `FILESYSTEM_SECTION`/`registerFilesystemSection`（YANTAO_SECTIONS 减为三个静态）；`index.ts` 注册；`prompt/sections/filesystem.md` 重写（三平面 + 默认指代 + {{kbRoot}}）、`skills.md` 产物落库条修订、sections README 标注动态渲染；`tests/prompt-sections.spec.ts` 增动态 filesystem 三个用例。
- `packages/api/yantao-kb-controller`：`promptInjection` 计价含渲染后的 filesystem。
- `packages/yantao/CONTEXT.md`：Resource 词条修订。
- dingdocs-pack（仓库外）：README 增资源落盘约定。
