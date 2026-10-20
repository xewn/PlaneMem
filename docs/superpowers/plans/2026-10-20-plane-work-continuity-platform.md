# Plane Work Continuity Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建设一个独立于 Codex、Claude Code、DeepSeek、WorkBuddy 等客户端的工作连续性平台，使用户可以在不同客户端之间切换而不丢失项目、计划、任务、决策、文件、执行记录、检查点和下一步。

**Architecture:** Plane 作为项目、工作项、周期、模块、里程碑、页面和附件的权威系统；WorkMesh 作为上下文、会话、检查点、交接、事件、审计和客户端适配的权威系统。所有客户端只能经过 WorkMesh Gateway 访问能力，不能直接访问 Plane 数据库或 WorkMesh 数据库。

**Tech Stack:** TypeScript、NestJS/Fastify、Next.js/React、MCP TypeScript SDK、PostgreSQL、Redis、NATS JetStream、S3 兼容对象存储、Keycloak、OPA、OpenTelemetry、Docker Compose、Kubernetes/Helm；Python 仅用于文档解析、Embedding、智能抽取和评测 Worker。

**Spec:** `F:\PlaneMem\ReadMe.md` 的“客户端无关的工作连续性平台设计方案”和“Plane 工作连续性平台完整实施方案”。

**Detailed Design:** [docs/design/README.md](../../design/README.md)；其中 `vendor/ai-memory-adoption.md` 是长期记忆实现和升级边界。

## Global Constraints

- Plane 只允许通过有版本的 `plane-connector` 调用 REST API 和接收 Webhook，禁止任何服务直接读写 Plane 数据库。
- Plane 是项目对象和工作项状态的权威源；WorkMesh 保存引用、事件投影和跨客户端工作过程，不复制第二份可写项目主库。
- WorkMesh 是 Session、AgentRun、ToolCall、Checkpoint、Handoff、ContextPack、事件、审计和客户端连接能力的权威源。
- 长期记忆采用 `akitaonrails/ai-memory`；其 git-backed Markdown wiki 是记忆正文源，SQLite 是派生索引。WorkMesh 只能通过版本化 Adapter 使用 ai-memory 的 HTTP/MCP，不得直接读写其 SQLite 或 wiki 文件。
- ai-memory 的 capture、consolidate、recall、handoff、claim-once 和 restore 必须纳入契约、审计、权限和发布回归；生产禁止使用浮动 `latest`。
- `desired_state`、`observed_state`、`verified_state` 必须分开保存；AI 只能产生 `proposed` 建议，关键状态必须人工确认。
- 所有对象使用 ULID；时间使用 UTC ISO-8601；所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`。
- 所有关键变化使用追加事件表达；事件可重放、可追踪、可去重，消费者必须保存已处理事件和聚合版本。
- 所有跨项目类型和事件定义集中在 `packages/contracts`，生成 OpenAPI、AsyncAPI/CloudEvents、JSON Schema、TypeScript SDK 和契约 Fixtures。
- 服务之间只能通过公开 API、标准事件和共享 SDK 通信，不允许跨服务数据库 Join。
- Schema 采用 expand → migrate → contract；单次发布禁止破坏性迁移。
- 新功能先通过 Feature Flag 灰度；没有端到端证据不得默认开启。
- 每个服务必须暴露 health、readiness、metrics、version 端点。
- 每次发布必须用一个 release manifest 固定 Plane 版本、服务镜像、迁移、契约版本和 Feature Flag。

## Review Focus

- 重复、乱序、延迟的 Plane Webhook 不得产生重复工作项、检查点、上下文或审计记录。
- 从客户端 A 切换到客户端 B 后，B 必须通过 Resume Context 继续工作，不要求用户重新解释项目背景。
- 并发修改计划、负责人、截止时间、审批状态或任务状态时必须显式产生冲突，禁止静默最后写入覆盖。
- 跨租户、跨工作空间、跨项目和越权 MCP Tool 请求必须被拒绝且不能产生副作用。
- 数据库迁移、事件消费失败或部署失败后必须能够恢复，且回滚路径必须有自动化验证。

---

## 1. 需求基线、边界和成功标准

### 1.1 用户需求

平台必须让人员管理项目、计划、任务、成果、上下文和治理信息，让 AI 客户端承担读取上下文、生成内容、执行工具和反馈结果的职责。聊天记录是原始轨迹，结构化项目事实是主数据。

### 1.2 首个必须打通的闭环

```text
Plane 创建 Work Item
  → Webhook
  → Plane Connector 验签、去重、重试
  → Canonical Event
  → Context Projection
  → ContextPack
  → MCP Resource / resume_work
  → 客户端读取并继续工作
