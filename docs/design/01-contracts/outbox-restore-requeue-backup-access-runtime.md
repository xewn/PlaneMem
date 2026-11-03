# 重新排队备份离线目录与批次提取

2026-11-04，ADR-015 / T3.4 / T4.3 / R-005。仅源码与文档；未编译、类型检查、测试、运行产品命令、打开数据库、生成样本或发布。没有 schema 或依赖版本变化，SQLite 既有扩展及 PostgreSQL 016–049 仍未执行。

## 入口

| CLI | 输入 | 输出 |
| --- | --- | --- |
| `outbox restore-requeue-backup-history` | 必须 `--archive-file BACKUP`；可选 `--json QUERY` 或 `--json-file QUERY_FILE` | 完整核验后返回批次分页目录 |
| `outbox restore-requeue-backup-get` | 同一备份及必填JSON选择；可选 `--output NEW_QUERY` | 原请求/完整回执，可独占保存原请求 |
| `outbox restore-requeue-backup-export` | 同一备份及必填JSON选择；必须 `--output NEW_RECEIPT` | 选中批次及完整父历史的独立回执文件 |

三个入口均为纯文件操作，不读取项目配置或令牌、不加载原生 SQLite、不打开队列或发起网络请求。主程序与嵌入式 CLI 共用处理器，在配置/数据库入口之前分派。拒绝 outbox、receipt-file、额外/重复选项、额外位置参数、stdin 和空路径；JSON 两种来源互斥。history 拒绝 output。备份/查询文件使用稳定普通文件读取和严格 UTF-8，允许 BOM；查询最多16 KiB。

纯子路径 `@planemem/context-bridge/outbox-restore-requeue-backup` 增加 `parseOutboxRestoreRequeueBackupHistoryQuery`、`parseOutboxRestoreRequeueBackupSelection`、`listOutboxRestoreRequeueBackupHistory` 和 `readOutboxRestoreRequeueBackupEntry`。不改变备份或独立回执 v1 文件格式。

## 分页与原选择绑定

目录查询严格为 `{limit?, backup_sha256?, after_requeue_id?}`，limit 默认10、最多20且为正安全整数。首次可省略查询；出现 after_requeue_id 时必须同时提供原 backup_sha256。摘要须为64位小写十六进制，ID须符合现有同步ID契约；未知字段、null、非法数字或无摘要续页均拒绝。

每次调用都先完整核验所有父历史、全部批次、固定v1映射、关联闭包和集合摘要，包括当前页以外的历史；任何损坏使整次读取失败，不提供部分通过。然后核对期望摘要，并按 BINARY requeue_id 严格大于游标选择下一页。游标仅表示字节顺序下界，不要求它仍是某个条目；这不是时间排序。

结果含规范 query（补齐原摘要）、total_receipts、parent_histories、items、has_more 和 next_query。每项只含批次/恢复ID、历史时间、摘要、选中数量及 get_query；不含全部事件ID、原因、父档案或租约正文。续页固定原摘要、limit和最后一项ID；终页 next_query=null。get_query 可直接用于 get/export。

单条选择严格为 `{backup_sha256, requeue_id}`。完整备份核验后再核对原摘要并查找批次。更换文件内容/观察时间/trace导致摘要变化时拒绝，保留期望和观察摘要及原查询；文件外层空白变化不改变规范文档摘要，但实际文件SHA可能不同。缺项返回 status=not-found、original_query/receipt/standalone=null，不推断当前库或其他备份也没有该批次。

## 原请求与独立文件

命中返回 status=recorded、完整 original_query、完整原 receipt，以及 standalone 摘要。事件ID顺序、原因、暂停版本、原恢复/重新排队时间和trace、全部历史摘要保持原值。

选中批次与其完整父回执/源档案经既有 `createOutboxRestoreRequeueFile` 再核验，生成 `workctx.sync-outbox-restore-requeue-receipt` v1。该独立文件的 observed_at/export_trace_id 保留备份原值，packaging_metadata=preserved-from-backup；相同备份和选择得到相同规范独立文档摘要，不将本次提取时间当成新历史。独立文件不含其他批次，也不含备份集合摘要，来源关系由此次响应的 backup_sha256、backup_file 和原选择描述，不是签名证明。

standalone.document_sha256 是独立文档摘要，与 backup_sha256 分开；standalone.get_query/import_query 使用独立摘要，分别衔接既有离线单批次读取和显式历史导入。该摘要在实际保存前表示已验证候选文件，只有 local 字段描述文件保存结果。多个批次可分别导出相同父历史，既有单批次导入会保留相同父项；逐份导入不是整个项目的原子导入。

纯读取函数返回 receipt_file，其中包含父档案正文。CLI 在生成输出与错误详情前移除此字段，stdout 只含目录元数据或原请求/回执和独立文件摘要，不泄露父档案正文。get 的 output 保存纯原查询，export 的 output 保存完整独立回执，两者格式不混用；不生成新ID、不自动执行导入、恢复或重新排队。历史原ID仍遵守已有幂等规则。

## 文件与失败状态

有输出时先预检新路径，再读取备份。选中缺项时 get --output/export 报 OUTBOX_REQUEUE_BACKUP_ENTRY_NOT_FOUND，不创建输出。复用既有独占临时文件、同步、硬链接发布、最终字节/大小/SHA读回；独立回执还完整核验历史及文档SHA，原请求核对完整JSON。已有目标不覆盖，最终核验失败保留 published-unconfirmed 及目标/临时路径、清理状态。

错误保留底层 ContractError.details、原 query、备份路径、备份验证信息和历史结果；不能用外层 not-saved 默认值覆盖内层发布状态。完整成功封套最多128 KiB；保存后响应超限将已知 local 放入错误 result，不重新保存、不将文件改称未创建。读取结果中的 backup_file.state=read-and-verified 仅描述读取时的文件快照，不保证磁盘路径之后不变。

纯访问从整份验证到分页/提取与元数据完成采用90秒阶段预算；同步JSON不能硬实时中断，文件 I/O 不在该预算内，保存前/后的独立回执核验各有既有预算。完整备份继续遵守100批/100父项、64 MiB文档、100000节点/64层限制；分页不降低完整文件验证成本。纯元数据和CLI封套各最多128 KiB，超限不截断。

observation 为 archived-requeue-history-page 或 archived-requeue-history-entry，archive_integrity=verified，local_commit=not-attempted；current_queue/current_control/server_delivery=not-checked，source_authenticity/sender_stopped=not-proven。不对当前事件、控制状态、投递或目标导入作推断。

联合备份整事务导入/预览、跨项目备份、保留管理、来源证明和运行证据仍缺；R-005未完成。正常/空备份、未知ID、游标/摘要变化、页外损坏、父历史重复引用、容量/期限、文件竞争与响应失败场景均未运行验证。
