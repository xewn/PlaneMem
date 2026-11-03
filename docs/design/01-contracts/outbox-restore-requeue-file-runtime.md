# 重新排队独立回执文件

2026-11-04，ADR-015 / T3.4 / T4.3 / R-005。仅源码与文档；未编译、类型检查、测试、执行 CLI/Bridge、打开数据库、生成样本、执行 schema/迁移或发布。

## 文件内容与核验

新增 `@planemem/context-bridge/outbox-restore-requeue-file` 离线子路径，提供 create/verify/summary/selection/entry 函数。运行时导入不加载 Bridge 根入口或原生 SQLite；仅实际导出命令动态加载根入口并打开已有库。

文件严格为 `{document, document_sha256}`。document 只接受 schema_version=1、kind=workctx.sync-outbox-restore-requeue-receipt、scope、observed_at、export_trace_id、receipt、parent。receipt 为完整原重新排队回执，包含原七字段查询、选中前后摘要、历史标记、原时间和 trace；parent 严格为 `{receipt, source}`，保存完整父恢复回执及原事件档案。原事件正文字符串、原顺序、原因与暂停 generation 保留；不生成新请求或刷新版本。

完整核验先解析两个原查询并匹配 scope、restore_id 和源档案摘要，再重建父恢复历史：验证完整源档案、原事件/身份/内容摘要以及不可变 v1 恢复映射。随后使用同一重新排队 v1 映射重算完整原查询、父恢复文档、父回执、所选记录前后摘要。两个原回执所有字段均须与重建结果深度一致，拒绝额外字段或修改历史标记。最后对规范重建 document 的紧凑 UTF-8 JSON 计算 SHA-256，比对 document_sha256。

document 上限为源档案文件上限（32 MiB+8192）加128 KiB，外层文件再加8192字节；原查询16 KiB、原重新排队回执64 KiB、父回执32 KiB及既有源档案、100000节点/深度64限制同时适用。聚合对象仍可能先触及节点上限；超限整份拒绝，不截断。文件字节摘要与规范 document 摘要分开返回，不把重新排版后的物理字节当作相同文件字节。

单次完整核验采用90秒阶段预算，数据库导出在同一90秒预算内读取并构造文件；文件写入前核验和最终读回各进行完整核验，不承诺整个 CLI 只需90秒。同步 SQL/JSON 不可硬实时打断，文件 I/O、模块加载和数据库打开/关闭不在计算期限内。

## 导出

`outbox restore-requeue-export --outbox EXISTING_FILE --json/--json-file SELECTION --output NEW_FILE`

Bridge `SqliteOutbox.readRestoreRequeueFile` 严格接受 scope/requeue_id；CLI 可补配置 scope，显式范围必须匹配。复用共享存储读取器，在一个只读事务内验证原批次及父历史，返回完整文件；原精确请求查询/幂等重放仍强制比较原完整查询，不因返回父历史而改变语义。

可选表或批次不存在时报 OUTBOX_REQUEUE_RECORD_NOT_FOUND；父历史缺失/损坏、跨项目批次或重复 ID 均拒绝。无原 requeue_id 的旧操作不能导出。缺项不创建文件，也不证明原提交失败。

输出路径在打开数据库前预检。原生只读读取、成功结束读事务并尝试关闭后，冻结完整输出字节，以共享独占临时文件写入/同步/读回/硬链接流程保存，不覆盖既有文件。最终再次读取目标，逐字节、字节数、文件 SHA 和完整逻辑历史全部核验。

成功 local 包含路径、字节数、文件摘要、format=outbox-restore-requeue-receipt-json、verification=exact-final-file-bytes-and-complete-history及清理状态。stdout 仅包含摘要、原选择、outbox、local 和 close_pending，不包含父档案事件正文/租约值。摘要提供 document_sha256、批次/恢复ID、相关摘要、事件数、原时间trace和 get_query。

## 离线读取与原请求提取

`outbox inspect-restore-requeue-receipt --receipt-file FILE` 完整核验后返回元数据及 get_query，不接受 JSON、outbox 或输出路径。

`outbox restore-requeue-file-get --receipt-file FILE --json/--json-file SELECTION [--output NEW_QUERY_FILE]` 严格要求 `{document_sha256,requeue_id}`，两者必须与整份核验后的文件一致，换文件或换批次时报 OUTBOX_REQUEUE_FILE_SELECTION_CHANGED。返回完整原查询/原重新排队回执和摘要；可显式独占保存原七字段请求，使用既有16 KiB请求写入器并最终核对字节/SHA/JSON。提取文件不是新的操作请求，也不包含父档案正文。

离线两入口在通用 receipt-file 限制及环境/令牌读取前分派，不需要项目配置、数据库或网络。输入为稳定普通 UTF-8 文件，可带BOM；拒绝stdin、重复/未知选项、多个JSON来源及额外位置参数。读取结果带 receipt_file 的原路径、原物理字节数/摘要，未请求保存时 local=null。

## 历史与失败状态

摘要 observation=archived-local-requeue-history，archive_integrity=verified；current_queue/current_control/server_delivery=not-checked，source_authenticity/sender_stopped=not-proven，local_commit=not-attempted。这是内容自洽的历史副本，不证明来源真实性、当前队列状态、发送结果或当前进程停止。重新导出有独立观察时间和导出 trace，document_sha256 可能不同，历史原时间保持。

Bridge 读取/构造失败保留 selection、底层详情、已核验 historical_receipt、complete=false 和只读状态。CLI 追加查询、输入/输出定位和 close_pending；保存失败保留历史回执和摘要，底层发布/清理/临时路径状态不被丢弃。最终目标读回失败为 published-unconfirmed，保留目标；不删除或覆盖。关闭失败不抹去读取结果，仍报告待关闭状态。

离线原请求保存失败保留已核验原请求/回执、原文件定位和文件状态。完整提取结果与 CLI 封套各最多128 KiB；保存成功后封套超限保留已保存 local，不能误报未保存。不把文件保存失败解释成原历史提交失败。

本功能仅单批次历史文件；不导入数据库、重新排队、恢复发送或导出当前队列。项目全部批次联合备份、跨设备历史导入、保留管理、来源认证与运行证据仍缺。既有 SQLite 扩展和 PostgreSQL 016–049 仍未执行；所有损坏、换档案、路径竞争、发布/读回/清理及关闭失败场景尚无运行验证。
