# 应用恢复预览的目标历史绑定

2026-11-03 开发增量，仅源码和文档；未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行 schema/迁移、生成样本或发布。无新 schema/依赖，既有 SQLite 扩展和 PostgreSQL 016–049 未执行。关联 ADR-015、T3.4/T4.3、R-005，运行证据为空。

## 可选目标约束

[应用恢复](sync-application-restore-runtime.md)和[只读恢复预览](sync-application-restore-preview-runtime.md)共用的查询新增可选 expected_target。必须是以下三个字段组成的完整对象；null、缺字段、额外字段、未知版本或非 64 位小写十六进制摘要均报 INBOX_APPLICATION_RESTORE_QUERY_INVALID：

| 字段 | 含义 |
| --- | --- |
| schema_version | 固定整数 1，指目标摘要格式版本 |
| application_history_sha256 | 预期原消费者/所选应用的完整历史摘要 |
| received_history_sha256 | 预期原消费者的完整接收链摘要，包含较新接收后缀 |

查询仍包含完整 expected_identity、application、archive_document_sha256 和可选 timeout_ms，整体最多 16 KiB。Bridge 导出 SyncInboxApplicationRestoreTarget 类型。CLI 继续使用原 --json/--json-file，没有新增命令行覆盖开关；严格解析在打开库前完成。未带 expected_target 的旧查询沿用原空应用/完整相同历史及兼容接收链策略，不暗中添加目标约束。

## 确定性摘要 v1

共享比较在完整结构审计成功后才返回 history_sha256。摘要流使用 UTF-8，每条记录是下述数组的 JSON.stringify 结果，紧接一个 LF 字符，最后对完整流计算 SHA-256 小写十六进制。流式更新只保存短元数据，不再收集全部投影或原页正文。

应用摘要的头记录为 `["workctx.inbox-application-history-target/v1", consumer_key, application_key]`。consumer_key 是规范原身份 JSON 的 SHA-256，application_key 是规范 `{name,version}` JSON 的 SHA-256，沿用实际存储键。按当前应用头到根的降序，每一步写入 `["step", sequence, original_page_document_sha256, projection_sha256, original_application_trace_id]`。尾记录为 `["end", checked_pages, checked_events]`。空应用只有头和零计数尾记录，仍绑定原消费者和应用。

接收摘要头记录为 `["workctx.inbox-received-history-target/v1", consumer_key]`，每个接收页从头到根写入 `["page", sequence, original_page_document_sha256]`，尾记录同样为 `["end", checked_pages, checked_events]`。空接收链也有独立摘要。接收摘要与应用摘要使用不同标识，不可互换。

原页/投影摘要在现有读取流程中已与规范内容核对；应用历史审计也核对完整事件绑定及行数，所以这些摘要间接约束完整原页、逐页投影与派生 ledger。原应用 trace 直接进入应用摘要，只有 trace 改变也能识别；接收后缀的新页即使不含新事件也改变接收摘要。两项摘要不包含本次操作 trace、归档文件路径、所选归档摘要或本地时间，同一合法目标与不同归档比较时，其目标摘要保持一致。

这是所选逻辑历史的内容摘要，不是数据库实例编号、单调版本、签名、服务器认证或业务语义证明。其他应用、确认/派发日志、其他消费者和物理数据库状态不在绑定范围。不同库若所选逻辑历史相同，可得到相同摘要；历史变化后又回到完全相同内容也无法仅凭摘要证明曾经发生过变化。格式版本 1 的记录顺序、字段和 LF 定义固定，未来改变需使用新版本，不静默重解释旧摘要。

## 预览输出

完整预览在 target_application/target_received 中各增加 history_sha256，并返回 observed_target（完整 v1 双摘要）、expected_target（原值或 null）、target_precondition（not-requested/matched/changed）。两段历史与归档兼容、且原目标约束若存在也匹配，才返回 restore_allowed=true 和恢复计划。

