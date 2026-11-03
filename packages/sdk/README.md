# WCP SDK

新增 `submitConflictDecision(original, {reviewed:true, timeout_ms?, signal?})`，发送已保存的完整原 identity/request_key/command；固定原正文、身份前置条件、键和版本，不生成键或自动重试。默认本地 30 秒，完整成功/错误响应限 2 MiB/16 KiB，并验证旧封套和完整决策事件；返回仅 `status=unconfirmed` 的规范结果及原请求副本，需后续明确 getConflictReceipt 确认绑定。SDK 自身不保存文件或查询回执，原 resolveConflict 保留兼容行为。新提交及 getConflictReceipt 始终核对三层范围和已提供的身份约束；普通字符串账号可在 SDK 上下文省略 actor/client，仍由 original.identity 生成预期身份头供 Gateway 对可信身份完全核对。见 `docs/design/01-contracts/conflict-submission-runtime.md`；仅源码，未编译、测试或调用。

新增 `getConflictCommandContext(options?)` 和 `WcpConflictCommandContextOptions`，只读当前可信冲突操作 identity、expires_at、resolve_conflicts=true。默认本地 30 秒，支持 timeout_ms/signal；成功/错误正文各 16 KiB，完整验证范围/trace/空来源、可选 actor/client 相等约束和未过期时间。固定请求副本，不继承幂等键/写版本、不自动重试或保存；提示不能替换旧请求的原身份/版本/键，不证明项目可读或原决定成功。输出类型 ConflictCommandContextData/Envelope 已导出，见 `docs/design/01-contracts/conflict-recovery-runtime.md`；仅源码，未编译、测试或实际调用。

新增 `getConflict(conflictId, options?)` 独立读取冲突；`WcpConflictReadOptions` 提供 timeout_ms/signal，默认本地 30 秒，成功/错误上限 2 MiB/16 KiB。完整封套核对范围、ID、trace、来源与决策状态，版本保持十进制字符串，local_value_json/server_value_json/resolved_value_json 保持数据库 JSON 文本以避免数值舍入；对应 value_state 明确区分 SQL NULL 与保存的 JSON null。此方法不依赖列表，不自动解决、翻页或重试，不把历史决策当作原请求回执；详见 `docs/design/01-contracts/conflict-read-runtime.md`，未运行或测试。

检查点全文读取现使用有界 JSON：`getSessionCheckpoint(sessionId, checkpointId, options?)` 完整封套最多 2 MiB；`listSessionCheckpoints(sessionId, input?, options?)` 与 `listCheckpoints({session_id, before_revision?}, options?)` 最多 8 MiB，仍每页十条。公开 `WcpCheckpointReadOptions` 支持 timeout_ms/signal，默认本地 30 秒，Fetch 自身期限仍独立生效，错误最多 16 KiB。超限整条/整页失败，不返回截断笔记；两个历史方法保留各自 GET 范围封套和 POST 工作台身份/权限封套。共享解析再次验证全文/游标/身份/trace，未知响应或超时使用有限错误；不自动翻页/重试。自定义 transport 必须支持 bounded-json 与 signal，其已分配对象不因此有全局内存上限。详见 `docs/design/01-contracts/checkpoint-read-runtime.md`，仅源码，未运行。

`getSessionCommandContext(options?)` 新增独立当前身份读取，返回 identity、expires_at 和 read_sessions/write_sessions/claim_handoffs 提示，不读取目录或业务记录。`WcpSessionCommandContextOptions` 支持 timeout_ms/signal，默认本地 30 秒，成功/错误正文各 16 KiB；核对完整范围/trace/身份约束和过期，不继承写条件、不自动重试或保存。提示不能授权未来命令或替换保存请求中的原身份，也不证明项目/交接仍可读。见 `docs/design/01-contracts/session-command-context-runtime.md`；仅源码，未编译、测试或实际调用。

项目检查点目录新增 `listCheckpointRegistry(query?, options?)`，query 支持 query/checkpoint_id/limit/cursor，默认 25、最多 100；`WcpCheckpointRegistryOptions` 支持 timeout_ms/signal，默认本地 30 秒。完整 `CheckpointRegistryEnvelope` 校验范围、trace、来源、安全修订号、微秒顺序与游标，摘要限 8 KiB 并区分缺失/省略，成功/错误传输限 2 MiB/16 KiB。续页须保持范围、受限数据能力、筛选及 limit，不自动翻页、重试或保存。

`listCheckpoints()` 及无 session_id 的查询改为上述项目分页；提供 session_id 时仅允许 before_revision，保留原每页十条历史形状，不能混入项目目录字段；历史全文读取限制见本页开头。示例 `client.listCheckpointRegistry({query:'handoff', limit:25})` 未执行；详见 `docs/design/01-contracts/checkpoint-registry-runtime.md`。源码和文档阶段，未编译、测试或运行。

交接目录 `listHandoffs(query?, options?)` 现在返回一页完整 `HandoffRegistryEnvelope`，默认 25、最多 100 条。query 支持 query/status/session_id/origin/limit/cursor；status=open 包含 open/offered，closed 为其他历史状态，session_id 精确 ULID，origin=session/projection。query 是数据库不区分大小写的字面子串。示例 `client.listHandoffs({status:'open', origin:'session', limit:25})` 仅说明源码接口，未执行。

续页显式传入 next_cursor，保留原筛选、范围、受限数据能力及 limit；updated_at 会变化，不是固定历史快照。`WcpHandoffRegistryOptions` 支持 timeout_ms/signal，默认本地 30 秒，Fetch 自身期限独立生效；成功/错误 2 MiB/16 KiB。摘要超过 8 KiB 为 null/too-large，原缺失为 null/missing；权限和所有权提示不替代原请求回执或写授权。旧全量行为已替换，不自动遍历、重试或保存；详见 `docs/design/01-contracts/handoff-registry-runtime.md`。仅源码，未编译、测试或实际调用。

会话目录 `listSessions(query?, options?)` 现在只返回一页，默认 25、最多 100 条。query 支持 query/status/client_id/limit/cursor；query 为数据库不区分大小写的字面子串，status/client_id 精确匹配。续页显式传入返回的 next_cursor，并保留原筛选与 limit；改变它们或项目/受限数据能力须重回首屏，不自动遍历。返回完整 SessionRegistryEnvelope，校验原范围/trace/来源、微秒顺序、记录唯一性、状态、权限提示和游标位置。旧无参数全量行为不再保留。

`WcpSessionRegistryOptions` 支持 timeout_ms/signal，默认本地 30 秒；Fetch 自身期限独立生效。成功/错误最多 2 MiB/16 KiB，取消不能撤销后台读取，迟到结果被拒绝。只读不继承写条件、不自动重试或保存。示例 `client.listSessions({status:'running', limit:25})` 仅说明源码接口，未执行；详见 `docs/design/01-contracts/session-registry-runtime.md`。

管理快照新增 `client.getAdminSnapshot({ timeout_ms?, signal? })`，公开选项类型为 `WcpAdminOptions`。构造上下文须包含固定 project_id；方法只发送 `{operation:'admin'}` 到既有 workbench 查询，配置的 actor/client 只作为认证身份的相等约束。返回完整 `WorkbenchAdminEnvelope`，严格核对范围、原 trace、来源、计数状态与全部 not-checked 字段，并构造独立结果。不会继承写条件或探测其他服务。

默认本地等待 30 秒，可配置 1–2147483647 毫秒并取消；Fetch transport 自身期限仍独立生效，较早期限生效。成功和错误正文均限 16 KiB，错误仅返回有限说明、原 trace 和 retryable=false。SDK 不解析令牌猜测权限，实际管理员及计数能力由 Gateway 判定；not-authorized 不是零，数据库 read-succeeded 不表示外部服务或发布就绪。无自动重试、保存或 Mock 成功数据；仅源码接口，未编译、测试或实际调用。

