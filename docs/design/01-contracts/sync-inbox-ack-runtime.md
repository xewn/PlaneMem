# 收件箱原确认日志、显式观察与重试（开发契约）

2026-11-03：仅源码与文档，未编译、类型检查、测试、执行 CLI/SDK/API、打开数据库、启用扩展或发布。可选 SQLite ack、dispatch、recovery 三个扩展 v1 均只写初始化源码；核心 inbox v1、outbox 升级与 PostgreSQL 016–049 均未执行。无新依赖，R-005 未完成。

## 日志与原目标

本功能在 [连续接收收件箱](sync-inbox-runtime.md) 上为一次明确确认保存原目标和已知证据。received_cursor 不等于应用位点，确认日志也不执行或证明本地事件应用。只有使用 inbox ack 的操作会经过日志门禁；既有 sync ack、直接 SDK/MCP 或其他进程不会被自动拦截，不能声称已实现全局确认/重试控制。

`inbox enable-ack --inbox EXISTING.sqlite` 显式新增扩展 v1 元数据及 sync_inbox_acknowledgements 表、约束、索引和保留触发器。它需要已初始化核心库，整个扩展在事务中创建；已有完整扩展返回 already-enabled，部分结构或版本不符失败，不自动重建。普通打开、导入、状态及新库 init 不隐式启用扩展，核心 v1 不改变。

日志保存 consumer_key、每身份安全递增 attempt_sequence、record_id、原 document_sha256、原 cursor、原 request_trace_id、state，以及独立 response_json/observation_json。原页面必须已经导入本库，完整核验后才可成为目标；可以选择已有历史页，不静默替换成最新头。外键绑定该身份的原页面；每身份最多一条 unconfirmed，原绑定、已有成功响应及终态不能被降级或删除。日志序号表示原目标登记顺序，不是网络重试次数。

每次读取重新校验原五字段身份、页面摘要/内容/游标和对应日志，读取当前头及相邻前页的既有核验继续执行。成功响应或观察分别最多 32 KiB；SQL 限制返回正文与元数据大小，数值通过安全十进制文本解析。最新状态、分页历史及精确 ID 详情均限定原消费者；详情返回原目标、原 trace 和完整证据，缺记录为 null，不伪造成功或原服务器状态。

## 状态含义

| state | 证据和含义 |
| --- | --- |
| unconfirmed | 已持久登记原目标，尚无确认其完成的完整证据；可能尚未发送，也可能服务器已提交。可以附最近一次低于目标/无记录的当前游标观察。 |
| confirmed | 保存了与原身份、cursor、request_trace_id、来源和完整封套匹配的原确认成功响应。 |
| observed | 一次明确只读查询观察到同一身份 recorded=true 且当前确认 cursor ≥ 原目标；不证明哪个请求完成，也不构造历史成功响应。 |

目标为 0 时，recorded=false/cursor=0 仍不能结算；明确 recorded=true/cursor=0 才达到该目标。观察高于本地 received_cursor 不推进本地头或应用位点。历史观察的到期时间只描述当时授权提示，读取本地历史记录不要求该提示今天仍有效；不把它当作当前权限。

## 发送与保存

`inbox ack --inbox EXISTING.sqlite --page-file ORIGINAL_PAGE.json` 要求已显式启用 ack 和 dispatch 两个扩展。先完整读取/校验指定页面及范围，完成本地网络配置检查；嵌入入口还核对可信未过期 sync.read/admin、原身份，并拒绝继承写键/版本。随后在同一 BEGIN IMMEDIATE 内核验已存原页面，写入 unconfirmed/原 trace 和 active 派发记录，读回并提交，**提交返回后才进入请求回调**。回调前再读取占用和目标状态；等待服务器时不持有数据库事务。

同一身份已有 unconfirmed 时返回 INBOX_ACK_PENDING，包括再次提交同一页也不会重发。若最新已解决记录正好是同一原页面，返回 already-recorded 和历史日志，不请求服务器；这个本地重读不证明当前服务器未变化。目标游标低于最新已记录目标时拒绝回退。新目标保留原页面 cursor/身份，不推断本地应用结果。

