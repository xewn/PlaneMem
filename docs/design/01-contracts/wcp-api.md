# WCP API 契约 v1

## 通用请求

```http
Authorization: Bearer <token>
X-Tenant-Id: tenant_01
X-Workspace-Id: workspace_01
Idempotency-Key: request_01
If-Match: W/"version-8"
traceparent: 00-...
```

## 最小接口

| 方法 | 路径 | 所有者 | 结果 |
|---|---|---|---|
| POST | `/v1/events:batch` | Sync | 接受/拒绝事件、server_cursor |
| GET | `/v1/sync/changes?cursor=` | Sync | 增量事件 |
| POST | `/v1/sync/ack` | Sync | 确认游标 |
| GET | `/v1/projects/{id}/state` | Plane Adapter | 项目状态投影 |
| GET | `/v1/work-items/{id}/context` | Context | ContextPack |
| POST | `/v1/sessions` | Session | Session |
| POST | `/v1/sessions/{id}/runs` | Session | AgentRun |
| POST | `/v1/sessions/{id}/tool-calls` | Session | ToolCall |
| POST | `/v1/sessions/{id}/checkpoint` | Session | Checkpoint |
| POST | `/v1/sessions/{id}/handoff` | Session/Memory Adapter | HandoffRef |
| POST | `/v1/handoffs/{id}/claim` | Session | claimed Handoff |
| POST | `/v1/sessions/{id}/resume` | Session/Context | ResumeReceipt |
| POST | `/v1/sessions/{id}/end` | Session | ended Session |
| GET | `/v1/context-pack` | Context | JSON/Markdown/MCP-ready pack |
| GET | `/v1/conflicts` | Conflict | 授权冲突 |
| POST | `/v1/conflicts/{id}/resolve` | Conflict | Resolution |
| POST | `/v1/proposals/{id}/confirm` | Approval | verified 状态 |
| POST | `/v1/proposals/{id}/reject` | Approval | rejected 状态 |

当前 API Gateway 已实现表中的项目状态/工作项上下文 GET 路由，以及 Session continuity POST 路由。项目状态和工作项上下文来自 Plane webhook 形成的 scoped projection，读取仍必须携带租户、工作区、项目、actor、client、trace 和 `context.read` capability；同名外部项目在不同 tenant/workspace/project scope 下不会互相覆盖。Session/Checkpoint/Handoff 的 scope、幂等、版本和 claim-once 规则由 `@planemem/session-service` 负责，网关只负责 HTTP 路由、策略和审计。

`GET /v1/projects/{id}/state` 返回 Plane 权威投影的版本、状态、字段和 source refs；`GET /v1/work-items/{id}/context` 返回工作项投影以及带 trace/source refs 的 ContextPack。工作项 ContextPack 会组合 scoped projection hit 和已配置的 ai-memory recall；记忆提供方不可用且不是必需依赖时会标记 `degraded=true`，不会伪造已确认事实。

当未配置 `DATABASE_URL` 时，网关使用进程内的 `session-service`，适用于离线 fixture。配置 `DATABASE_URL` 后，网关启动前从 PostgreSQL 恢复 Session、AgentRun、ToolCall、Checkpoint 和 Handoff，成功写入后再返回响应；`010_session_continuity_persistence.sql` 提供幂等键、检查点和交接表。Helm Service 仍使用 `ClientIP` 会话亲和降低同一运行期的跨副本路由漂移，但数据库是重启恢复的权威来源。生产验收必须验证迁移、跨租户 scope、并发版本冲突和备份恢复。

## 写入规则

- 先检查 Policy，再检查 idempotency，再检查 expected_version；
- 成功写入生成 Canonical Event；
- Plane 变更先为 observed，只有有效 Plane response/webhook 才确认；
- 版本不匹配返回 409 并生成 ConflictDetected；
- 响应包含 `trace_id`、`schema_version`、`revision`、`etag`、`server_cursor`、`source_refs`。

## 错误封套

```json
{
  "code": "WORK_ITEM_VERSION_CONFLICT",
  "message": "工作项版本已经发生变化",
  "details": {"expected_version": 18, "current_version": 19},
  "trace_id": "trace_01",
  "retryable": false
}
```
