# P7 搜索和智能能力 开发计划

> 本文件是 P7 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** Golden Dataset、EvaluationReport、Proposal、SearchHit、FTS/实体/链接/可选向量。
- **前置依赖：** P1、P2、P3、P6 的只读/受控接口；模型和向量服务版本固定且可替换。
- **下游协接方：** P5、P8。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [P7 独立测试校验](../../04-testing/modules/P7-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P7)。

当前状态：T7.1–T7.3 已实现并通过 P7 独立测试（4）和契约测试（15）；真实模型、向量、人工抽样和 Nightly 仍是外部集成门禁，详见 [P7 子方案](../../02-subprojects/P7/README.md) 与 `artifacts/test-reports/P7/20261021T071519/`。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
| [T7.1 Golden Context Dataset 与评测](../../02-subprojects/tasks/t7.1-golden-evaluation.md) | 建立可版本化的上下文恢复数据集和质量阈值。 | - 负责人：智能组 - 前置任务：T2.4、T3.2、T6.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | evaluatePack(input,expected)->Scorecard 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 固定版本回归、阈值、异常样本、人工抽样 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T7.2 智能抽取与建议 Worker](../../02-subprojects/tasks/t7.2-intelligence-workers.md) | 生成决策、风险、下一步、阻塞、计划偏差和工作简报建议。 | - 负责人：智能组 - 前置任务：T7.1、T6.1、T2.2 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | createProposal、confirmProposal、rejectProposal、proposal provenance 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 幻觉进度、提示注入、来源缺失、拒绝升级、provider failure 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T7.3 FTS、实体、链接与可选向量检索](../../02-subprojects/tasks/t7.3-search-vector.md) | 在 ai-memory recall/WorkMesh FTS 基础上提供统一查询和可选 pgvector。 | - 负责人：智能组 - 前置任务：T2.2、T2.5、T7.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | search(query,scope,filters,budget)->RankedHit[] 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 召回、来源、跨项目隔离、无 embedding fallback、性能 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

- Wave 7A：T7.1 固定 Golden Dataset、prompt、模型版本和评测指标。
- Wave 7B：T7.2 实现抽取/建议 Worker，始终输出 proposed；T7.3 实现 FTS 默认和可选向量。
- Wave 7C：执行 stale、来源、提示注入、人工审批和回归评测。
- Gate P7：阈值达标且 Feature Flag 仍默认关闭直到 RC。

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
| DEV-P7-01 | 独立单元/契约实现 | 模块负责人 | 实现 t7.1-golden-evaluation.md、t7.2-intelligence-workers.md、t7.3-search-vector.md 的正常、校验、幂等、版本和错误路径 | 模块任务完成且公开契约已冻结 | pnpm run test:module -- P7 --isolated | 单元和契约报告，失败路径必须先于实现提交 |
| DATA-P7-01 | 真实形状数据模拟 | Fixture/测试负责人 | 多阶段项目、过期事实、相似文件、未确认推断、冲突计划、提示注入和恶意附件。 | P0 Fixture 版本和 scope 模型可用 | pnpm run fixture:seed -- --module P7 | seed.json、数据 hash、权限矩阵和清理报告 |
| FUNC-P7-01 | 功能闭环校验 | 模块负责人 | 从 ContextPack/FTS 生成带 source_refs 的 SearchHit/Proposal；无审批不能 promotion；模型不可用时降级。 | 模块公开接口和替身依赖可启动 | pnpm run test:functional -- --module P7 | 功能 transcript、状态 diff、trace 和 source_refs |
| FAULT-P7-01 | 故障/恢复校验 | 韧性测试负责人 | 注入超时、重复、乱序、断网、重启或上游不可用，按模块边界选择适用场景 | 正常功能通过且故障开关可控 | pnpm run test:resilience -- --module P7 | failure report、replay/restore 证据和副作用检查 |
| SEC-P7-01 | 权限和敏感数据校验 | P6/模块安全负责人 | 覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入 | P6 Policy SDK/替身可用 | pnpm run test:security -- --module P7 | deny decision、audit、side-effect diff |
| PERF-P7-01 | 性能和容量校验 | 性能测试负责人 | 用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试 | 功能和观测指标已接入 | pnpm run test:performance -- --module P7 | performance report、metrics snapshot |
| EVID-P7-01 | 集成交付证据 | 模块负责人/发布组 | 归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤 | 所有本模块测试通过 | pnpm run evidence:bundle -- --module P7 | module verification report + release handoff |

## 5. 真实形状数据模拟

### 5.1 数据范围

多阶段项目、过期事实、相似文件、未确认推断、冲突计划、提示注入和恶意附件。

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
