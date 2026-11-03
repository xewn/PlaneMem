# 发送队列恢复历史备份导入与预览

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档；未编译、类型检查、测试、运行 CLI/Bridge、打开数据库、执行初始化/schema/迁移或发布。无新表格式、依赖版本或 Gateway API，复用已有可选恢复历史表；既有 SQLite 升级及 PostgreSQL 016–049 仍未执行。

## 输入与入口

| 入口 | 行为 |
| --- | --- |
| `outbox restore-history-import-preview --outbox EXISTING_FILE --archive-file BACKUP --json-file QUERY` | 原生只读打开已有队列，完整核验备份并比较选中目标历史 |
| `outbox restore-history-import --outbox EXISTING_FILE --archive-file BACKUP --json-file QUERY` | 以 existing 模式打开已有队列，在一个写事务中只补缺失历史 |

也可用互斥 `--json OBJECT`。Bridge 对应 `previewRestoreBackupImport(backup, query, trace)` 与 `importRestoreBackup(backup, query, trace)`，查询解析器为 `parseOutboxRestoreBackupImportQuery`。

原查询严格为 `{scope, backup_sha256}`，最多16 KiB；scope 为完整三层项目，CLI 可补入异步读取前固定的当前配置范围，显式范围必须匹配。backup_sha256 是离线检查得到的完整备份 document_sha256，小写64位十六进制，不是文件字节 SHA。两入口都必须提供一个 JSON 输入和一个备份文件，拒绝未知/重复参数、额外位置参数、stdin、内存库、空路径和输出文件；输入文件沿用稳定普通 UTF-8 有界读取，可带 BOM。

CLI 在打开目标之前完整核验文件及范围/摘要，Bridge 再次脱离并完整核验整份备份。格式仍为 workctx.sync-outbox-restore-history v1，最多100份历史、64 MiB文档、64 MiB+8192文件及共享100000节点/深度64；逐份原查询/回执/原档案及不可变v1恢复摘要和集合SHA必须一致。旧事件档案文件不能用于本入口。

## 目标比较与原子导入

共用比较逻辑在调用方持有的单个事务中检查可选历史表，按备份内每个 restore_id 做全局 BINARY 精确查找，LIMIT 2 拒绝重复。先只读取是否属于原项目及原 query_json/archive_json 的类型/存储字节数；跨项目不加载或暴露其正文。

| relation | 预览含义 | 实际导入 |
| --- | --- | --- |
| missing | 全局没有此恢复 ID | 加入待插入集合 |
| identical | 同项目原查询、回执及完整原档案都相同 | 保持既有记录 |
| different | 同项目历史有效，但完整内容不同 | 整批拒绝 |
| reserved-other-project | 此 ID 已被其他范围占用 | 整批拒绝，不暴露其他项目内容 |

同项目完整内容比较前，原查询最多16 KiB、原档案最多32 MiB+8192；每次目标检查累计 query_json + archive_json 原存储字节最多64 MiB，正文加载前判断预算。继承完整历史原文/身份/命令摘要/v1恢复摘要核验；损坏、超限、重复ID或异常表都是错误，不冒充可供选择的普通冲突。比较完整规范历史对象，包括原 payload/source_refs 字符串；数据库外层JSON空白或对象字段顺序不产生内容冲突。

实际导入用 BEGIN IMMEDIATE，完整预检全部源历史后才写入。只插入 missing 项，保留原 scope/restore_id、原查询、源档案、恢复时间/trace和恢复摘要；不覆盖、删除或重新生成历史。缺表仅在确有缺失项的首次非空导入中调用共享初始化函数创建既有表，初始化也在该写事务内；空备份不创建表。已有额外历史保持不变，不要求目标历史为空。

全部插入完成后，重新对全部源 ID 执行同样的全局唯一性、字节预算、完整历史核验和等值比较，包括原先 identical 项。只有全部相同才允许提交；任何写入数量异常、读回变化、损坏、超时或比较失败整批回滚。预检和读回各自有64 MiB目标原文预算，共用整笔期限。此范围只覆盖备份里的 ID，不代表全项目或全库历史审计。

## 结果与未知提交

预览返回 entries（只有源 restore_id 和 relation）、missing_receipts/identical_receipts/conflicting_receipts、receipt_storage 和 checked_target_bytes；status 为 compatible 或 conflict，observation=current-history-import-preview，local_commit=not-attempted。预览不预留ID、不冻结未来目标，也不产生导入回执，实际导入重新比较。缺表可预览为全部 missing；空备份为 compatible。

实际导入返回 action=imported 或 already-present、inserted_receipts/identical_receipts、observation=current-local-history-import、local_commit=committed。already-present 仅表示本次事务观察到所有源历史已经相同，空备份也属于此分支；不能证明上一次未知导入曾经提交。没有独立导入请求ID、持久导入回执或导入审计表，prior_import_commit 始终 not-proven。

失败保留原 query、stage、target_restore_id、底层源档案 record_index/selected_event_id/selected_restore_id，以及 local_commit 和事务 phase/rollback。已准备的 candidate_result 标为 unconfirmed-history-import，插入数量是候选计划，不能视为已提交。提交抛错或回滚失败按 unknown 处理，保留原备份和查询，再用同一输入做预览；之后显式重复导入仍只补当时缺失项，不自动重试或替换原摘要。BEGIN 失败不回滚其他事务，成功提交后不因期限或关闭错误改报未提交。

Bridge 两入口各有固定90秒单调预算，覆盖完整备份核验、目标检查以及实际写入/读回，在阶段前后/逐项/提交前检查；同步 SQL/JSON 无法硬实时中断。预览事务结束后仍检查期限，写入确认提交后不再补报超时。完整 Bridge 成功结果最多128 KiB；预览超限不截断，实际结果在提交前完成有界序列化。输入文件读取和数据库打开/关闭在 Bridge 期限之外。CLI 保留原备份路径/文件字节数/文件SHA、队列路径、原查询和 close_pending，始终尝试关闭已打开的连接。

## 与当前事件恢复的区别

两个入口均不读取或修改 local_events、当前暂停控制，不领取、结算、重试、恢复发送或访问网络。根结果明确 restored_events=0、current_queue/current_control=not-read-or-modified、server_delivery=not-checked、source_authenticity=not-proven、database_integrity=not-audited。导入历史不要求当前项目为空或已暂停，因为它不恢复事件。

导入的历史回执仍保留备份中的原观察标识和原时间，不改成此次目标队列的事件恢复证明。导入后这些 restore_id 继续占用原历史命名空间：以后用同一个原恢复请求调用 `outbox restore`，会按既有幂等规则返回历史回执，不把当前事件重新灌入。若要恢复当前事件，需独立按已有受控事件恢复流程准备新的恢复请求，并满足空项目/暂停版本等条件；导入和事件恢复没有原子组合保证。

完整来源真实性、因果关系、选择性提取、跨项目恢复、历史修复/清理、持久导入审计及运行证据仍待补。正常/重复/空备份、同ID异文/跨项目/损坏、并发、全事务读回/回滚/未知提交、限额和CLI关闭路径均未执行验证。

2026-11-03 后续已补 [备份离线目录、原回执读取与源档案提取](outbox-restore-backup-access-runtime.md)：整份备份核验后按原摘要绑定分页和选择，支持独占导出所选原事件档案并保留原文档SHA。无需先导入历史或打开队列，stdout仅含摘要；不自动生成新恢复请求/恢复事件，跨项目备份、清理/修复、来源认证和运行证据仍缺。