审计读取新增 `listAuditRecords({ resource?, trace_id?, action?, audit_id?, session_id?, cursor? }, options?)`，导出新增 `exportAuditView(reviewedDocument, options?)`。两者都要求构造上下文中有固定 project_id，消费既有 Gateway 的真实权限；配置的 actor_id/client_id 作为相等约束发送，不作为认证来源。每次查询最多返回 200 条，完整检查 scope/trace/筛选/排序/游标/字段可用状态；续页由调用方明确传入 next_cursor 并保留筛选，不自动扫描历史。

会话筛选示例：`client.listAuditRecords({ session_id: '01J000000000000000000000001' })`。session_id 必须为 ULID，与其他筛选取交集并绑定分页游标；添加、移除或改变该值须从首屏重新读取。只匹配审计中已记录的会话目标，历史未关联及其他未填字段记录不会出现；入口 allowed 不证明命令成功，空页不证明没有会话活动。此为源码用法，未实际调用。

```ts
import { auditExportDocument } from '@planemem/contracts';

// 独立的读取示例，未执行。向用户展示此 document，保留省略状态。
const page = await client.listAuditRecords({ audit_id: selectedAuditId });
const record = page.data[0];
const documentForReview = record ? auditExportDocument(page.scope, record) : undefined;
```

```ts
// 仅在调用方明确确认已审阅后执行；不以重新读取的另一份记录替代 reviewedDocument。
const envelope = await client.exportAuditView(reviewedDocument, {
  timeout_ms: 90_000,
  signal: cancelController.signal,
});
// 这里只得到内存 JSON；文件保存由调用方另行决定与实现。
```

导出方法在首次异步等待前固定 document 文本、核对项目范围并计算 SHA-256，只发送 scope/audit_id/sha256。响应按共享完整封套校验，复制结果、逐字比对固定 document 并独立计算摘要；不自动查询替代内容、不接受构造上下文中的写键/expected_version/If-Match，也不自动重试或保存文件。被省略内容保持省略；release-recorded 不是客户端保存证明。方法要求 Web Crypto，缺失则在发送前失败。原始 details 中的不安全整数、复杂度或大小超限仍可能使可读取记录无法导出。

公开 `WcpAuditOptions` 只含 `timeout_ms` 和 `signal`。本地整次等待默认读取 30 秒、导出 90 秒，包括摘要、传输和解析后的截止时间检查；正整数自定义期限最多 2147483647 毫秒。同步解析不能中途抢占，但迟到结果不返回成功。取消/超时不能撤销已派发导出，已知放行 ID 保留在错误 details，未知只能说明 unconfirmed。审计方法只提供有限错误说明、固定请求 trace、合法已确认放行引用，并将 retryable 设为 false；不直接回显上游原始 message/details。

`FetchWcpTransport` 新增显式 `response_type:'bounded-json'`：必需 `max_response_bytes`（1–16 MiB），支持 JSON GET/POST 和 `signal`，不支持 multipart。成功只接受完整 200、正确 trace 头与 JSON 媒体类型，错误正文上限 16 KiB；严格 UTF-8，规范无压缩 Content-Length 必须与完整实际字节一致，压缩响应按 Fetch 解码后大小限制。审计列表请求上限 16 MiB，导出 128 KiB。凭据提供器、fetch、正文和解析共用传输期限；迟到凭据不会再发起请求，迟到 fetch 响应取消正文。无重定向、缓存或重试。普通 json/bytes 模式没有自动获得这些新增保证。

传输层 `timeout_ms` 仍默认 30 秒，和审计方法期限各自生效，较早到期者停止等待；需要等待较久的导出时应同时配置传输层，例如构造 `FetchWcpTransport` 时设 `timeout_ms:90_000`。自定义 WcpTransport 需实现新的 bounded-json 大小、状态、trace 和取消约定；方法外层仍限制本地等待并验证完整对象，但不能保证自定义实现的网络缓冲、取消或后台副作用。SHA-256 不是离线签名，document_bytes 不是整个封套文件大小。

本次审计 SDK 仅源码/文档，未运行上述示例、网络请求、编译、类型检查、测试或发布；未新增依赖/迁移或 Mock 成功证据。完整约定见 [审计视图导出](../../docs/design/01-contracts/audit-export-runtime.md) 和 [审计读取](../../docs/design/01-contracts/workbench-audit-runtime.md)。

运行/工具收尾和结束会话现已采用同一原身份规则：`finishAgentRun(..., options, expectedIdentity?)`、`finishToolCall(..., options, expectedIdentity?)`、`endSession(sessionId, status, options, expectedIdentity?)`。省略显式身份时构造上下文须固定完整原身份；原 key/version 与上下文冲突、选项未知字段或缺少原目标/版本时发送前拒绝。共享解析核对原结果、记录来源、trace、可选 ETag 和版本增量；同终态的合法无变化结果允许增量 0，真实状态转换为 1。结束响应的 actor_id/client_id 是会话创建者，不要求等于本次收尾操作者；校验范围、开始/结束时间、父会话和续接来源结构。历史结果仍须保留原请求，不自动重试；无新增迁移，仅源码开发。

活动创建新增原请求绑定：`startAgentRun(sessionId, { model? }, { idempotency_key, expected_version }, expectedIdentity?)`、`recordToolCall(sessionId, { run_id, tool_name, status }, options, expectedIdentity?)` 要求原 tenant/workspace/project/actor/client。省略 expectedIdentity 时只能使用构造上下文固定的完整身份；显式身份、键或版本与已配置上下文冲突时发送前拒绝。新创建字段限定，名称最多 1024 个 UTF-16 单元，不 trim 已提供的名字。成功校验原 session/version/参数、来源、trace、明细 version=1 及 session_version=原版本+1，返回原创建记录；记录的状态不证明当前仍在运行。

`getSessionCommandReceipt(sessionId, query, expectedIdentity?)` 现在也绑定原身份，适用于 run.start/run.finish/tool.call/tool.finish/end。query 保留 request_key、operation 和所有原 command 字段（含有效 expected_version）；原 command 的额外字段保留，不能以当前参数替换。查询不继承构造上下文的键/版本或 If-Match，不执行命令；封套必须匹配 trace、空来源且没有当前记录 ETag。调用方负责发送前保存原请求，SDK 不自动持久化、换键或重试。无新迁移，仅源码开发，尚未编译或测试。

```ts
// identity 是准备原请求时保存的 tenant/workspace/project/actor/client。
// 先由调用方保存 original；以下是两次独立的显式调用示例，未执行。
const original = {
  sessionId,
  identity,
  key: 'run-create-001',
  command: { expected_version: 3, model: 'recorded-model-name' },
};
const run = await client.startAgentRun(original.sessionId,
  { model: original.command.model },
  { idempotency_key: original.key, expected_version: original.command.expected_version },
  original.identity);
// 如果原调用结果未知，单独查询；not-observed 不能证明失败或作为换键依据。
const receipt = await client.getSessionCommandReceipt(original.sessionId,
  { request_key: original.key, operation: 'run.start', command: original.command },
  original.identity);
```

普通开始新增严格回执恢复：`startSession(session, { idempotency_key }, expectedIdentity?)` 保留原可选 parent_session_id/actor_id/client_id，成功必须包含匹配的 start_receipt。`getSessionStartReceipt({ request_key, session }, expectedIdentity?)` 只查询原开始，不创建会话、不结束会话、不续接。expectedIdentity 为原 tenant/workspace/project/actor/client；省略时必须在构造上下文中固定完整身份，显式身份与已配置范围/账号/客户端冲突则发送前拒绝。开始不接收版本条件，查询不发送新键或继承的版本条件。

