# P2 上下文、文件、记忆与 ContextPack

## 目标

以 ai-memory 为记忆引擎，编译可追踪、可授权、可预算的跨客户端上下文。

## 依赖

P0、P1 映射接口

## 任务

T2.1, T2.2, T2.3, T2.4, T2.5。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

Plane 投影、ai-memory Adapter、文件存储、决策/风险/会话

## 输出

artifact-service、MemoryService Adapter、Context Compiler、FTS/MCP Resources

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 协接要求

向 P3/P4/P5/P7 提供 ContextPack、MemoryHit、SourceReference 和 page revision；正文不复制到其他库。

## 独立测试

确定性、来源、权限、预算、hash、ai-memory capture/recall/handoff/restore。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

## 进入集成条件

- 本子方案所有任务状态为 verified；
- 契约变更已更新 Schema/SDK/Fixtures/追踪矩阵；
- 独立测试报告已归档；
- 迁移、配置、密钥、健康检查和回滚说明齐全；
- 集成负责人已确认输入输出版本。

## 当前实现状态

| 任务 | 实现边界 | 独立验证 | 外部门禁 |
|---|---|---|---|
| T2.1 | `apps/artifact-service`、`deploy/migrations/003_artifacts.sql` | Artifact hash、scope、幂等、版本恢复 | PostgreSQL/对象存储 live migration |
| T2.2 | `apps/context-service/src/memory-adapter`、`packages/domain/src/memory` | sanitize、reference-only、scope、claim-once、revision、provider off | ai-memory HTTP/MCP 固定版本 |
| T2.3 | `packages/context-compiler/src/layers`、`schemas/context-item.json` | L0-L4 排序、策略、过期、选择原因 | P6 policy SDK 集成 |
| T2.4 | `packages/context-compiler/src/compile.ts` | budget、关键约束、hash、source refs、三种渲染 | 客户端真实预算矩阵 |
| T2.5 | `apps/context-service/src/search`、`resources` | scope、fallback、MCP URI、跨项目拒绝 | FTS/SQLite rebuild 和 MCP gateway |

本地门禁通过 `pnpm run test:module -- P2 --isolated`、`pnpm run test:contract -- P2`、
`pnpm typecheck` 和 `pnpm lint` 执行。ai-memory、PostgreSQL、对象存储和 Docker Compose
未在当前主机启动时，报告必须标记为外部环境门禁，不能把内存替身测试描述为 live 验证。

## 退出条件

- 通过对应 PR/Merge/Nightly/RC 门禁；
- 产生可供下游使用的镜像或包、版本、契约和运行说明；
- 没有未记录的私有数据格式或跨库依赖。

## 任务文档

- [T2.1 Artifact、文件版本与对象存储](../tasks/t2.1-artifact-metadata.md)
- [T2.2 ai-memory MemoryService Adapter](../tasks/t2.2-memory-adapter.md)
- [T2.3 L0-L4 上下文层和 MemoryItem](../tasks/t2.3-context-layers.md)
- [T2.4 ContextPack 编译器](../tasks/t2.4-context-compiler.md)
- [T2.5 全文检索与 Context MCP Resource](../tasks/t2.5-fts-resources.md)

## 独立测试与校验规范

- [模块独立测试与校验](../../04-testing/modules/P2-independent-verification.md)
- [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P2)
- [模块契约测试矩阵](../../03-integration/05-module-contract-test-matrix.md)
