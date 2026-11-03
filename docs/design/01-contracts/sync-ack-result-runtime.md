# 确认调用结果文件（开发契约）

2026-11-03：仅源码和文档，未编译、类型检查、测试、生成样本、执行 CLI/SDK/API、打开数据库、迁移或发布。无新依赖或数据库 schema，现有迁移仍未执行，R-005 未完成。

## 用途与调用入口

[确认日志](sync-inbox-ack-runtime.md) 可能在收到完整服务器响应后写入失败。此时已有错误输出保留 server_result；本增量允许在调用时明确指定新文件，将该结果与完整原页面一起保留，供后续离线查看。它不导入、修复或结算日志，不取消原错误，也不触发重发。

以下仅为未执行的用法示意：

```text
workctx inbox ack --inbox local-inbox.sqlite --page-file page.json --result-output ack-result.json
workctx inbox ack-retry --inbox local-inbox.sqlite --page-file page.json --dispatch-id LATEST_ID --result-output retry-result.json
workctx inbox ack-recover --inbox local-inbox.sqlite --page-file page.json --record-id ORIGINAL_ID --result-output recovery-result.json
workctx inbox ack-observe --inbox local-inbox.sqlite --page-file page.json --result-output observation-result.json
workctx inbox ack-result-inspect --result-file ack-result.json
workctx inbox ack-result-page --result-file ack-result.json --output recovered-page.json
```

四种调用均支持可选 --result-output，其他参数、权限和固定原目标门禁保持原语义。新路径预检在原页面核验和身份检查之后、打开 inbox/登记派发/进入网络回调之前。预检拒绝已有文件、链接或无效目录；此时不发送确认。预检不会预留目标文件，之后的路径竞争由独占发布拒绝。

仅本次获得完整且匹配的服务器结果才创建文件。已解决目标的本地重放输出 result_file.state=not-created、reason=no-new-server-result；请求异常或完整响应校验失败时为 not-created、reason=no-valid-server-result。没有新结果时不会从历史日志制造一份新的调用结果。预检及打开库之前的错误按原错误返回，不承诺 result_file 字段。未指定选项时不写结果文件。

## 格式与绑定

外层为严格的 `{document, document_sha256}`。独立 document 的 kind 为 `workctx.sync-ack-result`，schema_version 为 1；它与 [ack-evidence v1/v2](sync-ack-evidence-runtime.md) 的本地日志导出格式互不替代。

| 字段 | 语义 |
| --- | --- |
| page | 完整原 SyncSavedPageFile，保留原页面摘要、下载 trace、身份、查询和前页摘要 |
| record_before_request | 网络调用前的完整原记录快照，必须为 unconfirmed；不改写成 confirmed/observed |
| dispatch_before_request | 确认结果必须有原 active 派发快照；当前位点观察必须为 null |
| invocation_trace_id | 本次调用 trace；确认派发的调用 trace 必须与此一致 |
| server_result_kind | original-acknowledgement 或 current-cursor |
| server_result | 完整原确认响应或当前位点观察封套 |
| journal_update | completed 表示日志方法正常返回；unconfirmed 表示本次更新未获确认 |

共享解析核对原记录和原页面的完整身份、页面摘要与目标 cursor，派发与原 record_id 的绑定、active 状态/空响应及调用 trace。原确认响应必须匹配原 command、原 request_trace_id、完整身份/cursor/client/source_refs；观察使用本次 invocation trace 和同一原消费者身份，不能附加确认派发。观察的到期在实际接收时校验；离线读取只检查历史字段，不因后来到期而拒绝历史文件。

current-cursor 可以低于原目标或 recorded=false，此时日志仍可能未解决，文件不能解读成原请求确认。journal_update=completed 只说明日志方法返回：并发过程可能已解决原目标，日志方法可能保留更早的完整证据，本次结果仍独立保存。unconfirmed 不等于未提交，不能靠文件判断 COMMIT 异常后的实际数据库状态。查看当前日志需要另行显式读取。

