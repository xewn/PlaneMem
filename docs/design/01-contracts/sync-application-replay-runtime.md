# 收件箱内置应用历史重放核对

2026-11-03 开发增量，仅源码和文档；未编译、类型检查、测试、执行 CLI/reducer/Bridge、打开数据库、执行 schema/迁移或发布。无新 schema/依赖，既有 SQLite 扩展与 PostgreSQL 016–049 未执行。关联 ADR-015、T3.4/T4.3、R-005，运行证据为空。

## 入口与原范围

Bridge 新增 `replayBuiltInApplicationHistory(input,trace)`、`parseInboxBuiltInApplicationReplayQuery` 和查询类型 `SyncInboxApplicationReplayQuery`。CLI 新增本地 `inbox application-replay`，主程序和嵌入入口共用解析/只读调用。以下仅为文档示例，未执行或生成文件：

```text
workctx inbox application-replay --inbox local-inbox.sqlite --json-file application-replay-query.json
```

必须提供已有收件箱路径和 `--json`/`--json-file` 二选一；完整原 `expected_identity` 与 application 必填；支持 context-item-lifecycle、proposal-lifecycle 或 conflict-lifecycle，version 均为 "1"。严格 JSON 上限 16 KiB，未知字段、重复参数、`--output`、`--page-file`、令牌、写键和命令行 `--timeout-ms` 均拒绝。只支持当前固定内置适配器，其他名称版本报 `INBOX_APPLICATION_ADAPTER_UNSUPPORTED`，不接受自定义 handler 或模块路径。查询/适配器在打开库前确定；只读打开已有库，缺应用扩展明确失败，不自动初始化或升级。

可选预算均为正安全整数：

| 字段 | 默认值 | 最大值 | 含义 |
| --- | --- | --- | --- |
| max_pages | 1000 | 10000 | 完整应用结构的步骤数 |
| max_events | 100000 | 1000000 | 完整应用结构的事件数 |
| max_bytes | 67108864 | 536870912 | 结构遍历的原源文档与保存投影字节 |
| max_replay_bytes | 67108864 | 536870912 | 重算时逐事件输入/输出累计字节 |
| timeout_ms | 30000 | 90000 | 同一次事务的本地等待预算 |

## 同一读取快照内的两阶段核对

先复用 [全应用历史结构审计](sync-application-audit-runtime.md)，从本次应用头核对到根：实际步骤/事件行数、完整原页/投影摘要、所有事件 ledger、前驱/游标/固定原页大小及空事件页不变性。结构损坏或超限时不调用 reducer；不会用正确的最终头替代旧快照核验。

结构阶段完整通过后，只保留有界的步骤序号/原页摘要目录（最多 max_pages），在同一个只读事务内从根正序重新读取各完整步骤。重算初值始终是 JSON null；每个事件的输入是上一个事件的重算输出和原事件的独立 JSON 副本，不采用中间保存快照作为重算基线。每页开始核对序号/前驱/起点/页大小，先确认整页所有事件类型有固定处理器，然后按原事件顺序调用当前内置 reducer。

按所选名称/版本使用 [上下文生命周期适配器](sync-context-item-application-runtime.md)、[建议生命周期适配器](sync-proposal-application-runtime.md) 或 [冲突生命周期适配器](sync-conflict-application-runtime.md)，沿用各自创建基线、状态迁移、分类/来源规则和 512 实体上限；上下文固定忽略九类范围外事件，建议与冲突各固定忽略十二类。未知类型明确失败；Promise/thenable、非法 JSON 或超大投影拒绝。每个重算输出仍限 1 MiB，每页重算输入和输出累计仍限 64 MiB；返回异步值时接收其后续 rejection，但结果不参与核对。

每页末校验重算投影与该页游标，再严格比较重算 JSON 文本与保存投影文本，包括空页和只有范围外事件的页。首个正序不匹配页报错，携带该页序号/原页摘要及保存/重算投影摘要，不返回两份业务正文。字节比较有意保留序列化差异，不把“对象看似等价”当作原保存结果一致。最后须核对重算页数/事件数、末页摘要/游标和最终完整投影均等于结构阶段的应用头。

