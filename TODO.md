# PlaneMem 项目缺口 TODO

> 基线日期：2026-10-26。此清单以 [ReadMe.md](ReadMe.md) 的 P0–P8 规划、WCP/MCP 契约和当前工作区实际代码为准。`[缺实现]` 表示代码或接口还没有形成规划要求的闭环；`[待外部环境]` 表示本地代码已有边界，但需要真实服务、客户端、RC 或生产环境证据；`[文档漂移]` 表示实现、计划和状态记录不一致。

## 当前基线

- [x] 根目录 `tsc --project tsconfig.build.json`、`tsc --noEmit` 和 Prettier 检查通过。
- [x] `node tools/plan-audit.mjs` 通过，当前发现 38 个任务文件、9 个模块、28 条协接边；计划审计缺失项为空。
- [x] `node tools/run-module-tests.mjs` 通过：116 个测试通过、0 个失败、3 个跳过。
- [ ] `node tools/rc-readiness.mjs` 真实模式通过：本次审计返回 `live-services: not-ready`，`docker compose ps` 没有运行中的服务；离线模式只能返回 `simulated`。
- [ ] `apps/web-console` 独立依赖安装、类型检查、Next 构建、Lint 和浏览器测试通过；根目录配置当前排除了 `apps/web-console/src`，且根 Lint 未覆盖 `.tsx/.css`。
- [ ] 3 个跳过测试在真实依赖下运行并归档：其中包含 `SESSION_TEST_DATABASE_URL is required` 的 PostgreSQL 会话恢复测试，以及两个 P8 真实数据闭环测试。

## P0：契约、事件和开发平台

- [ ] **[P0-01][缺实现] 生成并发布 OpenAPI v1、AsyncAPI/CloudEvents v1 和 MCP schema。** 当前仓库有 JSON Schema 和 Markdown 契约，但没有可被工具消费的 OpenAPI/AsyncAPI 文档文件。完成条件：生成物进入版本控制，SDK/Mock/契约测试从生成物校验，CI 对破坏性变更失败。
- [ ] **[P0-02][缺实现] 扩充 `packages/sdk` 和 Mock Server 到完整 WCP 面。** 当前 SDK/Mock 只覆盖 `POST /v1/projects`，与 WCP API、Session、Sync、Conflict、ContextPack 和 Proposal 接口不一致。完成条件：所有公开路由都有类型化 SDK、Mock、错误/幂等/ETag 契约测试。
- [ ] **[P0-03][缺实现] 接入真实 NATS JetStream 事件总线。** 当前 TypeScript 源码没有 NATS publisher/consumer，NATS 只出现在 Compose 和故障脚本中。完成条件：事件写入、消费、重放、积压指标和故障恢复均使用真实 NATS；内存路径只保留为离线 fixture。
- [ ] **[P0-04][文档漂移] 修正计划计数和追踪状态。** `plan-audit` 当前报告 `task_files=38`、`expected_task_files=37`，而 `docs/traceability/requirements-matrix.yaml` 仍为 `status: planned`。完成条件：统一 38 个任务（含 T8.4）的计数、需求状态、ReadMe 勾选项和完成审计。

## P1：Plane 连接器与工作图谱

- [ ] **[P1-01][缺实现] 补齐 Plane REST/Webhook 能力矩阵。** `apps/plane-connector/src/plane-client/client.ts` 目前只实现项目读取、工作项创建/更新和附件列表；ReadMe 还要求 states、labels、custom properties、cycles、modules、milestones、pages、comments、relations、releases 等对象。完成条件：逐项实现或明确版本化降级，并把限制同步到 `integrations/plane/compatibility.yaml` 和契约测试。
- [ ] **[P1-02][缺实现] 把 Webhook 去重、重试、死信和回放做成持久能力。** `apps/api-gateway/src/server.ts` 使用进程内 `pending_plane_persistence` Map；进程重启会丢失待持久化事件，也没有公开的 retry/dead-letter/replay 接口。完成条件：delivery/event ledger、指数退避、死信存储、人工/自动回放、重启后不重复副作用。
- [ ] **[P1-03][待外部环境] 完成真实 Plane 版本兼容和命令确认。** 在真实 Plane 固定版本上验证 API、HMAC Webhook、重复/乱序/迟到事件、权限传播和“Plane 成功响应/事件后才进入 observed”的状态转换，并归档事件 ID、revision、source_refs。

