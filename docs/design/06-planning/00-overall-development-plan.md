# Plane Work Continuity Platform 整体开发计划

> 本文件是 P0–P8 的统一执行计划。它把模块开发、38 个子任务、真实形状数据模拟、功能校验、契约协接、集成、发布和回滚放在同一条可审计链路中。

## 1. 目标和完成判定

目标是交付一个以 Plane 事实为权威、以 ai-memory Markdown 为长期记忆真源、以 ContextPack 为跨客户端上下文、以 Session/Handoff/Outbox/Conflict 支撑连续工作的私有化平台。完成必须同时满足：

- P0–P8 的模块计划和全部子任务均有负责人、依赖、输出、测试和交付证据；
- 每个模块先独立通过测试和真实形状数据模拟，再通过提供方/消费方契约测试；
- 统一集成环境能跑通 Plane→Webhook→Projection→ContextPack→MCP、跨客户端切换、离线冲突三条链路；
- Release Manifest 固定所有 artifact、Schema、migration、Plane、ai-memory、模型和 Feature Flag；
- 备份恢复、升级回滚、观测和生产 Smoke 全部通过；镜像漏洞报告不属于功能完成条件。

## 1.1 当前执行状态（2026-10-21）

P0–P8 的代码边界、任务设计、模块独立校验、协接契约和发布输入已落地到工作区。当前本地可重复门禁为：`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test`（99 个测试）、`pnpm run plan:audit`、`pnpm run rc:readiness -- --offline`、各模块 `pnpm run test:module -- P* --isolated`、契约套件和 `git diff --check` 全部通过。P0/P8 的最新命令与证据校验归档在 `artifacts/test-reports/P0/20261021T233235/`、`artifacts/test-reports/P8/20261021T233235/`；P6 最新 OPA/审计证据归档在 `artifacts/command-reports/p6-identity-audit-live-current8/` 和 `artifacts/command-reports/security-live-opa-current2/`。

仍需在具备 Docker/Helm/真实外部服务的集成或 RC 环境执行真实 Plane、ai-memory、PostgreSQL、Keycloak/OPA、OTel、浏览器、模型/向量、备份恢复和生产 Smoke 门禁；这些结果不得用内存替身报告替代。漏洞扫描只保留历史记录，不再作为后续功能门禁。

## 2. 模块计划入口

- [P0 统一契约与开发平台](modules/P0-development-plan.md)：Monorepo、contracts/events/SDK、共享 Fixture、Compose、迁移和 CI 门禁
- [P1 Plane 连接器与工作图谱](modules/P1-development-plan.md)：Plane capability matrix、REST Client、Webhook 入口、去重/回放、Project/WorkItem observed projection
- [P2 上下文、文件、记忆与 ContextPack](modules/P2-development-plan.md)：ArtifactRef、MemoryRef、MemoryHit、L0–L4、ContextPack、FTS 和 MCP Resource
- [P3 会话、检查点、交接与离线同步](modules/P3-development-plan.md)：Session、AgentRun、ToolCall、Checkpoint、Handoff、SyncCursor、SQLite Outbox、Conflict
- [P4 统一 MCP、REST、CLI 与客户端连接器](modules/P4-development-plan.md)：REST Gateway、MCP Resources/Tools/Prompts、workctx CLI、客户端 capability matrix
- [P5 Web 工作台](modules/P5-development-plan.md)：项目/工作项查询、Context、Handoff、Conflict、Admin、Playwright 和发布 Smoke
- [P6 安全、治理与观测](modules/P6-development-plan.md)：Identity/RBAC/OPA、PolicyDecision、AuditRecord、分类/脱敏、Trace/Metrics/Logs/告警
- [P7 搜索和智能能力](modules/P7-development-plan.md)：Golden Dataset、EvaluationReport、Proposal、SearchHit、FTS/实体/链接/可选向量
- [P8 统一发布、质量与私有化交付](modules/P8-development-plan.md)：集成/E2E/Resilience 编排、Compose/Helm、Release Manifest、备份恢复和回滚；SBOM 可选

## 3. 整体开发波次

