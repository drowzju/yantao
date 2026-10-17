# @deepseek-ai/dsh-yantao-dingtalk

钉钉 IM 通道插件：Stream 长连接入站（无公网端点），出站支持 AI 卡片流式 / markdown / 文本 /
asyncMode，含 🤔 首响应表情、逐会话串行队列、斜杠命令与审批卡片。

## 来源

收编自官方连接器 `@dingtalk-real-ai/dsh-dingtalk`（D:\code\dsh-dingtalk-main，commit 4979463
为其公司网络适配定稿版），并叠加以下公司网络适配（ADR-0060 决定 1）：

- `net.ts`：`proxyFetch` —— 出站 REST 统一经 `DINGTALK_STREAM_PROXY`/`HTTPS_PROXY` 走
  CONNECT 隧道，请求级 `rejectUnauthorized: false` 容忍公司 TLS-MITM 弱 CA。
- `stream.ts`：网关握手（getEndpoint）覆盖为原生 `node:https` 直连隧道（绕开 axios 自建
  tunneling agent 丢 TLS 选项的问题）；WS 升级注入代理 agent + 请求级
  `rejectUnauthorized: false`；心跳改为 SDK 同款 `socket.ping('', true)`；初始连接以
  `waitOpen` 实证替代 SDK 吞错的 `connect()` 返回值。
- `commands.ts`：未注册斜杠命令不再拦下，透传给模型按普通消息处理。

## 配置

schemastery schema 见 `src/config.ts`；凭据默认读环境变量
`DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET`（或经凭据引用），本包不落任何秘密。
多机器人（`accounts`）与数字员工（`digitalEmployees`）沿用上游 schema。

插入由 `packages/bundle/yantao/cordis.patch.yml` 完成（插件 id `dingtalk-channel`）；
工作区、owner 绑定等部署实例配置放用户层 profile patch，不进本仓。

## 提议推送（知会定位）

提议入队时向属主私聊推送一条 markdown 知会（ADR-0060 决定 7 ⑥，2026-10-17 用户裁决
两改后定稿）：**钉钉消息只做知会，不做手机端决策**——决策在工作台「提议」页完成。
但知会给足信息：逐动作的可读明细（邮件带主题与发件人、待办带标题与正文、动态带
目标与正文，超长截断），危险动作带警示行并指路工作台。

模板交互卡片（含危险动作的两击武装确认）保留为可选增强：需要在钉钉开放平台卡片平台
建模板（按钮动作标识必须 `approve`/`reject`；变量 title/detail/approveLabel/rejectLabel
必绑），把模板 ID 填进设置面板「互动卡片模板ID」或 `DINGTALK_INTERACTION_CARD_TEMPLATE_ID`。
本部署不建模板，markdown 知会即为常态形态。