## P2：上下文、文件、记忆与检索

- [ ] **[P2-01][缺实现] 将 ArtifactService 接入 PostgreSQL + S3/MinIO。** `apps/artifact-service/src/index.ts` 当前把 metadata、版本和 bytes 全部保存在 Map；虽然有 `003_artifacts.sql`，但没有持久化适配器、对象存储上传/下载或运行时路由。完成条件：metadata/版本/hash 在 PostgreSQL，正文在对象存储，下载经过 Policy/Audit，重启和恢复可验证。
- [ ] **[P2-02][缺实现] 持久化 ContextItem/ContextPack 并提供 WCP/MCP 读取面。** 当前 runtime 只把搜索 hit 写入 `wcp_context_hits`，没有 `GET /v1/context-pack`，也没有按契约生成完整的 project/work-item/session/context 资源 URI。完成条件：ContextPack hash、预算、来源、过期和 exclusions 可恢复，`resources/list/read` 按 scope 返回。
- [ ] **[P2-03][缺实现] 用 PostgreSQL FTS 和可选 pgvector 替换进程内搜索。** `apps/search-service/src/service.ts` 当前是内存数组 + `includes` 字符串匹配，`vector_enabled` 只改变 degraded 标记，没有 FTS 索引、embedding、pgvector 或 rebuild。完成条件：FTS 默认可用，pgvector 受 Feature Flag 控制，索引重建、来源/版本过滤和性能基线可重复。
- [ ] **[P2-04][待外部环境] 完成 ai-memory 全操作闭环。** 已有 Streamable HTTP/MCP Adapter 和本地探针，但需在固定版本服务上验证 capture、recall、consolidate、read、handoff、claim、restore、备份/恢复及 `MEMORY_REQUIRED` fail-closed 行为，并把页面 revision/hash 与 ContextPack 关联。

## P3：会话、同步、离线与冲突

- [ ] **[P3-01][缺实现] 将 SyncService/ConflictService 接入 API Gateway。** WCP 契约要求的 `/v1/events:batch`、`GET /v1/sync/changes`、`POST /v1/sync/ack`、`GET /v1/conflicts`、`POST /v1/conflicts/{id}/resolve` 当前没有注册路由；服务实现仍是进程内 Map。完成条件：公开路由经过统一 Policy/Audit/Idempotency/ETag，返回 `ConflictDetected/ConflictResolved` 事件。
- [ ] **[P3-02][缺实现] 接入服务端同步持久化和事件游标。** `005_sync.sql`、`006_outbox.sql` 已存在，但 API 没有消费它们；需要 PostgreSQL server cursor、批量上传、ack、gap replay 和跨实例一致性。
- [ ] **[P3-03][待外部环境] 完成真实客户端断网、进程崩溃和并发恢复。** `SqliteOutbox` 已有离线单测/探针，但还要用真实 CLI/Bridge 进程验证 durable write → reconnect → exactly-once、cursor gap、客户端重启和两个客户端并发冲突。

## P4：REST、MCP、CLI 和客户端适配

- [ ] **[P4-01][缺实现] 补齐 WCP REST 路由。** 对照 `docs/design/01-contracts/wcp-api.md`，当前缺少事件批量同步、ContextPack、Conflict、Proposal confirm/reject，以及 Plane 工作项创建/更新等规划接口；需要逐项注册并做 REST/SDK 契约测试。
- [ ] **[P4-02][缺实现] 将 MCP 表面扩展到契约清单。** `apps/api-gateway/src/server.ts` 当前硬编码只暴露 `context_search`、`context_index` 两个 Tool 和一个 `resume` Prompt；规划要求的项目/工作项/上下文/时间线/决策/风险/文件/会话资源、写入 Tools 和六类 Prompts 尚未接入。完成条件：动态注册、input schema、scope/capability 检查、错误 parity 和资源读取测试全部覆盖。
- [ ] **[P4-03][缺实现] 提供可安装的 `workctx` CLI。** `apps/workctx-cli` 目前只有 `runWorkctx` 函数和 package export，没有 bin、安装入口或真实 shell smoke。完成条件：`workctx resume/checkpoint/handoff/sync/conflicts/doctor` 在 Windows/Linux 下可执行，JSON 输出与 REST/MCP 语义一致。
- [ ] **[P4-04][缺实现] 实现客户端专属适配器和 Hook。** `integrations/claude-code`、`deepseek`、`workbuddy` 当前只是重新导出 Codex Adapter；支持矩阵虽标记部分 degraded，但没有真实 hook/session-start/session-end/显式 finalize 的端到端证据。
- [ ] **[P4-05][缺实现] 修复 MCP trace 和能力声明。** 真实 WaveMate 报告中的响应仍出现 `trace_mcp_unknown`，而 `initialize/server-discover` 返回空 capability map。完成条件：缺少入站 trace 时生成唯一 trace，贯穿 initialize → tool/resource/prompt → audit，并按客户端声明返回实际降级能力。