```

闭环稳定前不扩展复杂 Agent 自动化。

### 1.3 第一阶段纳入范围

- Plane 自托管、固定版本和兼容性矩阵；
- 项目、工作项、状态、周期、模块、里程碑、页面、评论、附件、关系和发布的连接器；
- ContextPack v1、来源引用、版本、哈希、预算截断和 Markdown/MCP/JSON 三种表示；
- Session、Checkpoint、Handoff、Resume 和基础离线 Outbox；
- MCP Read/Write、REST、CLI 和客户端能力协商；
- 基础认证、项目权限、审计、观测和安全测试；
- Docker Compose、CI、集成环境、E2E、备份恢复和回滚。

### 1.4 后续阶段纳入范围

- Web 工作台、冲突中心、SSO、RBAC/ABAC、OPA、数据分级和 WORM 审计；
- PostgreSQL FTS 后的 pgvector 混合检索；
- 决策/风险/下一步抽取、进度建议、阻塞分析、日报周报和质量评测；
- Helm、Kubernetes 高可用、私有化安装包和灾备。

### 1.5 明确不做的首期事项

- 不修改 Plane 核心代码，不直接读 Plane 数据库；
- 不把所有客户端实现成平台核心；
- 不把聊天历史全部注入 ContextPack；
- 不让 AI 静默改变 `verified_state`、关闭关键任务或完成审批；
- 不在第一天引入全部微服务、Temporal、OpenSearch 等复杂基础设施；
- 不要求所有客户端拥有同样能力；用能力协商和 REST/CLI/Markdown 降级。

### 1.6 验收指标

- 普通项目 Context Resume p95 ≤ 5 秒；第一阶段用户验收上限为 10 秒；
- Plane 事件到 WorkMesh 投影 p95 ≤ 3 秒；
- 在线命令确认 p95 ≤ 1 秒；
- 已在本地持久化的离线事件重连后零丢失；
- 重复事件导致的重复工作项、检查点和审计记录为 0；
- 被拒绝的权限请求不产生副作用；
- 上下文恢复成功率 ≥ 95%，关键下一步识别率 ≥ 95%；
- 来源引用完整率 ≥ 98%，过期信息混入率 ≤ 2%，未确认事实误标率 ≤ 1%；
- 客户端切换后继续成功率 ≥ 95%。

---

## 2. 总体设计

### 2.1 四个平面

1. **Work/Control Plane：Plane**
   - Workspace、Project、WorkItem、State、Label、Custom Property、Cycle、Module、Milestone、Release、Page、Comment、Attachment、Relation、成员和基础权限。
2. **Context/Knowledge Plane：WorkMesh**
   - Artifact、Document、ContextItem、MemoryItem、SourceReference、ContextPack、FTS/pgvector 索引。
3. **Execution/Integration Plane：WorkMesh**
   - ClientConnection、Session、AgentRun、ToolCall、Checkpoint、Handoff、SyncCursor、LocalOutbox、Gateway、适配器。
4. **Governance/Observation Plane：WorkMesh**
   - Identity、SSO、RBAC/ABAC、Policy、Approval、AuditEntry、DataClassification、Retention、Export、Telemetry、Evaluation。

### 2.2 权威边界

| 数据 | 权威系统 | 规则 |
|---|---|---|
| 项目名称、描述、成员 | Plane | 通过 Connector 读写 |
| 工作项标题、状态、优先级 | Plane | WorkMesh 只保存引用和事件投影 |
| 周期、模块、里程碑、发布 | Plane | 不在 WorkMesh 建第二套可写事实 |
| 页面和附件关系 | Plane | 文件内容进入 S3 兼容存储，保存哈希和版本 |
| 会话、AgentRun、ToolCall | WorkMesh | 记录客户端执行过程 |
| Checkpoint、Handoff、ContextPack | WorkMesh | 负责跨客户端连续工作 |
| Decision、Risk、事件、审计 | WorkMesh | 追加、可回放、可追溯 |
| AI 进度建议 | WorkMesh | 只能是 `proposed` |
| 人工确认进度 | Plane + WorkMesh | 经过确认后才改变权威状态 |

### 2.3 领域对象

- 工作事实：Tenant、Workspace、Project、Workstream、Objective、Milestone、WorkItem、Dependency、Plan、PlanRevision、Decision、Risk、Issue、Artifact、KnowledgeItem。
- 执行过程：ClientConnection、Session、AgentRun、ToolCall、Checkpoint、Handoff、ContextPack、SyncCursor、Conflict。
- 治理：Permission、Policy、Approval、AuditEntry、DataClassification、RetentionPolicy、ExportRecord。

### 2.4 统一数据元信息

所有核心对象至少包含：

```json
{
  "id": "01J...",
  "tenant_id": "tenant_001",
  "workspace_id": "workspace_001",
  "project_id": "project_001",
  "version": 8,
  "status": "active",
  "owner_id": "user_001",
  "source_refs": [],
  "classification": "internal",
  "created_at": "2026-10-20T08:00:00Z",
  "updated_at": "2026-10-20T08:30:00Z",
  "etag": "W/\"version-8\"",
  "deleted_at": null
}
```

### 2.5 任务和计划状态

```text
backlog → ready → in_progress → blocked → in_review → done → archived
```

- `blocked` 必须带阻塞原因；
- `in_review` 必须带交付物或验证记录；
- `done` 必须满足验收条件；
- `archived` 需要权限；
- 关键任务不能由 AI 静默关闭；
- 计划每次修改创建新的 `PlanRevision`，记录原因、作者、差异和确认人。

### 2.6 ContextPack

ContextPack 使用 L0-L4 分层：

- L0 项目宪章：目标、边界、术语、技术基线和不可违反约束；
- L1 当前状态：工作项、负责人、已完成、未完成、下一步、阻塞和验收标准；
- L2 已确认事实：决策、规则、取舍、批准方案和验证结论；
- L3 近期活动：会话、文件、工具调用、测试、错误、风险和任务变化；
- L4 按需检索：历史对话、旧版本、案例和相似问题。

默认注入 L0-L3，L4 只返回索引和引用。每条内容保留 `source_id`、`source_type`、`version`、`author`、`confidence`、`confirmed`、`sensitivity` 和时间信息。ContextPack 生成 Canonical JSON、Markdown Handoff 和 MCP Resource 三种形式，并记录预算、哈希、生成版本和过期时间。

### 2.7 记忆模型

记忆能力通过独立的 `MemoryService` 抽象，不把业务代码绑定到 Mem0、LangChain 或其他记忆框架。最小接口为：

```text
writeCandidate()
retrieve()
promoteToFact()
supersede()
forget()
delete()
trace()
```

记忆分四层：

- **Session memory：** 当前讨论、临时变量、当前推理和当前工具返回值；
- **WorkItem memory：** 当前状态、文件、约束、失败尝试和下一步；
- **Project memory：** 项目目标、决策、技术基线、术语和风险；
- **Organization knowledge：** 企业规范、SOP、成功/失败案例和经验规则。

AI 产生的内容默认是 `candidate`，只能在用户确认后升级为 `confirmed_fact`。记忆必须携带来源、版本、可信度、生效/失效时间、数据分类、是否允许注入上下文、是否允许原文读取。

### 2.8 冲突处理策略

| 数据 | 处理方式 |
|---|---|
| 用户消息、AI 输出、ToolCall | 追加 |
| 文件、代码、Artifact | 版本化并保存哈希 |
| 工作项描述、富文本 | 版本合并；必要时采用 Yjs/Automerge |
| 标签 | 可最后写入，但保留历史 |
| 任务状态 | 乐观并发，版本冲突 |
| 负责人、截止时间 | 禁止静默覆盖，人工确认 |
| 计划 | 生成新的 PlanRevision 并记录差异 |
| 审批状态 | 必须人工确认 |
| 审计 | 只追加，不合并 |

不把整个系统做成 CRDT，因为权限、审批、责任人、计划基线和审计都要求明确的版本与责任边界。

### 2.9 AI 辅助能力

AI 只辅助工作连续性，不替代项目事实管理。能力拆分为：

- **Context Compiler Agent：** 读取项目状态、识别当前任务、筛选历史、生成 Resume Pack、适配上下文窗口并输出引用；
- **Checkpoint Agent：** 从会话提取已完成、未完成、决策、风险、问题、下一步、文件和测试结果，输出待确认 Checkpoint；
- **Plan Analysis Agent：** 识别延期、长期未动、依赖阻塞、资源冲突、计划偏差、目标不一致、重复工作和缺失验收条件；
- **Decision Extraction Agent：** 识别用户要求、已确认方案、约束、技术取舍、不可违反规则和已否决方案，确认前保持候选；
- **Work Brief Agent：** 生成今日重点、昨日变化、阻塞、待确认决策、计划偏差、协作对象和近期风险。

所有 AI 输出必须可追溯到来源，并按 `candidate → proposed → verified` 流程升级。

### 2.10 工作台信息架构

- **首页“我的工作”：** 今日重点、项目健康度、阻塞、待确认、最近变化、延期、AI 下一步、最近工作项和最近客户端；
- **项目驾驶舱：** 目标、里程碑、计划、进度、任务分布、风险、决策、成果、活动、成员和运行中的客户端会话；
- **工作项页面：** 目标、验收、状态、负责人、依赖、上下文、文件、检查点、会话、决策、风险、下一步，以及“继续工作/切换客户端/生成交接包”；
- **主动表达：** 对长期无进展、计划与决策不一致、未关联设计、新风险和缺少验证结果的任务主动提示，但提示不直接改变事实。

### 2.11 产品边界和技术决策

系统不是聊天聚合器、单纯项目管理软件、单纯知识库、代码助手、模型聚合平台或只围绕 MCP 的工具市场，而是客户端无关的工作上下文操作系统。

首期采用 **TypeScript 主栈 + Python AI/文档侧车 + 模块化单体**；在事件和边界稳定、同步并发需要时再拆分高并发服务。首期基础设施优先为 PostgreSQL、Redis、NATS JetStream、Keycloak、S3 兼容存储、Plane、WorkMesh API 和 MCP；Outbox + NATS 起步，Temporal 延后；PostgreSQL FTS 起步，pgvector 由 Feature Flag 控制，规模增长后再考虑 OpenSearch。

Plane 选择依据是项目/工作项模型、REST、Webhook、自托管和开源 MCP 对客户端切换更直接；OpenProject 更适合传统项目组合、资源和成本管理，AppFlowy/AFFiNE 更适合文档知识层。商业交付必须在开始前完成 Plane AGPL-3.0、Plane MCP 许可和独立 WorkMesh/MCP Gateway 边界审查。

### 2.12 客户端切换标准流程

1. 客户端 A 认证并声明能力，读取项目、当前工作项、计划、已确认决策、文件、风险和上次 Checkpoint。
2. A 工作期间回写用户指令、AI 输出、ToolCall、文件/代码引用、测试结果和候选进度。
3. 用户切换客户端或 A 主动结束时，提交 Checkpoint；平台刷新 Plane 状态，生成不可变 Handoff 和 ContextPack。
4. 客户端 B 认证、声明上下文窗口和 MCP/REST/CLI 能力，平台按权限、敏感级别和预算生成 Resume Pack。
5. B 读取已完成、进行中、下一步、风险、开放问题、决策和来源，不重新注入全部聊天历史。
6. B 继续工作并写回新事件；所有 Plane 写入经 Connector，所有上下文/审计写入 WorkMesh。

### 2.13 必须持续防止的八类错误

- 把客户端对话当作主数据；
- 让每个客户端各自维护 Canonical Context；
- 第一阶段直接拆成大量无法独立验证的微服务；
- 允许 AI 自动完成关键状态、审批或关闭任务；
- 把全部历史一次性塞入上下文；
- 只同步文本而不保存文件、代码引用和工具结果；
- 用最后写入覆盖负责人、截止时间、审批和计划基线；
- 只接 MCP 而没有 REST、CLI、Webhook 和 Markdown 降级路径。

---

## 3. Monorepo 和跨团队接口

```text
workmesh/
├── apps/
│   ├── api-gateway/       ├── mcp-gateway/
│   ├── plane-connector/   ├── context-service/
│   ├── session-service/   ├── sync-service/
│   ├── policy-service/    ├── audit-service/
│   ├── search-service/    ├── web-console/
│   └── workctx-cli/
├── workers/
│   ├── indexer/           ├── document-parser/
│   ├── intelligence/      └── evaluation/
├── packages/
│   ├── contracts/         ├── events/
│   ├── domain/            ├── sdk/
│   ├── adapter-sdk/       ├── auth/
│   ├── observability/     └── test-fixtures/
├── integrations/
│   ├── plane/             ├── codex/
│   ├── claude-code/       ├── deepseek/
│   └── workbuddy/
├── deploy/
│   ├── compose/           ├── helm/
│   ├── migrations/        └── release-manifest.yaml
├── tests/
│   ├── contract/          ├── integration/
│   ├── e2e/               ├── security/
│   ├── resilience/        └── performance/
└── docs/
    ├── architecture/     ├── adr/
    ├── api/              ├── runbooks/
    └── traceability/
