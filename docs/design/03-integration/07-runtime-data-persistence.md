# 运行时真实数据闭环协接规范

## 协接对象

本规范约束 Plane connector、API Gateway、Projection、Search、Audit、PostgreSQL migration、Compose 和 k3s Helm 之间的协接。各实现方只能依赖下表字段和 HTTP 行为。

| 阶段 | 输入 | 持久化结果 | 下游读取 |
|---|---|---|---|
| Webhook 验签 | raw body、delivery/event id、timestamp、signature | 无 | 校验通过后进入事件处理 |
| Event validate | Canonical Event | `wcp_events` | 启动重放、重复判断 |
| Projection apply | Event payload、aggregate version | `wcp_projection_states` | Context hit、状态查询 |
| Context index | SearchHit、trace | `wcp_context_hits` | REST/MCP search、resources/read |
| Audit | delivery status、trace、source_refs | `wcp_audit_records` | 审计查询和运营回查 |
| Session continuity | Session、AgentRun、ToolCall、idempotency key | `wcp_sessions`、`wcp_agent_runs`、`wcp_tool_calls` | Session API、工厂角色执行 |
| Checkpoint/handoff | Checkpoint、Handoff、claim 状态 | `wcp_session_checkpoints`、`wcp_session_handoffs` | resume、跨客户端交接 |

## 字段和约束

- 所有 scope 使用 `tenant_id/workspace_id/project_id`；数据库主键和查询条件必须包含 scope。
- `event_id`、`source_event_id`、`trace_id`、`external_id` 必须能在报告中相互定位。
- `aggregate_version` 和 SearchHit `revision` 使用正整数；数据库 BIGINT 读取后转换为 JavaScript number，并拒绝非安全整数。
- JSONB `source_refs` 和 `payload` 读取后必须是数组/对象，禁止把 JSON 字符串直接交给领域校验器。
- UTC 时间从 PostgreSQL `+00` 表示转为以 `Z` 结尾的 ISO 字符串后再进入 Canonical Event 校验。
- Secret 只通过 `planemem-runtime-secrets` 的 `DATABASE_URL`、`PLANE_WEBHOOK_SECRET`、认证字段注入。
- `SessionStore` 和 `ContinuationStore` 是 session-service 的持久化端口；API Gateway 的 PostgreSQL adapter 只负责映射，不复制 session-service 的状态机规则。

## 生命周期协接

### 启动

数据库连接成功、009 和 010 migration 存在、事件/hit/session continuity 恢复完成后才监听 3000 端口。任何恢复异常都应让 readiness 失败，让 Helm 等待或回滚。

### 写入

Webhook 的事件/投影/hit 作为一个事务；审计在事务成功后写入。Context index 以主键 upsert，保持同一 hit 的最终 revision。所有路径都保留 trace。

### 重启

新 Pod 必须从数据库恢复 event ledger、Search resource 和 session continuity。服务端口恢复后，原 event 再投递必须是 `duplicate`，查询必须仍返回同一 `source_refs` 和 revision；已创建的 Session、Checkpoint、Handoff 及其幂等键必须可以继续执行或安全重放。

### 部署

本地构建 `linux/amd64` 镜像并导出 gzip；传到三台节点，校验归档 hash；`k3s ctr -n k8s.io images import` 后建立无 tag digest alias；Helm 的 repository、tag、digest 三者必须与报告一致。

## 失败处理

| 故障 | HTTP/部署行为 | 允许的副作用 |
|---|---|---|
| JSON/schema/signature 错误 | 400/401 | 不写事件、投影、hit |
| 已知 event_id | 200 duplicate | 仅按 delivery 幂等记录审计 |
| 数据库连接或事务失败 | 503 + trace | 不返回 accepted；保留失败报告 |
| 启动 hydrate 失败 | Pod 不 ready | 不接受业务流量 |
| Session continuity migration 缺失 | Pod 不 ready 或 session API 503 | 不把内存状态当作生产恢复证据 |
| Secret 缺失 | Pod 不 ready 或 Webhook 503 | 不猜测默认值 |
| 节点没有 digest alias | Pod `ErrImagePull` | 停止 Helm 等待并修复导入 |

## 提供方/消费方责任

- Migration 提供方：表、主键、索引、checksum、幂等 SQL。
- Runtime 提供方：hydrate、transaction、错误码、health/readiness。
- Projection/Search 消费方：保持现有领域 API，不自行写数据库。
- Compose/k3s 提供方：挂载/执行 migration，注入真实 DATABASE_URL，记录版本和 digest。
- 测试消费方：只用公开 HTTP、PostgreSQL 查询契约和 kubectl/Compose 命令回查，不读取进程私有 Map。
