# P8 统一发布、质量与私有化交付 开发计划

> 本文件是 P8 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** 集成/E2E/Resilience 编排、Compose/Helm、Release Manifest、备份恢复和回滚；SBOM 作为可选组件清单。
- **前置依赖：** P0–P7 全部版本化 artifact、Schema、migration、Fixture、Feature Flag 和 Runbook。
- **下游协接方：** 生产环境、运维和发布审批。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [P8 独立测试校验](../../04-testing/modules/P8-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P8)。

当前状态：T8.1–T8.3 已实现并通过 P8 独立测试和契约测试；T8.1 已增加真实执行的
Plane 事件→Projection→ContextPack→MCP Resource、会话连续性 fixture，以及指定 WaveMate 0.24.1
离线包的 `server/discover`→`initialize`→`notifications/initialized` MCP 握手，分别覆盖重复事件、
scope fence、claim-once/父子会话关系和 Streamable HTTP 协议兼容。
离线 Compose doctor/health、无占位符 Release Manifest、CycloneDX SBOM、Helm 模板分隔符检查和
统一 RC readiness 报告已纳入 `P8-C02/P8-C03`。本地固定 digest Compose 集成已完成 10 服务健康、
迁移、Plane、ai-memory、对象存储、Workctx API、幂等重放和 RabbitMQ 恢复验证，证据为
`artifacts/test-reports/compose/20261021T1440-compose-full-plane/`。真实 Plane→Webhook→MCP、
跨客户端生产进程、RC 级数据库/NATS/Keycloak/OPA 故障与指标、备份恢复和生产 Smoke
仍是外部 RC 门禁；本地 10 镜像 SBOM/漏洞报告只保留为历史记录，不再作为 P8 功能门禁，详见
[功能验收范围调整](../../05-release/07-functional-acceptance-scope.md)。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
| [T8.1 集成、E2E、故障与性能测试编排](../../02-subprojects/tasks/t8.1-integration-e2e-resilience.md) | 把所有服务和 ai-memory/Plane 组成可重复集成环境并执行全链路与故障测试。 | - 负责人：发布测试组 - 前置任务：T0.6、T1.5、T2.4、T3.4、T4.4、T6.3 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | test environment contract、seed/reset、report format 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | Plane→Webhook→Event→ContextPack→MCP、WaveMate MCP handshake、会话连续性 fixture、duplicate/out-of-order、NATS/DB restart、offline、security/perf 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T8.2 Compose、Helm 与部署拓扑](../../02-subprojects/tasks/t8.2-compose-helm.md) | 交付开发/POC Compose 和指定三节点 k3s 的 Helm 配置。 | - 负责人：发布测试组 - 前置任务：T0.6、T4.1、T6.1、T6.3 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | values.schema.json、health/readiness、secret refs、resource limits 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | clean Compose、Helm lint/template/install/upgrade、restart、scale、secret missing 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T8.3 Release Manifest、备份恢复与回滚](../../02-subprojects/tasks/t8.3-release-rollback.md) | 把 Plane、ai-memory、WorkMesh、Schema、迁移、Feature Flags 固定成可恢复发布单元。 | - 负责人：发布测试组 - 前置任务：T8.1、T8.2、T6.2 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | preflight、backup、restore、migrate、rollback、smoke 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | backup/restore、upgrade/rollback、schema compatibility、audit/context resume 和功能 Smoke 测试必须不依赖未完成的下游任务；SBOM/漏洞报告只作可选记录。 |

| [T8.4 真实数据数据库闭环与运行时恢复](../../02-subprojects/tasks/t8.4-real-data-closure.md) | 将 Plane 事件、投影、Context hit、审计和 Session continuity 接入 PostgreSQL 持久化，并验证重启恢复与幂等重放。 | - 负责人：运行时与发布组 - 前置任务：T4.1、T6.2、T8.2、T8.3 | 009/010 migration、runtime/session persistence、恢复报告 | accepted、duplicate、out-of-order、503、重启 hydrate、CAS 冲突和跨 scope 隔离。 |

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

- Wave 8A：T8.1 编排接口、E2E、故障、安全和性能测试；T8.2 固定 Compose/Helm 拓扑。
- Wave 8B：T8.3 生成 Release Manifest、备份/恢复/回滚脚本，按需生成 SBOM 组件清单。
- Wave 8C：clean install、升级、回滚、恢复和生产 Smoke 演练。
- Gate P8：所有模块报告、契约边、恢复证据和功能上线 Smoke 齐全；漏洞报告不参与 Gate。

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
| DEV-P8-01 | 独立单元/契约实现 | 模块负责人 | 实现 t8.1-integration-e2e-resilience.md、t8.2-compose-helm.md、t8.3-release-rollback.md 的正常、校验、幂等、版本和错误路径 | 模块任务完成且公开契约已冻结 | pnpm run test:module -- P8 --isolated | 单元和契约报告，失败路径必须先于实现提交 |
| DATA-P8-01 | 真实形状数据模拟 | Fixture/测试负责人 | clean install、上一版本 manifest、故障注入、Postgres/SQLite/ai-memory 备份、生产 Smoke tenant。 | P0 Fixture 版本和 scope 模型可用 | pnpm run fixture:seed -- --module P8 | seed.json、数据 hash、权限矩阵和清理报告 |
| FUNC-P8-01 | 功能闭环校验 | 模块负责人 | 从空目录部署，运行 Plane→MCP、WaveMate MCP handshake 和会话连续性 fixture，模拟 Plane/DB/Policy/ai-memory 故障，恢复和回滚后核对 event IDs、revision、hash 和 audit。 | 模块公开接口和替身依赖可启动 | pnpm run test:functional -- --module P8 | 功能 transcript、状态 diff、trace 和 source_refs |
| FAULT-P8-01 | 故障/恢复校验 | 韧性测试负责人 | 注入超时、重复、乱序、断网、进程 kill 或上游不可用，按模块边界选择适用场景 | 正常功能通过且故障开关可控 | pnpm run test:resilience -- --module P8；live dependency-matrix/process-kill/network-partition/business-recovery | failure report、replay/restore 证据和副作用检查 |
| SEC-P8-01 | 权限和敏感数据校验 | P6/模块安全负责人 | 覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入 | P6 Policy SDK/替身可用 | pnpm run test:security -- --module P8 | deny decision、audit、side-effect diff |
| PERF-P8-01 | 性能和容量校验 | 性能测试负责人 | 用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试 | 功能和观测指标已接入 | pnpm run test:performance -- --module P8 | performance report、metrics snapshot |
| INFO-P8-02 | 镜像 SBOM 与漏洞记录（可选） | 发布测试组 | 如已有报告则归档镜像版本、digest 和扫描结果，不创建升级、修复或豁免任务 | Release Manifest 已生成 | 可不执行；已有报告直接引用 | 只作为 informational 记录，不影响功能 Gate；不得把漏洞数量写成功能失败 |
| EVID-P8-01 | 集成交付证据 | 模块负责人/发布组 | 归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤 | 所有本模块测试通过 | pnpm run evidence:bundle -- --module P8 | module verification report + release handoff |

## 5. 真实形状数据模拟

### 5.1 数据范围

clean install、上一版本 manifest、故障注入、Postgres/SQLite/ai-memory 备份、生产 Smoke tenant。

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
