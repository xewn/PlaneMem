# 收件箱应用归档恢复预览

2026-11-03 回执增补：恢复查询现可显式携带 restore_request_id，最终预览查询及保存文件保留同一 ID。需先显式启用可选扩展；相同完整查询命中已登记回执时仅返回历史结果，不检查当前目标或生成新计划。完整原查询可独立只读查询回执，缺记录不推断回滚。下文目标比较/首次恢复流程适用于未命中回执的请求，详见 [持久回执契约](sync-application-restore-receipt-runtime.md)。仅源码，扩展未执行。

2026-11-03 开发增量，仅源码和文档；未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行 schema/迁移、生成样本或发布。无新 schema/依赖，既有 SQLite 扩展和 PostgreSQL 016–049 未执行。关联 ADR-015、T3.4/T4.3、R-005，运行证据为空。

## 原查询与只读入口

Bridge 新增 `previewApplicationArchiveRestore(archive,input,trace)`，CLI 主程序和嵌入入口新增 `inbox application-restore-preview`。与[应用归档恢复](sync-application-restore-runtime.md)共用严格查询：完整原 expected_identity、application={name,version}、必填 archive_document_sha256、可选 timeout_ms（默认 30000，范围 1–90000）和完整 expected_target v1，详见 [目标历史绑定](sync-application-restore-target-runtime.md)。不接受目标覆盖、合并或忽略差异的选项。

以下示例仅说明接口，未执行或创建文件：

```text
workctx inbox application-restore-preview --inbox local-inbox.sqlite --archive-file application-history.json --json-file restore-query.json
```

--inbox/--archive-file 和 --json/--json-file 二选一必填；可选 --output NEW_FILE 显式保存允许恢复的原查询，见 [原请求文件保存](sync-application-restore-request-runtime.md)；拒绝 stdin、重复/未知参数、令牌/写键/远端 timeout-ms。CLI 先解析 16 KiB 查询、有界读取稳定普通 UTF-8 文件、验证全部原页/投影/外层摘要及原身份/应用/归档摘要绑定，再以 create=false/readonly=true 打开已有库。core 和 application 扩展必须已完整启用；不创建、初始化或修复数据库。

Bridge 直接调用同样在事务前独立核验并复制完整归档。随后在一个 BEGIN 只读事务中，完整审计目标应用历史和原消费者接收链，返回同一快照中的比较结果。只读回调不调用源页追加或应用写入方法，也不执行 reducer、发送确认、访问网络或自动恢复。

## 比较规则

预览与实际恢复共用 `application-restore-comparison.ts`。每次完整核验目标历史结构和 ledger，再将结构合法的差异作为比较数据；发现差异后继续完成剩余结构审计。损坏、缺原页/ledger、孤立记录、预算或期限不足均作为错误，不把尚未完成的检查包装为正常 conflict。

target_application 包含完整已核验的页数、事件数、checked_bytes、应用头/头投影摘要、应用游标和重叠页数。relation 的含义如下：

| relation | 含义 | 当前恢复策略兼容 |
| --- | --- | --- |
| empty | 没有应用描述、步骤或事件绑定 | 是 |
| identical | 历史长度和每一步完整原页、投影、原应用 trace 均相同 | 是 |
| target-prefix | 目标非空历史较短，重叠内容完全相同 | 否 |
| target-longer | 目标历史较长，重叠内容完全相同 | 否 |
| different | 至少一个重叠步骤的原页、投影或原应用 trace 不同 | 否 |

target_received 完整检查接收链，包含未应用接收后缀，返回页数、事件数、checked_bytes、头摘要、接收游标和重叠页数。relation 为 empty、identical、target-prefix、target-suffix 或 diverged；target-suffix 表示目标以归档为兼容前缀并有更多接收页，只有 diverged 不兼容。空归档可与完整合法的现有接收链兼容，不据此创建应用描述。

两类比较均返回 first_difference，定位全部重叠页中正序最早的不同页。字段包括 sequence、field、target_document_sha256/archive_document_sha256；应用比较另带两侧投影摘要。同一页优先报告 page，其次 projection，再其次 application_trace_id；不输出页面/投影正文或两侧原 trace 内容。只有长度不同而重叠完全相同时，first_difference=null，长度差异由 relation 和 page_count/归档 page_count 表达。即使摘要恰好一致，也继续按规范 JSON 文本比较。

