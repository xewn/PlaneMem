# 原同步身份与离线队列

2026-11-05，TODO P0-01：新增 [同步上传 OpenAPI](../../../packages/contracts/openapi/sync-upload.json) 与 [原身份/投递 Schema](../../../packages/contracts/schemas/sync-original.json)，明确参数为空、完整16 KiB身份成功、实际 sync.write/admin/到期门禁及独立可选身份前置头。此读取没有父项目/存储检查，不能绑定未知旧队列或授权未来上传；新鲜流事件另有 canonical 范围约束。仅源码描述，未改运行实现，未编译、类型检查、测试、运行校验器/生成器/接口/数据库或发布；P0-01/R-001 未完成、evidence 为空。

更新：2026-11-03。本增量只有源码与文档，未编译、类型检查、测试、执行 CLI/API、打开 SQLite、启动服务、执行迁移或发布。新增本地列的升级逻辑未执行；PostgreSQL 016–049 保持未执行，R-005 仍未完成。

## 读取身份

新增 `GET /v1/sync/commands/context` / `sync.command-context`。无参数、正文、写入键、版本条件、条件缓存或 Range。入口使用已验证账号/客户端及原三层范围，必须是未过期的 authenticated_client，并具有 sync.write 或既有管理员角色；仍经过原 sync.write 策略及入口审计。不会读取队列、项目内容或同步事件，也不生成键或确认历史投递。

返回 schema_version=1、当前 trace_id、空 source_refs，data 包含完整 identity、expires_at、permissions.upload_events=true。identity 精确包含 tenant_id/workspace_id/project_id/actor_id/client_id；actor/client 支持普通字符串，不改成仅允许 ULID。每次正式上传仍按当前可信权限重新授权，提示不证明项目可见、权限永久有效或原事件已经保存。

共享 `parseSyncCommandIdentity` 返回独立五字段对象，拒绝未知/缺失字段、访问器、非普通对象和非法文本。`parseSyncCommandContextEnvelope` 核对完整形状、范围、trace、空来源、规范到期时间及可选原身份，完整封套最多 16 KiB。身份文本不是令牌，不授予权限；本地文件/对象也不构成签名证明。

SDK `getSyncCommandContext({timeout_ms?,signal?})` 默认本地 30 秒、成功/错误各 16 KiB，返回前核对到期和调用上下文中已提供的 actor/client。普通字符串账号可用只含范围/trace 的 WcpClient，再把返回 identity 保留在原事件中；SDK 不保存或自动替换身份。

CLI `workctx sync identity` 只接受可选 `--timeout-ms`（1–2147483647），拒绝 JSON、写键、重复或未知选项。网络和嵌入入口都使用 SDK；嵌入另外在读取前后核对可信权限/有效期、完整身份与到期时间。命令不自动入队、查找旧事件或发送批次。示例仅为用法说明，未执行。

## 新事件准备和保存

准备新事件时，将上述 `data.identity` 保存到事件输入的 `expected_identity`，并与 event_id/event_type/payload/source_refs/可选 sensitivity/client_cursor 一起保留。CLI `outbox enqueue --json-file event.json` 仍离线执行，要求该原身份匹配 WORKCTX_* 三层范围；拒绝直接 actor_id/client_id 字段，不从当前令牌推断原发送者。过期的身份提示不替换原身份，之后可使用同一账号/客户端的新令牌发送；正式权限由服务器重新核对。

`SqliteOutbox.enqueueDurably` 新写入在运行时要求完整 expected_identity。EnqueueInput 仍将字段标为可选以容纳旧调用的源码迁移，但缺失值明确报 OUTBOX_IDENTITY_REQUIRED；不会创建无身份的新行。事件先复制成独立有效有限 JSON，单事件仍受完整批次 1 MiB 上限。返回值是深副本，不与原输入或发送结算对象共享嵌套数据。

SQLite 初始化源码增加三个可空列：expected_actor_id、expected_client_id、command_checksum。完整身份的范围来自原行三层 scope，账号/客户端单独保存；不保存访问令牌、角色、权限或过期时间作为发送授权。旧行保持空值，不按当前登录账号补写。

command_checksum 为本地 SHA-256，覆盖完整原身份、原上传事件和本地 idempotency_key；对象键排序，数组顺序和可选字段存在状态保留。它与既有 payload checksum 同时检查，扩展了事件类型、来源、分类、客户端游标、范围和身份的变更检测。trace、重试次数、调度时间、状态和回执不参与上传命令摘要。该摘要是本地意外变更检测，不是签名、加密、服务器指纹或抵抗可重写数据库者的证明。

