# P8 统一发布、质量与私有化交付

## 目标

把所有子项目放进同一套构建、集成、部署、备份、回滚和上线流程。

## 依赖

P0 起，贯穿全部 P

## 任务

T8.1, T8.2, T8.3。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

所有镜像、Schema、迁移、测试、Feature Flags

## 输出

Compose、Helm、Release Manifest、CI/CD、Runbook、SBOM

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 当前实现状态（2026-10-22）

| 任务 | 实现边界 | 公共产物 | 自动化验证 | 外部门禁 |
|---|---|---|---|---|
| T8.1 | `apps/integration-orchestrator` 可复现步骤、公开边界链路、故障注入、trace/source_refs 报告，以及 WaveMate 0.24.1 MCP 真实探针 | `IntegrationReport`、scenario/fault contract、Plane→MCP runner、WaveMate MCP/UI probe/report | `P8-E01/T8.1`、`P8-E02/T8.1`、`P8-E05/T8.1`、`P8-E06/T8.2`、P8-E03/T8.2；P8 contract；实际 Projection→ContextPack→MCP、WaveMate discover/initialize/initialized/tools/call 通过 | 本地 Compose 与三节点 k3s 已执行签名 Plane Webhook→Projection→MCP JSON-RPC、重复事件/scope fence、资源读取和 WaveMate 0.24.1 MCP 握手及 WebDriver UI 工具调用；断网/重启、RC 依赖和生产性能仍需在 RC 环境执行 |
| T8.2 | `deploy/compose` 基础拓扑、`deploy/compose/docker-compose.local-test.yml` 固定 digest 覆盖、`deploy/helm/planemem` Chart、values schema、secret refs/readiness；manifest/可选 SBOM 生成入口 | Compose、Helm Chart、`values.schema.json`、Release Manifest、可选 CycloneDX SBOM | `P8-C01/T8.2`、`P8-C02/T8.2`（含 Helm 模板分隔符检查）；P8 contract；本地 Compose 10 服务集成证据 | 本地 Docker Compose 已完成健康、迁移、Plane、ai-memory、对象存储、Workctx API 和 RabbitMQ 恢复；`pnpm run test:memory-live` 已验证真实 ai-memory 写入/FTS/删除；本机和目标 k3s Helm lint/template/server dry-run 已通过；漏洞报告只保留历史信息，后续聚焦功能升级/回滚和生产门禁 |
| T8.3 | `packages/release` manifest/preflight、备份 hash、restore 校验、审批回滚计划；`deploy/release-manifest.yaml`、runbook 和 `rc:readiness` | `ReleaseManifest`、`BackupBundle`、`RollbackPlan`、Release Runbook、RC readiness report | `P8-C01/T8.2`、`P8-C03/T8.3`、`P8-R01/T8.3`、`P8-R02/T8.3`；P8 contract | Compose live 已实测 PostgreSQL 122 张 public 表、SQLite 2 行关闭重开、ai-memory 和对象存储归档恢复；安全修复 runtime 镜像 Trivy 扫描为 0 个漏洞，RC 节点恢复、恢复后业务 Smoke 和生产 smoke 仍需执行，报告见 `artifacts/command-reports/release-transport-sqlite/` 与 `artifacts/offline-images/security-fixed/` |

P8 将所有版本、digest、migration、Fixture、Plane/ai-memory 版本和 Feature Flag 固定在 Release Manifest。发布前必须完成 preflight；proposal/vector 默认关闭；回滚顺序固定为冻结写入、恢复备份、应用上一 manifest、重放 outbox、smoke、解冻写入。

## 协接要求

向生产提供一个可复现版本；任何未通过门禁的组件不能进入发布清单。

## 独立测试

集成/E2E、故障、性能、安全、备份恢复、升级回滚、生产 Smoke。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

## 进入集成条件

- 本子方案所有任务状态为 verified；
- 契约变更已更新 Schema/SDK/Fixtures/追踪矩阵；
- 独立测试报告已归档；
- 最新离线命令与证据校验归档在 `artifacts/test-reports/P8/20261021T233235/`；Plane→MCP 与会话连续性 fixture 的进程内公开边界报告分别在 `artifacts/command-reports/final-plane-to-mcp/` 和 `artifacts/command-reports/final-client-switch/`；WaveMate 0.24.1 真实 MCP 报告归档在 `artifacts/command-reports/wavemate-live-current/`、`artifacts/command-reports/wavemate-k3s-current/` 和 `artifacts/command-reports/wavemate-k3s-ui-retry1/`；三节点 k3s 当前现场归档在 `artifacts/test-reports/k3s/20261022T2038-wavemate-ui/`，保留第一次 UI 上游过载失败证据；本地 Compose 集成归档在 `artifacts/test-reports/compose/20261021T1440-compose-full-plane/`，包含 manifest、SBOM、环境、健康、trace 和失败用例证据；
- 迁移、配置、密钥、健康检查和回滚说明齐全；
- 集成负责人已确认输入输出版本。

## 退出条件

- 通过对应 PR/Merge/Nightly/RC 门禁；
- 产生可供下游使用的镜像或包、版本、契约和运行说明；
- 没有未记录的私有数据格式或跨库依赖。

## 任务文档

- [T8.1 集成、E2E、故障与性能测试编排](../tasks/t8.1-integration-e2e-resilience.md)
- [T8.2 Compose、Helm 与部署拓扑](../tasks/t8.2-compose-helm.md)
- [T8.3 Release Manifest、备份恢复与回滚](../tasks/t8.3-release-rollback.md)

## 独立测试与校验规范

- [模块独立测试与校验](../../04-testing/modules/P8-independent-verification.md)
- [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P8)
- [模块契约测试矩阵](../../03-integration/05-module-contract-test-matrix.md)