调用方应在开始前持久保存原身份、原 session 正文和键，保留可选字段实际是否提供；SDK 不自动保存、生成键或重试。not-observed、旧记录缺少回执或无效成功响应不能证明失败，不可据此换键。共享解析器核对 trace、原回执、当前会话、来源和可选 ETag；历史创建成功不代表会话仍运行。044 未执行，SDK 接入仅源码开发，详见 [会话开始回执](../../docs/design/01-contracts/session-start-runtime.md)。

创建交接新增原身份和回执校验：`createHandoff(sessionId, handoff, { idempotency_key }, expectedIdentity?)` 保留原 checkpoint_id 和可选 target_client/from_client/session_id。`getHandoffCreateReceipt(sessionId, { request_key, handoff }, expectedIdentity?)` 用原字段查询结果，不创建、领取或续接。expectedIdentity 包含原 tenant_id、workspace_id、project_id、actor_id、client_id；省略时须在构造上下文中固定完整身份，显式值与已配置范围/身份冲突则拒绝。创建不接受版本条件，回执查询不发送新写入键。

请在发送前保存原身份、父会话、业务参数和键。结果未知时用同一记录查询；not-observed 不证明失败，普通响应缺少有效 create_receipt 也不能认定成功。共享解析器核对 trace、原身份/目标/检查点、当前交接、来源和可选 ETag。不会自动生成键或重试；043 迁移未执行，只有源码开发。详见 [创建交接回执](../../docs/design/01-contracts/handoff-create-runtime.md)。

Plane 工作项 state 读取现在区分活动快照（内层 data.schema_version=1）与删除标记（内层为 2，带 deleted_at，fields 只有 external_id，无 status）。外层 envelope 仍为 v1，`getObservedWorkItemState` 通过共享解析器识别二者；调用方必须检查内层版本，不能把删除标记当作活动工作项。`getObservedWorkItemContext` 对可见的已删除观察返回 OBSERVED_RECORD_DELETED/410，不召回外部记忆；需要删除来源时另读 state。队列诊断可返回 deleted_stream，不能据较高版本安排恢复。依赖仅写文件、未执行的 040 迁移，未编译或测试。

WorkItemRestored 的活动快照仍为内层 v1，额外带 restored_from={event_id,aggregate_version}。共享解析器核对其引用、字段与当前版本；普通后续更新不带该顶层来源。恢复必须经签名 Canonical 事件，精确引用上一删除事件，保留分类与到期。SDK 不提供 Plane 恢复命令；诊断 next_version 只说明顺序，不证明恢复条件满足。无新增迁移或运行证据。

`listObservedWorkItems({ state: 'active' | 'deleted' | 'all', limit, cursor })` 读取当前项目的 Plane 观察元数据目录，默认 active/25，最多 100。data 含 scope、checked_at、items 和可选 next_cursor；source_refs 为空，不返回 payload。按 external_id 排序，删除条目标题/状态为 null；活动标题/状态最多 2000/255 个 Unicode 字符，详情另读 state。继续分页必须保留筛选、页大小和身份，权限每页重查，跨页不保证同一快照。需要 context.read；与本地工作项目录分开。041 排序索引只写文件，未执行、编译或测试。

目录增加可选 `query`，例如 `listObservedWorkItems({ query: 'release', state: 'all' })`。最长 500 个 UTF-16 单元、去除首尾空白；字面包含 external_id/aggregate_id 或当前活动标题摘要，仅忽略 ASCII 英文字母大小写。删除记录只匹配 ID，百分号/下划线不是通配符。共享解析器复核匹配，续页保留同一检索词；游标已升至 v2，旧游标需重新开始。未执行网络请求、编译或测试。

`getPlaneInboxDiagnosis(eventId)` 读取版本诊断，要求可信管理员/admin.read。data 返回目标 record、可读的实际最新已提交 baseline、position、next_version、uncommitted_versions，以及各最多 10 条的下一版本/同版本候选回执与 has_more。baseline_unavailable 同时覆盖没有可用历史、旧回执缺失或不可见，不能据此断言没有提交；gap 区间也不表示事件未收到。SDK 复核范围、目标、trace、空来源、同快照和版本关系；next_version 不保证处理成功，方法不会补拉或安排重试。例：`await client.getPlaneInboxDiagnosis(eventId)`。本次只写源码，未执行示例。

管理员队列概览新增 `getPlaneInboxSummary()`，对应 GET `/v1/plane/events/summary`，无需输入或写入选项，沿用可信 admin/admin.read 权限及当前项目/分类过滤。返回 `data.counts`（total、pending、applied、rejected、due、delayed、version_gap）、四个队列时间字段和 checked_at；计数保持十进制字符串。SDK 核对范围、trace、空来源、计数关系和时间一致性，非法响应为 GATEWAY_RESPONSE_INVALID。pending=due+delayed，version_gap 是 pending 子集；概览不受列表筛选或分页影响。到期行可能正在处理，零积压不证明上游同步完成或处理器健康；父项目缺失/不可见为 404，不能当作零队列。本次仅源码接入，没有运行验证。

管理员事件队列新增 `listPlaneInboxEvents({ status?, pending_state?, aggregate_id?, limit?, cursor? })` 与 `getPlaneInboxEvent(eventId)`。对应 `/v1/plane/events` 和单事件回执，只读、不传写入选项或请求键。令牌需可信客户端身份、admin 角色，并通过 admin.read 策略；restricted 数据另按当前读取能力过滤。SDK 不接受业务参数伪造角色或范围。

pending_state 默认为 all（不增加筛选）；due/delayed/version_gap 只返回对应待处理记录，要求 status 为 all 或 pending。例：`client.listPlaneInboxEvents({ status: 'pending', pending_state: 'due' })`。续页保留 pending_state、其他筛选和 limit；改条件或使用旧开发版本游标时回到第一页。时间筛选以每次读取时刻为准，version_gap 只表示最近一次记录的版本缺口；返回值仍经过共享页解析器的筛选一致性校验。列表与概览为独立读取，不能将概览数字当作随后列表的固定总数。示例未执行。

列表默认 25 条，最多 100 条，按事件 ID 倒序；续读使用 `data.next_cursor` 并保留筛选和 limit。`data.items` 与单条详情复用 `@planemem/contracts` 的 PlaneInboxPage/PlaneInboxRecord；SDK 核对本次 trace、空 source_refs、当前三层范围、目标 ID、状态、时间、十进制版本/队列修订号/尝试次数及分页顺序，异常响应为 GATEWAY_RESPONSE_INVALID。pending 表示已保存但未完成处理；applied 是历史处理确认，不证明当前快照可读；404 不证明从未收到。未编译或测试，见 [接收队列与回执](../../docs/design/01-contracts/plane-inbox-runtime.md)。

人工重试新增 `retryPlaneInboxEvent(input, options)`，只安排原事件重新处理；`getPlaneInboxRetryReceipt(input, options)` 只查询原请求结果。两者使用相同的 input 和 options，客户端不自动生成请求键、不自动换修订号或重提。input 包含 `event_id`、十进制字符串 `expected_revision` 和 `reason`；options 是导出的 `WcpPlaneInboxRetryOptions`，包含 `idempotency_key`、`expected_actor_id`、`expected_client_id`。预期身份来自准备原命令时确认的认证会话，不能用 token 刷新后的新身份替换。网关将这两个预期值与已验证签名中的 subject/client 比较；它们不授予管理员权限。排队命令还要求签名 human 身份和 plane.retry 策略，回执查询要求可信 admin/admin.read。