```

目录按领域边界拆分，不等于第一天就部署成很多独立进程；首期可以把 API、Connector、Context、Session、Policy、Audit 组装为模块化单体，只有事件吞吐、隔离或故障域确实需要时才拆分部署单元。

### 3.1 WCP v1 最小接口

```text
POST /v1/events:batch
GET  /v1/sync/changes?cursor=<cursor>
POST /v1/sync/ack
GET  /v1/projects/{project_id}/state
GET  /v1/work-items/{work_item_id}/context
POST /v1/sessions
POST /v1/sessions/{session_id}/checkpoint
POST /v1/sessions/{session_id}/handoff
GET  /v1/context-pack?project_id=&work_item_id=&budget=
GET  /v1/conflicts
POST /v1/conflicts/{conflict_id}/resolve
```

请求头和写入约束：

```text
Authorization: Bearer <token>
X-Tenant-Id: tenant_001
X-Workspace-Id: workspace_001
Idempotency-Key: request_001
If-Match: W/"version-8"
traceparent: 00-...
```

响应至少包含 `trace_id`、`schema_version`、`revision`、`etag`、`server_cursor`、`accepted_events`、`rejected_events`、`conflict_ids` 和必要的 `source_refs`。

### 3.2 Canonical Event v1

事件至少包含：

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
  "client_id": "claude-code",
  "session_id": "session_01",
  "correlation_id": "01J...",
  "causation_id": "01J...",
  "occurred_at": "2026-10-20T08:00:00Z",
  "payload": {},
  "sensitivity": "internal"
}
```

第一阶段事件：ProjectCreated、ProjectUpdated、WorkItemCreated、WorkItemUpdated、WorkItemStatusProposed、WorkItemStatusConfirmed、PlanCreated、PlanRevisionCreated、DecisionRecorded、RiskRaised、RiskResolved、ArtifactCreated、ArtifactUpdated、SessionStarted、SessionEnded、AgentRunStarted、AgentRunCompleted、ToolCallStarted、ToolCallCompleted、CheckpointCreated、HandoffCreated、HandoffAccepted、ContextPackIssued、ConflictDetected、ConflictResolved、ClientConnected、ClientDisconnected、PolicyDenied、ApprovalRequested、ApprovalCompleted。

### 3.3 MCP 面

