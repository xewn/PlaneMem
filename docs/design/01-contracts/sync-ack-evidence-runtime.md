# 本地确认凭据文件与页面恢复（开发契约）

2026-11-03：仅源码和文档。未编译、类型检查、测试、执行 CLI/SDK/API、生成样本文件、打开数据库、迁移或发布。无新依赖或数据库 schema；已有 inbox/ack/dispatch/recovery 扩展与先前迁移仍未执行，R-005 未完成。当前文件解析支持普通档案 v1 与恢复档案 v2。

## 保存范围

本功能将 [确认日志](sync-inbox-ack-runtime.md) 中的一笔原目标、可选的一次精确派发及其完整 [原页面](sync-saved-page-runtime.md) 保存为独立文件。它是本地读取快照，不是新服务器回执、服务器签名、全量收件箱备份或事件应用证明；不把文件内容写回确认日志，不恢复 active 占用，不解除未解决目标门禁。

只有已经进入本地日志的内容可以导出。INBOX_ACK_EVIDENCE_SAVE_FAILED 中尚未入库的 server_result 不会凭空出现在导出文件里；该错误原始输出仍需单独保留。调用时可通过 --result-output 保存独立的 [调用结果文件](sync-ack-result-runtime.md)，该文件不冒充日志快照，也不导入或结算日志；可信证据导入/结算继续待开发。

## 文件格式与一致性

外层为严格的 `{document, document_sha256}`，document 包含：

| 字段 | 内容 |
| --- | --- |
| schema_version | 普通档案为 1，显式恢复档案为 2 |
| kind | 固定为 workctx.sync-ack-evidence |
| page | 完整 SyncSavedPageFile，含原页面文档和原文档摘要 |
| record | 原确认日志全部字段、原请求 trace、完整 response/observation |
| dispatch | v1 为所选派发全部字段与完整 response，未选择派发时为 null；v2 必须是恢复的首笔本地派发 |
| recovery | 仅 v2 包含且必填，保存完整不可变恢复凭据；v1 不允许此字段 |

`ack-get --output` 的 dispatch=null 仅表示这次选择不含派发，不表示从未发送。`ack-dispatch-get --output` 必须包含指定派发和它绑定的原确认记录。记录首份成功响应和某次派发响应可以不同，各自按同一原身份、cursor、request_trace_id 完整验证，互不替换。原页面下载 trace 与确认请求 trace 也可以不同，均按各自原值保留。

上述两种导出继续生成 v1；只有 `ack-recovery-get --output` 明确生成 v2。v1 原字段集合、顺序和嵌套规范解析保留，读取时不补 recovery、不升级版本或重写原文件。v2 不允许 null/missing recovery 或 dispatch，不接受不支持的版本；把恢复字段塞进 v1 也会拒绝，不静默丢弃额外证据。

恢复结构上限 16 KiB，包含 recovery_id、record_id、first_dispatch_id、invocation_trace_id、registered_at_ms、prior_local_dispatch_history=absent、prior_remote_outcome=unknown。共享解析核对合法 ID、安全时间、与原 record_id 的绑定，以及首派发 ID/调用 trace/started_at_ms 的完全一致性。v2 总是携带恢复时首笔有本地记录的派发，不能替换成之后某次重试；原记录的首份已知成功响应则可能来自之后的重试，仍独立保留。此前缺派发记录/远端未知描述登记时的本地事实，不能从档案证明此前没有真实网络请求。

共享解析器要求精确字段、合法 ID、安全正序号和时间、有效原身份及状态/证据一致性；原目标的身份、页面摘要和 cursor 必须匹配完整页面，派发必须绑定同一 record_id。confirmed 必须有完整匹配的响应；observed 必须有达到目标的 recorded=true 观察；unconfirmed 不可附已达到目标的观察。派发 confirmed 同时要求原记录 confirmed。旧观察的授权到期只作历史字段校验，不与当前时钟比较，不当成当前授权。

规范文档按固定外层字段顺序重新序列化；嵌套页面采用既有规范格式。CLI 独立核验两个 SHA-256：内嵌原页面文档摘要，以及整个凭据文档摘要。共享 contracts 解析器只检查结构及绑定，**不会代替调用方计算摘要**。文档摘要不是服务器签名，内容与摘要都被替换时不能据此发现伪造。

记录结构上限 96 KiB、单派发 48 KiB，各服务器响应/观察仍各限 32 KiB；凭据 document 总上限为 4 MiB + 196 KiB，完整文件总上限为 4 MiB + 200 KiB。稳定正规文件读取、有效 UTF-8、可选 BOM 与解析前字节限制同时适用。不接受路径链接/不稳定读取等既有文件适配拒绝的情况。边界约束不声称进程堆或磁盘耗时上限。

