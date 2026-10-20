# 架构决策记录摘要

## ADR-001：Plane 作为 Work Control Plane

选择 Plane 保存项目和工作项，WorkMesh 只保存引用、投影和跨客户端过程。原因：减少重复主库、复用项目管理能力、降低升级和一致性风险。

## ADR-002：ai-memory 作为记忆实现

采用上游 `akitaonrails/ai-memory`，因为它提供 git-backed Markdown、生命周期 Hook、跨 Agent handoff、MCP/HTTP、claim-once 和零 LLM 默认路径。WorkMesh 通过 Adapter 集成，不读其 SQLite。

## ADR-003：模块化单体起步

目录按边界拆分，但首期可在一个部署单元运行；事件吞吐、隔离或故障域需要时再拆进程。

## ADR-004：事件追加和乐观并发

事件不覆盖，状态写入带 expected_version/If-Match；负责人、截止时间、审批和任务状态发生并发时生成 Conflict。

## ADR-005：WCP 独立于 MCP

MCP 是客户端传输/适配方式，WCP 是业务契约，避免客户端协议变化绑定领域模型。

## ADR-006：FTS 优先，向量可选

先使用 ai-memory/SQLite FTS 与 WorkMesh/PostgreSQL FTS，pgvector 作为 Feature Flag；评测达标后再默认启用。

## ADR-007：敏感事实必须确认

AI 只输出 candidate/proposed；verified 只能由授权人确认，所有确认带来源和审计。

## ADR-008：版本锁定和可回滚

Plane、ai-memory、WorkMesh、Schema、迁移和配置统一进入 release manifest，升级必须经过兼容矩阵和备份恢复测试。
