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
| POST | `/v1/sessions/{id}/checkpoint` | Session | Checkpoint |
| POST | `/v1/sessions/{id}/handoff` | Session/Memory Adapter | HandoffRef |
| POST | `/v1/sessions/{id}/resume` | Session/Context | ResumeReceipt |
| GET | `/v1/context-pack` | Context | JSON/Markdown/MCP-ready pack |
| GET | `/v1/conflicts` | Conflict | 授权冲突 |
| POST | `/v1/conflicts/{id}/resolve` | Conflict | Resolution |
| POST | `/v1/proposals/{id}/confirm` | Approval | verified 状态 |
| POST | `/v1/proposals/{id}/reject` | Approval | rejected 状态 |

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
