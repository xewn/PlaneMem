# 应用恢复持久回执

2026-11-03 开发增量，仅源码和文档。未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行扩展/迁移、生成样本或发布。新增独立 SQLite 扩展源码 v1，既有 SQLite 扩展及 PostgreSQL 016–049 仍未执行。关联 ADR-015、T3.4、T4.3、R-005；evidence 为空。

## 显式启用与原请求

`SqliteSyncInbox.enableApplicationRestoreReceipts(trace)` 和 CLI `inbox enable-application-restore-receipts --inbox FILE` 显式启用可选扩展，必须已有 core/application 扩展。单独写事务创建版本表、回执表和不可更新/删除触发器；完整已存在时返回 already-enabled。部分存在、对象种类/所属表、版本、列/类型/主键或必需非空声明不符均拒绝，不自动修复。此检查不声称审计整个库或全部 SQL 约束/触发器定义。

恢复查询新增可选 `restore_request_id`，沿用 sync identifier：非空且 trim 后非空、最多 255 个 JavaScript 字符，禁止 U+0000–U+001F 和未配对代理字符；原字符串不裁剪、不改大小写、不自动生成。完整规范查询仍限 16 KiB，包含解析后的 timeout_ms 和可选 expected_target。无 ID 的旧恢复和预览继续原行为，不要求或读取回执扩展。

带 ID 的恢复和预览必须已有完整回执扩展。预览生成的 restore_query 保留同一 ID，并加入 observed_target；可用既有 `--output` 保存纯 JSON。**实际恢复及回执查询应使用这一份最终保存的查询**，包括其 expected_target、timeout_ms 和请求 ID；预览前尚无 expected_target 的输入是另一份查询。预览本身不占用 ID、不生成回执。

以下仅为接口说明，未执行或生成文件：

```text
workctx inbox enable-application-restore-receipts --inbox local-inbox.sqlite
workctx inbox application-restore-preview --inbox local-inbox.sqlite --archive-file application-history.json --json-file preview-query.json --output bound-restore-query.json
workctx inbox application-restore --inbox local-inbox.sqlite --archive-file application-history.json --json-file bound-restore-query.json
workctx inbox application-restore-receipt --inbox local-inbox.sqlite --json-file bound-restore-query.json
```

preview-query.json 需由调用方显式提供 restore_request_id。已有未带 ID 的查询、过去未登记的恢复不会追溯补造回执。

## 原子登记与重复请求

扩展按 `(consumer_key, application_key, restore_request_id)` 唯一保存。两个 key 沿用规范原身份/应用 JSON 的 SHA-256。request_sha256 是**解析后的完整查询**紧凑 UTF-8 JSON 的 SHA-256，采用解析器固定字段顺序；输入字段排列和省略默认 timeout 不影响结果，实际值变化会影响。当前调用 trace 不属于请求指纹，原恢复 trace 单独保存在回执内。

恢复仍先完整核验归档和嵌套摘要。进入原 BEGIN IMMEDIATE 后，先查回执，再检查目标/写入页面与应用。相同 ID 且完整规范查询相同，返回 status=already-recorded、restore_completed=true 和原 receipt；state=null、current_state=not-read、full_application_history_audit=not-performed、local_write_state=not-performed，不执行恢复或重跑 reducer。local_commit_state=committed 表示此次事务已正常结束，receipt 的 outcome 才是原事务历史结果，不将其计数作为本次新增数量。

相同 ID 对应不同查询时返回 INBOX_APPLICATION_RESTORE_REQUEST_ID_REUSED，附 supplied/recorded_request_sha256。必须保留原查询追查，不静默换 ID、换目标约束或用当前状态代替历史结果。作用域不同的消费者/应用独立使用 ID。

首次恢复沿用完整目标审计、双摘要约束与空应用/完整相同历史政策。在原页面、应用步骤、事件 ledger、应用头写入并审计读回后，同一事务插入回执并完整读回。回执写入、解析、读回、结果体积检查或预算失败均使原事务回滚；提交/回滚无法确认仍保留 unknown 和完整 restore_query。回执不会单独提交，也不会以保存一个错误回执来冒充恢复成功。无变更的 already-restored/empty 也可以登记回执，故不强制外键指向可能不存在的应用或消费者行。

