# P0 统一契约与开发平台

## 目标

建立所有团队共享的 Monorepo、契约、事件、Fixtures、CI 和本地基础设施。

## 依赖

无

## 任务

T0.1, T0.2, T0.3, T0.4, T0.5, T0.6。每个任务的独立设计位于 ../tasks/，任务之间只通过 01-contracts 和 03-integration 定义的接口协作。

## 输入

前置任务的版本化输出、`docs/design/01-contracts` 契约、`packages/test-fixtures` 共享 Fixtures，以及本任务声明的运行配置和权限上下文。

ReadMe 设计基线、R-001..R-012、WCP v1

## 输出

packages/contracts、packages/events、packages/sdk、test-fixtures、Compose、CI、ADR

## 详细实现范围

- 所有对外接口先登记在 docs/design/01-contracts；
- 所有外部依赖、数据表、事件和 Feature Flag 必须在本子方案文档中登记；
- 所有写入遵守 idempotency、optimistic concurrency、trace 和 audit；
- 所有错误必须返回统一错误封套；
- 所有服务提供 health/readiness/metrics/version；
- 所有敏感内容都必须经过 P6 Policy；
- 所有跨子方案引用都必须通过公开 API、事件或生成 SDK。

## 协接要求

向 P1/P2/P3/P4/P6/P8 提供稳定的类型、事件、错误、Fixtures 和 CI 命令；任何下游不得复制 payload。

## 独立测试

schema compatibility、生成 SDK 编译、迁移预检、Compose 健康、错误/幂等/版本单测。测试必须在本子方案自己的 Fixture/Compose 范围内可重复运行，不依赖尚未完成的其他任务。

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

- [$_](../tasks/t0.1-monorepo-ci.md)
- [$_](../tasks/t0.2-foundation-contracts.md)
- [$_](../tasks/t0.3-entity-schemas.md)
- [$_](../tasks/t0.4-event-schemas.md)
- [$_](../tasks/t0.5-sdk-fixtures.md)
- [$_](../tasks/t0.6-local-infra.md)


