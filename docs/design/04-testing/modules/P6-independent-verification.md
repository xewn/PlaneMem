# P6 安全、治理与观测 独立测试与校验规范

> 本文件是 **P6** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P6 安全、治理与观测`。
- 覆盖任务：T6.1–T6.3。
- 需求追踪：R-007、R-009、R-011。
- 模块边界：身份、RBAC/OPA Policy、数据分类、审批、审计、OTel、metrics、logs 和告警。
- 产物责任：PolicyDecision、AuditRecord、TraceContext、redaction report、alert evidence。

任务设计入口：

- [t6.1-identity-policy](../../02-subprojects/tasks/t6.1-identity-policy.md)
- [t6.2-audit-governance](../../02-subprojects/tasks/t6.2-audit-governance.md)
- [t6.3-observability](../../02-subprojects/tasks/t6.3-observability.md)

## 2. 独立运行边界

### 2.1 允许依赖

P0 契约；Keycloak/OPA/OTel 使用隔离 Compose；其他模块使用 SDK stub 验证接入。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

P6 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P6 --isolated
pnpm run test:contract -- P6
pnpm run test:module -- P6 --isolated --reporter=junit
pnpm run test:identity-audit -- --live --run-id <run_id> --output artifacts/command-reports/<run_id>
# OPA overlay live integration (test-only)
docker compose -p planemem-local -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.local-test.yml -f deploy/compose/docker-compose.opa-test.yml up -d opa workctx
```

当前自动化映射如下：

| 测试 | 文件 | 覆盖 |
|---|---|---|
| P6-S01/T6.1 | `tests/p6/t6-security-observability.test.ts` | 过期 token、scope 不一致、缺少 capability、health |
| P6-S02/T6.2 | 同上 | 审计字段完整、幂等重放、分类脱敏、导出记录、scope 查询 |
| P6-S03/T6.3 | 同上 | trace 父子 span、metrics 高基数拒绝、degraded health |
| P6-S04/T6.1/T6.2 | `tests/p6/t6-security-observability.test.ts`、`tests/p6/t6-runtime-audit.test.ts`、`tests/p6/t6-identity-audit-live.test.mjs`、`tools/run-identity-audit-live-probe.mjs` | OPA REST allow/deny/fail-closed、运行时允许/拒绝审计、审计持久化不可用时 HTTP 503/trace 且进程不退出、Keycloak password grant/Bearer claims、运行时审计指标递增、PostgreSQL `wcp_audit_records` 持久化/清理和 OPA decision log；RC OPA/审计持久化仍需目标环境复核 |
| P6 contract | `tests/contract/p6-security-contract.test.mjs` | auth/policy/audit/observability package、OPA 默认拒绝、Keycloak realm |

独立实现的内存替身只证明 SDK、策略和数据不变量；`environment.json` 必须明确记录真实 Keycloak、OPA、PostgreSQL、OTel Collector 是否已启动，不能把替身结果标为线上集成通过。

## 3. 固定 Fixture 和环境

两租户三角色、过期 token、敏感分类、审批记录、审计查询和 trace parent。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p6-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P6-S01 | 安全 | 租户隔离 | tenant A token 访问 tenant B | deny；下游未调用；无正文泄露 | policy + side-effect diff |
| P6-S02 | 安全 | scope escalation/审批 | 低权限请求高风险 Tool；proposed promotion 无 approval | deny reason 稳定；有审批且未过期才允许 | decision + approval audit |
| P6-S03 | 安全 | 注入/恶意文档 | 工具参数、WorkItem、memory 含指令注入 | 不执行命令；不改变 policy decision | red-team report |
| P6-S04 | 安全 | 分类和 promotion gate | 敏感数据导出、proposal promotion、过期审批 | 分类、审批和脱敏全部满足才允许；否则 fail-closed | governance gate report |
| P6-I01 | 集成 | 审计完整性 | 允许、拒绝、导出、恢复、删除 | 含 actor/client/session/scope/trace/result | audit completeness |
| P6-I02 | 集成 | Trace propagation | Gateway→service→event→worker | trace_id/span_id 可关联；无孤儿关键操作 | trace graph |
| P6-R01 | 恢复 | Policy/OTel down | 策略服务或 collector 不可用 | 安全操作 fail-closed；降级有告警 | degradation report |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

越权副作用 0；审计完整性 100%；敏感字段脱敏 100%；trace 贯穿率 100%；关键告警可触发。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P6/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 8. 独立报告模板

```yaml
module: P6
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
