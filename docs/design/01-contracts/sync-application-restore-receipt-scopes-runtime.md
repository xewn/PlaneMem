# 跨消费者、跨应用的恢复回执目录

2026-11-03 开发增量，仅源码和文档，关联 ADR-015、T3.4、T4.3、R-005。未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行扩展或迁移、生成样本或发布。无新 schema/依赖，运行 evidence 为空。

新增 Bridge `listApplicationRestoreReceiptScopes(input,trace)`、解析器 `parseInboxApplicationRestoreReceiptScopesQuery` 和 CLI `inbox application-restore-receipt-scopes`。调用方遗失原消费者身份或应用描述时，可从已有本地回执恢复这些参数，再接[范围内请求 ID 目录](sync-application-restore-receipt-catalog-runtime.md)和[完整回执读取](sync-application-restore-receipt-selection-runtime.md)。

目录直接来自独立恢复回执表。合法的 empty 恢复可以留下回执，却没有消费者行或应用头；因此本目录不依赖 consumers/application-list 的成员，不通过当前账户筛选，不要求当前投影存在。

## 输入与读取

查询最多 16 KiB，空对象合法，仅接受以下字段：

| 字段 | 规则 |
| --- | --- |
| limit | 默认 20，安全整数 1–50 |
| timeout_ms | 本次读取预算，默认 30000，安全整数 1–90000 |
| after_consumer_key | 可选排他二元下界的第一部分，64 位小写十六进制 |
| after_application_key | 与 after_consumer_key 成对提供，64 位小写十六进制 |

不接受 expected_identity、application、请求 ID、归档摘要、目标约束或未知字段。CLI 要求 --inbox 与 --json/--json-file 二选一；不接受 output/receipt-output、归档/页面/回执文件、key、独立 timeout 开关、stdin 或重复选项。查询在打开库前解析；主程序和嵌入入口使用同一路径，不请求网络。

readonly/create:false 打开已有库，要求完整 core/application/receipt 扩展，不隐式初始化或修复。在单个只读事务中，按 consumer_key、application_key 的二元 BINARY 升序选择至多 limit+1 个不同范围；首笔没有人为下界。SQL 在输出到 JavaScript 前限制键和代表请求 ID 的类型/字节数，随后核对规范键、有效 ID 和严格递增顺序。

每个选中范围以请求 ID 的 BINARY 最小值选择一份代表回执。完整复用既有规范 JSON、64 KiB 回执上限、回执/原查询 SHA、身份/应用摘要键、ID、原 trace、计数及目标关系校验。额外前瞻范围的代表回执也必须完整通过，缺失或损坏时报错，不跳过、不返回部分成功页。代表 ID 不是最新恢复或最近提交。

最多返回 50 项，最多完整读取 51 份代表回执。limit 约束输出和完整回执数量，不保证数据库查找不同范围所需的扫描、分组或排序工作量。读取预算在各阶段检查，不能硬实时中断同步 SQL 或磁盘等待，也不包括模块加载和打开/关闭连接。

## 结果与续页

Bridge 结果和 CLI 外层 envelope 的 scope 均为 null，不伪造一个共同身份。每条提供 consumer_key、application_key、从已校验回执恢复的完整 expected_identity 和 application、representative_request_id，以及：

- receipt_list_query：原身份、应用、当前读取预算和默认 limit=20，可交给 application-restore-receipt-list。
- receipt_get_query：原身份、应用、代表 ID 和当前读取预算，可交给 application-restore-receipt-get。

这些是后续读取查询，本次预算不会覆盖回执保存的原恢复期限。条目不包含完整回执或当前投影，也不执行后续读取。

结果包含 catalog_completed=true、items、limit、两个 after 键（首笔为 null）、has_more、next_query。续页保留本次 limit/timeout_ms，以最后一条**已返回**项的二元键为排他下界；不能使用未返回的前瞻键。末页或空目录 next_query=null。checked_representative_receipts 和 selected_receipt_bytes 包含前瞻，后者只统计规范回执 JSON 字节，不代表物理 IO 或峰值内存。

catalog_coverage=representative-per-selected-scope-and-lookahead；full_receipt_history_audit 和 full_application_history_audit 均为 not-performed。完整核验一份代表回执不证明同范围内其他记录均有效。current_state=not-read，receipt_scope=historical-local-transaction，absence_proves_rollback=false，local_write_state=not-performed，acknowledgement_dispatch_state=not-sent；不认证来源、服务器状态或业务投影语义。

以下仅为命令说明，未执行或生成文件：

```text
workctx inbox application-restore-receipt-scopes --inbox local-inbox.sqlite --json '{}'
workctx inbox application-restore-receipt-list --inbox local-inbox.sqlite --json-file selected-receipt-list-query.json
```

第二步使用某条 receipt_list_query；翻范围页则使用完整 next_query。命令不自动翻页或保存查询。

## 一致性、失败与剩余范围

order=consumer-key-application-key-binary-ascending，consistency=keyset-current-state。每页是独立读取快照，没有跨命令冻结成员或数据库实例绑定。页间插入、库替换或还原可以改变后续观察；位于已越过下界之前的新范围不会出现，已有范围增加非代表回执也不改变目录位置。续页下界无须当前存在，不能据目录缺失证明未知恢复已回滚。

无效查询、范围/排序/代表选择异常、响应超限分别使用 INBOX_APPLICATION_RESTORE_RECEIPT_SCOPES_QUERY_INVALID、SCOPES_CORRUPT、SCOPES_TOO_LARGE（后两者同前缀）。完整回执损坏、缺扩展、超时和存储失败保留原错误类别。

Bridge 完整结果限 512 KiB，CLI 加入路径及关闭状态后再次限制 512 KiB；超限提示降低 limit，不截断身份或输出部分续页。失败保留 catalog_query、catalog_completed=false 和不写入状态；CLI 另保留路径和 close_pending。仅最终 CLI 响应超限时，读取已完成，标记 catalog_completed=true、response_completed=false。关闭失败单独报告，不抹去已完成读取。

仍缺完整回执历史审计、数据库实例绑定、来源认证、不同历史合并及并发/崩溃/跨设备运行证据。R-005 保持未完成。
