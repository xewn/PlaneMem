# 离线队列原投递核对与结算（开发契约）

2026-11-03：仅源码和文档；未编译、类型检查、测试、运行 CLI/API、打开 SQLite、执行迁移或发布。无新依赖/schema/迁移；先前 SQLite 原身份三列及 PostgreSQL 016–049 仍未执行。R-005 不因此完成。

## 明确核对一条原记录

新增 `SqliteOutbox.reconcile(event_id, scope, reader, {trace_id,timeout_ms?,signal?})` 和 CLI `outbox reconcile EVENT_ID`。从指定项目的现有队列行取得完整原身份与上传事件，调用 [原事件回执](sync-event-receipt-runtime.md)，确认历史记录后才结算本地投递状态。不会调用上传、下载、ack、retry、purge 或当前身份发现接口，不生成事件、键或补写旧身份。

CLI 示例仅说明用法，未执行：

```text
workctx outbox reconcile ORIGINAL_EVENT_ID --outbox existing-outbox.sqlite
workctx outbox reconcile ORIGINAL_EVENT_ID --outbox existing-outbox.sqlite --timeout-ms 30000
workctx outbox reconcile ORIGINAL_EVENT_ID --outbox existing-outbox.sqlite --result-output new-receipt.json
```

命令本身表示明确要求核对并结算这条原记录，只接受一个原 event_id、可选 --outbox、--timeout-ms 和 --result-output NEW_FILE；拒绝 JSON、输入回执文件、stdin、写键、limit、重复/未知选项和额外位置参数。输入回执文件不能直接当成服务器证明。仍使用 WORKCTX_* 项目、Gateway 地址及原账号/客户端的当前令牌；原账号不匹配会被拒绝，不将当前凭据绑定给队列。

可选 result-output 在打开库前预检新路径，核对结束并尝试关闭后独立保存已验证的完整回执，成功和本地结算失败分支均支持。文件状态与本地结算状态分开报告，不自动重试；详见 [原事件回执独立文件](sync-event-receipt-file-runtime.md)。`outbox inspect-result --result-file` 可独立离线核验查看该文件，不能导入结算。

队列路径沿用 --outbox、WORKCTX_OUTBOX、默认 ~/.workctx/outbox.sqlite 的优先级。新 `{existing:true}` 打开模式先要求路径为已有普通文件（拒绝文件符号链接），再检查已有 local_events 列；不创建父目录、不执行 CREATE/ALTER/索引升级。缺少恢复所需列返回 OUTBOX_UPGRADE_REQUIRED，不在恢复命令里自动迁移。只在用户控制的目录使用；路径检查和 SQLite 按路径打开不是原子操作，不保证抵御并发目录/文件替换。SQLite 自身的日志/锁文件行为仍由运行时决定。

网络 main 和嵌入 runWorkctx 均接入同一原行流程。网络复用 SDK 原回执；嵌入复用既有可信未过期 sync.write/admin 身份、完整身份/头/正文核对及 SDK 有界解析。此命令是本地队列操作加远端只读查询，没有新增 Gateway 写接口。

## 原行与并发保护

读取单行时固定 rowid、全部原始列以及从原行解析出的 identity/event。先检查原身份、payload checksum、完整命令摘要、JSON 上限、状态、尝试次数、规范调度时间及可选投递元数据。损坏行报 CORRUPT_RECORD/CHECKSUM_MISMATCH；缺原身份报 OUTBOX_IDENTITY_REQUIRED。不会使用 inspect 的损坏行展示替代值进行恢复。

status=sending 且租约时间尚未到期时返回 OUTBOX_EVENT_BUSY，不查询回执、不抢占发送者。过期 sending 可核对，但必须保持原行不变；不改变租约到期规则或宣称原网络发送已停止。租约仍用现有墙上时钟判断，不提供硬实时保证。

读取 Gateway 期间不持有 SQLite 写事务，也不预先将原行改成“处理中”。完整回执必须匹配未交给 reader 的独立原快照及本次 trace。reader 可以修改自己收到的副本，但不能改变核对基准。

回执通过后开启 BEGIN IMMEDIATE，重读同范围/event_id/rowid 的完整行并逐字段比较。任何删除、修改、retry、重新 claim 或其他进程结算导致的可观察变化均报 OUTBOX_EVENT_CHANGED；包括另一个进程已成功结算的情况，本次不覆盖。随后再次检查原命令和租约，只在同一事务中更新。进程间竞争仍须真实运行证据；本地摘要不是签名，也不防止可重写整份数据库者伪造状态。

## 结果与本地更新

| 远端/本地情况 | 本地动作 | 结果 |
|---|---|---|
| `not-observed` | 不修改任何事件列 | `local.action=unchanged`，保留当前状态、租约、回执及退避 |
| `recorded` 且 accepted=true | 设置 sent，保存服务器事件/游标，清空冲突和 last_error，清除旧租约 | `local.action=settled` |
| `recorded` 且 accepted=false | 设置 conflict，保存服务器事件/游标/conflict_id，last_error=VERSION_CONFLICT，清除旧租约 | `local.action=settled` |
| 本地终态及全部投递引用已与已记录回执一致 | 不写原行 | `local.action=already-settled` |
| 本地终态或已有投递引用与已记录回执不一致 | 拒绝覆盖，保留原行 | OUTBOX_RECEIPT_CONFLICT |