本文件不携带恢复扩展的完整 provenance，也不证明以前没有派发。需要恢复凭据时仍用 ack-recovery-get --output 导出独立 v2；结果文件保存的是本次派发，可能是后续重试，不冒充恢复的首笔派发。

原记录上限 96 KiB、派发 48 KiB、单个服务器封套 32 KiB。document 上限为 saved-page 文件上限加 192 KiB，即 4 MiB + 228 KiB；完整文件再加 4 KiB，即 4 MiB + 232 KiB。共享解析拒绝额外/缺失字段、混合版本、非法状态、跨身份/页面/记录/trace 的替换。规范序列化固定字段顺序；文件适配分别核对内嵌页面 SHA-256 和结果文档 SHA-256。共享 contracts 解析不替调用方计算摘要。

## 保存与失败语义

请求前在内存固定原记录/派发快照；收到完整结果后先尝试原日志结算，在释放事务并尝试关闭库后保存文件。磁盘写入使用既有独占临时文件、同步/读回、硬链接不覆盖发布；最终目标再次完整解析，核对两层摘要、实际文件字节数和字节 SHA-256。

| 原调用结果 | 文件结果 | 命令行为 |
| --- | --- | --- |
| 日志方法完成，收到新结果 | 保存且最终读回一致 | 返回原 action/record，另附 result_file；原记录仍未解决时退出码仍为 1 |
| 日志方法完成，收到新结果 | 保存失败或最终读回不确认 | INBOX_ACK_RESULT_SAVE_FAILED，保留完整 server_result、原 action/record/dispatch/recovery、journal_update=completed 及文件错误 |
| 已收到完整结果，日志更新失败 | 文件成功或失败 | 保持 INBOX_ACK_EVIDENCE_SAVE_FAILED 和完整 server_result/local_commit_state；仅附 result_file，不把错误转成成功 |
| 本地重放或没有有效新结果 | 不创建 | 保留原结果/错误，并在已进入调用流程时附 not-created 原因 |

result_file.state=saved 仅证明本次文件保存及读回完成；不能替代数据库提交或服务器确认。state=save-failed 中嵌套文件错误，local_state=published-unconfirmed 表示目标已发布但最终读回未确认，保留文件和路径；不删除已发布文件、不覆盖、不退化为直接覆盖写入。清理失败可以保留成功结果和 cleanup_pending/temporary_path。日志错误、完整服务器结果及原派发状态不会被文件错误中的状态覆盖。close_pending 单独保留。

文件写入不在原网络预算内；没有与远端/SQLite 的跨系统原子性。收到响应后进程退出、磁盘失败、挂起或输出通道失败仍可能丢失尚未落盘的结果。本增量不提供响应到达即持久化、目录掉电或全文件系统兼容保证；不自动重试请求或文件发布。

## 离线入口与边界

ack-result-inspect 仅接受 --result-file；ack-result-page 还要求新 --output。均拒绝重复/额外参数、stdin、JSON、inbox 和令牌，不打开库、不读取当前账号、不请求网络。独立主程序和嵌入 runWorkctx 均在网络分支前路由。完整有界读取、UTF-8 解码和全部结构/摘要验证成功后才展示或提取。

inspect 输出完整请求前快照、server_result、调用 trace 和 journal_update，另给页面摘要而非再次输出整页事件。结果标记 local-capture-not-authenticated、current_server_state=not-queried、event_application=not-verified、acknowledgement_dispatch_state=not-sent；最后一个状态描述离线命令本身。

page 先校验整个结果文件，再复用原页面保存流程，输出 source_result_document_sha256/source_result_version。提取文件保留原页面规范摘要，不附加本次响应或修改页面，不承诺原文件空白/BOM 的字节复刻，也不自动导入、发送或续读。

哈希和本地 provenance 标记不能认证服务器来源，改写内容与摘要仍可伪造文件。结果文件不能作为可信导入依据；可信来源证据导入/结算、全量历史审计、应用事务/applied_cursor、跨设备恢复和运行证据仍待开发或后续授权验证。
