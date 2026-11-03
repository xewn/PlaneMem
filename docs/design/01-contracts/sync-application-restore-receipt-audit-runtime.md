# 应用恢复回执完整范围审计

2026-11-03 开发增量，关联 ADR-015、T3.4、T4.3、R-005。仅修改源码和文档，未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行扩展/迁移、生成样本或发布。无新 schema/依赖，evidence 为空。

新增 Bridge `auditApplicationRestoreReceipts(input,trace)`、解析器 `parseInboxApplicationRestoreReceiptAuditQuery` 和 CLI `inbox application-restore-receipt-audit`。在一次只读事务内检查指定原消费者和应用的全部本地历史恢复回执。与目录中的当前页或代表回执核验范围不同，本接口只有在预算内完成全范围核验并成功结束读取事务后才返回成功。

## 查询与入口

查询最多 16 KiB，要求完整原 expected_identity 和 application={name,version}，可选以下字段；未知字段拒绝：

| 字段 | 默认值 | 范围 |
| --- | --- | --- |
| max_receipts | 1000 | 安全整数 1–10000 |
| max_bytes | 67108864（64 MiB） | 安全整数 1–536870912（512 MiB） |
| timeout_ms | 30000 | 安全整数 1–90000 |

不接受分页 limit/after_request_id、单个 restore_request_id、归档摘要或恢复目标。max_bytes 计算完整规范回执 JSON 的 UTF-8 字节累计，每条自身仍限 64 KiB；不是 SQL 物理 IO、峰值内存、索引扫描或元数据读取上限。读取预算按阶段检查，不能硬实时中断同步 SQL/磁盘等待，也不包括模块加载和打开/关闭连接。

CLI 要求 --inbox 与 --json/--json-file 二选一，严格解析在打开库前完成。不接受 --output、--receipt-output、归档/页面/回执文件、key、独立 timeout 开关、stdin 或重复选项。主程序与嵌入入口共用本地只读路径，不调用网关、reducer 或确认服务。

[跨范围目录](sync-application-restore-receipt-scopes-runtime.md)每个条目和[范围内 ID 目录](sync-application-restore-receipt-catalog-runtime.md)的页结果增加 receipt_audit_query，携带原身份、应用及本次读取期限，可直接用于本接口。没有分页下界，审计始终从所选范围首条开始；条数和字节预算使用默认值，也可由调用方显式填写。

以下仅说明使用方式，未执行或生成文件：

```text
workctx inbox application-restore-receipt-audit --inbox local-inbox.sqlite --json-file original-receipt-audit-query.json
```

## 单次快照内的完整核验

已有 core/application/receipt 扩展必须完整，readonly/create:false 打开，不初始化、修复或写记录。不依赖消费者行、应用头或当前投影，包含空恢复留下的回执。

先对原范围最多 max_receipts+1 行进行计数。超过预算直接未完成，不把截断计数冒充真实总数；receipt_count 仍为 null。数量在预算内时，记录完整总数，随后每批读取最多 50 条请求 ID 和受限的回执字节数，按请求 ID 的 BINARY 升序遍历。

首批不设人为的空字符串下界。SQL 输出 ID 前检查类型和最多 1020 字节，回执正文只返回符合 TEXT/1–65536 字节规则的长度；无效 ID、长度或次序拒绝。JavaScript 使用 UTF-8 字节比较核对次序。每次读取完整正文前检查累计字节预算；随后复用既有规范 JSON、回执 SHA、原查询 SHA、身份/应用摘要键、请求 ID、原 trace、计数及目标关系校验，并核对规范正文的实际字节数。

不将全部正文载入列表；逐条处理，每批只持有有界元数据。遍历到范围结束后，已校验条数必须等于最初实际行数。预算不足、缺失或损坏都不返回部分通过，不生成跨快照续页凭据。读取达到初始行数后还会检查是否存在额外记录；提前结束或发现额外记录均拒绝。

## 成功与失败

成功返回 audit_completed=true、full_receipt_history_audit=completed、audit_scope=original-consumer-application-restore-receipts、receipt_count、checked_receipts、checked_bytes、原预算和原身份/应用。first_request_id/last_request_id 只是 BINARY 排序边界；空范围二者为 null，计数和字节为零。

outcomes 分别统计 restored、already-restored、empty **回执条数**，target_bound_receipts 统计原查询带 expected_target 的回执条数。它们不是本次恢复数量、最新状态或成功提交时间线；本次没有执行恢复。结果不返回完整回执、归档、投影或所有请求 ID。

consistency=single-read-transaction、receipt_scope=historical-local-transaction、current_state=not-read、full_application_history_audit=not-performed、local_write_state=not-performed、absence_proves_rollback=false。完成只说明本次所选范围的已保存历史回执自洽，不证明来源真实性、历史未被删除、当前应用/接收链、服务器状态、其他范围或物理库完整性，不审计 schema 约束/触发器 SQL 定义。

查询、成员/排序/长度、预算、响应错误分别为 INBOX_APPLICATION_RESTORE_RECEIPT_AUDIT_QUERY_INVALID、AUDIT_CORRUPT、AUDIT_LIMIT_REACHED、AUDIT_TOO_LARGE（后者同前缀）。完整回执损坏、缺扩展、超时和存储失败保留原错误码。Bridge 失败保留 audit_query、audit_completed=false、full_receipt_history_audit=not-completed，以及 stage、receipt_count、checked_receipts、checked_bytes 和 selected_request_id。阶段为 schema/membership/receipts/transaction-completion；仅完整核验且通过该步期限检查的回执计入 checked。无效 ID 不复制到错误，selected_request_id=null。

全部行已经读完也不能掩盖结束事务失败：仍标记未完成，并保留计数和回滚状态。CLI 打开失败另标记 stage=open；操作失败保留原阶段/计数、路径和 close_pending。成功读完后的关闭失败单独报告 close_pending，不抹去已结束事务的结果。

Bridge 完整结果及 CLI 加入路径/关闭标记后的完整响应均限 512 KiB。仅最后 CLI 响应封装超限时，audit_completed=true、response_completed=false；不输出截断成功结果。

仍缺跨范围全库回执审计、数据库实例绑定、来源认证、不同历史合并与实际并发/崩溃/跨设备证据。R-005 保持未完成。
