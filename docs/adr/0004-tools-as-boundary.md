# 信任边界：工具即边界

Entity 文件 = State（人类专属）+ 流水（agent 唯一可写、只追加）。决定：不向 agent 提供通用 fs 写能力，只提供专用 KB 工具（kb_append_log 只追加流水、kb_propose_refine 只产建议卡），使越界写入在结构上不可能。延续旧 yantao ADR-0004「禁止无值守写入」：提炼必须人触发、人批准。dsh 的 tools/pre-execute hook 作为纵深防御以后补，不作首选——hook 需理解 markdown 区段语义，复杂且易绕。开放点：KB 工具的载体（dsh 工具或 MCP server）随 agent 后端集成形态确定，原则与载体无关。
