# Canonical Event 契约 v1

2026-11-05，TODO **P0-03**：新增 [JetStream 传输和持久队列接入源码](jetstream-runtime.md)，使用本页原始 CanonicalEvent JSON；公开 Node 子路径 `@planemem/events/jetstream`。保留完整事件/来源/分类，业务事务入队、显式发布确认、持久消费回执去重和消息范围核对已写入。未接入的事件生产者、业务消费者及真实运行证据仍缺；不把此项当作 CloudEvents 传输或完整 AsyncAPI 绑定完成，未运行或测试。

2026-11-05，TODO P0-01：新增[默认 38 类事件的双格式 AsyncAPI 消息目录](../../../packages/events/asyncapi/README.md)及逐类 Schema 锚点、包子路径，复用原基础/枚举/删除/恢复资源。独立 [CloudEvents 结构化配置](canonical-cloudevents.md)及双向转换的 data 保留这里的完整自定义 CanonicalEvent；结构化目录逐类绑定外层 type 与内层 event_type。实际总线通道、结构化格式传输/消费者接线、完整业务 payload、机器契约接线和运行兼容证据待补。仅源码，未执行校验器、生成器、编译、类型检查、测试或发布。

## 封套

```json
{
  "event_id": "01J000000000000000000000001",
  "event_type": "CheckpointCreated",
  "schema_version": 1,
  "tenant_id": "01J000000000000000000000002",
  "workspace_id": "01J000000000000000000000003",
  "project_id": "01J000000000000000000000004",
  "aggregate_type": "session",
  "aggregate_id": "01J000000000000000000000005",
  "aggregate_version": 12,
  "actor_id": "01J000000000000000000000006",
  "client_id": "codex",
  "session_id": "01J000000000000000000000005",
  "correlation_id": "01J000000000000000000000007",
  "causation_id": "01J000000000000000000000008",
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

ProjectCreated/Updated、WorkItemCreated/Updated/Deleted/Restored、WorkItemStatusProposed/Confirmed、PlanCreated、PlanRevisionCreated、DecisionRecorded、RiskRaised/Resolved、ArtifactCreated/Updated、SessionStarted/Ended、AgentRunStarted/Completed、ToolCallStarted/Completed、CheckpointCreated、HandoffCreated/Accepted、ContextPackIssued、ContextItemCreated/Updated/Archived/Restored/Confirmed、ConflictDetected/Resolved、ClientConnected/EventRecorded/Disconnected、PolicyDenied、ApprovalRequested/Completed。共 38 类默认 v1 事件，与运行时 CANONICAL_EVENT_TYPES 及事件枚举资源对应；自定义注册类型需另行更新契约。上方示例只展示封套形状，空 payload 不代表满足具体检查点业务入口的完整要求。

## WorkItemDeleted（2026-11-02，仅源码）

事件封套 schema_version=1、aggregate_type=work_item，必须有 project_id；payload 只允许必填 external_id，遵循既有外部标识校验。occurred_at 是删除观察的源时间，aggregate_version 沿用同一 aggregate 的严格顺序，不因删除而跳过缺口。`canonical-event.json` 通过条件引用 `work-item-deleted.json` 增加这些限制，运行时 validateEvent 同步校验。

删除仍经签名 Canonical Webhook 和持久 inbox，不调用 Plane 删除 API，也不宣称已完成原生 Plane 删除 Webhook 转换。已提交删除保留历史事件、别名和删除快照，并停用对应检索索引。观察 state 的内层 schema_version=2 用于删除标记（外层 HTTP envelope 与事件仍为 v1），活动观察继续为 v1。普通后续更新不能恢复已删除工作项；显式恢复见下节，项目删除和外部副本清理仍待开发。040 迁移只新增文件，没有执行编译、测试、迁移、启动或发布。

## WorkItemRestored（2026-11-02，仅源码）

封套仍为 v1，aggregate_type=work_item，必须有 project_id 和 causation_id。payload 必填 external_id、非空 title（最长 2000 字符）、非空 status（最长 255 字符），以及 restored_from；其余业务观察字段可选。restored_from 只含 event_id（删除事件 ULID）和 aggregate_version（删除版本，正安全整数）。causation_id 必须等于引用 event_id，恢复事件 ID 必须不同，恢复版本必须是删除版本加一且为安全整数。JSON Schema 通过 work-item-restored.json 描述结构，跨字段相等及版本算术由 validateEvent 校验。

payload 是全新活动观察，不合并删除前字段。无已提交基线或存在版本缺口时等待；紧邻版本仍需精确匹配最新 WorkItemDeleted 的事件 ID、版本与 external_id。事务锁内核对删除快照、删除源事件和未过期删除索引，缺失或不一致拒绝 PLANE_RESTORE_PRECONDITION_FAILED。成功后清除本地删除标记、保留到期时间和较高分类；旧事件不修改。恢复结果为内层 v1，并带顶层 restored_from 来源；后续普通更新不携带该顶层来源。此入口不向 Plane 发恢复命令，不恢复外部副本，也未实现原生恢复事件映射。沿用尚未执行的 040，无新迁移。

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
2026-11-03 同步上下文消费增补：共享 `parseContextItemSyncChange` 按 Gateway 现有五类 ContextItemCreated/Updated/Confirmed/Archived/Restored 的 v1 同步封套，验证 item_id/version/status/archived、完整范围与唯一来源引用。它供本地生命周期元数据适配器使用，不替换全局 validateEvent 或扩大 Webhook 事件入口。CLI 显式应用固定原页，缺创建基线/版本缺口整页拒绝；完整正文不在同步 payload，详见 [上下文生命周期投影](sync-context-item-application-runtime.md)。仅源码文档，未运行或测试。

2026-11-03 建议同步消费增补：共享 parseProposalSyncChange 对 Gateway 既有 Proposal ApprovalRequested/Completed 的规范同步封套和 proposal_id/status/revision/kind 四字段 payload 进行完整范围/来源/版本绑定校验。固定 proposal-lifecycle/1 本地适配器保存原请求/最终决定元数据，显式原页应用和只读全历史重放共用选择器；不扩大全局 validateEvent 或 Webhook 入口，不包含正文或当前审阅权限。见[建议生命周期投影](sync-proposal-application-runtime.md)。仅源码文档，未运行或测试。

2026-11-03 冲突同步消费增补：共享 parseConflictSyncChange 按当前 Gateway ConflictDetected/Resolved 的完整封套、原主体/字段版本及来源绑定校验。独立 conflict-lifecycle/1 本地适配器保留检测/决策与 resolved_value，允许分类上调但不下调；逐页 apply 与 readonly replay 共用固定选择器。旧外部 ID 的决策可按既有回退规则解析，但不补造检测基线。不替换全局 validateEvent、修改源字段或推断原请求回执。见[冲突生命周期投影](sync-conflict-application-runtime.md)。仅源码文档，未执行。
