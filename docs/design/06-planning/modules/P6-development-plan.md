# P6 安全、治理与观测 开发计划

> 本文件是 P6 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** Identity/RBAC/OPA、PolicyDecision、AuditRecord、分类/脱敏、Trace/Metrics/Logs/告警。
- **前置依赖：** P0；Keycloak、OPA、OTel 使用隔离 Compose，其他模块使用 SDK 替身。
- **下游协接方：** P1、P2、P3、P4、P5、P7、P8。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [P6 独立测试校验](../../04-testing/modules/P6-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P6)。

当前状态：T6.1–T6.3 已实现并通过 P6 独立测试（7）和契约测试；本轮新增 OPA REST allow/deny/fail-closed、运行时允许/拒绝审计、PostgreSQL 持久化、审计持久化失败 503 回归和 OPA decision log live 证据。RC 目标环境仍需复核 OPA、审计持久化和生产身份配置。实现摘要、外部门禁和证据见 [P6 子方案](../../02-subprojects/P6/README.md)、`artifacts/command-reports/p6-identity-audit-live-current8/` 和 `artifacts/command-reports/security-live-opa-current2/`。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
| [T6.1 Keycloak、RBAC、OPA Policy](../../02-subprojects/tasks/t6.1-identity-policy.md) | 建立统一身份、scope、工具能力和审批要求。 | - 负责人：安全组 - 前置任务：T0.2、T0.6 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | authori | 过期 token、跨租户、scope escalation、tool capability、deny no side effect 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T6.2 审计、数据分类、留存和导出](../../02-subprojects/tasks/t6.2-audit-governance.md) | 把敏感读取、写入、导出、策略、Connector、ai-memory 和工具调用统一审计。 | - 负责人：安全组 - 前置任务：T0.4、T6.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | recordAudit、queryAudit、createExportRecord、redact 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 完整性、脱敏、导出、租户隔离、审计失败处理 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T6.3 OpenTelemetry、Metrics、Logs 和告警](../../02-subprojects/tasks/t6.3-observability.md) | 让客户端、Gateway、Connector、ai-memory Adapter、NATS 和 Context Compiler 全链路可观测。 | - 负责人：安全/平台组 - 前置任务：T0.1、T0.5 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | TraceContext、withSpan、metrics names、health/readiness 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | trace propagation、missing context、metrics cardinality、health failure 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

- Wave 6A：T6.1 建立身份、租户/项目 scope 和 Policy SDK。
- Wave 6B：T6.2 建立审计、分类、留存、脱敏和导出；T6.3 并行接入 OTel 和告警。
- Wave 6C：将 P6 SDK 接入所有模块并执行 deny 无副作用回归。
- Gate P6：越权、副作用、审计完整性、脱敏、trace 和告警全部通过。

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
| DEV-P6-01 | 独立单元/契约实现 | 模块负责人 | 实现 t6.1-identity-policy.md、t6.2-audit-governance.md、t6.3-observability.md 的正常、校验、幂等、版本和错误路径 | 模块任务完成且公开契约已冻结 | pnpm run test:module -- P6 --isolated | 单元和契约报告，失败路径必须先于实现提交 |
| DATA-P6-01 | 真实形状数据模拟 | Fixture/测试负责人 | 两租户三角色、过期 token、scope escalation、敏感附件、审批记录、提示注入和 trace parent。 | P0 Fixture 版本和 scope 模型可用 | pnpm run fixture:seed -- --module P6 | seed.json、数据 hash、权限矩阵和清理报告 |
| FUNC-P6-01 | 功能闭环校验 | 模块负责人 | 允许/拒绝读取、写入、导出、恢复、删除和 Tool 调用；核对 audit 字段、trace graph、redaction 和 fail-closed。 | 模块公开接口和替身依赖可启动 | pnpm run test:functional -- --module P6 | 功能 transcript、状态 diff、trace 和 source_refs |
| FAULT-P6-01 | 故障/恢复校验 | 韧性测试负责人 | 注入超时、重复、乱序、断网、重启或上游不可用，按模块边界选择适用场景 | 正常功能通过且故障开关可控 | pnpm run test:resilience -- --module P6 | failure report、replay/restore 证据和副作用检查 |
| SEC-P6-01 | 权限和敏感数据校验 | P6/模块安全负责人 | 覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入 | P6 Policy SDK/替身可用 | pnpm run test:security -- --module P6 | deny decision、audit、side-effect diff |
| LIVE-P6-01 | 身份、OPA 与审计存储 live 校验 | P6/发布安全负责人 | 使用本地 Compose Keycloak 签发 Bearer token，调用固定 OPA overlay，验证运行时审计发射、指标递增、PostgreSQL 持久化和清理，再执行合成审计表 round trip | Compose Keycloak/PostgreSQL/OPA healthy | pnpm run test:identity-audit -- --live | `artifacts/command-reports/p6-identity-audit-live-current8/`、`artifacts/command-reports/security-live-opa-current2/`；RC 目标环境仍须复核 |
| PERF-P6-01 | 性能和容量校验 | 性能测试负责人 | 用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试 | 功能和观测指标已接入 | pnpm run test:performance -- --module P6 | performance report、metrics snapshot |
| EVID-P6-01 | 集成交付证据 | 模块负责人/发布组 | 归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤 | 所有本模块测试通过 | pnpm run evidence:bundle -- --module P6 | module verification report + release handoff |

## 5. 真实形状数据模拟

### 5.1 数据范围

两租户三角色、过期 token、scope escalation、敏感附件、审批记录、提示注入和 trace parent。

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