网络使用 SDK acknowledgeSync/Fetch 的完整 bounded-json 路径，嵌入复用专用 sync consumer 适配。单次 --timeout-ms 默认 30000、范围 1–2147483647，网络同时配置 SDK/HTTP；该期限不包括本地文件、库打开、意图提交或成功后的日志提交。成功完整封套 32 KiB、网络错误 16 KiB。原请求输入、身份和日志票据独立复制，不自动刷新身份、查询当前位点或重试。

成功响应经共享解析核对原身份、目标 cursor、原 request_trace_id 和来源，再于新的事务内重读同一不可变票据，同时保存该派发的完整响应及原目标的首份完整响应。原消费者头可以在等待期间继续接收新页，不能因此替换确认目标。并发观察已将该票据记为 observed 时，仍可补入完整成功响应升级为 confirmed；不会覆盖其他较新目标的日志。不同派发的有效响应可以不同，分别留存，原目标已有完整成功响应不被覆盖。

发送前提交失败时不进入请求回调；若 COMMIT 抛错，意图可能已存在，保留 local_commit_state=unknown 并显式查日志。本地意图提交后、真正发送前崩溃也保守留下 unconfirmed。进入请求回调后的超时/取消/权限/响应错误均保留原记录，不根据上游同名详情把它改为“肯定未发送”。SDK 截止等待后不进入本地结算；底层迟到结果不会自动写日志。

## 显式观察与本地查询

`inbox ack-status --inbox EXISTING.sqlite --json-file consumer-identity.json` 是本地读取；查询仅 `{expected_identity:原五字段身份}`，支持 --json，限 16 KiB，不需要令牌或网络。它显示最新完整日志，并不调用服务器。enable-ack 也属于本地命令。

`inbox ack-observe --inbox EXISTING.sqlite --page-file ORIGINAL_PAGE.json` 必须选择最新日志的同一原页面。仍为 unconfirmed 才调用 SDK getSyncCursor；若已有 confirmed/observed，返回 already-recorded，不重新请求。当前响应须匹配本次 trace、原身份、完整来源/位点，且可信到期未过；嵌入入口进一步核对原可信上下文的精确到期。存储前再次检查到期并重读票据。

观察到目标已达到时记 observed；否则保留 unconfirmed 并保存此次完整观察，CLI 输出状态且退出 1。没有记录/较低 cursor 不证明原请求失败，也不能自动重新发送。观察只更新原票据证据，不修改页面/接收位点；若并发原成功响应已先记 confirmed，保留已知成功结果。

ack/ack-observe 仅接受 --inbox、--page-file 和可选 --timeout-ms，拒绝重复/未知选项、JSON、写键、output、stdin 和默认库路径。网络需要 WORKCTX_* 与令牌；嵌入需要可信原 sync.read/admin；文件可以跨进程保存，但不能换账号补认。main/runWorkctx 均已分流。标准输出为本地日志封套，原服务器来源/trace 保留在 response/observation 内；event_application 始终 not-verified。

## 显式原目标重试与派发记录

`inbox enable-ack-dispatch --inbox EXISTING.sqlite` 在已有 ack 扩展上，事务创建独立 dispatch 元数据、表、唯一 active 索引和保留触发器。只检查已有扩展时不会补表或修改版本；普通打开、init、enable-ack、读取和发送均不隐式升级。旧 ack 的原字段和 schema v1 保持原样。升级不补造历史派发；缺派发历史的旧 unconfirmed 记录仍可 ack-observe，但不能直接 ack-retry。

`inbox ack-dispatch-status --inbox EXISTING.sqlite --json-file consumer-identity.json` 只读返回最新 `record` 和最新 `dispatch`。身份查询格式与 ack-status 相同；缺记录为 null。dispatch 包含 dispatch_id、record_id、每身份递增 dispatch_sequence、本次 invocation_trace_id、started_at_ms、lease_until_ms、state 和完整 response。record_id 显示它属于哪一原目标；两种 sequence 分别表示逻辑目标登记和实际派发登记，不能互换。此查询不改变过期 active 的状态，也不请求服务器。

`inbox ack-retry --inbox EXISTING.sqlite --page-file ORIGINAL_PAGE.json --dispatch-id LATEST_DISPATCH_ID` 必须给出最新原派发 ID，可选 --timeout-ms。事务内核对最新原目标/页面与最新派发 ID：并发重复调用中先登记者改变最新 ID，后者携带旧 ID 时失败，不会连续重发。终态目标返回本地 already-recorded；未解决目标保持原身份、页面摘要、cursor 和 request_trace_id，仅新增派发 ID、序号与本次调用 trace。SDK 与嵌入 router 都使用原 request_trace_id；外层 CLI 结果保持本次 trace。trace 的复用不等于服务端幂等键，也不能把重试回执说成首次网络请求的历史回执。