- Resources：项目、项目状态、计划、工作项、上下文、时间线、决策、风险、附件、Checkpoint、Handoff。
- Tools：`get_project_context`、`get_work_item_context`、`create_work_item`、`update_work_item`、`record_checkpoint`、`create_handoff`、`accept_handoff`、`record_decision`、`record_risk`、`attach_artifact`、`search_project_context`、`resolve_conflict`、`request_approval`。
- Prompts：`resume_work`、`prepare_handoff`、`review_current_plan`、`analyze_blockers`、`summarize_recent_progress`、`prepare_status_report`。

MCP 版本可变，WCP 业务契约独立维护；客户端必须声明 `resources`、`tools`、`prompts` 等能力，适配器只负责协议转换，不复制业务逻辑。

---

## 4. 可并行子方案

每个子方案必须有自己的代码目录、契约、测试、运行说明、健康检查和交付验收。下游只依赖上游公开接口，不依赖上游内部实现。

### P0：统一契约与开发平台

**依赖：** 无。  
**可并行：** P6、P8 可在 P0 基础契约确定后同步启动。

**工作内容：**

- 建立 Monorepo、包管理、格式化、Lint、TypeScript、提交规范和 CI；
- 定义 ULID、UTC、分页、错误封套、幂等键、ETag、版本、Trace、敏感级别；
- 定义核心实体、事件 JSON Schema、OpenAPI v1、AsyncAPI/CloudEvents v1；
- 生成 TypeScript SDK、Mock Server、契约 Fixtures 和 schema compatibility 检查；
- 建立 PostgreSQL、Redis、NATS JetStream、Keycloak、对象存储和 Plane 的 Docker Compose；
- 创建统一示例 Tenant、Workspace、Project、WorkItem 和测试数据。

**交付物：** `packages/contracts`、`packages/events`、`packages/sdk`、Compose 环境、ADR、CI 基线。  
**独立测试：** Schema 正向/反向兼容、错误封套、幂等键和版本规则、迁移校验、空环境启动、生成 SDK 编译。

**通过标准：** 任意团队可以只依赖生成的契约和 Fixtures 开发，不能再定义私有跨服务 payload。

### P1：Plane 连接器与工作图谱

**依赖：** P0、Plane 部署。  
**可并行：** P2 可先用 Fixtures 开发，Plane 映射稳定后接入；P6 可并行做权限映射。

**工作内容：**

- 固定 Plane 镜像、API/Webhook 版本和兼容性矩阵；
- 实现项目、工作项、状态、标签、自定义属性、周期、模块、里程碑、页面、评论、附件、关系和发布的 REST 客户端；
- Webhook HMAC-SHA256 验签、`event_id`/`delivery_id` 去重、重试、Dead Letter、回放；
- Plane ID 与 WorkMesh 引用映射，不建立第二份可写工作事实库；
- 将 Plane 事件转换为 Canonical Event；
- 成功写入只先进入 `observed`，收到有效响应/事件后才确认；
- 做权限传播和一致性检查。

**交付物：** `apps/plane-connector`、Plane 兼容性矩阵、Webhook 转换器、回放工具、同步投影。  
**独立测试：** API 集成、签名、重复/乱序/延迟事件、权限传播、事件回放、Connector 与 Plane 版本兼容性。

**通过标准：** Plane 创建/更新项目和 WorkItem 能稳定生成一次且仅一次标准事件，断开后能重试并回放。

### P2：上下文、文件与 ai-memory 记忆

**依赖：** P0；P1 的映射接口；固定版本的 ai-memory。  
**可并行：** 与 P1 后半段并行，先使用固定 Fixtures。

**工作内容：**

- 实现 Artifact、Document、File、ContextItem、MemoryItem、ContextPack、SourceReference；
- 通过 `MemoryService Adapter` 接入 ai-memory 的 capture、consolidate、recall、session page、handoff、claim-once、restore；
- 以 ai-memory Markdown wiki 作为记忆正文源，SQLite 只作为派生 FTS/entity/link/vector 索引；
- 支持 ai-memory hooks、MCP/HTTP、零 LLM 默认路径和显式 `finalize-session` 降级；
- S3 兼容对象存储保存大文件，PostgreSQL 保存元数据、分类、版本、哈希；
- 实现稳定、执行、历史三层内容和 L0-L4 ContextPack 编译；
- 保留来源、可信度、确认状态、权限和时效；
- 支持 JSON、Markdown、MCP Resource；
- 先做 PostgreSQL FTS，pgvector 通过 Feature Flag 延后到 P7；
- 实现预算截断、过期记忆降权、附件哈希校验。

**交付物：** `apps/context-service`、`apps/artifact-service`、`memory-adapter`、`packages/context-compiler`、对象存储适配器、Golden Fixtures、ai-memory 兼容性矩阵。  
**独立测试：** 相同输入确定性、来源完整、预算截断、过期内容、权限过滤、文件哈希、三种输出格式一致性、ai-memory capture/recall/handoff/claim/restore/backup 回归。

**通过标准：** 给定固定项目、WorkItem、决策、风险、文件和近期活动，能生成稳定且可追溯的 ContextPack。

### P3：会话、检查点、交接与离线同步

**依赖：** P0、P2 最小 ContextPack 和 ai-memory HandoffRef。  
**可并行：** P3 的 Session/Checkpoint 可先与 P2 末期并行；Handoff/Resume 等 P2 ContextPack 接口稳定后接入。

**工作内容：**

- 实现 Session、AgentRun、ToolCall、Checkpoint、Handoff、SyncCursor；
- 将 WorkMesh Handoff 与 ai-memory claim-once Handoff 建立一一对应关系，避免双重领取；
- 实现 Session 创建、事件写入、Checkpoint、Handoff、接受、关闭和 Resume；
- 实现 Node/SQLite 本地 Outbox、批量上传、幂等键、重试退避、游标拉取；
- 处理断网、重启、崩溃、游标缺口和重复上传；
- 对任务状态、负责人、截止时间、计划和审批实现乐观并发；
- 生成 `ConflictDetected`/`ConflictResolved`，禁止静默覆盖。

**交付物：** `apps/session-service`、`apps/sync-service`、`apps/context-bridge`、`workctx` CLI。  
**独立测试：** 断网恢复、重启恢复、重复上传、游标缺口、并发更新、冲突载荷、持久化后零丢失。

**通过标准：** 客户端 A 能提交 Checkpoint/Handoff，客户端 B 能读取适配后的 Resume Context 并建立父子会话关系。

### P4：统一 MCP、REST、CLI 和客户端连接器

**依赖：** P0、P2、P3。  
**可并行：** MCP/REST/CLI 表面可并行，但必须共享同一 WCP SDK 和策略路径。

**工作内容：**

- 提供 MCP Resources、Tools、Prompts；
- 提供 API Gateway、SSE/WebSocket（如需要）和 CLI fallback；
- 做客户端注册、能力协商和版本兼容矩阵；
- 先接 Codex、Claude Code，再接 DeepSeek、WorkBuddy 和通用 REST；
- 所有读写、工具调用、审批、审计必须经过同一权限路径；
- REST、CLI、MCP 行为和错误码保持一致。