新生成的 restore_query 始终带 observed_target 作为 expected_target，原身份/应用/归档摘要/timeout_ms 保留。它约束后续恢复要观察到相同目标历史；预览依然结束只读事务，不保留锁或自动保存查询文件。

若带原约束预览时发现目标不同，完整检查成功后返回 status=conflict、restore_allowed=false、target_precondition=changed；conflicts 增加 target-state-changed，planned_changes/restore_query 为 null，同时保留原 expected_target 与新 observed_target。即使新目标仍与归档兼容，也不静默生成新的恢复查询。结构损坏或预算不足仍报告未完成，不能从未完成检查生成目标摘要。合法 conflict 的 CLI 退出码仍为 0，调用方必须读取结果字段。

## 写事务检查顺序

恢复在同一个 BEGIN IMMEDIATE 中先完整审计所选应用历史，核对 application_history_sha256，再执行空应用/完整相同历史策略。接着完整审计接收链，核对 received_history_sha256，再检查接收链兼容性。两个约束均在第一次接收页或应用插入之前完成；应用侧已经不匹配可直接停止，不声称接收侧也已检查。无需增加额外源链遍历，也没有跨事务检查和写入之间的空隙。

摘要不同报 INBOX_APPLICATION_RESTORE_TARGET_CHANGED，保留 target_component=application-history/received-history、expected_history_sha256/observed_history_sha256、完整原 expected_target 和原归档查询。该次操作在任何插入前失败，回滚可确认时 local_commit_state=not-committed；已有未知事务状态的包装优先级不变。完整结构损坏/预算不足可先于目标不同报错，不用无效内容伪造 observed 摘要。

恢复后的源链/应用读回照常完整审计和与归档比较，不再拿恢复前 expected_target 约束合法新增内容。成功增加 target_precondition=matched/not-requested、target_before 和 target_after；后两项都是完整 v1 双摘要。接收结果另含 previous_received_history_sha256/received_history_sha256。这些只是已完成事务中的前后逻辑观察，不持久保存恢复回执或目标租约。

## 重复调用与未知提交

严格目标约束是前置条件。一次有新增内容的成功恢复会改变 target_after；使用旧 expected_target 再调用会拒绝，即使应用已与归档完全相同，也不能跳过约束直接返回 already-restored。没有改变目标的 already-restored/empty 操作可继续匹配原约束。未带约束的旧调用仍按原完整相同历史处理重复恢复。

COMMIT/ROLLBACK 不明仍保留 unknown、原 expected_target、原归档选择及进度/原因，不自动丢弃或替换目标约束。此后的 TARGET_CHANGED 只说明新尝试看到的目标不同，不能证明上次未知操作没有写入，也不能证明是谁写入。调用方可用原约束做只读预览观察两侧差异；需要接受当前目标时，应另行明确建立新的查询，而不是把原未知请求改成新请求。源码不会自动重试、放宽约束、生成新文件或发送确认。

CLI 的文件读取、归档绑定、打开、Bridge 操作及完整响应包装失败，在查询已解析时保留原 expected_target 和原选择；关闭失败沿用 close_pending，不把其当作提交证明。

## 预算与剩余范围

沿用归档/目标应用 1000 页/16 MiB、单投影 1 MiB、接收链每遍 10000 页/64 MiB、默认 30 秒最多 90 秒本地事务期限，以及 512 KiB 预览/2 MiB Bridge 恢复响应限制。摘要计算在已有遍历内进行，未增加独立数据库读取；同步解析/SQL 不可硬实时抢占，不能据此承诺内存、IO 或严格墙钟上限。

仍缺预览/恢复原请求的显式持久文件、持久恢复回执、跨库实例绑定、不同历史合并/升级、确认/派发日志备份、完整跨设备恢复和真实并发/崩溃证据。本次未执行摘要计算样本、预览或恢复；R-005 继续未完成，evidence 为空。
