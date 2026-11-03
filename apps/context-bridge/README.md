# Context Bridge 本地同步存储

现有 SqliteOutbox 保存待上传事件。新增 SqliteSyncInbox 保存已下载的完整页面和按原消费者隔离的连续 received_cursor，两者使用独立文件与 schema。

SqliteSyncInbox 提供显式新库创建、importPage、inspect、readHead、close；已有库不会自动升级。完整页面经过共享契约与 SHA-256 校验，BEGIN IMMEDIATE 内追加不可变页面并推进头，首篇从零开始，后续绑定原前驱、起点和页大小；重复旧页不回退。读取核验完整头页和相邻前页，提交错误保留本次未知状态。

2026-11-03 页面审计增补：auditPages({expected_identity,max_pages?},trace) 在一个只读事务中核对所选消费者实际行数和头检查点，逐页完整核验整链到零起点根页，报告页数、事件条目数、根摘要及快照状态。默认 1000 页，可显式提高到安全正整数；预算不足明确未完成，不把局部检查报为通过。只审计该消费者页面链，不修复、写入、请求网络或审计确认扩展/全库物理状态。无 schema/依赖变化，未编译、测试、打开库或运行。

2026-11-03 历史页面增补：readPageHistory 按原身份分页返回完整校验后的摘要，默认 20、最多 50，续页绑定固定上界和上次末页序号/摘要；readPageByDigest 按原身份/精确摘要返回完整页面及独立当前状态。单次读事务核验头、所选页/边界与相邻前页，缺口或边界变化拒绝；不扩大为全链审计，不写库。CLI 可在关闭库后保存所选原页面。无 schema/依赖变化，仅源码文档，未编译、测试、打开库或运行。

接收位点不等于事件应用或服务器确认，Bridge 不从收件箱自动调用网络，也不修改 outbox。新 SQLite schema v1 只有源码，未打开数据库、初始化或迁移；未编译、测试或运行验证。接口、错误及持久性边界见 [本地同步收件箱契约](../../docs/design/01-contracts/sync-inbox-runtime.md)。
2026-11-03 增补：SqliteSyncInbox 已提供显式启用可选确认日志扩展、原目标准备、完整响应确认、当前游标观察及最新日志读取；方法本身不请求网络，CLI 在意图提交后、事务外调用有界 SDK。unconfirmed 阻止新目标，confirmed 与 observed 证据分别保留。核心 v1 未改，ack 扩展 v1 仅源码未执行；详见 [原确认日志](../../docs/design/01-contracts/sync-inbox-ack-runtime.md)，未编译、测试或运行。

2026-11-03 派发增补：独立 dispatch 扩展 v1 已接显式启用、最新派发读取、原目标与首次派发同事务登记、指定最新派发 ID 重试、回调前占用核对及完整响应事务结算。各派发保留自身证据，逻辑目标保留首份完整成功响应；期限届满只允许显式接替，不证明远端停止。低层旧 prepare/confirm 不提供派发门禁，缺派发历史的旧未知意图不补造历史。核心/ack v1 不改，dispatch 扩展仅源码未执行，未编译、测试或运行。

2026-11-03 历史读取增补：SqliteSyncInbox 新增 readAcknowledgementHistory/readAcknowledgementDispatchHistory 和 readAcknowledgementById/readAcknowledgementDispatchById，直接调用同样校验 16 KiB 查询/完整原身份/ID/安全分页参数。列表默认 20、最多 50，固定上界序号与 ID，逐条完整校验后投影摘要；派发可限定原 record_id，详情保留完整响应。单次读事务、结果数据 512 KiB 上限，不冻结跨页证据、不全量审计、不写入或请求网络，无新 schema/依赖，仅源码未执行。

2026-11-03 凭据增补：readAcknowledgementEvidence/readAcknowledgementDispatchEvidence 在单次读事务内取得精确原记录、可选派发及完整已存原页面，并返回共享 SyncAckEvidenceDocument；文件保存由 CLI 在事务外处理。记录/派发类型移至 contracts 并由 Bridge 兼容重导出；核心/扩展 schema 不变。文档摘要和嵌套页面摘要由文件适配独立计算，档案不能替代可信服务器结果或改写日志。仅源码与文档，未编译、测试、打开库或执行导出。

2026-11-03 旧意图恢复增补：独立 recovery 扩展 v1 提供 enableAcknowledgementRecoveries、startAcknowledgementRecovery 和 readAcknowledgementRecovery。仅精确选中的最新未解决原目标且无任何派发历史可登记恢复，恢复凭据与新派发同事务提交；重复恢复必须改用精确派发重试，原身份/游标/trace 不变。恢复凭据保存此前本地派发缺失/远端未知，不补造旧历史；旧发送者不受当前占用控制。core/ack/dispatch v1 不改，recovery schema 仅源码未执行，未编译、测试、打开库或运行。

2026-11-03 恢复档案 v2 增补：readAcknowledgementRecoveryEvidence 在单次读事务中取得完整原记录/原页面、不可变恢复凭据及其首笔本地派发，交由共享 v2 解析器核对全部绑定。恢复类型与解析移入 contracts，Bridge 保持重导出；普通档案仍生成 v1，旧规范字段顺序不变。文件适配兼容两版，缺恢复凭据拒绝导出，无新 schema/依赖，未编译、测试、生成样本或运行。