每身份最多一笔 active 派发。本地占用期限为登记时墙钟毫秒加请求预算再加 60 秒；期限内返回 INBOX_ACK_DISPATCH_BUSY 并给出占用 ID/截止值。期限届满，只有新的显式 ack/ack-retry 才能将旧 active 记 expired 并登记新派发，不自动启动请求。一次调用已结束但没有有效响应时尝试记 unknown，保持原目标 unconfirmed；此后可以明确选择该派发重试。unknown/expired 都不证明未发送或远端失败；前一个远端工作可能仍在执行。进程暂停、墙钟跳变及事务结束到实际派发之间的间隙无法靠本地期限消除，因此不承诺远端至多一次执行或全局互斥。此流程依赖既有确认位点单调语义，不更换目标，不把低位点观察当成重发许可。

有效响应即使对应已过期的派发，也只更新它绑定的派发和原目标；新派发的占用不会被旧派发释放。SDK 已超时后丢弃的底层迟到结果不自动写入日志。派发结算失败输出 dispatch_settlement_pending，已知完整服务器响应仍通过 server_result 保留；未知结果不自动重发。提交结果不明时先明确读取 ack-dispatch-status，不能猜测当前最新 ID。低层 prepare/confirm 方法仍供旧调用方使用；新调用方须使用 start/assert/settle 派发方法，旧 API 不提供此门禁。

## 缺派发历史的旧意图恢复

旧客户端可能已经登记原 unconfirmed 意图，却没有派发记录。它可能尚未发送，也可能仍在发送或远端已执行；本地缺记录不能证明未发送。普通 ack 继续拒绝此未知目标，ack-retry 也不能凭空生成上一次派发 ID。使用方可以继续 ack-observe；也可明确选择下述恢复命令，再次发送完全相同的原目标。

以下示例均未执行：

```text
workctx inbox enable-ack-recovery --inbox local-inbox.sqlite
workctx inbox ack-recover --inbox local-inbox.sqlite --page-file original-page.json --record-id ORIGINAL_RECORD_ID
workctx inbox ack-recovery-get --inbox local-inbox.sqlite --json-file acknowledgement-selection.json
```

enable-ack-recovery 需要已有 ack/dispatch 扩展，事务创建独立 recovery v1 元数据、恢复表及绑定/不可变触发器，不更改既有 core/ack/dispatch v1。已有完整扩展仅返回 already-enabled，缺对象/版本不符失败，不补造历史；普通打开、状态、init、ack、retry 均不隐式启用。启用只创建空结构，不登记任何恢复或发送请求。

ack-recover **会发送确认**。它要求显式原 record_id、完整原页面及当前原身份权限，可选 timeout-ms；不允许 dispatch-id、JSON、output、键/版本或重复参数。事务内核对该身份的最新原记录 ID 和页面摘要；目标仍 unconfirmed 且该 record_id 没有任何派发记录、没有恢复记录时才允许登记。已解决的同一最新目标返回本地 already-recorded，不发送、不新建恢复记录。原记录已变化返回 INBOX_ACK_RECOVERY_TARGET_CHANGED；已有派发或已登记恢复且仍未知则返回 INBOX_ACK_RECOVERY_HAS_DISPATCH，给出可用的最新派发 ID，后续必须明确选择 ack-retry。不能反复通过 recover 绕开派发 ID 比较。

一次恢复在同一事务内追加新 active 派发，并插入不可变恢复凭据；两者均读回后提交，提交成功才进入请求回调。仍复用每身份 active 占用、请求预算加 60 秒期限、回调前核对、原 trace 完整响应校验及结算机制。恢复凭据包含 recovery_id、原 record_id、first_dispatch_id、本次 invocation_trace_id 和 registered_at_ms；时间与首笔新派发 started_at_ms 一致。约束确保该派发属于同一原身份/目标，且登记时没有其他派发记录。恢复不替换原 command、cursor、页面摘要或 request_trace_id。

