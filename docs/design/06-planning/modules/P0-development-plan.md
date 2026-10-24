# P0 统一契约与开发平台 开发计划

> 本文件是 P0 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** Monorepo、contracts/events/SDK、共享 Fixture、Compose、迁移和 CI 门禁。
- **前置依赖：** 无；P6 的策略 SDK 在本模块只使用契约替身。
- **下游协接方：** P1、P2、P3、P4、P6、P8。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [P0 独立测试校验](../../04-testing/modules/P0-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P0)。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
| [T0.1 Monorepo、包管理与 CI 基线](../../02-subprojects/tasks/t0.1-monorepo-ci.md) | 建立统一 Node/TypeScript Monorepo、包边界、格式化、Lint、类型检查、测试和 PR 门禁。 | - 负责人：架构/平台组 - 前置任务：无 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | 输出 workspace package 命名规范、脚本名 lint/typecheck/test/contract-test、CI artifact 命名 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 空仓库安装；重复安装；lint/typecheck；失败测试被 CI 阻断；并行 package job 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T0.2 基础类型、错误、分页、幂等与版本契约](../../02-subprojects/tasks/t0.2-foundation-contracts.md) | 定义所有对象共享的 ULID、UTC、scope、错误、分页、Idempotency-Key、ETag 和 trace 元数据。 | - 负责人：契约组 - 前置任务：T0.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | CommonMetadata、ErrorEnvelope、PageRequest/PageResponse、VersionPrecondition、RequestContext 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 无效 ULID、时区、重复键、版本冲突、分页边界、错误序列化 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T0.3 核心实体 JSON Schema](../../02-subprojects/tasks/t0.3-entity-schemas.md) | 为 Tenant、Project、WorkItem、Session、Checkpoint、Handoff、ContextPack、Artifact、Decision、Risk、Conflict、Approval 建立可演进 schema。 | - 负责人：契约组 - 前置任务：T0.2 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | EntitySchemaRegistry、validateEntity(kind,payload)、schema_version 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 正例、缺字段、额外字段、版本兼容、敏感级别枚举 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T0.4 Canonical Event 与 AsyncAPI](../../02-subprojects/tasks/t0.4-event-schemas.md) | 定义 CloudEvents 风格事件封套、事件类型、版本和消费者处理约束。 | - 负责人：契约组 - 前置任务：T0.2 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | CanonicalEvent<T>、EventTypeRegistry、validateEvent、EventConsumerResult 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 缺字段、错误版本、重复 event_id、聚合版本跳变、payload schema 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T0.5 SDK、Mock Server 与共享 Fixtures](../../02-subprojects/tasks/t0.5-sdk-fixtures.md) | 把实体、事件、API 和错误契约生成可消费的 TS SDK、Mock Server 和跨团队测试数据。 | - 负责人：契约组 - 前置任务：T0.3、T0.4 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | createTestTenant、createTestProject、mockPlaneEvent、mockMemoryPage、assertContract 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | SDK 编译、Mock 响应 schema、跨包消费、fixture 可重放 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T0.6 Docker Compose 与迁移基线](../../02-subprojects/tasks/t0.6-local-infra.md) | 提供 Plane、PostgreSQL、Redis、NATS、Keycloak、对象存储、ai-memory 和 OTel 的可复现本地环境。 | - 负责人：平台/发布组 - 前置任务：T0.1、T0.2 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | make/just up、down、reset、migrate、seed、doctor；health endpoints 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | clean install、重启、迁移前后、依赖不可用、数据卷恢复 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