2026-11-03 确认日志审计增补：auditAcknowledgements({expected_identity,max_entries?},trace) 在单次读事务核验全部已启用确认/派发/恢复记录，默认总计 1000 条，可显式提高；检查实际行数覆盖、完整证据与原页、连续序号、pending/active 唯一性和跨消费者引用，缺失可选扩展单列，部分存在拒绝。保留历史状态、不写入或修复，不把无派发记录视为未发送。底层派发/恢复读取缩小解析 catch，存储异常不再冒充内容损坏。无 schema/依赖变化，仅源码文档，未编译、测试、打开库或执行审计。
2026-11-03 消费者发现增补：listConsumers({limit?,after_consumer_key?},trace) 从已有收件箱返回完整原身份和接收 state，默认 20、最多 50，严格查询 16 KiB、结果数据 512 KiB。单次读事务按摘要键升序选择，校验规范身份/键，返回项另核验头检查点、完整头页及相邻前页，损坏拒绝。续页为当前成员/状态，不承诺跨调用固定库存；不扫描缺消费者行的孤页，不等于全链或确认审计，不写库或请求网络。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、打开库或运行。

2026-11-03 页面链归档增补：readPageChainArchive(identity,trace) 在单次读事务核验并返回完整根到头档案；restorePageChainArchive(value,trace) 先独立核对全部摘要，再在单次写事务恢复空消费者或确认完整相同的重放。不同/部分/更长链拒绝，不覆盖或合并；全部页面写后全链读回，提交异常保留 unknown。归档最多 1000 页、16 MiB 文档并受 JSON 复杂度限制，确认历史/租约/应用状态不包含。原 importPage 改用内部事务助手，公开事务边界保留。见 [页面链归档](../../docs/design/01-contracts/sync-page-chain-runtime.md)，无 schema/依赖变化，未编译、测试、打开库或运行。

2026-11-03 页面链前缀增补：comparePageChainArchive 在单次读事务完整审计本地链并逐页对比归档，返回关系、匹配前缀长度、最早差异摘要及可选 append_query。appendPageChainArchive 要求严格原身份/归档摘要/预期头和页数，在同一写事务重新核对整链与检查点，仅追加缺失后缀并全链读回；过期/分叉/较短归档拒绝，原 restore 行为不变。共享检查助手复用于恢复、比较、追加，存储异常保留类别。无格式/schema/依赖变化，未编译、类型检查、测试、打开库或运行。
2026-11-03：显式 outbox reconcile 在完整原回执验证后，即使本地并发检查、预算或事务失败，也在错误 details.reconciliation 保留完整 receipt 与本次 local.settlement（not-committed/unknown）、transaction 阶段/回滚状态。COMMIT 异常明确 OUTBOX_COMMIT_UNKNOWN，回滚异常不遮蔽原错误；不将服务器 recorded 等同于本地已结算。导出 OutboxReconcileFailure 类型，普通队列路径不变。仅源码文档，未编译、测试、打开数据库或运行；见 docs/design/01-contracts/outbox-reconciliation-runtime.md。
2026-11-03：新增 `listRecords(input,trace)` 和 `readRecord(scope,event_id,trace)`。列表默认 20/最多 50，仅读取受限元数据，返回可续页 next_query；详情按原 ID 完整校验身份/命令和两个摘要，允许查看活跃发送，但不修改租约。`{readonly:true}` 要求已有队列并启用 query_only，无 schema 初始化/升级；旧 inspect 的损坏正文替代值仅保留兼容，CLI 新读取不再使用。详见 docs/design/01-contracts/outbox-reading-runtime.md；仅源码文档，未编译、测试、运行或打开库。

2026-11-03 本地投影应用增补：`SqliteSyncInbox.enableApplications(trace)` 显式启用独立 application v1，`readApplicationState({expected_identity,application:{name,version},timeout_ms?},trace)` 读取完整本地投影，`applyApplicationPage({expected_identity,application,document_sha256,expected_previous_sha256,timeout_ms?},handlers,trace)` 处理精确下一原页。handlers 按事件类型提供受信同步纯函数 `(projection, change) => nextProjection`；初始 projection=null，未知类型拒绝，输入为独立 JSON 副本，Promise/异常/非法投影拒绝整页。完整投影快照、事件去重 ledger、应用步骤与头在同一事务中读回/提交，已提交原页重放不重跑 handler；不推进 received_cursor 或发送 ack。单投影 1 MiB、单页累计 reducer 输入输出 64 MiB、默认本地 30 秒；提交/回滚不明保留原请求并重新读取。调用方必须固定应用版本语义、验证业务 payload，并禁止 reducer 外部副作用；该边界无法隔离恶意代码或回滚外部操作。无默认业务 reducer/CLI 应用入口/完整历史审计，页面归档不包含投影。详见 [应用运行契约](../../docs/design/01-contracts/sync-inbox-application-runtime.md)。新 schema 只写源码，未编译、类型检查、测试、打开库、调用接口或执行初始化。
2026-11-03 CLI 状态入口增补：workctx 已接 `inbox enable-applications --inbox FILE` 与 `inbox application-status --inbox FILE --json-file QUERY.json`，复用上述启用和读取接口。查询固定完整原身份/application 名称版本，解析后只读打开；CLI 仍无执行应用命令，handler 由调用方提供。仅源码文档，未编译、测试、运行或打开库，见 [CLI 使用说明](../workctx-cli/README.md)。
