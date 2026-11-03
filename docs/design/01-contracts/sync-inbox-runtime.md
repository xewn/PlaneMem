# 本地同步收件箱与连续接收游标（开发契约）

2026-11-03：仅源码与文档，未编译、类型检查、测试、运行 CLI、打开 SQLite、创建样本、执行 schema 或发布。本增量新增独立本地收件箱 schema v1，初始化源码未执行；既有 outbox 三列升级和 PostgreSQL 016–049 仍未执行。无新增依赖，R-005 未完成。

## 目的与存储边界

在明确选择的本地 SQLite 文件中保存连续的完整同步页面及 received_cursor，进程重新启动后能读取同一消费者的当前保存位置。该值仅表示通过本模块连续导入的接收进度，**不是应用位点、服务端确认或权限证明**。页面仍为 [本地页面文件](sync-saved-page-runtime.md) 的 document/摘要契约，不保留令牌。

新 `SqliteSyncInbox` 从 Bridge 导出，与 SqliteOutbox 分开；没有读取/修改 local_events，也不调用 Gateway。五字段原身份经规范化 JSON 和 SHA-256 生成 consumer_key；每次读取同时核对完整身份 JSON 和显式 tenant/workspace/project/actor/client 列，不能只依赖哈希。一个收件箱可保存多个身份，各自拥有独立页面链和头。导入离线文件是用户对本地文件的操作，不从当前环境账号推断身份，也不赋予任何服务端权限。

## 显式初始化与 schema v1

构造器要求显式文件路径与 trace_id；默认只打开已有普通文件。`create:true` 通过 wx 独占保留新路径，再在事务内应用 `src/inbox/schema.ts` 的 v1 SQL；已有文件/链接/目录不覆盖，父目录必须存在。初始化失败保留新路径供检查，不能自动删除或把旧库当空库重建。拒绝内存库，已有文件不自动建表或升级；缺元数据版本/列返回 INBOX_SCHEMA_REQUIRED。

v1 包含 sync_inbox_schema 单行版本、sync_inbox_pages 完整不可变页面、sync_inbox_consumers 头页与接收位点。页面按 consumer_key/document_sha256 唯一，同时有消费者序号、前页摘要、起止 cursor、有效 limit、完整规范 document_json。前页与头使用复合外键，前页唯一约束和根页唯一索引防止同一消费者的两个分支；页面 UPDATE/DELETE 触发器拒绝常规修改/删除。消费者显式五字段唯一，并有三层 scope 索引。page_count 是安全递增的本地页面序号，received_cursor 是非负安全整数；相同游标也能保存新的终页观察。

连接设置并核对 foreign_keys=ON、synchronous=FULL，busy_timeout=5000。写事务 BEGIN IMMEDIATE；读取使用 BEGIN 保持多次查询同一快照。2026-11-03 后续源码修正：readonly模式在 `new DatabaseSync(path, {readOnly:true})` 打开时即指定原生只读，再继续query_only及已有schema检查；status/head/audit-pages和后续已有只读入口沿用。只读打开失败不回退可写、初始化或修复主库；readonly与create:true仍互斥，普通已有库写入和显式创建使用readOnly:false。该连接模式不隔离全部文件系统行为，显式文件导出仍可写新文件。文件路径检查与实际SQLite打开仍不是原子身份绑定，日志/锁与权限环境兼容性尚未验证；没有更改journal_mode或引入备份、加密、配额、目录掉电保证。使用现有Node 24及本地类型定义，无依赖变化；仅源码未执行。

## 导入与推进

`importPage({document,document_sha256}, trace)` 在进入数据库事务前固定并完整校验原页面，独立计算规范 document 摘要。网络输入不存在；共享解析继续核对页面范围、trace 形状、事件唯一性/顺序、来源和下一游标。完整 document 限 4 MiB + 32 KiB，完整文件输入限 4 MiB + 36 KiB，沿用深度/节点边界。

事务内读取消费者头及完整头页并重新核验后：

