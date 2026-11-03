# Context Bridge 本地同步存储

新增 `readRestoreBackup` 和独立 `outbox-restore-backup` 子路径：复用单次全项目审计收集完整回执/原档案，v1文件最多100份/64 MiB文档，逐份及集合摘要共享原历史校验。独立文件核验不加载原生SQLite；不读取或修改当前队列。见 [恢复历史备份](../../docs/design/01-contracts/outbox-restore-backup-runtime.md)。无schema/依赖变化，仅源码文档，未运行、编译或测试。

新增 `compareRestoreRecord`，按项目/恢复 ID/事件 ID 在单次只读事务完整核验历史，并对照全部23个当前存储列，返回原档案、恢复基线和当前摘要及变化列。固定90秒、结果128 KiB；内容相同不证明因果来源，当前缺失不推断删除或投递。见 [恢复记录对照](../../docs/design/01-contracts/outbox-restore-comparison-runtime.md)。无 schema/依赖变化，仅源码文档，未运行、编译或测试。

新增 `auditRestoreReceipts`，完整核验原项目恢复历史，默认100份/64 MiB/30秒，上限1000份/512 MiB/90秒；先有界计数，再分批读取元数据、逐份完整验证原查询/档案及v1恢复摘要。预算在正文加载前检查，不留存全部档案；失败保留进度且不返回部分通过。目录新增全项目audit_query。见 [恢复历史核验](../../docs/design/01-contracts/outbox-restore-audit-runtime.md)。无schema/依赖变化，仅源码文档，未运行、编译或测试。

2026-11-03：`SqliteOutbox` 与 `SqliteSyncInbox` 的 `{readonly:true}` 现于 `DatabaseSync` 打开时传入原生 `readOnly:true`，并继续启用 `query_only`、核对已有结构。只读连接不因文件在预检后消失而按默认模式创建主库，也不在失败时回退可写；未添加初始化/升级或修复。Outbox严格检查existing/readonly布尔选项，readonly优先要求已有文件。普通写入和Inbox显式create规则保持；这是数据库连接模式，不是整个文件系统的只读隔离，显式导出仍可写新输出文件，文件身份原子绑定/日志环境兼容性仍待验证。使用现有Node 24和本地类型定义，无依赖变化；仅源码文档，未编译、类型检查、测试或打开库。

新增 `previewArchiveRestore`，共享实际恢复的完整源档案、原回执精确匹配、暂停版本/空项目/全库ID与键冲突和v1映射检查；一次读事务返回预计状态统计或既有历史回执，不预留ID或写入。见 [恢复前预览](../../docs/design/01-contracts/outbox-restore-preview-runtime.md)。无schema/依赖变化，仅源码文档，未编译、测试或打开数据库。

新增 `listRestoreReceipts/readRestoreRecord/readRestoreArchive`，只读浏览项目恢复元数据、按 ID 核验完整历史并取回原档案。列表默认10/最多20条，明确正文未核验；单条复用原档案与不可变恢复映射摘要校验，不依赖调用方保存原查询。见 [恢复历史](../../docs/design/01-contracts/outbox-restore-history-runtime.md)。无 schema/依赖变化，仅源码文档，未编译、测试或执行数据库。

新增 `readBuiltInApplicationPendingPages`，在同一只读事务核对应用与接收检查点，列出紧随应用头的连续原页，返回首待处理页的 `next_apply_query`。默认20/最多50页并完整核验前瞻页，64 MiB原页预算、512 KiB完整响应，不执行 reducer。见 [待应用原页发现](../../docs/design/01-contracts/sync-application-pending-runtime.md)。仅源码文档，未运行、编译或测试。

新增 `previewBuiltInApplicationPage`，复用 apply 的原页/前驱/事件/投影校验与归约，在单次读事务中返回 current_state 和独立 planned_application。已应用页只核验历史、返回当前状态；完整响应上限 3 MiB，不创建步骤或回执。见 [原页应用预览](../../docs/design/01-contracts/sync-application-apply-preview-runtime.md)。仅源码文档，未运行、编译或测试。

新增 `CONFLICT_APPLICATION={name:'conflict-lifecycle',version:'1'}`，将现有冲突检测/决策事件投影为 open/resolved 历史，保留完整原事件与决策值，核对原字段/版本/来源及分类不下调。内置 apply/replay 使用同一选择器，最多 512 冲突并沿用原字节预算；不更新工作项等源字段。见 [冲突生命周期](../../docs/design/01-contracts/sync-conflict-application-runtime.md)。仅源码文档，未运行、编译或测试。

