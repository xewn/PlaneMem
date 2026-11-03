# 发送队列完整恢复历史备份与离线核验

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档；未编译、类型检查、测试、运行 CLI/Bridge、打开数据库、执行 schema/迁移、生成备份样本或发布。无新 schema 或依赖版本变化，既有 SQLite 升级及 PostgreSQL 016–049 仍未执行。

## 入口

| 入口 | 输入 | 结果 |
| --- | --- | --- |
| `outbox restore-history-backup` | 必须 `--outbox EXISTING_FILE --output NEW_FILE`；可选互斥 `--json OBJECT` / `--json-file QUERY_FILE` | 完整读取指定项目的全部恢复历史，独占保存新文件，stdout 仅含摘要 |
| `outbox inspect-restore-history-backup` | 仅 `--archive-file FILE` | 离线完整核验文件，返回历史统计与文件/文档摘要 |

Bridge 新增 `SqliteOutbox.readRestoreBackup(input, trace)` 和 `parseOutboxRestoreBackupQuery`。独立包子路径 `@planemem/context-bridge/outbox-restore-backup` 暴露文件类型、限额、`createOutboxRestoreBackup`、`verifyOutboxRestoreBackup`、`outboxRestoreBackupSummary`；离线读取只加载类型上的 SQLite 引用，不加载原生 SQLite 模块、不实例化数据库，也不读取当前项目配置或令牌。主程序和嵌入式 CLI 共用文件处理入口。

备份查询仅允许 scope/max_receipts/max_bytes/timeout_ms，最多16 KiB。scope 为完整三层原项目范围；CLI 可从异步输入前固定的配置补入，显式范围必须匹配。max_receipts 默认和上限均100，最小1；max_bytes 默认和上限均67108864（64 MiB），最小1；timeout_ms 默认30000，上限90000，最小1，三者均为安全整数。数量预算是完整集合上限，不是分页条数，超限不截断。CLI 不使用默认队列路径；拒绝额外/重复参数、stdin、内存库、空路径、额外位置参数和输出覆盖。查询/备份文件使用稳定普通文件读取、严格 UTF-8，允许 BOM。

## 文件 v1

外层严格为 `{document, document_sha256}`。document 严格包含 schema_version=1、kind=`workctx.sync-outbox-restore-history`、scope、observed_at、export_trace_id 和 records；每项严格为 `{receipt, source}`。receipt 保存完整历史回执（含原 query、原档案/恢复摘要、原恢复时间/trace、原档案时间/trace、计数和历史观察标识）；source 保存该次恢复的完整 `workctx.sync-outbox-archive` v1 文件。

历史项按原 restore_id 的 UTF-8 字节顺序严格递增、唯一，并全部属于同一项目。此顺序不表示恢复时间顺序。不同恢复历史可以包含相同事件 ID，这种重复保留。所有时间是规范 ISO，导出 trace 非空、不超过1024个 UTF-16码元且无控制字符/孤立代理项。

逐份完整重核原查询、源档案结构/唯一性/正文/引用/原身份/命令摘要，再共享 `outboxVerifiedRestoreRecord`，使用原恢复时间/trace 与不可变 v1 映射重建恢复文档并校验归一摘要。重建出的全部回执字段必须与文件声明深度相等，拒绝多余字段、伪造计数、改变历史标识或不一致的控制版本。档案内的原 payload/source_refs 字符串和租约/诊断完整保存，历史 query 和外层字段按固定字段顺序规范编码；不保留数据库 query_json/archive_json 的外层空白或最初导入文件的 BOM/文件字节摘要。

document_sha256 是规范 document 的 UTF-8 SHA-256，小写64位十六进制，独立于每份 source 的文档摘要和恢复摘要。属性书写顺序可不同，但保留载荷字符串内部原顺序/空白，重复/倒序历史项不自动排序纠正。文件类型与原事件档案不同，不能直接交给 `outbox restore`。

## 完整读取与限额

备份复用恢复历史 audit 的单次只读事务：先有界计数，再按 BINARY ID 分批读取元数据，每份正文加载前检查原 query_json + archive_json 的实际存储字节预算与同范围 ID 唯一性，完整核验后才收集。读事务结束前核对实际数量；缺扩展或无历史可生成空备份，坏表/坏行/超限/超时失败，不跳过记录或输出部分备份。

每份 source 仍最多1000行、文档32 MiB、文件32 MiB+8192；整份历史备份最多100项、document 64 MiB、文件64 MiB+8192。集合使用共享100000节点/深度64限制，这一组合限额可能先于字节/历史条数上限到达。收集时累计每项规范编码字节，超64 MiB不再收集；事务完成后重新核验整份文档及其整体大小/复杂度，再计算集合摘要。数据库读取时的 max_bytes 只统计原 query_json/archive_json，回执字段、文档封套和编码开销另受整体文件限制；这不是进程内存上限。

Bridge 备份期限覆盖整个审计、收集及最终文档构造，阶段前后和逐项检查。独立文件核验默认90秒预算，包含完整集合快照、逐项历史核验和集合摘要。同步 SQL/JSON 无法硬实时中断。数据库打开/关闭、输入文件 IO、输出准备与文件保存不在 Bridge 期限中；保存前核验和最终文件读回核验各有独立90秒预算。

## 文件保存、输出和失败

CLI 在打开数据库前预检新输出路径，原生 readonly/query_only 读取已有队列，完整读取结束并尝试关闭后才准备文件内容。复用独占临时文件、同步、逐字节摘要读回、硬链接独占发布和保留未清理路径的写入器；最终再从目标路径有界读取、完整核验每份历史及集合摘要，比较文件字节数/文件 SHA/文档 SHA。文件已创建但最终核验失败时明确 published-unconfirmed，不删除目标或声称未写文件。

stdout 不含历史正文、原租约值或全部回执数组，返回 records（恢复历史项数）、archived_records/held_records/historical_terminal_records、原备份时间/trace、document_sha256 和 local 的路径/文件字节数/文件 SHA。事件统计按各历史档案累加，record_count_basis=appearances-across-restore-receipts；同一事件在多次恢复中重复计数，不能当作当前队列数量。导出另带规范 query、outbox 路径、close_pending。

根观察为 archived-local-restore-history，archive_integrity=verified，current_queue/current_control/server_delivery=not-checked，source_authenticity=not-proven。空备份只证明该文件内历史为空，不证明过去没有恢复；摘要证明内部一致性，不是来源签名、当前队列或远端投递证明。它不包含当前 local_events、当前暂停状态、其他项目或未知数据库列，也不是物理数据库备份。

失败保留原查询、backup_stage、audit_complete、collected_receipts 和 encoded_record_bytes。审计失败继续保留 stage、选中恢复 ID、原档案事件定位、已核验进度及回滚信息；离线逐项失败附 history_record_index 和 selected_restore_id，不覆盖内层原事件 record_index/selected_event_id。文件保存失败保留输出/临时路径、文件状态、完整历史摘要和关闭状态。关闭失败不抹去已完成读取或文件状态。

## 后续

完整历史备份的导入、恢复前比较、选择性提取、跨项目发现/全库备份、历史清理/压缩、因果来源认证及运行证据仍待补。文件保存与数据库读取不是一个事务，快照之后的历史变化不会写进已生成文件。上述正常/空历史、大小/节点/时间边界、坏原文/坏摘要/重复项、文件竞争/失败、只读与离线路由均尚无运行验证。
