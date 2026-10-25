# P0–P8 模块接口与协接契约

## 1. 目的和规范性用语

本文件把“模块之间可以交换什么”固定为可审查的公共契约。模块内部实现、数据库表、文件布局和类名都不属于协接面。`MUST` 表示合并和发布的硬门禁，`SHOULD` 表示默认行为，例外必须在 ADR 和发布清单中记录。

直接依赖边只表示业务或发布上的输入关系；P6 的 Policy、Audit、Trace 是横切依赖，任何模块处理敏感数据或可改变状态的操作都必须经过 P6 定义的 SDK。

## 2. 公共请求上下文

所有 REST、MCP、CLI、事件和内部异步任务都携带同一组上下文。HTTP/MCP 使用请求字段或 metadata，事件使用 `context`，CLI 使用已认证 session 生成：

```yaml
tenant_id: tenant-demo
workspace_id: workspace-demo
project_id: project-continuity
work_item_id: workitem-webhook       # 没有对象时省略
actor_id: actor-codex
client_id: codex
session_id: session-01
trace_id: trace-01
capability: [context.read, handoff.claim]
schema_version: 1
idempotency_key: idem-01             # 所有写入 MUST
expected_version: 7                  # 写入或 If-Match MUST
```

协接方必须保留并转发 `tenant_id`、`workspace_id`、`project_id`、`actor_id`、`client_id`、`session_id`、`trace_id`、`schema_version` 和 `source_refs`。不得用下游生成的新 trace 覆盖上游 trace；可以创建 child span。

## 3. 公共输出和错误

### 3.1 成功输出

所有公共响应和事件至少包含：

| 字段 | 要求 | 责任 |
|---|---|---|
| `schema_version` | 与契约包一致 | P0 发布，消费方声明兼容范围 |
| `id`/`event_id` | 全局或模块内唯一 | 生产方生成，消费方记录 |
| `version`/`revision`/`etag` | 权威对象或页面版本 | 权威方生成，禁止消费方重写 |
| `scope` | tenant/workspace/project/work-item | P6 校验，所有模块过滤 |
| `trace_id` | 整条链路可关联 | 第一入口生成或接收 |
| `source_refs` | 外部事实、文件、memory page 或事件来源 | 生产方提供，消费方不得丢弃 |
| `classification` | 数据分类和导出限制 | P6 维护，P2/P5/P7 必须遵守 |

### 3.2 统一错误

```json
{
  "code": "CONFLICT",
  "message": "expected_version does not match",
  "retryable": false,
  "trace_id": "trace-01",
  "details": {"current_version": 8, "expected_version": 7},
  "source_refs": []
}
```

| 错误码 | HTTP/MCP/CLI 映射 | 是否重试 | 副作用要求 |
|---|---|---:|---|
| `VALIDATION_ERROR` | 400 / invalid_params / exit 2 | 否 | 0 |
| `UNAUTHENTICATED` | 401 / auth_required / exit 3 | 否 | 0 |
| `DENIED` | 403 / access_denied / exit 4 | 否 | 0 |
| `NOT_FOUND` | 404 / not_found / exit 5 | 否 | 0 |
| `CONFLICT` | 409 / conflict / exit 6 | 否 | protected field 不得覆盖 |
| `DUPLICATE` | 200/208 / already_processed / exit 0 | 否 | effect 为 0 |
| `RATE_LIMITED` | 429 / rate_limited / exit 7 | 是 | 不创建重复任务 |
| `UPSTREAM_UNAVAILABLE` | 502/503 / retryable / exit 8 | 是 | durable 事件不得丢 |
| `SCHEMA_INCOMPATIBLE` | 500/build failure / protocol_error / exit 9 | 否 | 禁止进入集成 |

## 4. 稳定协接物

模块之间只允许通过以下物品协接：