```ts
// 将 original 与 retryOptions 一起保存在调用方的恢复记录中，再显式提交。
const original = {
  event_id: '01J000000000000000000000001', // 替换为实际事件 ID
  expected_revision: '7',                  // 来自该事件详情的 revision
  reason: '已排查前置事件到达情况，重新安排处理',
};
const retryOptions = {
  idempotency_key: 'plane-retry-operator-001',
  expected_actor_id: 'operator-subject',    // 替换为已确认的 subject
  expected_client_id: 'operator-client',   // 替换为已确认的 client
};
const scheduled = await client.retryPlaneInboxEvent(original, retryOptions);
// 若原响应不确定，单独查询原请求；此调用不会再次安排处理。
const outcome = await client.getPlaneInboxRetryReceipt(original, retryOptions);
```

成功回执的 `data.record` 是安排重试时的历史 pending 状态，不代表当前处理进度。查询返回 `data.status=recorded` 或 `not-observed`；后者不能证明失败，也不是换键依据。SDK 核对原身份、范围、请求键、命令、队列修订号递增关系、尝试次数不变、trace 和空来源。原修订号始终保持字符串，不发送 If-Match，也不继承客户端 context 的旧请求键/数值版本；拒绝 input/options 的未知字段。当前状态另用 getPlaneInboxEvent 读取。该能力依赖尚未执行的 039 迁移，示例未执行。

Plane 观察状态新增 `getObservedProjectState()`、`getObservedWorkItemState(workItemId)` 和 `getObservedWorkItemContext(workItemId)`。项目使用客户端当前 project_id，工作项参数是 Plane external_id 或事件 aggregate_id；与 `getWorkItemProjection(itemId)` 的本地 ID 区分。三者均只读，不传写入选项或请求键，需 context.read。SDK 使用共享解析器核对请求 ID、三层范围、来源和 trace，非法/跨范围响应返回 GATEWAY_RESPONSE_INVALID；plane_version 保持正安全整数，超界不舍入。

工作项上下文的兼容字段 context_pack 是摘要命中集合，不能当作 ContextPackReceipt 保存或续接；解析器核对首条本地命中的观察版本及来源，并核对外部命中为 memory/restricted、范围一致且无重复。data.context_pack 的 memory_used/degraded 表示本次召回情况，不证明外部证据有效。新增类型 ObservedSnapshot、ObservedWorkItemContext 与解析器位于 `@planemem/contracts`。本批仅开发，未编译或测试；详细边界见 [观察状态持久读取](../../docs/design/01-contracts/observed-state-runtime.md)。

`listLegacyContextIndexes({ query?, state?, managed_by?, limit?, cursor? })` 分页查询旧索引元数据。query 按 ID 字面包含，state 为 all/active/expired/deleted，managed_by 为 all/manual/plane；默认每页 25、最多 100，响应 data.next_cursor 继续，保留原筛选。包含已删/已过期元数据，不返回正文；页大小不是总数。目录与 034 排序索引只加入源码，未运行验证。

旧索引管理新增 `getLegacyContextIndexStatus(id)`、`deleteLegacyContextIndex({ id, expected_revision, reason }, { idempotency_key })` 和 `restoreLegacyContextIndex(...)`。状态仅返回元数据，写响应是历史回执；重试保留原版本/理由/键，另读状态获取当前版本。恢复保持原分类与到期，Plane 投影不能手工操作。SDK 校验回执与原请求及范围一致；依赖未执行的 033 迁移，见 [旧索引管理](../../docs/design/01-contracts/legacy-context-lifecycle-runtime.md)。

`searchProject({ query, type, mode, include_inactive_context, limit, cursor })` 直接搜索已保存工作项及上下文，默认 20、最多 50 条。mode 为 fts（词语 AND）或 substring（字面包含）；下一页游标在 `data.next_cursor`，保留查询和筛选。SDK 校验响应范围、记录和版本，全文分数不表示来源新鲜度；说明见 [项目搜索](../../docs/design/01-contracts/project-search-runtime.md)。

`getProjectOverview()` 返回同条数据库查询得到的项目汇总、上下文各层统计及有限条预览。SDK 校验总数、状态、预览大小和标识；`average_confidence` 为保存值均值，不能用作来源新鲜度，proposed 也不等于可立即确认。不可见项目返回 404。字段及口径见 [项目概览读取](../../docs/design/01-contracts/workbench-overview-runtime.md)。

`listWorkItemProjections({ query, status, cursor, limit })` 读取工作项投影页，默认 25、最多 100 条，返回 data 数组和可选外层 next_cursor。继续时保留 query/status；范围或受限数据权限变化需移除 cursor。分页按更新时间倒序、ID 升序，不提供快照隔离。SDK 校验输入、条目、重复 ID、状态、页大小与游标；每页数量不是项目总数。

`getWorkItemProjection(itemId)` 按本地 ID 读取当前项目可见工作项投影，保留来源和追踪，使用共享输入/响应解析器。`data.version` 是正十进制字符串，避免 BIGINT 精度丢失；它不是 Plane 写入版本，也不证明外部来源当前有效。缺失或不可见统一 404。见 [工作项投影详情](../../docs/design/01-contracts/work-item-projection-runtime.md)。

`WcpClient` 通过 `WcpTransport` 调用网关。`FetchWcpTransport` 提供真实 HTTP 请求、每次请求取令牌、超时和结构化错误处理。此次开发未执行编译或测试。

```ts
import { assertUlid, createUlid } from '@planemem/contracts';
import { FetchWcpTransport, WcpClient } from '@planemem/sdk';

const tenant = process.env.WORKCTX_TENANT_ID;
const workspace = process.env.WORKCTX_WORKSPACE_ID;
const project = process.env.WORKCTX_PROJECT_ID;
assertUlid(tenant);
assertUlid(workspace);
assertUlid(project);

const client = new WcpClient(new FetchWcpTransport({
  base_url: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
  access_token: () => process.env.WORKCTX_ACCESS_TOKEN ?? '',
}), {
  tenant_id: tenant,
  workspace_id: workspace,
  project_id: project,
  trace_id: 'trace_sdk_' + createUlid(),
});

// 从准备请求时确认的认证会话保留标识；它们只作前置条件，不授予权限。
const originalIdentity = {
  tenant_id: tenant, workspace_id: workspace, project_id: project,
  actor_id: process.env.WORKCTX_ACTOR_ID ?? '',
  client_id: process.env.WORKCTX_CLIENT_ID ?? '',
};
const originalStart = {};
// 发送前将 originalIdentity、originalStart 和 start-001 保存到调用方的恢复记录。
const started = await client.startSession(originalStart, { idempotency_key: 'start-001' }, originalIdentity);
// 原响应丢失时，单独查询；不能使用新键猜测重提。
// await client.getSessionStartReceipt({ request_key: 'start-001', session: originalStart }, originalIdentity);
// 以下检查点示例仅适用于确认仍在运行且版本未变化的会话。
const originalCheckpoint = {
  completed: ['已记录需求'],
  in_progress: ['实现功能'],
  next_actions: ['继续开发'],
  decisions: [], risks: [], open_questions: [],
};
// 保存原笔记、可选引用、版本、身份和键；未知结果时保持原值。
const checkpoint = await client.createCheckpoint(started.data.session_id, originalCheckpoint,
  { idempotency_key: 'checkpoint-001', expected_version: started.data.version }, originalIdentity);
// await client.getCheckpointReceipt(started.data.session_id,
//   { request_key: 'checkpoint-001', checkpoint: { ...originalCheckpoint, expected_version: started.data.version } }, originalIdentity);

const originalHandoff = {
  checkpoint_id: checkpoint.data.checkpoint_id,
};
// 先将原会话、originalIdentity、originalHandoff 和键保存到调用方的恢复记录。
const handoff = await client.createHandoff(started.data.session_id, originalHandoff,
  { idempotency_key: 'handoff-001' }, originalIdentity);
// 响应丢失时另行显式查询，不使用当前交接状态反推原请求。
// await client.getHandoffCreateReceipt(started.data.session_id,
//   { request_key: 'handoff-001', handoff: originalHandoff }, originalIdentity);
```

