# P4 统一 MCP、REST、CLI 与客户端连接器 独立测试与校验规范

> 本文件是 **P4** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P4 统一 MCP、REST、CLI 与客户端连接器`。
- 覆盖任务：T4.1–T4.4。
- 需求追踪：R-001、R-004、R-007、R-011。
- 模块边界：REST Gateway、MCP Resources/Tools/Prompts、workctx CLI、Codex/Claude Code/DeepSeek/WorkBuddy adapters。
- 产物责任：WCP v1 response、MCP transcript、CLI exit code、adapter capability report。

本轮真实客户端验证只使用 `E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1`；其他 adapter 仅通过内部 fixture 和契约测试验证，不启动或接入外部 Codex、Claude、DeepSeek 或 WorkBuddy 进程。

任务设计入口：

- [t4.1-api-gateway](../../02-subprojects/tasks/t4.1-api-gateway.md)
- [t4.2-mcp-gateway](../../02-subprojects/tasks/t4.2-mcp-gateway.md)
- [t4.3-workctx-cli](../../02-subprojects/tasks/t4.3-workctx-cli.md)
- [t4.4-client-adapters](../../02-subprojects/tasks/t4.4-client-adapters.md)

## 2. 独立运行边界

### 2.1 允许依赖

P0 契约；P2 ContextPack；P3 Session/Handoff；P6 Policy/Audit/Trace SDK。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

`T0.1` 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P4 --isolated
pnpm run test:contract -- P4
pnpm run test:module -- P4 --isolated --reporter=junit
```

## 3. 固定 Fixture 和环境

同一请求的 REST、MCP、CLI transcript；能力矩阵；允许/拒绝 scope；伪客户端。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p4-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P4-C01 | 契约 | REST/MCP/CLI parity | 同一 get context、handoff、resume 请求 | 字段、错误码、source_refs 和 revision 一致 | parity diff |
| P4-C02 | 契约 | MCP conformance | resources/tools/prompts、分页、错误 | 符合 MCP 契约；未知能力可协商 | MCP conformance report |
| P4-S01 | 安全 | Policy gate | 允许、拒绝、过期 token、scope escalation | 拒绝不调用下游写入，不产生事件副作用 | policy trace |
| P4-I01 | 集成 | 客户端切换 | Codex 创建、Claude claim、WorkBuddy 查询 | client_id 和 capability 不丢失；Resume 可继续 | client transcript |
| P4-I02 | 集成 | 错误映射和重启 | timeout、409、429、Gateway restart、重复 key | 各入口映射一致；服务端只产生一个 effect | error parity + gateway trace |
| P4-R01 | 恢复 | 客户端能力矩阵恢复 | Gateway 重启、旧客户端、未知 capability | 版本协商稳定；降级不丢 scope、trace、审计和 resume 状态 | capability recovery report |
| P4-R02 | runtime | 正式 HTTP runtime | `/health`、`/health/ready`、`/version`、index/search、非法 JSON、缺失 scope/capability | 端点状态、版本、scope、trace/source_refs 和错误封套稳定 | k3s runtime evidence |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

REST/MCP/CLI 语义等价 100%；越权副作用为 0；trace/audit 覆盖率 100%；旧客户端兼容性通过。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P4/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 7.1 当前自动化实现映射

`tests/p4/t4-gateways.test.ts`、`tests/p4/t4-runtime.test.ts` 与 `tests/contract/p4-gateway-contract.test.mjs` 固定以下断言：

| 测试 ID | 实现断言 |
|---|---|
| P4-C01/T4.1 | REST route 使用共享 router，policy deny、trace、限流和错误码稳定 |
| P4-C02/T4.2 | MCP initialize/tools/resources/prompts、tool error 和 source fence |
| P4-U01/T4.3 | workctx 命令 JSON 输出与共享 command result 一致，非法参数返回 usage error |
| P4-I01/T4.4 | Codex/Claude/DeepSeek/WorkBuddy 能力协商、预算降级和 finalize |
| P4-R02/T4.1 | 可启动 HTTP runtime 的 health/readiness/version、scope 隔离、trace/source_refs、policy deny 和请求错误映射 |
| P4-C02/T4.2 | 签名 `POST /v1/plane/webhook` 的 canonical event 验签、重复投递/乱序投影语义，以及 `POST /mcp` JSON-RPC 的 initialize、tools/list、tools/call、resources/list/read |

契约测试还校验三个 gateway 包的版本化 exports 与 `integrations/support-matrix.yaml`。

当前 `pnpm run test:module -- P4 --isolated` 为 10/10，包含 runtime 启动、签名 Plane Webhook、
MCP HTTP JSON-RPC、scope、错误映射和幂等写入复放；正式传输镜像的本机与三节点 k3s 证据见
`artifacts/test-reports/k3s/20261022T0024-transport/`。

## 8. 独立报告模板

```yaml
module: P4
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