| 波次 | 范围 | 并行关系 | 退出条件 |
|---|---|---|---|
| Wave 0：基线和契约 | P0 / T0.1–T0.6 | P0 内按契约→Fixture→Compose 顺序 | Schema、Event、SDK、Fixture、迁移和 CI 全绿 |
| Wave 1：事实与记忆 | P1、P2、P6 的独立能力 | P1/P2/P6 可在替身下并行；公共字段只能经 P0 | Plane projection、ContextPack、Policy/Audit/Trace 独立报告 |
| Wave 2：状态连续性 | P3 / T3.1–T3.5 | P3 依赖 P2 ContextPack 契约 | claim-once、outbox、cursor、冲突和恢复全绿 |
| Wave 3：统一入口 | P4 / T4.1–T4.4 | REST/MCP/CLI 可并行，共享 WCP/Policy | parity、MCP conformance、客户端切换通过 |
| Wave 4：产品和智能 | P5、P7 | P5 使用 Gateway stub；P7 使用 Golden/模型 stub | UI 关键旅程、Golden 阈值、proposal 审批通过 |
| Wave 5：统一集成 | P8 / T8.1–T8.4 | 依赖全部上游 immutable artifact | E2E、故障、性能、策略/审计、恢复、回滚和 Smoke 通过 |

## 4. 38 个子任务完整计划

下表是整体计划的任务基线；每个任务的详细设计和独立测试仍以 `docs/design/02-subprojects/tasks/` 下的文件为准，每个模块的执行顺序以 `modules/P*-development-plan.md` 为准。