已接入的操作：

- 会话：`startSession`、`getSessionStartReceipt`、`startAgentRun`、`recordToolCall`、`endSession`。
- 运行收尾：`finishAgentRun(sessionId, runId, 'completed' | 'failed', { idempotency_key, expected_version, expected_run_version }, expectedIdentity?)` 同时核对会话和运行版本。可为已关闭会话补记现有运行结果，保持会话状态；同一终态和当前两个版本匹配时无变化成功，不同终态冲突。可用 `getSessionCommandReceipt` 查询 operation=run.finish，command 须含原路径 run_id 和原两个版本。028 约束迁移仅开发、未执行。
- 活动明细：`listSessionRuns(sessionId, { before_sequence?, limit? })`、`listSessionToolCalls(sessionId, { run_id?, before_id?, limit? })`，使用 context.read。data 含 session 摘要与明细数组，下一页沿用 next_before_sequence 或 next_before_id；工具分页保留原 run_id。默认 25、最多 100 条，响应校验记录范围及排序。记录版本不等于会话版本，状态不代表客户端实时执行状态。
- 当前会话：`getSessionState(sessionId)` 以 context.read 读取 `GET /v1/sessions/{session_id}`，返回 data 的 session_id/status/version/ended_at，以及可信身份（如有）和可写提示。共享解析核对请求 trace、scope、唯一会话来源与结束时间。当前版本只供审阅，不替换原请求版本或证明原键成功；未知结果仍查原回执。只读调用不继承写入键或版本。
- 单次运行：`getSessionRun(sessionId, runId)` 以 context.read 读取 data.session / data.run，不依赖分页；共享解析器校验目标运行、所属会话、版本及来源。两个版本可供准备新的收尾请求；当前状态不等于原请求成功证明。
- 单次工具调用：`getSessionToolCall(sessionId, toolCallId)` 以 context.read 读取 data.session / data.run / data.tool_call，同次读取并校验所属关系、状态、版本和来源。收尾使用会话与工具版本，不使用运行版本；原请求结果仍通过回执确认。
- 工具收尾：`finishToolCall(sessionId, toolCallId, 'succeeded' | 'failed', { idempotency_key, expected_version, expected_tool_version }, expectedIdentity?)` 更新已有工具调用，校验会话与工具版本。支持已结束运行/会话的迟到结果，保持父状态和运行版本；同终态及匹配版本无变化成功，不同终态冲突。029 迁移仅开发、未执行。
- 进度结果恢复：`getSessionCommandReceipt(sessionId, { request_key, operation, command })` 查询 run.start/run.finish/tool.call/tool.finish/end 的原请求；command 保留所有原字段和原 expected_version，run.finish 还需原路径 run_id 和原 expected_run_version，tool.finish 还需原路径 tool_call_id 和原 expected_tool_version。recorded 返回历史版本及运行/工具标识或结束状态，not-observed 不证明失败；SDK 校验响应与原操作匹配。查询不会执行原命令，也不需要新键。
- 续接：`createCheckpoint`、`createHandoff`、`claimHandoff`、`resumeSession`。
- 领取结果恢复：`getHandoffClaimReceipt(handoffId, { request_key, claim: { expected_version, client_id? } }, expectedIdentity?)` 查询原领取，不重新领取。`claimHandoff(handoffId, { idempotency_key, expected_version }, expectedIdentity?)` 也校验持久 claim_receipt。expectedIdentity 为原 tenant/workspace/project/actor/client；省略时必须已在 SDK 构造上下文中固定完整身份。原身份与当前配置不同则拒绝，HTTP 使用身份前置条件核对令牌。not-observed 不证明失败，缺少回执的旧成功响应不能作为原命令证据，不自动换键或提高版本；详见 [领取回执](../../docs/design/01-contracts/handoff-claim-runtime.md)。042 仅写文件、未执行，SDK 入口仅完成源码开发。
- 进度命令：运行和工具响应的 `session_version` 是原写入后的会话版本，自身 `version` 是明细版本；同键重放仍保留历史 session_version。运行/工具/结束命令现在由数据库锁内校验并持久重放，保留原键/原 expected_version 重试；下一条新命令需当前会话版本。详见 [会话进度命令](../../docs/design/01-contracts/session-command-runtime.md)，026 迁移未执行。
- 续接：`resumeSession(parentSessionId, { handoff_id, require_claimed? }, { idempotency_key }, expectedIdentity?, expectedCheckpointId?)`；回执：`getResumeReceipt(parentSessionId, { request_key, handoff_id, require_claimed? }, expectedIdentity?, expectedCheckpointId?)`。身份省略时必须来自固定完整的构造器身份；额外预期检查点仅核对结果，不进入业务正文。写入拒绝版本条件，原键与构造器须一致；查询不继承写条件。普通客户端省略 require_claimed 为 false，工作台客户端必须传原有效 true。保留原值，不从当前记录补造或自动改键。
- 续接成功响应统一核对父子/交接/检查点/身份关系、原 resume_origin、来源及上下文包绑定。重试返回的子会话可能已推进版本或关闭，不强制 version=1/running；记录 trace 可为原提交 trace。checked 包结构/范围/来源/预算经过客户端解析，当前有效性和内容哈希重算由网关负责，提示仅属于该次响应。历史 recorded 回执固定 not-checked；not-observed / legacy-unverified 不证明失败。无自动持久化或重发，025 及其他 016–044 迁移仍未执行。
- 检查点：`createCheckpoint(sessionId, input, options, expectedIdentity?)` 和 `getCheckpointReceipt(sessionId, { request_key, checkpoint }, expectedIdentity?)` 固定原身份。省略身份仅允许构造器已固定完整 scope/actor/client；与构造器冲突或缺少原身份会在发送前拒绝。写入校验原键/版本选项，保留六类数组、旧内嵌包、memory_ref 或 saved pack ID；不 trim、排序或替换原笔记。正常响应核对原笔记、引用、来源、scope 和版本字段，记录 trace 可为原提交 trace。查询保存所有历史额外字段、不继承写入条件；recorded 仅确认保存、不检查包新鲜度，not-observed 不证明失败。调用方自行持久化原请求，无自动重试或换键。
- 检查点可传 `context_pack_id`，与旧 `context_pack` 互斥。续接返回 `context_pack_state`；仅 `checked` 附带完整包回执，缺失状态或 `legacy-unverified` 不表示当前有效。包失效的重试错误不能证明先前同键写入未成功，保持原键并核对历史。见 [检查点上下文绑定](../../docs/design/01-contracts/checkpoint-context-runtime.md)。
- 查询：`listSessions`、`listHandoffs`、`listCheckpoints`，检查点分页信息保留在响应的 `next_before_revision`。
- 会话历史分页：`listSessionCheckpoints(sessionId, { before_revision? })` 使用独立 GET 读取最多十条修订，共享校验 scope/session/trace、原笔记、降序和下一页游标。按返回的 next_before_revision 显式读更旧页，不自动遍历；不可见会话返回错误，不伪装为空页。历史读取不是原保存回执，也不检查包当前有效性。本入口仅源码开发，未编译测试或运行验证。
- 单条交接：`getHandoff(handoffId)` 按 context.read 获取当前归属、版本、时间和原会话/检查点，包含可信身份及权限提示；共享解析校验目标/范围/来源，GET 不带写入条件。当前状态不证明原创建、领取或续接请求成功，不自动写入或验证上下文包。详见 [单条交接读取](../../docs/design/01-contracts/handoff-read-runtime.md)。
- 历史检查点：`getSessionCheckpoint(sessionId, checkpointId)` 以 context.read 读取指定记录，返回 data.checkpoint、created_at 和固定 context_pack_state=not-checked；不依赖历史列表页。共享解析核对 ID/范围/来源/时间，展示原笔记及引用但不确认原请求键成功、不建立包当前有效性。只读请求不发送写入键或版本条件。
- 同步：`uploadEvents`、`getSyncChanges`、`syncPages`、`getSyncCursor`、`acknowledgeSync`。
- 同步原请求：`getSyncCommandContext` 读取准备新事件所需身份；`getSyncEventReceipt` 查询保存的原 identity/event。
- 冲突：`listConflicts(query?, options?)` 返回元数据分页；`getConflict(id)` 独立读取完整值；`resolveConflict` 合并决定要求提供 `merged_value`。
- 上下文包：`compileContextPack({ budget_tokens?, ttl_seconds? }, { idempotency_key })`、`getContextPack({ pack_id?, format? })`。
- 来源条目：`createContextItem`、`getContextItem`、`listContextItems`、`updateContextItem`、`archiveContextItem`。
- 归档管理：`getArchivedContextItem`、`restoreContextItem`；列表传入 `{ archived: true }`。
- 版本历史：`listContextItemHistory(id, { before_version?, limit? })`、`getContextItemVersion(id, version)`。
- 人工确认：`confirmContextItem(id, reason, { expected_version, idempotency_key })`，要求签名 human、客户端身份和 context.review。
- 建议审核：`createProposal`、`listProposals`、`getProposal`、`confirmProposal`、`rejectProposal`。

