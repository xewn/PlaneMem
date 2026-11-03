# 项目重新排队历史完整备份

2026-11-04，ADR-015 / T3.4 / T4.3 / R-005。仅源码与文档；未编译、类型检查、测试、运行 CLI/Bridge、打开数据库、执行 schema/迁移、生成样本或发布。无数据库结构或依赖版本变化，既有 SQLite 扩展及 PostgreSQL 016–049 仍未执行。

## 入口与查询

| 入口 | 参数 | 行为 |
| --- | --- | --- |
| `outbox restore-requeue-backup` | 必须 `--outbox EXISTING_FILE --output NEW_FILE`；可选 `--json QUERY` 或 `--json-file QUERY_FILE` | 在单次只读快照中收集项目全部批次及关联父历史，独占保存完整新文件 |
| `outbox inspect-restore-requeue-backup` | 仅 `--archive-file FILE` | 离线完整核验并输出摘要 |

Bridge 提供 `readRestoreRequeueBackup(query, trace)`。纯文件子路径 `@planemem/context-bridge/outbox-restore-requeue-backup` 提供类型、限额、查询解析、create/verify 和摘要函数。离线入口不加载原生 SQLite，不读取项目配置或令牌，不发起网络请求；主程序与嵌入式 CLI 共用处理器。

查询严格为 `{scope, max_receipts?, max_bytes?, timeout_ms?}`，最多16 KiB。scope 为完整原项目范围；CLI 在异步读取输入之前固定配置范围，显式 scope 必须匹配。数量默认100、最多100；读取字节预算默认64 MiB、最多512 MiB；期限默认30000、最多90000毫秒。可选数值均为正安全整数，拒绝额外字段和 null。数量是完整集合上限，超限不分页、不截断。

CLI 拒绝额外/重复选项、stdin、内存队列、空路径及覆盖现有文件；两个 JSON 来源互斥。输入使用稳定普通文件读取与严格 UTF-8，允许 BOM。导出在打开已有库前预检输出路径，使用原生 readonly 连接；完整读取结束并尝试关闭数据库后才写文件。

## 文件 v1 与关联闭包

外层严格为 `{document, document_sha256}`。document 严格包含：

```text
schema_version: 1
kind: workctx.sync-outbox-requeue-history
scope: 原项目范围
observed_at: 本次快照观察的规范 ISO 时间
export_trace_id: 本次导出 trace
parents: [{receipt: 完整恢复回执, source: 完整原事件档案}]
receipts: [完整重新排队回执]
```

parents 按原 restore_id 的 UTF-8 字节顺序严格递增并唯一；receipts 按原 requeue_id 同样排序和去重。验证器拒绝倒序和重复，不替输入修复。全部项属于同一 scope。每个批次必须引用一个文件内父历史，且原 archive_sha256 与父源档案摘要完全一致；每个父历史至少被一个批次引用。父历史缺失或无引用均失败；两个数组同时为空合法。

父历史按 restore_id 去重，不按源档案摘要合并不同恢复操作。每个父项完整重核源档案和固定 v1 恢复映射，重建回执必须与声明逐字段深度相同。每个批次使用原查询、父源档案、父回执、原重新排队时间/trace 重建固定 v1 候选回执；原查询SHA、完整父回执SHA、选中记录前后SHA及全部字段必须一致。严格拒绝多余字段、伪造计数或改变历史观察标识。

保留原事件顺序、原因、generation、时间、trace，以及源档案内 payload/source_refs 字符串的原内容；不保存数据库 JSON 外层空白或先前导入文件的 BOM/文件摘要。document_sha256 为按固定字段顺序规范编码的整份文档 UTF-8 SHA-256，小写64位十六进制；输入对象的属性书写顺序不影响该规范摘要。

## 快照、读取预算与文件容量

