# 依赖镜像漏洞修复与升级验证（冻结记录）

本文件保留此前发布拓扑中外部依赖镜像的版本选择、离线缓存、漏洞扫描和回归记录。自 2026-10-23 起，该流程冻结，不再创建镜像升级、漏洞修复、豁免审批或重复扫描任务；后续以[功能验收范围调整](07-functional-acceptance-scope.md)为准。

## 当前基线

历史扫描器为 Trivy 0.58.1，策略为 `CRITICAL,HIGH` 且 `ignore-unfixed=true`。最后一次完整拓扑报告是 [`p8-vulnerability-scan-command-current16`](../../../artifacts/command-reports/p8-vulnerability-scan-command-current16/)，逐镜像聚合为 [`remediation.json`](../../../artifacts/command-reports/p8-vulnerability-scan-command-current16/remediation.json)。这些报告只作环境记录，不再生成发布阻断项。

此前执行过的候选评估如下，表格仅用于追溯：

| 组件 | 原版本/结果 | 候选版本与 digest | 候选扫描结果 | 决策 |
|---|---|---|---:|---|
| PostgreSQL | `16.4-alpine`，89（7 critical/82 high） | `16.15-alpine3.24@sha256:f4610795587492cd4fb887c2dc3de301b813278bb6f616992061141b5f15ac36` | 26（1/25） | 已纳入本地拓扑，保持现状 |
| RabbitMQ | `3.13-management-alpine`，69（2/67） | `4.4.0-management-alpine@sha256:0452ee3fd3b9a74160b251e693338616b464f22df4d4ba43304c101bebdca292` | 0 | 已纳入本地拓扑，功能回归通过 |
| NATS | `2.10.22-alpine`，61（3/58） | `2.15.1-alpine3.22@sha256:7ae34c25dfd6fe2e01c6483eabef20d796690fdcac6c4d94ca780a6cf9877fde` | 1（0/1） | 不再纳入，保持现有功能拓扑 |
| Redis | `7.4.1-alpine`，81（6/75） | `7.4.7-alpine@sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf` | 77（6/71） | 不再纳入，保持现有功能拓扑 |
| Keycloak | `26.0.5`，99（7/92） | `26.5.7@sha256:45ae20191531eb608ddb0b775d012b40d3e4f942697f3214694887dd7c108d13` | 72（7/65） | 不再纳入，保持现有身份回归基线 |
| Plane | `v0.26.0`，82（7/75） | `v0.26.1@sha256:3d6ffbe19a83c09d580aed6ddf05ac1d84c35843f75501ee1edb154115e91be8` | 74（6/68） | 不再纳入，保持现有 API/migration 基线 |
| OTel Collector | `0.107.0`，84（7/77） | `0.138.0@sha256:4a951ff0a9772f4fa8e9c7a326434370301b98b2b813933468dcb54aa6a6b5e5` | 75（7/68） | 不再纳入，保持现有 receiver/exporter 基线 |

候选原始报告分别位于 `artifacts/command-reports/vuln-candidate-*/`。这些报告不再参与发布判定；功能发布仍必须通过 Compose 业务探针、离线归档 hash、k3s 导入一致性、恢复和 Smoke。

## 已纳入的本地拓扑变更（保持现状）

- `deploy/compose/docker-compose.yml` 默认 PostgreSQL 改为 `16.15-alpine3.24`；生产部署仍必须通过 Release Manifest 或环境变量提供不可变 digest。
- `deploy/compose/docker-compose.local-test.yml` 将 RabbitMQ 固定为 `4.4.0-management-alpine` 及其 digest；该覆盖层仅用于本地集成测试，不改变生产镜像来源。
- 变更后的功能证据包括 `docker compose ... config --quiet`、10 服务健康检查、Plane/Workctx/MCP 业务探针、依赖矩阵、业务恢复、备份恢复和 `FILE_INDEX.md` 更新；不再要求 Trivy 全量扫描。

## 后续冻结规则

1. 不再新增漏洞候选、漏洞修复、镜像升级或豁免审批任务。
2. 保持 PostgreSQL 16.15 和 RabbitMQ 4.4.0 的现有功能回归证据；其他镜像保持当前版本，除非功能故障另行要求变更。
3. 后续只执行功能相关的 Compose、恢复、k3s、WaveMate、性能和生产 Smoke 验证。
4. Release Manifest 可记录版本、digest 和可选 SBOM；漏洞数量不改变功能验收状态。

## 当前状态

PostgreSQL/RabbitMQ 已落入本地 Compose 配置，并在 [`release-live-dependency-upgrade-current14`](../../../artifacts/command-reports/release-live-dependency-upgrade-current14/)、[`resilience-business-dependency-upgrade-current14`](../../../artifacts/command-reports/resilience-business-dependency-upgrade-current14/) 和 [`resilience-matrix-dependency-upgrade-current14`](../../../artifacts/command-reports/resilience-matrix-dependency-upgrade-current14/) 中完成健康、备份恢复、业务恢复和 8 依赖故障矩阵验证。完整 10 镜像报告 [`p8-vulnerability-scan-command-current16`](../../../artifacts/command-reports/p8-vulnerability-scan-command-current16/) 的 `blocked` 状态被冻结为历史信息，不再触发升级或功能发布阻断。后续工作只继续验证依赖可用性、恢复、WaveMate 0.24.1、k3s 和生产 Smoke。
