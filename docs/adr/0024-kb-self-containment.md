---
status: accepted
---

# KB 自包含（yantao 数据以 KB 根为唯一归宿）

ADR-0021 决定 5 把能力元数据放在 `~/.dsh/yantao-kb.json`——KB 外面。盘点后确认这是
yantao **自有**的唯一的 KB 外文件（`packages/yantao/kb/src/root-store.ts`），里面装三样：
KB 指针（`root`）、能力状态（`capabilities.<name>.{state, lastRunAt}`，含 mail 水印）、
遗留 `connectors.mail`（只读兜底）。它还有个独立病灶：直接调 `os.homedir()`，绕过
`resolveDshHome()`，无视 `$DSH_HOME`。

重开的动因：三方技能接入（ADR-0025）要求"技能住在哪"有唯一答案；而工作台数据的可移植性
应当是"备份 = 拷目录"——KB 目录就是那个可移植单元。散落在机器侧的每一份 yantao 数据都是
这个承诺的漏洞。

决定：

1. **设计约束「KB 自包含」**：yantao 自有数据——技能、能力 sidecar、运行状态、artifacts、
   KB 自身的配置——以 KB 根为唯一归宿。程序本身（apps/yantao、packages）与指向 KB 的
   指针属机器侧，不算违反。边界划法与 Obsidian 等同类工具一致：数据进库，程序和门牌留在外面。

2. **废弃 `~/.dsh/yantao-kb.json`**：能力状态迁至 `<kbRoot>/.yantao/state.json`
   （artifacts、capability-backups 已在 `.yantao/` 邻居）。启动时一次性自动导入：新文件
   不存在且旧文件存在 → 读入能力状态 → 写新文件 → 旧文件**改名 `.bak`**（显式可恢复，
   不静默删除）。遗留 `connectors.mail` 水印不迁移——代价是最多重复拉一次邮件，可接受。
   `root-store.ts` 里绕过 `$DSH_HOME` 的 `homedir()` 直调随文件一起消灭。

3. **指针进 settings plane**：程序总得先找到 KB 才能读 KB 里的配置——这条线索无法自指，
   是机器侧数据的唯一合法实例。`kbRoot` 成为 `~/.dsh/settings.yaml` 里 yantao-kb 插件的
   普通配置字段；`setRoot` 改写 settings 而非自建文件。首启目录选择器（ADR-0012）行为
   不变，落点变了。解析优先级维持"显式配置 > 持久化值 > 默认 `~/yantao-kb`"的形状，
   只是持久化层换成了 settings。

4. **技能单一来源**：yantao 的整条管道——能力面板、采纳（ADR-0025）、`/xxx` 手势、
   资源右键匹配、agent 动态目录、`runByName`——只认 `resourceBase.path` 位于
   `<kbRoot>/.dsh/skills/` 下的技能。上游 `skill-filesystem` 照常发现所有根（项目根、
   `~/.dsh/skills`、`~/.agents/skills`），yantao 侧按路径过滤。上游机制是 dsh 的知识，
   过滤是 yantao 的知识。想用别处的技能？采纳动作本身就是拷贝进来。

5. **上游平面划为程序侧**：`~/.dsh/` 下的 sessions、attachments、storages、profiles、
   credentials、settings 是上游 dsh 的存储平面，被 CLI/headless 共用，本期不动。它们是
   约束的已知边界，不是违反——桌面壳（ADR-0016）再议会话记录等大体量数据的归属。

## 取舍台账——为控制牺牲的便利性

| # | 牺牲 | 换来 | 重开条件 |
|---|---|---|---|
| 1 | 多 KB 共存不支持（单指针） | 指针、状态、技能都只有一份，心智模型唯一 | 出现真实的多库需求时，指针升级为列表 + 活动库 |
| 2 | `~/.dsh/skills` 等全局技能对工作台不可见 | 单一事实来源；KB 拷走即全部带走 | 出现"跨 KB 共享技能库"需求时做同步/链接机制 |
| 3 | sessions/attachments 等不跟 KB 走 | 不分叉上游三个存储平面 | 桌面壳落地后若"整个工作台可移植"成为需求 |

原因：

- **为什么现在收敛**：ADR-0025 的采纳机制要把三方技能拷进 KB，如果状态还留在外面，
  "拷目录 = 完整备份"就是假话。地基先于房子。
- **为什么指针不进 KB**：自指问题——找到 KB 的那条线索不能藏在 KB 里。settings plane
  是现成的、有设置 UI 通道的持久化层，自建迷你指针文件只是把要废弃的东西换个名字。
- **为什么状态导入用改名而不是删除**：mail 水印丢了会重复拉邮件，状态丢了能力上下文清零；
  `.bak` 让迁移可回退，成本是一个文件名。
- **为什么技能过滤放在 yantao 侧而不是改上游发现**：上游根列表是 dsh 的知识（CLI 等用法
  依赖它），yantao 的"只要 KB 根"是 yantao 的知识——各管各的，不向上游索要配置缝。

后果：

- 修订 ADR-0021 决定 5：元数据从 `~/.dsh/yantao-kb.json` 改为 `<kbRoot>/.yantao/state.json`
  ——随实现同步改注记，不提前。
- `root-store.ts` 的读写全部改指新路径；旧路径仅导入时只读。
- `setRoot` RPC 的落点变化对 UI 透明（`root()` 返回形状不变）。
- 随实现同步：`docs/yantao/README.md` + `.zh.md` 的 ADR 索引、TODO、controller README 对。
- 未做：多 KB、上游平面 KB 化、`.bak` 的自动清理策略。
