# Plane Webhook 持久接收与重试（开发状态）

2026-11-05，TODO P0-01：新增 [六路 OpenAPI](../../../packages/contracts/openapi/plane-inbox.json)、[读取 Schema](../../../packages/contracts/schemas/plane-inbox.json) 与 [原重试 Schema](../../../packages/contracts/schemas/plane-inbox-retry.json)，对应四类元数据读取及重试/原回执两个 POST；Webhook 不在本轮机器契约范围。见 [完整加载与运行边界](../../../packages/contracts/openapi/README.md#plane-收件箱与原重试回执)。仅新增契约源码，不改变下述运行实现，不构成运行证据。

补充边界：列表按事件 ID 降序，游标绑定 limit；概览不继承列表筛选。诊断只公开实际最高提交版本中选中的可见 applied 回执，最多两个基线不能当作完整分叉数量；读取不解析原事件全文。重试与查询均先检查完整不可变事件/指纹和当前可见性并持有更新/咨询/父项目共享锁，查询不是数据库 READ ONLY 事务。原回执重放在新版本/状态检查之前，保留历史 pending 状态；新调度仅 revision 加一、不增加 attempts，不直接驱动应用。3 秒锁/15 秒语句超时不是整次期限；无完整响应字节/并发槽或提交后身份到期复查保证。P0-01/R-001 未完成、evidence 为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-02：仅修改源码、文档和新增 `037_plane_event_inbox.sql`、`038_plane_inbox_directory.sql`、`039_plane_inbox_retry.sql`、`040_plane_observation_deletion.sql` 文件。未编译、类型检查、测试、启动服务、执行迁移或发布；016–040 迁移均未执行。以下是当前源码行为，尚无运行证据。

## 接收和响应

`POST /v1/plane/webhook` 保留签名、时间窗口、正文大小、Canonical Event 和头部事件 ID 校验。只接受已有 Project/WorkItem 观察事件；新增外部 ID、来源 revision/URI 校验。快照构建不更新内存，源事件时间精度保持不变。

验签通过后，先在同一事务保存 `wcp_plane_event_inbox` 和 `wcp_plane_webhook_deliveries`。前者保存完整事件文档、字段排序后的 SHA-256 指纹、范围、aggregate/版本及处理状态；后者按 tenant/workspace/project/delivery_id 绑定事件 ID，并保留首次验签正文 hash。JSON 空白、对象键顺序不同不会改变规范事件指纹；正文 hash 仅用于记录首次交付，不作为后续事件语义相同的条件。

事件 ID 全局绑定第一次保存的规范事件，包括 scope、来源、分类、trace 和可选元数据。再次投递时核对指纹、存储正文和范围；同一 ID 换内容返回 `PLANE_EVENT_ID_CONFLICT`，同范围 delivery ID 换事件返回 `WEBHOOK_DELIVERY_CONFLICT`，HTTP 409。后续投递不会覆盖原文档、重置重试次数或强行重新激活拒绝记录。

| HTTP | status | 含义 |
| --- | --- | --- |
| 200 | accepted | 本次处理已提交事件、观察快照、索引、处理回执与处理审计；effect_applied=true |
| 200 | duplicate | 此事件已有成功处理记录或与旧事件表保存字段相同；effect_applied=false，不重写快照 |
| 202 | queued | 接收事务已提交，尚未确认处理完成；effect_applied=false |
| 409 | rejected | 已保存但因版本、别名、索引或数据完整性冲突被拒绝；包含错误码 |
| 400/401 | 错误 envelope | 输入或签名校验失败，尚未接收 |
| 503 | 错误 envelope | 未配置持久存储，或接收/交付审计无法完成；调用者应重试相同事件和 delivery ID |

业务状态响应含 `durable=true`。202 只证明事件已保存，不能当作 Plane 观察投影已生效。接收提交后处理失败，允许返回 queued；如果随后交付审计失败则仍返回 503，但已保存的事件会继续处理。网络错误/503 不证明事件未接收。重试需保留原 Canonical Event 与 delivery ID，按现有五分钟验签窗口重新签名。

未配置 DATABASE_URL 时 Webhook 返回 503，不再使用进程内投影确认成功。离线 PlaneProjection 领域组件仍保留，HTTP 持久接收不会调用其消费账本。

## 事务处理

新增 WorkItemDeleted 自有 Canonical 事件：必须带 project_id，payload 只有必填 external_id。处理仍经过版本/别名/索引锁及原事件完整性检查；删除快照、同版本软删除索引、回执与审计同事务，索引摘要不保留旧内容，分类不降低。工作项删除进入最新版本与诊断查询；后续普通更新被拒绝为 PLANE_RECORD_DELETED，重复旧事件仍只返回原回执。启动新增 040 deleted_at 列检查，见 [删除观察](observed-state-runtime.md#工作项删除观察)。没有原生 Plane Webhook 转换、项目删除或恢复命令。

新增 WorkItemRestored 自有 Canonical 事件，必须通过 causation_id 和 payload.restored_from 绑定原删除事件及版本。恢复是下一版本的完整新观察；没有基线或存在缺口时等待，不允许首个恢复事件引导新流。到达下一版本后仍必须精确匹配最新删除事件和 external_id，并在锁内核对删除快照及未过期删除索引；不满足则 PLANE_RESTORE_PRECONDITION_FAILED。成功事务保留索引分类与到期、清除删除标记并保存新内容。普通更新依然不能复活记录。沿用 040，无新增迁移，见 [恢复观察](observed-state-runtime.md#工作项恢复观察)。

处理器用 `FOR UPDATE SKIP LOCKED` 取得一条到期 pending 记录，持有行锁至事务结束。随后依次取得项目范围内的 aggregate 锁、稳定排序的 external/aggregate 两种读取别名锁，以及对应 context-index 锁。不同网关实例共用这些数据库锁，不依赖请求是否路由到同一进程。

已保存的事件 ID 只做重复判定。旧 wcp_events 没有 sensitivity/actor/client 等完整元数据，只能核对其实际保存的类型、schema、范围、aggregate/版本、trace、来源、payload 和时间；不会补认旧事件的缺失元数据，也不会以重试内容修改其分类。duplicate 是历史接收/处理判定，不保证旧快照或索引现在仍完整、可见或未过期，也不会重建缺失投影。新接收表从首次接收起保存完整规范事件指纹。

新事件从当前范围的已提交观察事件取得版本：

- 已有水位时必须是下一版本；更低或同版本的另一个事件拒绝，缺口保持 pending。
- 没有已提交水位时，恢复事件一律等待；其他事件沿用旧消费器“首个观察可作为起点”的规则，但存在已接收的更低版本时先等待。该规则不能保证尚未送达的历史事件完整性。
- 当前最高版本若有多个旧事件则拒绝，不任意选择一个继续覆盖。
- 现有 aggregate 改 external ID、external/aggregate 别名被其他 aggregate 占用或已有来源不一致时拒绝，未实现自动重映射。

纯快照构建后，在同一事务追加 wcp_events、更新 wcp_projection_states、更新 wcp_context_hits、标记 inbox applied，并写入 `plane.observation.process` 审计。任一操作失败整体回滚。投影必须递增；索引必须可更新且版本递增，分类只保留原等级或升级。普通更新不复活删除/已过期索引；显式恢复仅允许匹配且未过期的删除索引。先前代码中“事件提交但索引 upsert 没更新”的情况现作为冲突回滚。

拒绝记录保留原事件、错误码和处理审计。发生 SQL/连接错误时，原处理事务回滚后另行记录 retry；若连重试记录也无法保存，原 pending 行仍可在连接恢复后重新取得。没有持续处理租约需要人工解除，进程退出由数据库释放事务锁。

## 后台生命周期

启动先检查接收表，再开放端口并启动处理循环。每轮最多处理 25 条，到期轮询间隔 1 秒；轮询故障后 5 秒再试。单条版本缺口或临时错误采用 1、2、4 秒递增并限制到 300 秒的重试间隔，不自动丢弃等待前置版本的记录。请求重投不会绕过已有退避。

关停先停止接收新 HTTP 请求，等待在途请求，然后取消队列定时器、等待当前处理结束再关闭数据库。接收、处理和重试记录事务设置 3 秒锁等待及 15 秒单语句超时。

网关不再全量回放 wcp_events 到内存；观察状态和旧搜索按既有持久读取路径读取已提交记录。健康信息增加 plane_ingestion 的持久模式、worker_running 和轮询故障状态；最近轮询失败影响 readiness。该状态不表示所有排队事件都已成功，也不表示上游 Plane 已同步完整。

## 仍待开发

目前可通过相同签名投递读取已保存状态，管理员还可使用下面的目录、回执、人工重试 HTTP、SDK/CLI/MCP 和工作台表单。拒绝记录不会自动重放，缺失前置版本不会自动向 Plane 补拉。WorkItemDeleted/WorkItemRestored Canonical 观察已开发；原生删除/恢复事件转换、项目删除/恢复、外部 ID 重映射、完整历史重建、保留与清理策略仍待开发。积压/版本缺口/拒绝记录的运行指标与 Prometheus 告警规则已补入源码，默认关闭；告警投递与实际触发/恢复证据仍缺。

## 运维指标与告警开发接入

`PLANE_INBOX_METRICS_ENABLED=false` 默认不开启采集；为 true 时要求 DATABASE_URL，创建额外的单连接池并随服务启停管理采集器。指标输出到现有 `/metrics`，抓取不查询数据库；采集用只读事务、5 秒语句超时，完成后每隔 30 秒重采。数量/最早接收时间仅在最近采集成功且快照未超过 90 秒时导出，失败不填零。worker 另外提供本实例运行、最近轮询失败和最近完成轮询时间，独立于队列快照新鲜度。所有指标均不改变事件状态。

这些运维指标覆盖整个数据库，使用固定状态标签，不按业务项目或权限过滤，故必须显式启用并限制无认证指标端点的运维网络访问；它们与后文的可见项目概览不同。计数是 gauge，副本不能求和，数值规则要求有效快照；采集故障与 scrape 故障独立告警。细节、默认阈值和待部署边界见 [告警运行手册](../../runbooks/alerts.md) 与 ADR-009。本次没有新增迁移，开关未开启、规则未加载、未执行任何验证或发布。

交付审计仍在接收/处理事务之后单独写入；处理审计与处理结果同事务。后台处理审计直接保存在 PostgreSQL，不计入进程内 auditRecords/records 指标。外部副本清理和同步游标发布不属于本批接入范围。

## 管理员只读目录和回执

新增 GET `/v1/plane/events`（plane.inbox.list）和 GET `/v1/plane/events/{event_id}`（plane.inbox.read）。HTTP 强制 Bearer token；命令层同时要求可信 authenticated_client、admin 角色，并经过 admin.read 策略、审计和限流。读取绕过旧幂等响应缓存，返回 private/no-store。

列表允许 status=all/pending/applied/rejected、pending_state=all/due/delayed/version_gap、可选 aggregate_id（ULID）、limit（默认 25，最大 100）和 cursor；拒绝未知或重复参数，详情不接受查询参数。按 event_id 的 C 排序降序分页，不能将其解释为接收时间顺序。游标绑定三层范围、restricted 读取能力、所有筛选及每页大小；修改这些条件需回到第一页。每次读取使用当前数据，处理状态或可见性变化可造成分页间的成员变化，目录不是快照导出。

pending_state 默认 all，表示不增加待处理筛选；其余三个值均只返回 pending 行，且只允许与 status=all/pending 组合，不能与 applied/rejected 组合。due 使用 next_attempt_at <= 本次 statement_timestamp()，delayed 使用 >；version_gap 要求最后错误为 AGGREGATE_VERSION_GAP，描述上次处理记录，不证明前置版本现在仍缺失。所有筛选在分页 LIMIT 之前执行，仍可叠加 aggregate_id。共享页解析器核对每条记录符合 pending 状态、最后错误或时间条件；数据库的微秒时间规范化为毫秒后允许相等边界。SDK、CLI、MCP 和工作台使用相同语义。

到期/延后筛选每次查询重新读取数据库时间，分页期间时钟推进和事件处理可能改变成员；原游标前的新匹配记录需刷新第一页才能看到。概览数字跳转到当前项目相应的待处理列表，不保证点击后的列表数量仍与概览一致。列表显示每条待处理记录的计划时间与检查时间，刷新和下一页保留 pending_state。游标筛选指纹版本随新增筛选升级，旧开发版本游标需从第一页重新获取；本次没有新增迁移。

查询只提取元数据，不向应用层返回事件原文、payload、原始 trace、source refs、验签材料或正文 hash。必须存在当前未删除的父项目；有效 classification 取事件分类、现有同 ID Plane 索引分类与父项目分类中的最高等级。未知事件分类按 restricted 处理；无 data.restricted.read 的管理员看不到有效 restricted 行。处理失败或旧索引已删除/过期的元数据仍可用于排查，但不因此恢复该索引或允许读取其正文。

返回字段包括 event_id、支持的 event_type（损坏/不匹配时为 null）、aggregate 类型/ID、事件版本、队列 revision、状态、处理尝试次数、有效 classification、received_at/updated_at/next_attempt_at/applied_at/checked_at 和 last_error_code。aggregate_version、revision 与 attempts 使用十进制字符串；队列 revision 独立于事件版本，处理成功、拒绝、延期和人工重试均递增，工作台详情也显示该值。终态 next_attempt_at 返回 null。共享 PlaneInboxRecord/PlaneInboxPage 解析器核对范围、ID、状态/时间关系、整数范围、筛选和排序。详情不可见或缺失统一 404；存储不可用 503，元数据不一致 500。缺失回执不能证明 Webhook 从未收到。

工作台新增 `/admin/plane-events` 与 `/admin/plane-events/detail?event=…`，Admin 页提供入口。列表显示当前页记录，支持状态/aggregate 筛选、分页及从第一页刷新；详情可按事件 ID 查询，展示等待/拒绝原因、尝试次数与计划时间，并链接到该 aggregate 的事件和保存观察。表单在读取错误后保留，不自动轮询、重投或重放事件。Web 服务端按同一次请求的 scope/trace 校验响应；原 Admin 刷新按钮接为 GET 表单。

SDK 已增加 listPlaneInboxEvents/getPlaneInboxEvent；CLI 为 plane-events list/get，后者 JSON 必填 event_id；MCP 为 list_plane_events/get_plane_event_receipt。SDK/CLI 复用共享解析器核对本次 scope/trace、空来源、目标事件与分页元数据，保留版本和尝试次数的十进制字符串；CLI HTTP/内嵌 router 使用同一输入/结果处理，这两个读取命令拒绝 --key。MCP 目录额外要求可信管理员，调用仍走同一授权/审计入口；人工重试另见下文，没有更宽松的后台路径。读取 pending/rejected 可以成功，不意味着事件已经应用。三类客户端仅加入源码和说明，没有执行命令或运行验证。

038 仅添加范围/状态/aggregate 的目录排序索引，没有执行迁移或任何运行验证。

## 当前可见队列概览

GET `/v1/plane/events/summary` 对应 `plane.inbox.summary`，只接受空输入，不接受查询参数。沿用可信客户端、admin 角色、admin.read 策略、审计、限流和 private/no-store；项目范围来自认证上下文。精确路由优先于单事件路径。读取先按当前项目与有效分类过滤，再用一个 SQL 语句的快照和 statement_timestamp() 汇总，返回 scope、checked_at、counts 和队列时间信息，不返回事件正文。

counts 的 total/pending/applied/rejected/due/delayed/version_gap 均为非负 BIGINT 十进制字符串，客户端不得转成 Number 后再保存。total 等于 pending、applied、rejected 之和；pending 等于 due 与 delayed 之和。due 表示计划时间已到，delayed 表示计划时间尚未到；version_gap 只统计 pending 且最后错误为 AGGREGATE_VERSION_GAP 的记录，是 pending 的子集，不能再次累加。到期行可能正被处理但事务尚未提交，因此 due 不等于处理器停滞，也不保证下一次尝试能成功。

返回 oldest_pending_received_at、oldest_due_received_at、earliest_pending_attempt_at 和 latest_received_at；对应集合为空时为 null。共享 PlaneInboxSummary 解析器核对当前范围、字符串计数及求和关系、时间空值与先后关系；数据库时间规范化为 UTC 毫秒，计划时间比较允许规范化后的同毫秒边界。父项目不存在、已删除或不可见返回 404，存储不可用返回 503，汇总元数据不一致返回 500，不用零值掩盖错误。

SDK 使用 `getPlaneInboxSummary()`，CLI 使用 `plane-events summary`（无需 JSON；若提供只能为 `{}`，拒绝 `--key`），MCP 使用 `get_plane_event_queue_summary`（空 arguments、只读）。SDK、CLI 与 Web 复用共享解析器并核对范围、trace 和空 source_refs。汇总覆盖当前项目所有可见记录，不受目录的 status、aggregate_id、limit 或 cursor 筛选影响。零记录或零积压只描述当前可见接收队列，不证明上游已同步完整、处理器健康或观察快照当前可读。

工作台在队列列表上方展示概览，状态数字链接到该项目的对应状态列表。概览和列表分别读取，可能反映不同时间；任一读取失败单独展示错误，不把失败替换为零。页面显示概览检查时间，不自动轮询或触发处理。本次没有新增迁移；016–039 仍未执行，以上仅为源码行为，没有编译、类型检查、测试或运行证据。

## 版本缺口与候选回执诊断

GET `/v1/plane/events/{event_id}/diagnosis` 对应 `plane.inbox.diagnosis`，输入只有 event_id，不接受查询参数。沿用可信客户端/admin/admin.read、当前项目与有效分类过滤、审计、限流及 private/no-store。整个诊断使用同一 SQL 快照和 checked_at，不取得处理锁，不补拉、不重试、不改变事件。目标缺失或不可见统一 404；存储不可用 503，响应元数据不一致 500。

查询先定位同 scope、aggregate_type 和 aggregate_id 的真实已提交流最高版本；与 worker 一样仅考虑支持的观察事件类型，按版本倒序取最多两条来识别最高版本重复。然后要求最高版本诊断样本全部具有当前可见、版本/类型匹配且 applied 的接收回执，才能返回 baseline。没有历史记录、旧记录无 inbox 回执、样本不可读或匹配条件不满足均返回空 baseline，不区分原因，不以较低可见版本代替最新实际版本。隐藏的 ID、版本和计数不返回；最高版本诊断样本中有不可见行时，也不返回其可见同伴来暗示唯一基线。

`PlaneInboxDiagnosis` 包含 schema_version、record（目标元数据）、baseline（最多两条）、position、next_version、uncommitted_versions、next_version_candidates 和 same_version_candidates。计数/版本不转成浮点；相关记录必须属于同一范围、aggregate 类型/ID 和 checked_at。共享解析器重新推导比较结果并校验候选版本、ID 去重、排序和截断标记。

| position | 含义 |
| --- | --- |
| baseline_unavailable | 无可用可读基线；不能证明没有已提交历史，也不评估首次初始化是否允许 |
| ambiguous_stream | 最高版本有两条可读已提交回执；不能计算下一版本 |
| already_recorded | 目标本身是唯一可读的最新已提交记录；仍不证明当前投影可用 |
| at_or_behind | 目标版本不大于另一个已提交事件；重试不能覆盖顺序约束 |
| deleted_stream | 唯一已提交基线为 WorkItemDeleted，目标是较高版本的普通事件；不能用普通更新恢复，不提供 next_version。WorkItemRestored 进入普通版本比较，但 next_version 不证明删除引用、快照及索引有效 |
| next_version | 目标正好等于唯一基线版本加一；不保证其他处理检查通过 |
| gap | 目标大于基线加一；next_version 为基线加一，uncommitted_versions 为从该版本到目标减一的闭区间 |

只有 next_version/gap 有 next_version；只有 gap 有 uncommitted_versions。该区间表示已提交流尚未推进到的版本，不等于从未接收的事件清单。next_version_candidates 返回当前可见的下一版本接收回执，same_version_candidates 返回除目标外当前可见的同版本回执；均限定同一 aggregate 类型/ID，各按 event ID 升序最多 10 条，查询 11 条产生 has_more，不返回隐藏数量。空候选不证明未接收，候选不代表能处理成功；has_more 时可继续使用 aggregate 目录排查，目录有独立读取时间。

SDK 为 `getPlaneInboxDiagnosis(eventId)`，CLI 为 `plane-events diagnose`（JSON 只有 event_id，拒绝 --key），MCP 为 `get_plane_event_diagnosis`（只读，输入 event_id）。SDK/CLI/Web 共用解析器核对范围、目标、trace、空 source_refs 和比较关系，CLI HTTP/内嵌语义一致；MCP 复用后端校验，不把 baseline_unavailable 当作工具失败。工作台 `/admin/plane-events/diagnosis?event=…` 显示各部分与检查时间，详情重试表单提供新标签页入口，诊断不会解除未知请求或生成新的重试键。该能力没有新增迁移，未编译、类型检查、测试、启动服务或发布。

## 管理员人工重试和原请求回执

POST `/v1/plane/events/{event_id}/retry` 对应 `plane.inbox.retry`，必须有可信 admin、authenticated_client 和签名中的 `actor_type=human`。采用独立 `plane.retry` 策略动作；本地策略仍保留 admin 的能力覆盖，外部 OPA 可对该动作单独收紧。不能从请求体或身份头声明人工身份。POST `/v1/plane/events/{event_id}/retry/receipt` 对应只读的 `plane.inbox.retry.receipt`，使用 admin.read，并绑定原 actor/client。两个接口都重新检查当前项目和有效分类，不经过内存幂等缓存。

两个接口的正文形状相同：

```json
{
  "expected_revision": "7",
  "reason": "已排查前置事件到达情况，重新安排处理",
  "request_key": "plane-retry-operator-001"
}
```

event_id 来自路径。expected_revision 必须是读取到的原队列修订号十进制字符串，不接受数值、expected_version、If-Match 或 If-Match-Version。reason 为去首尾空白后的 1–2000 字符文本。request_key 也可由 Idempotency-Key 提供；同时提供必须相同，查询回执时必须保留原键、理由与修订号。拒绝其他字段及 URL 查询参数。

执行事务依次取得范围/actor/client/键锁、事件行锁、对应 context-index 锁与父项目共享锁；核对原事件规范指纹及当前可见性。仅 pending/rejected 且 revision 相等的记录可改为 pending，并清除错误及 applied_at，将 next_attempt_at/updated_at 设为同一个数据库时间，revision 加一。原事件、事件指纹、received_at 和 attempts 不修改。已 applied 的事件返回 409；修订号过期返回 PLANE_INBOX_REVISION_CONFLICT（409）。该入口不会修改原事件、越过版本缺口、修复损坏数据、重建投影或自动变更外部 ID。

队列变化、不可变成功回执和 `plane.inbox.retry.scheduled` 审计在同一事务提交。回执包含原命令、身份/范围、键、原状态/错误/尝试次数及重新排队时的元数据；不返回事件 payload。HTTP 200 只证明已安排重试，不能证明事件已应用。工作线程失败回滚后再记录错误时会核对原队列 revision，避免覆盖期间已经提交的人工重试或其他处理结果。

同键同命令重提先读取持久回执，重新核对当前可见性后返回历史结果，不再次改变队列；同键不同命令返回 IDEMPOTENCY_KEY_REUSED（409）。后台可能已进一步处理，因此历史回执中的 pending 与 checked_at 不是当前状态，需另行 GET 事件详情。原回执为 restricted 时，即使当前分类已降低，仍要求 restricted 读取能力。

回执查询只返回 recorded（含原回执）或 not-observed（未找到当前范围/actor/client/键对应记录），不会执行重试。not-observed 不证明原请求失败；网络错误或 503 也可能发生于事务提交后。应先按原请求查询，再决定是否以原键重提；不可直接换键重复安排。当前项目/事件不可见返回 404，持久数据不一致返回 500，数据库不可用返回 503。

039 仅新增队列修订号和人工重试回执表文件；启动源码增加结构检查，未执行该检查或迁移。

SDK 增加 retryPlaneInboxEvent/getPlaneInboxRetryReceipt，二者均传原 input（event_id、字符串 expected_revision、reason）与 WcpPlaneInboxRetryOptions（idempotency_key、expected_actor_id、expected_client_id）。CLI 增加 plane-events retry/retry-receipt，JSON 保存相同原命令、request_key 和两个 expected 身份字段；retry 可另用 --key，但同时提供必须匹配，retry-receipt 拒绝 --key。HTTP 客户端发送 x-expected-actor-id/client-id，由网关与可信身份比较；内嵌 CLI 先比对传入 context 的真实 actor/client，再执行同一命令。输入不接受权限/范围覆盖，身份前提不替代签名认证。

客户端保留原队列修订号为字符串，不发送数值 If-Match；查询不会继承新写入键，不自动提交或重新取版本。共享结果解析器检查 scope/identity/key/command、trace、空来源、历史队列修订号与次数关系，异常响应不当作成功。not-observed 和历史 recorded 均是成功查询，CLI 退出 0；排队成功也不代表事件处理成功。调用方负责在提交前保存原命令和身份/键，响应不确定时使用同一记录查询。SDK/CLI 仅加入源码及示例，未执行任何运行验证。

## 工作台人工重试与恢复

事件详情现在返回额外的 plane_inbox_identity（本次认证主体/client 和三层范围）以及 plane_inbox_permissions.retry（可信管理员的 human 身份提示）。该提示不保证 OPA 允许写入；每次提交仍执行完整重试授权。Web 从同一次详情响应取得身份并核对范围/trace；刷新和写入向网关发送原身份前提，不能将后来切换的账户或项目用于原请求。

`/admin/plane-events/detail?event=…` 增加原因、显式确认、安排重试、原请求回执查询和原地刷新。队列修订号始终为字符串；应用完成或版本不可递增时不能准备新的重试。提交与查询回执分开，页面不轮询、不自动重发；未知结果或已确认结果锁定原请求字段。not-observed、查询失败、权限变化和当前事件状态变化均不能解除已有不确定状态。确认的是历史安排结果，页面另显当前状态与检查时间。

首次发送排队请求前，用按身份/项目/事件绑定的 sessionStorage 保存完整原请求并读回；保存失败则不发送排队请求。仅保存请求、理由、身份和反馈，不存令牌或原事件 payload。恢复已提交请求可跨当前标签页重载，但不保证标签页关闭后保留；页面提供复制恢复 JSON 和粘贴恢复入口。导入核对原身份/事件，已有恢复请求时只接受完全相同的请求；导入只载入未知状态，不自动提交。恢复记录损坏时优先保留可解析的原请求并查询；无法读出原请求时禁止覆盖，可显示原始保存数据供恢复。

网络失败、提交响应校验失败、5xx 和幂等键冲突保持未知结果；已有未知结果不会被后来的拒绝降为已知失败。查询只读，即使浏览器存储临时不可用，已载入的原请求仍可查询；查询结果若无法保存，会提示保留当前页面并复制原请求。已确认回执不再因再次查询失败而降级。只有已确认或明确拒绝且已重新读取当前状态后，才能显式清除旧恢复记录、生成新键和准备新请求；未知结果不能换键。状态刷新失败保留现有请求。相关记录在新标签页打开，避免替换当前恢复页面。

这些页面、服务端动作和响应元数据仅开发源码；未进行编译、类型检查、浏览器检查或测试。仍依赖未执行的 037–039 迁移，存储保留/清理策略未完成。

## MCP 人工重试

retry_plane_event 使用 plane.retry，目录要求可信客户端、admin、签名 human；入参为原 event_id/字符串 expected_revision/reason/expected_actor_id/expected_client_id、idempotency_key 和 confirmed=true。确认字段只表达调用意图，不授予身份或权限；经预期身份比对后仍路由到同一重试命令、策略、审计与事务。原数值审核适配仅保留给 Proposal，Plane 队列不会被转换为 expected_version。

get_plane_event_retry_receipt 使用 admin.read，只要求可信管理员；保留原五个业务/身份字段，使用原 request_key，不接受 confirmed/idempotency_key 参数。两个工具拒绝数值版本头，查询清除继承的写入键。响应再次通过共享契约核对原请求、范围、身份和队列关系；无效响应以工具错误返回，不能当作原事务未提交。recorded/not-observed 都是查询结果，不自动触发重试或换键。详细参数、目录标记和未执行示例见 [MCP 运行时说明](mcp-runtime.md)。
