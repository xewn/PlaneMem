# 需求范围与成功标准

## 目标

建设客户端无关的工作连续性操作系统。人员管理项目、计划、任务、决策、风险、成果和上下文；AI 客户端负责读取上下文、生成内容、执行工具和回写结果。

## 首个闭环

```text
Plane 创建 WorkItem
→ Webhook
→ Plane Connector 验签/去重/重试
→ Canonical Event
→ Context Projection
→ ai-memory 记忆页/索引
→ ContextPack
→ MCP Resource / resume_work
→ 客户端继续工作
```

## 产品边界

系统不是聊天聚合器、单纯项目管理软件、单纯知识库、代码助手、模型聚合平台或只围绕 MCP 的工具市场。聊天是证据，项目和任务是工作事实，记忆是可追踪的工作知识。

## 范围

### 首期必须实现

- Plane 自托管和版本锁定；
- 项目、工作项、周期、模块、里程碑、页面、评论、附件、关系和 Webhook；
- ai-memory 的记忆捕获、整理、检索和 claim-once handoff；
- ContextPack v1；
- Session、Checkpoint、Handoff、Resume、离线 Outbox；
- MCP、REST、CLI 和 Codex/Claude Code 首批适配；
- 基础认证、权限、审计、观测、Compose、CI、集成测试和回滚。

### 后续实现

- Web 工作台、冲突中心、SSO、OPA/ABAC、数据分级和 WORM 审计；
- FTS 之后的 pgvector、智能摘要、决策/风险/下一步抽取；
- Helm、Kubernetes 高可用、灾备和私有化交付。

## 成功标准

- 新客户端在 10 秒内恢复背景、当前任务、已完成、未完成、风险和下一步；
- Context Resume p95 ≤ 5 秒；
- Plane 事件投影 p95 ≤ 3 秒；
- 在线命令确认 p95 ≤ 1 秒；
- 重复事件不产生重复数据；
- 离线已持久化事件零丢失；
- 权限拒绝无副作用；
- 所有事实和建议有来源、版本和确认状态。

## 需求追踪

本设计中的每个要求必须关联 `docs/traceability/requirements-matrix.yaml` 的 R 编号。没有 R 编号的新增需求不能直接进入实现。

