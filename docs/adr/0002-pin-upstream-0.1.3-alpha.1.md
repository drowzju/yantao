# 钉死上游版本 0.1.3-alpha.1

dsh 处于 developer preview，官方明示将有 breaking changes，上游约 4 周 4,680 次提交。决定：本地 main 分支钉在 master@d347e70390（0.1.3-alpha.1），不追 master；升级为刻意事件，逐版本评估后再合入。代价是错过上游修复与能力；换来的是自定义不被合并冲突拖垮。缓解：所有自定义只落在插件接缝与新增 app 内，不改核心源码。
