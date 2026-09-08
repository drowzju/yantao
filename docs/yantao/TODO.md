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

## next

### Phase 2 — three-pane UI (ADR-0010)

1. **Finish `ui-yantao-kb`'s fate** — it is out of the roster now, so either port `KbEditor`'s markdown editing into the panes
   (below) and delete the package, or keep it as a composable package. Do not leave a mounted-but-unused package behind.
2. **Detail pane with `read` / `write`** — selecting a row in either rail loads the file and lets the human edit it. This is
   what `ui-yantao-kb`'s editor did; until it lands, the workbench lists files but cannot open them.
3. **Step the shared shell aside, one row at a time** — disable a single `ui-*` row, reboot, confirm the page still loads, repeat.
   `slots` is runtime infrastructure, not UI: it must stay until nothing needs it. Only when the shell is gone can the middle
   column become ours and host agent interaction.
4. **Give the workbench its own dictionary** — labels are hardcoded Chinese in `Workbench.tsx`; register a locale namespace
   when the panes grow past a handful of strings.

### Phase 3 — docs sync

5. **Update `packages/yantao/CONTEXT.md`** — add meeting, todo, connector glossary entries; revise `状态` definition to
   "agent 可编辑"; remove `会话` entry (功能移除).
6. **Update `docs/yantao/README.md`** — architecture diagram and ADR index to reflect ADR-0010; it still says the agent gets six
   `kb_*` tools.
7. **Run `pnpm run gen-tsconfig-paths`** — the last pre-existing gate failure: `verify-cordis-config` reports two ids in
   `packages/bundle/yantao-web-app/cordis.patch.yml` without a `tsconfig.base.json` mapping. (The other two failures — the
   `ui-yantao` README gates — are cleared.)

## deferred (with reason)

| Item | Why parked |
|---|---|
| Resource intake watcher (drop a file → auto shadow note) | needs a watcher job; decide between dsh `jobs`/schedule and a plain watcher |
| Refine loop v1 (human triggers → agent proposes → human approves) | the real product value; needs the editor pane first, and a proposal UI |
| Session transcripts into `sessions/` | dsh already event-sources every session (`session.vN.jsonl`); this becomes a projection, not new machinery — **also: 会话功能已移除 (ADR-0010), 待重新设计后再启** |
| FTS + backlinks index | needs a storage decision (drift/sqlite vs dsh `session-query`) once the KB has real content |
| Connector implementation (mail, scripts, CLI) | ADR-0010 describes the abstraction; concrete implementation deferred until mail integration is needed |
| *(moved to done)* — note: a per-package `tsc -b` **recreates** this residue | re-clean with the repo's own `pnpm run clean`, or `git clean -f -- packages` after checking `git clean -n -- packages` |
| Slimming the profile (fewer base rows) to cut the ~35s boot | measure first; only after the UI is ours |

## rules for this list

- Every deferred item keeps its **reason** — an item without a reason is not deferred, it is lost.
- Finishing an item means moving it into **done** with its test/verification note, not deleting it.
- New ideas that change architecture go to [docs/adr/](../adr/) first, then land here as work items.
