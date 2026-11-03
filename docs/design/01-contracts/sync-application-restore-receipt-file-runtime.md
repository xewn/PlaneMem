# 应用恢复回执文件与离线原查询提取

2026-11-03 开发增量，仅源码和文档。未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行扩展/迁移、生成样本或发布。无新 schema/依赖，既有 SQLite 扩展及 PostgreSQL 016–049 未执行。关联 ADR-015、T0.5、T3.4、T4.3、R-005，evidence 为空。

## 文件契约与既有数据兼容

共享契约新增 `SyncApplicationRestoreReceiptFile={document,document_sha256}`。document 固定 schema_version=1、kind=workctx.sync-application-restore-receipt 和完整 receipt；receipt 沿用既有持久回执 schema_version=1/kind=application-restore-receipt，包含原 query、request_sha256、restore_trace_id、outcome。文件不附加本次查询/导出 trace、当前读取期限、文件路径、当前投影或新的“已恢复”声明。

原查询、目标约束及回执的结构解析抽取到 contracts，Bridge 委托共享解析并继续独立核验请求 SHA 和数据库行的规范 JSON/回执 SHA。查询规范字段顺序仍为 expected_identity、application、timeout_ms、archive_document_sha256、可选 restore_request_id、可选 expected_target；回执和 outcome 的原顺序也保留。没有重新排序、换摘要算法、改表、迁移或回写旧记录。有效字段、默认期限和可选字段存在性保留，源码人工对照不等于已有数据库已运行验证。

共享结构解析核对完整字段、原身份/应用/ID、原 trace、计数上界及关系、目标约束和历史变化关系。结构解析器本身不调用平台加密接口，调用方必须核验摘要；Bridge/CLI 均自行计算 SHA-256。CLI 文件适配层核验两层：document_sha256 对应完整规范文档 UTF-8 JSON，receipt.request_sha256 对应完整规范原查询 UTF-8 JSON。只重算外层摘要不能掩盖未同步修改的内层原查询摘要；两层摘要都不是签名或来源认证。

完整查询最多 16 KiB，内嵌回执最多 64 KiB，文档最多 65 KiB，文件最多 66 KiB。读取要求稳定普通文件、有界完整读取、严格 UTF-8 解码，允许开头 BOM；拒绝未知/缺失字段、错误版本/种类、畸形计数/目标关系和任一摘要不符。actual file_sha256 单独表示实际文件字节，不与规范 document_sha256 混淆。

## 从数据库显式导出

已有 `inbox application-restore-receipt-get` 新增 `--receipt-output NEW_FILE`，与保存纯原查询的 `--output NEW_QUERY` 互斥。其他命令拒绝 receipt-output。仍按[原身份/应用/请求 ID 选择](sync-application-restore-receipt-selection-runtime.md)只读取得历史回执，本次读取 timeout_ms 不写入文件，也不替换原 query.timeout_ms。

输出目录/新目标在打开数据库前预检，已有文件/链接拒绝，不创建目录。读取事务正常结束并尝试关闭连接后才保存；失败读取不会保存错误回执。无记录正常返回 receipt_file={state:not-created,path,reason:receipt-not-observed}，不创建临时/最终文件，不将缺记录解释为此前回滚。

有回执时重新执行共享结构及两层 SHA 校验，固定紧凑 UTF-8 文件字节，使用既有独占临时文件、分块写入、同步、临时读回和硬链接发布。最终路径再次完整读取、解析、核验两层摘要，比较实际文件大小/SHA 及规范文档一致性。成功返回 receipt_file 的 saved 状态、format、document_sha256、file_bytes/file_sha256、路径和清理状态。完整原回执、原查询及 close_pending 继续保留。

发布后最终读回失败保留 published-unconfirmed、最终路径、预期摘要/大小及可能遗留的临时路径，不删除目标或自动换路径。保存失败保留历史回执、原查询、原选择、文件阶段和关闭状态。添加文件元数据前后均检查完整 CLI 响应的 256 KiB 限额；文件已经保存而后续响应过大时，错误仍保留 receipt_file 的已保存状态，不改称未保存。

## 离线查看与提取

新增 `inbox application-restore-receipt-inspect --receipt-file FILE` 完整核验并显示回执及原查询。新增 `inbox application-restore-receipt-query --receipt-file FILE --output NEW_QUERY` 在相同完整核验后将原 query 单独保存为既有纯查询 JSON。两个分支不执行 Bridge 的动态加载、不打开数据库、不请求网络；拒绝 inbox、JSON、归档、receipt-output、重复参数和 stdin。inspect 不接受 output；query 必须指定新 output。

提取前预检输出路径，因此不能覆盖输入回执文件或任何现有文件。保存仍复用[原查询文件保存](sync-application-restore-request-runtime.md)的 16 KiB 编码、不覆盖发布和最终字节核对。保留原身份/应用/归档摘要/请求 ID/期限以及 expected_target 是否存在；不按当前环境补造目标或改写原查询。文件读取/提取失败不执行后续恢复。响应超限前后处理同样保留已保存文件状态。

离线响应明确 receipt_scope=historical-file-content、provenance=local-file-not-authenticated、current_state=not-read、database_receipt_presence=not-checked、file_verification=document-and-query-sha256，以及未审计应用历史/未验证投影语义/未发送确认。local_write_state=not-performed 指未写数据库，独立文件结果由 request_file 表示。顶层 trace 是本次查看/提取调用，receipt.restore_trace_id 保持历史原值。

以下仅为接口说明，未执行或生成文件：

```text
workctx inbox application-restore-receipt-get --inbox local-inbox.sqlite --json-file receipt-selection.json --receipt-output restore-receipt.json
workctx inbox application-restore-receipt-inspect --receipt-file restore-receipt.json
workctx inbox application-restore-receipt-query --receipt-file restore-receipt.json --output recovered-restore-query.json
```

只有相应文件状态为 saved 时，才有已确认保存的文件供后续使用。提取结果可以交给既有 application-restore-receipt 的 --json-file 核对某个当前数据库；回执文件自身不证明该数据库仍含此记录。文件中没有原归档正文，不能独立重建应用投影。

## 错误与未完成范围

文件不可读/格式不合法使用 INBOX_APPLICATION_RESTORE_RECEIPT_FILE_UNAVAILABLE/FILE_INVALID；导出预检/保存/发布后读回失败使用 RECEIPT_OUTPUT_UNAVAILABLE/RECEIPT_SAVE_FAILED/RECEIPT_FILE_READBACK_FAILED，均以 INBOX_APPLICATION_RESTORE_ 开头。离线响应过大为 RECEIPT_FILE_TOO_LARGE；原查询提取继续保留 REQUEST_* 类别。文件错误保留输入/输出路径、已校验历史结果及独立文件状态；关闭失败不抹去已取得回执。

文件保存不受数据库读取期限约束，保留既有硬链接文件系统支持要求，不新增硬实时或断电目录持久性保证。文件可以被复制或自行构造，摘要只验证自洽性；没有回执导入/结算、来源认证、数据库实例绑定、跨应用回执发现、不同历史合并或完整数据库备份。真实崩溃/并发/跨设备恢复证据仍缺，R-005 保持未完成。
