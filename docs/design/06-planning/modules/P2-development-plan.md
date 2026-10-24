# P2 上下文、文件、记忆与 ContextPack 开发计划

> 本文件是 P2 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** ArtifactRef、MemoryRef、MemoryHit、L0–L4、ContextPack、FTS 和 MCP Resource。
- **前置依赖：** P0；P1 projection Fixture；固定版本 ai-memory、隔离 Markdown wiki 和 SQLite 派生索引。
- **下游协接方：** P3、P4、P5、P7、P8。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [P2 独立测试校验](../../04-testing/modules/P2-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P2)。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
| [T2.1 Artifact、文件版本与对象存储](../../02-subprojects/tasks/t2.1-artifact-metadata.md) | 保存文件/代码/报告的元数据、版本、hash、分类和对象存储引用。 | - 负责人：上下文数据组 - 前置任务：T0.3、T0.6 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | createArtifact、putVersion、getArtifact、verifyHash、authori | hash mismatch、重复上传、断点、权限、版本恢复、对象不存在 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T2.2 ai-memory MemoryService Adapter](../../02-subprojects/tasks/t2.2-memory-adapter.md) | 通过 HTTP/MCP 将 ai-memory 的 capture、recall、consolidate、handoff、claim 和 restore 接入 WorkMesh。 | - 负责人：上下文数据组 - 前置任务：T0.4、T0.6、vendor/ai-memory-adoption.md - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | capture、consolidate、recall、create_handoff、claim_handoff、read_page、restore_page、trace 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | capture saniti |
| [T2.3 L0-L4 上下文层和 MemoryItem](../../02-subprojects/tasks/t2.3-context-layers.md) | 把 Plane 状态、WorkMesh 事实和 ai-memory 页面组织为可排序、可过滤的上下文层。 | - 负责人：上下文数据组 - 前置任务：T1.5、T2.1、T2.2 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | ContextItem、ContextLayer、rankContextItem、filterByPolicy 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 层排序、过期、未确认、权限、敏感级别、关键约束保留 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T2.4 ContextPack 编译器](../../02-subprojects/tasks/t2.4-context-compiler.md) | 在预算、权限、客户端能力和时效约束下生成确定性 ContextPack。 | - 负责人：上下文数据组 - 前置任务：T2.3、T2.1、T1.5 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | compileContextPack(input,options)->ContextPack、renderMarkdown、renderMcpResource 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 相同输入相同 hash、超预算、权限过滤、过期、关键约束、source refs、三格式 parity 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T2.5 全文检索与 Context MCP Resource](../../02-subprojects/tasks/t2.5-fts-resources.md) | 把 WorkMesh 事实与 ai-memory recall 聚合成授权的项目上下文检索和 MCP Resources。 | - 负责人：上下文数据组 - 前置任务：T2.2、T2.4 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | searchProjectContext(query,scope,budget)、getContextResource(uri) 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | scope、空结果、fallback、FTS、link/entity、权限、敏感正文隐藏 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

- Wave 2A：T2.1 与 T2.2 并行建立文件引用和 ai-memory Adapter。
- Wave 2B：T2.3 定义上下文层与确认状态，T2.4 编译确定性 ContextPack。
- Wave 2C：T2.5 暴露 FTS 和 MCP Resource，并验证分页/权限。
- Gate P2：ContextPack hash、来源、权限、budget、ai-memory 真源和恢复行为全部通过。

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
| DEV-P2-01 | 独立单元/契约实现 | 模块负责人 | 实现 t2.1-artifact-metadata.md、t2.2-memory-adapter.md、t2.3-context-layers.md、t2.4-context-compiler.md、t2.5-fts-resources.md 的正常、校验、幂等、版本和错误路径 | 模块任务完成且公开契约已冻结 | pnpm run test:module -- P2 --isolated | 单元和契约报告，失败路径必须先于实现提交 |
| DATA-P2-01 | 真实形状数据模拟 | Fixture/测试负责人 | 已确认决策、未确认候选、风险、过期记忆、敏感附件、同名文件、多个 page revision、Markdown 真源和 SQLite rebuild。 | P0 Fixture 版本和 scope 模型可用 | pnpm run fixture:seed -- --module P2 | seed.json、数据 hash、权限矩阵和清理报告 |
| FUNC-P2-01 | 功能闭环校验 | 模块负责人 | capture/recall/consolidate/handoff/claim/restore；按 scope 生成 ContextPack；用相同输入重复编译并比较 hash、source_refs 和截断原因。 | 模块公开接口和替身依赖可启动 | pnpm run test:functional -- --module P2 | 功能 transcript、状态 diff、trace 和 source_refs |
| FAULT-P2-01 | 故障/恢复校验 | 韧性测试负责人 | 注入超时、重复、乱序、断网、重启或上游不可用，按模块边界选择适用场景 | 正常功能通过且故障开关可控 | pnpm run test:resilience -- --module P2 | failure report、replay/restore 证据和副作用检查 |
| SEC-P2-01 | 权限和敏感数据校验 | P6/模块安全负责人 | 覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入 | P6 Policy SDK/替身可用 | pnpm run test:security -- --module P2 | deny decision、audit、side-effect diff |
| PERF-P2-01 | 性能和容量校验 | 性能测试负责人 | 用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试 | 功能和观测指标已接入 | pnpm run test:performance -- --module P2 | performance report、metrics snapshot |
| EVID-P2-01 | 集成交付证据 | 模块负责人/发布组 | 归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤 | 所有本模块测试通过 | pnpm run evidence:bundle -- --module P2 | module verification report + release handoff |

## 5. 真实形状数据模拟

### 5.1 数据范围

已确认决策、未确认候选、风险、过期记忆、敏感附件、同名文件、多个 page revision、Markdown 真源和 SQLite rebuild。

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