## 结果与后续操作

成功表示比较完成，preview_completed=true、local_write_state=not-performed。双方 history_audit、顶层 full_application_history_audit/received_history_audit 均为 verified-structure；不意味着业务投影语义或来源真实。archive 包含已核验归档摘要信息，不包含投影正文。

只有应用和接收链都兼容、且可选原 expected_target 也匹配时 restore_allowed=true。status 为 ready（可恢复非空应用）、already-restored（完整相同应用）或 empty（空归档与空应用）。planned_changes 给出预计新增接收页/应用页/应用事件绑定数、保留较新接收后缀页数，以及预期接收/应用总页数和头摘要；不会产生这些写入。restore_query 返回同一原身份/应用/归档摘要和 timeout_ms，并带 expected_target 固定本次 observed_target，可由调用方另行显式用于 application-restore。

结构合法但任一策略不兼容或原 expected_target 不符时 status=conflict、restore_allowed=false、planned_changes=null、restore_query=null，conflicts 按原因包含 application-history-policy、received-chain-diverged 和/或 target-state-changed；两侧完整比较仍返回。CLI 这种情况退出码为 0，表示预览成功执行，**调用方必须读取 restore_allowed/status，不能用退出码当作允许恢复的判断**。失败才走现有非零错误路径。

target_snapshot=current-read-transaction-only 和 restore_rechecks_target=true 明确预览不保留锁、不冻结后续目标。restore_query 现同时绑定原归档身份/内容和本次完整目标历史双摘要；实际恢复会在自己的写事务、任何插入前重新检查，目标变化则拒绝。带旧约束预览发现变化不会自动生成新约束；旧无约束恢复查询仍采用当次目标的兼容性策略。ready 不保证写入权限、磁盘空间、事务完成或应用业务语义正确。

恢复路径也使用共享比较结果。应用/接收历史不兼容分别保留原 INBOX_APPLICATION_RESTORE_CONFLICT/SOURCE_CONFLICT，增加 application_comparison/source_comparison 摘要；只有完整结构核验成功才报告这种差异。损坏、超限等错误可能优先于原来的提前冲突判断，不放宽恢复条件。恢复后完整读回仍重新比较，并保留原提交/回滚 unknown 处理。

## 预算与失败

归档沿用最多 1000 页、16 MiB 文档、1 MiB 单投影以及共享 JSON 复杂度约束。目标应用完整结构审计限 1000 页/500000 事件/16 MiB 原文与投影；目标接收链限 10000 页/64 MiB 原页面规范文档。超过归档大小的目标历史也受自身审计预算约束；超限不返回部分冲突结果。

预览 Bridge 结果和 CLI 包装后的完整响应分别限制 512 KiB，超限为 INBOX_APPLICATION_RESTORE_PREVIEW_TOO_LARGE。本地单调期限覆盖事务开始、比较、返回前检查和事务结束前检查，不覆盖文件读取、模块加载、打开库或归档预解析；同步 SQL/解析和事务结束无法被硬实时抢占。接收链 COUNT 和重复原页读取不受这些字节统计精确约束，不承诺峰值内存、IO 或严格墙钟上限。

查询、文件、绑定、schema、历史审计、源链/预算、期限和存储错误沿用对应类别。Bridge 比较失败保留原查询、preview_stage、preview_completed=false、local_write_state=not-performed，以及下层阶段/已审计位置/预算；不返回部分成功结果。CLI 对已取得的原文件补路径、字节数和文件摘要，并对已打开连接补 close_pending。关闭失败保留已完成的预览结果；读取事务回滚失败仍保留原 rollback_pending，不把未知连接状态当成已关闭。所有路径维持 acknowledgement_dispatch_state=not-sent。

仍缺不同应用历史的合并/升级、完整预览报告归档/持久恢复回执、数据库实例绑定、确认/派发日志备份、完整跨设备恢复及真实并发/崩溃证据。本次只开发和人工审阅源码，没有执行预览或恢复；R-005 继续未完成，evidence 为空。