1. `packages/contracts` 生成的 TypeScript 类型、JSON Schema、OpenAPI 和 MCP schema；
2. `packages/events` 定义的 Canonical Event；
3. WCP REST `/v1`、MCP Resources/Tools/Prompts、`workctx` CLI；
4. `packages/test-fixtures`、Mock Server、health/readiness/version 端点；
5. P8 Release Manifest 中以 digest 固定的镜像、包、Schema、migration、Fixture 和 ai-memory 版本。

禁止通过共享数据库表、对方本地 Markdown、私有消息队列 subject、未发布 `main/develop` 或复制 payload 实现协接。

## 5. 模块边界总览

| 模块 | 权威责任 | 公开输出 | 主要消费方 | 独立验证 |
|---|---|---|---|---|
| P0 | 契约、事件、SDK、Fixture、迁移基线 | Schema、Event、SDK、Fixture、健康端点 | 全部模块 | [P0 独立测试](../04-testing/modules/P0-independent-verification.md) |
| P1 | Plane 项目/工作项事实和 observed projection | Snapshot、Canonical Event、revision、source_refs | P2、P5、P7、P8 | [P1 独立测试](../04-testing/modules/P1-independent-verification.md) |
| P2 | Artifact 引用、ai-memory page 引用、ContextPack | ArtifactRef、MemoryRef、MemoryHit、ContextPack | P3、P4、P5、P7、P8 | [P2 独立测试](../04-testing/modules/P2-independent-verification.md) |
| P3 | Session、Checkpoint、Handoff、Outbox、Conflict | Session/Handoff/Conflict API、事件、cursor | P4、P5、P7、P8 | [P3 独立测试](../04-testing/modules/P3-independent-verification.md) |
| P4 | 所有客户端的 WCP 入口和能力适配 | REST/MCP/CLI response、client capability | P5、P8 | [P4 独立测试](../04-testing/modules/P4-independent-verification.md) |
| P5 | 工作台展示和用户操作编排 | UI artifact、Smoke、可访问性结果 | P8 | [P5 独立测试](../04-testing/modules/P5-independent-verification.md) |
| P6 | 身份、策略、审计、追踪和数据分类 | PolicyDecision、AuditRecord、TraceContext | 全部模块 | [P6 独立测试](../04-testing/modules/P6-independent-verification.md) |
| P7 | 搜索、评测、建议和可选向量能力 | SearchHit、Proposal、EvaluationReport | P5、P8 | [P7 独立测试](../04-testing/modules/P7-independent-verification.md) |
| P8 | 版本、部署、恢复、回滚和发布门禁 | Release Manifest、SBOM、部署报告 | 生产和运行团队 | [P8 独立测试](../04-testing/modules/P8-independent-verification.md) |

## 6. 直接依赖边契约

下表中的 `IF-*` 是稳定的协接编号。提供方和消费方都必须在代码、契约测试和报告中引用编号。