读取凭据明确返回 prior_local_dispatch_history=absent、prior_remote_outcome=unknown，均描述**恢复登记时**的事实。first_dispatch_id 是该目标首笔有本地记录的派发，不宣称它是首次真实网络发送。恢复成功后的 response 只证明本次可核验的原目标响应，不能冒充旧调用的历史回执。旧客户端可能仍在执行，当前扩展无法阻止它；使用方应先协调旧发送者，再明确选择恢复。即使本地占用有效，也不保证远端至多一次执行。恢复依赖现有服务器确认位点单调语义，不自动查询、重发或刷新身份。

恢复提交异常时不进入请求回调，保留 local_commit_state=unknown 的可能性。错误保留请求的原 record_id；先明确读取 ack-recovery-get/ack-dispatch-status，再决定后续操作。提交后发送前崩溃仍保留恢复及 active 派发，不能再次 recover；期限届满后可以明确选择该派发 ID 重试。网络或响应失败继续保留 unknown；完整服务器结果已收到但结算失败时，原 server_result 和恢复/派发绑定仍随错误返回。

ack-recovery-get 是已有 --inbox 上的本地只读命令，输入仅 `{expected_identity, record_id}`（--json 或最多 16 KiB 的 --json-file）。同一读事务核验完整原记录、首派发、恢复元数据/身份/时间，并检查没有更早的该目标派发，再返回 record、recovery 和 first_dispatch；无 output 时结果受既有 512 KiB 数据上限约束。不存在的同身份目标返回 null，已有目标未恢复时 recovery/first_dispatch 为 null；这不证明远端从未收到请求。不改变占用或状态，不访问网络。指定 `--output NEW_FILE` 时保存 ack-evidence v2，携带完整原页面、原记录、恢复凭据及其首笔本地派发；缺恢复凭据拒绝导出。普通 ack-get/ack-dispatch-get 仍生成 v1，只含原记录/选定派发/页面，不能从 v1 缺字段推断没有恢复。两版档案的边界和离线读取见 [凭据文件开发契约](sync-ack-evidence-runtime.md)。

## 本地历史与完整详情

以下四条命令均要求已有 `--inbox` 和恰好一个 `--json` 或 `--json-file`，JSON 必含完整 `expected_identity`。不接受 stdin、超时、键或额外/重复选项；两个 get 命令另可用 `--output` 保存完整凭据，列表仍拒绝 output，见 [凭据文件与页面恢复](sync-ack-evidence-runtime.md)。输入最多 16 KiB，文件读取须稳定、正规且为有效 UTF-8。main 与嵌入 runWorkctx 都在网络/令牌分支前处理这些命令。只使用已有库的 query_only 模式和读事务，不启用扩展、不修改状态或占用，也不重新查询服务器。

| 命令 | JSON 选择字段 | 返回内容 |
| --- | --- | --- |
| `inbox ack-history` | 可选 `limit`、`after_sequence`、`through_sequence`、`through_id` | 原确认记录摘要，包含原页面摘要、cursor、request trace、状态及响应/观察存在标志 |
| `inbox ack-get` | 必填 `record_id` | 指定原确认记录，包含完整 response/observation；同身份无记录返回 record=null |
| `inbox ack-dispatch-history` | 同上分页字段，可选 `record_id` 限定一个原目标 | 派发摘要，包含原 record_id、派发/调用标识、时间、状态及响应存在标志 |
| `inbox ack-dispatch-get` | 必填 `dispatch_id` | 指定派发及其原确认记录，两种完整证据一起读取；同身份无派发时两者均 null |

历史默认每页 20 条，范围 1–50；按 attempt_sequence 或 dispatch_sequence 升序读取，派发序号仍是每身份全局序号，限定 record_id 后允许跳号。初次 after_sequence 默认为 0，未给上界时在同一读事务内选取当前筛选范围的最新序号和 ID。若范围为空，返回空 items、through_sequence=0、through_id=null、has_more=false、next_query=null。限定了不存在的原 record_id 返回 INBOX_ACK_NOT_FOUND，不伪造空派发历史。

续页使用返回的 **next_query**，它完整保存原身份、可选原目标筛选、limit、末行 after_sequence 和首次 through_sequence/through_id。after_sequence 大于零必须同时提供两个上界字段；序号须为安全非负整数，上界为正整数，after 不得高于上界。上界 ID 必须仍属于同一消费者和筛选范围，且序号完全匹配；缺失/不符返回 INBOX_ACK_HISTORY_BOUND_CHANGED，不换成当前最新记录。后续新增的更大序号不会进入此轮翻页。next_query 是普通查询数据，不是签名、授权或完整历史证明；调用者可以主动重新从首轮查询开始。

