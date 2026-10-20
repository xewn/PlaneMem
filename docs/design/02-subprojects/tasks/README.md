# 子任务设计索引

每个任务必须独立维护、独立测试，并按 `03-integration/01-task-handoff-contract.md` 交付。

## T0
- [T0.1 Monorepo、包管理与 CI 基线](t0.1-monorepo-ci.md)
- [T0.2 基础类型、错误、分页、幂等与版本契约](t0.2-foundation-contracts.md)
- [T0.3 核心实体 JSON Schema](t0.3-entity-schemas.md)
- [T0.4 Canonical Event 与 AsyncAPI](t0.4-event-schemas.md)
- [T0.5 SDK、Mock Server 与共享 Fixtures](t0.5-sdk-fixtures.md)
- [T0.6 Docker Compose 与迁移基线](t0.6-local-infra.md)
## T1
- [T1.1 Plane 版本与能力矩阵](t1.1-plane-version-matrix.md)
- [T1.2 Plane REST Client](t1.2-plane-rest-client.md)
- [T1.3 Webhook 验签与入口](t1.3-webhook-security.md)
- [T1.4 Webhook 去重、重试、死信与回放](t1.4-webhook-dedup-replay.md)
- [T1.5 Plane ID 映射与工作图谱投影](t1.5-plane-projection.md)
## T2
- [T2.1 Artifact、文件版本与对象存储](t2.1-artifact-metadata.md)
- [T2.2 ai-memory MemoryService Adapter](t2.2-memory-adapter.md)
- [T2.3 L0-L4 上下文层和 MemoryItem](t2.3-context-layers.md)
- [T2.4 ContextPack 编译器](t2.4-context-compiler.md)
- [T2.5 全文检索与 Context MCP Resource](t2.5-fts-resources.md)
## T3
- [T3.1 Session、AgentRun、ToolCall](t3.1-session-model.md)
- [T3.2 Checkpoint、Handoff、Resume](t3.2-checkpoint-handoff.md)
- [T3.3 SyncCursor 与事件批量同步](t3.3-sync-cursor-batch.md)
- [T3.4 SQLite Local Outbox 与 Context Bridge](t3.4-sqlite-outbox.md)
- [T3.5 ConflictDetected/Resolved](t3.5-conflict-service.md)
## T4
- [T4.1 REST API Gateway](t4.1-api-gateway.md)
- [T4.2 MCP Resources、Tools、Prompts](t4.2-mcp-gateway.md)
- [T4.3 workctx CLI](t4.3-workctx-cli.md)
- [T4.4 Codex/Claude Code/DeepSeek/WorkBuddy 适配](t4.4-client-adapters.md)
## T5
- [T5.1 工作台项目/工作项查询](t5.1-workbench-query.md)
- [T5.2 交接、Resume 与冲突中心](t5.2-workbench-handoff-conflict.md)
- [T5.3 工作台管理与运行健康](t5.3-workbench-admin.md)
## T6
- [T6.1 Keycloak、RBAC、OPA Policy](t6.1-identity-policy.md)
- [T6.2 审计、数据分类、留存和导出](t6.2-audit-governance.md)
- [T6.3 OpenTelemetry、Metrics、Logs 和告警](t6.3-observability.md)
## T7
- [T7.1 Golden Context Dataset 与评测](t7.1-golden-evaluation.md)
- [T7.2 智能抽取与建议 Worker](t7.2-intelligence-workers.md)
- [T7.3 FTS、实体、链接与可选向量检索](t7.3-search-vector.md)
## T8
- [T8.1 集成、E2E、故障与性能测试编排](t8.1-integration-e2e-resilience.md)
- [T8.2 Compose、Helm 与部署拓扑](t8.2-compose-helm.md)
- [T8.3 Release Manifest、备份恢复与回滚](t8.3-release-rollback.md)