| 协接编号 | 提供方 → 消费方 | 交换物 | 提供方保证 | 消费方必须校验 | 失败处理 |
|---|---|---|---|---|---|
| IF-P0-P1 | P0 → P1 | Event/SDK/Fixture/错误 | Schema v1、幂等、分页和错误码稳定 | 编译 SDK、校验事件、运行 Plane fixture | 不兼容阻断构建 |
| IF-P0-P2 | P0 → P2 | Entity/Artifact/Event Schema | scope、source_refs、classification 字段完整 | Schema validate、未知字段策略 | 返回 SCHEMA_INCOMPATIBLE |
| IF-P0-P3 | P0 → P3 | Session/Event/错误/Fixture | append-only、event_id、aggregate version | 重复/乱序/replay 测试 | Outbox + replay |
| IF-P0-P4 | P0 → P4 | WCP 类型、错误、MCP schema | `/v1` 和 capability schema | REST/MCP/CLI parity | 入口统一映射错误 |
| IF-P0-P6 | P0 → P6 | Identity/Audit/Trace 类型 | actor、scope、trace schema | Policy/Audit SDK contract | fail-closed |
| IF-P0-P8 | P0 → P8 | Schema、migration metadata、Fixture | 版本和 checksum 可锁定 | manifest diff 和迁移预检 | RC 阻断 |
| IF-P1-P2 | P1 → P2 | ProjectSnapshot、WorkItemSnapshot、事件 | Plane object/version/source_refs | revision 单调、权限过滤 | cursor/replay |
| IF-P1-P5 | P1 → P5 | 项目/WorkItem 查询模型 | observed 事实可定位回 Plane | UI 不显示越权对象 | 403/empty |
| IF-P1-P7 | P1 → P7 | 只读事实、revision、source_refs | 不把推断写回 verified | 评测输入含来源和版本 | stale 标记 |
| IF-P1-P8 | P1 → P8 | Plane version/capability/smoke | 连接器 health 和回放 | release preflight | retryable + gate |
| IF-P2-P3 | P2 → P3 | ContextPack、MemoryRef、page revision | pack hash、来源、授权和 budget | Resume 不复制正文；权限再校验 | 返回 deny/retryable |
| IF-P2-P4 | P2 → P4 | Context API、MCP Resource | 分页、source_refs、hash 稳定 | 入口 parity 和 capability | 统一错误封套 |
| IF-P2-P5 | P2 → P5 | Context/Artifact/Memory 查询 | 只返回授权引用和正文 | UI 展示来源、revision、分类 | 不显示旧授权数据 |
| IF-P2-P7 | P2 → P7 | FTS/MemoryHit/ContextPack | Markdown 真源、SQLite 派生、revision | 评测记录 source_refs | FTS fallback |
| IF-P2-P8 | P2 → P8 | backup/restore metadata、ai-memory version | page revision/hash 可核对 | manifest 固定版本和恢复校验 | rollback/restore gate |
| IF-P3-P4 | P3 → P4 | Session/Handoff/Conflict API | claim-once、cursor、409 语义 | client capability 和错误 parity | already_claimed/409 |
| IF-P3-P5 | P3 → P5 | Session/Handoff/Conflict 查询和命令 | 版本、双方差异、审计引用 | UI 不自动覆盖 protected field | Conflict center |
| IF-P3-P7 | P3 → P7 | 只读 session/checkpoint/handoff | 未确认状态可区分 | 智能输出不得提升状态 | proposal |
| IF-P3-P8 | P3 → P8 | outbox/cursor/recovery report | durable、可 replay、无丢失 | 故障测试和恢复演练 | release gate |
| IF-P4-P5 | P4 → P5 | WCP REST/MCP/CLI | 语义一致、错误可诊断 | 页面只用公开接口 | UI contract gate |
| IF-P4-P8 | P4 → P8 | client matrix、health、smoke | 客户端版本和 capability 可识别 | 发布 smoke 覆盖入口 | RC 阻断 |
| IF-P6-P4 | P6 → P4 | PolicyDecision、Audit、Trace SDK | 每个工具调用前授权 | deny 无下游副作用；审计完整 | fail-closed |
| IF-P6-P5 | P6 → P5 | 可见性/操作权限/审计查询 | classification 和 redaction | 页面和 API 双重过滤 | 403/empty |
| IF-P6-P7 | P6 → P7 | 模型调用策略、数据分类、审计 | 模型不能绕过 policy | prompt injection 不改变决策 | worker deny |
| IF-P6-P8 | P6 → P8 | 发布审批、审计、观测门禁 | 生产操作可追踪 | preflight 检查审批和告警 | release blocked |
| IF-P7-P5 | P7 → P5 | SearchHit、Proposal、EvaluationReport | proposal 与 verified 分离 | UI 明示建议状态和来源 | 不写 verified |
| IF-P7-P8 | P7 → P8 | 评测阈值、模型/索引版本 | Feature Flag 默认关闭 | manifest 锁版本和报告 | RC 阻断 |
| IF-P5-P8 | P5 → P8 | 前端 artifact、Smoke、可访问性 | 构建可重现、配置外置 | 部署后 Smoke 和回滚 | release gate |

