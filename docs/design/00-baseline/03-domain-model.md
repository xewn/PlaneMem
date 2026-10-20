# 领域模型与状态设计

## 核心对象

### 工作事实

Tenant、Workspace、Project、Workstream、Objective、Milestone、WorkItem、Dependency、Plan、PlanRevision、Decision、Risk、Issue、Artifact、KnowledgeItem。

### 执行过程

ClientConnection、Session、AgentRun、ToolCall、Checkpoint、Handoff、ContextPack、SyncCursor、Conflict。

### 治理

Permission、Policy、Approval、AuditEntry、DataClassification、RetentionPolicy、ExportRecord。

## Plane 映射

| Plane | WorkMesh 统一对象 |
|---|---|
| Workspace | Organization/Workspace |
| Project | Project |
| Work Item | WorkItem |
| Cycle | Iteration |
| Module | Workstream |
| Milestone | Milestone |
| Page | Artifact/Knowledge |
| Comment | Activity/Conversation |
| Relation | Dependency |
| Attachment | Evidence/Artifact |
| Agent Run | AgentActivity |

## WorkItem 状态机

```text
backlog → ready → in_progress → blocked → in_review → done → archived
```

`blocked` 必须有原因；`in_review` 必须有交付物或验证记录；`done` 必须满足验收条件；`archived` 需要权限。

## PlanRevision

每次计划变化都生成新版本，字段包括：plan_id、revision、goal、reason、created_by、created_at、phase_diff、task_diff、deadline_diff、approval_ref、source_refs。

## Conflict 规则

- 消息、输出、工具调用：追加；
- 文件和代码：版本化；
- 描述和富文本：可合并但保留版本；
- 状态、负责人、截止时间、审批：乐观并发和人工解决；
- 计划：新 PlanRevision；
- 审计：只追加。

## 设计要求

任何领域对象的新增字段都必须同步更新：JSON Schema、OpenAPI、事件 Schema、SDK、数据库迁移、Fixtures、契约测试和需求追踪矩阵。
