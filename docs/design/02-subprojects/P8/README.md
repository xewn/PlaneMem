# P8 统一发布、质量与私有化交付

## 目标

把所有子项目放进同一套构建、集成、部署、备份、回滚和上线流程。

## 依赖

P0 起，贯穿全部 P

## 任务

T8.1, T8.2, T8.3。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

所有镜像、Schema、迁移、测试、Feature Flags

## 输出

Compose、Helm、Release Manifest、CI/CD、Runbook、SBOM

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 协接要求

向生产提供一个可复现版本；任何未通过门禁的组件不能进入发布清单。

## 独立测试

集成/E2E、故障、性能、安全、备份恢复、升级回滚、生产 Smoke。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

## 进入集成条件

- 本子方案所有任务状态为 verifiederified；
- 契约变更已更新 Schema/SDK/Fixtures/追踪矩阵；
- 独立测试报告已归档；
- 迁移、配置、密钥、健康检查和回滚说明齐全；
- 集成负责人已确认输入输出版本。

## 退出条件

- 通过对应 PR/Merge/Nightly/RC 门禁；
- 产生可供下游使用的镜像或包、版本、契约和运行说明；
- 没有未记录的私有数据格式或跨库依赖。

## 任务文档

- [$_](../tasks/t8.1-integration-e2e-resilience.md)
- [$_](../tasks/t8.2-compose-helm.md)
- [$_](../tasks/t8.3-release-rollback.md)