## 7. 各模块的协接约束

### P0：契约和 Fixture

P0 是唯一的公共 Schema/SDK/Fixture 生成入口。下游不得复制 payload。任何字段删除、枚举收窄、必填字段新增或错误码语义改变，都必须先更新 Schema 版本、兼容测试和 `requirements-matrix.yaml`。

### P1：Plane 事实

P1 只拥有 Plane project/work item 的 observed 事实和来源映射。P2/P5/P7 可以读取 snapshot，但不得把推断、建议或 UI 状态写回 Plane；回写必须通过明确的 WCP 命令并保留 `expected_version`。

### P2：记忆和上下文

P2 通过版本化 Adapter 使用 ai-memory。Markdown wiki 是记忆正文真源，SQLite 是派生索引；P3/P4/P5/P7 只持有 `MemoryRef`、`page_ref`、`revision`、`hash` 和 `source_refs`。任何恢复必须同时校验 Markdown revision、SQLite rebuild 结果和 backup manifest。

P2 的公开协接面固定为以下版本化输出：

- `ArtifactMetadata`：`artifact_id`、`storage_key`、`version`、`etag`、`sha256`、`classification`、`source_refs` 和三层 scope；正文通过授权下载引用读取。
- `MemoryRef`/`MemoryHit`：`page_ref`、`revision`、`hash`、`source_refs`、scope 和 `trace_id`；任何消费方都不得复制或缓存 Markdown 正文。
- `ContextItem`：L0-L4、`confirmed`、`confidence`、`priority`、`sensitivity`、过期时间和 `selection_reason`；策略过滤发生在编译前。
- `ContextPack`：`pack_hash`、预算、scope、`source_refs`、`items` 和 `exclusions`；`wcp://context/<pack_hash>` 是 MCP Resource 的稳定 URI。

P2 到 P3/P4/P5/P7/P8 的消费者必须执行 scope、classification、revision/hash、source_refs 和 trace_id 校验；任何失败都返回统一错误封套，并且不得把失败请求写入 artifact、ai-memory 或派生索引。P2 只通过 `@planemem/domain/memory` 发布 Memory 类型，通过 `@planemem/context-compiler` 发布 Context 类型，禁止依赖实现目录或 SQL 表。

### P3：状态和交接

P3 负责 Session/Handoff/Outbox/Conflict 状态。P4/P5 不能直接修改 session 表；所有 claim、resume、resolve 都走公开 API，使用 claim-once、幂等键和版本条件。

P3 公开的稳定对象包括 `Session`/`AgentRun`/`ToolCall`、`Checkpoint`、`Handoff`、`SyncCursor`、`LocalEvent` 和 `ConflictRecord`。它们都带 `schema_version`、scope、`trace_id`、版本或游标和 `source_refs`。消费者必须：

- 通过 `SessionService` 的 expected version 写入，禁止修改已结束 session；
- 通过 `ContinuationService` 创建和领取 handoff，不能复制 Memory 正文，resume 只携带 `MemoryRef`/`ContextPack` 的公开引用；
- 通过 `SyncService` 读取 server cursor，发现 gap 时从缺口重放，重复 event_id 和 idempotency key 的 effect 必须为零；
- 通过 `SqliteOutbox` 先 durable enqueue，再 drain；发布方必须按 event_id 幂等，失败重试不得丢失或重复业务 effect；
- 通过 `ConflictService` 解决冲突并消费 `ConflictResolved`，不得以旧版本覆盖 server version。