- 尚无该消费者：首篇 query.cursor 必须为 0，previous_page_sha256 必须为 null。仅仅从较高 cursor 保存的文件不能初始化连续接收链；没有隐式信任的高水位起点。
- 已有消费者：新页前驱摘要必须等于当前头摘要、query.cursor 等于头页 next_cursor、limit 与头页一致。否则 INBOX_CHAIN_MISMATCH，整笔回滚，不替换头、不补页、不回退为零。
- 完全重复 document：校验存储内容、身份、摘要和序号，返回 already-stored，并带**当前**头状态。重复历史页不会把当前头回退到该页。
- 合法新页：追加完整不可变页面，再以原头摘要/位点/序号为前置条件更新消费者；同一事务中重新读取完整新头，COMMIT 返回后才报告 stored。首篇页面与消费者行也在同一事务内创建。

BEGIN IMMEDIATE 与前驱唯一约束协调并发导入。同一页面并发重导最终为 stored/already-stored；竞争的不同后继不能都接到同一旧头。新页 next_cursor 可以等于旧 cursor（例如空终页），页面序号仍递增。limit 一旦开始该消费者链便保持固定；显式换页大小的重基线/跳过历史功能尚未提供。

## 状态读取与导出

`inspect(identity,trace)` 返回 identity、recorded、received_cursor、page_count、head_sha256、page_limit 和 event_application=not-verified。没有头也没有页面时 recorded=false/cursor=0/count=0；明确保存过零位点时 recorded=true。发现无头孤立页面、头范围/摘要/字段/序号不符、相邻前页缺失或不衔接、头之后有额外页面时返回 INBOX_CORRUPT，不伪装为空状态。

状态和 `readHead` 都完整核验头页；有前页时还加载并核验相邻前页的原身份、完整内容、摘要、序号、游标和 limit。SQL 在取出 document_json 之前限制字节长度，数值通过十进制文本读取再检查安全整数，避免隐式整数精度丢失。这两个入口不审计整条历史；较老页面的外部破坏不因当前状态读取通过就被证明不存在。需要完整页面链检查时显式调用下述 auditPages/audit-pages；普通导入与状态查询的工作范围保持原样。

`readHead` 返回读取快照中的完整原文件对象，保留原下载 trace 和摘要；不存在时报 INBOX_NOT_FOUND。CLI 在释放事务/关闭连接后导出到新文件，使用同一不覆盖/文件同步/完整读回保存协议；导出失败不修改收件箱。并发进程可能在之后推进头，导出的旧快照仍有效，但不承诺在输出完成时仍为最新头；从旧头产生的分叉会在后续导入时被拒绝。

## 历史页面浏览与精确导出

2026-11-03 增补，仅源码，示例未执行：

```text
workctx inbox page-history --inbox local-inbox.sqlite --json-file page-history-query.json
workctx inbox page-get --inbox local-inbox.sqlite --json-file page-selection.json
workctx inbox page-get --inbox local-inbox.sqlite --json-file page-selection.json --output restored-page.json
```

Bridge 提供 readPageHistory(input,trace)、readPageByDigest(input,trace) 及共享查询解析器。两个查询最多 16 KiB，都必含完整 expected_identity。page-history 可含 limit（默认 20，范围 1–50）、after_sequence（默认 0）和边界字段；page-get 只另含严格小写 64 位 document_sha256。CLI 要求已有 --inbox 与 --json/--json-file 二选一，使用 query_only 连接，无令牌、网络或路由调用；拒绝 stdin、page-file、多余/重复选项。列表拒绝 output，精确读取可选新 output。

首次列表默认以本次完整核验的头序号/摘要为 through_sequence/through_sha256。后续直接复制 next_query，保留原身份、limit、上界序号/摘要，以及上一页末项的 after_sequence/after_sha256。after_sequence>0 必须提供两组序号/摘要边界；after 不得超过 through，同序号的两个摘要必须相同。零起点不得带 after_sha256；调用者可以在零起点明确指定已有上界以重新浏览同一成员范围。

