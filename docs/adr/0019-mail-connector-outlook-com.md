---
status: accepted
---

# 第一个连接器：Outlook 邮件（COM 子进程 + 人工确认后写库）

ADR-0010 里预留的 连接（Connector）只是描述，没有实现。这是它的第一个实例。

决定：

1. **读邮件走 Outlook 桌面版的 COM**，只在 Windows 上成立。实现方式是：把读取脚本
   （源自 `D:\code\mailp\read_outlook.py`，pywin32 + `Dispatch("Outlook.Application")`）
   **拷进仓库自己维护**，宿主用子进程 `spawn` 调用它，脚本以 JSON 输出到 stdout。
2. **不用 Node 的 COM 桥（`winax` 之类），也不用 Microsoft Graph + OAuth。**
3. 脚本相对原件扩展七处：
   - `--since <ISO>`：增量读取。**过滤在 Python 侧按 datetime 对象做**，不用
     `Restrict("[ReceivedTime] >= '…'")`——日期字面量在部分区域设置下会被 Outlook 误读。
   - 输出 JSON，不再落一堆 `.txt`。
   - 每条一个稳定 id：`sha1(时间|发件人地址|主题)`。MAPI 的 EntryID 跨 store 迁移会变，
     只能当副键。
   - **不输出 To/CC**：抄送名单对判断毫无帮助，却是最大的一块 PII。
   - `Body` 为空或过短时回落到 `HTMLBody` 做一次粗去标签。
   - 正文截断 3000 字（控 token，也防一封几万字的邮件吵死 LLM）。
   - 错误分类退出码（Outlook 未运行 / pywin32 缺失 / 找不到文件夹 / 其他）、超时、
     固定 UTF-8 编码。
4. **断点记在 `~/.dsh/yantao-kb.json` 的 `connectors.mail.lastReadAt`**，跟知识库根绑定。
   不写进知识库——知识库是给人看的 markdown，不该混进机器状态。
5. **范围**：默认只读收件箱；单次 50 封封顶（按时间倒序取最近 50，**页面填满就告诉界面「还有更多」**——
   精确总数要在 COM 上把文件夹里每一项都摸一遍，换不来等价的价值）；
   上次读取超过一个月就提示是否补跑——**既不静默跳过中间那段，也不自动补齐**。
   断点记在知识库根旁边，所以**没选过知识库目录时两个 RPC 都拒绝**（并不是"读不到邮件"，
   是"读到了也不知道该往哪儿记"）。
   会议邀请本版不纳入（`Class == 43` 的过滤保留）。
6. **分析跑在 dsh 的 session 里**：`session.create` → `session.prompt` → `session.follow`
   拿流式产出。该 session 自动命名「邮件分析 YYYY-MM-DD」并**保留**，可以点回去看
   agent 当时为什么这么判断。LLM 仍然是 `model-gateway`（ADR-0007）。
7. **送进 prompt 的只有截断后的正文，没有抄送。** session 日志会落盘（dsh 事件溯源），
   所以邮件正文会进 `session.vN.jsonl`——**已知且接受**：这是单机工具，日志在 `~/.dsh` 下，
   跟知识库是两回事。
8. **产出分三类，全部经人工确认之后才写库**：
   - 新人：逐条确认是否进 people，弹窗里给出"此人和我的关系"的判断供参考；
   - 命中的 project：确认后追加到该实体的 `流水` / `状态`；
   - 建议待办：确认后由界面写进 `todos.md`（ADR-0018）。
9. **一轮分析结束只弹一个汇总窗**，四块（新人 / 建议待办 / 项目动态 / 需手动留存的资源），
   每块内逐条勾选，支持全部忽略与全部接受。**默认一条都不勾选**——往知识库里写是这里唯一
   不能靠"再看一眼"撤销的动作。
10. 邮件**默认不落 Resource**；弹窗里给「存为 Resource」按钮，人挑中的才入库。

原因：

- **为什么 COM 而不是 Graph**：零认证——直接吃已登录 Outlook profile 的默认账号，
  不需要注册应用、不需要授权流程、不需要 token 存储。这是这套方案唯一的、也是压倒性的优势。
- **为什么是子进程而不是 Node 内做**：COM 的坑（Python 位数必须与 Office 位数一致、
  Outlook 没启动、程序化访问的安全弹窗、pywin32 崩溃）全被挡在 Node 进程之外；
  脚本崩了只是这次分析失败，不会拖垮工作台。Node 的 `winax` 是原生模块，
  在已经有 Electron 和一堆构建约束（ADR-0016）的仓库里再添一个原生依赖不划算。
- **为什么拷进仓库而不是引用 `D:\code\mailp`**：仓库外的个人脚本，路径和版本都不可控，
  而且它是一次性导出脚本，本来就要改。
- **为什么所有写库都在确认之后**：ADR-0004 写死了"禁止无值守自动写入"。
  语义判断可以交给模型，落笔必须过人——尤其是"把这个人加进 people"这种会长期留在
  知识库里的动作。
- **为什么保留 session**：这批判断（哪些邮件重要、谁该进 people、要不要形成待办）
  事后一定会想复查，尤其是判断错了的时候。一个可回看的 session 就是审计日志，
  成本只是一个列表条目。
- **为什么默认不落 Resource**：一次几十封，全落会把 `resources/` 淹掉。而"哪些邮件里有
  值得手动留存的资源"本来就是人的判断——弹窗那一块就是这个问题的答案。

后果：

- **新运行时依赖**：机器必须有 Python 3 + pywin32，且**解释器位数要与 Office 一致**
  （32 位 Python 配 64 位 Office 是经典故障）。缺失时给明确的安装指引，
  **不做降级方案**（不手抄邮件、不假装成功）。
- `yantaoKb` Remote 多两个方法 `mailFetch` / `mailMarkRead`。改 Remote 契约意味着
  必须跑 `pnpm run build:lib`（host → client）与 `pnpm run gen-cordis-catalog`。
- 状态文件从 `{ root }` 变成 `{ root, connectors: { mail: { lastReadAt } } }`；
  **只含 `root` 的旧文件必须照常读得出来**（换知识库等于换读取位置，这是有意的绑定）。
- 界面第一次主动驱动 agent：`session.create` / `prompt` / `follow` 这条链路在
  `packages/client` 里此前没有任何调用方，是我们新开的路。
- 未做：会议邀请的解析（时间/地点/与会人是另一套逻辑）、已发送邮件、多账号与多文件夹选择、
  定时自动分析、邮件的自动分类打标。
