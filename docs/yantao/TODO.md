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

## next

1. **Initialize the real knowledge base** — confirm the root (`%USERPROFILE%/yantao-kb` by default), then run `kb_init` once so the
   tree shows `我自己` and the README.
2. **Three-pane skeleton** — left: resources + sessions; center: agent (default tab) with an editor tab; right:
   people / project / area. All data via `yantaoKb.tree/read/write`.
3. **Step the shared shell aside, one row at a time** — disable a single `ui-*` row, reboot, confirm the page still loads, repeat.
   `slots` is runtime infrastructure, not UI: it must stay until nothing needs it.
4. **Bring the two generated catalogs' Chinese sides along.** `docs/config-catalog.md` and `docs/capability-seams.md` were
   regenerated (our kb plugin and web-app entries were added) but their `.zh.md` twins were not, so both pairs are red: catalog
   wants 2 new sections + 2 TOC bullets + 3 list entries; capability-seams wants 2 table rows, a mermaid tweak, and one link.
   Patch the Chinese sides to match, then re-record with `pnpm run verify-translation-pairing --write <file>`. Their pairing
   records are deliberately left untouched until then.

## deferred (with reason)

| Item | Why parked |
|---|---|
| Resource intake watcher (drop a file → auto shadow note) | needs a watcher job; decide between dsh `jobs`/schedule and a plain watcher |
| Refine loop v1 (human triggers → agent proposes → human approves) | the real product value; needs the editor pane first, and a proposal UI |
| Session transcripts into `sessions/` | dsh already event-sources every session (`session.vN.jsonl`); this becomes a projection, not new machinery |
| FTS + backlinks index | needs a storage decision (drift/sqlite vs dsh `session-query`) once the KB has real content |
| *(moved to done)* — note: a per-package `tsc -b` **recreates** this residue | re-clean with the repo's own `pnpm run clean`, or `git clean -f -- packages` after checking `git clean -n -- packages` |
| Slimming the profile (fewer base rows) to cut the ~35s boot | measure first; only after the UI is ours |
| `docs/config-catalog.md` regenerated but its Chinese twin was not | generated page; its pairing check is red until the zh side is regenerated or the pair is exempted. Not staged with our doc work. |

## rules for this list

- Every deferred item keeps its **reason** — an item without a reason is not deferred, it is lost.
- Finishing an item means moving it into **done** with its test/verification note, not deleting it.
- New ideas that change architecture go to [docs/adr/](../adr/) first, then land here as work items.