每次列表在单次读事务中核验当前头、固定上界和非零起点的原末页；返回页及上述边界均完整校验原页面/摘要/身份/元数据与相邻前页。不存在或序号/摘要不符的边界报 INBOX_PAGE_HISTORY_BOUND_CHANGED；边界正文损坏继续报存储内容错误，不替换成新头或跳过。列表按本地 sequence 正序查询最多 limit+1 条有界元数据，要求所选序号连续；返回项必须与起点和彼此之间的前驱摘要/游标衔接，终页必须到达固定上界。缺口或不匹配报 INBOX_PAGE_HISTORY_CORRUPT。

返回项为 sequence、document_sha256、previous_page_sha256、from_cursor、next_cursor、page_limit、page_trace_id、event_count、page_has_more；不累积或打印整页事件。只有完整验证返回项后才给摘要，列表结果数据上限 512 KiB。多取的一条只验证分页元数据，其正文留待下一页；因此 has_more 不保证下一页内容有效。没有数据且没有头时返回空列表，上界为 0/null；已到上界时返回空列表/next_query=null。

分页结果为 consistency=fixed-boundaries-current-read，固定成员边界不会混入后来追加的页面。每次读取仍是独立快照，不承诺跨调用的文件/存储快照、可信来源或整个中间链都已审计。边界字段不是签名；调用者可重新选择有效范围。非法范围被拒绝，未选择范围之外的损坏由独立 audit-pages 覆盖；所有历史结果标记 full_chain_audit=not-performed。

page-get 返回所选 page（完整 SyncSavedPageFile）、summary 和 current_state，原历史页面与当前消费者头分开。不存在的同身份摘要返回 page/summary=null，不代表该页面从未存在或远端没有该事件；不会改选当前头。存在时核验完整原页、与头的序号/limit 关系和相邻前页，不声称已验证目标到当前头之间的所有页面。

指定 output 时，先预检新路径，读事务结束并尝试关闭库后复用 saved-page 独占保存/同步/读回流程；缺目标报 INBOX_PAGE_NOT_FOUND，不生成空文件。保留原规范文档、下载 trace、身份、查询、前驱摘要和 document_sha256，结果另附 selected_sequence。不会覆盖原文件，也不保证原文件空白/BOM 字节相同；发布后读回失败保留已发布文件，关闭/清理状态与原错误分别保留。提取历史单页不推进或回退头，不补齐其他历史，不自动导入、续读或确认，不能作为全量备份。

## 完整页面链审计

2026-11-03 增补，仅源码，未打开库或执行：`auditPages({expected_identity,max_pages?},trace)` 与本地 `inbox audit-pages` 在同一只读事务内审计所选原消费者的全部页面。查询最多 16 KiB，只接受完整五字段身份和可选 max_pages；默认 1000，必须是安全正整数，允许调用者显式提高。直接 Bridge 调用和 CLI 输入共用 parseInboxPageAuditQuery。

审计先读取该 consumer_key 的实际消费者行数和页面行数，计数以十进制文本/BigInt 处理。无消费者且无页面是合法空链；多个消费者行、无消费者但有页面或有消费者但无页面均拒绝。实际页面行数超过 max_pages 时返回 INBOX_AUDIT_LIMIT_REACHED，required_pages 为十进制字符串，audit_completed=false；此时不开始正文链检查，也不返回局部通过或续页令牌。提高预算后的再次调用会使用新的读取快照，不能把多个未完成调用拼成同一次完整审计。

预算允许时，先核验消费者身份/头检查点和完整头页，头序号必须等于实际行数，再从头沿 previous_page_sha256 逐页读取直到根。每页复用完整共享页面解析、规范 document 原文比对、独立摘要计算、原身份和存储元数据核验；另外要求所取摘要与选择一致、序号严格减一、相邻 next_cursor/from_cursor 衔接、整链 limit 一致，序号 1 的前驱为 null 且起点为零。全部遍历数量必须等于实际页面行数。这使链外多余行、缺页、断链、较老正文损坏和序号/游标/身份不匹配不能通过完整覆盖检查。

