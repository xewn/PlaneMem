# 原事件回执独立文件（开发契约）

2026-11-03：仅源码和文档，未编译、类型检查、测试、运行 CLI/SDK/API、生成样本文件、打开数据库、执行迁移或发布。无新依赖/schema/迁移，既有 SQLite 升级和 PostgreSQL 016–049 仍未执行，R-005 未完成。

## 文件内容

共享 `SyncEventReceiptDocument` v1 为 `{schema_version:1,kind:'workctx.sync-event-receipt',receipt}`；文件 `SyncEventReceiptFile` 为 `{document,document_sha256}`。receipt 是既有完整 `SyncEventReceiptEnvelope`，保留原五字段 identity、完整上传 event、查询 trace、来源引用和 recorded/not-observed。recorded 的原投递 trace、服务端事件/游标、冲突和记录时间仍通过原契约完整校验。

文件不保存独立的本地队列状态、提交结果、发送租约或本地幂等键列。本次结算结果继续从原核对输出读取，完整本地行仍在原队列；原 event 自带的附加字段按既有回执契约保留。文件不能证明原事件已应用、当前冲突已解决或当前服务端状态，not-observed 也不证明投递失败。离线解析只是文件内部一致性检查，摘要不是服务器签名。可以修改整份文件及摘要的人也能伪造内容。

回执仍限 2 MiB，包装文档上限为 2 MiB + 4096 字节，文件再留 4096 字节；完整结构使用既有有限 JSON 规则（100000 个节点、64 层）。共享解析器拒绝未知包装字段、缺失/不匹配的回执字段、错误版本和非法摘要，返回独立副本。`syncEventReceiptDocumentJson` 是完整解析后按确定的字段构造顺序输出的紧凑 JSON；事件内对象键顺序保留，摘要不承诺对任意键重排不变。SHA-256 对此字符串的 UTF-8 字节计算。共享文件解析只校验摘要格式，CLI 适配独立重算并比对文档摘要。

## 明确保存本次回执

示例仅展示用法，未执行：

```text
workctx outbox reconcile ORIGINAL_EVENT_ID --outbox existing.sqlite --result-output new-receipt.json
workctx outbox inspect-result --result-file new-receipt.json
```

`--result-output` 是原 [outbox reconcile](outbox-reconciliation-runtime.md) 的可选输出，不改变原身份、回执查询、行比较、结算、期限或无自动重试规则。路径须为已有目录中的新目标；不接受 stdin、空路径、重复选项或覆盖已有文件/链接。打开队列前先预检路径，预检失败不进入核对。预检不保留目标文件名，后续同名创建仍可能导致保存失败。

CLI 在核对结束并尝试关闭库之后执行文件保存，不把文件 I/O 放入 SQLite 事务或回执等待预算。核对成功时保存 result.receipt；核对失败时仅使用 Bridge `details.reconciliation.receipt` 中已经完整验证的回执，不从远端原始错误正文、未验证对象或迟到 reader 响应中提取。保存前再次解析并核对本次查询 trace。没有完整验证回执时不造空文件，配置了输出则报告 `result_file={state:'not-written',path,reason:'no-validated-receipt'}`。

保存复用独占临时文件、文件同步和内容读回、独占硬链接发布，无覆盖/复制替代。最终路径再有界读取，核对实际文件字节数、SHA-256、完整解析后的文档与文档摘要；失败保留输出路径/可能遗留临时路径及清理状态，最终目标不被清理删除。文件系统须支持现有硬链接策略；不提供抵抗恶意并发目录/路径替换或断电持久性的保证。

| 核对及文件结果 | CLI 输出 |
|---|---|
| 核对成功、文件保存并读回成功 | 原成功数据加 data.result_file，含 saved、path、两层摘要、字节数及 cleanup_pending；recorded 退出 0，not-observed 仍退出 1 |
| 核对成功、保存或最终读回失败 | OUTBOX_RECEIPT_RESULT_SAVE_FAILED，退出 1；details.completed_reconciliation 保留完整 `{receipt,local}`，另带 scope/result_file/适用 close_pending |
| 核对失败、完整回执可保存 | 原错误码和 details.reconciliation 保留，补 result_file=saved；仍退出 1，不把本地未知改成成功 |
| 核对失败、保存也失败 | 原核对错误码保持，完整回执及本地提交状态不变，result_file=save-failed 附独立文件错误/路径 |
| 核对失败、没有已验证回执 | 原错误加 result_file=not-written，不发布文件 |

result_file 的 save-failed 不一定表示文件不存在；已发布但读回无法确认时 local_state=published-unconfirmed，须保留检查。close_pending 只描述连接清理，不覆盖已知提交结果或文件结果。没有 --result-output 时保持原核对输出行为。进程中断、掉电或输出失败可能发生在结算与文件保存之间，这两步不是跨数据库/文件原子事务。

## 离线检查

`outbox inspect-result` 只接受一个 `--result-file`，拒绝其他/重复选项及 stdin。网络主程序在令牌/环境项目读取和 Bridge 动态加载前分流；嵌入入口同样不调用 router。该模块没有 Bridge 运行时依赖，不创建或打开 SQLite，也不查询服务端。

