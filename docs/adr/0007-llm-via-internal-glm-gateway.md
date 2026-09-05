# LLM 走内网 GLM 网关，放弃 ACP/codebuddy 运行时

动机澄清（2026-09-05）：本项目是双目标——开发工作台 + 学习 dsh。公司内网 Model-Hub 提供 OpenAI 兼容 GLM 推理模型，当日实测：基本对话、SSE 流式（reasoning_content 增量）、tool_calls、node fetch TLS 全部通过。决定：运行时 LLM 来源 = 内网 GLM 网关，经 ctx.llm adapter 接入；放弃 codebuddy/ACP 运行时路径（codebuddy 保留为开发工具，不参与运行时）。后果：KB 工具载体 = dsh 原生工具，ADR-0004 的 MCP/fs-守卫候选取消；dsh session 事件日志原生覆盖会话落盘（任务 #6 接近免费）；agent loop / hooks / 权限 UI 全面进入 dsh 轨道——学习动机由此兑现。约束：密钥不得入库，走本地配置或环境变量。被否决的替代路线：回 Flutter 续命（纯产品视角最省，但与学习动机冲突）；codebuddy 经 ACP 当 LLM（agent 非模型，文本协议工具调用的脆弱性不可根治）。