各页最多取 limit+1 个有界元数据条目确定 has_more；返回摘要前逐条复用完整原页面、确认记录及派发证据校验，同时核验固定上界成员。坏记录导致本次失败，不跳过、不截断，也不返回未经核验的摘要。列表只投影摘要，完整成功响应/观察通过 get 命令读取。Bridge 返回数据序列化上限 512 KiB，超限拒绝并提示缩小页面，CLI 外层路径/trace 等字段另计；这是结果大小约束，不是数据库扫描、进程内存或耗时上限。

一次命令的所有读取在同一事务内，跨命令仅固定成员上界，**不冻结记录证据**。已在上界内的 active/unconfirmed 记录可能在下一页或后续详情中变为 confirmed/observed，故返回 consistency=fixed-upper-bound-current-evidence。历史读取不把到期 active 改为 expired，也不要求旧证据的授权提示今天仍有效；它只展示本地保存的历史，不证明当前权限、当前服务端状态、事件应用或全量历史无缺失。已有 ack 扩展即可查询原确认；派发查询另须已有 dispatch 扩展。本增量不新增 schema、迁移或索引。

## 完整确认历史只读审计

2026-11-03 增补，仅源码，未执行：

```text
workctx inbox ack-audit --inbox local-inbox.sqlite --json-file acknowledgement-audit-query.json
```

Bridge 的 auditAcknowledgements(input,trace) 与 CLI 共用 parseInboxAckAuditQuery。JSON 必含完整 expected_identity，仅可另含 max_entries，默认 1000，必须为安全正整数；输入最多 16 KiB。CLI 要求已有 --inbox 和 --json/--json-file 二选一，不接受 output、page-file、超时、写键、stdin 或重复/额外选项。主程序和嵌入入口均在网络路径前处理，用 query_only 连接，不需要令牌，不调用 router。

已有 ack 扩展是前提。dispatch/recovery 按已知表、版本元数据和索引/触发器名称探测，完全没有已知对象时标为未启用；只要有一个已知对象，就调用既有扩展校验，缺对象、缺列或版本不支持拒绝，不能静默按空日志处理。recovery 仍要求 dispatch；不创建、补齐或迁移任何对象。这只复用既有 schema 检查，不认证所有约束、触发器/索引的 SQL 定义。

一个读事务涵盖全部计数、关系检查和正文读取。先计算所选 consumer_key 的原确认、已启用派发及恢复表实际行数，以十进制文本/BigInt 相加，与 max_entries 比较。超出时返回 INBOX_ACK_AUDIT_LIMIT_REACHED、audit_completed=false，提供字符串 required_entries/各表 counts；不开始正文审计，不返回局部成功、续页令牌或自动提高预算。预算覆盖三类逻辑行总数，不是每张表各 1000 条。

预算内按最多 100 条有界元数据分批读取，不累积全部正文。原确认和派发各要求序号从 1 连续递增，遍历数量必须覆盖实际行数；无效序号、缺口、重复/无效 ID、无法完整选取的行不能被跳过。恢复按原 record_id 顺序遍历并核对 recovery_id 唯一性。每行复用完整读取，原记录的身份/目标/trace/状态、完整响应或观察及所引用原页面均重新验证；派发验证原记录、完整响应及时间/占用结构；恢复验证原目标、首笔本地派发、调用 trace/登记时间、此前未知标志及不存在更早的目标派发。

原确认目标 cursor 不得随 attempt_sequence 回退；最多一个 unconfirmed，且应是最新原记录。派发最多一个 active，且应是最新派发；不要求 active 所属原记录仍未解决，因为并发观察或旧接口可能已保存终态。审计按持久状态计数，不读取当前时钟把过期 active 改成 expired。旧原记录没有派发历史、已有确认没有可对应的派发成功响应、没有恢复凭据都可以合法存在，不能据此推断旧请求未发送或要求补造记录。逻辑原记录的首份成功响应与后续派发响应仍可不同，各自完整匹配同一原目标。