`createProposal` 可传 `derived_from: { proposal_id, revision }` 从已有可读建议创建独立修订稿，详情在 `provenance.derived_from` 返回该关联。原版本须匹配，分类不降低，所有新来源仍需有效；不会修改或继承原审批。关联链最多 32 次派生，读取沿原建议链检查可见性。规范化返回类型为 `NormalizedCreateProposalRequest`，此字段保持可选，未提供时不会注入默认值。

`listProposals({ derived_from: originalId, limit: 25 })` 查询该原建议的可见直接修订，列表字段为 ULID 字符串，区别于创建时的关联对象。使用 `next_before` 继续分页时保留 derived_from/status/kind；不提供 status 表示所有状态。SDK 使用共享查询解析器，拒绝未知字段、无效 ULID、状态/类型及超范围 limit；返回空页不揭示不可见修订的数量或存在性。

上述操作返回 `WcpEnvelope<T>`，保留 trace、来源、revision、ETag 和游标。会话写入类型遵循实际服务响应，使用 `session_id/checkpoint_id/handoff_id`，与旧的基础 Entity schema 区分。列表查询保留数据库投影视图；冲突列表的 BIGINT 版本可能是字符串，写入前须转换并检查为安全正整数。

Artifact 元数据新增 `getArtifact(id)` 和 `getArtifactVersion(id, version)`，要求签名 artifact.read。返回 data.artifact、snapshot=current/historical 与 content_state=not-checked；不含对象存储键、下载 URL 或正文，不作为原写入回执。当前读取保留外层 ETag，历史读取只在快照内保留原 ETag；指定版本缺失不会改读当前版本。共享解析核对目标、范围、内容描述、来源及时间，不自动重试。服务器须显式配置持久 reader 或存储，未配置返回 503；目前仅源码接入，见 [Artifact 持久化](../../docs/design/01-contracts/artifact-persistence-runtime.md)。

`getArtifactReceipt({ identity, command })` 查询原创建/追加请求是否已记录，需要签名 artifact.write 和已验证客户端。identity 是提交时保存的 tenant/workspace/project/actor/client 五字段，必须与 SDK 上下文一致；command 是原 `ArtifactWriteCommand`，包含 request_key、hash/size 和完整原参数，不包含文件正文。不要用当前版本或新键改写它。查询发送 POST /v1/artifacts/receipt，不继承 SDK 上下文写条件，也不自动重试。data.status=recorded 时 artifact 为原历史快照，replayed=true、content_state=not-checked；not-observed 不证明失败。无外层 ETag、存储键或正文可用性保证；响应不匹配会报错并保留原请求未知状态。服务器需 artifact_receipts 或 artifact_storage；单独元数据 reader 不启用回执。目前仅源码，未运行验证。

每次写入显式传入 `idempotency_key`；有版本条件的操作还传 `expected_version`，SDK 将其编码为 `If-Match`。不会自动重试写入。遇到可重试错误时由调用方使用原请求内容和原键重试；参数变更需使用新键。身份和能力由网关从访问令牌确定。

`getSyncChanges({cursor?,limit?}, {timeout_ms?,signal?})` 读取完整单页，默认 limit=100、最多 500 条，默认单页本地等待 30 秒；bounded-json 成功限 4 MiB、错误限 16 KiB。完整核对当前 trace、范围、来源拼接、唯一事件、严格递增游标及续页边界，保留附加历史字段，超限不截断。省略 cursor 从当前账号/客户端服务器确认位点读取；显式 0 从零读取，权限过滤允许跳号。错误固定文案、retryable=false，不自动重试。

`syncPages(query, options)` 为按需异步分页迭代器，调用时固定参数，第一笔 next() 才请求，每页独立预算。yield 前独立保存下一游标/has_more，修改返回页或原参数不会改变续页；has_more=false 时结束，break 后不预取。getSyncChanges/syncPages 的 options 可带 expected_identity，固定原消费者身份头。读取不会自动确认、保存或应用；调用方须在完整页面、身份和目标游标已持久保存后，明确调用 `acknowledgeSync(page.data.next_cursor,{expected_identity})`。Fetch 与方法期限取先到者，自定义传输必须支持 bounded-json/signal；严格参数和响应将拒绝部分旧 Mock/fixture。见 [同步变化分页](../../docs/design/01-contracts/sync-changes-runtime.md)，仅源码，未运行验证。

`getSyncCursor({expected_identity?,timeout_ms?,signal?})` 读取当前消费者身份、到期和确认位点；recorded=false/cursor=0 区分于已确认过 0。`acknowledgeSync(cursor,{expected_identity,timeout_ms?,signal?})` 现必须提供保存的完整原身份，拒绝键/版本，并核对完整身份/游标回显。两方法默认 30 秒，成功限 32 KiB、错误限 16 KiB；确认派发后异常统一 unknown、retryable=false。原目标不变，显式查询同一身份当前位点；当前值大于等于目标不等于某次请求的历史回执，也不证明本地保存。不会自动重试、换身份或结算；旧单参数 ack 调用需迁移。见 [原消费者确认与当前游标](../../docs/design/01-contracts/sync-cursor-runtime.md)，未执行示例或运行验证。

`getSyncEventReceipt({identity,event}, {timeout_ms?,signal?})` 显式查询原事件历史投递，默认本地 30 秒，成功正文限 2 MiB、错误 16 KiB；完整核对身份、原事件、trace、来源及状态。recorded 带历史接受/冲突结果和 source_application=not-checked，not-observed 不证明上传失败或允许换身份重发。查询不带批次键、不上传、不修改队列；保留原事件与身份，当前上下文已有 actor/client 时须一致。使用既有规范化指纹，不证明原 JSON 字节或额外字段曾存储。固定错误说明、retryable=false，Fetch 与方法预算取先到者，自定义传输须尊重 bounded-json/signal。见 [原事件回执](../../docs/design/01-contracts/sync-event-receipt-runtime.md)，仅源码，示例未执行。