P3 的 PostgreSQL migration 依次为 `004_sessions`、`005_sync`、`006_outbox`、`010_session_continuity_persistence`；后者使用独立的 `wcp_session_checkpoints` 和 `wcp_session_handoffs` 表，避免与既有 Plane 项目 handoff 表混淆。本地 outbox 使用 Node 24 `node:sqlite` 的同构表结构。跨模块只依赖包 exports 和公开返回类型，禁止读取 session、sync、conflict 或 outbox 私有表。

### P4：入口和适配

P4 是客户端入口的唯一策略执行点。REST、MCP、CLI 和 adapter 只能转换协议，不能定义新的领域规则；相同 WCP 操作必须产生相同业务结果、错误码、revision、source_refs 和审计。

所有入口 MUST 调用 `@planemem/api-gateway` 的 `CommandRouter`。REST 通过 `ApiGateway` 映射 `/v1` 路由，MCP 通过 `McpGateway` 映射 tools/resources/prompts，CLI 通过 `runWorkctx` 输出同一个 `CommandResult`；入口只负责协议编码、能力协商和错误映射。`trace_id`、scope、`schema_version` 和 `source_refs` 必须在三种入口保持一致。Policy deny 在 router 执行前结束，不能触发内部 handler 或副作用。

MCP prompt 必须把历史内容标记为不可信来源；client adapter 必须返回显式 `degraded` 能力，不能把不支持的资源、hook 或预算伪装为已启用。`integrations/support-matrix.yaml` 是客户端状态和降级策略的版本化来源。

### P5：展示

P5 不拥有领域事实。UI 只能使用 P4 的公开入口，必须处理 loading/empty/error/stale/denied/conflict 状态；浏览器缓存不得绕过 scope 或 Policy。

P5 的 `WorkbenchStore`、`HandoffCenter`、`ConflictCenter` 和 `AdminPanel` 只能消费带
`schema_version`、`trace_id`、`source_refs` 和 scope 的 Gateway result。任何 claim、resume 或
resolve 操作都必须显示确认状态，并把 `expected_version`/resolution 原样交给 P4；UI 不得
直接写 Session、Handoff、Conflict、Policy 或 Audit 表。缓存键必须包含 tenant/workspace/project
scope，deny 和 stale 结果不得回退显示旧授权正文。

### P6：横切安全

P6 在所有敏感读取、写入、导出、恢复、删除、工具调用和发布操作之前执行 Policy，在操作完成后写 Audit，并通过 TraceContext 关联整条链路。拒绝必须无副作用。

P6 的公开 SDK 契约固定为：

- `AuthContext`：`tenant_id`、`workspace_id`、`project_id`、`actor_id`、`client_id`、`roles`、`capabilities`、`token_expires_at`、`trace_id`；入口必须从认证会话生成，消费方不能自行提升 scope 或 capability。
- `PolicyService.authorize({ action, resource, context }) -> PolicyDecision`：返回 `schema_version: 1`、`allowed`、稳定 `reason`、`obligations`、`trace_id`、`source_refs`。token 过期、scope 不一致、分类读取/导出不允许、缺失 capability 必须 fail-closed；`assertAuthorized` 将 deny 转为统一 `DENIED` 错误。
- 分类级别固定为 `public`、`internal`、`confidential`、`restricted`。读取和导出分别由 `canRead`/`canExport` 判定；`restricted` 导出需要专用 `data.restricted.export` capability。
- `AuditService.recordAudit(AuditInput) -> AuditRecord` 必须带 scope、actor/client/session、action/resource/result、classification、details、trace_id、source_refs 和 `idempotency_key`；同一幂等键必须返回同一 `audit_id`。`queryAudit` 只能返回请求 scope 内的记录，`createExportRecord` 将导出动作标准化为 `export.json` 或 `export.csv`，details 只能保存脱敏或汇总信息。
- `TraceContext` 和 `withSpan` 必须保持同一 `trace_id` 并生成父子 `span_id`；跨模块消息继续携带 trace context。`MetricsRegistry` 禁止以任何 `*_id` 或 `trace_id` 作为标签，`HealthRegistry` 将 `degraded/down` 显式传给网关和 UI。

