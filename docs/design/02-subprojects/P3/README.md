# P3 会话、检查点、交接与离线同步

## 目标

提供 Session、Checkpoint、Handoff、Resume、Outbox、游标和冲突解决。

## 依赖

P0、P2 最小 ContextPack

## 任务

T3.1, T3.2, T3.3, T3.4, T3.5。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

P0 Event、P2 ContextPack/MemoryRef、客户端能力

## 输出

session-service、sync-service、context-bridge、workctx CLI、Conflict

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 协接要求

向 P4/P5/P8 提供 Session/Handoff/Conflict API 和集成 Fixtures；所有写入具备幂等和版本。

## 独立测试

断网/重启/崩溃、重复上传、游标缺口、并发、claim-once。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

## 进入集成条件

- 本子方案所有任务状态为 verified；
- 契约变更已更新 Schema/SDK/Fixtures/追踪矩阵；
- 独立测试报告已归档；
- 迁移、配置、密钥、健康检查和回滚说明齐全；
- 集成负责人已确认输入输出版本。

## 退出条件

- 通过对应 PR/Merge/Nightly/RC 门禁；
- 产生可供下游使用的镜像或包、版本、契约和运行说明；
- 没有未记录的私有数据格式或跨库依赖。

## 任务文档

- [T3.1 Session、AgentRun、ToolCall](../tasks/t3.1-session-model.md)
- [T3.2 Checkpoint、Handoff、Resume](../tasks/t3.2-checkpoint-handoff.md)
- [T3.3 SyncCursor 与事件批量同步](../tasks/t3.3-sync-cursor-batch.md)
- [T3.4 SQLite Local Outbox 与 Context Bridge](../tasks/t3.4-sqlite-outbox.md)
- [T3.5 ConflictDetected/Resolved](../tasks/t3.5-conflict-service.md)

## 独立测试与校验规范

- [模块独立测试与校验](../../04-testing/modules/P3-independent-verification.md)
- [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P3)
- [模块契约测试矩阵](../../03-integration/05-module-contract-test-matrix.md)

## 当前实现状态

| 任务 | 实现边界 | 独立验证 | 外部门禁 |
|---|---|---|---|
| T3.1 | `apps/session-service/src/session`、`004_sessions.sql` | lifecycle、幂等 start、父子 scope、版本冲突 | PostgreSQL replay |
| T3.2 | `apps/session-service/src/checkpoint` | checkpoint hash、claim-once、target client、resume | P2 ContextPack/ai-memory live |
| T3.3 | `apps/sync-service/src/cursor`、`005_sync.sql` | cursor gap、partial batch、duplicate batch、ack monotonic | 多客户端长连接 |
| T3.4 | `apps/context-bridge/src/outbox`、`006_outbox.sql` | SQLite durable write、断网 retry、drain 幂等、inspect/purge | 真实进程 kill/restart |
| T3.5 | `apps/sync-service/src/conflict` | detect/list/resolve、protected version、resolution event | P4/P5 conflict UI/API |

自动化入口为 `pnpm run test:module -- P3 --isolated` 和 `pnpm run test:contract -- P3`；
实现使用 Node 24 `node:sqlite`，独立报告仍必须单独标记真实 PostgreSQL、客户端并发和进程恢复门禁。