**交付物：** `apps/mcp-gateway`、`apps/api-gateway`、`apps/workctx-cli`、`packages/adapter-sdk`、客户端矩阵。  
**独立测试：** MCP conformance、REST/CLI parity、生成 SDK 契约测试、伪客户端切换、手工 Smoke。

**通过标准：** 不同客户端可使用同一工作项、上下文、交接和冲突接口，客户端差异只体现为适配格式和能力降级。

### P5：Web 工作台

**依赖：** P1、P2、P3、P6 的查询/授权接口。  
**可并行：** UI 可用 Mock API 先行；接口稳定后接入真实服务。

**工作内容：**

- 首页“我的工作”、项目总览和 Plane/Context 双状态；
- WorkItem 详情，分开显示 desired/observed/verified；
- 计划版本、里程碑、决策、风险、依赖和时间线；
- ContextPack 来源查看、Checkpoint、Handoff、Resume；
- 冲突中心双版本比对和解决；
- Connector、策略、审计、发布健康和系统运行状态管理。

**交付物：** `apps/web-console`、交互规范、用户手册。  
**独立测试：** Playwright 关键旅程、权限 UI、客户端切换、冲突解决、可访问性 Smoke、空数据和错误态。

**通过标准：** 管理人员能看见项目、任务、上下文、客户端会话、工具调用、审计和当前发布健康。

### P6：安全、治理和观测

**依赖：** P0。  
**可并行：** 从第一天开始；不等待 P5。

**工作内容：**

- Keycloak OIDC/SSO、Tenant/Workspace/Project/WorkItem 作用域；
- RBAC 起步，ABAC/OPA 在企业阶段；
- 定义 read、write、execute、export、external-network、model-call、approval-required 能力；
- 记录敏感内容读取、写入、导出、Connector、ToolCall、策略决策和审批；
- 数据分类、留存、脱敏、导出和密钥管理；
- OTel Trace 覆盖客户端、Gateway、Context Compiler、Plane Connector、NATS 和数据库。

**交付物：** `apps/policy-service`、`apps/audit-service`、Keycloak/OPA 配置、指标与 Trace Dashboard。  
**独立测试：** 租户隔离、过期 Token、越权升级、拒绝调用无副作用、审计完整性、脱敏、提示注入、敏感附件导出。

**通过标准：** 任意请求都能回答“谁、通过哪个客户端、以什么权限、对什么对象、执行了什么、结果如何、来源是什么”。

### P7：搜索和智能能力

**依赖：** P1、P2、P3、P6；核心闭环稳定后再启动。  
**可并行：** Golden Dataset 和评测框架可提前准备，模型能力最后接入。

**工作内容：**

- 从已批准来源抽取决策、风险、动作和引用；
- 进度建议、阻塞分析、依赖分析、相似工作检索和上下文推荐；
- pgvector 语义检索与 FTS 混合；
- 所有智能结果进入 `proposed`，由人确认后才进入 `verified`；
- 建立任务切换、多阶段项目、旧信息失效、冲突和生产审批场景的 Golden Context Pack。

**交付物：** `workers/intelligence`、`apps/search-service`、`workers/evaluation`、评测报告。  
**独立测试：** 离线评测、提示注入、恶意文档、幻觉进度、回归阈值和人工抽样验收。

**通过标准：** 达到 ContextPack 指标且不把未确认推测标为事实。

### P8：发布、质量和私有化交付

**依赖：** P0 可启动，贯穿全部项目。  
**可并行：** 与所有 P 同步建设，不能等到最后补。

**工作内容：**

- Compose POC/开发包、临时集成环境和生产 Helm；
- CI PR/Merge/Nightly/RC/Production 五级门禁；
- 精确固定 Plane、服务镜像、迁移、契约和 Feature Flags；
- 数据库迁移预检、备份恢复、健康检查、升级回滚；
- 安全扫描、SBOM、漏洞报告、配置参考和 Operator Runbook；
- 生产 Smoke、事件延迟、审计写路径、Context Resume 和 Plane API/Webhook 健康检查。

**交付物：** `deploy/compose`、`deploy/helm`、`release-manifest.yaml`、`tests/*`、runbooks、私有化安装包。  
**独立测试：** 构建、部署、迁移、备份恢复、升级回滚、故障注入、性能、安全和 E2E。

**通过标准：** 任一发布候选可以在干净环境重复部署、验证、恢复和回滚。

---

## 5. 依赖关系和并行执行安排

```text
P0 ──► P1 ──► P2 ──► P3 ──► P4
 │       │      │       │       │
 ├───────┴──────┴───────┴───────┴──► P8
 ├──────────────────────────────────► P6
 P1 + P2 + P3 + P6 ────────────────► P5
 P2 + P3 + P6 ─────────────────────► P7
```

### 并行波次

- **Wave 0：** P0、P6、P8 基础工作同时启动；P0 先锁定契约、ID、事件和状态模型。
- **Wave 1：** P1 与 P2 并行；P2 先用 Fixtures，P1 提供真实 Plane 映射。
- **Wave 2：** P3 在 P2 最小 ContextPack 接口稳定后启动；P4 同步完成 Gateway 骨架和契约。
- **Wave 3：** P4 完成核心接口后接入 Codex/Claude Code；P5 用稳定查询接口接入工作台。
- **Wave 4：** P7 在最小闭环、客户端切换、权限和审计通过后启动；P8 做 RC、Helm、灾备和私有化。

### 团队分工

| 团队 | 范围 | 建议人数 |
|---|---|---:|
| 架构与契约 | P0、领域模型、API、事件、ADR | 2 |
| Plane 集成 | P1、Connector、Webhook、同步 | 2-3 |
| 上下文数据 | P2、文件、ContextPack、索引 | 3 |
| 会话连接 | P3、P4、MCP、CLI、适配器 | 3-4 |
| 前端工作台 | P5、交互、冲突中心 | 2-3 |
| 安全治理 | P6、Keycloak、OPA、审计、合规 | 2 |
| 发布测试 | P8、CI/CD、E2E、性能、安全、运维 | 2-3 |
| 智能能力 | P7、抽取、总结、检索、评测 | 2-3 |

---

## 6. 阶段计划和阶段验收

### 阶段 0：架构和验证（2 周）

**完成：** 产品边界、四平面、Plane 部署、事件封套、OpenAPI、AsyncAPI、ContextPack v1、Connector 最小版本、一个 E2E 样例。

**验收：** 在 Plane 创建 WorkItem，通过 Webhook、标准事件和投影后使用 MCP 获取 WorkItem Context。

### 阶段 1：最小闭环（4-6 周）