第二遍的 ledger 依据第一遍已完整核验的同一读取快照，不再逐事件重复查询。仅保留当前头、处理中的完整步骤和重算投影，不累计缓存所有快照。两遍读取和适配器内部 JSON 校验有额外成本；两个字节预算不是数据库 IO、处理器工作量或进程内存的精确上限。累计重算预算计入每次调用前的投影/事件文本及返回后的投影文本；错误时 replayed_bytes/page_replay_bytes 可包含使预算超限的那次计费。空事件页不计重算输入/输出字节，仍受结构和期限预算约束。

## 成功语义与失败进度

成功结果为 `status=complete`、`replay_completed=true`、`structure_completed=true`、`replay_scope=current-built-in-application-history`。保留原身份/应用、当前头的完整 state、根摘要、结构计数、重算计数/累计字节、最终重算摘要、适配器声明和全部预算。没有应用且没有孤立步骤/事件时完成空历史，计数为零、state.recorded=false、投影为 null；这不证明消费者应当为空或远端没有新事件。完整 Bridge 响应限 2 MiB，不含 CLI 外包装。

仅本次返回的 `full_application_history_audit=verified-structure`、`reducer_replay=verified-current-built-in` 和 `projection_semantics=matches-current-built-in-replay` 表示每一页与当前随程序提供的内置规则相符。state 同时带本次结构/重算标记，普通 status/history/get 仍保留其原有范围；不把核对标签写入数据库。

`server_application/source_authenticity=not-verified`，收到但尚未应用的后缀、确认日志和全库物理状态均不在范围。应用名称版本不认证旧执行代码，当前代码重算相符不证明旧版本实现、服务端实体内容或事件来源可信；对同名同版本实现的变更仍可能产生不匹配。不包含完整上下文正文，不提供自动迁移、历史修复、导出/恢复或发送确认。`history_update=not-performed`、`acknowledgement_dispatch_state=not-sent` 始终明确。

主要错误包括：

- `INBOX_APPLICATION_REPLAY_QUERY_INVALID`：身份/应用/查询字段或预算不合法；适配器不支持保留专用错误。
- 既有结构/原页/ledger 错误：结构阶段失败，重算尚未开始；保留结构检查进度，另有 structure_stage/structure_selected_digest。
- `INBOX_APPLICATION_EVENT_UNSUPPORTED` 或固定 `INBOX_CONTEXT_ITEM_*` / `INBOX_PROPOSAL_*` / `INBOX_CONFLICT_*`：当前内置规则不接受指定事件或生命周期。
- `INBOX_APPLICATION_REPLAY_MISMATCH`：重算与保存快照不同，附两个摘要和首次正序不匹配页。
- `INBOX_APPLICATION_REPLAY_LIMIT_REACHED`、`INBOX_APPLICATION_TIMEOUT`：累计/单页预算或期限不足，明确未完成。
- `INBOX_APPLICATION_REPLAY_CORRUPT`、`INBOX_APPLICATION_REPLAY_REDUCER_FAILED`、`INBOX_APPLICATION_REPLAY_RESULT_TOO_LARGE`：重复读取/覆盖异常、处理器返回异常或完整结果过大。

事务内失败 details 包含 replay_completed=false、原身份/应用/预算、可用的结构/重算进度、阶段和所选页/事件；计数只表示已处理前缀，不表示部分通过。schema/BEGIN 之前失败可能没有进度。replayed_pages 只统计已逐页匹配的页，replayed_events 可包含尚未完成整页比较的事件。业务拒绝使用固定诊断，不回显任意异常正文。复用单调期限及事务/回滚处理，同步 SQL、JSON 或 reducer 无法硬实时抢占；结束读取事务失败仍返回失败并保留计数。CLI 关闭失败保留原错误或完整成功结果与 close_pending。

本轮未实际执行任何重放或数据库操作，尚需将来取得空历史、多页、旧快照自洽但语义不符、未知类型、版本断档、预算/超时及关闭失败的运行证据。上下文、建议和冲突以外的业务适配器、完整正文、权限变化重建及真实恢复证据继续待补；既有通用应用归档/恢复不认证 reducer 语义。
