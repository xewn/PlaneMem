# 恢复历史备份离线目录、回执读取与档案提取

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档；未编译、类型检查、测试、运行 CLI/Bridge、打开数据库、生成样本、执行迁移或发布。无 schema、依赖版本或文件格式变化。

## 入口与原查询

| 命令 | 必需参数 | 可选参数 |
| --- | --- | --- |
| `outbox restore-backup-history` | `--archive-file BACKUP` | 互斥 `--json OBJECT` / `--json-file QUERY` |
| `outbox restore-backup-get` | `--archive-file BACKUP` 和一种 JSON 选择查询 | 无 |
| `outbox restore-backup-export` | `--archive-file BACKUP --output NEW_FILE` 和一种 JSON 选择查询 | 无 |

三个入口都离线使用 `workctx.sync-outbox-restore-history` v1 完整备份，不打开或修改队列，不加载原生 SQLite、读取配置项目或访问令牌/网络。拒绝 --outbox、未知/重复参数、stdin、空路径、额外位置参数和输出覆盖；history/get 禁止 --output。查询文件为稳定普通 UTF-8，允许 BOM，最多16 KiB。范围取自已经完整核验的文件，不接受调用方覆盖 scope。

目录查询仅含可选 limit、backup_sha256、after_restore_id。limit 默认10，允许1–20安全整数；backup_sha256 为小写64位文档摘要；after_restore_id 为原同步标识，出现时必须同时提供原 backup_sha256。首轮可省略查询，目录响应会固定所读文件摘要。所有显式摘要必须与核验后的备份文档一致，否则报 OUTBOX_RESTORE_BACKUP_SELECTION_CHANGED，保留期望/观察摘要和原查询，不自动换文件继续。

单条选择严格为 `{backup_sha256, restore_id}`，两个字段都必需。目录中的每个 get_query 可直接用于 get 或 export，next_query 可用于下一页。绑定的是规范备份文档 SHA，不是文件路径、mtime或文件字节 SHA；同一逻辑备份重新排版仍可继续，改变文档内容/备份时间则拒绝。

## 完整核验和分页

独立子路径 `@planemem/context-bridge/outbox-restore-backup` 新增 `parseOutboxRestoreBackupHistoryQuery`、`parseOutboxRestoreBackupSelection`、`listOutboxRestoreBackupHistory(input,query,trace)` 与 `readOutboxRestoreBackupEntry(input,query,trace)`。两个读取函数都先完整脱离并验证整份备份：集合结构/顺序/唯一性、全部原查询/回执/源档案、原身份/内容摘要和不可变v1恢复摘要及集合SHA，再选择当前页或单条。其他条目损坏也使本次失败，不通过只读选中项绕过完整核验。

沿原 restore_id 的 UTF-8 字节顺序分页，返回 items、has_more、next_query；续页取最后实际返回项，固定原摘要和limit。total_receipts 是完整已核验备份中的历史项总数，与当前数据库数量无关。每项只展示原恢复 ID、原恢复/档案时间、源/恢复摘要、原档案行数/待处理数/历史终态数及get_query，不输出回执中的原原因、正文或租约。

既有文件最多100项、文档64 MiB、文件64 MiB+8192、共享100000节点/深度64限制保持。每次离线读取有90秒单调预算，覆盖完整核验、选择、元数据构造及序列化；在完整核验及返回前检查，同步 JSON/摘要计算不能硬实时中断。元数据最多128 KiB，不截断结果；CLI另附标准封套和输入/输出文件元数据，文件IO/输出保存不在读取函数预算内。

## 单条读取与源档案导出

get 返回完整原 receipt（含 query）、source_summary 和原备份时间/trace/摘要；观察为 archived-restore-history-entry。缺少选中ID时 status=not-found、receipt/source_summary=null，只表示该完整备份没有此项，不能推断原恢复失败或其他副本不存在。原回执时间、trace和历史观察标识不改成本次读取。

Bridge 单条读取另外返回 source，仅供明确文件提取；该字段仍遵守原事件档案大小限制，不属于128 KiB元数据预算。CLI无论get还是export都在构造stdout前剥离source，原payload/source_refs文本和租约值只出现在明确导出的档案文件中。

export 先预检新输出路径，完整读取与核验输入后仅取选中记录的原 source，保存为既有 `workctx.sync-outbox-archive` v1。缺选中项报 OUTBOX_RESTORE_BACKUP_ENTRY_NOT_FOUND，不创建文件。保存沿用独占临时文件、同步/摘要读回、硬链接独占发布及最终完整文件核验，比较文件字节数/文件SHA/原document_sha256；不覆盖已有文件或自动创建目录。源档案的原状态、身份、调度/租约/诊断及原JSON文本保持；档案外层规范编码不保证与最初导入文件的空白/BOM相同。

导出失败保留 query、完整选中历史元数据、已验证输入文件的路径/字节数/文件SHA、输出路径及底层保存/清理状态。最终读回失败明确 published-unconfirmed，保留原校验错误详情和cause_code，不删除已经生成的目标或声称未保存。get/history 的 local=null；export 成功另返回local文件位置/字节数/文件SHA，source_summary提供原档案document_sha256。

## 使用边界与后续

根结果明确 archive_integrity=verified、current_queue/current_control/server_delivery=not-checked、source_authenticity=not-proven。备份完整核验和摘要绑定只保证内部一致性及查询针对同一逻辑文件，不证明来源真实性、当前队列或远端投递。

提取的原事件档案可用于已有 inspect-archive/restore-preview/restore 流程，但不会自动导入历史、生成恢复请求、暂停目标、恢复事件或启动发送。后续事件恢复仍要独立选择新的恢复 ID、原档案摘要、目标暂停版本及原因，满足空项目等条件；原历史恢复查询只是历史记录，不能把旧控制版本当作当前条件。若此前已导入相同restore_id，既有恢复幂等语义仍会只返回历史，不重新灌入事件。

跨项目目录/备份、历史清理/修复、来源认证、完整恢复向导和运行证据仍缺。分页摘要绑定、字段严格性、完整文件损坏拒绝、空备份/缺ID、Unicode字节顺序、原内容保留、文件竞争/读回失败及离线路由均未执行验证。

2026-11-03 衔接增量：新增 [新恢复请求准备与保存](outbox-restore-prepare-runtime.md)，显式提供新 restore_id/reason，读取已暂停目标的当前 generation，完整检查后独占保存五字段原查询；任何已占用ID（包括已导入历史）均拒绝。原预览、恢复及历史重复请求语义不变，实际恢复仍重新检查。本增量仅源码文档，未编译、测试或执行。