**完成：** P0、P1/P2 最小版本、MCP 只读、REST、基础项目上下文、Compose、集成测试。

**验收：** 任意可用客户端都能读取项目、任务、计划、已确认决策和下一步。

### 阶段 2：客户端切换（4-6 周）

**完成：** P3、P4、Checkpoint、Handoff、Resume、Codex/Claude Code、CLI、离线 Outbox、幂等同步、冲突。

**验收：** 客户端 A 创建任务并工作后，客户端 B 无需重新解释背景即可恢复、继续并写回 Plane。

### 阶段 3：工作台和治理（4-6 周）

**完成：** P5、P6、Web 工作台、SSO、项目权限、审计、操作日志、数据分类和安全测试。

**验收：** 管理人员可查看项目、任务、上下文、会话、工具调用、策略决策和审计记录。

### 阶段 4：企业化和智能化（6-10 周）

**完成：** P7、P8、向量搜索、智能摘要、风险分析、进度建议、Helm、高可用、备份恢复、升级回滚和私有化包。

**验收：** 在生产级环境完成质量指标、租户隔离、灾备、回滚和 Golden Context 评测。

### 6.1 第一阶段验收清单

| 验收项 | 必须达到的结果 |
|---|---|
| 项目创建/查询 | 任一已接入客户端可创建或查询有权限的项目 |
| 任务操作 | 客户端 A 创建的任务，客户端 B 可以继续更新 |
| 上下文恢复 | 新客户端在 10 秒内获得完整、带来源的工作上下文 |
| 客户端切换 | 不需要重新解释项目背景、已完成内容和下一步 |
| 事件可靠性 | 重复 Webhook 不产生重复任务、事件、检查点或审计记录 |
| 权限控制 | 用户只能操作其有权限的租户、工作空间、项目和工作项 |
| 审计 | 任务、上下文、AI、工具、Connector、导出和策略决策均可查询 |
| 交接信息 | 可看到已完成、进行中、下一步、阻塞、风险和待确认事项 |
| 数据私有化 | Plane、WorkMesh、附件、记忆和日志可部署在组织环境 |
| 可替换性 | 更换客户端不需要迁移项目数据或重建工作状态 |

### 6.2 粗略投入估算

以下只用于排期和资源决策，不包含模型调用、硬件采购和等保测评：

说明：本文“阶段 0”是 P0 概念验证的前 2 周架构切片；预算表中的 P0 按完整 4-6 周（包含最小闭环打通）估算。

| 阶段 | 建议人数 | 周期 | 研发费用粗估 |
|---|---:|---:|---:|
| P0 概念验证 | 2-3 | 4-6 周 | 15-30 万元 |
| P1 MVP | 4-6 | 3-4 个月 | 60-120 万元 |
| P2 Beta | 5-8 | 2-3 个月 | 50-100 万元 |
| P3 企业版 | 6-10 | 6-9 个月 | 180-400 万元 |
| P4 生态版 | 8-15 | 9-18 个月 | 400-800 万元以上 |

国产化、等保、多活、复杂审批、高并发实时协作、行业知识库、多模型路由、外部系统深度集成和大规模私有化会显著增加成本。

---

## 7. 首个两周执行清单

### 第 1 周

- [ ] 建立 Monorepo、包管理、格式化、Lint、类型检查和基础 CI；
- [ ] 建立 Docker Compose；
- [ ] 部署并固定 Plane 版本；
- [ ] 创建示例 Tenant、Workspace、Project、WorkItem；
- [ ] 确定统一 ID、时间、状态、错误、版本和敏感级别；
- [ ] 确定 Canonical Event v1；
- [ ] 确定 ContextPack v1；
- [ ] 建立测试 Fixtures、Mock Server 和 trace 规范。

### 第 2 周

- [ ] 实现 Plane API 客户端；
- [ ] 实现 Webhook 验签、`event_id`/`delivery_id` 去重和失败重试；
- [ ] 实现 `WorkItemCreated`、`WorkItemUpdated`；
- [ ] 实现 ContextPack 编译；
- [ ] 实现 `get_project_context`、`get_work_item_context`；
- [ ] 实现 MCP 只读 Resource；
- [ ] 写入第一条 Plane → Webhook → Event → ContextPack → MCP E2E；
- [ ] 在 CI 自动执行 Plane 集成测试。

---

## 8. 独立测试方案和验收门禁

### 8.1 每个子方案的 Definition of Done

- 契约变更已登记并通过兼容性检查；
- 单元测试、组件测试和失败路径测试已通过；
- 服务健康、就绪、版本和指标端点可用；
- 数据库迁移可前滚，必要时有回滚脚本；
- 日志带 `trace_id`，事件带 `correlation_id`/`causation_id`；
- 失败重试、幂等、权限拒绝和超时行为已测试；
- README、配置、运行方式和 Runbook 已更新；
- 独立测试报告挂在 PR 上。

### 8.2 测试层级

1. **单元测试：** 状态转换、ContextPack、事件转换、验签、去重、版本判断、权限、截断、交接、CLI。
2. **契约测试：** OpenAPI、JSON Schema、AsyncAPI、MCP Resource/Tool/Prompt、REST/CLI parity、Plane API/Webhook。
3. **集成测试：** Compose 中启动 Plane、PostgreSQL、Redis、NATS、Keycloak、对象存储和 WorkMesh，验证完整事件链路。
4. **端到端测试：** Codex 创建任务 → Checkpoint → Handoff → Claude Code Resume → 更新 Plane → 新 Checkpoint。
5. **故障测试：** Plane/NATS/PostgreSQL/权限服务重启、重复/乱序/延迟 Webhook、断网、崩溃、断电、文件失败、超时、消费失败、迁移失败、回滚。
6. **安全测试：** 跨租户/跨项目、过期 Token、权限升级、MCP 越权、敏感附件、外网/命令执行、提示注入、恶意文档、审计缺失和脱敏。
7. **智能评测：** Golden Context Pack、来源完整性、旧信息、相似文件、未确认推测和生产审批。
8. **性能测试：** Resume p95、事件延迟、命令确认、并发会话、NATS backlog、ContextPack 大预算和附件吞吐。

### 8.3 CI 门禁

- **PR：** 格式、Lint、类型、单元、契约兼容、迁移预检、依赖漏洞；
- **Merge：** 构建所有镜像，启动集成环境，运行 Plane/Webhook/MCP/客户端切换测试；
- **Nightly：** 完整 E2E、故障注入、性能、安全回归、Golden Context、事件重放、备份恢复、升级回滚；
- **Release Candidate：** 租户隔离、灾备、回滚、SBOM、漏洞报告、全量指标；
- **Production：** Smoke、健康检查、事件延迟、审计写入、Context Resume、Plane API/Webhook 健康。

---

## 9. 集成、部署、上线和回滚