P4/P5/P7/P8 的接入顺序是 Policy → 领域操作 → Audit → 事件/响应；Policy deny、分类失败和审计写入失败的处理方式必须在各模块契约测试中声明。下游只依赖上述包导出的类型和方法，不得引用 `apps/*/src` 内部实现、审计表或 OPA 文件；P6 版本、配置 digest 和 migration checksum 由 P8 Release Manifest 固定。

### P7：智能能力

P7 只产生带来源的搜索结果、评测和 `proposed` 建议。P7 不得直接把内容标记为 `verified`，也不得绕过 P6 或直接写 Plane/ai-memory 真源。

P7 的公开契约固定为：`evaluatePack(input) -> EvaluationReport`，报告必须记录 dataset/prompt/model 版本、scope、trace_id、source_refs、四项质量指标和阈值；`SearchService.search({ query, scope, budget, trace_id }) -> SearchResult`，结果必须过滤 scope、保留 revision/source_refs，并在 vector 关闭或不可用时返回 `degraded: true` 的 FTS 结果；`ProposalService.createProposal -> Proposal` 默认状态为 `proposed`，必须有 source_refs、model/prompt provenance 和幂等键，只有带 expected_revision 的人工 `confirmProposal` 才能提升状态。注入内容只能生成 warning，provider 失败只能返回 retryable/degraded 结果。

### P8：发布权威

P8 以 Release Manifest 固定所有模块 artifact、Schema、migration、Feature Flag、Plane 和 ai-memory 版本。没有独立报告、契约测试、恢复证据和回滚说明的模块不能进入发布清单。

P8 的公开契约固定为：`ReleaseManifest` 必须包含 schema/release/git、审批、feature flags、artifact digest、migration、Fixture 和外部版本；`preflightRelease` 在审批或 digest 缺失时拒绝；`release-manifest-cli.mjs` 生成的清单不得含 `SET_BY_CI` 占位符；`sbom-cli.mjs` 可生成 CycloneDX 组件清单，但漏洞扫描结果不参与功能 RC 判定；`createBackup/restoreBackup` 对文件逐项 hash 校验，任何不一致都失败；`planRollback` 没有批准时不得产生执行步骤，批准后按 freeze → restore → previous manifest → replay outbox → smoke → unfreeze 顺序生成计划；`IntegrationReport` 必须为每个步骤记录 trace_id、source_refs 和故障处理结果。部署配置只通过 values schema 和 secret ref 注入，禁止把 secret 写入 manifest。

## 8. 版本和变更流程

1. 提供方先提交契约 diff、兼容性结论、Fixture 变更和 `IF-*` 影响列表；
2. 消费方补充兼容测试和失败路径测试，不能只修改生产代码；
3. P0 校验 Schema/SDK/AsyncAPI；P6 校验权限/审计；P8 校验 manifest/migration；
4. 兼容变更使用同一 major 下的 additive 字段或双读；不兼容变更必须提供新版本、迁移窗口和回滚路径；
5. Merge 前运行提供方和消费方的契约测试；Nightly 运行真实 Compose 边；
6. 发布前冻结所有 `IF-*` 版本、digest、测试报告和已知限制。

禁止直接修改消费方以“适配”未评审的上游 payload。接口变更若没有对应 ADR、测试矩阵和追踪项，集成负责人必须拒绝合并。

## 9. 协接交付包

每个模块向下游交付：

- 版本和 immutable digest；
- 公开 Schema/API/Event/MCP diff；
- 输入和输出 Fixture 版本；
- health/readiness/version 结果；
- 独立测试报告和契约测试报告；
- migration、配置、secret 名称、Feature Flag 默认值；
- trace 示例、错误矩阵、回滚步骤和已知限制；
- 本次变更影响的 `IF-*`、需求编号和下游清单。