| 模块 | 任务归属 | 任务设计 | 目标 | 独立测试重点 |
|---|---|---|---|---|
| P0 | [T0.1 Monorepo、包管理与 CI 基线](modules/P0-development-plan.md) | [任务设计](../02-subprojects/tasks/t0.1-monorepo-ci.md) | 建立统一 Node/TypeScript Monorepo、包边界、格式化、Lint、类型检查、测试和 PR 门禁。 | 空仓库安装；重复安装；lint/typecheck；失败测试被 CI 阻断；并行 package job 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P0 | [T0.2 基础类型、错误、分页、幂等与版本契约](modules/P0-development-plan.md) | [任务设计](../02-subprojects/tasks/t0.2-foundation-contracts.md) | 定义所有对象共享的 ULID、UTC、scope、错误、分页、Idempotency-Key、ETag 和 trace 元数据。 | 无效 ULID、时区、重复键、版本冲突、分页边界、错误序列化 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P0 | [T0.3 核心实体 JSON Schema](modules/P0-development-plan.md) | [任务设计](../02-subprojects/tasks/t0.3-entity-schemas.md) | 为 Tenant、Project、WorkItem、Session、Checkpoint、Handoff、ContextPack、Artifact、Decision、Risk、Conflict、Approval 建立可演进 schema。 | 正例、缺字段、额外字段、版本兼容、敏感级别枚举 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P0 | [T0.4 Canonical Event 与 AsyncAPI](modules/P0-development-plan.md) | [任务设计](../02-subprojects/tasks/t0.4-event-schemas.md) | 定义 CloudEvents 风格事件封套、事件类型、版本和消费者处理约束。 | 缺字段、错误版本、重复 event_id、聚合版本跳变、payload schema 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P0 | [T0.5 SDK、Mock Server 与共享 Fixtures](modules/P0-development-plan.md) | [任务设计](../02-subprojects/tasks/t0.5-sdk-fixtures.md) | 把实体、事件、API 和错误契约生成可消费的 TS SDK、Mock Server 和跨团队测试数据。 | SDK 编译、Mock 响应 schema、跨包消费、fixture 可重放 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P0 | [T0.6 Docker Compose 与迁移基线](modules/P0-development-plan.md) | [任务设计](../02-subprojects/tasks/t0.6-local-infra.md) | 提供 Plane、PostgreSQL、Redis、NATS、Keycloak、对象存储、ai-memory 和 OTel 的可复现本地环境。 | clean install、重启、迁移前后、依赖不可用、数据卷恢复 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P1 | [T1.1 Plane 版本与能力矩阵](modules/P1-development-plan.md) | [任务设计](../02-subprojects/tasks/t1.1-plane-version-matrix.md) | 锁定 Plane tag/digest、REST/Webhook 版本、支持对象和已知限制。 | 启动、版本探测、对象能力、升级候选对比 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P1 | [T1.2 Plane REST Client](modules/P1-development-plan.md) | [任务设计](../02-subprojects/tasks/t1.2-plane-rest-client.md) | 封装项目、WorkItem、状态、标签、自定义属性、周期、模块、里程碑、页面、评论、附件、关系和发布 API。 | mock API、429/5xx、timeout、ETag、权限、分页和附件下载 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P1 | [T1.3 Webhook 验签与入口](modules/P1-development-plan.md) | [任务设计](../02-subprojects/tasks/t1.3-webhook-security.md) | 实现 HMAC-SHA256、时间窗、raw body 校验和安全入队。 | 合法签名、篡改 body、重放签名、时钟偏移、缺 header、超大 payload 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P1 | [T1.4 Webhook 去重、重试、死信与回放](modules/P1-development-plan.md) | [任务设计](../02-subprojects/tasks/t1.4-webhook-dedup-replay.md) | 保证重复、乱序、延迟和失败 Webhook 最终一致且可回放。 | 重复 100 次、乱序、延迟、消费失败、回放不重复 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P1 | [T1.5 Plane ID 映射与工作图谱投影](modules/P1-development-plan.md) | [任务设计](../02-subprojects/tasks/t1.5-plane-projection.md) | 把 Plane 外部对象映射为 WorkMesh 引用和 observed projection，不建立第二份可写事实。 | 首建、更新、删除、重复、权限、断点重放、一致性扫描 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P2 | [T2.1 Artifact、文件版本与对象存储](modules/P2-development-plan.md) | [任务设计](../02-subprojects/tasks/t2.1-artifact-metadata.md) | 保存文件/代码/报告的元数据、版本、hash、分类和对象存储引用。 | hash mismatch、重复上传、断点、权限、版本恢复、对象不存在 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P2 | [T2.2 ai-memory MemoryService Adapter](modules/P2-development-plan.md) | [任务设计](../02-subprojects/tasks/t2.2-memory-adapter.md) | 通过 HTTP/MCP 将 ai-memory 的 capture、recall、consolidate、handoff、claim 和 restore 接入 WorkMesh。 | capture saniti |
| P2 | [T2.3 L0-L4 上下文层和 MemoryItem](modules/P2-development-plan.md) | [任务设计](../02-subprojects/tasks/t2.3-context-layers.md) | 把 Plane 状态、WorkMesh 事实和 ai-memory 页面组织为可排序、可过滤的上下文层。 | 层排序、过期、未确认、权限、敏感级别、关键约束保留 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P2 | [T2.4 ContextPack 编译器](modules/P2-development-plan.md) | [任务设计](../02-subprojects/tasks/t2.4-context-compiler.md) | 在预算、权限、客户端能力和时效约束下生成确定性 ContextPack。 | 相同输入相同 hash、超预算、权限过滤、过期、关键约束、source refs、三格式 parity 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P2 | [T2.5 全文检索与 Context MCP Resource](modules/P2-development-plan.md) | [任务设计](../02-subprojects/tasks/t2.5-fts-resources.md) | 把 WorkMesh 事实与 ai-memory recall 聚合成授权的项目上下文检索和 MCP Resources。 | scope、空结果、fallback、FTS、link/entity、权限、敏感正文隐藏 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P3 | [T3.1 Session、AgentRun、ToolCall](modules/P3-development-plan.md) | [任务设计](../02-subprojects/tasks/t3.1-session-model.md) | 记录客户端连接和执行过程，不把它们混入长期工作事实。 | 重复 start、异常 end、客户端断开、父子关系、权限 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P3 | [T3.2 Checkpoint、Handoff、Resume](modules/P3-development-plan.md) | [任务设计](../02-subprojects/tasks/t3.2-checkpoint-handoff.md) | 把 ai-memory handoff/ref 与 WorkMesh Checkpoint/Resume 统一。 | claim-once、重复接受、过期、权限、父子会话、ContextPack 版本 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P3 | [T3.3 SyncCursor 与事件批量同步](modules/P3-development-plan.md) | [任务设计](../02-subprojects/tasks/t3.3-sync-cursor-batch.md) | 提供服务端游标、批量上传、ack 和增量变更读取。 | 游标缺口、部分失败、重复批量、并发 ack、重放 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P3 | [T3.4 SQLite Local Outbox 与 Context Bridge](modules/P3-development-plan.md) | [任务设计](../02-subprojects/tasks/t3.4-sqlite-outbox.md) | 在网络或服务中断时先本地持久化事件，恢复后安全补传。 | 断网、重启、并发 drain、断电模拟、重复、损坏行 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P3 | [T3.5 ConflictDetected/Resolved](modules/P3-development-plan.md) | [任务设计](../02-subprojects/tasks/t3.5-conflict-service.md) | 实现版本冲突、冲突详情、人工解决和解决事件。 | 状态/负责人/截止/审批/计划冲突、重复 resolve、无权限 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P4 | [T4.1 REST API Gateway](modules/P4-development-plan.md) | [任务设计](../02-subprojects/tasks/t4.1-api-gateway.md) | 将 WCP 服务统一暴露为版本化 REST，并集中 auth、policy、audit、trace、错误和限流。 | schema、权限、重复、版本、timeout、限流、audit 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P4 | [T4.2 MCP Resources、Tools、Prompts](modules/P4-development-plan.md) | [任务设计](../02-subprojects/tasks/t4.2-mcp-gateway.md) | 将 WCP 和 ai-memory Adapter 的授权能力呈现为 MCP。 | MCP conformance、资源越权、tool idempotency、prompt source fence、client downgrade 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P4 | [T4.3 workctx CLI](modules/P4-development-plan.md) | [任务设计](../02-subprojects/tasks/t4.3-workctx-cli.md) | 提供 resume、checkpoint、handoff、sync、conflicts 和 doctor 的本地工作面。 | 参数、网络失败、重复、JSON parity、权限、Windows path 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P4 | [T4.4 Codex/Claude Code/DeepSeek/WorkBuddy 适配](modules/P4-development-plan.md) | [任务设计](../02-subprojects/tasks/t4.4-client-adapters.md) | 使用 ai-memory hooks/MCP 和 WorkMesh Gateway 建立客户端注册、能力声明和降级。 | 伪客户端、Hook payload、能力降级、切换、finali |
| P5 | [T5.1 工作台项目/工作项查询](modules/P5-development-plan.md) | [任务设计](../02-subprojects/tasks/t5.1-workbench-query.md) | 实现工作优先的首页、项目驾驶舱和工作项详情只读视图。 | Playwright 项目旅程、权限、错误态、可访问性 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P5 | [T5.2 交接、Resume 与冲突中心](modules/P5-development-plan.md) | [任务设计](../02-subprojects/tasks/t5.2-workbench-handoff-conflict.md) | 提供继续工作、切换客户端、交接包查看和冲突双版本解决。 | 重复 claim、冲突解决、权限、网络失败、确认提示 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P5 | [T5.3 工作台管理与运行健康](modules/P5-development-plan.md) | [任务设计](../02-subprojects/tasks/t5.3-workbench-admin.md) | 实现 Connector、策略、审计、发布健康、事件延迟和版本页面。 | 管理员/普通用户、脱敏、审计查询、健康异常 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P6 | [T6.1 Keycloak、RBAC、OPA Policy](modules/P6-development-plan.md) | [任务设计](../02-subprojects/tasks/t6.1-identity-policy.md) | 建立统一身份、scope、工具能力和审批要求。 | 过期 token、跨租户、scope escalation、tool capability、deny no side effect 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P6 | [T6.2 审计、数据分类、留存和导出](modules/P6-development-plan.md) | [任务设计](../02-subprojects/tasks/t6.2-audit-governance.md) | 把敏感读取、写入、导出、策略、Connector、ai-memory 和工具调用统一审计。 | 完整性、脱敏、导出、租户隔离、审计失败处理 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P6 | [T6.3 OpenTelemetry、Metrics、Logs 和告警](modules/P6-development-plan.md) | [任务设计](../02-subprojects/tasks/t6.3-observability.md) | 让客户端、Gateway、Connector、ai-memory Adapter、NATS 和 Context Compiler 全链路可观测。 | trace propagation、missing context、metrics cardinality、health failure 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P7 | [T7.1 Golden Context Dataset 与评测](modules/P7-development-plan.md) | [任务设计](../02-subprojects/tasks/t7.1-golden-evaluation.md) | 建立可版本化的上下文恢复数据集和质量阈值。 | 固定版本回归、阈值、异常样本、人工抽样 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P7 | [T7.2 智能抽取与建议 Worker](modules/P7-development-plan.md) | [任务设计](../02-subprojects/tasks/t7.2-intelligence-workers.md) | 生成决策、风险、下一步、阻塞、计划偏差和工作简报建议。 | 幻觉进度、提示注入、来源缺失、拒绝升级、provider failure 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P7 | [T7.3 FTS、实体、链接与可选向量检索](modules/P7-development-plan.md) | [任务设计](../02-subprojects/tasks/t7.3-search-vector.md) | 在 ai-memory recall/WorkMesh FTS 基础上提供统一查询和可选 pgvector。 | 召回、来源、跨项目隔离、无 embedding fallback、性能 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P8 | [T8.1 集成、E2E、故障与性能测试编排](modules/P8-development-plan.md) | [任务设计](../02-subprojects/tasks/t8.1-integration-e2e-resilience.md) | 把所有服务和 ai-memory/Plane 组成可重复集成环境并执行全链路与故障测试。 | Plane→Webhook→Event→ContextPack→MCP、Codex→Claude handoff、duplicate/out-of-order、NATS/DB restart、offline、security/perf 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P8 | [T8.2 Compose、Helm 与部署拓扑](modules/P8-development-plan.md) | [任务设计](../02-subprojects/tasks/t8.2-compose-helm.md) | 交付开发/POC Compose 和指定三节点 k3s 的 Helm 配置。 | clean Compose、Helm lint/template/install/upgrade、restart、scale、secret missing 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| P8 | [T8.3 Release Manifest、备份恢复与回滚](modules/P8-development-plan.md) | [任务设计](../02-subprojects/tasks/t8.3-release-rollback.md) | 把 Plane、ai-memory、WorkMesh、Schema、迁移、Feature Flags 固定成可恢复发布单元。 | backup/restore、upgrade/rollback、schema compatibility、audit/context resume 和功能 Smoke 测试必须不依赖未完成的下游任务；SBOM/漏洞报告只作可选记录。 |
| P8 | [T8.4 真实数据数据库闭环与运行时恢复](modules/P8-development-plan.md) | [任务设计](../02-subprojects/tasks/t8.4-real-data-closure.md) | 将 Webhook 事件、Projection、Context hit、Audit 持久化到真实 PostgreSQL，并验证 Compose/k3s 重启恢复。 | 首次 accepted、重复 duplicate、四表回查、滚动重启和真实数据库连接 |

