# 重新排队回执元数据目录

2026-11-03，ADR-015，T3.4/T4.3，R-005。仅源码与文档；未编译、类型检查、测试、运行 CLI/Bridge、打开数据库、执行 schema/迁移或发布。

`SqliteOutbox.listRestoreRequeueReceipts(input, trace)` 提供当前项目的重新排队批次发现入口。原请求文件和批次 ID 丢失时，可先浏览目录，再使用返回的 `get_query` 调用已有 `readRestoreRequeueRecord` / `outbox restore-requeue-get`，完整核验历史并显式保存原请求。

## 查询与分页

Bridge 严格接受 `{ scope, limit?, after_requeue_id? }`，拒绝额外字段。scope 为原 tenant/workspace/project，limit 默认 10、整数 1–20；游标必须是有效同步标识，null 不表示首屏。原查询 JSON 上限 16 KiB。

每页在同一只读事务中，以 `requeue_id COLLATE BINARY` 升序读取至多 limit + 1 条。本页和额外前瞻项均验证 ID、严格字节顺序、全库 ID 唯一性及元数据；前瞻损坏也拒绝整页。返回至多 limit 条，`has_more` 表示存在已核验的前瞻项，`next_query` 保留原 scope/limit，游标取最后一条实际返回记录的 ID。末页 next_query=null。游标无需对应仍存在的记录；排序不表示发生时间。

单页 `consistency=single-read-snapshot`，`cross_page_snapshot=not-preserved`。跨页可能发生新增或删除；目录不是全库审计，也不保证遍历期间的完整历史快照。全局唯一性只检查本页及前瞻所选 ID。

## 核验范围与返回

共享固定 SQL 投影限制单个原查询 16 KiB、摘要 64 字节、时间 64 字节、trace 4096 字节、ID 1020 字节，schema_version 必须为整数 1。重新解析完整原查询，校验其规范化 SHA、scope/ID、摘要格式、标准时间及 trace；不把原查询正文、事件列表或原因放入目录响应。

每条记录包括 requeue_id、restore_id、query_sha256、archive_sha256、restore_receipt_sha256、restore_document_sha256、before_sha256、after_sha256、selected_records、requeued_at、requeue_trace_id 和 get_query。标记为 `metadata_integrity=validated`、`linked_history_integrity=not-verified`、`selected_content_integrity=not-verified`。

目录不加载父恢复历史或事件正文，因此摘要格式正确不证明其对应内容正确或仍存在。完整核验须调用 get/receipt；它们继续检查全部原历史、父回执和所选事件前后摘要。既有原操作精确重复的完整请求比对保持不变。

根结果包含 scope/query/records/has_more/next_query/storage/observed_at，`observation=local-requeue-receipt-metadata`；current_queue、current_control、server_delivery 均为 not-checked，local_commit=not-attempted。可选回执表不存在时返回空目录、storage=not-configured；存在则为 available。缺记录或缺表不证明原提交失败，也不能发现旧版无 requeue_id 的操作。

## CLI 与失败状态

`outbox restore-requeue-history --outbox EXISTING_FILE [--json QUERY | --json-file QUERY_FILE]` 使用当前配置项目补全缺省 scope；显式 scope 必须匹配。可省略 JSON 读取首屏。拒绝重复选项、两个 JSON 来源、stdin、额外位置参数、内存库及 --output。

CLI 通过原生 readonly 打开已有库，不回退可写、不创建表。入口沿用本地路由，不请求令牌或服务器；不读写当前队列/控制，不重新排队或恢复发送。完成读取后尝试关闭，保留 close_pending。

Bridge 固定 90 秒检查预算，Bridge 完整结果与 CLI 封套各最多 128 KiB；不返回截断页。同步 SQL/JSON 不能被预算硬实时打断，模块加载、文件 I/O 和打开关闭不在该预算内。数据库读取失败保留 query、selected_requeue_id、底层错误详情、complete=false 和 local_commit=not-attempted；CLI 追加目标路径与关闭状态。输入验证或打开失败发生在读取前；封套超限保留已读取结果。

完整联合备份/跨设备导入、独立回执文件、全量关联历史审计、来源认证及运行证据仍缺。所有分页边界、前瞻损坏、重复 ID、缺表、跨项目、关闭和容量失败场景均未执行验证；既有 SQLite 扩展及 PostgreSQL 016–049 仍未执行。