新增 `PROPOSAL_APPLICATION={name:'proposal-lifecycle',version:'1'}`。内置 apply/replay 按原 application 选择上下文或建议适配器；建议保留请求和完成事件，严格创建基线、版本、种类、分类与游标，只表达历史状态。共享解析器按现有 Gateway 事件核验，不含正文或实时审阅权限。见 [建议生命周期](../../docs/design/01-contracts/sync-proposal-application-runtime.md)。无 schema/依赖变化，仅源码文档，未运行、编译或测试。

新增 `auditApplicationRestoreReceipts`，在一次只读事务内核对所选原身份/应用的全部恢复回执，默认最多 1000 份/64 MiB，逐条完整校验并核对实际行数。失败保留原查询、阶段和已核验数量；不读当前应用头。见 [回执完整范围审计](../../docs/design/01-contracts/sync-application-restore-receipt-audit-runtime.md)。仅源码，未运行或测试。

新增 `listApplicationRestoreReceiptScopes`，直接从回执表分页找回原消费者身份和应用，覆盖没有应用头的空恢复回执。每个选中范围及前瞻范围校验一份代表回执，输出已有 list/get 的查询参数；不声明完整历史审计。见 [跨范围目录](../../docs/design/01-contracts/sync-application-restore-receipt-scopes-runtime.md)。仅源码文档，未编译、测试或打开库。

恢复查询/目标/回执结构解析已提取为共享契约，保持原字段顺序与规范查询/回执摘要，Bridge 继续独立核验原查询和数据库回执 SHA。供 [回执文件离线流程](../../docs/design/01-contracts/sync-application-restore-receipt-file-runtime.md)复用；无数据库结构变更，仅源码，未运行或测试。

新增 `listApplicationRestoreReceipts` 按原消费者/应用分页发现恢复回执 ID；默认 20、最多 50，完整校验选中记录和前瞻后返回历史摘要及 get 查询。按 ID 排序，每页独立快照，不称为恢复时间线或完整审计。见 [回执目录](../../docs/design/01-contracts/sync-application-restore-receipt-catalog-runtime.md)。仅源码，未打开库、编译或测试。

新增 `getApplicationRestoreReceipt` 按原身份/应用/restore_request_id 找回历史回执及完整原查询；本次读取 timeout_ms 不覆盖记录中的原期限。复用既有完整回执校验，原完整查询精确核对仍保留。见 [原查询找回](../../docs/design/01-contracts/sync-application-restore-receipt-selection-runtime.md)。仅源码，未打开数据库、编译或测试。

2026-11-03 新增应用恢复持久回执源码：显式 enableApplicationRestoreReceipts 启用独立扩展；带 restore_request_id 的恢复在原事务内保存并读回紧凑历史回执，相同请求返回原回执，ID 复用不同查询拒绝。readApplicationRestoreReceipt 按完整原查询只读查回执，不读取当前投影；查无记录不证明此前回滚。见 [持久回执契约](../../docs/design/01-contracts/sync-application-restore-receipt-runtime.md)。仅源码文档，未启用扩展、打开库、编译或测试。

2026-11-03 恢复目标绑定增补：恢复/预览查询可带完整 expected_target v1 双摘要，分别固定所选应用全部原页/投影/原应用 trace 和原消费者完整接收链。预览生成的 restore_query 默认携带当前目标约束；带旧约束的预览发现变化返回 conflict，实际恢复在同一写事务第一次插入前核对两项，变化报 TARGET_CHANGED，成功返回 target_before/target_after。旧无约束查询保留原行为，未知提交不丢失原约束；摘要只绑定逻辑内容，不认证来源或证明之前操作结果。见 [恢复目标绑定](../../docs/design/01-contracts/sync-application-restore-target-runtime.md)。仅源码文档，未编译、测试、运行接口或打开库。

2026-11-03 应用恢复预览增补：`previewApplicationArchiveRestore(archive,input,trace)` 使用同一原身份/应用/归档摘要查询，在单个只读事务完整审计目标应用与接收链，返回关系、首个正序差异摘要、可恢复性和预计新增页/事件数量。与实际恢复共用比较逻辑；合法不兼容返回 conflict，损坏/超限仍失败。只反映读取时快照，实际恢复重新检查；不输出投影正文或进行写入。CLI application-restore-preview 已接只读打开。见 [恢复预览契约](../../docs/design/01-contracts/sync-application-restore-preview-runtime.md)。仅源码文档，未编译、类型检查、测试、执行接口或打开库。

