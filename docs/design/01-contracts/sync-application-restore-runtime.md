# 收件箱应用归档原子恢复

2026-11-03 开发增量，仅源码和文档；未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行 schema/迁移、生成归档样本或发布。无新 schema/依赖，既有 SQLite 扩展和 PostgreSQL 016–049 未执行。关联 ADR-015、T3.4/T4.3、R-005，运行证据为空。

## 输入与前置条件

Bridge 新增 `restoreApplicationArchive(archive,input,trace)`，CLI 新增 `inbox application-restore`。使用既有[应用历史归档 v1](sync-application-archive-runtime.md)，不会将接收页链归档当作应用归档。严格查询含完整原 expected_identity（tenant_id/workspace_id/project_id/actor_id/client_id）、application={name,version}、必填 archive_document_sha256，以及可选 timeout_ms（默认 30000，范围 1–90000）和完整 expected_target v1（应用/接收历史双摘要），详见 [目标历史绑定](sync-application-restore-target-runtime.md)。查询最多 16 KiB；摘要必须为 64 位小写十六进制，不从当前账号或文件名推断目标。

CLI 要求 --inbox、--archive-file 和 --json/--json-file 二选一，拒绝 output、stdin、重复/未知参数、远端令牌/写键/命令行 timeout-ms。以下示例仅说明接口，未执行或创建文件：

```text
workctx inbox application-restore --inbox local-inbox.sqlite --archive-file application-history.json --json-file restore-query.json
```

先解析查询、有界读取稳定普通 UTF-8 文件、核对完整原页/投影/外层 SHA-256，并绑定原身份、应用和归档摘要，之后才以 create=false/readonly=false 打开已有库。Bridge 对直接调用者独立进行同样的完整内容核验，在事务前取得脱离调用者对象的归档快照。已有 core 和 application v1 扩展必须完整可用；不创建数据库、启用扩展或修复部分 schema。

归档上限沿用 1000 页、16 MiB 文档、16 MiB+4096 文件、单投影 1 MiB，以及 JSON 深度 64/节点 100000。原页链必须从零开始、前驱/游标连续、固定页大小、页面摘要和事件 ID 不重复；空事件页保留上一投影，空根投影为 null。完整核验摘要仅证明文件自洽，不认证来源或业务语义。

## 单事务恢复规则

所有目标读取、缺失接收页追加、应用步骤/事件绑定/应用头写入和最终完整读回在一个 BEGIN IMMEDIATE 事务内完成。接收页导入复用原 caller-owned 写入方法，不开启嵌套事务。

先完整审计所选应用的现存步骤、原页、投影、实际步骤/事件行数和 ledger。只接受没有应用头且无孤立记录的空应用，或者与归档逐步完全相同的应用。相同包括完整历史长度、原页规范 JSON/摘要、投影规范 JSON/摘要及原应用 trace；部分前缀、较长历史或任一不同项均拒绝，不覆盖、回退或合并。

随后审计原消费者的整个接收链，含归档应用头之后的接收后缀。按序号核对与归档重叠的全部原页规范 JSON/摘要。空接收链可添加全部原页；兼容的较短前缀仅追加缺失页；相等链或兼容较新后缀保持原接收头。源链有分叉、损坏、孤立行或超预算即拒绝。追加后再次审计整个接收链并核对预期总页数和头摘要，不删除较新接收页。

对空应用，按原顺序插入每页完整投影、投影摘要和原应用 trace，由原页面事件派生事件 ID/服务端游标/页面摘要/事件摘要 ledger，最后写入应用描述和头。再完整审计全部恢复步骤与 ledger，并逐项与归档比较。不存在的空归档返回 empty，不创建空应用描述；完全相同的历史返回 already-restored；首次恢复非空历史返回 restored。三种成功结果均经过同一事务完成流程，归档只恢复自身记录的应用头。

通用恢复不执行 reducer，不要求当前内置适配器支持该应用名称/版本或事件类型。恢复后按内置规则核对属于独立的 application-replay 操作；本次未调用。恢复保留原页面 trace 和每步 application_trace_id，当前 restore trace 只标识本次操作。接收与应用进度分别返回，不发送服务器确认、不改确认/派发日志，也不自动执行其他应用。

## 预算与结果

