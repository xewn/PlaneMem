# P3 会话、检查点、交接与离线同步 独立测试与校验规范

> 本文件是 **P3** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P3 会话、检查点、交接与离线同步`。
- 覆盖任务：T3.1–T3.5。
- 需求追踪：R-004、R-005、R-006、R-013。
- 模块边界：Session、AgentRun、ToolCall、Checkpoint、Handoff/Resume、SyncCursor、SQLite Outbox、Conflict。
- 产物责任：SessionRef、CheckpointRef、HandoffRef、SyncCursor、ConflictDetected/Resolved、outbox state。

任务设计入口：

- [t3.1-session-model](../../02-subprojects/tasks/t3.1-session-model.md)
- [t3.2-checkpoint-handoff](../../02-subprojects/tasks/t3.2-checkpoint-handoff.md)
- [t3.3-sync-cursor-batch](../../02-subprojects/tasks/t3.3-sync-cursor-batch.md)
- [t3.4-sqlite-outbox](../../02-subprojects/tasks/t3.4-sqlite-outbox.md)
- [t3.5-conflict-service](../../02-subprojects/tasks/t3.5-conflict-service.md)

## 2. 独立运行边界

### 2.1 允许依赖

P0 事件/错误；P2 ContextPack/MemoryRef；网络、Plane、ai-memory 均可用替身模拟。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

`T0.1` 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P3 --isolated
pnpm run test:contract -- P3
pnpm run test:module -- P3 --isolated --reporter=junit
```

## 3. 固定 Fixture 和环境

两个 client session、可 claim 和已 claim handoff、断网 outbox、缺口 cursor、并发版本冲突。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p3-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P3-U01 | 单元 | Session 状态机 | created/running/paused/ended/failed 非法跳转 | 非法跳转拒绝；合法跳转只产生一次事件 | state transition log |
| P3-U02 | 单元 | Checkpoint hash | 相同 session event 序列 | checkpoint revision/hash 可重复；source_refs 完整 | checkpoint snapshot |
| P3-I01 | 集成 | Handoff claim-once | 两个 client 同时 claim 同一 HandoffRef | 只一个成功；另一个返回 already_claimed | claim audit |
| P3-I02 | 集成 | Resume | handoff + ContextPack + capability matrix | 生成权限过滤后的 Resume Pack；不复制未授权正文 | resume report |
| P3-I03 | 集成 | SyncCursor/Outbox | cursor 1、3 到达，缺 cursor 2；进程 kill | 检测 gap 并 replay；重启可读未发送项；drain 幂等 | cursor timeline + SQLite |
| P3-I04 | 集成 | Conflict | 服务器 version 变更后提交旧版本 | 返回 409/ConflictDetected；protected field 不被覆盖 | conflict record |
| P3-I05 | 集成 | 公开状态命令契约 | Session、Handoff、Conflict 的 API/事件/错误封套 | claim、resume、resolve 的版本、审计和错误语义稳定 | state command contract report |
| P3-R01 | 恢复 | Outbox/游标恢复 | 断电、数据库重启、缺口和重复 ack | 恢复后无丢失、无重复 effect，cursor 可继续推进 | recovery replay report |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

claim-once 100%；durable outbox 无丢失；重复/乱序不产生重复副作用；冲突不静默覆盖。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P3/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 7.1 当前自动化实现映射

`tests/p3/t3-session-sync.test.ts` 覆盖任务实现，`tests/contract/p3-session-sync-contract.test.mjs`
校验迁移和包边界。测试名保留本矩阵的测试 ID：

| 测试 ID | 实现断言 |
|---|---|
| P3-U01/T3.1 | Session start 幂等、AgentRun/ToolCall 版本递增、end 状态机和 scope deny |
| P3-U02/T3.2 | 相同事实生成相同 checkpoint hash，source_refs 不丢失 |
| P3-I01/P3-I02/T3.2 | target client、claim-once、重复 claim 和 child resume |
| P3-I03/P3-R01/T3.3/T3.4 | cursor gap、重复 batch、ack regression、SQLite durable drain 和重试 |
| P3-I04/P3-I05/T3.5 | conflict detect/list/resolve、版本保护和 ConflictResolved event |

当前独立运行还包含 `tests/p3/t3-sqlite-live-probe.test.mjs`，它调用
`tools/run-sqlite-live-probe.mjs` 创建文件型 SQLite outbox，执行关闭、复制备份、重新打开、
两行 pending 恢复和一次性 drain；证据目录为 `artifacts/command-reports/sqlite-live-final/`。
该探针把 P3-R01 的进程重启恢复从内存替身提升为真实文件恢复校验，当前 P3 独立结果为 6/6。

本地门禁必须按以下顺序运行：

```powershell
pnpm run test:module -- P3 --isolated
pnpm run test:contract -- P3
pnpm run test:sqlite-live -- --run-id sqlite-live-final --output artifacts/command-reports/sqlite-live-final
pnpm typecheck
pnpm lint
```

## 8. 独立报告模板

```yaml
module: P3
run_id: <uuid>
commit: <sha>
manifest: <digest>
fixture_version: <semver>
status: passed|failed|blocked
required_tests: []
failed_tests: []
side_effect_check: passed|failed
contract_diff: none|approved|breaking
artifacts:
  junit: <path>
  trace: <path>
  health: <path>
  evidence: <path>
owner: <team>
verified_at: <timestamp>
```