部分旧投递引用缺失时，可在原身份/命令完整且所有已知引用一致的条件下补齐；已有相反终态或不同引用不能被新回执覆盖。sent/conflict 的原记录若远端本次未观察到，也不降级或擦掉旧证据。

结算只更新 status、server_event_id、server_cursor、conflict_id、last_error、lease_token；原身份、完整事件、本地键、原 trace、两个摘要、attempt 和 next_retry_at 全部保留。原内容继续留在队列，未删除。旧发送者迟到的 settle 仍受原 status/lease_token 条件约束，不能覆盖已经清除租约的新终态。

返回 `{receipt,local}`：receipt 是完整原事件回执封套，local 包含 event_id、status、action。CLI 外层另带 schema_version、当前 trace、scope、outbox/历史 sync-event 来源。嵌套回执中 original_trace_id 是原投递 trace，不能替换当前查询 trace 或队列原 trace。

CLI 退出 0 表示原投递已记录且本地已结算或已一致，包括 conflict；它不证明源实体已应用或当前冲突已解决。not-observed 返回结构化 stdout、退出 1；失败退出 1，用法错误退出 2。数据库关闭失败且结果已知时返回 close_pending=true，保留已知结算结果，不改报“未写入”。

## 期限与错误

reconcile 默认总本地等待 30 秒，timeout_ms 允许 1–2147483647，支持 signal；预算从方法进入时开始，覆盖原行读取/摘要、reader 等待、完整回执解析和结算前检查。CLI 的路径检查、模块加载及数据库打开在此前，不在此预算内。reader 收到同一取消信号和配置期限；SDK/Fetch 各自预算与外层预算中先到者生效。

即使自定义 reader 忽略取消，外层等待结束后其迟到结果也不会继续到本次本地结算。同步 SQLite/JSON/摘要工作不能被中途抢占；进入事务后、更新前和提交前均检查预算，过期则回滚。COMMIT 已成功后不再用时间超限覆盖已知结果；因此不承诺硬实时结束。程序取消不能撤销远端读取审计。

远端失败统一 OUTBOX_RECEIPT_UNAVAILABLE，最多保留允许列表中的 receipt_code，不透传原始正文、message/details。完整回执不符为 OUTBOX_RECEIPT_INVALID；本地超时/取消分别为 OUTBOX_RECONCILE_TIMEOUT/CANCELED，均不自动重试。普通数据库错误为 OUTBOX_STORAGE_UNAVAILABLE；本次 COMMIT 调用异常明确为 OUTBOX_COMMIT_UNKNOWN，即使后续回滚调用成功也不降级为已知未提交。输出失败、进程终止或掉电不能用退出状态推断未提交。

### 完整回执通过后的失败输出

Bridge 导出 `OutboxReconcileFailure` 类型；完整回执通过绑定校验后，后续失败保留对应错误码，并在 `error.envelope.details.reconciliation` 保存以下数据。CLI 网络与嵌入错误输出保留同一结构，退出 1；不会因为其中 receipt.data.status 为 recorded 改报结算成功。

```text
{
  receipt: 完整 SyncEventReceiptEnvelope,
  local: { event_id, settlement: "not-committed" | "unknown" },
  transaction: {
    phase: "not-started" | "begin" | "body" | "commit",
    rollback: "not-needed" | "succeeded" | "failed"
  }
}
```

这里 receipt 是已经验证的本次查询封套，含原完整身份/事件、本次查询 trace 和 recorded/not-observed。`local.settlement` 仅描述本次核对的提交情况，不代表当前队列行状态或其他发送者的结果，也不包含失效的旧 status。预算在完整解析完成后到期、BEGIN 失败、并发变化或本地证据冲突时仍保留该回执；解析失败、解析前到期、远端错误和迟到 reader 结果不附加未验证正文。

专用事务助手记录 BEGIN/事务正文/COMMIT 阶段。只有本次 BEGIN 成功才尝试回滚；正文失败且回滚成功时为 not-committed，COMMIT 异常或回滚失败均为 unknown。回滚失败保留原业务错误码，不用清理异常遮蔽它；原始存储错误正文不透传。not-observed、already-settled 和实际更新三个分支均在 COMMIT 前再次检查预算，成功提交后不追加超时失败。

CLI 尝试关闭后才返回错误；关闭也失败时，在原 details 上补 `close_pending=true`，不移除完整回执、事务阶段或原错误。没有 result-output 时仅在输出中保留，进程中断或输出写入失败仍可能丢失；配置文件保存时另带 result_file，文件失败也不覆盖原核对错误。两步不是跨库/文件原子事务，不提供离线导入结算、自动重试或回执签名认证，原记录应保留并在后续明确核对。

reader 是可信的应用适配器，必须只读取原事件回执，并遵守 bounded-json/信号规则。回执格式检查不是服务器签名；任意自定义回调可以伪造对象，不能把此 API 描述成对不可信代码的认证边界。CLI 使用 SDK/已验证嵌入上下文，不接收调用者提供的离线回执作为结算依据。

## 后续范围

未提供缺身份旧行的追溯/人工绑定、批量后台核对、未知状态的全局重试门禁、跨设备备份或 MCP/Web 本地恢复入口。既有 flush 的退避、五次上限与每次 claim 批次键策略保持原样；只有显式执行本命令才核对，不能声称所有重试都先查回执。旧进程、自定义 publisher、普通 drain、消费者/Mock/fixture 迁移，以及并发、重启、断电和实际恢复证据仍待补齐。
