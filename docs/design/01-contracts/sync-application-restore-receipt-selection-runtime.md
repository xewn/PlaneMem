# 按请求 ID 找回应用恢复原查询

2026-11-03 开发增量，仅源码和文档。未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行扩展/迁移、生成样本或发布。无新 schema/依赖；既有 SQLite 扩展和 PostgreSQL 016–049 仍未执行。关联 ADR-015、T3.4、T4.3、R-005；evidence 为空。

## 选择已有回执

新增 Bridge `getApplicationRestoreReceipt(input,trace)`、严格解析器 `parseInboxApplicationRestoreReceiptSelection` 及 CLI `inbox application-restore-receipt-get`。当原查询文件遗失、仍有原身份/应用/请求 ID 时，可找回[持久回执](sync-application-restore-receipt-runtime.md)及其完整原查询；不从当前目标重新构造历史请求。

选择 JSON 只接受以下字段，整体最多 16 KiB：

| 字段 | 规则 |
| --- | --- |
| expected_identity | 完整原 tenant_id/workspace_id/project_id/actor_id/client_id |
| application | 完整原 name/version |
| restore_request_id | 原请求 ID，沿用既有 sync identifier 规则，不裁剪、不转换 |
| timeout_ms | 可选，本次读取预算；默认 30000，安全整数 1–90000 |

选择不接受 archive_document_sha256、expected_target、请求摘要或未知字段，防止将一次发现误解为完整原请求比对。本次 timeout_ms 仅控制当前读取事务，不属于所找回请求，也不会覆盖回执中保存的原 timeout_ms。相同 ID 在不同原消费者/应用范围内仍独立。

CLI 需要 `--inbox` 及 `--json/--json-file` 二选一，可选 `--output NEW_QUERY`；拒绝 archive-file、page-file、key、独立 timeout 开关、stdin、重复选项和其他命令参数。主程序与嵌入入口共用相同流程。严格查询解析在 readonly/create:false 打开已有库之前完成，必须已有完整 core/application/receipt 扩展，不隐式启用、修复或创建库。

## 读取结果与精确核对

单次读事务按原消费者键、应用键和 ID 精确取回记录，复用已有完整校验：SQL 类型/字节限制、最多两行、规范 receipt_json、回执/请求 SHA、原身份/应用/ID 绑定、完整查询、原 trace、计数及目标关系。原 `readApplicationRestoreReceipt` 以及恢复/预览继续在此完整校验后比对完整原查询，保留 ID 复用错误；本增量不放宽那些入口。

成功返回 selection（本次选择）、receipt_lookup_completed=true、status=recorded、完整 receipt 和其原 restore_query。没有记录返回 not-observed、receipt/restore_query=null。两者均有 query_match=not-requested、receipt_scope=historical-local-transaction、current_state=not-read、full_application_history_audit=not-performed、observation_scope=current-database-read-snapshot、absence_proves_rollback=false 和 local_write_state=not-performed。只说明当前库中观察到的本地历史记录，不推断服务器结果、当前可恢复性或此前未知提交已回滚。

此接口用于发现原请求。若需要检查手中某份请求是否与记录完全相同，继续使用已有 `application-restore-receipt`；不能把只按 ID 找到记录当作任意请求内容已匹配。库可能已被复制、替换或恢复，回执没有实例身份或来源签名，也不替代当前历史审计。

## 保存找回的原查询

指定 output 时，打开数据库前预检已有目录和新目标路径；已有文件/链接拒绝，不创建目录。即使最终没有回执，无效输出路径也先报错。完成读事务并尝试关闭连接后，先检查完整 CLI 响应的 256 KiB 上限，再处理保存。

有记录时再次严格解析原 restore_query，核对其完整原身份、应用、请求 ID、与 receipt.query 的规范 JSON 一致性，以及 SHA-256 与 receipt.request_sha256 相等。保留原 archive_document_sha256、timeout_ms、restore_request_id 和 expected_target 的值及是否存在；旧的无目标约束请求不补造约束，也不读取当前目标重绑定。

复用[原查询文件保存](sync-application-restore-request-runtime.md)实现：紧凑 UTF-8 JSON、最多 16 KiB、无 BOM/额外换行，同目录独占临时文件、同步及读回、不覆盖硬链接发布、最终有界字节/摘要核对。文件是原恢复查询而非新的回执文件格式；可直接给已有 --json-file 使用。固定原字节使成功 file_sha256 与 receipt.request_sha256 一致。保存成功不执行恢复，也不生成新预览计划。

无记录时返回 request_file={state:not-created,path,reason:receipt-not-observed}，不创建临时或最终文件。未指定 output 时不增加 request_file，也不写文件。已记录结果不会因为此查找或保存被修改、删除或重新登记。

以下仅是接口说明，未执行或生成文件：

```text
workctx inbox application-restore-receipt-get --inbox local-inbox.sqlite --json-file receipt-selection.json --output recovered-restore-query.json
workctx inbox application-restore-receipt --inbox local-inbox.sqlite --json-file recovered-restore-query.json
```

仅第一步返回 request_file.state=saved 时，第二步才有已确认保存的文件可用。第二步使用找回的原查询及原 timeout_ms；它只读核对回执，不执行恢复。

## 错误保留与边界

无效选择为 INBOX_APPLICATION_RESTORE_RECEIPT_SELECTION_INVALID；缺扩展、损坏回执和存储错误沿用原类别。Bridge/CLI 返回过大为 INBOX_APPLICATION_RESTORE_RECEIPT_GET_TOO_LARGE。查询失败保留原 selection 和不完整状态；完整读到既有记录后事务结束/预算失败仍保留 observed_receipt。CLI 关闭失败保留原错误或结果及 close_pending，不在失败查询后保存文件。

文件预检/保存/读回沿用 REQUEST_OUTPUT_UNAVAILABLE、REQUEST_SAVE_FAILED、REQUEST_READBACK_FAILED 等既有错误，均使用 INBOX_APPLICATION_RESTORE_ 前缀。错误同时保留 receipt_lookup_completed=true、完整历史回执、原查询、输出/可能的临时路径以及关闭/清理状态。发布但最终读回失败保留 published-unconfirmed，不删除目标或自动换路径。保存后加入 request_file 再检查 256 KiB 响应限额，超限保留已经确认的文件状态，不冒充未保存。

若请求 ID 也已遗失，可先使用 [恢复回执目录](sync-application-restore-receipt-catalog-runtime.md)，按完整原消费者/应用分页发现 ID 和 receipt_get_query；不需要猜测原请求内容。

当前数据库读取预算不覆盖输出预检、库打开、文件写入/发布/最终读回；同步 SQL 等待仍没有硬实时保证。仍缺回执完整独立文件导出/离线查看、跨应用回执发现、数据库实例绑定、不同历史合并和真实故障/跨设备运行证据。本次只开发并人工审阅源码，R-005 保持未完成。
