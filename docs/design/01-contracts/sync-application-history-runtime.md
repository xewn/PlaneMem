# 收件箱应用历史浏览与指定快照

2026-11-03 开发增量，仅源码和文档，未编译、类型检查、测试、运行 CLI/Bridge、打开数据库、执行 schema/迁移或发布。沿用应用扩展 v1，没有新 schema 或依赖。关联 ADR-015、T3.4/T4.3、R-005；运行证据仍为空。

## 原身份与只读入口

Bridge 新增 `readApplicationHistory(input, trace)`、`readApplicationSnapshot(input, trace)` 及对应严格查询解析器。两者均要求完整原 `expected_identity` 和 `application={name,version}`，可选 `timeout_ms`（默认 30000、范围 1–90000）。查询只接受声明字段，JSON 上限 16 KiB，摘要必须为 64 位小写十六进制。

CLI 新增以下本地入口，示例仅供说明，未执行或生成查询文件：

```text
workctx inbox application-history --inbox local-inbox.sqlite --json-file application-history-query.json
workctx inbox application-get --inbox local-inbox.sqlite --json-file application-selection-query.json
```

均须显式指定已有收件箱，并且恰好提供 `--json` 或 `--json-file`。打开数据库之前解析查询，随后只读打开；拒绝 `--output`、`--page-file`、令牌、写键、`--timeout-ms` 和重复选项。主程序及嵌入入口同步支持，不自动创建/启用扩展、分页、执行 reducer、请求网络或发送确认。

## 固定范围分页

首页可只给原身份和应用，`after_sequence` 默认为 0，`limit` 默认为 20、范围 1–50。首次读事务内以当前应用头作为上界，返回 `through_sequence`、`through_sha256`（原页摘要）及 `through_projection_sha256`。没有应用且没有孤立步骤/事件时返回空列表，上界序号为 0、两个摘要为 null，不生成续页查询。

显式指定上界时须同时提供上述三个字段且序号为正整数。续页的 `after_sequence>0` 必须同时携带 `after_sha256`、`after_projection_sha256` 和完整上界。起点不能超过上界；二者序号相同时两个摘要也必须分别相同，此时返回空列表。零起点禁止提供 after 摘要；未提供上界时禁止单独提供上界投影摘要。响应中的空上界 null 不是合法输入上界。

在同一只读事务中核验当前头、已保存起点及上界，再按原消费者/应用的序号递增查询最多 `limit+1` 个摘要。所选每个步骤（包括不输出的一条前瞻）均完整核对原页、投影 JSON/摘要、直接前驱元数据及该页事件 ledger。列表连续区间还核对序号、前驱摘要、起止游标、固定原页大小；空事件页必须保持上一项投影，根的初始投影为 JSON null。终页必须抵达原上界，不把缺页当作正常结束。

每项只返回序号、原页/前驱/投影摘要、投影字节数、起点/应用游标、事件数及原页面/应用 trace。`selection_query` 保留原身份、应用、时间预算、精确页面摘要及预期投影摘要，可直接用于详情入口。`has_more` 由已核验前瞻决定，`next_query` 绑定最后一个已输出项及原上界，绝不跳过前瞻。

`current_checkpoint` 独立返回本次读取时的应用头摘要，可能比固定上界更新。`consistency=fixed-boundaries-current-read` 表示每次调用重新读取当前数据库，并核对保存的边界；它不冻结跨调用数据库快照。缺失或摘要/序号不匹配的已保存边界报 `INBOX_APPLICATION_HISTORY_BOUND_CHANGED`；步骤本身损坏可先报既有应用/原页错误。固定边界无法证明中间历史从未被离线重写，摘要也不认证数据来源。

## 指定历史快照

详情查询须包含 `document_sha256`，可选 `expected_projection_sha256`。按原身份/应用精确读取该页的应用步骤；成功包含 `found=true`、`snapshot` 的上述摘要和完整 `projection`，同时提供独立当前头摘要。历史快照读取不回退应用头，也不把旧投影替换为当前投影。

没有相应应用步骤时返回 `found=false,snapshot=null`，即使提供预期投影摘要也保留此缺失语义；接收页存在不代表已经应用。存在但投影摘要与预期不符时报 `INBOX_APPLICATION_SNAPSHOT_CHANGED`。所选步骤及当前头仍需通过原页、投影摘要、直接前驱元数据和事件 ledger 核验；详情不遍历所有祖先、不额外读取前驱完整投影来证明空页不变性，也不执行任何业务 reducer。

## 预算、错误与范围

当前头、边界、选中项和前瞻按不同原页摘要累计源文档与投影 UTF-8 字节，固定上限 64 MiB，超过报 `INBOX_APPLICATION_HISTORY_LIMIT_REACHED`。摘要集合仅用于去重，不缓存全部完整快照；仍保留当前头、边界和处理中的有限快照。累计预算不是数据库实际 IO、查询成本或进程峰值内存的精确上限，重复解码和相邻原页读取另受既有单页约束。列表摘要结果（不含外层身份/CLI 包装）上限 512 KiB；完整详情结果（不含 CLI 包装）上限 2 MiB，后者超限报 `INBOX_APPLICATION_SNAPSHOT_TOO_LARGE`。可降低列表 limit 重试，不返回部分成功。

查询解析错误分别为 `INBOX_APPLICATION_HISTORY_QUERY_INVALID`、`INBOX_APPLICATION_SNAPSHOT_QUERY_INVALID`；列表断链或区间不一致报 `INBOX_APPLICATION_HISTORY_CORRUPT`，底层损坏保留已有错误类别。复用单调期限、只读事务和关闭处理，同步 SQL/解析不能被硬实时抢占，回滚/关闭失败保留原错误或已知完整结果及 pending 标记。

两个响应均明确 `application_scope=local-reducer`、`server_application/source_authenticity/projection_semantics=not-verified`、`full_application_history_audit=not-performed`、`acknowledgement_dispatch_state=not-sent`。列表仅核验选定区间及边界，详情仅核验选定步骤和当前头，均不取代 [全应用历史结构审计](sync-application-audit-runtime.md)。未提供业务语义重放、全文内容、导出/恢复、其他应用目录、确认日志审计或全库物理校验，页面链归档仍不包含应用快照。