`getSyncCommandContext({timeout_ms?,signal?})` 读取可信原发送身份/到期/上传权限提示，默认本地 30 秒、成功/错误各 16 KiB；返回前核对原范围、trace、已有身份约束及到期。不会生成事件、键或补写旧队列身份。普通字符串账号可用只含范围与 trace 的 WcpClient，保存返回 identity 供原请求使用；见 [原同步身份](../../docs/design/01-contracts/sync-identity-runtime.md)。

`uploadEvents(events, { idempotency_key, expected_identity?, timeout_ms?, signal? })` 在等待前复制完整原批次，限制 1–100 条有效且不同的事件及 1 MiB 请求正文。提供 expected_identity 时核对完整原范围及上下文已有账号/客户端约束，发送预期身份头，由 Gateway 比对可信令牌；省略保留旧直接上传行为。完整响应必须逐条覆盖原事件，核对拒绝形状、持久事件/冲突唯一性、原 client_cursor、server_cursor、范围、来源与当前 trace；批次重放的拒绝条目允许保留旧 trace。异常响应整批拒绝，不返回部分成功。

上传现使用 bounded-json：Fetch 成功正文最多 256 KiB、错误最多 16 KiB，默认本地等待 30 秒，支持取消和 1–2147483647 的 timeout_ms。导出类型为 WcpSyncUploadOptions；仍必须传原幂等键，不接受额外选项。方法与 FetchWcpTransport 的期限分别生效，先到者终止等待；需要超过 30 秒时应同时配置两者。自定义传输须支持 bounded-json/max_response_bytes/signal，SDK 无法约束忽略这些字段的内部缓冲或底层执行。

SDK 上传错误保留固定代码/文案及本次 dispatch_state，原始错误正文/details 不透传；retryable=false 不代表远端确定失败，未返回完整回执时继续保留原事件、原身份和键。方法不自动重试、分批、保存或更换身份；持久保存由调用方或 Bridge outbox 负责，旧未知身份不能从当前令牌推断。SDK 共用 RequestBudget 改用单调时钟，有界正文清理失败不再覆盖原错误。见 [同步上传与完整批次回执](../../docs/design/01-contracts/sync-upload-runtime.md)。仅源码和文档，未执行示例、编译或测试。

为兼容已有调用，`createProject` 仍保留原有实体响应及 mock 行为；当前实际 Gateway 尚未注册 `/v1/projects` 创建路由。`MockWcpServer` 仍只覆盖该旧接口，不能替代新增连续性接口的真实网关。

`confirmProposal(id, reason, { expected_revision, idempotency_key })` 和 rejectProposal 要求签名 human 身份与 proposal.review；创建使用 proposal.write。列表在 data.next_before 返回下一页游标，详情在 data.sources_current 标记本地来源链是否仍符合提交时的状态，含本地引用但缺少依赖摘要的旧建议返回 false。写回执只表示历史命令，不自动创建已确认上下文。见 [Proposal 运行时说明](../../docs/design/01-contracts/proposal-runtime.md)。

来源条目新建至少提供 title/content/source_refs，默认 proposed；编辑和归档的选项要求 `expected_version` 和 `idempotency_key`。写入返回 `ContextItemMutationReceipt`，只确认历史命令，不包含当前正文。重试返回 `replayed=true`；后续编辑前用 `getContextItem(id)` 读取最新版本。列表筛选支持 query/layer/classification/status/item_type。范围、字段和 017 迁移依赖见 [ContextItem 开发说明](../../docs/design/01-contracts/context-item-runtime.md)。

`listContextItems` 默认返回 25 条，支持 1–100 的 limit。将响应外层字符串 `next_cursor` 作为下一次请求的 cursor，并保留原筛选；没有 next_cursor 时结束。分页按优先级、更新时间倒序和 ID 升序继续，项目/权限/筛选变化后应移除 cursor。单次调用不再返回全量条目；分页是实时视图，并发编辑可能改变条目位置。共享输入类型和解析器为 `ContextItemListQuery`、`parseContextItemListQuery`（`@planemem/contracts`）。

ContextPack 默认预算 4096、寿命 3600 秒；范围分别为 128–32768 和 60–86400。`getContextPack()` 读取最新可见完整快照；传 `pack_id` 读取指定历史包。`format` 为 `json`、`markdown` 或 `mcp`，后两者在 JSON 响应的 `data.rendered` 中增加 Markdown。返回类型为 `ContextPackReceipt`，包含完整 pack、版本和估计内容 token 数。来源变更或包到期后读取/原键重试会失败，需要新键重新编译。存储和哈希兼容说明见 [ContextPack 运行时](../../docs/design/01-contracts/context-pack-runtime.md)。

`getArchivedContextItem(id)` 返回完整归档条目和 archived_at。`restoreContextItem(id, { expected_version, idempotency_key })` 使用归档后的版本，返回 operation=restore 的历史回执；恢复后仍 excluded，分类/到期时间保留，需要显式编辑后才能重新成为包候选。普通 getContextItem 仍不读取归档条目。listContextItems 的 archived 默认 false，true 只查询归档；切换视图必须重置 cursor。恢复依赖新增但未执行的 020 迁移。

版本历史列表 data 为 ContextItemHistoryPage，默认 25 条、limit 1–100，通过 data.next_before_version 继续；指定版本 data 为 ContextItemRevision，内含 item 快照、操作、作者/客户端、事件、记录时间和哈希。baseline 原作者为空，只表示首次成功修改前捕获的旧状态。未记录或无权查看的版本返回 404。历史读取没有当前编辑用的 ETag，继续修改前请读取当前条目。历史保存依赖新增但未执行的 021 迁移，所有条目写入在同一事务中记录快照。

`confirmContextItem` 只确认未过期 proposed 内容，理由必填且最多 2000 字符；本地来源链需固定当前已确认版本并满足分类和可见性。成功返回 operation=confirm 的历史回执，版本加一。`getContextItem` 返回 `ContextItemReadDocument`，包含 confirm_allowed、confirmation，以及 sources_current/source_check；可选 source_checks 按 source_index 对应直接本地来源，提供 state/issue 和允许披露的 current_revision，缺失或 not-checked 不代表有效。具备审核权限的 human 读取 proposed 条目时，可选 confirmation_readiness 提供更严格的来源确认预览及有效链到期时间；confirm_allowed 据此给出，普通 sources_current=true 不等于可确认。历史单版本也返回该版本的确认元数据，但不补造当前来源诊断。当前来源链检查不改写历史批准，也不验证外部证据。提示不替代授权，旧 confirmed 内容可能没有审核记录。编辑撤去当前确认，后台级联通知尚未实现。确认依赖未执行的 022 迁移；来源链逻辑复用现有 JSONB，不新增迁移，未做运行验证。

`createArtifact(original, bytes)` 和 `putArtifactVersion(original, bytes)` 新增文件创建/追加上传，其中 original 是保存的 `{ identity, command }`，bytes 为 Uint8Array。SDK 核对上下文身份、操作及长度，在异步传输前复制原命令和字节；原 request_key 用作 Idempotency-Key，追加的原 expected_version 用作 If-Match，不继承上下文的其他写条件。SHA-256 由持久服务核验；调用前自行保留原请求与文件，不自动生成键、保存 outbox 或重试。

FetchWcpTransport 支持原生 FormData：request 为 application/json 文件部件，content 为二进制文件部件；等待 token 前固定请求头及正文，由 fetch 设置 boundary。自定义 transport 必须支持 FormData。默认 Gateway 文件上限为 64 MiB，request JSON 上限为 1 MiB；部署可设置更低上限，超限会拒绝。Fetch 默认超时仍为 30 秒，较慢上传可显式配置 timeout_ms。