## 回执内容与可信边界

receipt 固定 schema_version=1、kind=application-restore-receipt、完整 query、request_sha256、restore_trace_id、outcome。outcome 只包括原 status（restored/already-restored/empty）、新增接收页/应用页/应用事件计数、结果接收页/应用页/应用事件计数，以及 target_before/target_after；不保存投影正文、归档正文或当前状态。

receipt_json 限 64 KiB，另存 receipt_sha256。读取在 SQL 中限制字节数和类型，最多两行以识别重复；完整 JSON 有界解析后拒绝未知/缺失字段，重建规范 JSON 并比较原字节表示，核验两层 SHA、原身份/应用键/ID、原 trace、计数上界及互相关系、目标约束和新增数量对应的摘要变化。损坏返回 INBOX_APPLICATION_RESTORE_RECEIPT_CORRUPT，不把未校验内容当作历史结果；SQL 存储异常沿用事务错误处理。

回执证明本地记录描述的历史事务，不提供服务器认证、投影语义验证、数据库实例身份或全库物理完整性保证。当前应用/接收链后来可能继续变化；回执查询和重复命中不会审计其当前内容。旧归档恢复、备份替换、复制数据库或人为修改会影响可观察记录，不能把摘要当作签名。

## 只读查询和预览命中

`readApplicationRestoreReceipt(input,trace)` 与 CLI `inbox application-restore-receipt --inbox FILE --json/--json-file QUERY` 要求完整原恢复查询和 ID。CLI 在打开库前严格解析，以 readonly/create:false 打开已有收件箱；不需要 archive-file，不接受 output，不请求网络。一次读事务返回 recorded/receipt 或 not-observed/receipt=null，标记 receipt_scope=historical-local-transaction、current_state=not-read、observation_scope=current-database-read-snapshot、absence_proves_rollback=false。缺记录不是失败回执，不能单凭缺记录认定此前提交失败或自动重试。

带 ID 的预览若命中完全相同回执，仍需先核验传入归档，然后返回 already-recorded、restore_allowed=false、restore_query/planned_changes=null。目标比较字段为 null，target_precondition=not-read，未审计当前历史；使用 --output 时沿用 request_file.state=not-created。不同查询复用 ID 报错。未命中则继续原完整只读比较；预览后其他写入仍可能使实际恢复的目标约束失效。

CLI 保留操作错误、完整原查询和 close_pending；成功后关闭失败也不丢弃完整结果。数据库 timeout_ms 沿用默认 30 秒、上限 90 秒，完整恢复响应仍限 2 MiB、预览响应 512 KiB；回执查询仅返回有界历史回执和原查询。已记录请求的查询预算也是原查询的一部分，不提供静默覆盖。

若已完整读到既有回执，随后预算或事务结束失败，错误 details 仍附 observed_receipt 与历史范围标记；不丢失已观察的原结果，也不把此次事务错误改成成功。首次恢复尚未提交的新回执不作为 observed_receipt 返回，提交未知仍需用原查询重新查回执。

已增补 [按请求 ID 找回原查询](sync-application-restore-receipt-selection-runtime.md)：getApplicationRestoreReceipt/CLI application-restore-receipt-get 只需原身份/应用/请求 ID，可单独指定本次读取预算，并可独占保存原查询文件。此发现入口不比较调用方的完整原请求；上文精确核对入口和重复恢复规则保持不变。

已增补 [恢复回执目录](sync-application-restore-receipt-catalog-runtime.md)，可按原消费者/应用分页发现请求 ID，再使用 get 找回原查询。列表只反映各次读取快照，ID 顺序不表示恢复时间。

仍缺回执独立文件导出/离线查看、跨应用回执发现、数据库实例绑定、不同历史合并、完整跨设备恢复及并发/崩溃运行证据。本增量仅人工审阅源码，R-005 保持未完成。
