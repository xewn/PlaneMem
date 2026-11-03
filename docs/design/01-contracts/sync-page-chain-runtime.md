# 单消费者完整页面链归档

状态：2026-11-03 仅源码与文档。未编译、类型检查、测试、执行 CLI/SDK/API、生成样本、打开数据库、迁移或发布。复用现有 inbox v1，无新 schema 或依赖。

## 格式与校验

`workctx.sync-page-chain` v1 保存一个原消费者从零起点根页到归档头的完整有序页面。文件只有 document/document_sha256，document 只有 schema_version=1、kind、完整 expected_identity 与 pages；pages 为按接收顺序排列的原 SyncSavedPageFile。原下载 trace、查询、事件内容/字段顺序、previous_page_sha256 和页面摘要保留。归档摘要覆盖规范 document UTF-8，文件字节摘要独立覆盖实际保存的整个文件。

共享 parseSyncPageChainDocument/File 严格拒绝未知字段、非法 JSON 值/原型/访问器，复用完整原页面解析。每页五字段身份必须等于归档身份，首篇 cursor=0/previous=null，后续 previous 等于前页摘要、from cursor 等于前页 next cursor，整链 limit 一致且页面摘要唯一。文件/存储适配独立计算所有嵌套页面摘要及外层文档摘要；结构解析器本身不计算摘要。摘要仅供内容一致性检查，不认证服务器来源。

一个归档最多 1000 页，规范 document 最多 16 MiB，完整文件最多 16 MiB+4096 字节；每页继续受原大小/事件数量限制。整个文档和文件沿用 syncJsonSnapshot 的 100000 节点、64 层复杂度限制，可能先于字节/页数上限触发；不保证能容纳任意 1000 页。不自动截断、拆分、压缩或改为较小范围。实现保留完整有界文档并多次解析/序列化，这些限制不是进程堆、CPU、I/O 或事务时间硬预算；大链流式格式尚未实现。

空 pages 合法，summary 的 recorded=false、page_count/event_count/received_cursor=0、root/head/page_limit=null。含已记录零游标页面的非空链则 recorded=true。summary 在完整解析/摘要验证后输出，不包含页面正文。

## 导出

Bridge `readPageChainArchive(identity,trace)` 在一次读事务中复用完整链审计，检查实际消费者/页面行数、头检查点、每个完整原页面及连续序号/游标/前驱/固定 limit，必须覆盖该消费者实际全部页面。核验过程中按头到根收集，逐页累计文档字节，完成后反转为根到头并生成规范档案；异常不返回局部档案。

实际页面超过 1000 返回 INBOX_AUDIT_LIMIT_REACHED，内容/成员异常沿用 INBOX_AUDIT_CORRUPT；文档字节或整体 JSON 表示上限为 INBOX_PAGE_CHAIN_LIMIT_REACHED。存储读取失败保持原类别。仅导出完成那次读取快照；之后源库仍可追加页面。

CLI `inbox export-pages` 要求已有 --inbox、--json/--json-file 二选一及新 --output。查询最多 16 KiB，唯一字段为完整 expected_identity；拒绝 max_pages、limit、游标、page-file、archive-file 或远端参数。输入/输出路径预检后才打开 query_only 连接。结束事务并尝试关闭库后保存文件，不在文件操作期间保持事务。

保存复用独占临时文件、同步、读回、硬链接不覆盖发布；发布后再读取最终普通文件，核验完整格式、所有摘要和实际文件长度/摘要。失败保留临时/目标路径与清理状态；最终读回失败为 published-unconfirmed，不删除已发布文件。不承诺与原单页文件空白/BOM 字节相同。摘要输出含原身份、页数、事件条目数、根/头摘要、received_cursor、page_limit、档案/文件摘要和保存路径。

## 离线检查

`inbox inspect-pages --archive-file FILE` 使用稳定普通文件有界读取，支持 UTF-8 BOM，核验整份结构及所有摘要，不打开 inbox、不动态导入 Bridge、不获取账户/令牌或请求网络；只输出链摘要及实际文件摘要。

离线结果只证明文件内容形成从根到其最后一页的有效链，不能证明这是源库最新头或文件来自可信导出器。截短后重新计算摘要的有效前缀无法靠本地摘要识别为旧副本；确认最新源状态仍需独立读取原库，离线检查不是全库备份审计。

## 离线历史浏览与单页提取

2026-11-03 增补，仅源码：`inbox archive-history` 与 `inbox archive-page` 只读取 --archive-file，要求 --json/--json-file 二选一，拒绝 --inbox、远端参数、stdin 和重复/未知选项。分流位于动态 Bridge 导入之前，不打开库、不获取当前账户或令牌。每次调用仍完整读取有界文件并核验全部页面、前驱关系及嵌套/外层摘要；不能只验证选中页而跳过归档其他部分。

