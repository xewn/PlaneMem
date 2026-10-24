# P5 Web 工作台 独立测试与校验规范

> 本文件是 **P5** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P5 Web 工作台`。
- 覆盖任务：T5.1–T5.3。
- 需求追踪：R-001、R-006、R-007、R-011。
- 模块边界：项目/工作项查询、上下文、交接、冲突、审计、管理和发布健康界面。
- 产物责任：Playwright report、可访问性报告、Smoke artifact、用户可见错误状态。

任务设计入口：

- [t5.1-workbench-query](../../02-subprojects/tasks/t5.1-workbench-query.md)
- [t5.2-workbench-handoff-conflict](../../02-subprojects/tasks/t5.2-workbench-handoff-conflict.md)
- [t5.3-workbench-admin](../../02-subprojects/tasks/t5.3-workbench-admin.md)

## 2. 独立运行边界

### 2.1 允许依赖

P1/P2/P3/P4 查询与写入接口；P6 Policy/Audit/Trace；浏览器使用固定 seed 和 API stub。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

`T0.1` 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P5 --isolated
pnpm run test:contract -- P5
pnpm run test:module -- P5 --isolated --reporter=junit
```

## 3. 固定 Fixture 和环境

两租户、多项目、两个 session、冲突、无权限和服务不可用 UI 状态。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p5-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P5-U01 | 组件 | 查询状态 | loading/empty/error/stale/success | 每种状态有稳定文案、trace_id 或重试入口 | component snapshots |
| P5-I01 | E2E | 项目/工作项旅程 | 打开项目、筛选 WorkItem、查看来源 | 只展示授权数据；source link 可定位 | Playwright trace |
| P5-I02 | E2E | Handoff/Resume | 查看候选、claim、resume | claim 冲突可解释；成功后 session 状态更新 | video + trace |
| P5-I03 | E2E | Conflict center | 旧版本提交和解决 | 展示双方版本、protected fields、审计；刷新一致 | conflict evidence |
| P5-S01 | 安全/可访问性 | 租户隔离和键盘 | 跨租户 URL、tab 顺序、表单错误 | 无数据泄露；无阻断级可访问性问题 | security + axe report |
| P5-A01 | 可访问性/构建 | 前端 artifact 和 Smoke | 固定依赖、生产构建、键盘/屏幕阅读器路径 | 构建可重现；Smoke 可定位版本；无阻断级可访问性问题 | build + accessibility report |
| P5-R01 | 恢复 | Gateway/Policy down | 加载、提交、刷新期间下游不可用 | 保留未提交输入；不显示旧授权数据 | failure screenshot |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

关键旅程 100%；越权页面不显示正文；键盘可达；主要错误态有恢复动作；Smoke ≤5min。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P5/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 7.1 当前自动化实现映射

`tests/p5/t5-workbench.test.ts` 覆盖工作台状态模型，`tests/contract/p5-workbench-contract.test.mjs`
校验 web console package 和页面边界：

| 测试 ID | 实现断言 |
|---|---|
| P5-U01/T5.1 | 项目数据优先、source_refs 保留、empty/denied/error/stale 状态可见 |
| P5-I01/T5.2 | claim/resume 和 conflict resolve 都要求显式确认并保留 trace |
| P5-S01/T5.3 | 普通用户被拒绝，管理员可见 release/audit/health，服务异常标记 stale |

## 8. 独立报告模板

```yaml
module: P5
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
