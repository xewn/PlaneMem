# P4 统一 MCP、REST、CLI 与客户端连接器 开发计划

> 本文件是 P4 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** REST Gateway、MCP Resources/Tools/Prompts、workctx CLI、客户端 capability matrix。
- **前置依赖：** P0、P2、P3、P6；所有入口共享同一 WCP、Policy 和 Audit 路径。
- **下游协接方：** P5、P8。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [P4 独立测试校验](../../04-testing/modules/P4-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P4)。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
| [T4.1 REST API Gateway](../../02-subprojects/tasks/t4.1-api-gateway.md) | 将 WCP 服务统一暴露为版本化 REST，并集中 auth、policy、audit、trace、错误和限流；当前已增加可启动 HTTP runtime。 | - 负责人：会话连接组 - 前置任务：T0.5、T1.5、T2.5、T3.3、T6.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | WCP routes in 01-contracts/wcp-api.md；runtime 入口、health/readiness/version 和正式镜像。任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | schema、权限、scope、trace、runtime 启动、非法 JSON、限流、audit 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T4.2 MCP Resources、Tools、Prompts](../../02-subprojects/tasks/t4.2-mcp-gateway.md) | 将 WCP 和 ai-memory Adapter 的授权能力呈现为 MCP。 | - 负责人：会话连接组 - 前置任务：T4.1、T2.5、T3.2、T3.5 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | 01-contracts/mcp-interface.md；capability negotiation 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | MCP conformance、资源越权、tool idempotency、prompt source fence、client downgrade 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T4.3 workctx CLI](../../02-subprojects/tasks/t4.3-workctx-cli.md) | 提供 resume、checkpoint、handoff、sync、conflicts 和 doctor 的本地工作面。 | - 负责人：会话连接组 - 前置任务：T3.4、T4.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | workctx resume/checkpoint/handoff/sync/conflicts/doctor 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 参数、网络失败、重复、JSON parity、权限、Windows path 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T4.4 Codex/Claude Code/DeepSeek/WorkBuddy 适配](../../02-subprojects/tasks/t4.4-client-adapters.md) | 使用 ai-memory hooks/MCP 和 WorkMesh Gateway 建立客户端注册、能力声明和降级。 | - 负责人：会话连接组 - 前置任务：T4.2、T4.3 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | ClientAdapter、capabilities、install/doctor/finali | 伪客户端、Hook payload、能力降级、切换、finali |

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

- Wave 4A：T4.1 固定 WCP REST 错误/版本/审计路径；T4.2 映射 MCP Resources/Tools/Prompts。
- Wave 4B：T4.3 将 resume/checkpoint/handoff/sync 映射到 CLI。
- Wave 4C：T4.4 接入 Codex、Claude Code、DeepSeek、WorkBuddy capability 和切换。
- Gate P4：同一业务请求的 REST/MCP/CLI 结果和错误语义一致。

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
| DEV-P4-01 | 独立单元/契约实现 | 模块负责人 | 实现 t4.1-api-gateway.md、t4.2-mcp-gateway.md、t4.3-workctx-cli.md、t4.4-client-adapters.md 的正常、校验、幂等、版本和错误路径 | 模块任务完成且公开契约已冻结 | pnpm run test:module -- P4 --isolated | 单元和契约报告，失败路径必须先于实现提交；当前 T4.1 runtime、签名 Webhook 和 MCP JSON-RPC 测试为 10/10 |
| DATA-P4-01 | 真实形状数据模拟 | Fixture/测试负责人 | 同一业务请求的 REST、MCP、CLI transcript；允许/拒绝 scope；过期 token；多个 client capability。 | P0 Fixture 版本和 scope 模型可用 | pnpm run fixture:seed -- --module P4 | seed.json、数据 hash、权限矩阵和清理报告 |
| FUNC-P4-01 | 功能闭环校验 | 模块负责人 | 使用三个入口读取同一个 WorkItem Context、创建 Handoff、claim 和 Resume；比较字段、revision、source_refs、错误码和审计。 | 模块公开接口和替身依赖可启动 | pnpm run test:functional -- --module P4 | 功能 transcript、状态 diff、trace 和 source_refs |
| FAULT-P4-01 | 故障/恢复校验 | 韧性测试负责人 | 注入超时、重复、乱序、断网、重启或上游不可用，按模块边界选择适用场景 | 正常功能通过且故障开关可控 | pnpm run test:resilience -- --module P4 | failure report、replay/restore 证据和副作用检查 |
| SEC-P4-01 | 权限和敏感数据校验 | P6/模块安全负责人 | 覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入 | P6 Policy SDK/替身可用 | pnpm run test:security -- --module P4 | deny decision、audit、side-effect diff |
| PERF-P4-01 | 性能和容量校验 | 性能测试负责人 | 用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试 | 功能和观测指标已接入 | pnpm run test:performance -- --module P4 | performance report、metrics snapshot |
| EVID-P4-01 | 集成交付证据 | 模块负责人/发布组 | 归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤 | 所有本模块测试通过 | pnpm run evidence:bundle -- --module P4 | module verification report + release handoff |

## 5. 真实形状数据模拟

### 5.1 数据范围

同一业务请求的 REST、MCP、CLI transcript；允许/拒绝 scope；过期 token；多个 client capability。

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