archive-history 查询最多 16 KiB，仅接受可选 archive_document_sha256、after_sequence 和 limit。首页可为 {}，after_sequence 默认 0、须为非负安全整数；limit 默认 20、范围 1–50。after_sequence>0 必须带原归档摘要；首页也可显式提供摘要进行绑定。归档摘要必须为 64 位小写十六进制且匹配实际规范文档，否则 INBOX_ARCHIVE_CHANGED。after_sequence 大于归档页数为 INBOX_ARCHIVE_POSITION_INVALID，等于总页数返回合法空尾页。

历史按归档根到头的 1 起始序号返回 items；每项包含页面摘要、前驱摘要、起止游标、limit、原下载 trace、事件条目数与原 page_has_more，并提供可直接用于精确详情的 selection_query（归档摘要/页面摘要）。分页 has_more 只表示该归档还有页面，与服务器原页面的 page_has_more 分开；next_query 固定该归档摘要、最后返回序号和 limit，结束为 null。空归档返回空 items/has_more=false，不等于任何服务器空结果。历史选择结果最多 512 KiB，超限明确 INBOX_ARCHIVE_HISTORY_TOO_LARGE；该上限不含 CLI 的源文件路径/摘要和 archive_summary 封装，也不限制整个原档的读取成本。

archive-page 查询严格为 `{archive_document_sha256,document_sha256}` 两个摘要，不接受裸序号选择。返回 kind=archive-page、原身份、归档/页面摘要、sequence、完整原 page 和单页 summary；无目标时后三者为 null，不能用头页替代。archive-history/page 的 CLI 结果另含 archive_summary 与源文件路径/字节长度/字节摘要，区分整个归档头与选中历史页；外层 trace 为本次调用，内嵌页面仍使用原下载 trace。

只有 archive-page 可以指定 --output NEW_PAGE。归档/查询/目标先完整验证，缺页报 INBOX_ARCHIVE_PAGE_NOT_FOUND、不生成空文件；匹配后复用原页面新路径保存、独占发布和最终完整读回，保留原 document_sha256、前驱与下载 trace。结果另附 selected_sequence 和 source_archive_document_sha256/source_file_sha256 等来源元数据；保存/最终读回失败保留这些来源及既有恢复路径/清理状态，不删除已发布但未确认的文件。导出的中间页仍依赖原前驱，不能绕过 inbox import 的连续链要求；本命令不自动导入、追加、续读或确认。

历史/详情查询错误分别为 INBOX_ARCHIVE_HISTORY_QUERY_INVALID/INBOX_ARCHIVE_PAGE_QUERY_INVALID；原文件不可读或损坏仍沿用 PAGE_CHAIN_FILE 错误，在完整核验失败时不返回空页或局部正文。consistency=content-bound-archive 表示续页/选择绑定同一规范文档：文件空白/BOM 变化但规范文档相同可以继续，替换为不同身份、不同页面或不同头的有效档案也必须拒绝。此绑定不证明源库/服务器的当前头、权限或文件来源真实性；event_application 仍 not-verified。

## 原子恢复

Bridge `restorePageChainArchive(value,trace)` 在开始写事务之前完整解析、校验外层与每页摘要。CLI `inbox restore-pages --inbox EXISTING --archive-file FILE` 先稳定读取并校验文件，再打开已有 inbox；不隐式创建库、启用扩展或迁移。需要新库时另行显式 init。全程无网络或服务器确认。

BEGIN IMMEDIATE 内检查目标消费者：

- 无消费者且无页面：按根到头复用原页面追加逻辑，整档同一事务写入；提交前再次全链审计并逐页核对归档规范正文，返回 stored、added_pages 和 state。
- 已有完整链：实际行数/头序号必须与归档长度相同，所有页的规范正文及对应序号相同，整链审计通过后返回 already-stored、added_pages=0，不回退或重复追加。
- 已有部分、不同或更长链：INBOX_PAGE_CHAIN_CONFLICT，不合并/覆盖。目标超过 1000 页会先报审计预算不足，不用局部检查推断全链相同。孤立/损坏/成员不一致沿用审计错误。
- 空归档与空消费者：empty、added_pages=0，不制造无页面的消费者行；空归档不能清空已有链。

目标判断与写入处于同一事务，逐页之间不提交，调用内部事务助手而非会另开事务的公开 importPage。中间失败尝试整体回滚；COMMIT 抛错保留既有 INBOX_COMMIT_UNKNOWN/local_commit_state=unknown，之后 rollback 不能证明未提交。调用者保留原库/档案，显式读状态或重试同一完整档案；如果目标后来继续推进，旧档重放会拒绝。关闭失败单列 close_pending，不覆盖原错误或已确认提交。