## 5. 跨模块测试和真实数据计划

- [统一真实数据和功能校验计划](03-test-data-and-functional-validation-plan.md)：Fixture、seed、场景、校验任务、证据和清理。
- [模块独立测试目录](../04-testing/modules/README.md)：P0–P8 独立测试矩阵和门禁。
- [模块接口与协接契约](../03-integration/04-module-interface-contracts.md)：公共上下文、错误、版本和 28 条直接依赖边。
- [模块契约测试矩阵](../03-integration/05-module-contract-test-matrix.md)：提供方/消费方双侧校验。
- [集成测试主链路](../03-integration/03-end-to-end-chains.md)：三条端到端链路。

## 6. 集成和发布顺序

1. P0 发布 Schema/SDK/Fixture/Compose 版本；
2. P1、P2、P6 发布独立能力和契约报告；
3. P3 接入 ContextPack、MemoryRef、Session、Handoff、Outbox 和 Conflict；
4. P4 接入 REST/MCP/CLI/客户端适配并执行 parity；
5. P5 接入真实 Gateway，P7 接入 Golden/FTS/模型受控能力；
6. P8 创建临时集成环境，运行三条 E2E 和所有故障/安全/性能场景；
7. 生成 Release Manifest、备份和回滚证据；SBOM 作为可选组件清单；
8. RC 和生产 Smoke 通过后才打开 Feature Flag。

