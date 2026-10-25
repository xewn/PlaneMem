# 统一测试、真实数据模拟与功能校验计划

## 1. 目的

本计划把“测试代码怎么写、真实形状数据怎么造、功能是否真的工作、失败后怎么证明没有副作用”拆成可独立执行的计划任务。数据使用合成值，但保留生产对象关系、版本、权限、事件顺序和故障形状。

## 2. 共享数据域

| 数据域 | 模拟内容 | 权威来源 | 关键校验 |
|---|---|---|---|
| Plane | tenant、workspace、project、work item、cycle、module、label、comment、attachment、revision | Plane | Webhook 验签、projection、source_refs、权限 |
| Memory | Markdown wiki page、revision、SQLite FTS 派生索引、capture/recall/handoff | ai-memory Markdown | Markdown 真源、SQLite 可重建、claim-once、restore |
| Context | L0–L4、决策、风险、候选、过期内容、budget | WorkMesh compiler | 权限、hash、来源、截断、proposed/verified |
| Session | client、session、agent run、tool call、checkpoint、handoff | WorkMesh | 状态机、父子关系、resume、claim |
| Sync | event、cursor、outbox、duplicate、gap、conflict | Event/SQLite/Postgres | 幂等、replay、零丢失、409 |
| Governance | tenant/role/scope、classification、approval、audit、trace | P6 | deny 无副作用、脱敏、审计完整、trace 关联 |
| Release | image digest、Schema、migration、flag、backup、可选 SBOM | P8 Manifest | 可重放、恢复、回滚、版本一致；漏洞报告不作为功能门禁 |

## 3. 测试计划任务

| 任务 ID | 任务 | 责任人 | 前置条件 | 标准命令 | 产出 | 通过条件 |
|---|---|---|---|---|---|---|
| TEST-001 | Fixture Schema 和版本 | P0 Fixture 组 | P0 Schema/SDK | pnpm run fixture:validate | `fixture-schema-v1`、seed 校验器 | 非法数据在 seed 前拒绝 |
| TEST-002 | Plane 真实形状 seed | P1 测试组 | P0、P1 Mock | pnpm run fixture:seed -- --fixture plane-real-shape | Project/WorkItem/Webhook 数据包 | object/version/source_ref 可回溯 |
| TEST-003 | ai-memory 真实形状 seed | P2 测试组 | P0、固定 ai-memory | pnpm run fixture:seed -- --fixture memory-real-shape | Markdown pages、revision、SQLite rebuild | 真源/派生索引 hash 可核对 |
| TEST-004 | ContextPack Golden seed | P2/P7 测试组 | P1、P2 | pnpm run fixture:seed -- --fixture context-golden | L0–L4、过期、候选、风险数据 | 相同 seed 生成相同 pack hash |
| TEST-005 | Session/交接 seed | P3 测试组 | P2、P3 | pnpm run fixture:seed -- --fixture session-handoff | 两客户端 session、checkpoint、handoff | claim-once 和 resume 输入完整 |
| TEST-006 | 权限和治理 seed | P6 测试组 | P0、P6 | pnpm run fixture:seed -- --fixture governance | 两租户三角色、分类、审批 | 每个用例都有 allow/deny 预期 |
| TEST-007 | 事件故障生成器 | P1/P3 韧性组 | P0、P1、P3 | pnpm run fixture:events -- --scenario duplicate-gap-delay | duplicate、out-of-order、gap、delay 数据 | 可按 seed 重放且 event IDs 可追踪 |
| TEST-008 | 备份和恢复样本 | P8 发布测试组 | P2、P3、P8 | pnpm run fixture:backup -- --manifest <digest> | Postgres/SQLite/Markdown/Manifest 备份 | 恢复后 revision/hash/event IDs 一致 |
| TEST-009 | 模块单元/契约门禁 | 各模块负责人 | 各模块任务 | pnpm run test:module -- <P> --isolated | JUnit、contract diff、失败样本 | 必选测试全绿，失败退出码非零 |
| TEST-010 | 功能主路径校验 | P1–P4 集成组 | P1–P4 | pnpm run test:e2e -- --chain plane-to-mcp | Plane→ContextPack→MCP transcript | 输出带来源、权限和 revision |
| TEST-011 | 跨客户端切换校验 | P3/P4 集成组 | P3、P4 | pnpm run test:e2e -- --chain client-switch | Codex→Claude→WorkBuddy transcript | claim-once、Resume、写回和审计通过 |
| TEST-012 | 离线/冲突校验 | P3 韧性组 | P3 | pnpm run test:resilience -- --scenario offline-conflict | outbox、重启、409、Conflict report | 无丢失、无静默覆盖、可人工解决 |
| TEST-013 | UI 旅程校验 | P5 前端测试组 | P4、P5、P6 | pnpm run test:e2e -- --suite workbench | Playwright、axe、错误态截图 | 关键旅程、租户隔离和可访问性通过 |
| TEST-014 | 智能 Golden 回归 | P7 评测组 | P2、P6、P7 | pnpm run test:evaluation -- --dataset golden-context | EvaluationReport、人工抽样 | 来源 ≥98%、下一步 ≥95%、过期 ≤2% |
| TEST-015 | 故障恢复校验 | P8 韧性组 | P8 | pnpm run test:resilience -- --scenario dependency-down | Plane/DB/Policy/ai-memory down/up 报告 | retryable、fail-closed、恢复可重放 |
| TEST-016 | 性能和容量校验 | P8 性能组 | P6、P8 | pnpm run test:performance -- --profile release | p95、backlog、内存、预算报告 | Resume ≤5s、projection ≤3s、ack ≤1s |
| TEST-017 | 发布和回滚校验 | P8 发布组 | P8 | pnpm run test:release -- --scenario restore-rollback | install/upgrade/restore/rollback/可选 SBOM | manifest 可重放且无数据丢失；漏洞报告不阻断 |
| TEST-018 | 证据归档和追踪 | 测试与发布组 | 全部模块 | pnpm run evidence:bundle -- --run-id <uuid> | test manifest、trace bundle、requirements links | 每个失败/成功可定位到任务和协接边 |

