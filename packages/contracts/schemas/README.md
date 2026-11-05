# 独立契约结构定义

## 单条审计视图导出

2026-11-05，TODO P0-01：新增 [audit-export.json](audit-export.json)，对应 [audit-export OpenAPI](../openapi/audit-export.json)。AuditExportRequest 是封闭 scope/audit_id/sha256；AuditExportRecord 完整建模有界记录、原始字节数、available/too-large 与 null/[] 组合；AuditExportDocument 固定 bounded-view；Result/Envelope 给出规范摘要/字节、不同目标的放行 ID、两条有序来源及 not-confirmed 送达状态。FailureState 仅用于处理器自建错误/SDK 规范错误详情，不冒称所有上游错误都有放行信息。

记录源码解析可容忍部分扩展再重建，Schema 表示规范输出；来源扩展丢弃、历史时间规范为六位小数 UTC，session_id 可 null 或非空文本而非强制 ULID。原详情/来源大小是 SQL JSONB 文本计数，不要求与返回 JSON 字节相等；可用字段另有 32/16 KiB 序列化限制，候选记录/元数据限 68/16 KiB。details 可为任意允许的 JSON 值，导出规范化额外要求有限数、安全整数、普通对象和整个文档深度64/节点10000/96 KiB。

静态结构不计算摘要/UTF-8 大小、有效日历、当前身份权限或 source/ID 跨对象等式；scope 的实际限制使用 UTF-16 且拒绝孤立代理项。Shared envelope parser 只核对声明摘要与原选择相等，不自行计算 SHA-256；Gateway/SDK 分别独立计算。成功总大小 128 KiB、原选择 4 KiB，放行不证明文件保存。复用 session-activity-read ULID 标量；未运行校验器/生成器/编译/测试，P0-01/R001 未完成、evidence 为空。

## 旧记忆交接

2026-11-05，TODO P0-01：新增 [memory-handoff.json](memory-handoff.json)，对应 [两路 OpenAPI](../openapi/memory-handoff.json)。MemoryHandoffCreateBody/ClaimBody 描述开放旧正文、实际非空字符串提取、领取客户端优先级和全局版本头/正文相等条件；正文键不启用进程幂等。此路径不进入签名身份分支，Schema 也不把正文/请求头范围视为身份凭据。

MemoryHandoffCreateResult/ClaimResult 和两类 Envelope 给出内置实现的完整名义返回；LocalCreateResult/McpCreateResult 进一步区分进程 handoff://ULID 与远端编码引用。两种引用不代表会话交接记录，创建只读页面/创建 provider 交接，领取没有父子会话、检查点、版本或原回执。外层唯一来源等于 page_ref，无 ETag；进程缓存命中保留整份原成功及原 trace。自定义外部 provider 返回未经过这些 Schema 解析。

静态结构不能检查编码引用和实际页面/当前身份范围之间的绑定；旧领取没有当前范围入参，本地 already_claimed 不比较旧领取者，远端未严格解析的 status 会归并为 already_claimed，不能用返回状态证明原账号归属。完整限制见 OpenAPI 说明。新 Schema 无外部结构引用；未运行校验器、生成器、编译或测试，P0-01/R001 未完成、evidence 为空。

## 会话续接与原回执

2026-11-05，TODO P0-01：新增 [session-resume.json](session-resume.json)，配套 [两路 OpenAPI](../openapi/session-resume.json)。Body 描述开放旧 HTTP；Command/ReceiptQuery 为严格原参数；ReceiptBody 允许路径覆盖的外层 session_id；Binding 固定原身份/父会话/有效要求，可选 expected_checkpoint_id 仅约束结果。SessionResumeOrigin 是精确 handoff_id/checkpoint_id/require_claimed。

SessionResumeResult/Envelope 描述完整旧 HTTP，复用 CheckpointSaveWireRecord 和 HandoffLegacyClaimResult；SessionResumeClientResult/Envelope 独立描述 SDK 规范输出，复用 CheckpointSavedRecord。子会话可已结束或进展到更高版本，不假定重放一定 version=1；它的单条 session 来源 ID 是原 client_id。交接单条来源是返回检查点，旧领取缺账号只在有效 require_claimed=false 时可接受。所有身份/父子/来源/哈希/时间关系需运行解析器额外核对；源扩展保留，四核心字段比较不比较扩展。

SessionResumeWirePackReceipt 完整描述旧 checkedDocument 的保存包返回，保留包/item/exclusion 扩展且没有 rendered；独立 SessionResumeClientPackReceipt 描述 parseContextPackReceipt 的规范输出。二者均不能直接套用更严格的 GET Schema；旧服务端没有独立包 trace/来源并集/1000 数量检查，SDK 日期接受有限 Date.parse、文本上限使用 UTF-16、来源按四字段去重，不核验实际哈希/当前有效期/渲染正文。服务端实际计算 SHA-256 并检查来源现状，检查点 state_hash 仍是旧 32 位摘要，二者不可混同。

SessionResumeReceiptLookup/Envelope 为 recorded/not-observed/legacy-unverified，只读原子会话行绑定，不含当前状态或完整资源。recorded 总为 not-checked；SDK 要求子父不同、原有效要求/可选检查点一致，服务端没有显式子父不同检查。所有成功无 ETag，SDK 拒绝它。本地加载 session-activity-read/session-start/checkpoint-write/checkpoint-read/handoff-claim 和传递引用；静态结构不代替身份、事务、授权、跨字段关系或完整 JSON 深度验证。仅源码、指定格式与 Git 文本检查，未运行校验器/生成器/编译/测试，evidence 为空。

2026-11-05，TODO **P0-01**：新增 [handoff-create.json](handoff-create.json) 与 [handoff-claim.json](handoff-claim.json)，HTTP 见 [handoff-commands OpenAPI](../openapi/handoff-commands.json)。完整定义创建/领取原命令、HTTP Body、严格 Query、固定原身份 Binding、历史 Recorded/Lookup 和普通/回执封套，包子路径对应文件名。本地注册 session-activity-read/session-start/handoff-read，复用标量、原键及规范来源。

创建无版本条件，Body 可有原传输键，逻辑 Command 不含键；原可选 session_id/from_client/target_client 保留。创建原外层 session_id 必须与路径一致；领取原外层 handoff_id 则被覆盖。领取 Body 区分有键 DurableBody 和无键 LegacyBody，头键决定分支的关系必须由运行入口检查，静态正文 union 无法单独保证。带键原版本最高 MAX_SAFE−1；查询必须包含原有效版本。创建回执拒绝新写入头，领取回执忽略合法新头，两者保留原可选字段而非从当前状态补造。

创建 Result 是当前交接和固定创建版本 1 回执；open/version=1 无领取字段，claimed 必须有账号和客户端，expired 可以没有或只有旧客户端，账号存在则需客户端。来源最多 200 项且有原检查点，不去重，原 HTTP 保留扩展。领取 Result 是当前交接及 changed/delta0或1 的历史回执，当前版本不落后，同版本须 claimed、后续 expired 保留原归属；仅此静态结构不能验证跨对象数值或身份等式。旧 LegacyResult 没有回执，可能没有历史账号且版本无安全加一保护。

领取原 HTTP 的来源数组未完整逐项检查，Schema 保留该边界，不套用详情 GET 的完整解析；单独 ClientResult/ClientEnvelope 要求完整规范来源、发送者/目标/trace、原身份与版本关系。两个客户端封套支持匹配当前版本的可选兼容 ETag，内置服务器不发送。Query 结果空来源、无 ETag，创建查询还检查完整当前记录，领取查询只核对选定归属/版本/父关系；均不检查包或证明当前可续接。UTF-16/代理项、来源成员、原字段是否存在、数字运算及真实权限仍由现有代码负责。P0-01/R-001 未完成、evidence 为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO **P0-01**：新增 [checkpoint-write.json](checkpoint-write.json)，HTTP 见 [checkpoint-commands OpenAPI](../openapi/checkpoint-commands.json)。覆盖检查点保存及原请求回执，包子路径对应文件名；本地注册 checkpoint-read/session-activity-read/session-start，复用原记录/记忆、身份/来源/版本和严格原键。

CheckpointSaveBody 保留未知字段、头优先的原键/版本与路径覆盖规则，旧内联包和原记忆引用按服务端较宽规则建模；CheckpointSaveClientCommand 关闭未知新字段、要求正安全原会话版本，引用文本非空白且限 4096 UTF-16，结构深度等仍由共享代码检查。CheckpointOriginalCommand 保留旧未知字段和未经重新验证的原引用；CheckpointReceiptQuery 为严格两字段，ReceiptBody 另允许被路径覆盖/移除的原外层 session_id，Binding 是固定原身份和深拷贝查询的本地对象。