成功只有 status=complete/audit_completed=true，并返回 audit_scope=consumer-page-chain、consistency=single-read-transaction、快照 state、checked_pages、checked_events、root_sha256 和采用的 max_pages。空链 state.recorded=false、两个计数为 0、root_sha256=null；已保存零游标页面仍为 recorded=true。checked_events 是页内规范事件条目总数，不证明事件被应用或服务器仍保留这些事件。计数不得超出安全整数，超限明确返回未完成。root/head 摘要仅描述同一次读取快照，之后可由其他进程推进。

完整内容或链关系异常返回 INBOX_AUDIT_CORRUPT，包含 reason、stage、已核验计数，能定位时另给 expected_sequence/document_sha256，不输出原页面正文；只报告首个发现的问题。SQL/文件访问异常保留存储不可用错误，不把读失败断言为页面损坏。进入审计后的错误附 audit_completed=false；CLI 在尝试关闭连接后保留原错误和 close_pending，不把关闭失败覆盖为审计成功。读事务结束失败同样不返回完整成功。

读取逐页进行，不在数组中累积历史正文；保留少量页面及计数，复用既有每页字节/深度/节点边界。max_pages 限制逻辑页面数量，不是硬性时间、磁盘扫描、SQL 次数或进程堆上限；实际行数查询仍需由 SQLite 扫描所选行，头核验可能重复读取相邻页。大预算与长读事务可能影响其他连接，应由调用者显式决定，源码没有额外后台任务、自动循环或修复。

结果明确 acknowledgement_history=not-audited、database_integrity=not-audited。范围仅为所选 consumer_key 的页面链及其检查点，不枚举其他消费者、不扫描归到其他 key 的行，不验证 schema/索引/触发器定义、全库物理完整性或 ack/dispatch/recovery 扩展。没有运行 PRAGMA integrity_check/foreign_key_check，不修复、补写、裁剪、导出全部正文或发送确认。摘要不能认证服务器来源，event_application 始终 not-verified。

## 已保存消费者发现

2026-11-03 增补，仅源码未执行：`listConsumers(input,trace)` 与本地 `inbox consumers` 可在原身份查询文件丢失时，从现有收件箱列出完整原身份及接收检查点。查询仅接受 `{limit?,after_consumer_key?}`，最多 16 KiB；limit 默认 20，必须是 1–50 的安全整数，续页键必须为 64 位小写十六进制。首页传 `{}`，不接受 expected_identity、额外筛选字段或当前环境身份。Bridge 和 CLI 共用 parseInboxConsumersQuery，CLI 在打开库之前完成查询解析。

每次调用用一个只读事务，按 consumer_key 的二进制升序选取最多 limit+1 行元数据。首屏不设置键下界，避免空键/null 键被首屏条件静默排除；返回到应用层的键和身份原文均有 SQL 字节/类型边界。全部选中元数据（包括一条前瞻项）必须满足合法严格递增键、完整五字段身份、规范 identity_json 原文及其 SHA-256 与键一致；不跳过损坏项。实际返回项再复用头读取，核验五个显式身份列、检查点、完整头页及相邻前页，缺失检查点不能伪装成未接收状态。前瞻项只核验身份元数据，不证明其头有效或下一页能够读取。

结果 kind=consumers，items 含 `{consumer_key,state}`，state.identity 是完整原五字段，另含 recorded=true、received_cursor、page_count、head_sha256、page_limit 和 event_application=not-verified；不打印完整页面正文。返回 limit、after_consumer_key（首页为 null）、has_more 和 next_query；有后续时 next_query 保留 limit、以本页最后一项的键作为下界，否则为 null。空库返回空 items、has_more=false、next_query=null。无总行数或自动续页，数据结果最多 512 KiB；超限报 INBOX_CONSUMERS_TOO_LARGE，应显式降低 limit，不能截断身份或隐式缩小页。该上限约束 Bridge 返回数据，不包含 CLI 的路径/trace/关闭状态封装，也不是头页读取的内存或磁盘扫描硬预算。