### 9.1 分支和版本

```text
main
├── develop
├── feature/*
├── fix/*
└── release/*
```

- 每个 PR 必须写明契约影响、迁移影响、Feature Flag 和测试证据；
- 使用 SemVer 和 Git Tag；
- `develop` 只接收通过 PR 门禁的变更；
- `release/*` 只修复发布阻塞问题；
- `main` 只接受 RC 通过后的合并。

### 9.2 环境

- **开发/POC：** Docker Compose，包含 Plane、WorkMesh、PostgreSQL、Redis、NATS、Keycloak、对象存储和 OTel Collector；
- **测试：** 独立 `workmesh-test` 命名空间；每次合并主分支创建临时集成环境，使用生产同版本 Plane；
- **生产：** Kubernetes，`workmesh-system`、`plane-system`、`observability`、`security`、`storage` 命名空间；API、MCP、Context 多副本，PostgreSQL/NATS/对象存储/Keycloak 高可用，审计单独保留，密钥由 Vault/KMS 管理。

### 9.3 Release Manifest

```yaml
release_id: workmesh-0.1.0
plane_version: x.y.z
ai_memory_version: v3.1.1@<immutable-commit>
workmesh_api_version: v1
event_schema_version: 1
mcp_schema_version: 1
database_migration: 20261020_001
images:
  api_gateway: sha256:...
  mcp_gateway: sha256:...
  context_service: sha256:...
  session_service: sha256:...
  web_console: sha256:...
feature_flags:
  vector_search: false
  ai_progress_suggestion: false
  offline_sync: true
```

### 9.4 发布顺序

1. Pilot 0：P0、P1/P2 最小版本、只读 MCP、一个样例项目；
2. Pilot 1：P3、P4、Checkpoint/Handoff、MCP 写工具、Codex/Claude Code、Offline Bridge；
3. MVP：P5、P6 基础 SSO/审计、Compose 交付和完整 E2E；
4. Beta：搜索/向量、冲突中心、DeepSeek/WorkBuddy、OTel Dashboard、Helm；
5. Enterprise：ABAC/OPA、WORM 审计、高可用、备份/灾备、私有交付、留存和分级。

### 9.5 迁移和回滚

- 发布前执行迁移预检、兼容性检查和备份；
- 先扩展字段/表和双写，再切换读路径，最后删除旧字段；
- 事件消费者和 API 必须兼容一个发布窗口的旧 Schema；
- 回滚优先回滚应用镜像和 Feature Flag，数据库只执行已验证的反向迁移；
- 回滚后重放未确认事件并验证事件游标、审计和 ContextPack；
- 发布完成后执行 Smoke、数据一致性、事件延迟和恢复演练。

---

## 10. 需求到验证的可追踪矩阵

建立 `docs/traceability/requirements-matrix.yaml`，每条需求必须同时绑定设计、子方案、测试和发布门禁。初始编号如下：

| 编号 | 需求 | 设计/实现 | 独立测试 | 集成/上线门禁 |
|---|---|---|---|---|
| R-001 | 客户端可替换 | P4、WCP、Adapter SDK | REST/MCP/CLI parity、伪客户端切换 | E2E 客户端切换 |
| R-002 | Plane 是项目事实源 | P1、权威边界 | API/Webhook、权限和一致性 | Plane 回归 |
| R-003 | ContextPack 可恢复工作 | P2、L0-L4 | 确定性、来源、预算、过期 | Resume p95、Golden Context |
| R-004 | 跨客户端 Checkpoint/Handoff | P3 | 断点、重启、接受、父子会话 | Codex→Claude Code |
| R-005 | 事件不重复不丢失 | P1/P3/P8 | 重复/乱序/游标/重放 | Nightly 故障测试 |
| R-006 | 并发修改可见 | P3/P5 | 409、ConflictDetected/Resolved | 冲突中心 |
| R-007 | 权限和审计 | P6 | 越权、拒绝无副作用、审计完整 | RC 安全门禁 |
| R-008 | 文件和来源可追溯 | P2/P6 | 哈希、版本、敏感级别、脱敏 | 备份恢复、导出测试 |
| R-009 | AI 不静默改变事实 | P2/P6/P7 | proposed/verified、审批 | 生产策略门禁 |
| R-010 | 可私有化部署 | P8 | Compose/Helm、健康、SBOM | RC 部署和回滚 |
| R-011 | 可观测和可运营 | P6/P8 | Trace、Metrics、Logs、告警 | Production Smoke |
| R-012 | 智能能力可评测 | P7 | Golden Dataset 和回归阈值 | Beta/Enterprise 门禁 |

任何需求、接口、状态、事件、权限、迁移或 Feature Flag 改动都必须同步更新此矩阵和对应测试。

---

## 11. 风险和处理

- **Plane 上游变化：** 固定版本、兼容矩阵、API/Webhook/权限/回放/E2E 全量回归。
- **Plane 与 WorkMesh 不一致：** Plane 作为权威源，所有写入经 Connector，Webhook 幂等，定期一致性检查。
- **AI 误判进度：** desired/observed/verified 分离，先 proposed，关键状态人工确认并保存来源。
- **客户端能力差异：** 能力注册、ContextPack 动态适配、MCP/REST/CLI/Markdown 分级降级。
- **ContextPack 膨胀：** L0-L4、预算编译、稳定信息与近期活动分离、历史按需召回。
- **许可证和商业化：** Plane 原始仓库、独立 WorkMesh、独立 MCP Gateway，减少对 Plane 核心的修改；商业交付前完成 AGPL/MIT 边界审查。
- **并行团队接口漂移：** 所有接口先入 `packages/contracts`，生成 SDK/Mock/契约测试后再开发。
- **迁移和回滚失败：** expand/migrate/contract、预检备份、兼容窗口、自动化回滚和恢复演练。

---

## 12. 可直接分配的子任务清单

以下任务是第一轮拆分边界。每项都必须独立写测试、独立验收，再进入集成分支。

