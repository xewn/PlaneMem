# 发送队列恢复历史全范围核验

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档；未编译、类型检查、测试、运行本命令/Bridge、打开数据库、执行schema/迁移、生成样本或发布。

## 入口与查询

`workctx outbox restore-audit --outbox EXISTING_FILE [--json OBJECT | --json-file QUERY_FILE]`

Bridge新增 `SqliteOutbox.auditRestoreReceipts(input, trace)` 与 `parseOutboxRestoreAuditQuery`。`outbox restore-history` 返回的 `audit_query:{scope}` 可用于本入口，范围是整个项目，与当前目录页的limit/游标无关。

| 字段 | 默认 | 约束 |
| --- | --- | --- |
| scope | Bridge必填；CLI可补入开始调用时固定的配置项目 | 完整tenant/workspace/project，显式值必须与CLI配置匹配 |
| max_receipts | 100 | 安全整数，1–1000 |
| max_bytes | 67108864（64 MiB） | 安全整数，1–536870912（512 MiB） |
| timeout_ms | 30000 | 安全整数，1–90000 |

查询最多16 KiB，拒绝未知字段、limit/游标、restore_id、空值或非整数预算。CLI要求显式已有outbox，JSON可省略但不能同时提供inline与文件；文件为稳定普通UTF-8，可带BOM。拒绝重复/未知选项、stdin、内存库、额外位置参数、档案输入和输出文件。参数与项目先核对，再使用既有原生readOnly/query_only模式打开；没有网络、令牌、router或发送调用。

## 完整覆盖与预算

一次读事务内先检查可选恢复回执表，再通过最多max_receipts+1行的有界计数判断整个项目是否落在数量预算内。超数量直接失败，不以所读前缀当成通过。缺扩展视为该次没有历史，返回receipt_storage=not-present；已有表缺列、名称类型冲突等明确报错，不创建或修复。

按恢复ID的BINARY顺序每批最多20条，仅选择有界ID与原查询/档案的存储字节数。首批不设下界，非法或空ID不会被初始游标跳过。每份完整正文加载之前核对：

1. ID符合既有同步标识规则，UTF-8字节顺序严格递增；元数据类型/大小合法。
2. query_json不超过16 KiB，archive_json不超过32 MiB+8192，加入累计预算后不超过max_bytes。
3. 同项目/ID精确匹配只有一行，用最多2行的计数拒绝重复，避免完整读取器一次加载两份重复档案。

随后复用完整历史读取器：核验原查询/范围/ID，核验完整源档案的结构、唯一性、原事件/身份/正文和命令摘要，再以原恢复时间/trace和不可变v1映射重建恢复文档并比较恢复摘要。每份核验通过后才累加进度；不在内存中保留全部档案。遍历结束时核验实际已处理数量与同快照计数一致，读事务成功结束且未过期才返回完整结果。

字节基准为原样存储的query_json加archive_json的UTF-8字节，包含其空白，不是规范重编码大小；其他固定元数据、重建文档、SQLite内部和解析器额外内存不计入max_bytes，因此这不是进程内存上限。单份仍遵守最多1000条、文档32 MiB、共享100000节点/深度64及逐行内容限制。同步SQL/JSON不能硬实时中断；期限在阶段前后及逐份核验时检查，数据库打开/关闭与输入文件读取在Bridge期限之外。

## 成功与失败

成功返回status=complete、checked_receipts、checked_query_bytes、checked_archive_bytes及其合计checked_bytes；Bridge结果最多16 KiB，CLI附标准封套、outbox路径和close_pending。archived_records、held_records及historical_terminal_records按每份恢复历史累加，同一事件出现在不同恢复中可重复计数，record_count_basis=appearances-across-restore-receipts；不解释成当前事件数量或唯一事件数。

非空历史完整通过时archive_integrity=verified；零份时为no-records-observed，不能据此证明过去没有恢复或外部副本不存在。consistency=single-project-read-snapshot，current_queue/server_delivery=not-checked、source_authenticity=not-proven、database_integrity=not-audited。核验不读取当前原事件或暂停控制，不检查其他项目、全库物理结构或来源真实性，也不证明旧发送者停止。

损坏、数量/字节超限、超时、读取或读事务失败都返回错误及complete=false，不返回部分通过、续页或可恢复的核验检查点。错误保留query、stage、selected_restore_id、counted_receipts及count_basis=at-most-max-receipts-plus-one、已核验数量/字节和底层原事件定位/回滚详情。counted_receipts为空表示尚未得到计数；超数量时该值最多是max_receipts+1，并非全项目总量。CLI始终尝试关闭，保留close_pending；关闭失败不抹去已得到的完整结果。

核验不删除、重建、修复历史或队列，不恢复档案、不重试/恢复发送，也不导出文件。单次完整通过只覆盖本次所选项目快照，不证明之后的状态。

无新schema、依赖或Gateway接口。跨项目目录/全库核验、完整恢复回执备份、历史清理/压缩和当前队列来源关联仍待补；上述预算、损坏/重复、缺扩展、计数一致性、归一摘要、错误详情及关闭路径尚无运行验证。