## P5：Web 工作台

- [ ] **[P5-01][缺实现] 将工作台按钮接成真实命令。** `apps/web-console/src/app/handoffs/page.tsx` 的 Create/Claim、`conflicts/page.tsx` 的 Resolve/Keep local，以及 sessions/work-items/context/audit/admin 页面的操作按钮当前没有提交处理或仍是 disabled。完成条件：操作调用 Gateway，携带 expected_version/idempotency，展示 loading/denied/conflict/success 状态并刷新数据。
- [ ] **[P5-02][缺实现] 把 Web Console 纳入构建和质量门禁。** 根 `tsconfig` 排除了 `apps/web-console/src`，根 Prettier/Lint glob 未覆盖 `.tsx/.css`；当前工作区无法直接解析 Next/React 依赖。完成条件：冻结依赖后 `next build`、独立 typecheck、Lint、Playwright 关键旅程和可访问性 smoke 在 CI 中执行。
- [ ] **[P5-03][待外部环境] 完成真实权限/交接/冲突 UI E2E。** 用真实 Keycloak/OPA、Gateway 和 PostgreSQL fixture 验证 claim/resume/resolve、双版本 diff、scope isolation、stale/denied/error 状态和审计记录；不能只依赖页面静态 smoke。

## P6：身份、治理、审计与观测

- [ ] **[P6-01][待外部环境] 固定生产身份和策略配置。** 当前 Keycloak/OPA 主要由 Compose/test overlay 验证；需要 RC/生产版本、网络、JWT claims、密钥轮换、策略版本和 fail-closed 演练，并把 digest/配置写入 Release Manifest。
- [ ] **[P6-02][缺实现] 覆盖所有敏感操作的审计与留存。** runtime 已有 Gateway 审计和 PostgreSQL sink，但 Artifact、Sync、Conflict、Proposal、导出、恢复和后台 worker 尚未形成统一入口；需要留存、查询、脱敏导出、失败重试和清理策略的真实闭环。
- [ ] **[P6-03][待外部环境] 完成 OTel/Prometheus/告警联动。** 本地有 Trace/Metrics/Health 类型和 Collector 配置，仍需在部署环境验证跨服务 trace、事件延迟、队列积压、审计失败、Context resume SLO 和告警触发/恢复。

## P7：搜索和智能能力

- [ ] **[P7-01][缺实现] 将 ProposalService 接入 API、MCP 和工作台。** `workers/intelligence` 目前只有进程内 ProposalService，没有 proposal list/confirm/reject 路由、审计和 UI 审批；完成条件：默认 `proposed`，带 source/provenance，人工 expected_revision 确认后才可进入 verified。
- [ ] **[P7-02][待外部环境] 接入真实模型/Embedding 与 Golden 评测。** 当前评测和建议主要是 deterministic fixture；需要固定模型、prompt、embedding/index 版本，执行 source fidelity、next action、stale content、injection 和人工抽样回归，并保存阈值报告。
- [ ] **[P7-03][缺实现] 实现阻塞/依赖/进度分析的可消费输出。** 将 blocker、dependency、progress suggestion 接入 ContextPack、REST/MCP/UI，始终区分 desired/observed/verified，禁止智能结果直接提升权威状态。

## P8：发布、恢复和私有化交付

