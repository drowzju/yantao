# Spec：实体校验 v2（validate 回归纯体检）

- **设计裁定**：[ADR-0036](../../docs/adr/0036-entity-validation-v2-pure-diagnosis.md)（取代 ADR-0035 决定 3/4）
- **背景与对照**：[analysis.md](analysis.md)（llm_wiki 对照）
- **范围**：`packages/client/ui-yantao` 的 validate 管线重构。零新 RPC、零上游文件改动、`kb_*` 工具保持十一。

## 目标管线

```
graph() → preScanOf（纯代码）
   ├─ 确定性区块直出上卡（孤儿/失链 + 代码失链修复候选）
   └─ 诊断调用（窄职责）：预扫清单附送（声明勿复述）+ 花名册 + 点名实体全文(8k)
        → JSON verdict（findings + targets.links + questions；creates/todos 移除）
        → 防御核验（subject/entity/to 对花名册与图，解析不到即弃）
        → 模型区块上卡 → 人批 → 代码执行
```

## 验收标准（整体）

1. `ValidateVerdict` 不再有 `creates`/`todos` 字段；prompt 不再要求模型产新页。
2. 预扫结果不依赖模型即完整出现在卡上（确定性区块）。
3. 模型 findings 引用花名册外的实体名/链时被代码丢弃，不出现在卡上。
4. 诊断 prompt 只含三个语义维度（过期/矛盾/缺链机会），规则逐条硬编码。
5. 提议卡确定性/模型两区块视觉分离，不混排。
6. 既有测试全绿：`pnpm vitest run packages/client/ui-yantao`。

## 票一览

| # | 票 | 依赖 |
|---|---|---|
| 01 | [协议瘦身与诊断 prompt 重写](issues/01-diagnostic-protocol.md) | — |
| 02 | [防御核验层](issues/02-defensive-verification.md) | 01 |
| 03 | [失链修复候选（确定性代码修复）](issues/03-broken-link-fix-candidates.md) | 01 |
| 04 | [提议卡双区块渲染](issues/04-card-two-blocks.md) | 01 |
| 05 | [收尾：测试、台账、bundle](issues/05-closeout.md) | 01–04 |
