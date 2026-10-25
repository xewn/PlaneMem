# P7 搜索和智能能力 独立测试与校验规范

> 本文件是 **P7** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P7 搜索和智能能力`。
- 覆盖任务：T7.1–T7.3。
- 需求追踪：R-003、R-009、R-012。
- 模块边界：Golden Context、抽取/建议 Worker、FTS/实体/链接/可选向量检索。
- 产物责任：EvaluationReport、Proposal、SearchHit、source_refs、Feature Flag 状态。

任务设计入口：

- [t7.1-golden-evaluation](../../02-subprojects/tasks/t7.1-golden-evaluation.md)
- [t7.2-intelligence-workers](../../02-subprojects/tasks/t7.2-intelligence-workers.md)
- [t7.3-search-vector](../../02-subprojects/tasks/t7.3-search-vector.md)

## 2. 独立运行边界

### 2.1 允许依赖

P1/P2/P3/P6 的只读/受控接口；模型和向量服务必须可替换并固定版本。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

P7 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P7 --isolated
pnpm run test:contract -- P7
pnpm run test:module -- P7 --isolated --reporter=junit
```

当前自动化映射：

| 测试 | 文件 | 覆盖 |
|---|---|---|
| P7-E01/T7.1 | `tests/p7/t7-intelligence-search.test.ts` | Golden Dataset 版本、确定性 report、来源/下一步阈值 |
| P7-I01/T7.3 | 同上 | FTS scope 隔离、vector 关闭 fallback、source_refs |
| P7-S01/T7.2 | 同上 | prompt injection warning、proposal 不自动 verified、拒绝 |
| P7-R01/T7.2 | 同上 | provider timeout 的 retryable/degraded 结果 |
| P7 contract | `tests/contract/p7-intelligence-contract.test.mjs` | package、dataset、feature flag 边界 |

## 3. 固定 Fixture 和环境

Golden Dataset、多阶段项目、过期事实、相似文件、未确认推断、提示注入样本。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p7-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P7-E01 | 评测 | Golden Context | 固定 dataset 和 prompt 版本 | 可复现；报告记录模型、数据、阈值 | evaluation report |
| P7-E02 | 评测 | 来源和下一步 | 答案/建议引用 source_refs；已知下一动作 | 来源完整率 ≥98%；下一步命中率 ≥95% | fidelity + next-action report |
| P7-E03 | 评测 | 过期与冲突 | 旧 revision、冲突计划、已废弃决策 | 过期混入 ≤2%；显式标记；不自动升级 verified | stale report |
| P7-E04 | 评测 | 模型/索引版本锁定 | 模型、prompt、FTS/embedding index、Golden dataset 版本变化 | EvaluationReport 可重放；版本漂移阻断发布 | evaluation version report |
| P7-S01 | 安全 | 提示注入 | memory、WorkItem、附件含恶意指令 | 不执行工具；proposal 保持 proposed | red-team transcript |
| P7-I01 | 集成 | Search fallback | FTS 命中、无命中、向量关闭 | FTS 默认；向量可选；结果有 revision/source_refs | search trace |
| P7-I02 | 集成 | Proposal 状态和来源 | proposal、verified、rejected、过期 source_refs | 状态不可静默提升；来源和审批可追踪 | proposal integrity report |
| P7-R01 | 恢复 | 模型服务不可用 | 抽取/建议超时或限流 | retryable 或降级结果；不伪造答案 | worker failure report |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

来源完整 ≥98%；关键下一步 ≥95%；过期混入 ≤2%；未确认误标 ≤1%；提示注入不得改变 verified 状态。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P7/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 8. 独立报告模板

```yaml
module: P7
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
