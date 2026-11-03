# 同步上传与完整批次回执

更新：2026-11-03。只有源码与文档，未编译、类型检查、测试、执行 CLI/API、运行服务或发布。上传传输增量未增加依赖/迁移；后续 [原身份绑定](sync-identity-runtime.md) 增加本地 SQLite 三列的升级源码，未打开数据库或执行升级。PostgreSQL 016–049 保持未执行，R-005 仍未完成。

## 原批次与共享解析

`snapshotSyncUploadBatch`、`parseSyncUploadResult`、`parseSyncUploadEnvelope` 从 `@planemem/contracts` 导出。Bridge Gateway publisher、SQLite outbox 结算及 SDK `uploadEvents` 共用它们；服务端既有 `POST /v1/events:batch` 输出和指纹规则不变。

发送前保存独立的完整事件快照：1–100 条、不重复 event_id、完整 `{events}` UTF-8 JSON 最多 1 MiB。拒绝非有限数字、undefined、访问器、非普通对象、循环、稀疏数组和超出深度 64/100000 节点的输入。快照通过既有事件解析，但保留调用方可选字段的存在状态与额外字段；不以注入默认值后的对象替换原正文。服务端继续负责规范化与指纹。

SDK 和 outbox 交给传输/自定义 publisher 的是另一个副本，回执始终对照等待前的原快照。有效 JSON 的复杂度限制是客户端约束，不是新服务端协议或全进程内存保证。

## 回执形状

完整业务封套的 JSON 最多 256 KiB，必须包含 schema_version=1、本次请求 trace_id、唯一来源 `[{type:'sync-stream',id:原 project_id}]`、server_cursor 和 data。data 必须包含原 tenant_id/workspace_id/project_id，以及 accepted/rejected/next_cursor；外层 server_cursor 必须等于 next_cursor。以上对象不接受额外字段。

accepted 与 rejected 合起来必须恰好覆盖原批次每个事件一次，不接受缺项、重复、未知 event_id 或部分成功回执。next_cursor 是非负安全整数；持久条目的 server_cursor 是正安全整数且不超过 next_cursor，同一回执中的 server_event_id/server_cursor 均不能重复。ID 沿用既有同步标识符规则，不改为只接受 ULID。

| 条目 | 必需字段与关联 |
| --- | --- |
| accepted | event_id、accepted=true、server_event_id、server_cursor |
| VERSION_CONFLICT | event_id、accepted=false、code、trace_id、唯一 conflict_id、server_event_id、server_cursor；原事件须为 FieldChangeProposed |
| CURSOR_GAP | event_id、accepted=false、code、trace_id、正安全整数 expected_cursor；原事件须有 client_cursor 且与 expected_cursor 不同 |
| VALIDATION_ERROR / EVENT_ID_REUSED / SOURCE_UNAVAILABLE | event_id、accepted=false、code、trace_id；不得附带持久事件/冲突/游标字段 |

每种条目仅允许表中字段。拒绝条目的 trace_id 必须是有效文本，但可以不同于当前请求 trace：同键批次重放会保留原拒绝记录的 trace。封套和 HTTP 响应头仍必须对应当前请求。回执不回显原正文摘要或原账号/客户端绑定，所以这些检查不能证明正文指纹、跨身份幂等或源实体已应用。

## Bridge 传输

`createGatewayPublisher` 保留 gatewayUrl/accessToken/fetch 配置，新增 timeoutMs、signal、traceId。默认本地等待 30000 ms，允许 1–90000 ms；traceId 可省略由 publisher 生成，显式值为 1–1024 个非空白可打印 ASCII 字符。URL 仅 HTTP(S)，拒绝用户信息、查询和 fragment，仍从主机根路径解析 `/v1/events:batch`。

单次调用在首次等待前固定批次、范围、原传入键、请求头及正文；发送 x-trace-id。后续原身份绑定要求 BatchPublisher 第四参数为完整 expectedIdentity，核对范围并发送 x-expected-actor-id/x-expected-client-id；缺身份不会使用当前令牌补齐。等待预算从凭据获取开始，覆盖 HTTP、完整正文及返回前校验。使用单调时钟及本地 Promise 竞争，即使凭据提供器或 fetch 忽略取消也会结束本地等待；迟到响应尝试取消正文。同步 CPU 工作不能被抢占，所以它不是硬实时截止或整个 outbox lease 的绝对保证。

网络请求禁止重定向、不使用缓存、不自动重试。成功仅接受 HTTP 200、精确 trace 头和 application/json（可选 UTF-8 charset）。直接读取流，解压后的正文限 256 KiB，严格 UTF-8 和完整 JSON；Content-Length 语法须合法，未编码或 identity 编码时还核对实际长度。没有无限制 text/json 读取回退，未完成读取尝试取消并释放锁；取消失败不能覆盖原错误。

HTTP 400–599 返回固定 `SYNC_HTTP_NNN`，只将 408/429/5xx 标为可重试；错误正文直接取消，不读取或输出正文。无效回执为 `SYNC_RECEIPT_INVALID`，其他未知传输失败为 `SYNC_PUBLISH_UNAVAILABLE`，均可重试。超时/外部取消分别为 `SYNC_PUBLISH_TIMEOUT` / `SYNC_PUBLISH_CANCELED`，表示停止本地等待，不能证明远端未完成。无效本地批次为不可重试的 `SYNC_BATCH_INVALID`，附 dispatch_state=not-sent；无效凭据为 UNAUTHENTICATED。错误不回显令牌或事件正文。

## SQLite 与 CLI

