# 发布、部署与恢复设计目录

本目录定义从模块合并、集成环境、Release Candidate 到生产上线和回滚的统一门禁。P8 负责生成并校验 Release Manifest、SBOM、备份恢复和回滚计划；本目录负责把这些产物组织成可执行的发布流程。

## 文档索引

- [发布、部署与回滚设计](01-release-deployment-rollback.md)：版本冻结、迁移、健康检查、备份、恢复、回滚和上线 Smoke。
- [运行手册索引](02-runbook-index.md)：发布、健康、故障、审计和恢复 Runbook 的入口。
- [RC 与生产门禁执行步骤](03-rc-gate-execution.md)：从本地门禁、Compose、Helm 到备份恢复、回滚和生产 Smoke 的唯一执行顺序。
- [k3s 三节点测试部署与验证](04-k3s-test-deployment.md)：在 `192.168.1.231/.232/.233` 的现有 k3s 集群上执行 smoke 和正式 runtime、三节点调度、故障恢复和回滚验证。
- [本地离线镜像构建与三节点传输](05-offline-image-build-transfer.md)：本地引擎校验、runtime staging、离线构建、digest/SHA256、传输和 k3s containerd 导入。
- [功能验收范围调整](07-functional-acceptance-scope.md)：明确后续只以功能完整可用为验收目标，漏洞报告不再阻断功能发布。

## 发布阶段

1. Merge：P0–P8 独立测试、协接契约和计划审计通过；
2. Nightly：使用基础 Compose 文件叠加固定 digest 的本地测试覆盖层，执行完整依赖健康、迁移、Plane、ai-memory、对象存储、Workctx 和故障恢复；真实三条 E2E、安全、性能和智能评测仍需 RC 环境；
3. RC：Release Manifest、迁移、备份恢复、回滚和功能 Smoke 全部有证据；SBOM/漏洞报告仅作可选环境记录；
4. Production：health/readiness/version、关键 Smoke、事件延迟、审计和 Resume 通过后，才打开 Feature Flag。

离线 Fixture 只能验证命令、报告和证据形状，不能替代真实部署门禁。当前外部门禁状态由 [整体开发计划](../06-planning/00-overall-development-plan.md) 和 `artifacts/test-reports/` 中的报告记录。

统一入口：`pnpm run rc:readiness -- --offline` 用于生成离线 readiness 报告；去掉 `--offline` 后会探测真实 Docker/Helm/kubectl 和服务环境。Compose 本地集成入口及证据见
[`RC 与生产门禁执行步骤`](03-rc-gate-execution.md) 和 [`20261021T1440-compose-full-plane`](../../../artifacts/test-reports/compose/20261021T1440-compose-full-plane/)。任何外部门禁缺失都返回 `blocked` 和非零退出码。
