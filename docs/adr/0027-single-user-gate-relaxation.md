---
status: accepted
---

# 单人项目的门禁降级（中文单语文档、pre-push typecheck 移除）

yantao 是单人使用的个人 fork（push 只到所有者自己的 remote，无 CI 消费门禁矩阵），但
沿用着上游为多人协作仓设计的文档纪律：每篇文档维护英中 twins + `.i18n.yaml` 配对记录、
每次改动重录、包 README 过 Model Experience 审计、push 前全仓 typecheck。合规成本
落在每一次文档触碰上，而收益（译文读者、CI 红绿）不存在。本 ADR 把门禁收敛到
"保护真东西"的子集。

决定：

1. **yantao 自有文档中文单语化**。中文内容入主文件名，删除 `.zh.md` twins、
   `.i18n.yaml` 记录与语言切换行：
   - 根 `README.md`、`docs/yantao/`（README / TODO / development）、六个 yantao 包
     （`packages/yantao`、`packages/yantao/kb`、`packages/api/yantao-kb-controller`、
     `packages/client/ui-yantao`、`packages/bundle/yantao`、
     `packages/bundle/yantao-web-app`）以中文为正；
   - `docs/subsystems/yantao.md` 反向保持**英文单语**（其 API surface 段由
     gen-cordis-catalog 生成，生成器产出英文）；
   - ADR 维持既定的中文单语（ADR-0006 以来的既定状态）。
2. **配对豁免目录化**。`scripts/translation-pairing.manifest.json` 的 26 条显式 ADR
   条目改为目录前缀（`docs/adr/`、`docs/yantao/`、上述包目录 + 根 `README.md` +
   `docs/subsystems/yantao.md`）——新文档零合规动作自动豁免。配对门继续全量管辖
   **上游**文档（1135 对）。
3. **model-experience 门摘除 yantao 包**。`verify-package-readme-model-experience.ts`
   新增 `PERSONAL_FORK_EXEMPT` 集合（五个被扫描的 yantao 包），上游包审计不变。
4. **pre-push 全仓 typecheck 移除**（`lefthook.yml`）。无页面文件机器上全仓 tsc 很重，
   且 push 目标是自己的 remote；提交前的质量信号由 yantao 三包测试 + `build:lib` +
   staged lint 承担。
5. **保持不变**：staged lint（oxlint `--fix`）、whitespace、vendor manifest 守卫、
   third-party notices 自动重生成、生成目录检查（gen-cordis-catalog 等——生成物是
   运行时依赖，不是文书）、全部测试。

后果：

- 涟漪已吸收：上游八个双语文件（`.agents/notes` 一篇、`docs/user/` 四篇、
  `packages/{api,bundle,client}/README` 三篇）的 zh 侧链接原指向 `README.zh.md`，
  已改指单语化后的 `README.md` 并重录配对——merge surface 增加八处一行链接改动。
- `lefthook.yml`、`scripts/verify-package-readme-model-experience.ts` 从此与上游有
  diff（两者上游都极少动）；`manifest.json` 本就是 yantao 维护的文件。
- 上游 en 侧文档深链根 README 的 `#run` / `#run-from-source` 锚点在旧英文 README
  时代就已悬空（无对应标题），单语化不引入新的锚点腐烂。
- `AGENTS.md`「Before you commit」与 `docs/yantao/development.md` 的纪律章节按本
  ADR 重写。
- 未做：上游文档的双语纪律不动；若 yantao 的文档将来需要给第二个人读，恢复配对
  的代价是重建 twins（git 历史里有最后一版英文）。