CheckpointSaveWireRecord/Envelope 定义全部原笔记/引用/来源及独立修订；服务端重放映射没有完整记录解析，MAX+1 没有安全溢出保护，不把客户端更严格规则当成服务端保证。state_hash 仅为历史文本，现有新写使用 `sha256:` 加 8 位十六进制旧 32 位算法，不要求或宣称完整 SHA-256；记录无 created_at/会话版本/包状态。CheckpointSaveClientEnvelope 单独描述规范结果及可选兼容 ETag，重用原完整 CheckpointSavedRecord；动态原笔记/引用一致、来源首项去重/顺序与保存包前缀、原范围/trace 和版本关系由共享解析负责，未重算状态哈希。

CheckpointRecorded/ReceiptLookup/ReceiptEnvelope 只含原修订/ID/可选包和 not-checked，或 not-observed；不返回原内容或证明包当前有效。查询只读取并检查元数据，不能沿用 GET 详情的完整内容核验或 2/8 MiB 限制。原弱键兼容、通用 POST/SDK 预算及错误差别见 OpenAPI 说明。P0-01/R-001 未完成、evidence 为空；仅人工审阅与指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO **P0-01**：新增 [session-command-write.json](session-command-write.json)、[session-command-receipt.json](session-command-receipt.json)，HTTP 见 [session-commands OpenAPI](../openapi/session-commands.json)。覆盖运行创建/收尾、工具记录/收尾、会话结束及五种原命令查询；包子路径对应文件名，本地同时注册 session-start/session-activity-read 公共资源。

写入 Schema 分别定义五类原 HTTP Body、严格 ClientCommand 和完整历史成功 Envelope。旧 HTTP 保留未知字段参与指纹，路径覆盖同名正文目标、有效版本头覆盖正文版本；model 非空字符串才用于执行，其余原值仍参与指纹。新客户端只接声明字段，创建须给父版本加一留空间且名称有界；收尾可在最大安全版本处无变化成功。普通成功中 run/tool 的 session_version 是原操作后的历史父版本，自身 version 是明细版本；changed 只在内部回执和收尾查询摘要中出现。

历史写入返回开放记录/来源扩展，逐类约束实际持久读取器：创建和工具收尾为单一父来源，运行收尾只校验来源条目，不强加客户端的 200 项/会话成员条件。结束会话的创建者与操作者可以不同；存储日期只检查 Date.parse 有限，不冒称已核对客户端的 128 长度、先后关系或 parent!=self。SDK 创建要求精确两字段来源；收尾规范为四字段、限制数量并核对来源和历史版本关系，结束另核对创建者/时间。内置 HTTP 没有 ETag，客户端可选匹配 ETag 属兼容行为。

回执 Schema 区分原 HTTP Body、去除外层路径字段后的严格 Query、本地 Binding 及五种 recorded/统一 not-observed。原 command 保持开放，补入原有效版本和原路径明细 ID，不按新客户端规则清洗；原可选键/会话须一致。动态原身份/指纹、同一 delta 的算术、来源关系和真实日期由现有代码核对。查询封套空来源、无 ETag，仅历史摘要，不证明当前记录或未提交；没有专用总响应字节/期限保证。P0-01/R-001 未完成、evidence 为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO **P0-01**：新增 [session-start.json](session-start.json)，HTTP 见 [session-start OpenAPI](../openapi/session-start.json)，完整覆盖当前命令身份、普通会话启动及原启动回执。包子路径对应文件名；本地注册 session-activity-read.json，复用身份、ULID、数字版本及开放来源定义。

提供 SessionCommandContextPermissions/Envelope、SessionStartCommand/Body/ReceiptQuery/Binding、SessionStartRecorded/ReceiptLookup/Current、SessionStartEnvelope/ReceiptEnvelope 及独立 SessionStartClientEnvelope。原命令保留 parent/actor/client 是否存在及原值；正文键和头键并存须一致，原键只限 1–255 个非空白 UTF-16 单位，不收窄为 ASCII。原回执固定 session_version=1，当前会话允许更高版本与终态；原父会话、账号、客户端、开始时间及当前范围必须一致，无 resume_origin，终态结束时间不早于开始。当前 version=1 只能 running。

当前身份封套限 16 KiB、trace 最多 512 个 UTF-16 单位，身份字段最多 1024；规范四位年份 UTC 毫秒到期时间排除 0000，处理器和专用 SDK 各检查当前有效期。write 提示蕴含 claim、不蕴含 read，至少一个提示为真。没有项目或业务记录存在性保证。普通启动/回执使用通用 HTTP 外层 trace；SDK 另按最多 1024 的身份文本校验。服务端启动保留来源扩展，最多 200 项且含 type=session、id=原 client_id；不要求来源唯一。SDK 清除扩展并逐序比较内外来源；可选 ETag 兼容仅在独立客户端形状中描述，内置处理器不返回 ETag。

Schema 不替代动态身份/原字段/时间/来源关系、UTF-16 或字节核验。普通启动与回执没有专用总响应字节/客户端整次期限保证；not-observed 不证明失败或允许换键。P0-01/R-001 未完成、evidence 为空；仅人工审阅与指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO **P0-01**：新增 [checkpoint-read.json](checkpoint-read.json) 与 [handoff-read.json](handoff-read.json)，HTTP 见 [continuity-reads OpenAPI](../openapi/continuity-reads.json)。前者覆盖公开会话检查点历史与指定详情，后者覆盖交接当前详情；包子路径对应文件名。本地同时注册 session-activity-read.json，复用 ULID/安全数字、来源结构和当前身份；不把 workbench 历史封套混作公开 GET。

检查点提供 CheckpointHistoryQuery/ReadQuery、MemoryReference、SavedRecord、HistoryEntry/HistoryEnvelope、ReadEnvelope 锚点。六类完整笔记保留原字符串/顺序/重复；版本为正安全数字，历史固定十条。详情的 state_hash/保存 trace/无 ID 旧包 hash 只限非空白及 4096 个 UTF-16 单位，state_hash 不重算；历史保存 trace/旧 hash 没有该独立长度上限。有 pack ID 才要求配套 sha256 形状，不能推断包有效。详情来源扩展保留、type/id 唯一并包含会话及已绑定包；memory_ref 扩展保留、完整 JSON 深度最多 32，来源 type/id 必须包含在检查点来源中，不比较其 revision/URI。正文整体读取限制不能由 Schema 的数组长度代替。

交接提供 HandoffReadQuery/Detail/Permissions/Envelope。open 必须 version=1 且无领取者，claimed/expired 至少 2；claimed 必有客户端，旧记录允许无 actor，expired 可以保留领取者。实际代码核对目标与领取者相同、时间顺序、原检查点来源及最多 200 个 type/id 唯一来源；来源扩展规范成四字段。当前身份与 claim/write_sessions 提示不代表原请求成功或未来授权。

日期输出均规范成 UTC 毫秒并可含扩展年份；输入解析实际接受最多 128 个 UTF-16 单位且 Date.parse 有限的文本。原目标/范围/trace、动态来源关联、计数/排序/末条游标、真实时间、UTF-16/代理项和字节/JSON 深度由原代码检查。检查点候选封套在日期规范化前检查 2/8 MiB，发送阶段无独立再次核验；交接无专用总字节限额。P0-01/R-001 未完成、evidence 为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO **P0-01**：新增自包含 [session-activity-read.json](session-activity-read.json)，根为当前会话状态、运行目录/详情、工具调用目录/详情五种完整成功联合；HTTP 见 [session-reads OpenAPI](../openapi/session-reads.json)。包子路径对应文件名。

提供 SessionCommandIdentity、SessionReadPermissions、SessionActivitySourceRef、SessionStateQuery、SessionRunReadQuery/ListQuery、SessionToolCallReadQuery/ListQuery、SessionActivitySession、SessionClosureState、SessionRunRecord/Page/Detail、SessionToolCallRecord/Page/Detail 和五个封套锚点。版本为正安全整数，运行序号另限正 int32；会话终止时间只接受四位年份规范 UTC 毫秒，活动摘要不含该字段。model 可为空字符串，工具名/保存 trace 只要求非空；来源扩展保留，无数量限制或来源权限证明。

目录无外层范围/身份/权限提示；状态有外层范围，状态与两类详情有权限提示和可选当前身份。五个身份字段均为有界非空白文本，不要求 ULID。封闭结构描述服务器重建输出，不表示现有解析器拒绝所有输入扩展。排序/唯一 ID、父子归属、筛选回显、满页/末条续页相等、原范围/当前 trace、UTF-16/孤立代理项与真实日期仍由现有代码核对。目录原始位置不绑定身份/筛选/页大小，没有跨页快照。