2026-11-03 应用归档恢复增补：`restoreApplicationArchive(archive,input,trace)` 要求完整原身份/应用/归档摘要，在既有应用扩展上用单个写事务恢复原接收页、逐页投影/原 trace、事件绑定和应用头。仅接受空应用或完整相同历史；兼容接收前缀可补齐，较新接收后缀保留。恢复前后完整结构审计，提交/回滚不明保留 unknown 和原查询/进度。CLI application-restore 已接入；不执行 reducer 或确认服务器，归档不认证来源/业务语义。见 [应用归档恢复契约](../../docs/design/01-contracts/sync-application-restore-runtime.md)。仅源码文档，无新 schema/依赖，未编译、测试、执行恢复或打开库。

2026-11-03 应用历史归档增补：`readApplicationArchive(input,trace)` 按原身份/应用在单次只读事务完整结构审计后导出根到应用头的原页面、逐页投影/摘要和原应用 trace。独立共享格式 v1，最多 1000 页、文档 16 MiB、投影 1 MiB；空页保持原投影、跨页事件 ID 唯一，原页面/投影/文档摘要分别核验。CLI application-export 保存新文件并最终读回，application-inspect/ application-archive-get 可离线分页查看/读指定快照；不包含未应用接收后缀或确认日志，不证明业务语义，导入恢复已另接显式入口，实际恢复证据仍缺。见 [应用历史归档契约](../../docs/design/01-contracts/sync-application-archive-runtime.md)。无新 schema/依赖，仅源码文档，未编译、测试、运行、生成样本或打开库。

2026-11-03 应用目录增补：`readApplicationCatalog(input,trace)` 按完整原 expected_identity 分页读取已保存应用名称/版本和头摘要。默认 20/最多 50，按应用摘要键 BINARY 顺序，用 next_query 显式续页；每项及前瞻完整核验描述/键、头快照、原页和该页 ledger。结果含 application_query、固定本次头上界的 history_query 和精确 snapshot_query，不输出投影正文；目录跨调用读取当前成员/头，不冻结成员或核查缺描述的孤立行。固定 64 MiB 逐应用原文/投影预算、512 KiB 响应，沿用本地期限；CLI application-list 已接只读入口。见 [应用目录契约](../../docs/design/01-contracts/sync-application-catalog-runtime.md)。无 schema/依赖变化，仅源码文档，未编译、测试、运行或打开库。

2026-11-03 内置应用重放增补：`replayBuiltInApplicationHistory(input,trace)` 在同一只读事务先完整结构审计，再从 null 按原页/事件正序重算 context-item-lifecycle/1，逐页比较完整保存投影。首个不匹配页返回原页/投影摘要，规则拒绝保留具体事件位置；不回写快照或应用头。沿用审计页/事件/源字节/时间预算，新增 max_replay_bytes（默认 64 MiB、最多 512 MiB），单页处理仍限 64 MiB、投影 1 MiB。成功仅证明本次历史与当前固定内置代码重算相符，来源和服务端状态未认证；CLI application-replay 只读接入。见 [重放核对契约](../../docs/design/01-contracts/sync-application-replay-runtime.md)。无 schema/依赖变化，仅源码与文档，未运行 reducer、CLI、数据库、编译或测试。

