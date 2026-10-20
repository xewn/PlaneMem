# ai-memory 外部组件适配记录

## 来源

- Repository: https://github.com/akitaonrails/ai-memory
- License: MIT
- 参考 tag：`v3.1.1`
- 实现前必须锁定不可变 commit 和镜像 digest；禁止生产使用 `latest`。

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
