# prompt/sections — yantao 的系统提示词叠加层

本目录是 yantao 叠加在 dsh 系统提示词之上的全部内容源（ADR-0022）。`packages/yantao/kb/src/sections.ts`
在插件初始化时读取这里的文件并注册为命名 section；**改文件 = 改提示词**，重启宿主即生效，无需重新构建。

| 文件 | section 名 | order | 职责 |
|---|---|---|---|
| `philosophy.md` | `yantao:philosophy` | 100 | 工作台理念：PARA+P、人机分工、信任边界、冷静决定 |
| `filesystem.md` | `yantao:filesystem` | 120 | 知识库文件组织：树结构、实体/资源/『状态』/『流水』语义 |
| `memory.md` | `yantao:memory` | 140 | 知识库使用纪律：先读不猜、流水追加时机、结论落库 |
| `skills.md` | `yantao:skills` | 160 | 能力使用纪律：何时调用、指令型语义、产物落库 |

注入位置：deployment persona（order 0）之后、dsh 的计划/工具 section（order 500+）之前，
阅读顺序为"身份 → 领域纪律 → 工具契约"。

约定：

- 工具 description 不放这里——它们是工具契约的一部分，跟工具代码走（ADR-0022 决定 5）。
- 能力清单**永不**写进这里的任何文件；能力目录由运行时动态注入（ADR-0023）。
- 本文件是中文-only 索引，已列入翻译配对豁免清单（ADR-0006 同待遇）。