恢复保留原消费者身份，不映射当前账号/客户端。档案没有确认、派发、恢复凭据或租约，不写这些表，CLI 返回 acknowledgement_journal_update=not-performed。原确认日志不因恢复被删除/结算，一致性仍需独立 ack-audit；不能将缺历史解释为从未发送或据此自动补发。event_application 始终 not-verified，恢复 received_cursor 不创建 applied_cursor 或执行事件。

## 完整比较与显式前缀追加

2026-11-03 增补，仅源码：`comparePageChainArchive(archive,trace)` 在校验整份归档后，以一次读事务审计所选消费者全部本地页面，逐页比较重叠序号的规范正文及摘要。它不只对比游标或头摘要，也不会在首个差异后跳过本地链审计。实际页面数、头检查点、全部前驱与零根页均须通过，最多 1000 本地页；预算不足、孤页、损坏或存储失败返回错误，不生成部分比较结果。

结果含归档摘要/页数、同快照本地 state、checked_local_pages、matching_prefix_pages 和以下 relationship：

| relationship | 含义 | append_query |
| --- | --- | --- |
| identical | 两条完整链逐页相同，包括两者皆空 | 可生成，追加 0 页 |
| local-empty | 本地为空，归档非空 | 可生成，追加归档全部页面 |
| local-prefix | 完整本地链等于归档开头，归档含后续页面 | 可生成，只追加后缀 |
| archive-prefix | 归档是较长本地链的前缀，包括空归档 | null，拒绝回退 |
| diverged | 重叠序号存在不同页面 | null，拒绝分叉 |

分叉返回 first_difference（最早不同的 sequence、local_sha256、archive_sha256），不返回正文；matching_prefix_pages 为该序号之前的匹配页数。无重叠差异时 first_difference=null、匹配页数为两边较小页数。append_allowed 及 pages_to_append 描述该次读取快照，不是跨调用锁或授权凭据。归档快照与本地快照来自不同时间，比较只报告内容关系，不证明哪次远端请求先发生。local_acknowledgement_history/database_integrity 均 not-audited，原归档 acknowledgement_history 仍 not-included。

允许追加时，append_query 严格包含四字段：完整 expected_identity、archive_document_sha256、expected_head_sha256、expected_page_count。头摘要与归档摘要为 64 位小写十六进制；页数为非负安全整数，只有页数 0 对应 null 头，其余须有摘要。查询最多 16 KiB，拒绝额外字段或不成对的空头/页数。默认比较只返回该对象；调用者可复制它，或显式指定 --output 保存新查询文件。比较不修改数据库或执行追加。

`appendPageChainArchive(archive,query,trace)` 在事务前完整验证归档/查询，核对原身份与归档摘要，不能将某次比较对象换用于另一份档案。BEGIN IMMEDIATE 内重新完成全本地链比较，再核对当前头摘要/页数是否仍等于选定检查点；不一致报 INBOX_PAGE_CHAIN_APPEND_STALE，即使当前链恰好已经等于归档也不会忽略过期前提。有效前提下若本地链分叉或长于归档，报 INBOX_PAGE_CHAIN_CONFLICT。旧头与原身份不被当前环境或新比较结果替换。

仅在本地为完整匹配前缀时，通过已有事务内助手追加尚未保存的后缀，逐页不提交，最后再次全链核验并确认与归档完整相同后才提交。成功返回 appended、added_pages、previous_state 和 state；完整相同或双方空则 already-stored、added_pages=0，不重复追加或创建空消费者。中间失败尝试整体回滚，COMMIT 异常仍为 unknown；保留原档案/查询，通过显式重新比较查看当前状态，不自动改写查询或重试。已提交追加后再次提交旧查询会因头已变化而过期；原 restore-pages 的“空目标或完整相同”规则不变，可独立用于精确整档重放检查。

CLI compare-pages 要求已有 --inbox 与 --archive-file，拒绝 JSON，可选 --output NEW_QUERY；打开 query_only 连接。append-pages 另必须 --json/--json-file 二选一提供完整 append_query，拒绝 output。文件、查询结构与原身份/归档摘要绑定在打开目标前校验，Bridge 直接调用同样复核全部输入。两条主程序/嵌入路径均无网络、当前账户或自动重试。schema、归档 v1 格式及确认日志均不改变，event_application 仍 not-verified。

追加查询无效为 INBOX_PAGE_CHAIN_APPEND_QUERY_INVALID；查询与归档身份/摘要不匹配为 INBOX_PAGE_CHAIN_APPEND_INPUT_MISMATCH；本地头改变为 INBOX_PAGE_CHAIN_APPEND_STALE。未要求保存文件时，比较成功但不能追加仍是正常比较结果，CLI 返回成功并给出 append_allowed=false/append_query=null；调用者不能仅用退出码判断可写。

