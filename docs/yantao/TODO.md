# yantao TODO

English | [中文](TODO.zh.md)

Living backlog. Status words: **done** (merged on `main`), **next** (queued), **blocked** (queued but cannot run — see the
note), **deferred** (deliberately parked — see the note).

## done — the v0 skeleton

| Item | Where |
|---|---|
| `yantao` profile: model gateway route + Chinese persona + KB tools | `packages/bundle/yantao/` |
| Model gateway over `llm-pi-ai` (`model-gateway`, vendor-neutral) | `packages/bundle/yantao/cordis.patch.yml`, ADR-0007 |
| PARA+P domain plugin: six `kb_*` tools, State/Log trust boundary (33 tests) | `packages/yantao/kb/`, ADR-0004 |
| `yantaoKb` Typert Remote (`tree` / `read` / `write`) for the UI | `packages/api/yantao-kb-controller/` |
| Bespoke frontend served by dsh + our client plugin reaching `ctx.remote.yantaoKb` | `apps/yantao/`, `packages/client/ui-yantao/`, ADR-0009 |
| Run/stop scripts (persistent server, no timeout) | `scripts/yantao-web-{start,stop}.ps1` |
| Working tree cleaned: 297 generated files removed from `packages/*/src` | `.js` / `.d.ts` / `.map` left by per-package `tsc -b`; upstream tracks only `.ts`/`.tsx` there |
| Chinese catalog sides patched (`config-catalog.zh.md`, `capability-seams.zh.md`) + pairing re-recorded | `docs/config-catalog.zh.md`, `docs/capability-seams.zh.md`; yantao entries added to match English sides |
| `ui-yantao` added to client package map | `packages/client/README.md`, `README.zh.md` |
| ADR-0008 marked `status: superseded` in frontmatter | `docs/adr/0008-workbench-ui-as-bundle-plus-client-plugins.md` |
| Chinese-only yantao docs exempted from bilingual pairing | `scripts/translation-pairing.manifest.json` — ADRs + CONTEXT-MAP + CONTEXT.md added to excluded list |
| Domain model expanded: `meeting` + `todo` kinds | `packages/yantao/kb/src/types.ts` (`EntityType`, `ENTITY_DIRS`, `SINGLETON_FILES`), `paths.ts` (singleton `entityFilePath`, all five kinds in `normalizeEntityType` / locators), `templates.ts` (meeting + `todoFileContent` + the `KB_README` text) |
| `kb_init` creates `entities/meetings/` + `entities/todos.md` (idempotent); `kb_create_entity` accepts `meeting` and refuses the singleton | `packages/yantao/kb/src/core.ts`, `index.ts` (new `date` param for meetings) |
| `kb_write_state` — the seventh `kb_*` tool, rewriting `状态` through a `replaceStateSection` splicer; `kb_append_log` description no longer claims 状态 is human-only | `packages/yantao/kb/src/splice.ts`, `core.ts`, `index.ts`; ADR-0010 |
| KB tests 33 → 51: meeting template, todo singleton, `replaceStateSection`, `kb_write_state`, singleton listing | `packages/yantao/kb/tests/kb.spec.ts` |
| KB package README pair updated to seven tools and an agent-writable `状态` | `packages/yantao/kb/README.md`, `README.zh.md` (+ `.i18n.yaml` re-recorded) |
| `yantaoKb.tree()` split into `intakeTree()` (resources + meetings + todos) and `workspaceTree()` (projects + areas + people); the `sessions` section is gone | `packages/api/yantao-kb-controller/src/{index,types}.ts`; `entityDisplayPath` exported from `packages/yantao/kb/src/paths.ts` so the todo singleton resolves to `entities/todos.md` |
| Controller spec rewritten for the two trees (9 tests), Cordis API surface regenerated | `packages/api/yantao-kb-controller/tests/controller.spec.ts`, `docs/subsystems/yantao.md`, `packages/extensions/tool-cordis/src/api-catalog.ts` |
| Sidebar and spike probe follow the two RPCs; new section labels 会议 / 待办 | `packages/client/ui-yantao-kb/src/client/{service,KbTree,editor-state,locales}.ts(x)`, `packages/client/ui-yantao/src/client/index.ts` |
| Three-pane skeleton in `ui-yantao`: intake rail (资源/待办/会议/连接) + workspace rail (领域/人物/项目 tabs) over `intakeTree()` / `workspaceTree()`; click-through overlay so the middle column stays the host's agent surface | `packages/client/ui-yantao/src/client/{index,Workbench.tsx,remote.ts}` |
| `ui-yantao` client spec (3 tests) and a README pair that clears the two package gates | `packages/client/ui-yantao/tests/workbench.client.spec.tsx`, `README.md`, `README.zh.md` |
| First shared-shell row stepped aside: `ui-yantao-kb` removed from the yantao-web roster; catalogs regenerated | `packages/bundle/yantao-web-app/cordis.patch.yml`, `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| Workbench rails contributed through the host's own slots: `IntakeRail` registers into `sidebar` (the frame's drag handle sizes it, `toggleSidebar` collapses it), `WorkspaceRail` into `shell.overlay` (retractable); the body-level React root is gone |
| **The workbench frame is ours (ADR-0011)**: `ui-yantao` registers the runtime's built-in `root` slot with its own three-column frame, declares `conversation` + `shell.overlay`, and provides `ctx.layout` plus the theme presenter; `ui-layout` is out of the yantao-web roster and both rails are real grid columns — dragging and collapsing are symmetric again | `packages/client/ui-yantao/src/client/{index,Workbench.tsx,frame/*}`, `packages/bundle/yantao-web-app/cordis.patch.yml`, `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`, `docs/adr/0011-yantao-owns-the-workbench-frame.md` | `packages/client/ui-yantao/src/client/{index,Workbench.tsx,remote.ts}`, `tsconfig.base.json` (the missing `ui-yantao` alias), `packages/client/ui-yantao/tsconfig.json` (project references), `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` |
| **Docs synced to the current world**: the `CONTEXT.md` glossary (meeting / todo / connector, `状态` agent-writable, 会话 removed) and the architecture page's diagram + ADR index (seven `kb_*` tools, ADR-0010/0011/0012) | `packages/yantao/CONTEXT.md`, `docs/yantao/README.md` + `.zh.md` (`.i18n.yaml` re-recorded); commit `d2f088387b` |
| **`tsconfig.base.json` mappings for our own ids** — `dsh-client-ui-yantao` (+ `/client`) and `dsh-yantao-web-app/startup`; `verify-cordis-config` reports no yantao failure (the one it still reports, `apps/cli/tests/profiles/acp/cordis.yml`, is an upstream CLI fixture) | `tsconfig.base.json` |
| **`[[wiki links]]` and backlinks (ADR-0015)** — `[[名字]]` / `[[类型:名字]]` / `[[名字|显示名]]`, resolved only on a unique hit against the existing `type:name` rules and never into `resources/`; unresolved targets keep their brackets. A new `yantaoKb.links(path)` RPC returns `{ outgoing, incoming }`, computed host-side where the tree load already reads every file; resolved links render at the reserved `kb.invalid` host and the reading view intercepts the click, and a 反向链接 N panel lists what cites the file | `packages/yantao/kb/src/links.ts`, `packages/api/yantao-kb-controller/src/{index,types}.ts`, `packages/client/ui-yantao/src/client/{markdown.ts,remote.ts,editor/MarkdownView.tsx,frame/Frame.tsx}`, `docs/adr/0015-*` (19 new tests) |
| **Reading view v2 — clickable task checkboxes and a heading outline** — `MarkdownText` renders checkboxes disabled (and browsers do not dispatch clicks on disabled controls), so the view re-enables them and handles the click itself: the Nth rendered box is the Nth `- [ ]` line, and the flip is handed to the editor's one-command `patch()`, which saves through the same pre-save comparison as a keystroke; a conflict switches to the source view so its bar is not hidden. `大纲` lists the body's headings (fenced code skipped) and scrolls to one. Both ordinal mappings refuse when the counts disagree | `packages/client/ui-yantao/src/client/{markdown.ts,editor/MarkdownView.tsx,editor/FileEditor.tsx,frame/Frame.tsx}` (18 new tests) |
| **A file opens on its reading view (ADR-0014, v1)** — `.md` renders through `MarkdownText` by default with a 阅读 / 源码 switch on the tab strip; `splitFrontmatter()` folds the YAML envelope into a one-line summary that opens into a field table; the source editor stays mounted (hidden) and reports its draft, so both views share one load; non-md originals stay raw; the todo checklist is untouched | `packages/client/ui-yantao/src/client/{markdown.ts,editor/MarkdownView.tsx,editor/FileEditor.tsx,frame/CenterPane.tsx,frame/Frame.tsx}`, `docs/adr/0014-*` (20 new tests) |
| **Brand, working directory, and `@` mentions (ADR-0013)** — the middle column's working directory follows the KB root (`workspaces.create` + `uiWorkspace.startSession`, re-run after 首启/更改目录); the hero reads `PARAP`, shows our own mark through the `conversation.hero.brand.mark` slot, and drops its Preview badge; `@` lists KB entities grouped by section and a `agent/pre-step` expander resolves the inserted `@path` mentions into the cited files' content | `packages/client/ui-yantao/src/client/{index,kb-workspace,kb-reference}.ts`, `src/client/brand/YantaoMark.tsx`, `src/client/frame/frame.module.css`, `packages/yantao/kb/src/{index,mentions}.ts`, `docs/adr/0013-*` (12 new tests) |
| **One selection for both rails** — the centre pane's active file is the selection: each rail pulls forward the tab owning it (so the highlighted row is a visible one) and ignores a file the other rail owns; a row stays highlighted through tab switches and a restored tab finds its row | `packages/client/ui-yantao/src/client/{Workbench.tsx,frame/Frame.tsx}` (4 new tests: reveal, ignore, and follow-the-active-tab in `tests/workbench.client.spec.tsx`) |
| **The workbench can open, edit and create files (ADR-0012)**: centre-pane tabs (a permanent 对话 tab plus closeable file tabs, restored from localStorage), raw-markdown autosave with a pre-save conflict check, inline 「+ 新建」for meetings / areas / people / projects through `yantaoKb.createEntity`, dated meeting filenames, an inline 待办 checklist over `entities/todos.md`, read-only 资源, and a first-run directory picker persisted to `~/.dsh/yantao-kb.json` | `packages/client/ui-yantao/src/client/{frame/CenterPane,editor/*,TodoList,NewEntityRow,Onboarding,tabs}.tsx`, `packages/yantao/kb/src/{core,paths,root-store,index}.ts`, `packages/api/yantao-kb-controller/src/{index,types}.ts`, `docs/adr/0012-*` |
| **`ADR-0015` 的双链真正到达浏览器** — 之前只跑了 `build:lib:client`，把上一版没有 `links` 的契约内联进了 `packages/api/remotes/lib/client.js`，浏览器端 `ctx.remote.yantaoKb.links` 因此不存在，`[[…]]` 渲染成字面量方括号。按 `build:lib`（host 先生成 Typert face、client 再内联）重建并重启后生效 | 验证：Playwright 驱动系统 Edge 冒烟，`/api/yantaoKb/links` 返回 200 且 `outgoing`/`incoming` 正确，`[[我自己]]` 渲染成 `https://kb.invalid/…` 锚点，工具条出现 `反向链接 1`；截图 `.dsh-build/smoke.png` |
| **`pnpm run lint` 转绿** — 21 处 `toThrowError` → `toThrow`（消除 deprecation）；`unbound-method`：把 `Element.prototype.scrollIntoView` 的 mock 持有为变量再断言，不再从元素上读回方法 | `packages/yantao/kb/tests/kb.spec.ts`，`packages/client/ui-yantao/tests/markdown-view.client.spec.tsx`。验证：3153 文件、90 规则、`typeAware: true`（tsgolint 已启用）、0 warnings / 0 errors；yantao 三个包 214 个测试全通过 |
| **测试文件名补上 face 后缀** — `markdown.spec.ts` 没有后缀，被 `tsconfig.host.json` 的 `packages/*/*/tests/**/*.ts` 扫进 host 程序，而它 import 的 `src/client/markdown.ts` 属 client 面 → TS6307，host 构建直接失败 | 重命名为 `packages/client/ui-yantao/tests/markdown.client.spec.ts`（host 排除、client 包含）；`pnpm run build:lib` 与 `tsc -b tsconfig.client.json` 均通过 |
| **Obsidian 桥接（ADR-0017）** — `yantaoKb.revision()`（chokidar 常驻 watcher + debounce 计数器，随 `setRoot` 重建）与 `yantaoKb.openExternal(target)`（只接受 KB 内路径或 `obsidian:`/`vscode:`/http(s)/mailto: 白名单协议，并拒绝 shell 元字符）；UI 侧 3 秒轮询比对 revision、窗口 focus 也查一次 | `packages/api/yantao-kb-controller/src/{watch,open}.ts`；控制器测试 16 → 36。验证：234 个测试全通过、lint 0/0 |
| **链接图随内容变化重算** — `Frame.tsx` 里算 `linkGraph` 的 effect 依赖加上文件正文（350ms 防抖，`linksOf` 会重读全库算 `incoming`）。原先只有 `activePath`/`treeKey`，所以敲完 `[[…]]` 仍是字面量方括号，要切走再切回才生效 | `packages/client/ui-yantao/src/client/frame/Frame.tsx`；阅读视图工具条另有「在 Obsidian 中打开」按钮 |
| **Electron 桌面外壳（ADR-0016）** — `apps/yantao-desktop`：宿主作为**子进程**跑在系统 Node 上（`spawn` + `--expose-internals` + 从 stdout 抓 URL + `--port 0`），窗口先弹「正在启动」再加载，`file://` 不用（过不了 Origin 围栏），托盘「打开/重启宿主/退出」，不做热键/自启/签名/打包 | 验证：窗口 3.2 s 出现、`yantao: workbench ready` 于 26 s、宿主 stderr 干净（HMR 行加载成功）、**CLI 与桌面版同时可用**。原「同进程」方案已验证能跑但被废弃，原因见 ADR-0016：一个 `.node` 文件服务不了两个 Node（CLI 与桌面互斥）、重建件内网拿不到、同进程会丢 HMR。**子进程不提速**（CLI 22.6s / 同进程 22.2s / 子进程 26.1s），提速靠先弹窗口（22.2s → 3.2s） |

| **Shell clean-up** — Electron drops its default menu bar (`Menu.setApplicationMenu(null)`, and the DevTools entry goes with it) and both rails drop 刷新 / 更改目录; `setRoot` and the first-run `Onboarding` stay as a back door | `apps/yantao-desktop/src/main.ts`, `packages/client/ui-yantao/src/client/Workbench.tsx` |
| **待办 becomes a real board (ADR-0018)** — one host-side parser/serializer for `[due::]` / `[done::]` lines (preamble preserved, lossless round trip), `yantaoKb.todos` / `writeTodos` under optimistic concurrency (`expectedText`), and the 待办 tab as a TODO / DONE board: due ascending, undated last, overdue in red, DONE greyed, inline expand-to-edit, a trailing 「+」, per-row delete; 打开全文 still opens the file itself | `packages/yantao/kb/src/todo.ts`, `packages/api/yantao-kb-controller/src/{index,types}.ts`, `packages/client/ui-yantao/src/client/TodoBoard.tsx` (replaces `TodoList.tsx`) |
| **Mail connector: reading and the cursor (ADR-0019)** — `read_outlook.py` copied into `src/mail/` and extended (`--since` filtered on datetimes in Python, JSON out, `sha1(time\|sender\|subject)` id, no CC, 3000-char truncation, `HTMLBody` fallback, classified exit codes), spawned through a wrapper that turns every failure into a Chinese message plus its remedy; `mailFetch` (inbox only, 50-message page, 30-day default bound, `stale` / `hasMore` flags) and `mailMarkRead` move the `connectors.mail.lastReadAt` cursor, and both refuse before a KB root is chosen | `packages/api/yantao-kb-controller/src/mail/{fetch.ts,read_outlook.py}`, `packages/api/yantao-kb-controller/src/{index,types}.ts`, `packages/yantao/kb/src/root-store.ts` |

| **Mail analysis, end to end (ADR-0019)** — the 连接 tab reads Outlook through `mailFetch`, hands the batch to a real dsh session (`session.create` → `rename` 「邮件分析 YYYY-MM-DD」 → `prompt` → `follow`), and ends in one summary window with four blocks (新人 / 建议待办 / 项目动态 / 值得留存的资源) where **nothing is ticked to begin with**: a person becomes an entity, a todo joins the singleton under `expectedText`, a project note is appended to that entity's 流水, a chosen mail becomes a resource note — and the cursor only moves once a verdict has been dealt with | `packages/client/ui-yantao/src/client/{MailPanel,MailReview,mail-analysis,mail-apply}.tsx`, `packages/client/ui-yantao/src/client/{Workbench.tsx,frame/Frame.tsx,index.ts,remote.ts}` |

| **Reading projects & resource intake (ADR-0020)** — drag-and-drop onto the 资源 rail registers through `yantaoKb.registerResource` (`{ name, contentBase64 }`: pure copy, duplicate-refuse, per-file Chinese errors); right-click a resource row or the read-only banner → app-level dialog (book title + 「是否需要我读取书籍内容为你整理大纲？」) → a plain `project` entity with `source:` frontmatter; lazy py extraction (txt/md/pdf/epub/doc/docx/ppt/pptx) cached under `.yantao/extracts/` with explicit classified failures (`yantao-kb/extract`, no OCR in v1); the eighth tool `kb_read_resource` pages the extract by offset/chunk; the reading flow runs a real session (outline into 状态, process into 流水) and ends in a MailReview-style proposal card confirming `[[领域:…]]` links or a new domain | `packages/yantao/kb/src/{core,index,templates}.ts`, `packages/api/yantao-kb-controller/src/{index,types}.ts` + `src/extract/`, `packages/client/ui-yantao/src/client/{ReadingDialog,ReadingProposal,reading-flow}.tsx` + `{Workbench,remote,frame/Frame,editor/ReadOnlyFile}`, `docs/adr/0020-*`. 验证：kb + controller + ui-yantao 三包测试全绿（controller 92、ui-yantao 182），`build:lib` 与 client bundle 通过 |

| **Capability execution seam (ADR-0021 item 1)** — the nineteenth `yantaoKb` RPC `capabilityRun`: the controller resolves the capability through the dsh skill registry (`ctx.skills.get`), `resolveEntry` reads the `metadata.yantao` declaration (entry confined inside the skill directory, runtime, `appliesTo` suffixes), and `runCapability` spawns it (JSON stdin/stdout, UTF-8 pipes, timeout, classified failures with Chinese hints under the `yantao-kb/capability` RemoteError kind); artifacts land under `.yantao/capabilities/<name>/` and the state slots generalize to `capabilities.<name>.state` — the mail watermark moves there and legacy `connectors.mail` still reads, migrating on rewrite. No `kb_*` tool is added: capabilities stay human-invocable, execution happens pre-session | `packages/api/yantao-kb-controller/src/capability/run.ts` + `src/{index,types}.ts`, `packages/yantao/kb/src/root-store.ts`, `packages/bundle/yantao-web-app/cordis.patch.yml` (`skill-filesystem` stays enabled, `tool-skill` stays disabled). 验证：三包 428 测试全绿（`capability-rpc.spec.ts` 10 个），`build:lib` host+client 通过（tsdown 需 `NODE_OPTIONS=--max-old-space-size=4096`，默认堆 ~2.4GB 在无页面文件机器上 OOM），`verify-cordis-catalog` 与 `verify-translation-pairing` 通过 |

| **Capability migration + management RPCs + 能力 tab (ADR-0021 items 2+3)** — mail/ebook become builtin capability directories seeded into `<kbRoot>/.dsh/skills/` (`ensureBuiltinCapabilities`, version-checked against the master `metadata.yantao.version`); the controller mounts one `FileSystemSkillProvider` over the persisted `capabilityDirs` and retires `mailFetch` / `extractResource` — the UI's mail read and the reading flow's extract both travel through `capabilityRun`; three RPCs join the surface (`capabilityList` / `capabilityRegisterDir` / `capabilityCreate`, twentieth overall), and the connector tab becomes the 能力 tab: a list + detail two-state panel where 「添加目录」 picks and registers a directory and 「新建能力」 scaffolds SKILL.md + entry.py under `.dsh/skills/<name>/`; the mail capability's detail embeds MailPanel unchanged | `packages/api/yantao-kb-controller/src/{index,types}.ts` + `src/capability/builtin*`, `packages/yantao/kb/src/root-store.ts`, `packages/client/ui-yantao/src/client/{CapabilityPanel,Workbench,remote,MailPanel}.tsx` + `frame/Frame.tsx` + `index.ts`, `scripts/gen-cordis-catalog.ts`. 验证：controller 84 + kb 128 + ui-yantao 202 测试全绿，`build:lib:host`、`typecheck:contracts-ready`、client bundle、scoped oxlint、`verify-cordis-catalog`、translation pairing 通过 |

## next

### Phase 2 — three-pane UI (ADR-0010)

1. **Finish `ui-yantao-kb`'s fate** — it is out of the roster now, so either port `KbEditor`'s markdown editing into the panes
   (below) and delete the package, or keep it as a composable package. Do not leave a mounted-but-unused package behind.
2. **Step the shared shell aside, one row at a time** — disable a single `ui-*` row, reboot, confirm the page still loads, repeat.
   `slots` is runtime infrastructure, not UI: it must stay until nothing needs it. `ui-layout` already stepped aside (ADR-0011);
   the remaining big ones are `ui-conversation` and `ui-chat`. Only when the shell is gone can the middle column become ours
   and host agent interaction.
3. **Give the workbench its own dictionary** — labels are hardcoded Chinese in `Workbench.tsx`; register a locale namespace
   when the panes grow past a handful of strings.
4. **Reading view v4 — Mermaid and local images** — both are paywalled: client bundles are single-file CJS, so mermaid inlines at
   ~3.5MB (or needs a host module-table change), and local images need a new RPC plus a host route because `read()` is utf8 and
   would corrupt binaries. Only worth it once a KB file actually contains one.
5. **启动耗时分段测量** — 冷启动约 22–26 秒，但未拆过段。已知不等于结论的两点：慢的是 dsh 的
   profile boot（与同进程/子进程无关：CLI 22.6s、同进程 22.2s、子进程 26.1s）。
   下一步：在宿主启动时打时间戳，分清 **tsx 现转译** 与 **cordis 逐行挂载插件** 各占多少；
   转译占大头就预编译宿主为 JS，挂载占大头就瘦身 profile（见 deferred 那条「~35s boot」）。
   **先量再动。**

### Capability system (ADR-0021)

1. **Proposal card generalization** — a unified proposal schema (five actions: create entity / append log /
   write state / save resource / create link, each with a reason field), MailReview generalized into a
   generic proposal card; the reading-flow closing proposal merges into it.
2. **Apply entry points** — resource right-click (by extension) and entity panels (by type) filtered by
   `appliesTo`; drag-in never prompts.

## blocked (with reason)

_None. (The three items that sat here — the client-face rebuild, `tsgolint`, and the `toThrowError` rename — all cleared on
2026-09-09: the OOM premise no longer held, memory was at 65%, and `pnpm run build:lib` + `pnpm run lint` both pass.)_

## deferred (with reason)

| Item | Why parked |
|---|---|
| Refine loop v1 (human triggers → agent proposes → human approves) | the real product value; needs the editor pane first, and a proposal UI |
| Session transcripts into `sessions/` | dsh already event-sources every session (`session.vN.jsonl`); this becomes a projection, not new machinery — **also: 会话功能已移除 (ADR-0010), 待重新设计后再启** |
| FTS + backlinks index | needs a storage decision (drift/sqlite vs dsh `session-query`) once the KB has real content |
| *(moved to next)* Connector implementation → capability system (ADR-0021) | the connector concept is superseded by capabilities; mail is done, the remaining work sits in the「能力系统」section under next |
| *(moved to done)* — note: a per-package `tsc -b` **recreates** this residue | re-clean with the repo's own `pnpm run clean`, or `git clean -f -- packages` after checking `git clean -n -- packages` |
| Owning the middle column too (the L3 step in ADR-0011) | the conversation surface is ~23k lines upstream (ui-conversation + ui-chat + ui-tool); no product reason to rewrite it while the middle is still a chat transcript. Revisit if the middle becomes a KB document view. |
| Slimming the profile (fewer base rows) to cut the ~35s boot | measure first; only after the UI is ours |

## rules for this list

- Every deferred item keeps its **reason** — an item without a reason is not deferred, it is lost.
- Finishing an item means moving it into **done** with its test/verification note, not deleting it.
- New ideas that change architecture go to [docs/adr/](../adr/) first, then land here as work items.
