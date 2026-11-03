# 应用恢复预览的原请求文件保存

2026-11-03 回执增补：恢复查询现可显式携带 restore_request_id，最终预览查询及保存文件保留同一 ID。需先显式启用可选扩展；相同完整查询命中已登记回执时仅返回历史结果，不检查当前目标或生成新计划。完整原查询可独立只读查询回执，缺记录不推断回滚。下文目标比较/首次恢复流程适用于未命中回执的请求，详见 [持久回执契约](sync-application-restore-receipt-runtime.md)。仅源码，扩展未执行。

2026-11-03 开发增量，仅源码和文档；未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行 schema/迁移、生成样本文件或发布。无新 schema/依赖，既有 SQLite 扩展和 PostgreSQL 016–049 未执行。关联 ADR-015、T4.3、R-005，运行证据为空。

## 显式保存与后续恢复

CLI `inbox application-restore-preview` 新增可选 `--output NEW_FILE`。完整只读预览允许恢复时，保存其带 [expected_target](sync-application-restore-target-runtime.md) 的 restore_query；保存操作不执行恢复。以下示例仅说明接口，未执行或创建文件：

```text
workctx inbox application-restore-preview --inbox local-inbox.sqlite --archive-file application-history.json --json-file preview-query.json --output bound-restore-query.json
workctx inbox application-restore --inbox local-inbox.sqlite --archive-file application-history.json --json-file bound-restore-query.json
```

只有首个命令返回 request_file.state=saved 时，才有已确认保存的请求文件可供后续使用。命令参数仍要求 inbox、archive-file 和 json/json-file 二选一；实际 application-restore 继续拒绝 output。原归档导出仍用 output 保存归档，离线 inspect/archive-get 仍拒绝 output。主程序与嵌入入口共享同一参数解析与文件流程。

文件就是既有严格恢复查询 JSON，不新增外层封装、schema 或 sidecar。包含规范原 expected_identity、application、archive_document_sha256、已解析的 timeout_ms 和完整 expected_target v1；不加入路径、当前 trace、预览结果或归档正文。采用紧凑 UTF-8，无 BOM/额外换行，最多 16 KiB，可直接由已有 --json-file 读取，不需提取内层字段。

## 保存顺序与冲突

解析原查询后、打开数据库前预检输出：目录必须存在且可解析，目标须为新文件，已有普通文件/链接均拒绝，不创建目录。预检没有写入或预留输出；稍后若目标被占用，最终独占发布仍会失败而不覆盖。指向现有查询、归档或数据库文件的输出同样拒绝。

完成归档核验和只读目标比较，结束读取事务并尝试关闭数据库后，先检查原完整 CLI 响应的 512 KiB 限额。只有 restore_allowed=true 时才处理文件；再次严格解析 restore_query，并与原输入身份/应用/归档摘要/timeout_ms 加本次 observed_target 精确比较，必须保留完整目标约束。不会静默替换旧约束、选用另一归档或把无约束查询写入文件。

合法 conflict 仍返回完整预览和退出码 0；data.request_file={state:not-created,path,reason:restore-not-allowed}，不创建临时或最终文件。无 output 时返回原预览结果，不增加 request_file。文件预检失败会先于数据库预览失败，不因为目标可能冲突而忽略无效输出路径。

## 独占发布与读回

有效查询在第一次文件等待前固定为字节数组，并计算实际文件 SHA-256。复用现有 saveArtifactOutput：同目录独占临时文件、分块写入、文件同步、临时文件读回核对，然后用独占硬链接发布；不提供覆盖或复制降级。只清理自身临时文件，失败不删除用户的最终目标。

发布后再次有界读取最终路径，检查稳定普通文件、完整字节数、SHA-256 和逐字节相等。因为写入字节来自严格解析和原输入绑定后的查询，最终字节相等也确认保存内容仍是同一查询；不会重新序列化一个不同的请求。文件系统需要支持现有硬链接发布策略；本增量不增加恶意并发路径替换或断电后的目录持久性保证。

成功在 data.request_file 返回 state=saved、path、content_state=verified、file_bytes/file_sha256、format=application-restore-query-json、verification=exact-final-file-bytes，以及 cleanup_pending/可能遗留的 temporary_path。完整预览与 restore_query 仍保留，顶层 close_pending 仍表示数据库关闭状态。Bridge 的 local_write_state=not-performed 指收件箱数据没有写入，独立文件保存状态由 request_file 表示。

文件和摘要不签名、不认证来源；后续 --json-file 使用其中实际内容，不自动将此次返回的 file_sha256 作为额外输入条件。目标双摘要会在实际恢复自己的写事务内核对；保存期间或以后目标变化仍可导致 TARGET_CHANGED，文件保存成功不代表恢复已执行或一定能成功。

## 失败与限额

输出预检失败为 INBOX_APPLICATION_RESTORE_REQUEST_OUTPUT_UNAVAILABLE；无法表示/绑定查询为 REQUEST_INVALID（解析器自身错误保留）；文件保存失败为 REQUEST_SAVE_FAILED；最终读回无法确认为 REQUEST_READBACK_FAILED，均使用 INBOX_APPLICATION_RESTORE_ 前缀。文件错误保留原 restore_query、原选择、输出/可能的临时路径、清理状态和 close_pending。

临时写入/同步/发布失败沿用 local_state=not-saved 及 save_phase，不把未发布临时文件当作成功。最终路径已发布但读回失败则标记 local_state=published-unconfirmed，保留预期 file_bytes/file_sha256 和目标供检查，不删除它或自动换路径重试。文件阶段失败保留 preview_completed=true，说明目标比较已完成，不表示请求文件已保存。

加入 request_file 后再次检查完整响应的 512 KiB 限额。若文件已保存但最终响应超限，INBOX_APPLICATION_RESTORE_PREVIEW_TOO_LARGE 保留 request_file 的已确认状态、原 restore_query、preview_completed=true 和 response_completed=false；不能将已保存文件改称未保存，也不删除最终文件。关闭失败不会丢失已完成预览或保存结果。

数据库 timeout_ms 不覆盖输出预检、文件发布或最终读回。查询 16 KiB、完整预览响应 512 KiB，以及原归档/目标审计预算保持不变；文件操作沿用现有系统等待行为，不新增硬实时期限。

仍缺完整预览报告/恢复结果的独立归档、回执独立文件导出、数据库实例绑定、不同历史合并及跨设备/并发/故障运行证据。保存的查询不是恢复回执；上一笔未知提交仍需保留原约束与原错误，不从文件存在或后续目标变化推断提交结果。本次仅开发和人工审阅源码，R-005 继续未完成，evidence 为空。
