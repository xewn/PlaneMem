# 待应用原页发现（开发契约）

2026-11-03：仅源码和文档，未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、初始化 schema、迁移、生成样本或发布。无新增依赖、共享 wire 格式或 schema；R-005 仍未完成。

## 查询与入口

`readBuiltInApplicationPendingPages(input, trace)` 与 `workctx inbox application-pending --inbox FILE --json-file QUERY`（也可使用 `--json`）发现紧接当前应用头的已接收、尚未应用页面。输入包含完整原 `expected_identity`、`application:{name,version}`，可选 `limit`（默认 20，1–50）和 `timeout_ms`（默认 30000，1–90000 毫秒）。查询上限 16 KiB，未知字段拒绝；不接受页面摘要、跳过序号或续页游标。

固定支持 `context-item-lifecycle/1`、`proposal-lifecycle/1` 和 `conflict-lifecycle/1`。CLI 在打开数据库前完成查询与适配器名称版本校验，随后以 `create:false`、`readonly:true` 打开已有收件箱。已有 application 扩展必须完整；缺扩展或部分结构失败，不隐式初始化。没有该消费者或应用且没有孤立记录时，可以返回空接收检查点或空应用检查点。

主程序和嵌入 CLI 都使用本地入口，无当前账号、凭据、Gateway 或网络请求。CLI 只接受 inbox 路径和一种 JSON 输入方式；拒绝 stdin、未知/重复选项、`--output`、`--receipt-output`、`--page-file`、`--key` 和 `--timeout-ms`。本入口不导出文件。

## 同一只读事务

Bridge 在一次 `BEGIN` 读事务中先核验应用头/投影字节摘要、直接前驱及当前页事件 ledger，再核验接收头、原身份、完整原页及直接接收前驱。应用头不能晚于接收头；源页 limit 保持一致，若两者序号相同则必须是同一页。

从应用头后的序号开始最多读取 `limit+1` 条元数据，按序号排序。每一页（含前瞻页）都完整读取并核对原摘要/身份/序号、前驱摘要、from_cursor 与前页 next_cursor 及原 page_limit。发现缺页、重复序号、错误前驱或游标立即失败，没有部分成功。窗口到达接收头时，再核对最后摘要/序号/游标；不存在接收头时仍通过既有孤立源页检查。

返回窗口依赖页序号，不按游标大小过滤。空终页可能与前页游标相同，仍是需要显式应用的下一步骤。既有 apply 的精确原页、预期前驱与原子写入规则不改变。

## 输出与后续使用

Bridge 输出完整原身份、application、scope、本次 trace、`status=listed`、`kind=application-pending-pages` 和 `listing_completed=true`；CLI 放入 `data`，补 inbox 路径，关闭后补顶层 `close_pending`。

| 字段 | 含义 |
| --- | --- |
| `application_checkpoint` | 已核验应用头摘要、序号、投影摘要/字节数、游标和原应用 trace；无应用头时 null，不输出完整投影。 |
| `received_checkpoint` | 当前接收头的原页摘要、序号、游标、原 limit、事件数和原页 trace；无消费者时 null。 |
| `pending_page_count` | 接收检查点序号减应用检查点序号，`count_basis=checkpoint-sequence-difference`；是检查点推导值，不是扫描全部剩余行得到的完整审计计数。 |
| `items` | 当前应用头后最多 limit 个连续原页摘要；不输出事件正文。 |
| `has_more` | 是否存在并完整核验了窗口后一页；不证明更远未读后缀完整。 |
| `checked_pending_pages` | 本次完整核对的待处理页数，包含前瞻页，可能比 items 数多一。 |
| `checked_bytes` | 去重后的应用头原页、接收头原页及所选待处理页规范文档 UTF-8 字节累计。 |
| `next_apply_query` | 只针对 items 首页生成的完整原身份/应用/期限/页面摘要/预期前驱；没有待处理页时 null。 |
| `pending_query`、`refresh_query` | 规范化本次查询，可在显式应用推进后重新读取窗口。 |

调用方可将 `next_apply_query` 交给 [原页应用预览](sync-application-apply-preview-runtime.md) 或显式 `application-apply`。列表不执行 reducer、不检查事件业务转换或重放旧投影，因此始终标记 `application_readiness=requires-preview-or-apply`、`reducer_execution=not-performed`。所选页面可能随后因缺基线、版本断档或其他业务原因被拒绝。不会为较后页面生成允许越过首个待处理页的执行凭据。

`continuation=refresh-after-explicit-application`：本入口提供待处理窗口，不提供跳页分页。未推进应用时重复同一查询会返回同一待处理起点；希望单独浏览更远历史可使用既有 `page-history`，其结果不改变应用前置条件。另一进程可能在列表后推进应用或继续导入，`consistency=current-read-snapshot` 不冻结未来状态；预览和 apply 仍重新校验原请求。

## 边界与失败

所选不同原页文档累计最多 64 MiB，包括两个检查点及前瞻页；既有逐页解码及相邻前驱读取继续使用各自有界规则，不把这个去重字节数声称为累计 I/O 总量。应用投影仍受原 1 MiB 限制，完整 Bridge 结果与包装/关闭后的 CLI 响应分别最多 512 KiB。超限不截断、不返回部分窗口；可显式减小 limit。事务检查使用单调期限，单次 SQL/解析不能被硬实时抢占，CLI 文件/模块读取与打开关闭连接不计入事务期限。

查询无效使用 `INBOX_APPLICATION_PENDING_QUERY_INVALID`；未知内置名称版本沿用 `INBOX_APPLICATION_ADAPTER_UNSUPPORTED`。检查点或所选后缀不一致使用 `INBOX_APPLICATION_PENDING_CORRUPT` 或原底层页/应用损坏码；字节预算和响应上限分别使用 `INBOX_APPLICATION_PENDING_LIMIT_REACHED`、`INBOX_APPLICATION_PENDING_TOO_LARGE`。存储/超时/读事务结束失败沿用原安全错误和回滚状态。

解析成功后的错误保留 `pending_query`、`listing_completed=false`、阶段、已核对页数/字节，适用时保留所选序号/摘要；CLI 打开后失败尝试关闭再补 `inbox/close_pending`。打开失败无连接关闭阶段。CLI 最终响应过大时为 `listing_completed=true`、`response_completed=false`，明确读事务已完成而完整响应未交付。错误不包含事件正文或原始存储异常。

`local_write_state=not-performed`、`acknowledgement_dispatch_state=not-sent`、`received_history_audit/full_application_history_audit=not-performed`、`server_application/source_authenticity/projection_semantics=not-verified` 保留检查范围。列表不写页面/投影/ledger/回执，不确认或自动应用，也不替代完整原页链审计、应用历史审计或重放。

缺基线恢复、其他业务适配器、权限变化重建、跨设备恢复以及运行证据仍缺；本增量不代表完整同步闭环已通过验证。