应用恢复前后结构审计各限 1000 页/500000 事件/16 MiB 原文与投影；接收链每遍限 10000 页/64 MiB 规范页面文档。已有较长接收后缀也计入接收预算，不因归档较小而忽略。返回前按完整 Bridge 结果检查 2 MiB 上限，超限在 COMMIT 前失败；CLI 再包装路径、文件大小/摘要和关闭状态。

timeout_ms 使用既有本地单调期限，覆盖开始事务、目标核验、插入、读回及提交前检查，不包含文件读取、模块加载、库打开和归档预解析。同步 SQL/解析不可硬实时中断，COMMIT 自身也不能由此计时器抢占。接收链行数统计沿用完整 COUNT；页/字节预算只限制遍历内容，不保证 SQL 查询成本、磁盘 IO、进程峰值内存或严格墙钟上限。

成功包含 restore_completed=true、archive_document_sha256、added_received_pages、added_application_pages/events、received_page_count/head_sha256/cursor、完整应用 state，以及 received_history_audit/full_application_history_audit=verified-structure。state 保留完整当前投影和历史 trace。明确标记 application_history_policy=empty-or-identical、source_page_policy=preserve-compatible-received-chain、restore_provenance=local-archive-not-authenticated、event_ledger=derived-from-original-pages、reducer_replay=not-performed、local_commit_state=committed。服务器应用、来源真实性和投影业务语义保持 not-verified，acknowledgement_dispatch_state=not-sent。

CLI 另返回 source_archive_path、source_file_bytes、source_file_sha256、inbox；文件实际字节摘要与归档文档摘要独立。事务结束后尝试关闭，关闭失败只补 close_pending，不把已提交恢复改为失败或重试。没有文件输出、网络请求、自动初始化或自动重试。

## 失败与未知状态

恢复查询不合法为 INBOX_APPLICATION_RESTORE_QUERY_INVALID；原身份/应用/所选归档摘要不符为 INPUT_MISMATCH；已有应用不同为 CONFLICT；接收重叠不同为 SOURCE_CONFLICT；接收字节超限为 SOURCE_LIMIT_REACHED；追加/接收读回不一致为 SOURCE_INVALID；应用最终读回失败为 READBACK_FAILED；完整 Bridge 响应超限为 RESULT_TOO_LARGE（均使用 INBOX_APPLICATION_RESTORE_ 前缀）。归档内容、文件、schema、历史审计/页数限额、期限与存储错误保留各自原类别。

可确认回滚或尚未进入写事务的 Bridge 恢复失败保留 local_commit_state=not-committed。提交抛错，即使随后回滚成功，也维持 INBOX_APPLICATION_COMMIT_UNKNOWN；回滚失败维持 INBOX_APPLICATION_ROLLBACK_UNKNOWN，顶层 local_commit_state=unknown。不能据此声称“没有写入”。失败保留原身份/application/归档摘要/timeout_ms、restore_completed=false、独立 restore_stage、选中页和 prepared_* 进度；下层 stage/source_stage 单独保留。prepared_* 仅计已返回的事务内写入步骤，可能低于出错时实际写入数，也不表示提交成功。源操作内部失败保留 prepared_received_pages；未知事务包装保留 cause_code/cause_details，其中的内部未提交标记不能覆盖顶层 unknown。

CLI 保留原错误类别/详细字段并补输入文件信息、inbox 和已打开连接的 close_pending。归档文件保留不变，不自动换摘要、身份或目标库重试。未知状态须在重新打开后用同一原身份/应用/归档检查，不能把一次连接关闭当作提交证明。

## 尚未完成

只读恢复预览已补 previewApplicationArchiveRestore/CLI application-restore-preview，见 [恢复预览契约](sync-application-restore-preview-runtime.md)，与实际恢复共用完整结构比较；预览不冻结目标，实际恢复仍独立核对。CLI 预览可显式保存带目标约束的 [原查询文件](sync-application-restore-request-runtime.md)，供 --json-file 使用，不自动恢复。尚缺不同应用历史合并、旧版本升级、完整预览报告/恢复结果归档和持久恢复回执、数据库实例绑定、确认日志/派发日志备份、物理库备份、完整跨设备迁移或实际恢复证据。归档未包含的较新接收后缀只保留目标现有内容，不能凭空恢复。源码接入不等于 SQLite 原子性、重复恢复、崩溃/并发、故障诊断或 CLI 路由已经运行通过；R-005 继续未完成，evidence 为空。
