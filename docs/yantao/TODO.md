# yantao TODO

English | [中文](TODO.zh.md)

Living backlog. Status words: **done** (merged on `main`), **next** (queued), **deferred** (deliberately parked — see the note).

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

## deferred (with reason)

| Item | Why parked |
|---|---|
| Resource intake watcher (drop a file → auto shadow note) | needs a watcher job; decide between dsh `jobs`/schedule and a plain watcher |
| Refine loop v1 (human triggers → agent proposes → human approves) | the real product value; needs the editor pane first, and a proposal UI |
| Session transcripts into `sessions/` | dsh already event-sources every session (`session.vN.jsonl`); this becomes a projection, not new machinery — **also: 会话功能已移除 (ADR-0010), 待重新设计后再启** |
| FTS + backlinks index | needs a storage decision (drift/sqlite vs dsh `session-query`) once the KB has real content |
| Connector implementation (mail, scripts, CLI) | ADR-0010 describes the abstraction; concrete implementation deferred until mail integration is needed |
| *(moved to done)* — note: a per-package `tsc -b` **recreates** this residue | re-clean with the repo's own `pnpm run clean`, or `git clean -f -- packages` after checking `git clean -n -- packages` |
| Owning the middle column too (the L3 step in ADR-0011) | the conversation surface is ~23k lines upstream (ui-conversation + ui-chat + ui-tool); no product reason to rewrite it while the middle is still a chat transcript. Revisit if the middle becomes a KB document view. |
| Slimming the profile (fewer base rows) to cut the ~35s boot | measure first; only after the UI is ours |

## rules for this list

- Every deferred item keeps its **reason** — an item without a reason is not deferred, it is lost.
- Finishing an item means moving it into **done** with its test/verification note, not deleting it.
- New ideas that change architecture go to [docs/adr/](../adr/) first, then land here as work items.