## 保存选定的追加查询

2026-11-03 增补，仅源码：`compare-pages --output NEW_QUERY` 可将兼容比较中的 append_query 直接保存为 append-pages --json-file 输入。新路径在打开库之前预检，拒绝已有文件/链接；比较完成、读事务结束且连接关闭已尝试后才写文件。文件仅含原四字段查询，最多 16 KiB，不包含比较封套、正文、数据库路径、文件摘要或额外状态字段。

保存前再使用共享查询解析器和有限 JSON 序列化，保留该次比较的原身份/归档摘要/头摘要/页数；不重新读取本地头来更新请求。独占临时文件、同步、读回、硬链接不覆盖发布后，再读取最终普通文件，核对实际长度、SHA-256、共享解析及规范查询原文。成功返回 append_query_file，包含 path、state、content_state、file_bytes、file_sha256 及清理信息；原比较字段和 append_query 仍在响应中。

指定 output 而比较不兼容时，报 INBOX_PAGE_CHAIN_NOT_APPENDABLE/local_state=not-saved，details.comparison 保留完整比较及源文件摘要，不生成空计划或不安全计划。未指定 output 时保持原成功比较语义。新路径不可用报 INBOX_PAGE_CHAIN_APPEND_QUERY_OUTPUT_UNAVAILABLE；保存失败为 INBOX_PAGE_CHAIN_APPEND_QUERY_SAVE_FAILED；最终读回失败为 INBOX_PAGE_CHAIN_APPEND_QUERY_READBACK_FAILED/local_state=published-unconfirmed，保留已发布文件，不自动删除、覆盖或重新比较。文件操作错误附原比较、原路径/临时路径/清理状态、inbox 和 close_pending，不能把文件失败改报为成功。

查询文件不是锁、凭据或服务器回执；保存成功也不证明本地头仍停留在比较快照。保存期间或之后其他进程推进头，后续 append-pages 仍按原检查点拒绝过期请求。文件不绑定目标路径，同一原消费者/检查点的另一份本地副本也须完整通过追加前核验；调用者始终显式选择目标 inbox。追加和文件保存互不自动触发，格式/schema/依赖未改变，未执行实际保存或读回。

## 使用与错误

以下仅为源码接口示例，未执行，也未生成文件：

```text
workctx inbox export-pages --inbox source.sqlite --json-file original-identity.json --output original-pages.json
workctx inbox inspect-pages --archive-file original-pages.json
workctx inbox archive-history --archive-file original-pages.json --json '{}'
workctx inbox archive-history --archive-file original-pages.json --json-file saved-next-query.json
workctx inbox archive-page --archive-file original-pages.json --json-file selected-page-query.json
workctx inbox archive-page --archive-file original-pages.json --json-file selected-page-query.json --output original-page.json
workctx inbox restore-pages --inbox destination.sqlite --archive-file original-pages.json
workctx inbox compare-pages --inbox destination.sqlite --archive-file original-pages.json
workctx inbox compare-pages --inbox destination.sqlite --archive-file original-pages.json --output selected-append-query.json
workctx inbox append-pages --inbox destination.sqlite --archive-file original-pages.json --json-file selected-append-query.json
```

original-identity.json 为 `{expected_identity:原五字段身份}`；saved-next-query.json 为历史返回的 next_query，selected-page-query.json 为选中项的 selection_query。selected-append-query.json 可由显式 compare-pages --output 创建，内容为完整 append_query 对象，不是整个比较封套。全部命令拒绝 stdin、未知/重复选项及参数混用。main 与 runWorkctx 都在网络入口前分流；source_refs=[]，scope 为档案原项目，trace 为本次调用。跨账号/项目文件不赋予远端权限。

文件不可读/超物理字节上限为 INBOX_PAGE_CHAIN_FILE_UNAVAILABLE；结构/摘要错误为 INBOX_PAGE_CHAIN_FILE_INVALID；Bridge 恢复输入错误为 INBOX_PAGE_CHAIN_INVALID。查询不可读/无效分别为 INBOX_PAGE_CHAIN_QUERY_UNAVAILABLE/INVALID；输出路径/保存/最终读回分别为 INBOX_PAGE_CHAIN_OUTPUT_UNAVAILABLE/SAVE_FAILED/READBACK_FAILED。schema/存储错误保持原类别，失败不降级为部分成功或空链。

范围是有界单消费者接收页面，不是 SQLite 文件备份或整个同步历史迁移。其他消费者、确认日志、应用状态、外部副本、schema/索引/触发器及物理完整性不包含在档案中。跨进程、回滚、提交未知、文件发布/断电及运行兼容证据仍缺，待用户授权运行后验证；本次不补造通过证据。