SQLite 自定义 publisher 的完整结果同样经过共享解析，不能通过省略条目或修改传入事件绕过原批次核对。解析成功后才转换为结算状态；只有 accepted 进入 sent，VERSION_CONFLICT 保留为 conflict，CURSOR_GAP 进入既有 pending/backoff，其他合法拒绝进入 failed。未知/可重试错误整批保持未确认，沿用既有退避与五次失败上限；达到上限的 failed 行仍保留原事件，不等于证明服务端没有接收。

既有 lease 为 120 秒，publisher 最多 90 秒仅为局部等待上限。每次 claim 的 lease token 作为本次批次键；后续 claim 可能改变批次与键，继续依赖服务器按原身份和事件 ID 去重，不能宣称跨 drain 始终重放同一批次键。后续原身份绑定会在 claim/retry 前检查完整身份与命令摘要，旧缺身份行保留并阻止发送；既有退避、尝试上限及 payload checksum 保留，详见原身份契约。

网络 CLI `sync flush --limit N` 复用 Bridge publisher，并传入本次 CLI trace；没有新增 CLI 超时选项，使用默认 30 秒。它只发送一批，不下载变化或 ack；部分重试、失败或冲突沿用退出码 1。没有执行示例或实际同步。

## SDK 有界上传

SDK `uploadEvents(events, options)` 现通过独立 sync-upload 实现发送。导出 `WcpSyncUploadOptions`，保留必需 idempotency_key，可选 timeout_ms/signal/expected_identity；既有只传键的调用仍适用。options 仅允许这四项普通自有数据字段，拒绝未知字段、访问器、符号和非普通原型。首次等待前固定完整事件快照、原范围、trace、键与选项，传输只得到另一个事件副本；提供 expected_identity 时核对原范围/已有身份约束并发送预期身份头。仍由共享解析核对完整原批次，不返回部分成功。

SDK 默认本地预算 30000 ms，timeout_ms 允许 1–2147483647。同步输入准备后建立预算，覆盖传输等待、返回后完整解析及交付前检查；预先取消不调用 transport。复用的 RequestBudget 现使用单调时钟，系统时间校准不改变预算；定时器与异步竞争限制本地等待，不能抢占同步 CPU 工作或证明远端取消。

请求明确选择 `response_type=bounded-json`，成功正文 256 KiB、错误正文 16 KiB。FetchWcpTransport 复用既有流读取、严格 UTF-8/JSON、Content-Length/编码、HTTP 200、trace 与媒体类型校验；取令牌、网络和正文有其配置的独立预算。因此方法与 Fetch 两层期限中先到者生效：若希望等待超过默认 30 秒，两者均需配置。迟到响应取消、未完成读取释放，以及成功/失败后的定时器清理沿用共用助手；本次补上清理异常保护，避免覆盖原失败。

自定义 WcpTransport 须支持 bounded-json、max_response_bytes 与 signal。SDK 仍可通过本地竞争结束等待并拒绝无效完整结果，但自定义传输忽略这些字段时，无法保证其内部缓冲或底层工作已停止；不回退到旧无限制 JSON 模式。旧 Mock/fixture 尚未因此获得完整上传能力。

错误使用固定文案和白名单代码，不透传服务器正文、消息或 details。错误一律 retryable=false，以免调用方把未知结果直接纳入自动重试；它不证明失败、回滚或禁止审阅后使用原请求继续。`details.dispatch_state=not-sent` 仅表示本次尚未调用 transport，不代表这组事件以前从未发送；调用 transport 后遇到错误则为 unknown，即使适配器可能尚未实际发出网络请求。取消/超时/格式错误必须保留原事件、范围、身份与键；方法不生成键、不持久保存、查询回执、重试或修改队列。

## 边界与后续工作

独立 [outbox reconcile](outbox-reconciliation-runtime.md) 已接入源码：显式指定原行，读取可信回执，事务内重读完整行和租约后结算。保留原事件、尝试次数和调度，不把未观察到转成失败或重试；flush 自身仍不自动调用该流程。

新增 [原同步事件回执](sync-event-receipt-runtime.md)：SDK getSyncEventReceipt / CLI sync receipt 按保存的 identity/event 查询历史记录，不依赖后续 claim 的批次键。recorded 仅确认匹配的规范化投递，not-observed 不证明失败；当前查询不接管 flush 退避、重试或 SQLite 结算，不证明源实体已应用。

MCP upload_events 已另行迁移原身份必填、固定原键/完整批次、完整回执解析及独立 30 秒/两笔准备容量，见 [MCP 原同步上传](sync-mcp-runtime.md)。其错误区分本次 not-sent 与派发后 unknown，不自动重试或保存。CLI 其他直接上传路径及自定义 SQLite publisher 的外层预算未因 SDK 方法变化而扩展；Bridge publisher 仍保留自己的最多 90 秒配置和队列语义。SDK/MCP 下载变化已另接 [完整分页](sync-changes-runtime.md)，确认已另接 [原身份与当前位点](sync-cursor-runtime.md)；仍不自动消费或结算。

本地新队列行现保存原 actor_id/client_id，Bridge 发送时要求可信身份匹配；旧未知身份行不会自动补绑定。原身份发现与完整规则见 [原同步身份](sync-identity-runtime.md)。SDK 省略可选原身份、忽略身份的自定义 publisher 和旧进程仍未获得该保护；旧行恢复、MCP 调用者原请求持久保存、旧消费者/Mock/fixture 迁移，以及断网、迟到响应、重启、并发和真实恢复证据均仍待补。
