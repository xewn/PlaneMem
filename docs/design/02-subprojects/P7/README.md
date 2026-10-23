# P7 搜索和智能能力

## 目标

在基础闭环稳定后，提供可评测、可确认的搜索、抽取、摘要和建议。

## 依赖

P1、P2、P3、P6

## 任务

T7.1, T7.2, T7.3。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

Golden Dataset、ContextPack、FTS/ai-memory recall、Policy

## 输出

evaluation、intelligence workers、search-service、评测报告

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 当前实现状态（2026-10-21）

| 任务 | 实现边界 | 公共产物 | 自动化验证 | 外部门禁 |
|---|---|---|---|---|
| T7.1 | `workers/evaluation` Golden Dataset 与 deterministic `evaluatePack` | `EvaluationReport`、阈值（来源 ≥98%、下一步 ≥95%、过期 ≤2%、未确认 ≤1%） | `P7-E01/T7.1`；P7 contract | 真实模型/Embedding、人工抽样和 Nightly 回归需在集成环境执行 |
| T7.2 | `workers/intelligence` proposal 生命周期、来源/provenance、注入告警、provider degraded | `Proposal`、`ProposalService`、`ProviderFailure` | `P7-S01/T7.2`、`P7-R01/T7.2`；P7 contract | 真实 provider 限流/超时、P6 policy/audit 端到端需在部署环境验证 |
| T7.3 | `apps/search-service` FTS 默认检索、scope 过滤、可选 vector flag 和 fallback | `SearchHit`、`SearchResult`、`SearchService`、`deploy/search/feature-flags.yaml` | `P7-I01/T7.3`；P7 contract | PostgreSQL FTS、pgvector、ai-memory recall 与性能基准需在 Docker 环境验证 |

P7 的建议只能保持 `proposed`，必须通过显式人工确认才可进入 `verified`；任何输入内容中的 prompt injection 只生成 provenance warning，不能触发工具调用或改变权限。搜索结果必须保留 revision/source_refs，并在向量关闭或不可用时退回 FTS。

## 协接要求

向 P5/P8 提供 proposal API、评测报告和 Feature Flag，不直接改 verified。

## 独立测试

来源完整、下一步、过期、幻觉、注入、回归阈值、人工抽样。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

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

- [T7.1 Golden Context Dataset 与评测](../tasks/t7.1-golden-evaluation.md)
- [T7.2 智能抽取与建议 Worker](../tasks/t7.2-intelligence-workers.md)
- [T7.3 FTS、实体、链接与可选向量检索](../tasks/t7.3-search-vector.md)

## 独立测试与校验规范

- [模块独立测试与校验](../../04-testing/modules/P7-independent-verification.md)
- [模块接口与协接契约](../../03-integration/04-module-interface-contracts.md#P7)
- [模块契约测试矩阵](../../03-integration/05-module-contract-test-matrix.md)
