# 发送队列分页与完整详情（开发契约）

2026-11-03：只开发源码与文档。未编译、类型检查、测试、运行 CLI/API、打开 SQLite、执行迁移或发布。无新依赖/schema/迁移；既有 SQLite 原身份列升级和 PostgreSQL 016–049 仍未执行，R-005 未完成。

## 本地读取入口

Bridge 新增 `SqliteOutbox.listRecords(input, trace)`、`readRecord(scope,event_id,trace)` 和 `{readonly:true}` 构造选项。readonly 自动要求已有正规队列文件、拒绝文件符号链接，沿用已有列检查，并设置 SQLite `PRAGMA query_only = ON`；不创建目录/文件、初始化表或自动升级旧队列。缺列报 OUTBOX_UPGRADE_REQUIRED。query_only 是连接级写入限制，不是操作系统文件只读打开；SQLite 自身锁/日志行为及并发文件替换边界不因此改变。

CLI 将既有 `outbox list` 接到有界摘要分页，新增 `outbox get EVENT_ID`。两入口均在网络主程序与嵌入 `runWorkctx` 中处理，只使用配置的三层项目范围，不需要令牌，也不调用 router、Gateway 或 SDK。路径继续采用 --outbox、WORKCTX_OUTBOX、默认 ~/.workctx/outbox.sqlite 的顺序，但缺文件不再自动新建。

仅展示语法，未执行：

```text
workctx outbox list --outbox existing.sqlite
workctx outbox list --outbox existing.sqlite --json '{"status":"failed","limit":20}'
workctx outbox list --outbox existing.sqlite --json-file saved-next-query.json
workctx outbox get ORIGINAL_EVENT_ID --outbox existing.sqlite
```

list 可选 --json/--json-file 二选一，不传等于 `{}`。文件须为稳定正规 UTF-8 JSON，最多 16 KiB；内联文本同样有上限。get 只接受一个 event_id 与可选 outbox，拒绝 JSON。两入口均拒绝 stdin、写键、output、limit 命令行选项、其他/重复选项或多余位置参数；limit 放在 list JSON 中。输入和范围在打开库前验证。

## 分页摘要

Bridge 查询包含 `scope:{tenant_id,workspace_id,project_id}`，可选 `limit`（默认 20、1–50）、`status`（pending/sending/sent/failed/conflict）、`after_event_id`。严格拒绝未知字段，scope 三项必须 ULID。CLI 首次未给 scope 时使用当前配置；返回 next_query 总是包含原 scope、有效 limit、适用 status 和末项 event_id。调用者传回含 scope 的查询时必须与当前配置一致，否则 OUTBOX_READ_SCOPE_MISMATCH，不把旧续页悄悄用于新项目。

SQL 在项目/适用状态内按原 `local_events.event_id COLLATE BINARY` 升序，只选择 limit+1 条；续页比较使用同一数据库排序规则，不在 JavaScript 里用 UTF-16 字符串比较 Unicode ID。首屏不附加空字符串下界，损坏的空/null ID 不被首屏谓词隐藏。重复 ID 或选中行的非法元数据明确报 OUTBOX_RECORD_CORRUPT；不省略它继续返回“正常”页。

SQL 投影对元数据按类型/字节限制：ID/事件类型等最多 1020 字节，原账号/客户端、trace、错误文本和本地键各最多 4096 字节，范围 26 字节、时间 64 字节、摘要 71 字节；数字先检查为合法范围整数后才返回。正文只读取 payload/source_refs 的存储类型和字节数，不加载 JSON 正文。无新索引，LIMIT 和投影只约束应用返回量，不宣称数据库扫描/排序成本恒定。

每项包含 event_id、event_type、状态/尝试/调度、原 trace、expected_identity、identity_state、正文/引用字节数、last_error、已保存投递引用和 send_lease。缺原账号/客户端的旧行可以列为 identity_state=missing；部分/非法身份拒绝，不推断当前账号。send_lease 根据本次 observed_at 及现有 sending/next_retry_at 规则报告 active/expired/none，只是当时的本地元数据；不证明网络请求已停止，也不授予重试权限。

列表正文为 original_content=not-validated；展示元数据并不证明 payload/refs JSON、内容摘要或远端回执有效。返回 items、limit、status、after_event_id、has_more、next_query、observed_at、consistency=keyset-current-state、database_integrity=not-audited，完整分页数据最多 512 KiB。超限报 OUTBOX_LIST_TOO_LARGE，要求选择较小 limit，不返回部分页。

单次页面在一个 BEGIN/COMMIT 读取事务内取得，不持有 BEGIN IMMEDIATE 写锁。跨调用不冻结成员或状态：新增到旧游标之前的记录、状态切换及删除可能改变后续可见集合；续页无需旧边界行仍存在，也不提供全队列审计或一致性备份。has_more 只描述本次快照，next_query=null 表示该次读取已到末尾。

## 完整原记录

get 在原项目/精确 event_id 内选择原记录，不回退到其他项目/最近记录。SQL 最多取两条有界候选，若损坏结构下出现重名则报 OUTBOX_RECORD_CORRUPT，不任取第一行。没有记录返回 event=null、summary=null、original_content=not-found；这不证明事件未投递或可重发。存在时完整投影按类型/长度限制 payload/source_refs（各最多 1 MiB），随后核对全部受限元数据，复用原命令、完整身份、payload checksum 和 command_checksum 校验；保留原本地键、trace、状态、尝试/调度和适用投递引用。返回 event、summary、original_content=validated 及 observed_at，完整详情数据上限 2 MiB + 16 KiB。

JSON 损坏报 CORRUPT_RECORD，元数据不符报 OUTBOX_RECORD_CORRUPT，缺身份报 OUTBOX_IDENTITY_REQUIRED，摘要/完整命令不符报 CHECKSUM_MISMATCH，超出详情上限报 OUTBOX_RECORD_TOO_LARGE。没有空 payload/refs 替代值或自动修复。validated 仅表示本地内容检查，不是服务器签名、实体应用证明或远端投递确认。

读取活跃 sending 允许展示原记录；原 reconcile 仍通过独立租约门禁拒绝活跃发送，两者共享原内容检查但不共享“是否可操作”结论。列表/详情不 claim、retry、结算或修改调度。旧 `inspect(scope?)` 保留兼容及原诊断行为，不能用于恢复原内容；CLI 新入口不再调用它。

## 兼容与错误

CLI list 的 data 从旧全量 LocalEvent 数组改为分页对象，顺序从 rowid 改为 event_id。旧消费者/Mock/fixture 必须显式迁移到 data.items、next_query 和单条 get；没有自动全量翻页或兼容数组回退。新 list/get 成功（包括空页/详情未找到）退出 0，错误退出 1，用法错误退出 2。

读取失败尝试回滚，只回滚本次成功开启的事务；回滚失败保留原错误并标 rollback_pending。原始存储错误正文不直接透传。CLI 总会尝试关闭，已取得完整结果时关闭失败只补 close_pending，不抹去数据；读取错误与关闭错误同时发生时保留原错误和关闭标记。没有执行实际 SQLite/CLI 来证明上述行为，连接清理、锁竞争、旧库、并发成员变化、异常注入和大数据成本均仍缺运行证据。
