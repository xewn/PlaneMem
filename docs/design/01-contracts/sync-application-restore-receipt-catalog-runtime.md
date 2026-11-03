# 应用恢复回执目录

2026-11-03 开发增量，仅源码和文档。未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行扩展/迁移、生成样本或发布。无新 schema/依赖；既有 SQLite 扩展和 PostgreSQL 016–049 仍未执行。关联 ADR-015、T3.4、T4.3、R-005；evidence 为空。

## 按原范围发现请求 ID

新增 Bridge `listApplicationRestoreReceipts(input,trace)`、解析器 `parseInboxApplicationRestoreReceiptCatalogQuery` 和 CLI `inbox application-restore-receipt-list`。调用方知道完整原消费者身份和应用，但忘记请求 ID 时，可分页查看本地历史回执摘要，再用条目给出的查询找回[完整原请求](sync-application-restore-receipt-selection-runtime.md)。

查询最多 16 KiB，只接受完整原 expected_identity、application={name,version} 和以下可选字段：

| 字段 | 规则 |
| --- | --- |
| limit | 默认 20，安全整数 1–50 |
| after_request_id | 排他下界，沿用 sync identifier 规则；省略时从首条读取 |
| timeout_ms | 本次读取预算，默认 30000，安全整数 1–90000 |

不接受归档摘要、目标约束、单个 restore_request_id、当前账号替代身份或未知字段。CLI 要求 --inbox 及 --json/--json-file 二选一；不接受 --output、归档/页面文件、key、独立 timeout 开关、stdin 或重复选项。严格查询解析在打开库前完成。主程序和嵌入入口共用同一解析和读取流程。

## 页内完整校验

以 readonly/create:false 打开已有库，要求完整 core/application/receipt 扩展。单次读事务按消费者键、应用键和请求 ID 的 BINARY 升序读取至多 limit+1 个 ID。首笔查询没有人为的空字符串下界，选中无效空/null ID 必须报错；SQL 先限制 ID 类型与字节数，再进行标识符校验。应用侧按 UTF-8 字节核对严格递增，避免 JavaScript UTF-16 字符串顺序与 Unicode 请求 ID 排序不一致。

逐条读取完整回执，复用原有 64 KiB 限制、规范 JSON、回执/请求 SHA、原身份/应用/ID 绑定、完整原查询、原 trace、计数及目标关系校验。额外一条前瞻记录也完整验证后，才能返回 has_more=true。选中记录损坏、缺失或次序异常不会跳过，不返回局部成功页。所有读取在同一个事务内，不把多个快照拼成一页。

成功返回条目最多 50 个，完整验证的回执最多 51 个。每个回执正文独立限 64 KiB；不扫描或统计整个目录。selected_receipt_bytes 是本次完整校验的规范回执 JSON 字节数，包含前瞻，不是物理 IO 或进程峰值内存统计。checked_receipts 同样包含前瞻。catalog_coverage=selected-page-and-lookahead，不声称全目录、当前应用历史、接收链或物理库已审计。

## 摘要与继续读取

每个条目返回 restore_request_id、完整原请求的 request_sha256、archive_document_sha256、restore_trace_id、target_bound、原 outcome，以及 receipt_get_query。outcome 是原恢复的历史状态/计数/目标前后摘要，不是本次新增数量或当前投影。target_bound 只说明原查询是否包含 expected_target，不说明它仍与当前目标匹配。

receipt_get_query 包含完整原身份、应用、请求 ID 和本次目录读取的 timeout_ms，可直接用于 application-restore-receipt-get。该读取预算不覆盖历史回执中保存的原请求期限。条目不输出完整原恢复查询、归档正文或投影；完整原查询仍从 get 的已校验回执中找回。

页结果包含 catalog_completed=true、items、limit、after_request_id（首笔为 null）、has_more 和 next_query。若有后续记录，next_query 保留本次原身份、应用、limit、timeout_ms，并以最后一条**已返回**条目的 ID 作为 after_request_id；不能用未返回的前瞻 ID 跳页。无后续记录时 next_query=null。空目录正常返回空 items 和 has_more=false，不从记录缺失推断此前未知提交已回滚。

以下仅说明接口，未执行或生成查询文件：

```text
workctx inbox application-restore-receipt-list --inbox local-inbox.sqlite --json-file receipt-catalog-query.json
workctx inbox application-restore-receipt-get --inbox local-inbox.sqlite --json-file selected-receipt-get-query.json --output recovered-restore-query.json
```

第二步的选择内容来自某条 receipt_get_query；继续翻页则使用整份 next_query，不将历史原请求当作目录查询。命令不自动翻页、保存查询、执行恢复或发送确认。

## 一致性和失败

返回 order=request-id-binary-ascending、consistency=keyset-current-state、receipt_scope=historical-local-transaction、current_state=not-read、full_application_history_audit=not-performed、absence_proves_rollback=false 和 local_write_state=not-performed。请求 ID 可由调用方任意选择，排序不表示提交时间，不提供“最新恢复”保证。

每次命令各自取得读取快照，不冻结跨页成员，没有最大序号/固定上界。页间新增的 ID 若位于已越过的边界之前，不会出现在后续页；位于边界之后则可能出现。库被替换、还原或外部改动同样可能改变页间观察。after_request_id 是位置，不要求该 ID 当前仍存在；next_query 不是签名授权或实例绑定凭据。需要新一轮发现时应从首笔查询重新读取，不能用分页结果宣称完整跨时点审计。

无效查询、目录键/次序异常和响应超限分别使用 INBOX_APPLICATION_RESTORE_RECEIPT_CATALOG_QUERY_INVALID、CATALOG_CORRUPT、CATALOG_TOO_LARGE（后两者同前缀）。完整回执损坏、缺扩展、超时和存储错误保持原错误类别。Bridge 完整响应限 512 KiB，CLI 加入路径/关闭状态后再次检查同一上限；多条长标识符、原 trace 或重复作用域使响应超限时，明确失败并提示减少 limit，不静默截断。

失败保留 catalog_query、catalog_completed=false、不写入标记和关闭状态。若读取已完成，仅 CLI 最终响应超限，保留 catalog_completed=true、response_completed=false 和 close_pending，仍不返回不完整续页。数据库读取期限不覆盖模块加载、打开/关闭连接，不能硬实时中断同步 SQL/磁盘等待。来源不认证，既有回执不证明当前业务状态。

仍缺回执完整文件导出/离线查看、跨应用回执发现、数据库实例绑定、不同历史合并、完整跨设备恢复及并发/崩溃运行证据。本次仅开发并人工审阅源码，R-005 保持未完成。
