# 信任边界：工具即边界

> **修订（2026-09-07，ADR-0010）：** `状态` 区段不再对 agent 不可写。agent 现在可以编辑 `状态`。信任边界仍由工具集保证——agent 只能通过 `kb_*` 工具写文件，不能绕过工具直接 `fs.writeFile`。区段级写限制取消，工具级限制保留。`流水` 仍只追加。

Entity 文件 = State（agent 可写）+ 流水（agent 可写、只追加）。决定：不向 agent 提供通用 fs 写能力，只提供专用 KB 工具（`kb_*` 系列），使越界写入在结构上不可能——agent 无法绕过工具直接写文件。工具集是边界，不是区段。dsh 的 tools/pre-execute hook 作为纵深防御以后补，不作首选。开放点：KB 工具的载体（dsh 工具或 MCP server）随 agent 后端集成形态确定，原则与载体无关。

补充（2026-09-05，任务 #2/#3 实施）：载体 = dsh 原生工具（LLM 改走内网 GLM 网关后，见 ADR-0007）。执行点随界面形态不同——headless profile 在 bundle 层禁用 model-facing 写工具行（tool-bash / tool-pwsh / tool-str-replace-editor）；web 界面的工具集按 agent preset 发放，故出厂 preset `yantao`（无写工具行，agent 仅有 host 面 kb_ 工具）并设为默认。用户手动切换 preset 视为人类的知情本地行为（与权限批准同类）：边界是默认姿态，不是牢笼。