consistency=keyset-current-state：单次调用内列表与接收位置同一读取快照，跨调用成员和状态均可变化。consumer_key 是规范身份摘要，不是时间或递增序号；后来新增的键若小于等于已有续页下界，需要重新从 `{}` 开始才能看见，大于下界的新增项可出现在后续页。下界只是排他排序位置，不要求它对应的行仍存在，也不作为全库快照令牌。不能把多页汇总声明为某一时刻全量库存或备份。

外层 CLI scope=null，source_refs=[]，trace 为本次调用；每项身份明确区分不同 tenant/workspace/project/actor/client。可显式将选中 state.identity 放入 `{expected_identity:...}` 后交给 status/head，或附带各自选择字段用于 page-history/page-get/audit-pages/ack-audit。列表不读取当前账户或令牌，不授权远端访问，不切换账户、导出文件、自动导入/确认或修复。consumer_key 只用于本地查找与分页，不是凭据。

查询错误为 INBOX_CONSUMERS_QUERY_INVALID，选中身份/键或缺失检查点为 INBOX_CONSUMERS_CORRUPT，头页和相邻前页沿用 INBOX_CORRUPT；存储不可读保持 INBOX_STORAGE_UNAVAILABLE，不在内容解析 catch 中吞掉 I/O 异常。任一返回项失败均不返回局部列表；CLI 保留原错误并附 inbox/close_pending，事务结束失败也不报告成功。

范围为已存在消费者行的发现及有限头验证。full_chain_audit=not-performed、acknowledgement_history=not-audited、database_integrity=not-audited；不查所有历史页或确认扩展，不发现没有消费者行的孤立页面，不验证约束/触发器定义或物理完整性，也不证明服务器来源、远端确认或事件应用。core/扩展 schema 均未更改；仍没有执行库打开、迁移或运行验证。

## 完整页面链归档与恢复

2026-11-03 增补，仅源码：Bridge readPageChainArchive/restorePageChainArchive 和本地 inbox export-pages/inspect-pages/restore-pages 支持一个原消费者从根到头的完整有界档案。最多 1000 页、16 MiB 文档并受整体 JSON 复杂度限制，导出同一读事务完成全链校验，保存后核验全部页/文档摘要和实际文件字节；恢复只允许空消费者或完全相同的完整链，全部页面与检查点同一写事务提交，不合并或覆盖不同链。确认/派发/恢复日志及应用状态不包含。完整格式、空链/重放/提交未知语义见 [页面链归档契约](sync-page-chain-runtime.md)。未生成文件、打开库或运行命令。

2026-11-03 前缀追加增补：comparePageChainArchive/appendPageChainArchive 与 CLI compare-pages/append-pages 支持完整核验后的显式后缀追加。比较返回链关系和最早重叠差异，兼容时给出绑定原身份/归档摘要/预期本地头及页数的 append_query；追加在同一写事务重新核对所有页面和检查点，只补入未保存后缀。过期、分叉或较短归档拒绝，原 restore-pages 规则不变，详见同一归档契约。仅源码文档，未运行。

2026-11-03 离线选择增补：archive-history/archive-page 可直接对完整验证后的归档分页浏览、精确读取或提取原单页，不加载 Bridge 或打开库。续页绑定归档摘要，单页选择同时绑定归档和页面摘要；原摘要、下载 trace、前驱关系均保留，提取不绕过后续导入的连续链规则。具体查询和新文件保存边界见页面链归档契约，仅源码未运行。

## CLI

以下仅为源码接口示例，未执行：

```text
workctx inbox init --inbox local-inbox.sqlite
workctx inbox import --inbox local-inbox.sqlite --page-file page-001.json
workctx inbox consumers --inbox local-inbox.sqlite --json '{}'
workctx inbox status --inbox local-inbox.sqlite --json-file consumer-identity.json
workctx inbox audit-pages --inbox local-inbox.sqlite --json-file page-audit-query.json
workctx inbox head --inbox local-inbox.sqlite --json-file consumer-identity.json --output restored-head.json
workctx sync changes --page-file restored-head.json --output next-page.json
workctx inbox import --inbox local-inbox.sqlite --page-file next-page.json
```

