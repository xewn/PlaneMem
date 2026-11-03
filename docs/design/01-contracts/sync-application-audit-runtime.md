# 收件箱应用历史结构审计（开发契约）

2026-11-03：仅开发源码和文档，未编译、类型检查、测试、执行 Bridge/CLI、打开数据库、初始化/迁移、生成样本或发布。无新增依赖/schema，原 SQLite 扩展及 PostgreSQL 016–049 仍未执行。任务完成后独立提交并推送 main，提交含 [skip ci]。

## 接口和范围

`SqliteSyncInbox.auditApplicationHistory(input, trace)` 审计完整原消费者五字段身份和应用名称版本所选的全部已保存应用步骤。`parseInboxApplicationAuditQuery` 可在打开数据库前验证输入。适用于内置和自定义应用，不要求可用的 reducer 代码，也不重跑 handler。

```text
workctx inbox application-audit --inbox local-inbox.sqlite --json-file application-audit-query.json
```

示例未执行；查询必须含 expected_identity 与 application（name/version），可选如下参数，拒绝其他字段：

| 参数 | 默认值 | 范围 |
| --- | --- | --- |
| max_pages | 1000 | 1–10000 的整数 |
| max_events | 100000 | 1–1000000 的整数 |
| max_bytes | 67108864 | 1–536870912 的整数 |
| timeout_ms | 30000 | 1–90000 的整数 |

完整查询最多 16 KiB。CLI 接受 --json 或 --json-file 二选一，文件复用稳定普通 UTF-8 读取，可带 BOM；必须明确 --inbox，拒绝重复/未知选项、page-file/output/key/timeout-ms 和网络选项。主程序和嵌入入口均先解析再只读打开已有库，不依赖令牌或当前环境身份，不调用网络/router，也不自动启用扩展。

## 同一读取快照内的完整覆盖

1. 校验现有应用扩展；对所选 consumer/application 的步骤数和事件 ledger 数进行至多预算加一的标量计数。超出预算直接报错，不全量加载正文。
2. 复用完整应用头校验：应用描述、头快照/摘要、完整原源页、相邻前驱元数据与头页事件绑定。实际步骤数必须等于头序号；无应用头但有孤立步骤或事件明确失败。
3. 从头逐页回溯到根，严格核对摘要链接、连续序号、固定原 query.limit、相邻源游标。根必须是序号 1、from cursor=0、previous=null；中间页不能缺前驱。
4. 每个步骤复用完整读取：受限字段类型/大小、规范投影 JSON/SHA-256、原应用 trace、原页摘要/身份、源序号/游标/事件数/前驱绑定。每个原事件按 ID 精确核对 ledger 的来源页、cursor 和完整事件摘要，并核对该页 ledger 行数；重复或额外记录不能替代完整匹配。
5. 空事件页必须与前一应用投影逐字相同；空根页投影必须为 JSON null。没有事件就不能产生新的投影内容。
6. 最终已检查步骤与事件数必须等于快照内实际行数，链必须终止于根；因此多余分支、游离步骤和未归属到所遍历页面的事件不能获得完整通过。

每次只保留当前页、头页和空后继需要的投影比较值，不把所有完整快照装进内存。max_bytes/checked_bytes 计入每个已完整检查步骤的一份规范源页面 document（不含外层文件包装）与该步投影 JSON 的 UTF-8 字节。它不是数据库 IO、进程内存或所有重复解析的精确计数；源读取会额外校验当前接收头和相邻源页，当前待检查页也可能已解码后才发现累计超限。每页仍受原页面/投影独立大小限额。

从 BEGIN 前开始计算本地时间预算，计数、遍历、事件循环及 COMMIT 前检查；同步 SQLite 调用、JSON 解析不能被硬实时抢占。只有全部覆盖且读事务成功结束才返回完整结果，超时、预算不足或存储/校验失败不会返回局部成功，也不会自动增加预算或修复。

## 输出和失败

成功为 status=complete、audit_completed=true、audit_scope=application-history-structure，带 schema_version/trace/source_refs/scope、完整 expected_identity/application、checked_pages/checked_events/checked_bytes、root_sha256、budgets，以及同一快照下完整 state。仅此次结果中的 state.full_application_history_audit 为 verified-structure；普通状态/应用读取仍为 not-performed，不持久化“已经审计”标签。

应用不存在且步骤/事件均为空时，成功核对空历史，checked 值为零，root/head=null、state.recorded=false；不据此判断源接收消费者是否存在、是否应当已有应用或远端是否有新事件。

结果明确 reducer_replay=not-performed、projection_semantics=not-verified、received_suffix_audit/acknowledgement_audit/physical_database_audit=not-performed。state 保留 server_application/source_authenticity=not-verified 和 acknowledgement_dispatch_state=not-sent。结构一致不证明业务 reducer 的输出正确、代码版本可信或服务端实体已应用，也不能证明应用头之后尚未应用的接收后缀完整。

查询错误为 INBOX_APPLICATION_AUDIT_QUERY_INVALID；预算不足为 INBOX_APPLICATION_AUDIT_LIMIT_REACHED；遍历结构/行数/空页异常为 INBOX_APPLICATION_AUDIT_CORRUPT；下层原页或快照/ledger 错误保留原代码。失败 details 标记 audit_completed=false，遍历内失败还含已完整检查计数、stage、selected_digest 和预算。schema/事务开始前失败可能尚无检查计数。事务结束失败保留已检查计数但不声称成功；回滚失败保留 rollback_pending。CLI 尝试关闭连接，成功保留完整结果与 close_pending，失败保留原诊断并补关闭状态。

审计不改写任何页面、投影或应用头，不修复、不重放业务 handler、不导出文件、不解除派发占用、不发送 ack。其他消费者/应用、确认日志、物理数据库完整性和完整历史业务重放需独立开发。真实并发、损坏数据库、超限、超时与关闭失败证据仍为空，源码完成不代表执行通过。
