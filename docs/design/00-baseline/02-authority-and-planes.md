# 权威边界与四平面

## 权威边界

| 数据 | 权威系统 | WorkMesh 允许保存 |
|---|---|---|
| Workspace、Project、WorkItem、State、Cycle、Module、Milestone、Release | Plane | 外部 ID、投影、同步游标、来源版本 |
| Page、Comment、Attachment 关系 | Plane | 引用、哈希、分类、对象存储地址 |
| 文件内容和版本 | S3/对象存储 + WorkMesh 元数据 | 元数据、哈希、来源和权限 |
| Session、AgentRun、ToolCall | WorkMesh | 完整过程记录 |
| Checkpoint、Handoff、ContextPack | WorkMesh + ai-memory | 规范化引用、版本、交接状态和审计 |
| 长期记忆正文 | ai-memory git-backed wiki | page_id/path、版本、权限投影、审计引用 |
| 记忆检索索引 | ai-memory SQLite | 不直接写入；通过 API/MCP 访问 |
| Decision、Risk、Conflict、Approval | WorkMesh | 结构化事实和状态 |
| 事件、审计、策略决策 | WorkMesh | 追加记录、可回放 |

禁止通过 WorkMesh 直接读写 Plane 或 ai-memory SQLite。

## 四个平面

1. **Work/Control Plane：** Plane 的项目管理对象；
2. **Context/Knowledge Plane：** WorkMesh Context Compiler + ai-memory；
3. **Execution/Integration Plane：** Gateway、Session、Connector、Sync、Outbox；
4. **Governance/Observation Plane：** Keycloak、OPA、Audit、OTel、Release。

## 依赖方向

```text
Client → Gateway → Policy/Audit → Domain Services
Domain Services → Plane Connector / ai-memory Adapter
Domain Services → Canonical Event / Outbox → NATS
Context Compiler → Plane Projection + ai-memory Recall + WorkMesh Facts
```

任何跨边界访问必须经过适配器和授权检查。适配器负责协议转换，不复制业务逻辑。

## 状态分离

- `desired_state`：计划希望达到的状态；
- `observed_state`：系统或客户端观察到的状态；
- `verified_state`：经过有权限人员确认的事实状态；
- AI 产生 `proposed`，不得隐式写入 `verified_state`。

## 生命周期

所有对象使用 ULID、UTC 时间、版本、ETag、source_refs、classification、created_at、updated_at、deleted_at。删除优先软删除；记忆内容遵循 ai-memory 的版本/恢复机制。
