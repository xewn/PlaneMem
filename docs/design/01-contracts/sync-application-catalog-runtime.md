# 收件箱已保存应用目录

2026-11-03 开发增量，仅源码和文档；未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行 schema/迁移或发布。无新 schema/依赖，既有 SQLite 扩展和 PostgreSQL 016–049 未执行。关联 ADR-015、T3.4/T4.3、R-005，运行证据仍为空。

## 原消费者与查询

Bridge 新增 `readApplicationCatalog(input,trace)`、`parseInboxApplicationCatalogQuery` 与查询类型 `SyncInboxApplicationCatalogQuery`。CLI 主程序及嵌入入口新增本地 `inbox application-list`。以下仅为说明，未执行或生成文件：

```text
workctx inbox application-list --inbox local-inbox.sqlite --json-file application-catalog-query.json
```

必须提供已有收件箱及 `--json`/`--json-file` 二选一。JSON 只允许完整原 `expected_identity`、可选 `limit`（默认 20，范围 1–50）、`timeout_ms`（默认 30000，范围 1–90000）和 `after_application_key`（64 位小写十六进制）。查询最多 16 KiB，拒绝 application 字段、未知字段、重复选项、`--page-file`、`--output`、令牌、写键和命令行 `--timeout-ms`。身份可来自既有 consumers 输出，不能用当前环境账号替换原身份。

先严格解析再只读打开已有库；缺应用扩展明确失败，不自动初始化/升级、导入、创建应用、请求网络、运行 reducer 或发送确认。目录按原身份隔离，包含已持久保存的通用应用名称/版本，不限于内置 context-item-lifecycle/1；它不是可执行适配器注册表，列出某名称版本不代表 CLI 支持应用或重放它。

## 分页与核对范围

单次只读事务从应用描述表中选择原消费者的最多 limit+1 行，以 application_key 的 SQLite BINARY 顺序升序排列。该键是标准化 `{name,version}` JSON 的 SHA-256；目录按键排序，不按名称、版本大小或最近更新时间排序。续页只读取大于原末项键的成员；首页不设空字符串下界，避免漏过损坏的空/null 键。SQL 先约束键类型/字节和应用描述类型/16 KiB 字节，再解析描述并核对严格名称/版本形状、标准化 JSON 文本及摘要键。

每个选中成员，包括不输出的一条前瞻，均复用完整应用头读取：核对描述、原头步骤与投影 JSON/摘要、原来源页、直接前驱元数据和该页所有事件 ledger，拒绝头之后仍有应用步骤的异常。损坏和未知存储错误保留原类别，不跳过损坏成员、不补空投影。只把已核验成员的摘要加入响应，任何选中项或前瞻失败都不返回部分成功。

响应 `kind=application-catalog`，含原身份/scope、items、limit、after_application_key、has_more、next_query，以及 checked_applications 和 selected_bytes。后两个计数包含前瞻，因此 checked_applications 可能比 items.length 多 1。next_query 包含原身份、期限、页大小及最后一个已输出项的键，前瞻不会被跳过。没有下一页时 next_query=null。

`consistency=keyset-current-state` 表示每次调用读取当前目录和当前头，不冻结跨调用的成员或头状态。新应用排在续页起点之前时，需要从首页重新查看；已有应用的头可在两次调用间推进。起点键不要求仍存在，也不代表此前成员已接受全量核对。空结果只表示本次范围没有应用描述，不证明原消费者存在、此前未应用或不存在孤立步骤/事件；缺描述的孤立行不由目录全表扫描。

## 从摘要继续读取

每项提供 application_key、application（名称/版本）和 checkpoint。checkpoint 含头序号/原页/前驱/投影摘要、投影字节数、起点/应用游标、头页事件数、原页面/应用 trace，不包含投影或事件正文。

同时返回三个完整查询对象，保留原身份和本次时间预算：

- `application_query`：交给 application-status 或 application-audit；重新读取时可观察更新后的应用头。只有固定受支持名称/版本才能交给 application-replay。
- `history_query`：交给 application-history，以目录本次头的序号/原页摘要/投影摘要作为固定上界，从根开始；历史页大小按历史入口默认值处理，不继承目录页大小。
- `snapshot_query`：交给 application-get，指定本次头对应的原页摘要及预期投影摘要，后续即使当前头推进，仍读取该历史快照。

后两个查询由相应入口重新核验，不能把目录结果当作永久存在保证。没有自动调用、自动续页或文件导出；应用目录不提供写入/重放授权，名称版本也不认证执行过的代码。

## 预算、失败和边界

所有选中应用头（含前瞻）的完整原源文档与投影 UTF-8 字节逐应用累计，固定 64 MiB 上限；两个不同应用即使位于同一原页面也分别计费，避免遗漏不同投影。完整 Bridge 响应限 512 KiB，不含 CLI 外包装。超限分别报 `INBOX_APPLICATION_CATALOG_LIMIT_REACHED` 或 `INBOX_APPLICATION_CATALOG_TOO_LARGE`，可降低 limit；不返回截断或部分列表。只保存有界描述/摘要和当前处理中的快照，不缓存所有应用完整投影。预算不等于精确 IO、查询成本或峰值进程内存，相邻原页读取和单页解码仍受既有独立限额。

查询错误为 `INBOX_APPLICATION_CATALOG_QUERY_INVALID`，应用键/描述/目录缺头不一致为 `INBOX_APPLICATION_CATALOG_CORRUPT`；头、原页、ledger、schema 和存储错误保留既有类别。复用应用事务的单调期限/回滚/关闭处理，单次同步 SQL/JSON 不能硬实时抢占。成功关闭失败保留完整结果及 close_pending；失败关闭时保留原错误与关闭标记。

响应明确 application_scope=local-reducer、server_application/source_authenticity/projection_semantics=not-verified、full_application_history_audit/orphan_application_audit/physical_database_audit=not-performed、acknowledgement_dispatch_state=not-sent。选中头检查不替代单应用全历史结构审计、内置历史重放、其他消费者/应用或孤立记录的全库核查。目录不写入、修复、迁移或备份；完整应用导出/恢复、其他业务适配器、正文和真实运行证据仍待补。
