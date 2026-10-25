# P2 上下文、文件、记忆与 ContextPack 独立测试与校验规范

> 本文件是 **P2** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P2 上下文、文件、记忆与 ContextPack`。
- 覆盖任务：T2.1–T2.5。
- 需求追踪：R-003、R-008、R-009、R-013。
- 模块边界：Artifact metadata、ai-memory Adapter、L0–L4、ContextPack 编译、FTS 和 MCP Resource。
- 产物责任：ArtifactRef、MemoryRef、MemoryHit、SourceReference、ContextPack、page revision/hash。

任务设计入口：

- [t2.1-artifact-metadata](../../02-subprojects/tasks/t2.1-artifact-metadata.md)
- [t2.2-memory-adapter](../../02-subprojects/tasks/t2.2-memory-adapter.md)
- [t2.3-context-layers](../../02-subprojects/tasks/t2.3-context-layers.md)
- [t2.4-context-compiler](../../02-subprojects/tasks/t2.4-context-compiler.md)
- [t2.5-fts-resources](../../02-subprojects/tasks/t2.5-fts-resources.md)

## 2. 独立运行边界

### 2.1 允许依赖

P0 契约/Fixture；P1 projection 使用 fixture；ai-memory 使用固定版本、隔离 wiki 和 SQLite derived index。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

`T0.1` 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P2 --isolated
pnpm run test:contract -- P2
pnpm run test:module -- P2 --isolated --reporter=junit
pnpm run test:memory-live -- --output artifacts/command-reports/ai-memory-live-probe-current
```

## 3. 固定 Fixture 和环境

已确认决策、未确认候选、过期记忆、敏感附件、同名文件、来源版本和预算边界。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p2-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P2-U01 | 单元 | Artifact hash | 相同字节、不同文件名、不同版本 | 字节 hash 稳定；版本和来源可区分 | hash snapshot |
| P2-U02 | 单元 | L0–L4 排序和预算 | 决策、风险、候选、历史及不足 budget | 排序/截断稳定；保留 source_refs；不得把 proposed 标为 verified | ContextPack + budget snapshot |
| P2-C01 | 契约 | ai-memory Adapter | capture、recall、consolidate、handoff、claim、restore | 映射到统一 MemoryRef/错误封套；revision 可核对 | adapter contract report |
| P2-I01 | 集成 | capture/recall 真源 | 写入脱敏内容后查询 | 只返回授权 scope；Markdown 是真源；SQLite 是派生索引 | memory revision + db hash |
| P2-I02 | 集成 | ContextPack/MCP Resource | 相同输入和 resource URI 分页、无权限请求 | pack hash 相同；来源可追溯；拒绝无正文泄露 | pack.json + MCP transcript |
| P2-I03 | 集成 | MCP Resource 边界 | 分页、未知 URI、过期 revision、跨 scope 请求 | resource 与 REST 语义一致；拒绝不泄露正文；错误可诊断 | MCP boundary report |
| P2-R01 | 恢复 | ai-memory 不可用 | capture/recall 超时或服务停止 | 返回 retryable；不伪造 verified 内容；恢复后可补偿 | failure trace |

当前 Compose 真实 ai-memory 3.1.1 服务已通过 `pnpm run test:memory-live` 执行合成 page 的写入、FTS 搜索、删除和删除后零命中复查；证据见
[`ai-memory-live-probe-current`](../../../../artifacts/command-reports/ai-memory-live-probe-current/)。该探针证明真实记忆源和派生索引可用，不替代 MCP transport、capture hook、handoff claim-once 和 RC 故障恢复门禁。

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

ContextPack hash 稳定 100%；来源完整 ≥98%；过期混入 ≤2%；未确认误标 ≤1%；越权返回 0 内容。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P2/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 7.1 当前自动化实现映射

当前仓库将 P2 的可重复门禁实现为 `tests/p2/t2-context.test.ts` 和
`tests/contract/context/t2-context-contract.test.mjs`。测试名称必须继续使用任务编号，
以便报告和需求追踪可以反向定位实现：

| 任务 | 自动化覆盖 | 关键断言 |
|---|---|---|
| T2.1 | Artifact 元数据、hash mismatch、scope deny、幂等重试、版本读取和恢复 | 正文只进入对象存储替身；版本冲突/不存在均含诊断错误 |
| T2.2 | capture sanitize、reference-only、recall scope、claim-once、consolidate revision、provider off | ai-memory 正文不进入 `MemoryRef`；越权和 provider 不可用 fail-closed |
| T2.3 | L0-L4 排序、classification policy、过期过滤 | 未确认候选不能提高为 verified；每个选中项保留选择原因 |
| T2.4 | budget、关键约束保留、source refs、稳定 pack hash、Markdown/MCP parity | 相同输入得到相同 hash；裁剪原因写入 `exclusions` |
| T2.5 | 项目 scope、空结果 fallback、resource URI、跨项目拒绝 | 结果只能来自授权 pack，未知 URI 不产生正文 |

标准执行顺序为：

```powershell
pnpm run test:module -- P2 --isolated
pnpm run test:contract -- P2
pnpm typecheck
pnpm lint
```

在独立环境运行时，还必须把 `003_artifacts` migration、`context-item.json`、
`@planemem/domain/memory` 和 `@planemem/context-service` 的版本写入同一份证据包。

## 8. 独立报告模板

```yaml
module: P2
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