成功响应完整核对原身份、命令、内容描述、保存版本、来源和 trace；首次保存 replayed=false/content_state=verified-at-save，回执重放 replayed=true/content_state=not-checked。结果是历史快照，不含存储地址或外层 ETag，也不保证当前可下载。超时或响应损坏不能证明写入失败，保留原请求，显式调用 getArtifactReceipt(original)；不以当前版本或新键替换它。当前为源码接入，未编译、类型检查、测试或运行，详见 Artifact 持久化契约的公开上传章节。

`downloadArtifactVersion(id, version, { max_bytes? })` 下载指定历史版本。调用上下文必须固定 project_id/actor_id/client_id；先读取该版本元数据，再按原 SHA-256/size 发送内容 GET，不自动选择当前版本。需要真实 artifact.read 和当前/历史分类导出权限：public 可导出，internal/confidential 需要 data.export 或 data.restricted.export，restricted 还需 data.restricted.read 与 data.restricted.export。服务器必须配置持久内容读取和审计保存。

默认最多 64 MiB，可显式指定 0–1 GiB，仍受服务器上限约束。FetchWcpTransport 的 response_type=bytes 要求 max_response_bytes，只用于无正文 GET；按实际字节有界读取，错误正文上限 1 MiB，不跟随重定向。自定义 transport 返回 { status, headers, content: Uint8Array }，headers 使用小写名称。SDK 拒绝部分响应、范围/目标/trace/审计头不符以及长度/hash 错误，复制并验证 SHA-256 后才返回内容，不自动重试或提供未校验的部分数据。

返回对象的 data 包含公开 artifact、audit_id、audit_state=release-recorded 和 content_state=verified；顶层 content 为独立 Uint8Array，source_refs 固定到该 Artifact/版本。release-recorded 指服务端已持久记录获准释放，不能证明客户端已写入磁盘，也不确认原上传请求。SDK 不打开文件、不生成下载 URL、不写磁盘；Fetch 超时仍默认为 30 秒，可显式配置 timeout_ms。此入口仅源码，未编译、类型检查、测试、下载样本或运行，完整边界见 Artifact 持久化说明。

2026-11-03：`listConflicts` 已改为默认 25、最多 100 条的元数据页，返回 `ConflictRegistryEnvelope`，不再返回旧 `WcpConflict` 全文。query 支持 query/status/entity_type/conflict_id/limit/cursor；显式续页须保留筛选和 limit。版本全部为十进制字符串；值与逐条来源使用 getConflict 获取。选项 timeout_ms/signal 控制默认 30 秒本地等待，成功 2 MiB、错误 16 KiB，完整范围/trace/记录/游标检查，不自动翻页或重试。此变更须协调旧消费者；MockWcpServer 仍只覆盖项目创建，兼容性尚无运行证据，见 [冲突目录分页](../../docs/design/01-contracts/conflict-registry-runtime.md)。

2026-11-03：新增 `getConflictReceipt(original, options?)`，original 是保存的 `{identity, request_key, command}`，command 包含原有效 conflict_id/expected_version/resolution/适用 merged_value 与全部额外原字段。SDK 必须匹配原三层范围以及上下文已提供的 actor/client 约束；普通字符串账号可使用仅含范围和 trace 的 SDK 上下文，原完整 actor/client 仍用于预期身份头。Gateway 对可信 token 核对全部五字段，要求未过期 resolver。查询不继承写条件，默认本地 30 秒、成功 2 MiB/错误 16 KiB，有完整原请求和结果校验，不重试。recorded 只确认原决定及事件，not-observed/legacy 仍保持未知，不证明源实体应用。调用方必须在写入前自行保存原请求；旧 resolveConflict 接口未自动创建恢复记录。见 [冲突原请求回执](../../docs/design/01-contracts/conflict-receipt-runtime.md)，仅源码，未运行验证。

## 离线原事件回执文件（源码接口，未执行）

`prepareSyncEventReceiptFile(receipt, { trace_id, timeout_ms?, signal? })` 从完整历史回执准备既有 `workctx.sync-event-receipt` v1 文件，返回 `state: 'prepared-not-saved'`、`file`、完整 `bytes`、独立原 `query`、`file_bytes` 和 `file_sha256`。文件中的 `document_sha256` 对规范文档计算，`file_sha256` 对返回的实际 UTF-8 字节计算。函数不打开路径或写文件；调用方负责显式保存、确认最终路径和读回。传入回执在首次异步等待前完整解析为独立副本。

`inspectSyncEventReceiptFile(input, { trace_id, timeout_ms?, signal?, expected_query?, expected_document_sha256? })` 接受完整 JSON 文本或 `Uint8Array`（包括普通 Node Buffer），在首次异步等待前复制有界字节并完整解析，独立重算文档摘要。可选约束分别核对完整原身份/event 和选中的文档摘要；不匹配明确失败。返回 `state: 'inspected-historical'`、完整 `file`、独立 `query`、实际输入的字节数/摘要，以及 `input_representation: 'json-text' | 'utf8-bytes'`。保留文件原查询 trace，本地 `trace_id` 仅用于本次准备/检查。字符串仅作为 JSON 内容处理，不作为路径或 URL。

两函数从包根或独立 `@planemem/sdk/sync-event-receipt-file` 子路径导出。独立路径只依赖契约和本地预算助手，无 WcpClient、网络传输、Node 文件系统或数据库依赖。对应选项/结果类型和 SyncEventReceiptFile/Document/Envelope/Query 类型均可从该子路径导入。示例只展示接口，未执行：

```ts
import {
  prepareSyncEventReceiptFile,
  inspectSyncEventReceiptFile,
} from '@planemem/sdk/sync-event-receipt-file';

const prepared = await prepareSyncEventReceiptFile(completeReceipt, {
  trace_id: 'trace_local_prepare_receipt',
});
// prepared.bytes 尚未保存；用调用方明确选择的存储策略保存并读回。
const historical = await inspectSyncEventReceiptFile(savedBytes, {
  trace_id: 'trace_local_inspect_receipt',
  expected_query: originalQuery,
  expected_document_sha256: selectedDocumentDigest,
});
// 仅在用户另行决定查询时，将 historical.query 交给 getSyncEventReceipt。
```

默认单调本地预算 30 秒，允许 1–90000 毫秒；覆盖解析后的检查、摘要等待及最终输出检查，支持 AbortSignal。WebCrypto SHA-256 必须可用，无法取消的摘要完成后不会返回迟到结果。输入上限为既有 `SYNC_EVENT_RECEIPT_FILE_BYTES`，字节严格 UTF-8 解码并兼容 BOM；实际文件摘要保留 BOM/空白差异，文档摘要使用共享规范序列化。拒绝过大/空输入、未配对代理字符的文本、共享内存字节、非法选项和损坏文件，不截断、不自动修复。预算不承诺抢占同步解析，调用方应先有界读取外部文件，内存输入不能替代文件读取边界。

错误为 `INVALID_INPUT`、`SYNC_RECEIPT_FILE_INVALID`、`SYNC_RECEIPT_FILE_DIGEST_MISMATCH`、`SYNC_RECEIPT_FILE_BINDING_MISMATCH`、`SYNC_RECEIPT_FILE_INTEGRITY_UNAVAILABLE`、`SYNC_RECEIPT_FILE_CANCELED` 或 `SYNC_RECEIPT_FILE_TIMEOUT`，均保留有效本地 trace，有限固定说明和 retryable=false；不透传正文、凭据或底层异常。无法取得有效 trace 时错误使用固定本地 fallback，不把它写入历史回执。

结果统一标记本地历史未认证、服务器未查询、队列未读取、应用未核验、未访问文件系统。摘要一致不表示服务器真实性或当前状态，不能据此离线结算、重发或确认游标。本功能只补齐离线字节接口，尚不提供持久化适配器、批量备份或恢复事务；未编译、类型检查、测试、调用 SDK、生成实际文件或发布。
