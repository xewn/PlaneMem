# P0 统一契约与开发平台 独立测试与校验规范

> 本文件是 **P0** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P0 统一契约与开发平台`。
- 覆盖任务：T0.1–T0.6。
- 需求追踪：R-005、R-010、R-011。
- 模块边界：Monorepo、基础类型、JSON Schema、Canonical Event、生成 SDK、共享 Fixtures、Compose、迁移和 CI 门禁。
- 产物责任：contracts 包、events 包、SDK、Fixture 版本、Compose 健康结果、迁移报告。

任务设计入口：

- [t0.1-monorepo-ci](../../02-subprojects/tasks/t0.1-monorepo-ci.md)
- [t0.2-foundation-contracts](../../02-subprojects/tasks/t0.2-foundation-contracts.md)
- [t0.3-entity-schemas](../../02-subprojects/tasks/t0.3-entity-schemas.md)
- [t0.4-event-schemas](../../02-subprojects/tasks/t0.4-event-schemas.md)
- [t0.5-sdk-fixtures](../../02-subprojects/tasks/t0.5-sdk-fixtures.md)
- [t0.6-local-infra](../../02-subprojects/tasks/t0.6-local-infra.md)

测试覆盖映射：T0.1、T0.2、T0.3、T0.4、T0.5、T0.6；每个任务的失败路径、Fixture、证据和进入集成门禁均由本文矩阵约束。

## 2. 独立运行边界

### 2.1 允许依赖

无。所有外部能力必须使用本模块的 Mock、Fixture 或本地 Compose 替身。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

`T0.1` 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm build
pnpm run test:module -- P0 --isolated
pnpm run test:contract -- P0
pnpm run test:module -- P0 --isolated --reporter=junit
pnpm run fixture:validate
pnpm run test:e2e -- --chain plane-to-mcp
pnpm run evidence:bundle -- --module P0 --run-id <run_id> --output artifacts/test-reports/P0/<run_id>
```

命令入口的参数、离线/真实环境语义、退出码和证据目录约定统一见[测试命令执行契约](../command-runner-contract.md)。默认命令只验证固定 Fixture 和离线替身；带 `--live` 的真实环境命令在依赖缺失时必须返回 `blocked` 和非零退出码，不能把离线模拟报告当作上线通过。

## 3. 固定 Fixture 和环境

tenant-demo/workspace-demo/project-continuity、最小事件样本、Schema 兼容样本、空库/已有库迁移样本。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p0-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P0-U01 | 单元 | 基础元数据校验 | 缺少 tenant/workspace/project、schema_version 或 trace_id | 返回 VALIDATION_ERROR 且不生成副作用 | JUnit + request snapshot |
| P0-U02 | 单元 | 错误封套稳定性 | 同类错误使用不同入口 | error.code、message、retryable、trace_id 字段保持一致 | JSON snapshot |
| P0-U03 | 单元 | 幂等和并发 | 重复 Idempotency-Key 或落后 expected_version | 重复请求只有一个 effect；落后版本返回 409 且不写入 | effect counter + database diff |
| P0-U04 | 单元 | 时间和版本格式 | 非 UTC 时间、非法 ULID、负分页和未知枚举 | 校验拒绝并保持错误码稳定 | validation corpus |
| P0-C01 | 契约 | JSON Schema/AsyncAPI | 当前 schema 与上一版本的合法、缺字段、未知字段样本 | 兼容矩阵通过；破坏性变更阻断构建 | schema/event diff |
| P0-C02 | 契约 | Canonical Event | 合法、缺字段、未知字段、重复事件 | 合法样本通过；非法样本拒绝；重复不产生副作用 | AsyncAPI report |
| P0-C03 | 契约 | 生成 SDK | SDK 与 HTTP fixture 双向序列化 | 字段、枚举、错误码和分页一致 | SDK parity report |
| P0-I01 | 组件 | 空环境和迁移 | 无预置数据启动 Compose，重复执行 migration | health/readiness/version 全部通过；最终 schema hash 相同 | health.json + migration report |
| P0-I02 | 组件 | 迁移重复执行 | 空库、半迁移库、重复执行 | 最终 schema hash 相同；重复执行无副作用 | migration replay report |
| P0-R01 | 可复现 | 锁文件和产物 | 两次 clean install | 依赖锁、生成文件和 artifact digest 相同 | reproducibility report |
| T0.1/T0.5 | 命令链路 | workspace build、Fixture、集成、故障、计划审计、证据命令 | `pnpm build`、validate/seed/events/backup、`plan:audit`、离线和 live 参数 | build 实际 emit；成功命令返回 0；缺少 live 依赖返回 blocked/非零；证据包含五类必需文件 | `tests/p0/t0-tooling.test.mjs` + command reports |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

Schema 兼容性 100%；生成 SDK 编译 100%；迁移 up/down 100%；健康检查全绿；任何契约破坏都必须阻断构建。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P0/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 8. 独立报告模板

```yaml
module: P0
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
