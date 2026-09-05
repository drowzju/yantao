# 知识库存储格式全盘沿用旧 yantao

决定：KB 根目录下维持 resources/ + entities/ + sessions/ 三目录；实体为 markdown + frontmatter(State/流水 区段）;Resource 配同名影子笔记；根目录默认 `%USERPROFILE%/yantao-kb`，应用设置可改。不采用 dsh 的 storage/session-query 作为主存储。原因：这套纯文件格式是领域资产——人可读、git 可管、agent 可解析，且旧项目的模板与信任边界语义（ADR-0004）都长在它上面；换存储引擎等于重写领域层且无对应收益。代价：FTS 索引/backlinks 需自建（任务 #7 另行评估 dsh 组件可否借力）。