SDK getSessionState 完整核对状态封套，但未传 expectedIdentity 固定账号客户端；四个活动方法只进行通用封套及完整 data 校验，没有独立核对详情提示、唯一外层 session 来源或原 trace 相等。新 Schema 未接为运行校验器。P0-01/R-001 未完成、evidence 为空；仅源码文档人工审阅/指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO **P0-01**：新增 [plane-inbox.json](plane-inbox.json) 与 [plane-inbox-retry.json](plane-inbox-retry.json)。前者自包含，提供 PlaneInboxIdentity、RecordQuery/SummaryQuery/ListQuery、Record/Page/Summary/Diagnosis 及四个完整读取成功封套；后者引用前者，提供 PlaneInboxRetryBody/Command/Receipt/Lookup 及两个完整成功封套。包子路径对应文件名；本地注册两份完整资源并保留 ID/相对路径，HTTP 见 [Plane 收件箱 OpenAPI](../openapi/plane-inbox.json)。

输出为处理元数据，不包含原事件正文/来源/指纹。事件版本为正安全整数十进制字符串，队列 revision 为正 bigint 字符串，attempts/计数为非负 bigint 字符串；重试 expected_revision 为可加一的正 bigint。规范 UTC 时间支持扩展年份，不擅自添加一般性的接收/更新/应用/检查先后约束。Schema 描述状态与 null、概览零计数与时间、诊断 baseline 数量/位置/候选和回执状态关系；数值上限、UTF-16/孤立代理项、真实日期、原范围/身份/命令绑定、计数/版本算术与时间排序仍由原解析器检查。

列表游标绑定范围、restricted 权限、筛选及页大小，不绑定账号客户端；诊断只公开真实提交最高版本的可见 applied 回执，最多两个基线、每组十个候选，不能替换成较旧的可见水位。详情外层身份和 retry 提示属于完整输出形状，现有 SDK 不独立解析这两个额外字段。

重试原正文的 event_id 由路径覆盖；reason 先检查原长度再 trim，请求键可来自正文 request_key 或头，两者必须相同。回执的 pending 状态/原 checked_at 是历史调度记录；重放时即使当前已 applied 也不改写。lookup 的 recorded 必须带完整原回执，not-observed 必须无 receipt；它仍检查当前目标和不可变事件并加事务锁，不代表原命令失败。所有结构定义不替代完整事件/权限/锁/持久性核对。P0-01/R-001 未完成、evidence 为空；未编译、测试、运行校验器/生成器/API/数据库或发布。

2026-11-05，TODO **P0-01**：新增 [context-index.json](context-index.json)，复用search Schema标量；根为目录/状态/内容写入/删除/恢复五类完整成功联合。提供 ContextIndexIdentity/Status/StatusQuery/ListQuery/ListPage、原始WriteBody/WrittenHit、原始MutationBody/规范Mutation/MutationReceipt和五成功锚点。包子路径 @planemem/contracts/schemas/context-index.json；本地同时注册search.json，HTTP见context-index OpenAPI。

元数据时间限定四位年UTC毫秒，内容写入到期时间允许原解析器支持的扩展年；版本为非负安全整数，管理expected_revision上限少一。状态含删除/过期/plane前缀关系；原始管理正文id被路径覆盖，理由检查后trim。内容写入文本不trim，来源规范化为四字段，可附一条capture来源。状态身份/权限位于封套外层，正文写入与历史元数据回执不能混用；后者恢复仍可expired。运行另核对UTF-16/日历/同范围/原请求/版本算术/游标和来源相等，Schema不替代这些检查。P0-01/R-001未完成、evidence为空；未执行编译/测试/校验器/生成器/接口/数据库或发布。

2026-11-05，TODO **P0-01**：新增独立 [search.json](search.json)，根为 ProjectSearchEnvelope/LegacySearchEnvelope 完整成功联合。提供 ProjectSearchQuery/LegacySearchQuery、ProjectSearchHit/Page、IndexedSearchHit/MemorySearchHit 和 LegacySearchResult 锚点，包子路径 @planemem/contracts/schemas/search.json；无需其他Schema，HTTP见search OpenAPI。

项目命中保留bigint字符串版本和两类状态，页面约束type/模式/失效筛选，外层来源固定数据库表。旧命中区分fts数字revision/必有可空expires_at与memory固定restricted/省略expires_at；完整内外来源按最终命中拼接，重复保留。默认值只作用于省略字段；null不代表默认。UTF-16长度/孤立代理、真实日历、bigint上限、原请求回显/数量/范围/trace/来源和游标绑定仍须现有运行解析；项目已接共享页面解析，旧搜索完整结果由Gateway拼装。未将新Schema接入SDK/Mock或执行校验/生成/编译/测试/接口/数据库；P0-01/R-001未完成、evidence为空。

2026-11-05，TODO **P0-01**：新增独立 observed-read.json，根为项目/工作项状态、工作项上下文及观察目录四类完整成功联合。提供ObservedSnapshot、PlaneRestoreReference、ObservedWorkItemContext、ObservedWorkItemEntry/Page/ListQuery及两个共享本地ID输入锚点。包子路径为 @planemem/contracts/schemas/observed-read.json；只需注册这一份Schema，HTTP路径/权限/错误由observed-reads OpenAPI描述。

快照活动v1/删除v2/恢复引用分支明确，外层始终v1，无ETag/cursor；fields保留原事件任意业务字段，删除只含external_id。状态来源规范化为四字段，记忆来源在HTTP可保留扩展。上下文首条来自快照，随后最多19条memory/restricted命中；legacy context_pack只是临时摘要。目录含范围/checked_at/元数据和可选续页，无has_more或总数，标题/状态按Unicode标量限长。运行实现另核对UTF-16/孤立代理、真实日历、原身份/版本/来源/游标/排序关系；服务器未调用完整上下文解析，新Schema不冒称修复此边界。P0-01/R-001未完成、evidence为空；未编译、测试、运行校验器/生成器、接口或数据库。

2026-11-05，TODO **P0-01**：新增 proposal-write.json 与 proposal-original.json，复用 proposal-read 的标量/派生/来源。前者提供 ProposalCreateBody、ProposalReviewBody、NormalizedProposalDraft、完整通用写回执及创建/确认/拒绝三个成功锚点；后者提供严格原五身份、完整创建/审核查询、已记录历史元数据与两类recorded/not-observed封套。包子路径对应两个文件名，需一起注册三份Schema。

旧写正文与规范原查询分开：创建可省默认值并trim指定字段，原查询必须已规范化；原键/actor/client采用更严格可见ASCII。文本检查UTF-16长度、非空白、NUL/孤立代理，其他控制字符不统一禁止；content/来源不trim。本地来源必须正pin，数组顺序保留。HTTP正文路径ID可被路由覆盖，头/正文键和版本跨字段相等由运行实现处理。写成功日期可用扩展年份，原回执只接受四位年份UTC毫秒。完整有限JSON、实际字节、日历、指纹、来源/版本/ETag和原查询相等不是Schema独立证明；新Schema不代替现有运行校验。P0-01/R-001未完成、evidence为空，未运行校验器、生成器、编译、类型检查、测试、接口或数据库。

2026-11-05，TODO **P0-01**：新增独立 proposal-read.json，根为建议目录、详情、提交身份三种完整成功联合；提供 ProposalListQuery、ProposalDetailQuery、ProposalSubmissionContextQuery、ProposalSummary、ProposalDocument、ProposalOrigin、ProposalPage 及三个封套锚点。只需注册这一份Schema；HTTP路径/参数/错误由相邻 openapi/proposal-reads.json 描述。包子路径为 @planemem/contracts/schemas/proposal-read.json。

目录明确三项权限提示和可选 next_before，不补 has_more/count；详情含原保存建议、当前来源观察及版本/ETag，来源按固定建议引用加原来源排列。保存来源/provenance/行扩展保持开放，内部 source_manifest 不输出；读取不额外施加创建文本上限，不把SQL保存约束当作完整运行解析。日期按 toISOString 表达四位或扩展年份；数字版本必须正安全整数。跨字段版本/来源/范围/顺序、真实日历及字节预算并非Schema独立保证。身份只含五字段和 identity_preconditions，无到期/写权限。P0-01/R-001未完成、evidence为空；未运行校验器、生成器、编译、类型检查、测试、接口或数据库。

2026-11-05，TODO **P0-01**：新增 `conflict-read.json`、`conflict-original.json`、`conflict-resolution.json`，与 sync-consumer 共四份Schema提供冲突五路完整机器结构。read根为目录/详情封套联合，original根为身份/原决定回执联合，resolution根为旧HTTP解决成功；另有更严格的专用客户端已检查响应及独立unconfirmed本地结果，避免混用传输与适配器返回。

读取版本保留十进制字符串，最大9223372036854775807由原解析器比较，Schema长度/模式不独立表达该上限；提交expected_version为正且可安全加一的数字。详情JSONB文本只检查语法后原样返回，不把SQL NULL混同字符串null；open/recorded/legacy分支保留真实缺失。详情来源封闭，旧写入事件来源只要求type/id且允许扩展，客户端已检查响应才增加revision/uri/额外字段限制。目录筛选/规范base64url游标、权限提示、排序与跨请求绑定按实际解析器记录。

