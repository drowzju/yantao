---
status: accepted
---

# 实体归档：启用既有 frontmatter 机制并补全，废弃实体删除入口

一条诉求（2026-09-30，grilling 对齐）：落实 PARA 的「A」——实体永不删除，只有归档；归档实体退出活跃（默认不被提炼、不被关联），但仍是可引用的知识资产，且随时可还原。

提案的初始形态是「移动路线」：归档 = 把实体文件从 `entities/` 移到 `resources/归档/`（保持类型结构），归档实体当资源引用。事实核查后该路线被否决，转向启用既有机制。

事实基础：

- **归档机制已存在**：`CONTEXT.md` 词汇表定义「Archive：Entity 的一种 frontmatter 状态标签，不是目录。_Avoid_: 归档目录」；frontmatter `archive: true` 已落地——`listEntities` 默认隐藏、`includeArchived` 可列出、`workspaceTree` 已携带 archived 标志（`kb/core.ts`）。
- **移动路线的代价**：`links.ts` 硬规则「链接只许指向 entities/」，实体移出后全库指向它的 `[[wiki链接]]` 解析为 null、阅读视图退回字面文本——成片静默死链；kb_edit_section/kb_write_state/kb_append_log 的 locator 只解析 entities/ 路径，归档实体失去 agent 全部写面；「归档」一词在邮件域已被 ADR-0037 占用（.eml 永久保真保存），语义与「退出活跃」相反，撞词。
- **「实体永不删除」与现状不符**：工作台右键「删除」走 `@Remote('deleteFile')`，是对实体文件的真 unlink（代码注释自承 "a real unlink and not an archive"）。
- **既有机制的缺口**：`linkGraphOf`/校验预扫（ADR-0035/0036）不过滤归档实体——归档项的失效双链仍出现在校验卡；UI 没有任何归档手势。

决定：

1. **路线**：放弃目录移动，启用既有 frontmatter `archive: true` 机制并补全缺口。`archive: true` 是归档的**单一权威信号**——不双写 `## 状态` 区段（双信号必漂移）。
2. **范围**：覆盖全部四类实体（projects/areas/people/meetings），UI 每个实体都长归档手势；todos.md 单例不归档（一次性任务行，无归档语义）。邮件本体链路（ADR-0034 删除 → COM 已删除、ADR-0037 归档 → .eml 保真）是两个域，不动。
3. **排除语义**：提炼维持现状（`listEntities` 默认隐藏，花名册天然排除）；关联/校验补缺口——`linkGraphOf` 过滤归档实体**节点连同其边**：归档项不当关联候选、不进校验卡、其外链不进图谱。指向归档实体的 `[[链接]]` **保留解析**——历史文档可读可跳转，「退出活跃」≠「从未存在」。
4. **可引用性**：人类指引下 agent 可读取归档实体（`includeArchived` / 直接读），「可作为输入被引用」由此满足，无需移动文件。
5. **写面非对称冻结**：agent 的 kb_edit_section / kb_write_state / kb_append_log 对归档实体拒绝，报「已归档，先还原」（防 agent 侧隐性漂移）；UI 人通道不受限（信任边界惯例：UI may edit anything）。
6. **归档与还原同机制两方向**：还原 = 去掉 frontmatter 标志，零成本可逆，v1 必带——没有还原的归档是删除的委婉说法，人会不敢归档。
7. **手势与呈现**：详情页归档/还原按钮（主）+ 树右键（快捷），走同一 RPC；KB 树在各类型节内底部出「归档」折叠分组，归档实体仍按类型组织（不跨类型混排）。
8. **废弃实体删除入口**：右键「删除」菜单去掉，`@Remote('deleteFile')` RPC 本体一并删除——留着人类通道的真 unlink 后门，「永不删除」就是空话；终极删除只能人在文件系统层动手（工作台管不到的层）。
9. **agent 只有提名权**：agent 无归档工具（信任边界不破，`kb/README.md` 「归档是人类对 frontmatter 的编辑」维持）；agent 可在回复/提案中纯文本建议归档，人类 UI 直达执行。
10. **留痕**：归档与还原各由宿主在实体「流水」区段追加一条（时间 + 方向），随实体走——归档历史也是实体自身的事实（ADR-0026 流水只追加、agent 不可写，天然是审计位）。