## 导出

以下为未执行的用法示意，查询文件均包含完整 expected_identity 和相应 record_id/dispatch_id：

```text
workctx inbox ack-get --inbox local-inbox.sqlite --json-file acknowledgement-selection.json --output ack-evidence.json
workctx inbox ack-dispatch-get --inbox local-inbox.sqlite --json-file dispatch-selection.json --output dispatch-evidence.json
workctx inbox ack-recovery-get --inbox local-inbox.sqlite --json-file acknowledgement-selection.json --output recovery-evidence.json
```

三个 get 命令无 output 时保持已有完整详情输出。有 output 时先校验查询和新目标路径，在同一读事务内读取精确记录、可选派发及完整已存页面；恢复导出还要求已有 recovery 扩展，核验完整恢复凭据和首派发、没有更早的该目标本地派发，生成 v2。经共享解析后结束事务并尝试关闭数据库，再写文件。页面仍复用当前头/相邻前页及目标页面的既有核验。普通导出缺目标返回 INBOX_ACK_NOT_FOUND；恢复导出缺原目标或恢复凭据返回 INBOX_ACK_RECOVERY_NOT_FOUND，不降级为 v1 或创建空档案。列表命令继续拒绝 output。导出无需令牌或网络，状态未解决的记录也可原样保存；本次导出成功不等于确认成功。

文件写入复用独占临时文件、同步、读回及不覆盖硬链接发布。最终重新读取目标，核对完整文档、两层摘要、实际文件字节数和字节 SHA-256。已有文件或链接不替换，不使用覆盖回退；临时清理失败保留成功结果和 cleanup_pending。文件发布后读回失败返回 INBOX_ACK_EVIDENCE_READBACK_FAILED，标记 published-unconfirmed 并保留路径，不删除已发布文件。文件保存失败使用 INBOX_ACK_EVIDENCE_FILE_SAVE_FAILED，与原网络确认的日志保存错误区分。数据库关闭异常保留 close_pending，不能抹去已取得的读取快照或已保存的文件。

不保证目录掉电持久性、未来路径不变、Windows ACL、跨设备备份或每个文件系统都支持发布操作。重新导出可能读取到更新后的证据，不能把不同时间的文件当成同一字节快照。

## 离线检查与页面提取

```text
workctx inbox ack-evidence-inspect --evidence-file ack-evidence.json
workctx inbox ack-evidence-page --evidence-file ack-evidence.json --output recovered-page.json
```

inspect 仅接受 evidence-file；page 另要求新 output。两者拒绝额外/重复选项、stdin、JSON、inbox 和令牌参数，均按文件实际版本接受 v1/v2。完整核验后，inspect 输出 archive_version、原确认记录、所选派发及完整响应；v2 另输出完整 recovery 和 recovery_provenance=included，v1 则为 recovery=null、recovery_provenance=not-included，后者不能解读为从未恢复。另给页面摘要/下载 trace/事件数量，不把整个事件页面再次打印到标准输出。CLI 外层封套 schema_version 仍为 1，不能与档案内版本混淆。输出始终标记 provenance=local-archive-not-authenticated、current_server_state=not-queried、event_application=not-verified 和 acknowledgement_dispatch_state=not-sent；内嵌历史 state 只描述保存的历史证据。

page 命令先核验整个凭据，再通过既有 saved-page 保存流程将内嵌原页面写到新文件。保留原页面文档摘要、下载 trace、身份、查询和前页摘要；输出附 source_evidence_document_sha256 和 source_evidence_version。提取出的仍是原页面格式，恢复元数据留在原档案中，不会附加到页面或转成恢复指令。页面文件文本按规范格式重写，不承诺与丢失文件的空白/BOM/原字节相同。提取不导入数据库，不发送确认，也不把单页当作完整连续接收链。使用方可随后明确选择既有 sync inspect、sync changes --page-file 或 inbox import 命令；提取过程不会自动调用它们。

离线入口不打开 inbox 或要求当前账号；它们不验证服务器签名、当前权限或当前位点。main 和嵌入 runWorkctx 均在网络命令分支前处理。成功检查/提取不能升级日志中的未知状态，也不能证明首次请求或任意一次重试的真实远端执行顺序。

## 后续范围

旧无派发历史意图的显式恢复及 v2 恢复凭据携带已有源码。v1 不含恢复凭据；缺字段不能被理解为没有恢复或没有更早发送。离线检查只能核对档案内部绑定及摘要，不能核验原库完整历史或可信来源。待补成功输出的可信导入与来源标记、完整历史导出/审计、应用事务/applied_cursor、跨设备恢复和真实文件系统/并发/故障证据。本增量不提供全量备份或日志替换，源码不等于运行验证。
