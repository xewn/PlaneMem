# 功能验收范围调整

## 生效决定

自 2026-10-23 起，PlaneMem 后续开发、集成、RC 和测试只以系统功能完整可用为主线。漏洞修复、外部依赖镜像升级、漏洞豁免审批和重复漏洞扫描不再作为后续工作项，也不再作为功能发布阻断条件。

本决定不修改认证、授权、scope 隔离、审计、脱敏、Webhook 验签和失败关闭行为。这些属于系统功能和数据边界，仍必须继续测试；本决定只停止镜像和依赖漏洞治理流程。

## 保留的功能验收门禁

以下任何一项失败，仍阻断功能验收：

1. 构建、lint、类型检查、模块独立测试和协接契约测试；
2. Compose 10 服务健康、数据库迁移、Plane HTTP、ai-memory capture/recall、对象存储、NATS、Redis、RabbitMQ、Workctx 和 OTel 可用性；
3. Plane → Webhook → Projection → ContextPack → MCP 的完整链路，以及重复事件、幂等、scope 隔离和错误封套；
4. WaveMate 0.24.1 的 MCP handshake、`tools/list`、`tools/call`、UI 完成状态和配置自动恢复；
5. Session、Checkpoint、Handoff、Resume、SQLite Outbox、Conflict 和跨客户端连续性；
6. PostgreSQL、SQLite、ai-memory、对象存储的备份恢复，以及 PostgreSQL、NATS、RabbitMQ、Redis、Keycloak、MinIO、ai-memory、OTel 的故障恢复；
7. k3s 三节点部署、readiness、滚动升级、Pod/节点恢复、Helm rollback 和恢复后业务 Smoke；
8. RC/生产环境的 health/readiness/version、关键业务 Smoke、事件延迟、审计写入和恢复后数据校验。

## 漏洞报告处理方式

- 已有 Trivy、SBOM 和候选镜像报告只作为历史记录和环境信息保留，不再创建升级任务、修复队列或豁免审批任务。
- `pnpm run test:vulnerability` 工具和已有测试可以保留，后续不纳入标准执行顺序；若主动运行，结果只能标记为 `informational`，不能改变功能验收结论。
- PostgreSQL 16.15 和 RabbitMQ 4.4.0 的本地变更保持现状，因为它们已通过功能回归；后续不再为了漏洞数量继续升级其他镜像。
- Release Manifest 可以继续记录镜像 tag/digest 和可选 SBOM，用于可复现部署；不要求漏洞计数为 0，也不因漏洞报告为 `blocked` 而阻断功能发布。

## 后续执行顺序

每个模块完成后执行独立测试和协接测试；随后执行 Compose 功能 Smoke、恢复/故障测试、WaveMate 0.24.1 真实 MCP/UI 验证，再执行 k3s 三节点集成和恢复 Smoke。只有功能证据缺失或失败时才回到对应模块修复；漏洞报告不再触发工作流。

相关旧文档中的“漏洞门禁阻断”均按本文件解释，历史报告不删除、不改写原始结果。