同本地键且原事件/身份完全相同时返回原记录（包括原 trace 和投递状态）；不同项目仍为 OUTBOX_KEY_SCOPE_CONFLICT，同项目不同原内容、缺身份或校验损坏则为 OUTBOX_KEY_REUSED，不覆盖或静默接受新内容。新 trace 不会改写旧事件。不会通过重复 enqueue 给旧行补身份。

## 发送和恢复

claim 在原事务中检查身份和完整命令校验和。待发送旧行缺身份时进入 failed、last_error=OUTBOX_IDENTITY_REQUIRED，保留原数据和历史回执，不调用 publisher、不增加发送尝试；格式损坏为 CORRUPT_RECORD，摘要不符为 CHECKSUM_MISMATCH。单次 claim 仍只查看既有限额内的候选，后面的记录需要后续显式 flush。

项目批次按原行顺序选择同一个完整身份，遇到下一种身份就结束这一批；不会为了匹配当前令牌重新绑定或混装事件。`BatchPublisher` 新增第四参数 expectedIdentity，outbox 传独立副本并以另一份原事件快照核对回执。Bridge publisher 在取令牌前固定该身份、核对原项目，并发送 `x-expected-actor-id` / `x-expected-client-id`。HTTP 入口对照可信令牌；直接 ApiGateway 适配同样要求同时存在的两个头、可信客户端及完全匹配，头名不区分大小写且拒绝重复值。

预期身份头是前置条件，不能覆盖可信身份。换账号/客户端后发送原批次会被拒绝，当前策略将 HTTP 403 作为 failed 保留；恢复原可信身份后，可明确 outbox retry 再 flush。旧记录缺身份时 retry 同样拒绝，不能通过重置尝试次数绕过。sent/conflict 的旧行仍可检查，不自动重发。当前未提供给旧行手工绑定身份的命令，也不会将它们复制成新事件绕开保护；须后续依据原记录与服务器投递证据设计显式恢复。

SDK `uploadEvents` 增加可选 `expected_identity`。提供时核对原三层范围以及上下文中已有的 actor/client 约束，再发送上述两个头；省略时保留旧直接上传兼容行为，因此不能把所有旧 SDK 调用都视为已绑定原身份。此增量不改变请求正文或服务器批次/事件指纹。HTTP 回执仍不回显账号/客户端，完整事件回执规则见 [同步上传](sync-upload-runtime.md)。

自定义 BatchPublisher 必须尊重第四参数；旧三个参数的函数在 TypeScript 中仍可能兼容，但忽略身份的适配器没有获得保护。旧单事件 drain 会先拒绝缺身份/摘要不符的行并把完整事件深副本交给回调，回调仍负责发送身份与确认语义，不能用无异常返回证明完整服务器回执。CLI flush 使用严格 Bridge publisher。各批次键仍由 claim 产生，后续 claim 可变化；同一原身份内依赖原 event_id 去重，不承诺固定批次重放。

## 未完成范围

新增 [原同步事件回执](sync-event-receipt-runtime.md)，可用保存的五项身份及完整事件显式读取历史投递。未观察到不能判定失败；该查询不打开 SQLite、不结算队列、不推断或补写旧身份。另有独立 [本地核对与结算](outbox-reconciliation-runtime.md) 接入指定完整原行，重复比对原命令/租约后才更新已确认投递；缺身份旧行的追溯/绑定仍未提供。

MCP 原身份/事件回执读取和 upload_events 原批次上传已另行接入源码，见 [MCP 原同步工具](sync-mcp-runtime.md)；上传必须显式提供 expected_identity 和原键，不能从当前上下文补入。SDK/MCP 下载已有 [完整分页与有界读取](sync-changes-runtime.md)，支持可选原消费者身份前置条件；[确认及当前位点](sync-cursor-runtime.md) 已要求保存的原身份并提供完整回显。仍没有下载原身份回显、调用者持久消费位点、旧队列身份追溯/人工绑定或跨设备备份。旧进程不认识新列/约束，不能与新代码同时操作同一队列并声称已保护；升级部署与并发旧进程隔离仍待真实证据。自定义传输、普通 drain 回调和未提供原身份的直接 SDK 上传仍须迁移。Unicode 身份能否由当前 HTTP 头编码表示沿用现有传输能力，不能编码时须失败，不能改写身份。

新 SQLite 列、账号切换、重新登录、重复键、原命令损坏、混合身份批次、掉线/进程崩溃/并发 claim、旧消费者/Mock/fixture 兼容和真实恢复均只有待验证条目，未补造运行证据。
