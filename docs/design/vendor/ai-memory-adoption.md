# ai-memory 外部组件适配记录

## 来源

- Repository: https://github.com/akitaonrails/ai-memory
- License: MIT
- 参考 tag：`v3.1.1`
- 实现前必须锁定不可变 commit 和镜像 digest；禁止生产使用 `latest`。

## 版本与发布口径

| 口径 | 版本 | 适用范围 | 约束 |
|---|---|---|---|
| 上游参考版本 | `v3.1.1` | 能力确认、接口适配和设计评审 | 实现前重新确认 tag、commit、镜像 digest 和兼容性；当前 vendored checkout 可能位于该 tag 之后的提交，不能直接当作生产锁定值 |
| 最低兼容版本 | `3.0.0` | WorkMesh Adapter 的协议兼容下限 | 只代表客户端/Adapter 支持的最低服务版本，不代表生产应使用的镜像版本 |
| 当前离线夹具版本 | `3.0.0` | `tools/release-manifest-cli.mjs`、Compose 默认值和离线报告 | 用于可重复的本地测试；升级夹具时必须同步 release manifest、Compose、测试证据和兼容矩阵 |
| 生产锁定版本 | `v<release>@<immutable-commit>` | RC、预生产和生产 | 必须由发布审批填入具体 tag、commit、镜像 digest；未填写时不得通过发布门禁 |

因此，文档中的 `v3.1.1` 表示上游设计参考版本，部署和离线发布工具中的 `3.0.0` 表示当前兼容下限与夹具版本。两者不能互相替代；任何升级必须同时更新本表、[发布清单](../05-release/01-release-deployment-rollback.md)、Compose/Helm 配置、适配回归和 FILE_INDEX.md。

## 已确认能力

- 长期记忆源数据是 git-backed Markdown；SQLite 为派生索引；
- 捕获、整理、检索、交接是一条完整链路；
- Hooks 支持 session-start、user-prompt、pre/post-tool-use、pre/post-compaction、stop、session-end；
- SessionEnd 可以生成 session page 和 handoff；
- Handoff 支持 claim-once；
- MCP/HTTP 可供 WorkMesh Adapter 使用；
- 默认零 LLM；LLM、embedding、dream 为可选；
- 支持备份恢复和审计；
- Windows native 需单独验证，WSL2/Docker 是首期运行路径。

## 适配限制

- 不直接依赖内部 Rust 类型、SQLite 表或 wiki 文件布局；
- 不把 ai-memory 的记忆页面当作 Plane 工作项状态；
- 不让 ai-memory 绕过 WorkMesh Policy；
- 不能假设所有客户端有 SessionEnd，必须保留显式 finalize 入口；
- 上游升级必须重跑 capture/recall/handoff/claim/backup/restore 回归。

## P0 验证项

- `doctor` 身份和 capture owner；
- HTTP/MCP token 与作用域；
- hooks 的脱敏和 backpressure；
- duplicate/replay idempotency；
- session page、handoff 和 claim-once；
- recall 的 scope、FTS、entities、links 和 optional vectors；
- backup/restore 和 page version restore；
- Windows/WSL2/Docker 运行和故障恢复。