任何接口、事件、权限、Schema、migration、Fixture 或 Feature Flag 改动，都必须暂停下游合并，更新 `requirements-matrix.yaml`、受影响模块计划、`IF-*` 契约和双侧测试。

## 7. 整体 Gate 和证据

| Gate | 必须通过 | 证据 |
|---|---|---|
| G0 契约冻结 | Schema/Event/API/MCP/SDK、版本和 Fixture | contract diff、compile、fixture report |
| G1 模块完成 | P0–P8 独立测试、数据模拟、功能校验 | module verification report |
| G2 协接可用 | 所有受影响 `IF-*` provider/consumer 测试 | edge reports、trace、failure cases |
| G3 集成稳定 | 三条 E2E、重复/乱序/断网/重启/冲突/越权 | JUnit、event IDs、ContextPack hash、audit IDs |
| G4 发布候选 | clean install、迁移、恢复、回滚、性能和功能 Smoke | manifest、restore/rollback/performance report |
| G5 生产上线 | health/readiness/version、Smoke、事件 lag、审计和 Resume | production smoke bundle |

## 8. 总体完成定义

- [ ] 9 份模块开发计划已评审；
- [ ] 38 个子任务全部出现在本计划并链接到详细设计；
- [ ] 每个子任务有独立测试、真实形状数据、功能校验和交付证据；
- [ ] P0–P8 模块计划的依赖和整体波次一致；
- [ ] 需求、设计、任务、测试、协接和发布物可通过编号或路径互相追踪；
- [ ] 所有 Gate 证据归档后，才允许标记整体计划完成。