| 任务 | 负责范围 | 主要文件/目录 | 依赖 | 独立验证 |
|---|---|---|---|---|
| T0.1 | Monorepo 与 CI | `package.json`、`pnpm-workspace.yaml`、`.github/workflows/*` | 无 | 空环境安装、Lint、TypeScript、单元门禁 |
| T0.2 | 基础契约 | `packages/contracts/src/ids.ts`、`errors.ts`、`pagination.ts`、`versioning.ts` | 无 | ULID、UTC、错误封套、ETag、幂等测试 |
| T0.3 | 实体 Schema | `packages/contracts/schemas/entities/*.json` | T0.2 | JSON Schema 正向/反向兼容 |
| T0.4 | 事件 Schema | `packages/events/schemas/*.json`、`packages/events/src/envelope.ts` | T0.2 | 事件封套、字段完整性、版本兼容 |
| T0.5 | SDK/Fixture | `packages/sdk`、`packages/test-fixtures`、`tests/contract` | T0.3/T0.4 | 生成类型编译、Mock Server、契约消费测试 |
| T0.6 | 本地基础设施 | `deploy/compose/*`、`deploy/migrations/*` | T0.1 | Compose 启停、健康检查、迁移预检 |
| T1.1 | Plane 版本与能力矩阵 | `integrations/plane/compatibility.yaml` | T0.6 | 固定版本启动、API/Webhook Smoke |
| T1.2 | Plane REST Client | `apps/plane-connector/src/plane-client/*` | T0.5/T1.1 | 项目、WorkItem、周期、模块、附件读写 |
| T1.3 | Webhook 安全入口 | `apps/plane-connector/src/webhook/*` | T0.4/T1.1 | HMAC、时间窗、重放、拒绝恶签 |
| T1.4 | 事件去重/重放 | `apps/plane-connector/src/dedup/*`、`dead-letter/*` | T1.3 | 重复、乱序、延迟、失败重放 |
| T1.5 | Plane 映射/投影 | `apps/plane-connector/src/project-sync/*`、`work-item-sync/*` | T1.2/T1.4 | 一次且仅一次投影、权限传播 |
| T2.1 | Artifact/文件元数据 | `apps/artifact-service/src/*` | T0.5 | 版本、哈希、分类、权限和对象存储 |
| T2.2 | ai-memory MemoryService Adapter | `packages/domain/src/memory/*`、`apps/context-service/src/memory-adapter/*` | T0.4、T0.6 | capture、consolidate、recall、handoff、claim-once、restore、trace |
| T2.3 | 上下文层模型 | `packages/context-compiler/src/layers/*` | T2.1/T2.2 | L0-L4 分层、确认和过期规则 |
| T2.4 | ContextPack 编译器 | `packages/context-compiler/src/compile.ts` | T1.5/T2.3 | 确定性、权限、预算、来源和 hash |
| T2.5 | FTS/MCP Resource | `apps/context-service/src/search/*`、`resources/*` | T2.4 | 全文查询、三种 ContextPack 表示 |
| T3.1 | Session/AgentRun/ToolCall | `apps/session-service/src/session/*` | T0.5 | 创建、关闭、关联客户端和用户 |
| T3.2 | Checkpoint/Handoff | `apps/session-service/src/checkpoint/*`、`handoff/*` | T2.4/T3.1 | 生成、接受、父子会话和来源 |
| T3.3 | SyncCursor/事件批量 | `apps/sync-service/src/cursor/*`、`batch/*` | T0.4/T3.1 | 游标、幂等、批量确认 |
| T3.4 | SQLite Outbox/Bridge | `apps/context-bridge/src/outbox/*` | T3.3 | 断网、重启、重试、零丢失 |
| T3.5 | Conflict Service | `apps/sync-service/src/conflict/*` | T3.2/T3.3 | 409、ConflictDetected/Resolved、人工决策 |
| T4.1 | API Gateway | `apps/api-gateway/src/*` | T3.3/T1.5 | WCP API、统一错误、策略和审计路径 |
| T4.2 | MCP Gateway | `apps/mcp-gateway/src/resources/*`、`tools/*`、`prompts/*` | T4.1/T2.5/T3.2 | MCP conformance、资源权限和 Tool 审计 |
| T4.3 | CLI | `apps/workctx-cli/src/commands/*` | T3.4/T4.1 | `resume/checkpoint/handoff/sync` parity |
| T4.4 | 客户端适配 | `integrations/{codex,claude-code,deepseek,workbuddy}/*` | T4.2/T4.3 | 能力协商、客户端切换 Smoke |
| T5.1 | 工作台数据查询 | `apps/web-console/src/app/projects/*`、`work-items/*` | T4.1/P6 | 只读权限和错误态 |
| T5.2 | 工作台交接/冲突 | `apps/web-console/src/app/handoffs/*`、`conflicts/*` | T3.5/T4.1 | Resume、双版本比对和解决 |
| T5.3 | 工作台管理 | `apps/web-console/src/app/admin/*` | P6 | Connector、审计、发布健康和策略 UI |
| T6.1 | 身份/策略 | `apps/policy-service/src/*`、`deploy/keycloak/*`、`deploy/opa/*` | T0.5 | OIDC、RBAC、作用域和拒绝无副作用 |
| T6.2 | 审计/数据治理 | `apps/audit-service/src/*`、`packages/auth/*` | T6.1 | 全链路审计、分类、脱敏、留存、导出 |
| T6.3 | OTel/指标 | `packages/observability/*`、`deploy/observability/*` | T0.1 | Trace、Metrics、Logs 和告警 |
| T7.1 | Golden Dataset/评测 | `workers/evaluation/*`、`tests/evaluation/*` | T2.4 | 指标阈值、回归和人工采样 |
| T7.2 | 智能抽取/建议 | `workers/intelligence/*` | T7.1/P6 | proposed/verified、提示注入和幻觉进度 |
| T7.3 | 搜索/向量 | `apps/search-service/*` | T2.5/T7.1 | FTS + pgvector、召回和来源 |
| T8.1 | 集成/E2E/故障 | `tests/integration/*`、`tests/e2e/*`、`tests/resilience/*` | T1-T4 | 首条闭环、客户端切换、故障注入 |
| T8.2 | 镜像/Compose/Helm | `deploy/compose/*`、`deploy/helm/*` | T0.6/T4.1 | 干净环境部署、健康、扩缩容 |
| T8.3 | Release/备份回滚 | `deploy/release-manifest.yaml`、`docs/runbooks/*` | T8.1/T8.2 | 备份恢复、升级回滚、SBOM、Smoke |

每个任务执行顺序固定为：**先写失败测试 → 运行确认失败 → 实现最小变更 → 运行通过测试 → 更新契约/文档/追踪矩阵 → 提交**。跨任务只能使用 Interfaces/Schema，不得读取对方内部数据库。

---

## 13. 执行规则

- 每个 P0-P8 先拆成可独立验收的任务，每个任务包含明确文件、接口、失败测试、实现步骤、验证命令和提交。
- 先写契约/测试 Fixtures，再写实现；跨团队不允许复制类型。
- 每个子方案先独立通过自己的测试门禁，再进入集成分支。
- 每周至少一次从当前主分支重建 Compose 集成环境并跑全链路。
- 每次阶段验收生成测试报告、覆盖率/指标、变更清单、已知问题和下一阶段入口条件。
- 任何偏离本计划的变更必须通过 ADR，说明原因、影响、兼容策略、测试补充和是否更新需求矩阵。
- 只有当阶段验收、RC 门禁和生产 Smoke 全部通过，才允许打开对应生产 Feature Flag。

