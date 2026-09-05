# yantao 以插件形态重建于 dsh 之内

yantao 原为 Flutter 单机桌面工作台（ACP 接 codebuddy,PARA+P 知识库）。决定：放弃 Flutter，以 deepseek-harness 为底座重建——PARA+P 领域能力实现为 dsh 插件，工作台 UI 基于 dsh web 技术栈重做。原因：最大化复用 harness 底座的 session、插件、权限 hooks、调度能力，避免自维护 agent 基建；工作环境网络受限，agent 后端仍经 ACP 接本地 codebuddy。后果：Flutter 代码（d:/code/yantao）归档为只读参考；领域文档（CONTEXT/ADR/codewiki/模板）随插件迁入本 repo;UI 承载方式另录。