导出复用项目完整批次审计：先有界计数，再按 BINARY ID 读取元数据；载入正文前检查原查询/父查询/父档案长度与累计预算，验证全局ID唯一性、完整历史和原查询精确相等。只有验证完的批次交给内部收集器。共享父历史在同一快照每次出现时仍深度比较，只保存第一份；普通审计不传收集器，仍逐批释放正文。读事务结束前核对实际数量，任何损坏、缺项、歧义或超限都不返回部分备份。

max_bytes 统计每批次读取的原重新排队 query_json、父 query_json 和 archive_json 的实际 UTF-8 字节，包括存储空白。**共享父历史按每个批次重复计入读取预算**，即使最终文件只保存一份。因此去重文件很小也可能超出读取预算；提高读取预算不提高文件容量。

文档固定最多64 MiB，整个文件最多64 MiB+8192字节；最多100批次和100父项。每个父档案仍遵守既有32 MiB文档/32 MiB+8192文件及1000事件限制。完整集合还受100000节点/64层共享 JSON 限额约束。收集器在保留新父项或批次前累计规范记录字节，最后重新核验文档整体开销、复杂度和摘要。上述限制不是进程内存上限。

Bridge 总期限覆盖审计、收集和最终构造；逐阶段及逐项检查。独立文件核验默认90秒；保存前核验和最终文件读回核验分别使用该预算。同步 SQL/JSON 无法硬实时中断；模块加载、数据库打开/关闭和文件 I/O 不在 Bridge 期限内。缺可选批次表或无项目批次可生成空备份，不创建表；仅包含被批次引用的父历史，不等于全部恢复历史备份。

## 文件保存与失败状态

保存前完整验证并冻结输出字节，复用独占临时文件、同步、读回和硬链接独占发布。发布后从最终路径有界读取，比较全部字节、大小及文件SHA，并完整重验历史及文档SHA。目标已创建但最终核验失败返回 `published-unconfirmed`，保留目标/临时路径与清理状态，不将其改写为未保存。

stdout 封套最多128 KiB，只含项目、备份时间/trace、document_sha256、批次数、父历史数和计数摘要，不输出原档案正文或租约。archived_record_appearances 按不同父历史内事件出现次数累加；selected_record_appearances 按批次选中事件出现次数累加，两者都不代表唯一事件数或当前队列数量。导出附规范 query、outbox、close_pending、local 路径/文件大小/文件SHA及最终核验方式。响应超限保留已保存 local 结果，不重新保存。

失败保留底层 ContractError.details，并附 preparation_stage、audit_complete、collected_receipts/collected_parents、encoded_record_bytes。审计的 stage、所选批次/恢复ID、已核验计数和回滚信息继续保留；离线验证附 backup_stage 和所选ID，不覆盖内层事件定位。保存错误保留完整备份摘要、原查询、发布/清理和数据库关闭状态。关闭失败不抹去已完成读取或文件结果。

## 语义与后续

摘要标记 observation=archived-project-requeue-history、archive_integrity=verified、local_commit=not-attempted；current_queue/current_control/server_delivery=not-checked，source_authenticity/sender_stopped=not-proven。空备份只描述该份历史集合，不证明过去没有重新排队。文件摘要证明内部一致性，不证明来源真实性、当前事件状态或远端投递；备份不读取/恢复当前事件或控制状态，不自动发送，不是物理数据库备份。快照结束后的历史变化不包含在该文件内。

项目联合备份的原子导入/预览、离线分页与按批次提取、跨项目备份、保留管理、来源证明和运行证据仍待补。既有单批次导入只接受独立回执格式，不能直接接收本集合文件。全部正常、空历史、共享父项、缺项/损坏、字节/节点/时间边界、文件竞争及关闭失败场景均未运行验证；R-005 仍未完成。

2026-11-04 后续已补 [备份离线目录与批次提取](outbox-restore-requeue-backup-access-runtime.md)：每次完整核验联合备份后按原摘要分页/选择，可找回并保存原请求，或导出带完整父历史的独立批次文件；该文件可衔接已有单批次导入。保留原历史与备份观察时间/trace，缺项不创建输出，保存后完整读回。联合备份原子导入/预览及运行证据仍缺；仅源码文档，未编译、测试或运行。
