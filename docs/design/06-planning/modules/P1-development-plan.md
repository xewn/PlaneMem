# P1 Plane 连接器与工作图谱 开发计划

> 本文件是 P1 的独立开发计划。模块可以在替身依赖下并行推进，但必须完成本文的开发任务、真实形状数据模拟、功能校验和交付证据，才能进入统一集成。

## 1. 目标、边界和依赖

- **目标：** Plane capability matrix、REST Client、Webhook 入口、去重/回放、Project/WorkItem observed projection。
- **前置依赖：** P0；固定 Plane 版本、Mock Server 或专用测试实例。
- **下游协接方：** P2、P5、P7、P8。
- **公共约束：** 所有写入携带幂等键和版本条件；所有响应和事件带 scope、trace_id、revision/version、source_refs；所有敏感操作经过 P6 Policy/Audit。
- **模块测试门禁：** [P1 独立测试校验](../../04-testing/modules/P1-independent-verification.md)。
- **模块协接契约：** [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P1)。

## 2. 子任务开发清单

| 子任务 | 目标 | 负责人/依赖 | 输出 | 独立测试重点 |
|---|---|---|---|---|
| [T1.1 Plane 版本与能力矩阵](../../02-subprojects/tasks/t1.1-plane-version-matrix.md) | 锁定 Plane tag/digest、REST/Webhook 版本、支持对象和已知限制。 | - 负责人：Plane 集成组 - 前置任务：T0.6 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | PlaneCapabilityMatrix、assertSupported(capability,version) 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 启动、版本探测、对象能力、升级候选对比 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T1.2 Plane REST Client](../../02-subprojects/tasks/t1.2-plane-rest-client.md) | 封装项目、WorkItem、状态、标签、自定义属性、周期、模块、里程碑、页面、评论、附件、关系和发布 API。 | - 负责人：Plane 集成组 - 前置任务：T0.5、T1.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | PlaneClient.getProject/createWorkItem/updateWorkItem/listAttachments/... 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | mock API、429/5xx、timeout、ETag、权限、分页和附件下载 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T1.3 Webhook 验签与入口](../../02-subprojects/tasks/t1.3-webhook-security.md) | 实现 HMAC-SHA256、时间窗、raw body 校验和安全入队。 | - 负责人：Plane 集成组 - 前置任务：T0.4、T1.1 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | verifyWebhook(rawBody,headers,secret)、acceptWebhook(request) 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 合法签名、篡改 body、重放签名、时钟偏移、缺 header、超大 payload 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T1.4 Webhook 去重、重试、死信与回放](../../02-subprojects/tasks/t1.4-webhook-dedup-replay.md) | 保证重复、乱序、延迟和失败 Webhook 最终一致且可回放。 | - 负责人：Plane 集成组 - 前置任务：T1.3、T0.4 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | deduplicate(delivery_id,event_id)、enqueueRetry、replayDeadLetter 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 重复 100 次、乱序、延迟、消费失败、回放不重复 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |
| [T1.5 Plane ID 映射与工作图谱投影](../../02-subprojects/tasks/t1.5-plane-projection.md) | 把 Plane 外部对象映射为 WorkMesh 引用和 observed projection，不建立第二份可写事实。 | - 负责人：Plane 集成组 - 前置任务：T1.2、T1.4 - 所属子方案：根据任务编号归入对应 P0-P8；子方案入口见 ../P*/README.md。 | resolveExternalRef、applyPlaneEvent、getObservedState 任务输出必须带版本、trace_id、source_refs、scope 和错误封套。事件输出必须遵守 `docs/design/01-contracts/canonical-events.md`。 | 首建、更新、删除、重复、权限、断点重放、一致性扫描 测试必须不依赖未完成的下游任务；需要外部能力时使用 packages/test-fixtures 或明确版本的 Compose 服务。 |

每个子任务必须按固定顺序执行：确认输入契约 → 编写失败测试 → 验证失败 → 实现最小行为 → 运行独立测试 → 更新 Schema/Fixture/追踪矩阵 → 生成版本化交付包。子任务不得直接调用其他任务内部类、数据库或本地文件。

## 3. 开发波次和并行边界

- Wave 1A：T1.1 固定 Plane 版本和能力矩阵。
- Wave 1B：T1.2 与 T1.3 并行开发 REST 读取和 Webhook 验签入口。
- Wave 1C：T1.4 建立去重、重试、死信和回放；T1.5 消费稳定事件生成 projection。
- Gate P1：真实形状的 Project/WorkItem、重复/乱序/延迟 Webhook 和权限传播全部通过。

同一波次内的任务只能共享 P0 公开契约和 Fixture；需要修改公共字段时先更新协接契约和消费方测试，再继续实现。每个波次结束保存一次可恢复的测试环境和变更清单。

## 4. 测试计划任务

这些任务是本模块开发计划的一部分，不能只在发布阶段临时补做。

| 测试计划任务 | 类型 | 责任人 | 工作内容 | 前置条件 | 标准命令 | 完成证据 |
|---|---|---|---|---|---|---|
| DEV-P1-01 | 独立单元/契约实现 | 模块负责人 | 实现 t1.1-plane-version-matrix.md、t1.2-plane-rest-client.md、t1.3-webhook-security.md、t1.4-webhook-dedup-replay.md、t1.5-plane-projection.md 的正常、校验、幂等、版本和错误路径 | 模块任务完成且公开契约已冻结 | pnpm run test:module -- P1 --isolated | 单元和契约报告，失败路径必须先于实现提交 |
| DATA-P1-01 | 真实形状数据模拟 | Fixture/测试负责人 | 两租户、两个 Project、多个 WorkItem、Cycle、Module、Label、Comment、Attachment、版本 1/2/3 和对应 Webhook。 | P0 Fixture 版本和 scope 模型可用 | pnpm run fixture:seed -- --module P1 | seed.json、数据 hash、权限矩阵和清理报告 |
| FUNC-P1-01 | 功能闭环校验 | 模块负责人 | 创建/更新/删除 Plane 对象，接收签名 Webhook，验证 projection revision、source_refs、event_id 去重和 cursor 回放。 | 模块公开接口和替身依赖可启动 | pnpm run test:functional -- --module P1 | 功能 transcript、状态 diff、trace 和 source_refs |
| FAULT-P1-01 | 故障/恢复校验 | 韧性测试负责人 | 注入超时、重复、乱序、断网、重启或上游不可用，按模块边界选择适用场景 | 正常功能通过且故障开关可控 | pnpm run test:resilience -- --module P1 | failure report、replay/restore 证据和副作用检查 |
| SEC-P1-01 | 权限和敏感数据校验 | P6/模块安全负责人 | 覆盖跨租户、跨项目、过期 token、scope escalation、脱敏和提示注入 | P6 Policy SDK/替身可用 | pnpm run test:security -- --module P1 | deny decision、audit、side-effect diff |
| PERF-P1-01 | 性能和容量校验 | 性能测试负责人 | 用固定数据量、并发度、预算和超时阈值验证 p95、队列积压、内存和有界重试 | 功能和观测指标已接入 | pnpm run test:performance -- --module P1 | performance report、metrics snapshot |
| EVID-P1-01 | 集成交付证据 | 模块负责人/发布组 | 归档版本、digest、Schema diff、Fixture、health/readiness/version、测试报告和回滚步骤 | 所有本模块测试通过 | pnpm run evidence:bundle -- --module P1 | module verification report + release handoff |

## 5. 真实形状数据模拟

### 5.1 数据范围

两租户、两个 Project、多个 WorkItem、Cycle、Module、Label、Comment、Attachment、版本 1/2/3 和对应 Webhook。

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