2026-11-03 应用历史浏览增补：`readApplicationHistory(input,trace)` 返回固定双边界的步骤摘要分页，默认 20/最多 50，每个边界绑定序号/原页摘要/投影摘要；完整核验选中步骤、ledger 与一条前瞻，返回 next_query 和每项 selection_query。`readApplicationSnapshot(input,trace)` 按原页摘要读取完整历史投影，可绑定 expected_projection_sha256；缺步骤返回 found=false/snapshot=null，当前头以独立摘要返回。均要求原 expected_identity/application，可选 timeout_ms；只读事务，64 MiB 不同选中源文档/投影预算，列表摘要 512 KiB/详情 2 MiB 响应限额，不自动导出、恢复、重放或确认。CLI application-history/application-get 同步接入；范围及局限见 [历史浏览契约](../../docs/design/01-contracts/sync-application-history-runtime.md)。无新 schema/依赖，仅源码文档，未编译、测试、运行或打开数据库。

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
2026-11-03 内置上下文生命周期增补：`applyBuiltInApplicationPage(input,trace)` 与 `parseInboxBuiltInApplicationApplyQuery` 原先只接受 `CONTEXT_ITEM_APPLICATION={name:'context-item-lifecycle',version:'1'}`；后续同日已扩展建议适配器（见页首），复用原页/预期前驱事务。按实际 Gateway 事件校验五类状态变化，从创建版本 1 连续处理，保存创建/最新事件；九类范围外事件显式保持原投影，未知类型拒绝。投影校验在事务内覆盖当前、重复历史与待提交快照，业务错误有固定原因，提交未知保留。CLI 已接 application-apply，通用自定义 handler 接口保留。只投影生命周期元数据，不含完整正文或实时权限，见 [运行契约](../../docs/design/01-contracts/sync-context-item-application-runtime.md)。无新 schema/依赖，仅源码文档，未编译、测试、运行或打开数据库。
2026-11-03 应用历史结构审计增补：`auditApplicationHistory({expected_identity,application,max_pages?,max_events?,max_bytes?,timeout_ms?},trace)` 在同一读取快照核对头到根的全部步骤、完整原页/投影摘要、全部事件 ledger 和实际行数，空事件页须保持原投影；无应用且无孤立行时完成空历史审计。默认 1000 页/100000 事件/64 MiB/30 秒，超限或失败不返回部分通过；不重跑 handler 或证明业务语义。CLI application-audit 只读接入，成功 state 的 full_application_history_audit=verified-structure 仅对该次结果有效；无新 schema/依赖，仅源码未执行。见 [应用历史审计契约](../../docs/design/01-contracts/sync-application-audit-runtime.md)。

2026-11-03：新增 `auditRecords(input,trace)`，严格原项目和 max_events/max_bytes/timeout_ms，在单次只读事务核验全部原身份/正文/命令摘要、事件和幂等键唯一性并对齐实际数量。默认1000行/64 MiB/30秒，超限或损坏明确未完成，保留原查询/定位/进度；不发送、改租约、确认或修复。CLI `outbox audit` 主程序与嵌入均只读已有文件；详见 [完整队列核验契约](../../docs/design/01-contracts/outbox-audit-runtime.md)。仅源码文档，未编译、类型检查、测试、执行 CLI、打开库或发布。

2026-11-03：新增 readArchive 与 outbox export/inspect-archive，完整保存指定项目已知原列/正文文本、身份/摘要、状态/调度/租约，最多1000行/32 MiB；单次只读 audit 收集全部记录，超限或损坏不截断。独立 outbox-archive 包子路径提供无 SQLite 的文件核验；原事件检查抽取共用，旧算法不变。CLI 关闭库后独占保存新文件并完整读回，失败保留路径/档案摘要/关闭状态；历史租约不授予发送权限，恢复另待补。见 [发送队列档案契约](../../docs/design/01-contracts/outbox-archive-runtime.md)。仅源码文档，未编译、类型检查、测试、执行CLI、打开库或生成样本。


2026-11-03：新增 readSendControl/changeSendControl 和 outbox send-control/pause/resume，按项目持久暂停后续领取，原 generation 比较防止陈旧覆盖；首次显式暂停同事务初始化可选控制表，常规读取/构造不初始化。发送领取每次读取，暂停项目不占跨项目窗口；已领取批次仍可能发送和结算。只读状态有界统计发送中记录，过期/缺令牌或超限不声明发送已停止；提交未知保留原查询和候选generation。旧进程协调、档案恢复与运行证据仍待补。见 [发送控制契约](../../docs/design/01-contracts/outbox-send-control-runtime.md)。仅源码文档，未编译、类型检查、测试、执行CLI、打开库、初始化schema或发布。



2026-11-03：新增 restoreArchive/readRestoreReceipt 与 outbox restore/restore-receipt。完整原档案恢复到已暂停的空项目，绑定原档案摘要/恢复ID/控制generation，预检全库事件和键冲突；未完成行改为failed待处理并清除租约，原正文/身份/摘要/尝试/调度保持。完整原档案、原查询与恢复回执同事务持久保存，全部写入后逐行及整回执读回；重复原请求只返回历史，不覆盖后来变化的队列。回执查询不改当前状态，未知提交保留原请求/候选和关闭信息，不自动resume/retry/发送。见 [受控恢复契约](../../docs/design/01-contracts/outbox-restore-runtime.md)。新增可选本地表仅源码，未编译、类型检查、测试、执行CLI、打开库、初始化schema或发布。