取舍台账：

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 归档实体不占 resources/ 平面，kb_read_resource 读不到它 | 链接不死、agent 写面可控、词汇表不冲突 | 出现「归档实体必须进能力脚本资源清单」的真需求时，单开引用通道 |
| 2 | 误建/测试实体失去工作台内的终极删除 | 「永不删除」无后门，归档可以被放心使用 | 误建泛滥到文件系统手工清理成为负担时，加二级确认的真删除 |
| 3 | 归档实体的 `## 状态` 文本可能写着「进行中」而过时 | 单一信号不漂移 | 人反映状态文本误导时，归档动作追加提示而非自动改写 |
| 4 | agent 对归档实体完全不能写（含流水追加） | 归档副本无隐性漂移 | 出现「归档实体也要追加事实」的场景时，评审是否先还原再改已够用 |

原因：

- **为什么否决移动路线**：它把 PARA 的「状态」误实现为「位置」。唯一独占收益（归档实体进 kb_read_resource 平面）是空的——agent 本来就能读 entities/ 下的实体；代价（全库静默死链、agent 写面丧失、词汇表明文规避、邮件域撞词）全是实的。既有 frontmatter 机制恰恰是「数据是事实、UI 是呈现」的机制化表达，与本次诉求同源。
- **为什么链接保留解析**：归档是「退出活跃」不是「从未存在」；历史会议纪要里的 [[某人]] 集体变灰的弊大于「死链预警」的利——失效预警是校验预扫的职责，而预扫排除归档项后自然不再报它。
- **为什么非对称冻结而不是全冻结**：UI 人通道历来 may edit anything，归档不是封印；要防的是 agent 在无人指引时写到一个从花名册里消失的实体，造成无人察觉的漂移。

后果：

- `packages/yantao/kb`：`core.ts` 三个写面（editSection/replaceState/appendLog）加归档检查（KbError「已归档，先还原」）；`links.ts` `linkGraphOf` 过滤归档实体节点连同其边。
- `packages/api/yantao-kb-controller`：删除 `deleteFile` RPC；新增归档/还原 RPC（翻 frontmatter 标志 + 流水追加）；`workspaceTree` 归档分组数据就位（archived 标志已有）。
- `packages/client/ui-yantao`：KB 树各节底部「归档」折叠分组；详情页归档/还原按钮；右键菜单「删除」替换为「归档」； locales 中英成对。
- 文档：`CONTEXT.md` Archive 词条扩写（排除边界、非对称冻结、提名权、留痕、删除入口废弃；"Avoid: 归档目录" 保留）；本 ADR 入索引。
- 测试：kb 层写面拒绝与图谱过滤、controller 层 RPC 与流水、UI 层手势与分组，随施工补齐。

## 落地注记（2026-10-01）

十项决定当日全部落地（83cf768c52，20 文件 +827/−187）。

- **kb**：`assertNotArchived` 接入 appendLog/writeState/editSection 三写面（KbError `entity-archived`「实体已归档，请先还原」）；`setEntityArchived` 以纯行拼接翻 frontmatter 标志（不重发 YAML、永不写 `archive: false`、陈旧 `archive:` 行原位替换），归档/还原各按 logBullet 格式向「流水」追加一条，幂等（目标状态即现状时不落盘不写流水），todos 单例以 `singleton-entity` 拒绝；`linkGraphOf` 过滤归档节点连同其边（未解析的 null 边保留），`linksOf` 阅读视图不动。新增 `tests/archive.spec.ts` 13 例。
- **controller**：`deleteFile` RPC 连同 `KbDeleteFileResult` 删除；`archiveEntity`/`restoreEntity` 双 RPC（入参 locator、返回 `{path, archived}`、KbError 按 not-found/rejected 惯例映射、details 只带 `{path}`）；typert 产物再生成。
- **ui-yantao**：右键「删除+二次确认」整块换为单项「归档/还原」（可逆故无确认，资源行无此项）；详情页 MarkdownView 栏加归档/还原按钮（仅 entities/ 四类实体路径，`frontmatterArchived()` 解析初值 + RPC 返回打 override）；KB 树各类型节底「归档（N）」折叠分组（session-only 折叠态）；locale 键中英成对（archive/restore/archiveGroup）；remotes 聚合层 `lib/client.js` 窄重建（ADR-0040 排障教训的既定动作）。
- **门禁连带修复**：`gen-cordis-catalog.ts` EXEMPTIONS 换 `KbDeleteFileResult → KbSetEntityArchivedResult` 并补齐 ADR-0040 遗留的 `KbPromptShortcut*`/`KbPromptInjectionResult`，`verify-cordis-catalog` 由红转绿（api-catalog.ts 与 docs/subsystems/yantao.md 生成区同步）。
- **验证**：kb/controller/ui-yantao 三包 vitest 883/883 全绿（其间修复 mail-analysis 标题断言的 UTC/本地跨零点 flake，f43b95b627）；三包 tsc -b 干净；oxlint 0/0；client bundle 与 frontend build 通过；CONTEXT.md Archive 词条同步扩写。