init 只接受 --inbox；import 还必须有 --page-file；status/head 必须用 --json 或 --json-file 二选一提供 `{expected_identity:原五字段身份}`，head 还需 --output。audit-pages 同样要求 --inbox 与 JSON 二选一，page-audit-query.json 仅含 expected_identity 和可选 max_pages，不接受 output/page-file。查询最多 16 KiB，文件须为稳定普通 UTF-8，可带 BOM；拒绝 stdin、重复/未知选项、写键、timeout、队列参数及其他混用。没有默认库路径，也不复用 WORKCTX_OUTBOX。main/runWorkctx 都在网络与通用文件路径之前分流，本地命令不需要 WORKCTX_* 环境身份或令牌，不调用 router。

consumers 同样要求 --inbox 和 --json/--json-file 二选一，首页 JSON 可为 {}，续页可显式复制 next_query；拒绝 output/page-file/expected_identity。init 和 consumers 的 scope 为 null；按身份读取的输出带原 scope，均保留当前 trace/source_refs=[]。import 报告本次 imported_sha256、stored/already-stored 和当前 state；status 显示当前 state；head 沿用页面文件保存摘要，并保留原 page_trace_id。关闭连接失败用 close_pending 表示，不能抹去已知成功提交。所有本地命令 acknowledgement_dispatch_state=not-sent；不自动保存服务器 ack 结果，也不发送 ack。

## 失败与剩余工作

写 COMMIT 抛错返回 INBOX_COMMIT_UNKNOWN/local_commit_state=unknown，即使后续尝试 ROLLBACK 也不能保证未提交。保留库和原页面，显式重新读取同一身份的状态后再决策；不自动重导。其他本次写失败为 not-committed，不能据此推断过去从未导入。文件/库无法打开、版本不符、无效身份/页面、链不符、损坏和安全序号耗尽分别有固定代码；数据库/路径原始异常不透传。状态读取遇到数据问题会明确失败，不回退为 cursor=0。

没有事件应用器或应用事务、applied_cursor、自动消费任务、跨消费者整库审计/修复、裁剪/保留策略、包含确认历史的全库备份/跨设备恢复、跳过/重基线流程及 MCP/Web 对接。历史页浏览/单页恢复、所选消费者完整页面链审计和有界页面链档案恢复已有上述源码；确认日志及独立 ack-audit 已由 [确认扩展](sync-inbox-ack-runtime.md) 增补，两种审计不能拼成同一次原子快照。不能把连续接收等同于已消费，不能把摘要当作服务器签名。真实并发、跨进程、磁盘故障、提交不确定性、断电及旧运行时兼容证据均待后续授权验证，源码不代表运行通过。
2026-11-03 确认日志增补：独立可选 ack 扩展 v1 已另接显式启用、原目标先持久登记、事务外确认、完整响应/当前观察分别结算和最新日志读取，见 [收件箱原确认日志](sync-inbox-ack-runtime.md)。核心 v1 与上述接收进度语义不变；有派发历史的显式原目标重试已另接 dispatch 扩展源码，旧未知意图的明确恢复已另接 recovery 扩展源码，应用事务与旧发送者协调仍缺，扩展未执行，不能把源码当作运行闭环。

2026-11-03 应用扩展协接：新增显式启用的本地 JSON 投影事务和独立应用头，详见 [本地投影与应用进度](sync-inbox-application-runtime.md)。core 的 received_cursor、inspect.event_application=not-verified、页面导入/归档和 ack 行为不变；应用必须按原身份/应用版本/原页/预期前驱另行执行，不自动推进或恢复。扩展 schema 与运行证据仍未执行。
2026-11-03 应用状态 CLI 增补：`inbox enable-applications --inbox FILE` 和 `inbox application-status --inbox FILE --json-file QUERY.json` 已接本地分流；状态输入完整 expected_identity/application 名称版本，严格解析后只读打开，输出 data.state 保留完整投影及本地边界。启用与读取均显式调用，不由接收/导入触发；具体规则见 [应用运行契约](sync-inbox-application-runtime.md)。仅源码文档，未打开库、执行初始化/迁移、编译或测试。