## 4. 标准模拟运行

```powershell
pnpm build
pnpm run fixture:validate
pnpm run fixture:seed -- --fixture tenant-demo --version 1
pnpm run test:module -- P2 --isolated
pnpm run test:contract -- --edge IF-P2-P3
pnpm run test:e2e -- --chain plane-to-mcp
pnpm run test:e2e -- --chain client-switch
pnpm run test:resilience -- --scenario offline-conflict
pnpm run plan:audit
pnpm run rc:readiness -- --offline
pnpm run evidence:bundle -- --run-id <uuid>
```

命令名称由 T0.1/T0.5 暴露；如果实现技术栈不同，必须保持语义、参数、退出码和证据目录兼容，不得让每个模块自定义不可组合的命令。

当前实现入口位于 `tools/`：`fixture-cli.mjs`、`run-functional-tests.mjs`、`run-resilience-tests.mjs`、`run-security-tests.mjs`、`run-identity-audit-live-probe.mjs`、`run-performance-tests.mjs`、`run-evaluation-tests.mjs`、`run-release-tests.mjs` 和 `evidence-cli.mjs`。参数、离线/真实状态和证据字段以 [统一测试命令与证据契约](../04-testing/command-runner-contract.md) 为准。

## 5. 功能校验的共同断言

- 权威事实仍由 Plane 或 ai-memory Markdown 管理；
- `proposed`、`observed`、`verified` 状态不可被智能 Worker 或客户端静默转换；
- 拒绝、重复、超时和版本冲突不产生未声明副作用；
- ContextPack 和 MemoryHit 始终包含来源、revision/hash、scope 和 classification；
- 事件、审计、outbox、数据库和 UI 显示都能通过 trace_id 关联；
- 恢复、回滚和重放后，结果可以由 manifest、event IDs 和 hash 重建。

## 6. 计划任务完成定义

- [ ] 每个 TEST-* 都有 owner、依赖、命令、Fixture、输出和阈值；
- [ ] 每个 P0–P8 计划至少引用一个真实数据、功能、故障、安全和性能任务；
- [ ] 所有模拟数据可重复、可清理、无真实敏感信息；
- [ ] 测试结果被 `requirements-matrix.yaml`、模块报告和 Release Manifest 引用；
- [ ] 集成和上线只消费已归档的测试证据，不接受口头通过。
