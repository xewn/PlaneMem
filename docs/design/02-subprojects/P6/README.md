# P6 安全、治理与观测

## 目标

让身份、授权、数据分类、审批、审计和观测覆盖所有子项目。

## 依赖

P0

## 任务

T6.1, T6.2, T6.3。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

scope 模型、工具能力、数据分类、事件和 trace

## 输出

Keycloak、OPA、policy-service、audit-service、OTel dashboard

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 当前实现状态（2026-10-21）

| 任务 | 实现边界 | 公共产物 | 自动化验证 | 外部门禁 |
|---|---|---|---|---|
| T6.1 | `packages/auth` 分类与 Policy 类型、`apps/policy-service` 本地授权和 OPA REST allow/deny/fail-closed、Keycloak realm、OPA 默认拒绝策略 | `AuthContext`、`PolicyRequest`、`PolicyDecision`、`PolicyService.authorize/authorizeWithOpa/assertAuthorized` | `tests/p6/t6-security-observability.test.ts` 的 `P6-S01/P6-S04/T6.1`；`tests/contract/p6-security-contract.test.mjs`；OPA overlay decision log | RC 目标环境的 OPA 版本、网络、JWT 签发和生产策略仍需复核 |
| T6.2 | `AuditService` 记录、查询、导出记录、分类脱敏、幂等重放；runtime Gateway 允许/拒绝审计发射和 PostgreSQL 持久化；审计 sink 不可用返回可诊断 503；`007_audit.sql` 审计表和索引 | `AuditInput`、`AuditRecord`、`recordAudit/queryAudit/createExportRecord/redact`、runtime audit sink | `P6-S02/T6.2`、`tests/p6/t6-runtime-audit.test.ts`、`p6-identity-audit-live-current8`、三节点 `20261023T0005-wavemate-audit`；契约包边界测试 | RC 留存、导出对象存储、失败恢复和生产审计策略需继续验证 |
| T6.3 | `TraceContext/withSpan`、Metrics 高基数标签拒绝、HealthRegistry、Prometheus 配置和告警 runbook | `TraceContext`、`SpanRecord`、`MetricsRegistry`、`HealthRegistry` | `P6-S03/T6.3`；契约包边界测试 | OTel Collector/Prometheus/Grafana 连通性和告警触发需在部署环境验证 |

当前实现使用内存服务、固定 Fixture 和 test-only OPA Compose overlay 完成可重复的独立门禁；本地 runtime 已验证 OPA decision log、审计指标递增和 PostgreSQL 持久化。生产集成必须继续验证真实身份提供方、OPA、数据库、OTel Collector、留存/导出和密钥配置。Policy deny 必须在下游 handler 之前返回，Audit 记录必须包含 actor/client/session/scope/action/resource/result/classification/trace/source_refs，TraceContext 必须沿 Gateway、服务、事件和 worker 传递。

## 协接要求

向全部 P 提供 policy SDK、audit SDK、trace context 和安全门禁。

## 独立测试

租户隔离、过期 token、越权、拒绝无副作用、审计、脱敏、注入。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

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

- [T6.1 Keycloak、RBAC、OPA Policy](../tasks/t6.1-identity-policy.md)
- [T6.2 审计、数据分类、留存和导出](../tasks/t6.2-audit-governance.md)
- [T6.3 OpenTelemetry、Metrics、Logs 和告警](../tasks/t6.3-observability.md)

## 独立测试与校验规范

- [模块独立测试与校验](../../04-testing/modules/P6-independent-verification.md)
- [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P6)
- [模块契约测试矩阵](../../03-integration/05-module-contract-test-matrix.md)
