# 发送队列新恢复请求准备与保存

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档；未编译、类型检查、测试、运行 CLI/Bridge、打开数据库、生成样本、执行迁移或发布。无 schema、依赖或事件档案格式变化。

## 入口与输入

`workctx outbox restore-prepare --outbox EXISTING_FILE --archive-file ORIGINAL_ARCHIVE --json-file PREPARATION --output NEW_QUERY_FILE`

Bridge 入口为 `SqliteOutbox.prepareArchiveRestore(archive, preparation, trace)`。preparation 严格只有 scope、restore_id、reason 三字段；scope 使用既有项目范围解析，restore_id 必须是有效同步标识符，reason 非空、最多1024个UTF-16单元且无控制字符或孤立代理项。输入最多16 KiB。CLI 可省略 scope，取调用开始时复制的配置项目；显式提供必须匹配。必须由调用方选择新 ID，拒绝完整旧恢复查询中的 archive_sha256/expected_control_generation 等额外字段，不静默刷新旧请求。

CLI 必需两个位置参数、已有文件 --outbox、普通原事件档案 --archive-file、一种 --json/--json-file 及新输出 --output。禁止重复/未知参数、额外位置参数、空路径、stdin、内存库和覆盖输出。JSON文件为稳定普通UTF-8，可带BOM，最多16 KiB。历史备份文件本身不是事件档案，应先通过 [备份离线提取](outbox-restore-backup-access-runtime.md) 取得一份原事件档案。

输出路径在打开数据库前预检；完整核验源档案及配置项目后，原生只读打开已有队列，无网络或令牌访问。

## 同一个读快照内的条件

1. 完整验证源事件档案及项目范围，遵守既有1000条/32 MiB文档、文件32 MiB+8192和JSON节点/深度限制。
2. 检查可选回执表，按全库 BINARY restore_id 判断占用。任何已占用ID均报 OUTBOX_RESTORE_ID_UNAVAILABLE，包括同请求、已导入历史或其他项目；不需要加载或披露占用者正文。缺回执表不会创建表。
3. 读取并校验当前控制，必须是paused且有有效generation；缺表/缺行视为running并拒绝。不会自动暂停目标。
4. 用调用方scope/restore_id/reason、完整档案的document_sha256和本次暂停generation，经既有五字段解析器生成 restore_query。
5. 与实际恢复共用目标检查：暂停版本一致、目标项目无事件、源event_id及idempotency_key全库可用。使用与预览共享的不可变v1映射生成完整归一档案和统计，再检查序列化限额。

成功返回 mode=prepare、observation=local-restore-preparation、action=prepared、preparation、restore_query、observed_at、源摘要/原时间/trace、current_control 和 plan。plan沿用 [恢复前预览](outbox-restore-preview-runtime.md) 的记录/状态/待处理/终态/清租约/预计字节数。非终态变为failed并标记待审阅，原sent/conflict保留，所有租约清空；不输出事件正文或租约值。

明确 current_queue=checked-empty、restore_id_reserved=false、local_write=not-attempted、future_execution=rechecks-required、server_delivery=not-checked、sender_stopped=not-proven。这里的local_write描述数据库；CLI另行显式写请求文件。不生成恢复回执、不预留ID、不证明旧发送者已经停止。

## 请求文件与失败状态

读事务结束并尝试关闭数据库后，CLI把完整 restore_query 保存成紧凑UTF-8 JSON，最多16 KiB，可直接传给既有 restore-preview/restore 的 --json-file。冻结原字节后沿用独占临时文件、同步、读回和硬链接发布，不覆盖目标；最后有界读回核对长度、逐字节、SHA和JSON。成功local包含path、file_bytes、file_sha256、format=outbox-restore-query-json、verification=exact-final-file-bytes-and-json及清理状态。

Bridge失败保留原错误详情、preparation、已构造的restore_query、stage和selected_event_id及读取回滚信息；CLI追加原输入/档案路径、源文件字节数和SHA、输出路径与close_pending。准备失败不保存查询；读取成功后关闭失败仍可保存，并明确close_pending。保存/结果序列化失败保留prepared完整计划和查询、底层文件/临时路径及清理状态；最终读回失败为published-unconfirmed，不删除目标或声称未保存。成功的完整CLI封套最多128 KiB，若保存后超限，错误保留已保存local结果。

固定90秒预算覆盖Bridge源验证、读事务、计划及结果；同步SQL/JSON无法硬实时打断。文件I/O和数据库打开/关闭在预算外。Bridge结果也限128 KiB。

实际恢复在新的写事务中重新核验所有条件。准备成功到实际恢复之间，控制、事件和ID均可能变化；旧请求的未知提交应使用原 restore-receipt/restore-get 查询，不重新准备替换。历史导入后的ID依然是历史记录，不能用其原请求重新灌入事件。

非空队列合并、旧发送者协调、批量激活、跨项目发现、来源认证和完整恢复运行证据仍缺。暂停/非空/全局冲突/导入ID、参数严格性、并发变化、归一容量和文件失败状态均未执行验证。