原命令保留额外字段及merge值存在性，完整原identity/key与有效路径/版本相等仍需运行核对；只有merge允许且必须携带merged_value。原回执recorded绑定原版本+1、actor/client/选择/事件，not-observed不含receipt或来源。当前身份到期使用四位UTC毫秒；详情/历史回执时间沿原Date.parse有限值规则，不额外强加ISO格式；提交事件日期可含扩展年份。有限JSON、字节/复杂度、Unicode/UTF-16及跨字段相等不能由这些Schema独立证明。P0-01/R-001未完成、evidence为空；未运行校验器、生成器、编译、类型检查、测试、接口或数据库。

2026-11-05，TODO **P0-01**：新增 `sync-upload.json` 和 `sync-original.json`。前者根是旧 HTTP 批次完整成功，分别提供 `SyncUploadHttpBody`、保留原字段的 `SyncUploadEvent`、有效客户端 `SyncUploadClientBatch`、字段建议 `FieldChangePayload`、逐项决定以及更严格的 `SyncUploadCheckedEnvelope`；后者根为发送身份/原投递完整成功互斥联合，提供空身份查询、精确 identity/event 查询、recorded/not-observed 及历史投递锚点。需本地注册这两份与 sync-consumer/sync-changes 共四份 Schema；OpenAPI 另引用相邻 context-history 的通用 HTTP 组件。

原始批次条目保持开放，容纳旧服务端逐条校验失败；SDK 快照只接受有效事件且 ID 唯一，不把两者混成同一个输入保证。事件 source_refs/sensitivity 接受 null 或省略，按既有运行逻辑规范化；普通 payload 和历史来源扩展开放，FieldChangeProposed 另有字段白名单与正安全 base_version。完整结果按接受、版本冲突、游标间隙及普通拒绝分支封闭；旧非法事件拒绝可以有空 ID，严格客户端成功不能。请求对应、来源/身份相等、ID/位置唯一、字节/复杂度/Unicode/UTF-16 和规范指纹由运行解析器核对，Schema 不独立证明。

原回执查询保留原事件可选字段与扩展的回显，但服务器只核对规范化事件指纹；not-observed 不含 receipt/来源，recorded 必须有一个 sync-event 来源，只有 accepted=false 含 conflict_id。日期沿四位年份 UTC 毫秒规范，source_application 固定 not-checked；没有外层游标、ETag 或当前冲突状态。完整事件回显不是原字节持久化证明。P0-01/R-001 未完成、evidence 为空；仅源码文档人工审阅/指定格式/Git 文本检查，未执行生成器、校验器、编译、测试、接口或数据库。

2026-11-05，TODO **P0-01**：新增 `sync-consumer.json` 和 `sync-changes.json`。前者根为当前游标/确认完整成功互斥联合，提供 `SyncCommandIdentity`、本地 `SyncCursorQuery`、空 HTTP `SyncCursorHttpQuery`、`SyncAcknowledgement` 及两种完整成功锚点；后者根为 `SyncChangesEnvelope`，提供解码数字查询、本地可选原身份请求和 `SyncChange`。两份 Schema 需按完整 ID 注册；变化 Schema 仅依赖 consumer Schema。三个 HTTP 操作由相邻 openapi/sync-consumer.json 描述。

变化 cursor 不设默认值：省略时读取当前确认位置，显式 0 有不同含义。外层/分页对象封闭，事件、payload 和 SourceRef 保留历史扩展；SourceRef 仅要求非空 type/id、可选安全 revision/非空 uri，不增加 trim 或 URI 有效性要求。跨字段范围相等、游标严格递增、事件 ID 唯一、完整来源拼接及请求 limit 对应由现有解析器检查，不声称 Schema 可独立证明。记录不存在与已确认到零分别为 false/0/无来源和 true/0/单来源；确认结果绑定完整原身份/目标，不是原请求历史回执。

Schema 字符长度与运行时 UTF-16 长度、普通有限 JSON、Unicode 标量、深度/节点/字节预算仍有区别。日期需四位年份 UTC 毫秒及真实日历回环。当前会话权限、数据库提交、客户端持久化和跨字段源 ID 相等均需运行逻辑；机器结构不替代这些判断。P0-01/R-001 未完成、evidence 为空，仅源码文档人工审阅/指定格式/Git 文本检查，未运行校验器、生成器、编译、测试、接口或数据库。

2026-11-05，TODO **P0-01**：新增 `context-item-write.json`，根为创建/编辑/归档/恢复/确认五类完整成功封套互斥联合；每类提供 `Context*Body` 与 `Context*Envelope` 锚点，另有完整 `ContextItemMutationReceipt`。请求定义原HTTP正文，不冒充规范化后的存储对象；头/正文至少一处原键、非创建至少一处版本及多处一致须运行时检查。默认值仅注解，trim、confidence舍入、日期规范和跨请求指纹仍由原实现完成。

编辑必须提供实际字段而非仅控制值，创建禁止自定ID/状态，恢复/归档只接受控制值，确认需要原理由。原写来源使用1–32条及各自文字限额，保留未固定/零revision的结构兼容；人工确认才检查本地固定正版本。仅非创建正文的可选 item_id 被旧路由无条件覆盖，因此刻意用任意JSON描述这个忽略字段；它不是来源或正文的泛化空模型。原键校验沿既有非空/无空白/255 UTF-16限制，不冒称额外控制字符防护。

