# P4 统一 MCP、REST、CLI 与客户端连接器

## 目标

让 Codex、Claude Code、DeepSeek、WorkBuddy 和通用客户端共享同一 WCP 能力。

## 依赖

P0、P2、P3、P6

## 任务

T4.1, T4.2, T4.3, T4.4。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

WCP、MCP、客户端能力、Policy/Audit

## 输出

api-gateway、mcp-gateway、workctx CLI、adapter-sdk、客户端矩阵

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 协接要求

向 P5/P8 提供稳定入口；所有客户端动作必须经过同一策略和审计路径。

## 独立测试

MCP conformance、REST/CLI parity、伪客户端切换、权限和审计。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

## 进入集成条件

- 本子方案所有任务状态为 verified；
- 契约变更已更新 Schema/SDK/Fixtures/追踪矩阵；
- 独立测试报告已归档；
- 迁移、配置、密钥、健康检查和回滚说明齐全；
- 集成负责人已确认输入输出版本。

## 退出条件

- 通过对应 PR/Merge/Nightly/RC 门禁；
- 产生可供下游使用的镜像或包、版本、契约和运行说明；
- 没有未记录的私有数据格式或跨库依赖。

## 任务文档

- [T4.1 REST API Gateway](../tasks/t4.1-api-gateway.md)
- [T4.2 MCP Resources、Tools、Prompts](../tasks/t4.2-mcp-gateway.md)
- [T4.3 workctx CLI](../tasks/t4.3-workctx-cli.md)
- [T4.4 Codex/Claude Code/DeepSeek/WorkBuddy 适配](../tasks/t4.4-client-adapters.md)

## 独立测试与校验规范

- [模块独立测试与校验](../../04-testing/modules/P4-independent-verification.md)
- [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P4)
- [模块契约测试矩阵](../../03-integration/05-module-contract-test-matrix.md)

## 当前实现状态

| 任务 | 实现边界 | 独立验证 | 外部门禁 |
|---|---|---|---|
| T4.1 | `apps/api-gateway` | REST route、HTTP runtime、policy、trace、错误映射、限流 | identity provider、Audit 和外部依赖联调 |
| T4.2 | `apps/mcp-gateway`、`apps/api-gateway` HTTP runtime | initialize、tools、resources、prompts、tool error parity；签名 Plane Webhook 和 MCP JSON-RPC | 本地/三节点 transport 探针已通过；生产客户端 transport conformance 仍为外部门禁 |
| T4.3 | `apps/workctx-cli` | JSON parity、命令参数和 usage error | 安装包和 Windows shell smoke |
| T4.4 | `integrations/*`、`support-matrix.yaml` | capability negotiation、budget downgrade、doctor/finalize | Codex/Claude live hook E2E |

四个入口共用 `@planemem/api-gateway` 的 `CommandRouter`；实现代码不得在 MCP 或 CLI
中复制领域规则。T4.1 当前已具备可启动 HTTP runtime；runtime 同时承载签名
`POST /v1/plane/webhook` 和 `POST /mcp` JSON-RPC。正式传输镜像和三节点 k3s 证据位于
`artifacts/test-reports/k3s/20261022T0024-transport/`。标准门禁为
`pnpm run test:module -- P4 --isolated`、
`pnpm run test:contract -- P4`、`pnpm typecheck` 和 `pnpm lint`。