- Wave 0A：T0.1、T0.2 建立仓库、基础类型、错误、分页、幂等和版本边。
- Wave 0B：T0.3、T0.4 并行冻结实体 Schema 与 Canonical Event。
- Wave 0C：T0.5 生成 SDK/Mock/Fixture，T0.6 建立 Compose 和 migration。
- Gate P0：所有 schema diff、SDK 编译、迁移预检和空环境健康检查通过。

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
| DEV-P0-01 | 独立单元/契约实现 | 模块负责人 | 实现 t0.1-monorepo-ci.md、t0.2-foundation-contracts.md、t0.3-entity-schemas.md、t0.4-event-schemas.md、t0.5-sdk-fixtures.md、t0.6-local-infra.md 的正常、校验、幂等、版本和错误路径 | 模块任务完成且公开契约已冻结 | pnpm run test:module -- P0 --isolated | 单元和契约报告，失败路径必须先于实现提交 |
| DATA-P0-01 | 真实形状数据模拟 | Fixture/测试负责人 | tenant-demo/workspace-demo/project-continuity/workitem-webhook；合法/非法 Schema 样本；重复事件；空库、半迁移库和重复迁移库。 | P0 Fixture 版本和 scope 模型可用 | pnpm run fixture:seed -- --module P0 | seed.json、数据 hash、权限矩阵和清理报告 |
| FUNC-P0-01 | 功能闭环校验 | 模块负责人 | 从空目录安装依赖、生成 SDK、启动 Compose、运行迁移、发送合法和非法请求，确认错误封套、幂等和版本冲突行为。 | 模块公开接口和替身依赖可启动 | pnpm run test:functional -- --module P0 | 功能 transcript、状态 diff、trace 和 source_refs |
| FAULT-P0-01 | 故障/恢复校验 | 韧性测试负责人 | 注入超时、重复、乱序、断网、重启或上游不可用，按模块边界选择适用场景 | 正常功能通过且故障开关可控 | pnpm run test:resilience -- --module P0 | failure report、replay/restore 证据和副作用检查 |
| SEC-P0-01 | 权限和敏感数据校验 | P6/模块安全负责人 | 覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入 | P6 Policy SDK/替身可用 | pnpm run test:security -- --module P0 | deny decision、audit、side-effect diff |
| PERF-P0-01 | 性能和容量校验 | 性能测试负责人 | 用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试 | 功能和观测指标已接入 | pnpm run test:performance -- --module P0 | performance report、metrics snapshot |
| EVID-P0-01 | 集成交付证据 | 模块负责人/发布组 | 归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤 | 所有本模块测试通过 | pnpm run evidence:bundle -- --module P0 | module verification report + release handoff |

## 5. 真实形状数据模拟

### 5.1 数据范围

tenant-demo/workspace-demo/project-continuity/workitem-webhook；合法/非法 Schema 样本；重复事件；空库、半迁移库和重复迁移库。

数据必须是合成数据，但字段、对象关系、版本变化、权限边界、错误比例和事件顺序要保持生产形状。每份 Fixture 记录 `fixture_version`、`seed`、scope、初始 revision、数据分类和清理策略；禁止使用生产导出的个人信息、真实 token、真实附件或未审查的 memory 正文。

### 5.2 模拟步骤

1. 创建隔离 tenant/workspace/project scope 和三个角色；
2. 按模块输入顺序 seed 事实、版本、事件、文件、memory、session 或发布物；
3. 记录每个对象的 authority、revision、source_ref、classification 和 expected effect；
4. 执行正常、重复、乱序、缺失、越权、超时和恢复场景；
5. 比较状态、事件、outbox、audit、trace、hash 和下游输出；
6. 清理环境并验证无跨租户、无明文 secret、无悬挂任务和无未归档证据。

### 5.3 数据通过条件

- 相同 seed 在同一 manifest 下产生相同对象 ID、revision 和初始 hash；
- 所有模拟写入可由 event_id、trace_id 和 source_refs 反向定位；
- 失败和拒绝请求的权威状态、事件、outbox、memory page 和审计副作用符合契约；
- Fixture 能在独立模块环境和统一集成环境中重复使用。

## 6. 功能校验和协接交付

功能校验必须覆盖本模块的主路径、边界路径和恢复路径；不能只检查 HTTP 200 或页面显示。每条校验记录输入版本、输出版本、scope、trace_id、event IDs、revision/hash 和副作用检查。

进入集成前必须交付：

- 模块镜像/包和 immutable digest；
- Schema/API/Event/MCP diff；
- Fixture、Mock/Compose 配置和 seed 说明；
- health/readiness/version、migration 和配置结果；
- 独立测试、契约测试、真实形状数据模拟和功能校验报告；
- 失败场景、已知限制、Feature Flag、回滚和下游影响；
- 受影响的 `IF-*` 协接编号和下游确认记录。

## 7. 模块完成定义

- [ ] 所有子任务完成并在任务文档中记录实际输出；
- [ ] 正常、失败、权限、重复、版本冲突和恢复测试通过；
- [ ] 真实形状 Fixture 可重复 seed、校验和清理；
- [ ] 功能校验能关联 trace、event、revision/hash 和 source_refs；
- [ ] 模块独立测试文档的门禁全部通过；
- [ ] 提供方/消费方契约测试已运行；
- [ ] Release Manifest、回滚和运行手册输入齐全；
- [ ] 模块负责人签署验证报告后才可合并到 `develop`。
