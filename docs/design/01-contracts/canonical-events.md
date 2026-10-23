# Canonical Event 契约 v1

## 封套

```json
{
  "event_id": "01J...",
  "event_type": "CheckpointCreated",
  "schema_version": 1,
  "tenant_id": "tenant_01",
  "workspace_id": "workspace_01",
  "project_id": "project_01",
  "aggregate_type": "session",
  "aggregate_id": "session_01",
  "aggregate_version": 12,
  "actor_id": "user_01",
  "client_id": "codex",
  "session_id": "session_01",
  "correlation_id": "01J...",
  "causation_id": "01J...",
  "occurred_at": "2026-10-20T08:00:00Z",
  "trace_id": "trace_01",
  "source_refs": [
    {"type": "plane", "id": "issue_01"}
  ],
  "payload": {},
  "sensitivity": "internal"
}
```

## 事件集合

ProjectCreated/Updated、WorkItemCreated/Updated、WorkItemStatusProposed/Confirmed、PlanCreated、PlanRevisionCreated、DecisionRecorded、RiskRaised/Resolved、ArtifactCreated/Updated、SessionStarted/Ended、AgentRunStarted/Completed、ToolCallStarted/Completed、CheckpointCreated、HandoffCreated/Accepted、ContextPackIssued、ConflictDetected/Resolved、ClientConnected/Disconnected、PolicyDenied、ApprovalRequested/Completed。

## 消费者要求

- 用 `event_id` 去重；
- 用 aggregate_version 检查顺序；
- 必须保留 `trace_id`、tenant/workspace/project scope 和 `source_refs`；
- 记录 processed_event、处理状态、失败原因和重试次数；
- 乱序事件进入延迟队列，不能静默丢弃；
- 修正通过新事件，不修改历史；
- 事件 payload 必须通过 JSON Schema。

## ai-memory 事件映射

Hook observation 先由 ai-memory sanitizer 处理，再映射为 WorkMesh 的 `SessionStarted`、`ToolCallCompleted`、`CheckpointCreated`、`HandoffCreated` 或 `SessionEnded`。原始观察 ID 和 memory page revision 放入 source_refs，不把原始 transcript 直接塞入事件 payload。