读取正规文件的完整有界字节、拒绝读取期间可观察变化，以严格 UTF-8 解析（兼容 BOM），完整复用回执契约并独立核对文档摘要；不修复、截断或跳过错误字段。成功返回当前检查 trace、原身份范围、完整历史 receipt 和文件元数据；保留 receipt 原查询 trace，不替换为检查 trace。标注 provenance=local-capture-not-authenticated、current_server_state=not-queried、local_queue_state=not-read、event_application=not-verified。退出 0 仅表示文件可读取且结构/摘要一致。

读取失败为 OUTBOX_RECEIPT_FILE_UNAVAILABLE，内容/摘要不符为 OUTBOX_RECEIPT_FILE_INVALID；用法错误退出 2，其他失败退出 1。输入文件不改写。该命令不恢复本地队列、不导入结算、不准备新事件、不换键或自动重发；跨设备队列备份、旧行原身份恢复和真实运行证据仍待补充。
2026-11-03 Web 文件互通：`/sync/receipt` 可以离线载入同一 v1 文件，完整核验原封套/摘要后将其中原 identity/event 固定为后续显式查询输入；导入结果单独标历史，不充当本次服务器确认。新查得的完整回执也可准备为同格式下载，浏览器下载不证明保存完成。见 [工作台回执契约](sync-web-receipt-runtime.md)；未执行导入、查询或生成实际文件。

## SDK 离线字节接口

`@planemem/sdk` 根和独立 `@planemem/sdk/sync-event-receipt-file` 子路径新增 prepareSyncEventReceiptFile / inspectSyncEventReceiptFile。独立模块只依赖既有契约和预算，不导入 WcpClient/transport、文件系统、Bridge、数据库或凭据，也没有副作用初始化。现有 CLI 的稳定正规文件读取/独占保存策略以及 Web IndexedDB 行为保持独立；没有共享格式或网络协议变化。

prepare 接受完整 SyncEventReceiptEnvelope 和必需本地 `trace_id`，完整解析成副本后异步计算规范文档摘要，构造文件，再计算实际紧凑 UTF-8 文件字节摘要。返回 prepared-not-saved、完整 file、独立 query、bytes、file_bytes、file_sha256。本地 trace 不替换 file.document.receipt.trace_id；输入不修改，输出 query 也不别名文件中的原事件。调用方自行保存和最终读回，SDK 不声称落盘、持久完成或原投递状态改变。

inspect 接受完整 JSON string 或 Uint8Array，复制/严格 UTF-8 解码/完整解析在首次异步摘要等待前完成。兼容 UTF-8 BOM；文本拒绝未配对 UTF-16 代理字符，不在编码时静默替换。Uint8Array 只接受 ArrayBuffer 后端，拒绝无法保证一致快照的 SharedArrayBuffer，Node Buffer 作为普通字节视图复制。字符数和实际字节数均有文件上限；严格共享文档/回执解析后独立重算 document_sha256，再核对可选 expected_document_sha256 及完整 expected_query。原事件等价判断沿用共享回执解析规则，摘要仍绑定原规范文档的实际键序。

inspect 成功返回 inspected-historical、完整 file、独立原 query、输入类型、file_bytes/file_sha256。文件摘要覆盖实际输入字节（包含 BOM/空白），不会改成重新序列化字节的摘要；文档摘要覆盖共享规范文档，两者用途不同。expected_query/摘要不是新的授权，未指定时仅检查输入内部一致性；输出 query 供调用方后续显式查询，不自动请求服务器、上传、确认或导入队列结算。

选项只接受普通数据属性对象（trace_id、timeout_ms、signal，以及 inspect 的两个可选绑定），不读取未知字段/accessor/symbol。trace 必须非空且不含控制字符/未配对代理，最长 1024 字符；超时默认 30000、允许 1–90000 毫秒。复用单调 RequestBudget 管理等待及取消，digest 通过预算等待，完整输出前再次检查；无法取消的底层摘要迟到后只被丢弃。预算不抢占同步解析，选项形状校验发生在预算建立前；内存接口也不能限制调用方先前读入文件的成本。

内容/大小/UTF-8/结构错误为 SYNC_RECEIPT_FILE_INVALID，文档摘要不符为 SYNC_RECEIPT_FILE_DIGEST_MISMATCH，指定原查询/摘要不符为 SYNC_RECEIPT_FILE_BINDING_MISMATCH，SHA-256 不可用或失败为 SYNC_RECEIPT_FILE_INTEGRITY_UNAVAILABLE。参数/约束非法为 INVALID_INPUT，取消/超时映射成文件专用 CANCELED/TIMEOUT，不使用暗示已访问 Gateway 的消息。固定错误只携带本地 trace/retryable=false/操作种类/未访问文件系统和服务器标记；保留输入在调用方，不回显原文/底层错误。

全部结果标注 provenance=local-capture-not-authenticated、current_server_state=not-queried、local_queue_state=not-read、event_application=not-verified、filesystem_access=not-performed。摘要不是签名，任何可以改写整份文档和摘要的人都可以伪造历史，检查通过不允许离线权威提升。该增量未提供 SDK 持久存储、MCP 文件工具或真实兼容证据；无依赖/schema/迁移变化，未编译、类型检查、测试、执行 SDK/CLI/Web 或生成样本文件。