成功封套要求单个条目来源、revision、ETag、server_cursor和完整六字段命令回执，create固定ULID/版本1，其余版本至少2；事件/时间/版本/游标在重放中保持。复用 context-history 标量与 context-item-read 的ETag，两者也须本地加载。原身份/请求/版本/来源/ETag相等、真实提交/回放与当前权限不由Schema证明；没有增加SDK或Gateway完整回执校验。详见[上下文条目写入 OpenAPI](../openapi/README.md#上下文条目写入)。

2026-11-05，TODO **P0-01**：新增 `context-item-read.json`（包子路径同名），根为当前/归档完整详情的互斥联合，公开 `ContextItemReadQuery`、当前/归档查询、两个文档和两个封套锚点。复用 context-history 的单字段快照定义、标量和完整确认结构；内部开放字段组合，公开结构以 `unevaluatedProperties:false` 关闭，未改变已有历史 Schema。需本地加载两份完整 Schema 并支持 2020-12 组合语义。

新增完整来源检查、直接来源诊断和严格确认准备结构。约束 sources_current 与 state=current 等价、current 诊断必须有正版本且没有 issue、非空确认要求 confirmed/版本至少2、准备提示仅 proposed、允许确认必须有通过的准备提示；归档固定 excluded 且无实时提示。引用位置唯一/完整覆盖、固定版本相等、原来源顺序、scope/trace/ETag、时间/到期和确认版本关联仍由运行代码核对。当前正文保留旧任意 JSON，确认记录可为 null；Schema 不补造审核记录、不计算来源图或授予写入资格。详见[当前与归档详情 OpenAPI](../openapi/README.md#当前与归档上下文详情)。未执行校验器或生成器。

2026-11-05，TODO **P0-01**：新增独立 `context-history.json`，包子路径 `@planemem/contracts/schemas/context-history.json`。根是完整历史目录/单版成功的互斥联合；公开锚点包含 `ContextHistoryQuery`、`ContextRevisionQuery`、`ContextRevisionSummary`、`ContextSnapshotDocument`、`ContextHistoricalConfirmation`、`ContextRevision`、`ContextHistoryPage` 和两个完整封套。摘要与完整版本通过开放的内部 summaryFields 组合，公开锚点用 `unevaluatedProperties:false` 关闭；消费工具须支持 2020-12 的该语义，尚未运行兼容验证。

操作分支区分 baseline 的空归属、create 的版本 1/proposed、update/归档/恢复/确认的状态和最低版本。快照保留任意 JSON content、完整来源、原 trace 与时间，不混入当前读提示或 ETag。confirm 必须有完整确认对象，其他操作允许省略或 null（Gateway 实际输出 null）；归档布尔与时间空值配对。日期允许 Date.toISOString 的扩展年份；ID/文字的 UTF-16 长度、无孤立代理项、有效日历、版本/范围/来源/确认跨字段相等及摘要计算仍由原运行解析负责。Schema 不代替授权、完整性重算或运行证据，也不把客户端字节预算提升为 HTTP 服务端保证。详见[上下文版本历史 OpenAPI](../openapi/README.md#上下文版本历史)。

2026-11-05，TODO **P0-01**：新增 `artifact-download.json`，包子路径 `@planemem/contracts/schemas/artifact-download.json`。根/`ArtifactDownloadQuery` 是已解码的 artifact_id/version/sha256/size 四字段请求，size 为0–1GiB；`ArtifactDownloadMetadata` 复用 comparison 公开元数据并约束下载协议大小。二者均不表示 HTTP 成功正文，内部 Uint8Array 封套也未伪造为 JSON Schema。响应为原始 octet-stream，详见[指定版本文件下载 OpenAPI](../openapi/README.md#指定版本文件下载)。

本地加载本资源和 artifact-comparison 完整资源并注册 `$id`；versionText/sizeText/encodedScope/attachmentDisposition 供 HTTP 参数与响应头复用。文本模式只限制词法形状，数字上限、精确原范围/版本/摘要/长度及 encodeURIComponent 相等、日历、实际字节摘要、导出权限和持久审计继续由运行代码核对；Schema 不证明正文交付或文件保存。未修改运行处理器/原 Schema，未执行校验器、生成器、编译、测试或下载。

2026-11-05，TODO **P0-01**：新增 `artifact-upload.json`，包子路径 `@planemem/contracts/schemas/artifact-upload.json`。根为完整 `ArtifactUploadEnvelope`，数据封闭且严格配对 false/verified-at-save 与 true/not-checked，status 只为 recorded；单个版本来源、无外层 revision/etag。`ArtifactCreateOriginal`/`ArtifactPutOriginal` 在原 ReceiptQuery 上约束命令操作，`ArtifactCreateUploadEnvelope`/`ArtifactPutUploadEnvelope` 区分各路完整成功。新资源本地依赖 artifact-original 与 artifact-comparison 两份完整资源，需一起注册 `$id`。

Schema 不描述 multipart 字节本身，不给原始文件套字符串/base64 或字符长度限制；部件编码、文件 disposition、120 秒正文读取与两笔上传容量见[文件创建与追加上传 OpenAPI](../openapi/README.md#文件创建与追加上传)。原身份/命令/版本加一/hash/size/来源/双 trace 绑定仍由共享解析器完成；首次保存不证明未来仍可下载，历史重放不重新读取对象。客户端完整成功 4 MiB 不冒称 Gateway 统一限额。未修改原 Schema 或运行代码，未执行校验器/生成器、编译或测试。

2026-11-05，TODO **P0-01**：新增 `artifact-original.json`（包子路径 `@planemem/contracts/schemas/artifact-original.json`），根为原上传回执完整成功。锚点包含 `ArtifactCommandIdentity`、创建/追加/联合命令、`ArtifactReceiptQuery`、两种状态的数据对象和完整 `ArtifactReceiptEnvelope`；上传身份使用 `ArtifactUploadContextEnvelope`，不使用回执根。完整对象拒绝未知字段，recorded 必须有一个带版本来源且 replayed=true/not-checked，not-observed 来源为空且无结果元数据；回执及身份均无外层 revision/ETag。

新资源本地依赖 `artifact-comparison.json` 的公开元数据、来源及标量，两份完整 `$id` 须一起注册。原命令 expected_version 留出加一空间，size 不以当前上传限额截断，键沿原非空/无空白规则；身份和 trace 保持一般文本。expires_at 保留现有 Date.toISOString 规则（含扩展年份），日历/原身份/原文/来源/版本关系和到期检查由运行代码完成，Schema 不授予权限或证明正文/回执真实性。客户端回执 4 MiB、内嵌原请求 1 MiB、身份 16 KiB 与服务端通用 POST 1 MiB 分层说明，未新增运行校验器或更改旧结构。参见[文件上传身份与原请求回执 OpenAPI](../openapi/README.md#文件上传身份与原请求回执)。

2026-11-05，TODO **P0-01**：新增 `artifact-read.json`，包子路径 `@planemem/contracts/schemas/artifact-read.json`。根为当前/历史详情完整成功封套的互斥联合；`ArtifactCurrentReadEnvelope` 要求外层 ETag、current/not-checked，`ArtifactHistoricalReadEnvelope` 复用原 comparison 历史封套且禁止外层 ETag。`ArtifactReadQuery` 联合当前/历史查询锚点，分别要求 artifact_id 与 artifact_id/version；这些是解码后的对象，HTTP 使用路径而非 URL 查询。

本资源依赖 `artifact-comparison.json` 的公开完整元数据/历史封套锚点与标量，须本地加载两份完整资源并注册 `$id`；comparison 根仍只表示本地比较结果，不能用作 HTTP 响应。版本/ETag/来源/原 scope/trace 相等、日历顺序、普通 JSON 和 UTF-16 限制仍由共享解析器负责；客户端 2 MiB 限额不是本 Schema 或 Gateway 详情处理器的统一保证。没有执行校验器/生成器或修改已有 Schema。四路 HTTP 对应关系及目录 Schema 另见[文件元数据读取 OpenAPI](../openapi/README.md#文件元数据读取)。

这些文件是开发源码，尚未经过本轮编译、生成器、Schema校验器、测试或运行验证。`$id`是契约标识，不代表已发布网站；消费者应从工作区或包子路径加载文件，不依赖远端下载。

2026-11-05，TODO P0-01：新增[保存包生成与完整读取 OpenAPI](../openapi/README.md#保存包生成与完整读取)，复用这里的 context-pack-read 完整成功/格式锚点及 context-pack-save 预算/TTL标量。生成 POST 的可选正文幂等键另在 OpenAPI 描述，保留旧 HTTP 与严格 SDK/原请求文件规则差异；现有两份 Schema 未修改，未运行解析器或生成器。

## ContextPack 原请求与历史回执

身份GET及历史回执POST的HTTP请求头、状态和错误差异另见[保存身份与历史回执OpenAPI](../openapi/README.md#保存身份与历史回执)。它本地引用本资源，未改变JSON结构，也不描述保存包提交接口。

`context-pack-save.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/context-pack-save.json`。根`ContextPackSaveReceiptEnvelope`对应历史回执查询的完整成功封套，供Gateway、SDK、CLI无output查询、MCP文本内JSON及Mock同形结果使用。本地文件须选择`#ContextPackSaveReceiptFile`；CLI指定output的stdout还含original/receipt/local等包装，不能把整个stdout当作回执文件。

文件自包含全部定义，不依赖目录或完整包Schema；从工作区或包子路径加载整份资源，以其`$id`注册，再解析锚点。标识`https://planemem.local/schemas/context-pack-save.json`不代表托管服务，无需联网下载。没有生产JSON导入、校验器或生成器依赖，Schema与运行时的一致性尚未自动验证。

| 锚点 | 内容 |
| --- | --- |
| `#ContextPackSaveIdentity` | 原tenant/workspace/project/actor/client五字段身份 |
| `#ContextPackSaveDraft` | 可省略预算/TTL的准备草稿或编译参数，默认值只作注解 |
| `#ContextPackSaveParameters` | 原文件、查询及回显中的显式预算/TTL，两项必填 |
| `#ContextPackSaveContextEnvelope` | 完整可信身份、会话到期和compile/read_restricted提示 |
| `#PackSaveBinding` | 规范Gateway基址、完整身份及restricted桶 |
| `#PackSaveOriginal` | CLI/网页共享完整原请求文件，不含token、trace或reviewed |
| `#ContextPackSaveReceiptQuery` | 完整历史查询及回显，不含Gateway |
| `#ContextPackRecordedSave` | 十字段历史记录，content/source均为not-checked |
| `#ContextPackSaveReceiptSourceRef` | 唯一历史包引用，版本须与记录相等 |
| `#ContextPackSaveReceiptEnvelope` | 根；recorded带记录及一个来源，not-observed不带记录且来源为空 |
| `#ContextPackSaveReceiptDocument` | 本地观察时间、完整原请求及历史封套 |
| `#ContextPackSaveReceiptFile` | 完整document和不带前缀的document_sha256 |

对象字段封闭，预算128–32768、TTL 60–86400、版本/游标为正安全整数；ULID沿既有26字符规则。trace/client最多255码点、拒绝C0/DEL且至少一个非空白字符，原键另外禁止任何空白。运行时按UTF-16单元计长并拒绝孤立代理项，不能由Schema长度替代。时间词法固定UTC毫秒且拒绝0000年；format可能只作注解，历史时间不要求位于未来。

Gateway只限定http(s)前缀和4096字符上界，刻意不添加可能与WHATWG序列化不同的RFC URI断言；必须另用packGateway核对规范形式、凭据/查询/片段限制、尾部斜杠处理及实际目标（含部署路径）。服务器历史封套没有Gateway，不能从该封套单独证明目标地址。身份信息是约束，不是凭据；compile=true仅是所返回权限提示，不证明后续提交一定获准。

以下检查继续由共享解析器、可信服务及文件适配器负责：

- 普通有限JSON、深度/节点预算、UTF-16和有效字符；草稿/查询4 KiB、原文/绑定8 KiB、身份/历史封套16 KiB、观察document 28 KiB、文件32 KiB；历史记录中的六字段目录元数据另限2 KiB。结构长度不等于UTF-8字节大小。
- 当前可信身份、权限桶、实际Gateway与原文完整相等；完整查询回显与原查询一致，trace与请求一致，来源id/revision与记录pack_id/version一致。读取身份的当前期限由入口检查；离线文件不重新认证。
- 时间有效且UTC毫秒精确往返，created_at小于expires_at、用量不超预算、预算等于原参数，保存时长不超过原TTL。历史过期不影响其作为历史记录；not-observed不证明原保存失败，也不授予重发。
- document.original派生的查询与document.receipt.data.original完整一致；observed_at是本地观察时间，不设与服务端时间的先后关系，也不是服务器签名。
- 对解析后的document调用contextPackSaveReceiptDocumentJson取得规范UTF-8内容并实算SHA-256，与外层64位小写document_sha256比较。不是对原文件字节或包含摘要的外层文件求hash。历史pack_hash带sha256:前缀，但不在历史查询中重算正文摘要。

格式通过不证明来源真实、当前内容有效、授权有效或摘要正确。HTTP头/状态、保存成功的完整包封套、CLI输出与恢复包装、MCP外层、浏览器批量历史备份均不在此根内。完整包成功形状沿已有读取Schema并由compile解析器核对原参数；本次未新增这些接口或格式。详见[原请求与历史回执格式定义](../../../docs/design/01-contracts/context-pack-runtime.md#原请求与历史回执格式定义2026-11-05源码增量)。仅源码人工审阅及格式文本检查，未运行Schema校验、生成器、编译、类型检查、测试、产品流程或发布；OpenAPI及自动一致性/真实客户端证据仍待补。

## 保存 ContextPack 元数据目录

HTTP路径、认证/范围头、查询编码、成功头和错误映射另见[目录OpenAPI源码](../openapi/README.md#保存包元数据目录)，它从本地引用此完整Schema；HTTP定义不改变本资源的JSON输入或封套形状。

`context-pack-directory.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/context-pack-directory.json`。文件自包含全部定义，根`ContextPackDirectoryEnvelope`描述GET /v1/context-packs完整成功页、SDK `listContextPacks`与`contextPackPages`每页、CLI `context list-packs`输出和MCP `list_context_packs`文本中的JSON，也适用于Mock返回的同形封套。它不包含HTTP状态/头、MCP外层包装、Mock种子/会话或SDK读取/迭代选项。

从本地文件或包子路径加载完整资源，以其`$id`注册后再解析锚点；无需加载完整读取或对比Schema，也不向planemem.local联网取文件。目录仅保存六个标量，自包含定义避免为了元数据引入完整包内容结构。Schema和运行时的一致性尚未自动验证。

| 锚点 | 用途 |
| --- | --- |
| `#ContextPackDirectoryQuery` | SDK/MCP可选pack_id、limit、cursor输入；可为{} |
| `#ContextPackDirectoryNormalizedQuery` | 响应回显，limit必填 |
| `#ContextPackDirectoryCliQuery` | CLI输入，额外允许成对可选expected_actor_id/expected_client_id |
| `#ContextPackDirectoryCursor` | base64url游标的词法范围，不负责解码和绑定 |
| `#ContextPackDirectoryRecord` | version、pack_id、created_at、expires_at、budget_tokens、used_tokens六字段记录 |
| `#ContextPackDirectoryScope` | 原tenant/workspace/project范围 |
| `#ContextPackDirectorySourceRef` | 唯一目录来源标记，id须为原project_id |
| `#ContextPackDirectoryEnvelope` | 完整metadata-only/not-checked页，可选next_cursor |

所有对象均拒绝未知字段。输入limit为1–100，省略规范为25，`default`仅为注解，不会填写输入；回显必须显式提供limit。空、null或额外字段不是省略；SDK对可选undefined的处理属于JavaScript适配，Schema只描述JSON。CLI身份可同时省略，或同时提供；`--timeout-ms`属于命令选项，signal/timeout_ms/max_pages等也不是目录查询字段。HTTP沿URL查询，不发送GET JSON正文。

记录版本为正安全整数，ULID沿既有26字符规则，不新增首字符限制。预算128–32768、用量0–32768，UTC毫秒时间保留24字符和严格词法；`format: date-time`可能只作注解。trace最多255码点且拒绝C0，CLI客户端约束还拒绝DEL；运行时按UTF-16单元并拒绝孤立代理项，结构长度不能代替这一检查。精确pack_id查询页最多一条且无next_cursor，提供续页必须非空；Schema不能据此推断内容可读或来源有效。

以下仍须原共享解析器和可信服务负责：

- 普通有限JSON、深度/节点预算，以及查询4 KiB、单条2 KiB、完整页256 KiB；SDK/CLI/MCP传输、错误和文本包装限制另沿各自读取器。
- 时间有效且精确UTC毫秒往返、created_at小于expires_at、used_tokens不大于budget_tokens。过期或来源变化的保存包仍允许列出。
- scope、规范query、trace和目录来源标记与原请求一致；标记id等于scope.project_id。真实context.read、父项目/read_restricted和当前可见性由可信处理器检查。
- pack_id唯一、筛选匹配、版本/ASCII（数据库C排序）ID降序、每项都在原游标之后、条数不超过query.limit。`uniqueItems`只拒绝完全相同记录，不能检查相同ID但其他值不同的记录。
- 游标须规范无填充base64url，解码为`[1, 64位小写十六进制绑定, 正安全版本, ULID]`并精确重新编码。next_cursor只能用于完整非空页，位置必须是末项；已有cursor时绑定必须相同。服务另核对当前身份/权限/筛选绑定，Mock使用独立场景绑定，游标不是签名、授权或跨页快照。

元数据没有正文、hash、ETag、revision、分类或包内来源；metadata-only/not-checked明确没有检查完整内容或来源。需要完整内容时再调用原读取入口。示例仅为人工编写的输入，不是运行证据。接入边界见[保存包运行契约](../../../docs/design/01-contracts/context-pack-runtime.md)。本次无生产JSON导入或校验器依赖；未运行Schema校验、生成器、编译、类型检查、测试或发布，目录OpenAPI源码见本节链接，全量接口目录、本地加载和自动一致性证据仍待补。

## 保存 ContextPack 对比

`context-pack-comparison.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/context-pack-comparison.json`。根`ContextPackComparisonResult`描述SDK `compareContextPacks`、CLI `context compare-packs`输出及MCP `compare_context_packs`文本内的JSON；MCP外层content/JSON-RPC包装不在根内。网页内部组合使用单独的`#ContextPackComparisonWebResult`，只有query/from/to/comparison，不带SDK/MCP的标记和身份字段，也不是新增REST接口。

此文件引用相邻的`context-pack-read.json`，复用完整json封套、入选条目、排除记录、范围、来源及基础值约束。消费者应从两个包子路径加载**两份完整本地资源**，分别按各自`$id`注册，再解析锚点。相对引用以`https://planemem.local/schemas/context-pack-comparison.json`为基址；两个`$id`都只是标识，不需要联网解析。不要只拷贝比较文件后假定依赖已经存在，也不要拆出`$defs`丢失基址。已有完整读取文件和旧sections实体未改动。

| 片段 | 对应内容 |
| --- | --- |
| `#ContextPackComparisonQuery` | SDK/MCP两字段查询及结果内原query |
| `#ContextPackComparisonCliQuery` | CLI四字段输入，必需expected_actor_id/expected_client_id |
| `#ContextPackComparisonIdentity` | 结果内完整租户/工作区/项目/账号/客户端约束 |
| `#SavedPackSelectedCandidate` / `#SavedPackExcludedCandidate` / `#SavedPackAbsentCandidate` | 完整入选条目、排除理由及未出现状态 |
| `#SavedPackCandidate` | 上述单侧候选联合结构，位置从1开始 |
| `#SavedPackCandidateComparison` | 候选ID、状态、差异标签及完整两侧 |
| `#ContextPackComparisonField` | 元数据行基础形状，精确key/label/类型由报告限定 |
| `#SavedContextPackComparison` | 纯比较模型，固定十一元数据行、最多2000候选、来源与计数 |
| `#ContextPackComparisonResult` | SDK/CLI/MCP完整本地结果，也是根 |
| `#ContextPackComparisonWebResult` | 网页内部完整组合，独立形状 |

字段封闭；两侧只能使用json包，禁止rendered。候选selected/excluded携带其原列表中的位置（1–1000），absent只含state。added/removed必须恰有一侧absent、标签仅Selection；changed必须两侧存在，跨入选/排除状态也仅标Selection，同状态使用对应字段标签；same两侧同状态且无差异标签。两侧同时absent无效。固定十一元数据行保留原key/label/顺序和类型，版本/游标为正安全整数、预算128–32768、用量0–32768。聚合来源保留完整对象和顺序，禁止重复；不替来源文本增加URL可访问性要求。

身份中的scope/actor均为ULID，client按MCP现有isSyncIdentifier规则最多255字符且无C0控制字符。SDK/CLI另通过parseSyncCommandIdentity拒绝DEL；CLI查询锚点包含这一额外约束。Schema长度按码点计算，运行时按UTF-16单元且拒绝孤立代理项，不能互相替代。示例只有人工编写的查询，不伪造带正确摘要的成功输出，也不是测试证据。

以下核对仍由原解析器、读取器和`compareSavedContextPacks`负责，不能仅凭结构通过声称有效：

- 两个包编号不同、两侧与原query/范围/身份/trace匹配，比较内query/scope与外层及原包完全一致。网页两次读取trace可不同。
- 查询4 KiB、每侧完整封套2 MiB、纯报告8 MiB、完整组合12 MiB，以及普通有限JSON、深度/节点和UTF-16预算；MCP另限制转义文本包装24 MiB+4096。
- 已有读取结构列出的版本/ETag、来源并集、候选唯一性/合计数、token估算、完整原时间和内容SHA-256。标记pack-hashes-checked只是生产者声明，Schema不能验证其真实性。
- 每个候选ID和完整两侧值/位置必须来自原包；联合列表唯一且按基础包入选/排除再追加目标新候选排序，统计数精确对应各状态，不能只看maxItems或计数上界。
- 重新计算十一元数据行原值/changed、候选状态/差异标签顺序、完整来源顺序及changed。对象键顺序忽略，数组顺序和正文空白保留；same/changed分支本身不能证明内容相等或不同。
- 真实认证、当前可读权限、有效期、来源状态和总期限/容量；两次读取不是同一数据库快照，移除候选不表示删除知识，摘要一致不证明外部来源真实。

仅新增可加载源码和包导出，不新增生产JSON导入、校验器依赖或生成器，不执行Schema校验、编译、类型检查、测试或发布。自动一致性、两资源解析及真实客户端兼容仍待运行证据；详见[保存包对比运行约定](../../../docs/design/01-contracts/context-pack-runtime.md)。

## 保存 ContextPack 完整读取

`context-pack-read.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/context-pack-read.json`。它自包含全部定义，根是`ContextPackReadEnvelope`，用于GET /v1/context-pack、SDK getContextPack、CLI context get和MCP保存包工具/资源内部文本中的完整成功封套，也可描述Mock中提供的完整json响应。MCP外层content/contents/JSON-RPC包装、HTTP头/状态、编译命令及Mock配置不属于此根结构。

先注册完整本地资源，再按相对于`https://planemem.local/schemas/context-pack-read.json`的片段选择结构。该标识不表示远端托管，不需要联网下载；不要拆出单个`$defs`后丢失引用上下文。

| 片段 | 对应内容 |
| --- | --- |
| `#ContextPackReadQuery` | SDK/MCP查询，pack_id与format都可省略 |
| `#ContextPackReadNormalizedQuery` | 共享解析器规范查询，format明确出现；成功封套不回显query |
| `#ContextPackReadCliQuery` | CLI四字段JSON，另含可选但必须成对的expected_actor_id/expected_client_id |
| `#ContextPackReadScope` | 保存包的租户/工作区/项目ULID |
| `#ContextPackReadSourceRef` | 完整来源对象，保留可选revision/uri，revision可为0 |
| `#ContextPackReadItem` | 完整入选条目，含原内容、来源、trace及ranked-fit理由 |
| `#ContextPackReadExclusion` | 排除项ID及policy/expired/budget/source理由 |
| `#SavedContextPack` | 完整持久包，含摘要、预算、入选/排除项、来源与到期 |
| `#ContextPackReadRendered` | markdown/mcp共用的具体包URI及完整Markdown文本 |
| `#ContextPackReadReceipt` | data内保存ID/version/created_at/used_tokens/pack及可选rendered |
| `#ContextPackReadEnvelope` | 根完整成功封套，接受json或渲染形式 |
| `#ContextPackReadJsonEnvelope` | 原format为json或省略时，禁止出现rendered |
| `#ContextPackReadRenderedEnvelope` | 原format为markdown/mcp时，必须有完整rendered |

查询pack_id省略表示latest，空串/null无效；format默认值仅为注释，实际归一化仍由共享解析器完成。CLI的--timeout-ms是命令选项，不是JSON字段；身份约束不能混入SDK/MCP查询，也不是凭据。公开GET使用URL查询，不能把这些对象放进GET正文。

每个对象字段封闭，使用当前isUlid的26字符规则、安全整数、预算128–32768、最多1000项的各候选数组和保存摘要形状。pack_version固定1代表内容格式，receipt.version才是保存版本。外层trace沿isSyncIdentifier最多255字符，包和条目保存trace及候选ID沿共享name规则最多4096字符；不得把外层trace限制套到全部保存字段。来源type/id/uri沿既有非空字符串规则，不新增trim、URL格式或长度限制；每条来源允许重复，包聚合来源不得重复。示例仅包含人工编写的查询，不伪造成功包摘要，也不是测试证据。

旧`entities/ContextPack.json`描述带sections的核心实体，不能替代此完整读取结构；本增量保留旧定义。以下规则仍必须由现有`parseContextPackReadQuery`、`parseContextPackReadEnvelope`、`contextPackReadHashJson`及调用方/服务端检查：

- 查询4 KiB、完整成功2 MiB、错误16 KiB；普通有限JSON、深度/节点限制、UTF-16长度、有效字符及数字有限性。Schema字符串长度按码点计数，不能替代JavaScript长度预算。
- 原请求scope/trace/指定pack_id/format匹配；所有入选条目范围一致，revision等于data.version，JSON内ETag精确对应版本，外层来源首项指向该包。latest的实际选择及权限过滤由生产者负责。
- items与exclusions合计最多1000，ID跨两个数组唯一；每条估算max(1,ceil(content.length/4))的总和恰等于used_tokens且不超budget_tokens。空内容仍计一个token。
- 包来源恰为按入选顺序取完整来源对象的首次去重并集，外层来源恰为包引用加该列表。不能只检查数量、类型或uniqueItems。
- UTC毫秒时间必须有效且可精确往返，created_at早于包到期，入选条目若含到期时间则不能更早；`format`可能只作注释。实际过期和来源变化仍由读取入口处理。
- rendered必须符合原格式，URI使用原项目和选中具体保存包，文本完整对应每条入选内容与来源；root本身不知道原查询格式，消费者可先选择格式专用锚点再做动态核对。
- 对完整包递归排序对象键、保留数组顺序，仅排除包顶层trace_id/pack_hash，然后计算真实SHA-256；条目trace仍参与摘要。Schema中的64位十六进制模式不证明摘要正确。
- 实际认证、未过期身份、当前父项目/受限内容权限、来源数据库快照及期限/容量均不由Schema授予。摘要一致也不证明来源真实性或未来可用性。

完整接入和运行边界见[保存包读取](../../../docs/design/01-contracts/context-pack-runtime.md)。本次不增加生产JSON导入、校验器依赖或生成器，不执行Schema校验、编译、类型检查、测试或发布；Schema与共享解析器的自动一致性、OpenAPI及真实客户端运行证据仍待补齐。

## 文件版本比较

`artifact-comparison.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/artifact-comparison.json`。文件自包含全部定义，根为`ArtifactComparisonResult`：SDK `compareArtifactVersions`的返回值、CLI `artifacts compare`的stdout对象，以及MCP `compare_artifact_versions`返回文本中的JSON。MCP外层JSON-RPC/content包装不属于根结构，需先取出文本并解析；旧Artifact实体Schema及目录Schema不能替代此文件。

先注册完整资源，再按相对`$id`的片段选择结构；标识`https://planemem.local/schemas/artifact-comparison.json`不代表远端托管地址，也不需要联网下载。

| 片段 | 对应内容 |
| --- | --- |
| `#ArtifactComparisonQuery` | SDK/MCP三字段输入及结果中的query；保留比较方向 |
| `#ArtifactComparisonCliQuery` | CLI五字段输入，另含expected_actor_id/expected_client_id |
| `#ArtifactComparisonIdentity` | 完整租户/工作区/项目/账号/客户端约束，不是凭据 |
| `#ArtifactComparisonSourceRef` | 完整来源引用，保留可选revision/uri，revision可为0 |
| `#ArtifactComparisonMetadata` | 完整公开保存元数据，含描述性版本ETag |
| `#ArtifactComparisonHistoricalEnvelope` | 一份指定历史读取的完整封套，没有外层ETag |
| `#ArtifactComparisonFieldRow` | 差异字段行的基础形状；精确标签/顺序在完整comparison内限制 |
| `#ArtifactComparisonSourcePosition` | 一个来源位置的两侧值及same/changed/added/removed状态 |
| `#ArtifactMetadataComparison` | 八项固定顺序字段行、完整来源位置、描述符一致性和计数 |
| `#ArtifactComparisonResult` | 本地组合结果，也是根；没有外层data或伪造的服务端聚合封套 |

CLI的账号字段沿SDK上下文要求ULID；共享身份结构允许MCP已验证账号文本。SDK自身的scope/actor构造约束仍需另外满足，Schema不把MCP身份缩窄为SDK输入。三字段查询不能带CLI身份字段，五字段CLI输入也不能当作结果中的query。

字段封闭，限定安全整数、分类、来源最多200条和八行固定key/label顺序；size行是十进制字符串。来源位置为same/changed时必须有两侧，added仅after、removed仅before；省略缺失属性，不用null。来源数组不设置去重约束，原重复项和顺序均保留。URI只作保存文本，不附加可访问或URL格式要求。查询与来源位置examples是人工编写的开发示例，未执行且不是测试证据。

仍须保留以下运行时检查；本Schema没有替代它们的动态跨字段机制：

- 查询4 KiB、每份完整记录/元数据2 MiB，以及普通JSON、深度/节点、UTF-16长度、实际入口字符限制。MCP另外限制组合8 MiB、转义content 16 MiB+4096；不能据此宣称SDK也有同样的聚合上限。
- `parseArtifactComparisonQuery`要求两个版本不同但不要求升序；`parseArtifactCommandIdentity`核验完整身份，真实凭据和权限由各入口检查。
- 用`parseArtifactReadEnvelope`将每份记录与原query选定版本、artifact、scope和原读取trace核对；两份须同文件同范围，外层revision和元数据version一致，来源ID匹配，metadata.etag对应保存版本。保存记录的trace可与本次读取trace不同。
- 有效且可精确往返的UTC毫秒时间、updated_at不早于created_at；`format`可能仅为注释，模式不能证明日期真实有效。
- 重新调用`compareArtifactMetadata`核对完整差异：八行原值和changed，连续从1开始的来源位置、两侧完整引用和状态、统计数量，以及size/hash描述符一致性。仅通过结构校验的外部报告仍可能填错这些内容。
- 不从结构有效推断记录真实性、实际读取权限、对象正文一致或跨请求事务快照；不据此上传、恢复版本或刷新原写请求。

运行读取、超时/取消与权限边界见[版本比较契约](../../../docs/design/01-contracts/artifact-versions-runtime.md)。本次不增加生产JSON导入、运行时Schema校验依赖、生成器或发布包；Schema与实际解析/比较函数的自动一致性及客户端兼容证据仍待补齐。

## 附件历史版本目录

文件`artifact-versions.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/artifact-versions.json`。它自包含全部定义，根描述规范`ArtifactVersionsEnvelope`成功响应。先向支持该草案的校验器注册**完整文件**，再用以下资源片段选择结构；不要取出单个`$defs`对象后丢掉原引用上下文。

| 片段 | 对应内容 |
| --- | --- |
| `#ArtifactVersionsQuery` | SDK/CLI/MCP输入对象；必填artifact_id，limit可省略 |
| `#ArtifactVersionsNormalizedQuery` | 规范响应回显的query；明确包含limit |
| `#ArtifactVersionsNextQuery` | 完整续页输入；明确包含limit、at_version、before_version |
| `#ArtifactVersionSummary` | 一条历史元数据摘要 |
| `#ArtifactVersionsPage` | 范围、查询、上界、摘要页及下一查询 |
| `#ArtifactVersionsEnvelope` | schema_version/trace/source_refs/data完整成功响应，也是根结构 |

上述片段均相对于文件`$id`。例如完整查询标识是`https://planemem.local/schemas/artifact-versions.json#ArtifactVersionsQuery`，只用于本地已注册资源解析。文件里的examples是人工编写的开发示例，不是保存的真实数据、运行结果或测试证据。

结构拒绝未知字段，约束安全整数、页大小、分类、摘要字段和单个artifact来源。before_version依赖at_version；has_more=true要求非空items及完整next_query，false要求next_query=null。limit的default=10只描述默认值，实际归一化由共享解析器完成。输出定义描述服务器/SDK/Mock的规范结果；运行时兼容解析可先补齐省略的默认limit再比较。

HTTP使用路径中的artifact_id和URL中的分页参数，不能把整个JSON对象放进GET正文；URL单值、重复参数、无前导零十进制等规则由HTTP入口检查。参考[完整运行契约](../../../docs/design/01-contracts/artifact-versions-runtime.md)。

## 历史目录必须保留的运行时检查

这份Schema仅描述结构，不能单独确认一次响应属于当前请求。继续使用`parseArtifactVersionsQuery`、`parseArtifactVersionsPage`和`parseArtifactVersionsEnvelope`，并保留服务端实际权限/当前可见性/历史快照检查。

- 输入4 KiB、完整成功响应256 KiB，以及纯JSON对象、深度/节点/属性安全限制。
- 当前可信scope、原trace、artifact_id和完整原query相等；单个来源ID与目标一致。
- before_version不超过at_version，首轮上界不超过当前可见版本，续页上界与snapshot_version一致。
- 版本严格降序且不重复、不超过上界并小于before；页条数不超过limit，has_more时恰为limit且最后版本大于1。
- 完整next_query保持目标、limit、上界和本页最后版本，不能重新构造为最新版本。
- 时间必须是有效且可精确往返的UTC毫秒格式，updated_at不早于created_at。`format`可能仅作为注释，不能代替此检查。
- JSON Schema字符串长度与JavaScript UTF-16计数存在差别，实际字段长度、空白和无效代理字符规则仍由共享解析器决定。
- Schema中的classification不是权限授予；目录也不验证正文、下载可用性、上传回执或历史连续性。

现有`entities/Artifact.json`描述旧核心实体，具有不同字段和ETag语义，不能用于目录摘要或封套。此次新增不修改旧实体契约、不引入JSON导入到生产运行路径、不安装校验依赖、不生成或发布包。Schema与解析器的自动一致性证据仍待补齐。

## 项目文件目录

文件`artifact-registry.json`同样采用JSON Schema 2020-12，自包含全部定义；包子路径为`@planemem/contracts/schemas/artifact-registry.json`。根是规范`ArtifactRegistryEnvelope`，用于GET /v1/artifacts及其SDK/CLI/MCP/Mock对应响应。先注册完整资源，再解析下表中的锚点；无需加载历史目录Schema，文件摘要字段与共享ArtifactVersionSummary保持同一约定。

| 片段 | 对应内容 |
| --- | --- |
| `#ArtifactRegistryQuery` | 输入查询；四字段均可省略，名称允许待trim或空串 |
| `#ArtifactRegistryNormalizedQuery` | 规范回显；必填limit，名称若存在则非空且无外围空白 |
| `#ArtifactRegistryNextQuery` | 完整续页；必填limit和cursor，其余原筛选须保持 |
| `#ArtifactRegistryItem` | 文件ID加当前保存版本摘要 |
| `#ArtifactRegistryPage` | 项目范围、原查询、摘要页和下一查询 |
| `#ArtifactRegistryEnvelope` | schema_version/trace/source_refs/data完整成功响应，也是根结构 |

片段相对于`https://planemem.local/schemas/artifact-registry.json`，该标识不要求远端托管或下载。默认limit=20仅为描述性注释，结构不修改输入；实际查询由parseArtifactRegistryQuery规范化。输入中的空名称可归一化为省略，空分类始终无效。Schema的规范响应定义比可先归一化输入的兼容解析更严格；不要把未规范化输入当作响应回显。

字段均封闭，安全整数、分类、摘要、条数及来源类型有限制；has_more=true要求至少一项和完整next_query，否则next_query必须为null。uniqueItems限制整个对象重复，不能单独检查不同摘要中的同一文件ID。示例是人工编写的空页和已结束单项页，不含真实查询记录或自行伪造的服务端续页游标，也不作为运行证据。

项目目录没有历史目录的artifact_id输入、snapshot_version或at_version；其每项自带artifact_id且source_refs按项逐一对应，可以为空。字段name/hash/trace/time描述当次可见的保存版本，目录并不读取正文。旧entities/Artifact.json和artifact-versions.json不能替代本资源。

必须继续使用`parseArtifactRegistryQuery`、`parseArtifactRegistryPage`、`parseArtifactRegistryEnvelope`与服务端当前权限/快照检查：

- 输入8 KiB、完整响应256 KiB、摘要部分16 KiB，纯JSON和深度/节点/属性限制。
- scope、trace与完整规范query必须匹配原请求；来源数量、顺序和ID与items完全一致。
- cursor必须是规范base64url编码的原元组，精确往返；模式匹配不证明游标可用或已授权。服务端重新绑定原范围/账号/客户端/受限读取能力/筛选/limit。
- ID严格倒序、不重复且低于原游标位置，名称匹配ASCII折叠字面子串、分类精确匹配；条数不超limit，has_more时等于limit。
- next_query完整保留原筛选和limit，位置是本页最后ID，续页绑定摘要保持；不能只保留cursor或把游标当签名。
- JavaScript UTF-16长度、空白/无效代理字符、有效UTC毫秒时间往返及时间先后仍需运行时确认；format可能只是注释。

HTTP URL单值、十进制数值、空正文、请求条件及响应状态/头部另行校验；JSON查询不能作为公开GET正文。详见[项目目录运行契约](../../../docs/design/01-contracts/artifact-registry-runtime.md)。此次仅增加Schema源码、包路径和说明，不引入生产JSON导入或新依赖、不执行生成器/校验器/测试或发布包；自动一致性、OpenAPI和运行证据仍缺。
