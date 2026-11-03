# 重新排队完整历史审计

2026-11-03，ADR-015 / T3.4 / T4.3 / R-005。仅源码与文档；未编译、类型检查、测试、运行产品命令、打开数据库、执行 schema/迁移或发布。

`SqliteOutbox.auditRestoreRequeueReceipts(input, trace)` 与 `outbox restore-requeue-audit --outbox EXISTING_FILE [--json QUERY | --json-file QUERY_FILE]` 完整核验所选项目的持久重新排队历史。目录返回的 `audit_query:{scope}` 可用于此入口；目录页的 limit/游标不限制审计范围。

## 查询

复用恢复历史审计的严格预算解析器，导出独立 `parseOutboxRestoreRequeueAuditQuery` 和 `OutboxRestoreRequeueAuditQuery`。只接受下列字段，JSON 最多 16 KiB；拒绝额外字段、分页游标、批次 ID、null 或非整数预算。

| 字段 | 默认 | 约束 |
| --- | --- | --- |
| scope | Bridge 必填；CLI 可补配置项目 | tenant/workspace/project 完整匹配配置 |
| max_receipts | 100 | 安全整数 1–1000 |
| max_bytes | 67108864（64 MiB） | 安全整数 1–536870912（512 MiB） |
| timeout_ms | 30000 | 安全整数 1–90000 |

CLI 必须提供已有 outbox 文件。可省略 JSON，inline 与文件只能选一项；文件为稳定普通 UTF-8，可带 BOM。拒绝重复或未知选项、stdin、内存库、额外位置参数和 --output。原生只读打开，不回退可写或初始化表；不请求令牌、服务器或发送接口。

## 同一快照的完整核验

一个只读事务中先检查可选回执表，再读取至多 max_receipts+1 的计数。数量超预算立即失败，不把前缀解释成完整结果。表不存在返回 receipt_storage=not-present 和零记录；缺列或名称类型异常报错。没有批次时不检查父恢复历史表；存在批次但缺父表则失败。

批次按存储 requeue_id 的 BINARY 顺序，每批最多20条读取有界 ID 和 query_json 字节数。首批没有下界，非法首项不会被跳过；每条先验证数量、ID 顺序和全库该 ID 的唯一性，再对原请求字节计入预算。随后复用固定有界元数据投影和解析器，核验完整原查询的 SHA、scope/ID、时间、trace 与摘要格式。

取得原 restore_id 后，检查父恢复 ID 全局唯一且属于同一项目，只查询父 query_json/archive_json 的长度；两者计入累计预算后，才允许完整读取。缺失、重复或跨项目的父历史均拒绝。单条重新排队查询和父查询各最多16 KiB，父档案最多32 MiB+8192；所有长度按原样存储 UTF-8 字节计，包括空白。

通过预检后调用既有完整原查询回执读取器。它再次精确匹配原请求，核验完整父源档案和不可变 v1 恢复映射，绑定父恢复文档/完整父回执摘要，并重算按原事件顺序选中的前后记录摘要。元数据有效但父历史损坏、选中内容不存在或摘要变化均失败。单条完整通过后才累计 checked_*，不保留所有正文。

同一父档案被多个批次引用时，每个批次重新核验并再次计费；此预算表示每个批次的原查询加父查询/源档案逻辑输入大小。共享读取器内部重复读取、固定元数据、重建对象/数组、SQLite 内部和解析器额外内存不计入，不是进程内存或物理 I/O 上限。单份既有节点、深度、事件数量和序列化限制继续适用。

遍历结束必须与同快照计数一致，读事务成功结束且仍未过期后才返回 status=complete。期限在阶段前后及完整读取器中检查；同步 SQL/JSON 不能硬实时打断。模块加载、输入文件读取和数据库打开/关闭在 Bridge 预算之外。

## 结果与失败

成功包含原 query/scope、checked_receipts、checked_query_bytes、checked_restore_query_bytes、checked_archive_bytes、合计 checked_bytes；byte_basis=stored-requeue-query-and-parent-query-archive-per-batch-utf8。selected_record_appearances 是事件在各批次中的累计出现次数，record_count_basis=appearances-across-requeue-receipts，不代表唯一或当前事件数；distinct_restore_histories 为涉及的不同父恢复 ID 数。

非空历史 receipt_integrity=verified，零记录为 no-records-observed。observation=verified-local-requeue-history、consistency=single-project-read-snapshot；current_queue/current_control/server_delivery=not-checked、source_authenticity/sender_stopped=not-proven、database_integrity=not-audited、local_commit=not-attempted，附 observed_at。只验证本次项目已有持久批次及其关联历史；不能发现无 requeue_id 的旧操作或已删除历史，也不覆盖无引用父历史、其他项目或全库物理结构。缺记录不证明过去没有操作或原未知提交失败。

失败保留底层详情、query、complete=false、stage、selected_requeue_id、selected_restore_id、已核验计数和字节。counted_receipts 为有界计数，count_basis=at-most-max-receipts-plus-one，超限时不是实际总数；未计数时为 null。budgeted_bytes 包含已通过预算预检的当前项，可能高于已完整核验的 checked_bytes，不代表部分通过。超时统一报告 OUTBOX_REQUEUE_AUDIT_TIMEOUT，并保留共享超时 cause_code；不将期限超时误报成损坏。不返回部分成功、续页或审计检查点。

Bridge 完整结果与 CLI 封套各最多128 KiB。CLI 始终尝试关闭并保留 close_pending，关闭失败不抹去完整读取结果；封套超限保留已知结果。审计不改当前事件或控制，不自动发送、修复、导出或导入历史。

完整历史备份/跨设备导入、独立回执文件、保留管理、全库审计、来源证明和运行证据仍缺。预算边界、共享父历史重复计费、ID歧义、损坏摘要、超时、事务及关闭场景均未运行验证。既有 SQLite 扩展和 PostgreSQL 016–049 仍未执行。

2026-11-04 后续已补 [重新排队独立回执文件](outbox-restore-requeue-file-runtime.md)：单批次完整原回执及父恢复回执/源档案可从同一只读快照导出，独占保存并最终完整读回；离线核验全部摘要及固定映射，按document_sha256/requeue_id找回原请求并可显式保存。全部批次联合备份与跨设备导入仍缺；仅源码文档，未运行、编译、测试或打开库。