关系检查同时考虑所选消费者的子行及指向所选原记录/首派发的子行，拒绝缺父记录、跨 consumer_key 关联和恢复所指派发属于其他原目标；这能发现误归到其他消费者的直接关联子行，但不审计其他消费者的全部历史。

只有全部已启用日志行验证并成功结束读事务才返回 status=complete/audit_completed=true，附 audit_scope=consumer-acknowledgement-journals、consistency=single-read-transaction、expected_identity、extensions、checked、record_states、dispatch_states 和 max_entries。extensions.acknowledgement 为 1，可选扩展为 1 或 null；dispatch 未启用时 dispatch_states=null，不能与已启用空表的零计数混同。完整审计成功可以包含 unconfirmed/unknown/active，表示结构一致，不表示远端确认、请求成功或可以自动重试。

内容或引用损坏返回 INBOX_ACK_AUDIT_CORRUPT，附 reason、已完成 checked、能定位时的 kind/id/cause_code，只报告首个问题，不打印正文。数据库读取异常保留存储错误；派发/恢复读取的父记录读取和 SQL 已移出内容解析 catch，避免把 I/O 异常改报成损坏。schema 错误保持既有代码。进入审计后的错误均标记未完成，CLI 尝试关闭库后保留原错误及 close_pending。

审计只报告所选消费者当前本地历史的一次快照，不验证服务器签名、真实发送次数或执行顺序，不核验全页面链、全库物理完整性及 schema 定义；结果明确 page_chain_audit=not-performed、database_integrity=not-audited、event_application=not-verified。相关原页面会完整读取，但全页面链覆盖仍应另行显式 audit-pages，两次调用不是同一个原子快照。行数预算不保证硬性 CPU/I/O/堆上限，关系检查和反复引用原页面可能增加读取成本；长读事务也可能影响其他连接。没有写入、修复、证据导入、租约释放、重发或后台任务，真实运行证据仍缺。

## 已知服务器结果与本地失败

成功响应或有效当前观察已完整收到，若本地日志更新/提交失败，返回 INBOX_ACK_EVIDENCE_SAVE_FAILED，错误详情保留 server_result_kind、**完整 server_result**、record_id、库路径和 local_commit_state。不能把“日志未确认保存”改写成“服务器失败”；调用者应保留这份输出及原页面。确认成功响应此时 acknowledgement_dispatch_state=confirmed；只读观察仍为 not-sent，因为本次没有发送确认。

ack/ack-retry/ack-recover/ack-observe 可选 `--result-output NEW_FILE`，在打开库/请求前预检新路径。本次收到完整结果后，在原日志处理及尝试关闭库之后，保存独立调用结果文件，保留请求前原记录/派发快照、完整原页面和服务器结果，不把内存结果伪造成已入库日志。日志错误保持原 code/server_result，另附 result_file；本地重放/无有效新结果不创建文件。日志方法已完成但文件失败时返回 INBOX_ACK_RESULT_SAVE_FAILED 并保留完整结果。离线查看与原页提取不导入日志，见 [调用结果文件开发契约](sync-ack-result-runtime.md)。

正常确认结果也区分本次派发与历史记录：本次发送成功为 confirmed，本地 already-recorded 或 ack-observe 为 not-sent；历史是否已解决看 record.state。请求失败后的 unknown 仅描述本次确认不确定性。关闭连接失败以 close_pending 报告，不能抹去已知已提交的日志。

## 现阶段边界

SHA-256/本地日志不是服务端签名，Bridge 纯存储方法依赖调用者使用可信 Gateway/SDK 结果；任意直接写库或伪造调用不能当作认证证据。最新观察会替换该未解决票据的上一份低位点观察，没有保存所有查询历史。完整旧确认/派发记录已有分页及按 ID 读取源码；导入已知成功输出、完整历史导出与跨设备恢复尚未提供。

有派发历史的固定原目标显式重试、旧缺派发历史意图的明确恢复、历史浏览、恢复凭据 v2 文件携带及所选消费者完整确认日志审计已接源码；旧发送者协调、显式放弃、成功证据导入、后台策略、应用事务/applied_cursor、跨消费者整库审计/修复和旧客户端迁移仍未实现。不能删除/改写记录绕过门禁。观察到期检查与本地提交不是原子时钟边界；真实超时、并发、崩溃、磁盘/提交失败及升级兼容证据仍待后续授权验证。
