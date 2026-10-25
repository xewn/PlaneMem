# P1 Plane 连接器与工作图谱 独立测试与校验规范

> 本文件是 **P1** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P1 Plane 连接器与工作图谱`。
- 覆盖任务：T1.1–T1.5。
- 需求追踪：R-002、R-005、R-008。
- 模块边界：Plane 版本矩阵、REST Client、Webhook 验签、去重/重试/死信/回放、ID 映射和 observed projection。
- 产物责任：ProjectSnapshot、WorkItemSnapshot、Canonical Event、projection revision、replay report。

任务设计入口：

- [t1.1-plane-version-matrix](../../02-subprojects/tasks/t1.1-plane-version-matrix.md)
- [t1.2-plane-rest-client](../../02-subprojects/tasks/t1.2-plane-rest-client.md)
- [t1.3-webhook-security](../../02-subprojects/tasks/t1.3-webhook-security.md)
- [t1.4-webhook-dedup-replay](../../02-subprojects/tasks/t1.4-webhook-dedup-replay.md)
- [t1.5-plane-projection](../../02-subprojects/tasks/t1.5-plane-projection.md)

测试覆盖映射：T1.1、T1.2、T1.3、T1.4、T1.5；每个任务的失败路径、Fixture、证据和进入集成门禁均由本文矩阵约束。

## 2. 独立运行边界

### 2.1 允许依赖

P0 契约/SDK/Fixture；Plane 使用版本固定的 Mock Server 或专用测试实例。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

`T0.1` 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P1 --isolated
pnpm run test:contract -- P1
pnpm run test:module -- P1 --isolated --reporter=junit
```

## 3. 固定 Fixture 和环境

Plane Project/WorkItem 两个版本、签名 Webhook、重复/乱序/延迟事件、权限不同的 token。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p1-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P1-U01 | 单元 | 能力矩阵 | 支持/不支持的 Plane 版本和 endpoint | 不支持版本在启动前失败并给出原因 | capability snapshot |
| P1-C01 | 契约 | P0 Schema/Fixture 消费 | P0 发布的事件、错误和 Plane Fixture | 消费方校验通过；未知字段、版本和 scope 处理符合契约 | consumer contract report |
| P1-S01 | 安全 | HMAC 验签和 scope | 正确/错误/过期签名，跨租户 token | 仅正确签名进入队列；拒绝无事件和 projection 副作用 | security report + state diff |
| P1-S02 | 安全 | Webhook 时间窗和重放 | 旧 timestamp、重放 nonce、错误 secret | 返回 UNAUTHENTICATED/duplicate；不进入业务队列 | replay report |
| P1-I01 | 集成 | REST 重试 | 429、5xx、超时、分页 | 按 Retry-After/上限重试；超过上限返回 retryable error | request trace |
| P1-I02 | 集成 | Webhook 去重 | 相同 event_id 投递三次 | 只生成一个 Canonical Event 和一次 projection | event ids + projection diff |
| P1-I03 | 集成 | 乱序与回放 | 版本 3 先于版本 2，再回放版本 2 | 不回退 projection；回放结果可解释 | revision timeline |
| P1-I04 | 集成 | 工作图谱映射 | Project/WorkItem 更新、删除和恢复 | 映射稳定；source_refs 指向 Plane object/version | mapping report |
| P1-R01 | 恢复 | Plane 暂不可用 | 连接器运行期间 Plane down | 不丢 durable event；恢复后按 cursor 补齐 | outbox/replay report |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

验签拒绝 100%；重复事件副作用为 0；事件到 projection p95 ≤3s；回放结果可重现。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P1/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 8. 独立报告模板

```yaml
module: P1
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