- [ ] **[P8-01][缺实现] 生成可批准的不可变 Release Manifest。** `deploy/release-manifest.yaml` 仍含 `PLACEHOLDER_SET_BY_CI` 和 `sha256:SET_BY_CI`；需用真实 git SHA、镜像 digest、migration/schema/fixture/client/Plane/ai-memory 版本生成并审批清单，且不把占位符带入 RC。
- [ ] **[P8-02][待外部环境] 重新执行 RC 真实门禁。** 依次运行 live readiness、Compose clean install、Plane→Webhook→Projection→ContextPack→MCP、客户端切换、身份/审计、依赖故障恢复、性能负载、备份恢复和 release smoke；本次审计因服务未运行，不能沿用历史报告宣称当前通过。
- [ ] **[P8-03][待外部环境] 完成目标集群升级/回滚和 HA 证据。** 在目标 k3s/Helm 环境执行 upgrade、rollback、3 副本重建、节点/Pod 恢复、事件重放和恢复后业务 smoke，并保存 manifest、image digest、migration checksum、trace 和审批记录。
- [ ] **[P8-04][待外部环境] 完成生产数据恢复和上线 Smoke。** 验证 PostgreSQL、SQLite outbox、ai-memory、对象存储恢复后的 revision/hash/event/audit 一致性，随后检查事件延迟、Context resume、Plane Webhook、策略拒绝无副作用、审计留存和告警，再决定是否打开 Feature Flag。
- [ ] **[P8-05][风险登记] 处理依赖镜像漏洞报告。** 当前 `trivy-images-current4` 对多项基础镜像仍报告 HIGH/CRITICAL；按 ReadMe 当前范围它不作为功能 RC 门禁，但必须在发布清单中保留扫描结果、例外批准、升级计划或明确接受风险。

## 文档和维护

- [ ] **[DOC-01][文档漂移] 让 `ReadMe.md` 成为单一入口。** 当前文件同时包含早期方案、最终方案和重复的实施计划，首个两周清单仍全部未勾选；应保留架构基线，链接到本 TODO、当前验证审计和唯一实施计划，删除/标注过期副本。
- [ ] **[DOC-02][文档漂移] 每次 live gate 后更新状态审计。** `docs/design/06-planning/05-completion-audit.md` 中的“当前通过”必须与最新运行环境和报告一致；离线、simulated、历史报告不得升级为当前 RC/生产通过。
- [ ] **[DOC-03][维护] 增加自动差异检查。** CI 应检查 WCP 路由、MCP 名称、Schema、SDK、Mock、README/requirements matrix 和测试矩阵的一致性，避免计划继续显示已完成而运行时只覆盖子集。

## 推荐执行顺序

1. 先完成 P0-01/02/03/04，冻结真实契约、事件总线和追踪状态。
2. 接着完成 P3-01/02 与 P4-01/02/03，先把同步、冲突和客户端入口接成闭环。
3. 完成 P1-01/02、P2-01/02/03，替换内存实现并验证 Plane/存储恢复。
4. 完成 P5-01/02、P6-01/02/03，补齐可操作工作台、身份、审计和观测。
5. 完成 P7-01/02/03，最后打开 proposal/vector 等非默认能力。
6. 按 P8-01/02/03/04 执行 RC、升级回滚和生产 Smoke，清单批准后再发布。

## 审计证据入口

- 规划基线：[ReadMe.md](ReadMe.md)
- 总体计划：[docs/design/06-planning/00-overall-development-plan.md](docs/design/06-planning/00-overall-development-plan.md)
- 当前完成审计：[docs/design/06-planning/05-completion-audit.md](docs/design/06-planning/05-completion-audit.md)
- WCP 契约：[docs/design/01-contracts/wcp-api.md](docs/design/01-contracts/wcp-api.md)
- MCP 契约：[docs/design/01-contracts/mcp-interface.md](docs/design/01-contracts/mcp-interface.md)
- 模块协接：[docs/design/03-integration/04-module-interface-contracts.md](docs/design/03-integration/04-module-interface-contracts.md)
- 计划审计工具：[tools/plan-audit.mjs](tools/plan-audit.mjs)
- 发布就绪工具：[tools/rc-readiness.mjs](tools/rc-readiness.mjs)
