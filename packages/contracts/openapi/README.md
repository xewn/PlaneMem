# OpenAPI 源码契约

这里的文档描述已有 HTTP 实现，尚未经过校验器、生成器、编译、类型检查、测试或运行验证。文档版本不表示已发布或部署；当前覆盖保存包 5 路、文件 9 路、上下文条目 9 路、同步 6 路、冲突 5 路、建议 8 路、Plane 观察 4 路、搜索 2 路、旧索引 5 路及 Plane 收件箱 6 路，共 59 路，尚不是完整 WCP 接口目录。

## Plane 收件箱与原重试回执

2026-11-05，TODO **P0-01**：[plane-inbox OpenAPI](plane-inbox.json) 覆盖 GET /v1/plane/events、/summary、/{event_id}、/{event_id}/diagnosis 与 POST /{event_id}/retry、/{event_id}/retry/receipt 六路。完整元数据/查询/概览/诊断/身份提示见 [plane-inbox Schema](../schemas/plane-inbox.json)，原正文/规范命令/历史回执/recorded 与 not-observed 见 [plane-inbox-retry Schema](../schemas/plane-inbox-retry.json)。包子路径对应文件名；同时本地加载 search/context-history 公共 HTTP 组件和两份 Schema，保留完整 ID 与相对路径。

六路均要求可信管理员，调度额外要求人工身份和 plane.retry Policy，其他五路为 admin.read；实际 restricted 读取能力不由 admin 替代。有效分类取原事件、当前父项目和匹配 Plane 索引的最大值；未知等级保守按 restricted，已删除/到期索引仍参与。列表先过滤再按事件 ID 的 C 顺序降序分页，默认 25、最多 100；游标绑定页大小但不绑定账号客户端，无签名或跨页快照。缺失/隐藏父项目列表空 200，其余读取 404。due/delayed 按数据库时间比较，规范到毫秒后允许相等；version_gap 是保存的错误标记。

概览在同一 SQL 快照读取全部可见队列，与列表筛选无关；计数均为 bigint 字符串，明确总数/待处理分解和 null 时间关系。诊断读取真实提交最高两行并只保留最高版本，全部选中水位都有可见匹配 applied 回执才公开基线，不能替换较旧可见水位。七种位置按当前比较顺序判定；两类候选最多各十条、升序、has_more 无续页，且不验证完整事件或保证能应用。详情 retry 提示仅表示人工身份，不是完整调度授权。

重试和回执查询共用原范围/账号/客户端/键的锁及 inbox 更新锁、索引锁和父项目共享锁；查询并非 READ ONLY 事务。先检查可见性、完整不可变事件和指纹，再查原回执。已有回执必须核对原命令/事件、当前 revision/attempts 单调不减和稳定元数据，早于新请求的版本/状态检查，返回原 pending 历史回执。无回执时，查询只返回 not-observed；新调度才要求相同队列 revision 与 pending/rejected，更新 pending、清空错误、时间设为本次语句时间、revision 加一，保留原事件与 attempts，并同事务保存回执和调度审计。没有直接调用 worker，成功不证明事件已应用。

两 POST 的原正文 event_id 被路径覆盖，reason 先检查原长度再 trim；正文 request_key 与头键必须相同。HTTP 身份条件分别可选，SDK 两者均要求；两 POST 拒绝版本头，四 GET 只解析有效版本头但不做条件读取。仅列表接受查询参数。POST 认证前通用 1 MiB JSON、非 fatal UTF-8，坏/超限 400；无媒体/编码/缓存/Range 或 GET 正文专用拒绝。成功 private,no-store、当前 trace、空来源、无 ETag；无专用完整响应字节/两容量/整次期限或读取提交后到期复查。事务的 3 秒锁/15 秒语句超时不等于整次期限；提交后连接失败也可能返回 503，应保留原键查询。

本轮新增六路，OpenAPI 累计五十九路。其余 WCP/MCP、事件 payload、SDK/Mock 机器契约接线及破坏性差异 CI 仍缺；P0-01/R-001 未完成、evidence 为空。仅人工源码文档审阅/指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。
## 旧索引内容与管理

2026-11-05，TODO **P0-01**：[context-index OpenAPI](context-index.json)覆盖目录/状态两个GET和索引写入/删除/恢复三个POST；[context-index Schema](../schemas/context-index.json)完整定义五类成功、目录筛选/状态、当前身份、原始索引正文、规范管理命令及历史回执。包子路径对应文件名；本地加载context-index/search两份Schema及本OpenAPI、search/context-history公共HTTP组件，保留相对路径与完整ID。未运行校验器或生成器。

目录默认所有状态/所有来源、25条、最多100，query仅按ID的PostgreSQL lower/strpos字面包含。状态按删除优先、再比较毫秒到期，managed_by按区分大小写的plane:前缀派生。单个物化数据库时钟用于整页过滤和checked_at，ID按C排序，过滤后取limit+1且只解析选中项。游标规范base64url往返核对，绑定原范围/restricted及trim后查询/状态/来源，不绑定limit/actor/client，也不是签名或跨页快照。共享页面解析核对范围/重复ID/状态/来源/数量/续页，不额外核对SQL排序或文本匹配。

目录隐藏父项目返回空200，状态和管理写入隐藏父项目/当前记录返回404。状态可读过期和删除条目，返回完整元数据及外层index_identity/index_permissions.write；提示只判断可信客户端和写能力或admin，即使Plane记录也可能为true，不替代事件所有权或后续权限。SDK会解析data和范围，但通用封套不检查这两项额外提示。身份字段有独立1024个UTF-16单位/字符约束，异常可在元数据解析外成为INTERNAL_ERROR；分类输出为索引自身值，不提升至父项目等级。

删除/恢复要求原键、0到MAX_SAFE_INTEGER-1的正文expected_revision和原始不超过2000单位的非空理由，再trim。路径覆盖正文id；头/正文键必须相同，版本头必须与正文版本一致。按原身份/操作/键和索引ID加锁，锁当前父项目/记录后读时钟和完整状态，随后才查原键；旧回执先于新CAS/删除状态检查。相同规范命令返回原元数据回执，可在后续恢复/删除/到期后重读，但检查当前和历史分类、范围及历史版本不大于当前版本。新操作加一并同事务存回执，不产生同步事件。恢复保留正文/来源/分类/到期时间，可仍为expired；软删除不清除正文或外部副本。

内容写入单独保存完整命中回执，默认restricted/fts/null到期；原文本不trim，有限score不限定0到1，来源扩展被删除。新建可用revision0，已有非删除记录必须更高版本且不能降分类；新内容允许已过期。规范指纹按解析器固定字段顺序与来源顺序计算。正文回执重放要求当前记录存在且未删/未过期、原正文仍可读未过期，并核对原指纹、范围、版本及至多一条capture来源；不同于元数据回执，后续删除/过期会拒绝正文重放。

仅首次写入在持有本地事务锁时执行capture，配置记忆必须预留一个来源槽位，64条原来源即使provider可选也会在调用前400；原回执重放不重跑此检查或capture。capture除索引分类检查外没有额外restricted能力门禁，仅核对返回范围和非空page_ref，不校验返回摘要/hash/版本。可选失败静默省略来源，没有degraded标志；必需失败保留具体错误。外部成功而数据库失败可能留下孤立副本。内置提供方用当前trace生成create_only路径，冲突时核对正文；不等同原请求键的幂等，重试换trace可能另建页面。本轮也修正搜索/观察OpenAPI的MEMORY_PROVIDER_OFF：未配置时retryable=false，已配置但adapter disabled时为true。

五路沿Bearer/范围/Policy/审计/限流，POST独立要求可信客户端；实际restricted权限不由admin替代。POST认证前读1MiB通用JSON，坏/超限400，非fatal UTF-8；GET不专门拒绝正文/framing，未提供媒体/编码/缓存/Range专用门禁。仅目录接受URL查询；所有路由解析版本头，但读取和内容写入不按版本头条件读取/CAS。无ETag、完整响应总字节预算、两容量或整次期限，也无读取/提交后到期复查。错误后不能推断外部capture未发生。

该轮使OpenAPI累计五十三路；其余WCP/MCP、事件payload、SDK/Mock机器契约接线及破坏性差异CI仍缺。P0-01/R-001未完成、evidence为空；仅人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## 项目与旧索引搜索

2026-11-05，TODO **P0-01**：[search OpenAPI](search.json) 覆盖 POST /v1/search 和 POST /v1/context/search。独立 [search Schema](../schemas/search.json) 完整定义两类请求、项目分页命中、旧索引/记忆命中和两类成功封套；包子路径对应文件名。本地加载该OpenAPI、context-history公共HTTP组件及独立Schema，保留相对路径和完整ID；未运行校验器或生成器。

项目搜索读当前工作项/上下文表，版本是正bigint十进制字符串，摘要是正文开头最多360个数据库字符。fts使用simple词语AND匹配、标题权重A/正文权重B及ts_rank_cd归一化；substring使用PostgreSQL lower/strpos字面包含，不把百分号/下划线当通配符。过滤可见未删除父项目、保存分类/删除状态后取limit+1；默认不包含过期或excluded上下文，可显式开启，仍不读归档。默认20、最多50，排序为分数/时间降序及类型/ID数据库排序规则升序，并未显式指定C。只解析选中行，不单独解析lookahead。游标保留微秒时间、完整编码往返核对并绑定原范围/restricted/规范搜索条件，不绑定页大小或账号客户端；可以改limit，不是签名或跨页快照。

项目完整页面由服务端及SDK共享解析，SDK另比范围；输出分类为记录自身值，不与父项目取最大值。来源仅做结构解析，无来源链可见性/新鲜度检查。外层source_refs是按请求类型排列的数据库表引用，即使空页也保留，不拼接命中来源。隐藏/缺失父项目返回空200，没有404或替代内存结果。

旧索引搜索读活动未过期wcp_context_hits，无分页，budget默认20、最多100，计命中数而非token或字节。旧revision转换为非负安全整数，坏行/超范围为500；score用当前SQL重新计算、rank_source固定fts。随后按实际restricted能力选择记忆召回；配置记忆且有该能力时额外查询父项目，可选记忆也不能掩盖该查询的拒绝或数据库错误。整批最多1000条记忆验证后按page_ref保留首次，先本地后记忆再截到budget，不跨后端去重、不融合排序。即使本地已满仍会召回，memory_used=true也可能无返回记忆命中。

记忆命中固定restricted/ai-memory，省略expires_at，摘要只限字符串/65536个UTF-16单位，可为空，不套本地非空文本规则；来源扩展保留。最终内外来源等于返回命中来源的顺序拼接，保留重复。可选记忆未配置不导致degraded，use_vector=true或可选记忆无权/失败才会降级；必需记忆按实际400/403/500/503错误返回。没有跨本地读取/父项目重查/记忆召回的一致快照，服务器也没有调用完整旧搜索结果解析器。

两POST认证前通用读取1MiB，非法/超限正文400，UTF-8解码非fatal；要求JSON对象但没有专用媒体类型/编码限制，URL查询被忽略。Bearer/范围/context.read Policy/入口审计/通用限流仍生效，没有独立可信客户端门禁；可选身份条件分别核对。两个搜索不进入readPreconditions，版本头不解析或条件读取，误带请求键也不复用旧成功。成功private,no-store和x-trace-id，无ETag；没有专用完整响应字节限额、两容量或整次期限，也不在读取后复查会话到期。新契约不冒称修复这些运行边界。

仅机器契约与文档，该轮使OpenAPI累计四十八路。其余WCP/MCP、事件payload、机器契约SDK/Mock接线及破坏性差异CI仍缺，P0-01/R-001未完成、evidence为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## Plane观察读取

2026-11-05，TODO **P0-01**：[observed-reads.json](observed-reads.json) 覆盖项目状态、工作项状态、工作项上下文和观察目录四个GET；独立 [observed-read Schema](../schemas/observed-read.json) 提供四类完整成功与查询/快照/恢复引用/目录锚点。包子路径对应文件名；本地加载该OpenAPI、proposal-reads/context-history公共HTTP组件和这一份独立Schema，保留相对路径及完整ID。未执行生成或兼容校验。

这些接口读取持久Plane观察，不联网刷新Plane、不改本地工作项或确认消费游标。单条状态在一条SQL中联结快照、源事件、同版本索引及当前可见父项目；关联不一致/不可见为404，两个外部ID/聚合ID别名同时命中或选中快照损坏为500。项目路径必须等于授权项目；工作项可按external_id或aggregate_id查找。内层活动v1、删除v2，外层始终v1；删除仅保留external_id与等于observed_at的deleted_at，无旧标题/status。恢复仍为v1，顶层restored_from只在源事件为WorkItemRestored时生成，并核对紧邻删除版本及fields中的相同引用。

目录先过滤可见父项目及一致关联行，按external_id的C/Unicode标量顺序升序取limit+1，仅前limit条规范化/解析；未独立解析lookahead元数据。默认25、最多100，缺父项目404、可见空目录200。query按原500个UTF-16单位和字符约束检查再trim，匹配ID和活动显示标题的字面子串，仅忽略ASCII大小写。游标v2绑定范围、actor/client、restricted能力、保留大小写的trim后query、state和limit；只改变查询大小写也会失效，不是签名或跨页快照。目录title/status按2000/255个Unicode标量截断，删除项为null；输出分类为父项目/索引较高等级，单条状态则输出索引分类，不能混为同一规则。

上下文先读活动状态，删除时在记忆调用前返回410。context_pack是临时搜索摘要，首条fts命中直接由观察状态构造，再追加最多19条去重记忆命中；配置的记忆返回最多1000条需整批验证范围/ID/摘要/来源后才取子集。全部记忆按restricted处理，admin也不能替代实际restricted读取能力。可选记忆未配置/无权/失败/坏结果返回degraded本地摘要，必需记忆则返回错误；成功空召回仍可memory_used=true。来源按type/id保留首次完整引用，HTTP记忆来源扩展保留，SDK会规范化成公开四字段。没有跨状态SQL与记忆召回的一致快照，也不保存ContextPack。

状态/目录调用已有共享解析；完整上下文由服务器拼装，SDK另做完整解析和外层trace/来源核对。保存标题前1000个UTF-16单位若全为空白，旧服务端仍可能输出而被SDK拒绝。四路GET未专门拒绝正文/framing/编码/范围/缓存条件，且不在通用readPreconditions分支内，版本头不会解析或条件读取。Bearer/范围/Policy/审计/通用限流仍生效，但不独立要求verified-client；读取后不复查到期/可见性。没有专用完整响应字节限额、两容量或总期限，提供方局部超时不等同HTTP总预算。记忆失败400/500/503及retryable按当前映射分别记录，不统一解释为可重试503。

仅机器契约与文档，该轮使OpenAPI累计四十六路。未改运行实现、SDK/Mock、旧Schema、依赖或数据库；其余WCP/MCP、事件payload、机器契约接线及破坏性差异CI仍缺，P0-01/R-001未完成、evidence为空。仅人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## 建议写入与原回执

2026-11-05，TODO **P0-01**：[proposal-operations.json](proposal-operations.json) 覆盖创建、确认、拒绝、原创建回执、原审核回执五个已有POST。新增 [proposal-write](../schemas/proposal-write.json) 和 [proposal-original](../schemas/proposal-original.json)，复用 proposal-read 标量。包子路径与文件名相同；本地加载三个Schema及本文件、proposal-reads/context-history OpenAPI，保留相对路径和完整ID。Schema根分别为三个写入成功及两类原查询完整成功的联合；请求使用独立锚点，不把查询回执当作写入响应。

创建正文允许省略classification/TTL，按internal/七天补齐，title/model/prompt裁掉首尾空白，content和来源字段保留；审核reason裁掉首尾空白。原创建查询却要求完整已规范化草稿，原审核要求完整已规范化六字段，不替换键或重构正文。旧写键只要求非空、255个UTF-16单位内且无空白，原查询身份/键则要求可见ASCII；因此不是所有旧入口可接受的原请求都符合查询格式。来源1–32条、闭合字段，本地context-item必须有正版本；外部引用不联网核验。

三个写入以原actor/client/key摘要及项目范围查命令，指纹按操作/路径ID/有效版本/规范理由/规范创建草稿组成，保留undefined数组位置为null。头/正文键及多处版本必须一致；路径覆盖正文proposal_id，创建只解析通用版本头而不将其纳入指纹或CAS。事务先拿项目流锁，再查原键；相同原请求返回历史回执，只重核当前可见性及部分保存字段，不重验完整事件、不重跑来源新鲜度/过期/CAS。新建绑定当前来源和可选派生父项，保存分类取声明、派生父项及直接来源的最高级；无派生项的新建没有独立父项目可见性查询，不能冒称等同后续读取门禁。

新审核要求human、可信客户端及实际审核能力或admin，先比版本再要求proposed。确认检查建议过期、本地来源与依赖摘要，并再次检查建议过期；拒绝不要求未过期或新鲜，但仍受来源/派生可见性约束。首次写入同事务保存建议/决定、ApprovalRequested或ApprovalCompleted事件及命令回执。完整成功含replayed、历史事件/时间/游标、数字revision/ETag和固定建议来源，外层trace为本次请求；不返回完整事件，不证明Plane/来源字段已应用。旧HTTP与SDK写方法没有接入完整成功解析。

两类原回执都使用只读一致快照和完整五项原身份。创建先查可见父项目，再查原键，已记录时核对创建者、TTL、完整草稿、分类及原ApprovalRequested；审核先查原目标当前可见性，即使键不存在也不能跳过，然后核对原决定/版本/审核者/理由/时间及ApprovalCompleted。事件SQL核对范围、聚合、客户端、条件actor、时间/分类、两份来源与精确业务payload；不等同加载完整CanonicalEvent并拒绝全部扩展字段。创建事件trace独立保留，审核事件trace须等于当前保存审核trace。成功前在事务内复查会话到期；不保证一直有效到传输结束。not-observed只代表该快照没有原键，不证明失败或允许换键重发；recorded的current_state固定not-checked，不要求当前来源新鲜。

三个旧写POST在认证前读取1MiB，坏/超限正文为400 INVALID_JSON，没有专用媒体/编码/缓存/范围拒绝。两个回执认证后读取，要求JSON/可选UTF-8 charset并拒绝编码、写/缓存/范围头；审核回执额外拒绝X-Expected-Version。原创建请求/成功1MiB/2MiB，原审核32KiB/64KiB，实际有限JSON还限制深度64/节点100000；通用Buffer解码不是fatal UTF-8。没有专用两容量/总期限。审核成功trace要求可见ASCII1–255；旧HTTP选trace更宽，导致不兼容trace在未观察分支可能503、已记录分支500。已记录核对块内非ContractError事件SQL失败也被包装为500，不笼统承诺所有数据库故障都是503。

仅机器契约及文档，不改运行实现/SDK/Mock/旧Schema/依赖/数据库。建议八路源码目录已覆盖，该轮使OpenAPI累计四十二路；其余WCP/MCP、普通事件payload、SDK/Mock机器契约接线和破坏性差异CI仍缺，P0-01/R-001未完成、evidence为空。未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## 建议读取与提交身份

2026-11-05，TODO **P0-01**：[proposal-reads.json](proposal-reads.json) 覆盖 GET /v1/proposals、GET /v1/proposals/{proposal_id}、GET /v1/proposals/submission-context。提供包子路径 @planemem/contracts/openapi/proposal-reads.json，本地加载本文件、相邻 context-history OpenAPI 和 [proposal-read Schema](../schemas/proposal-read.json)，保留相对路径并注册完整 ID。根 Schema 为目录/详情/身份三种完整成功的互斥联合，另有查询、摘要、完整建议及派生来源锚点；未执行生成或兼容校验。

目录按 proposal_id 倒序，默认25、最多100条，过滤后查 limit+1，确有后页才返回末条 ID 为 next_before。before 只是排他 ULID，不绑定身份、筛选或页大小，也不提供跨页快照。derived_from 只选直接派生项。所有筛选字段只允许一次；limit 接受含前导零的纯数字再检查数值1–100，其余空值无特殊含义。父项目/保存分类/本地来源与最多32层派生链参与行可见性；缺失或隐藏父项目时目录返回空200，详情返回404。restricted 仍要求实际能力，admin 不替代它。

详情在只读一致快照中返回完整保存建议、原 trace、审核字段和派生来源，移除内部 source_manifest，保留其他存储扩展及来源扩展。核对本地固定来源版本/状态/过期/内容摘要及依赖摘要；旧来源缺 dependency_hash 时 sources_current=false，外部引用不联网核验，空本地清单则为true。这个布尔值不检查建议自身是否到期，也不是全部祖先新鲜度或原命令/事件完整性证明。过期或已审核建议仍可读取；详情含数字 revision、JSON etag 和同值 HTTP ETag，但没有条件304/412语义。

目录三项权限提示均显式返回，详情仅有 review_allowed；审核提示要求 human、可信客户端及审核能力或admin，创建提示要求可信客户端及写能力或admin，均不代表后续授权。目录/详情沿 context.read Policy/OPA 和入口决定审计。submission-context 是提前返回的专用HTTP入口，只核对认证范围、可信客户端及可选原身份头，返回 identity_preconditions=1 和五字段身份；不经过命令Policy/审计/限流，不读取数据库，不返回到期时间或写权限。其成功缓存头为 no-store，未设置 x-trace-id，须保留正文 trace。

三个GET未专门拒绝正文、framing、编码、Range或缓存条件。目录/详情仍解析通用版本头，但不按其条件读取；身份入口在这些解析前返回。没有专用完整成功字节上限、两容量或总操作期限，也没有读取后的会话到期复查。Gateway只检查选定存储字段，SDK目录/详情仍用通用封套方法；新Schema不冒充已接入的完整运行校验，创建时的文本上限也不重套到旧保存读取。错误含400/401/403、详情404、普通目录/详情429/500/503；身份入口不宣称有存储/审计/限流错误。

仅机器契约源码及文档，不改运行实现、SDK/Mock、旧Schema、依赖或数据库。该轮使OpenAPI累计三十七路；建议写入/原回执等剩余WCP/MCP、SDK/Mock机器契约接线与破坏性差异CI待补，P0-01/R-001未完成、evidence为空。仅人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## 冲突读取与原决定

2026-11-05，TODO **P0-01**：[conflicts.json](conflicts.json) 覆盖冲突列表、详情、解决身份、提交解决、原决定回执五路，包子路径为 `@planemem/contracts/openapi/conflicts.json`。本地加载本文件与相邻 context-history OpenAPI，以及 [conflict-read](../schemas/conflict-read.json)、[conflict-original](../schemas/conflict-original.json)、[conflict-resolution](../schemas/conflict-resolution.json)、sync-consumer 四份 Schema，按完整 ID 注册并保留相对路径；未运行生成或兼容校验。

列表是完整元数据分页：默认25、最多100条，按 PostgreSQL C/Unicode标量顺序，过滤后读取limit+1，仅前limit构造16 KiB以内元数据。游标绑定范围、restricted标志、规范搜索/筛选/页大小，不绑定账号客户端，也不是签名或跨页快照。详情独立读取完整JSONB文本，并用 recorded/not-recorded 区分保存的 JSON null 与 SQL NULL；版本使用保留 bigint 精度的十进制字符串，不能自动变成提交数字。open/none、resolved/recorded、resolved/legacy 分别建模，旧记录缺项不补造。目录/详情皆有父项目及当前来源/保存分类检查；目录 resolve 权限只是提示，不授权未来写入。

提交以当前可见父项目共享锁、冲突行更新锁保护，先检查已解决记录的原键/指纹，再处理新写版本。键摘要绑定actor/client/key，参数指纹包含有效路径ID/版本及额外原字段，移除外层idempotency_key。旧HTTP头键优先于正文且不核对二者相等，所选键仅检查非空；原回执/专用客户端却要求255长度内无空白/控制字符的键。路径会覆盖正文ID，所有版本前置值须一致；merge必须提供merged_value，其他选择禁止它。新写同事务保存决定、事件及原键绑定，重放重新核对当前可见性、历史事件/来源/值，均不应用源字段。

原决定查询带完整identity/request_key/command，单条只读SQL核对当前可见性、键指纹与选定的事件元数据，输出最多16 KiB比较结果再组装完整回执。此查询没有完整CanonicalEvent校验，也未独立比对source_refs、payload三种基准版本或顶层actor，不能等同提交重放的完整核对；没有SQL后到期复查。干净open或另一个原键返回not-observed，缺失/隐藏冲突是404，旧resolved缺键/指纹/事件绑定是409。recorded只确认匹配原决定，source_application固定not-checked；未观察到不证明失败、回滚或可以换键重发。

HTTP解决成功含数字revision/ETag/cursor和完整事件；专用submitConflictDecision在完整核对后丢弃复制值，返回独立unconfirmed/check-original-receipt，不能将此本地结果当作HTTP响应。旧resolveConflict仍是通用封套包装。读取完整2 MiB/身份16 KiB/原查询1,000,000字节是实际共享边界；两个POST仍在认证前读通用1 MiB正文，未严格检查媒体类型/UTF-8或增加整操作期限。新写完整2 MiB响应、客户端16 KiB错误及本地等待预算不冒称旧HTTP保证；重放只对存储事件执行2 MiB检查。具体权限、头名单及400/409/413/500/503差异见OpenAPI。

仅机器契约源码及文档，不改运行实现、旧Schema、SDK/Mock、依赖或数据库。P0-01/R-001未完成、evidence为空；仅人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## 同步上传与原投递

2026-11-05，TODO **P0-01**：[sync-upload.json](sync-upload.json) 描述 POST /v1/events:batch、GET /v1/sync/commands/context、POST /v1/sync/events/receipt，提供 `@planemem/contracts/openapi/sync-upload.json` 包子路径。本地加载本文件和相邻 context-history OpenAPI，以及 [sync-upload](../schemas/sync-upload.json)、[sync-original](../schemas/sync-original.json)、sync-consumer、sync-changes 四份 Schema，保留相对路径并注册完整 ID。未执行生成器或校验器。

上传的原始 HTTP 正文接受 1–100 个条目，旧服务端逐条返回决定；坏 ID 可回显空字符串，重复原 ID 可产生重复投递结果。SDK/Bridge 的独立完整批次模型要求有效事件与唯一 ID，回执还核对每条恰好出现一次、服务器 ID/位置唯一、原请求/来源/游标关联。两种边界分别提供 Schema，不能把客户端限制写成服务端保证。事件及来源额外字段保留于原请求，省略或 null 的 sensitivity/source_refs 分别规范化为 internal/空数组；普通事件没有完整业务 payload 模型，FieldChangeProposed 单独定义允许的实体/字段/base/value，业务拒绝仍由服务器执行。

原批次键以 actor/client/key 摘要加项目范围隔离，指纹包含移除外层 idempotency_key 后的原正文及所选 expected_version；数组顺序、额外字段和默认值写法仍影响批次指纹。头键优先于正文键，旧上传没有两处相等检查；版本头只参与通用解析/指纹，不构成源实体 CAS。逐事件指纹则来自规范化后的事件，丢弃额外外层字段。同事务保存流事件、可选冲突、投递账本及批次回执；旧批次重放早于逐事件检查，旧事件重放早于顺序/来源检查。上传没有独立父项目可见性或提交后到期检查，重放也不具备原事件查询的当前来源/历史权限复查。记录事件不会修改建议的源字段，也不确认下载游标。

发送身份仅返回可信原五项身份、当前到期时间及 upload_events 提示，不查项目/数据库，不追溯旧队列发送者。原事件回执必须带完整 identity/event，在只读一致快照中检查父项目、当前关联来源、历史事件及冲突可见性，并核对规范指纹、原发送者/顺序/版本/来源/内容。仅上传行缺失才返回 not-observed；这不排除并发稍后提交，也不包含所有旧批次拒绝原因。recorded 保留原投递的 accepted/冲突/trace/time，source_application 固定 not-checked，后续冲突解决不改变历史结果。回显的原事件来自本次查询，不证明服务器保存了原始 JSON 字节或丢弃字段。

上传认证前读原始正文 1 MiB；SDK 的有限 JSON/复杂度/唯一 ID 和成功 256 KiB 解析未接入旧上传服务端。身份完整成功 16 KiB、查询正文 1 MiB+16 KiB/内层单事件 1 MiB、回执元数据和完整成功各 2 MiB 为实际共享边界；回执认证后读正文，坏正文返回 INVALID_INPUT，与上传早期 INVALID_JSON 不同。通用解码不是 fatal UTF-8，无三路专用整操作期限/两笔容量保证。确认原身份的头在上传须成对或均省略，身份/回执读取各自独立可选。上传存储不可用 retryable=true，原事件读取的同名错误当前为 false；错误映射和精确禁止头见 OpenAPI。

仅新增机器契约与文档，不改运行实现、旧 Schema、SDK/Mock、依赖或数据库。P0-01/R-001 未完成、evidence 为空；仅人工源码文档审阅、指定格式及 Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## 同步消费与确认

2026-11-05，TODO **P0-01**：[sync-consumer.json](sync-consumer.json) 描述 GET /v1/sync/changes、GET /v1/sync/cursor 和 POST /v1/sync/ack。包子路径为 `@planemem/contracts/openapi/sync-consumer.json`；本地加载本文件和相邻 context-history OpenAPI，以及 [sync-consumer](../schemas/sync-consumer.json)、[sync-changes](../schemas/sync-changes.json) 两份 Schema，保留相对路径并注册完整 ID。没有执行生成或兼容验证。

变化分页省略 cursor 时从原消费者已确认位置读取，显式 0 才从零读取。每页使用自己的只读一致快照，先按事件权限过滤再分页，允许游标跳号；has_more=true 时返回满页及最后事件位置，否则 next_cursor 为该事务流高水位，包括空页。事件及 SourceRef 的历史扩展字段保留，完整页必须满足范围、递增位置、唯一事件 ID 和逐事件来源拼接关系。读页不会确认位置，也不证明完整业务 payload 有效或客户端已保存。变化路由没有独立父项目可见性查询、canReadSyncStream 门禁或读取后到期检查；现有事件过滤不能等同这些检查。

当前游标读取原 tenant/workspace/project/actor/client 的确认记录，先检查可见未删除父项目。recorded=false/cursor=0/无来源表示无记录，recorded=true/cursor=0/单来源表示已明确确认到零；此接口不查流高水位，不返回原请求回执。确认正文精确为 `{expected_identity,cursor}`，完整身份必须匹配可信会话；锁住可见父项目后检查高水位并单调更新，拒绝回退，相同值不刷新 updated_at。完整成功在写前准备，提交后仍复查会话，故最后的拒绝或响应丢失可能发生在已提交之后。保留原身份和目标，当前位点只能说明当前覆盖范围，不能证明某次请求因果或本地页已落盘。

三路均经可信客户端认证与 Policy；配置 OPA 时其决定替代本地 Policy 判断，cursor/ack 仍有独立 sync.read/admin 和到期检查，受限 SQL 过滤需实际 data.restricted.read。变化查询 4 KiB、完整页 4 MiB；本地身份请求/确认正文 16 KiB、完整游标/确认成功 32 KiB，完整结果确实经过共享解析。确认仍先走认证前通用 1 MiB JSON 解析，早期坏正文返回 400；客户端错误 16 KiB、等待/取消预算不构成服务端统一期限或数据库取消保证。精确禁止头、身份头配对差异和错误映射见 OpenAPI；无 ETag、版本条件或自动重试承诺。

本轮仅机器契约源码，不改运行实现、SDK/Mock 或数据库；P0-01/R-001 未完成，evidence 为空。仅人工源码文档审阅、指定格式和 Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

## 上下文条目写入

2026-11-05，TODO **P0-01**：[context-item-writes.json](context-item-writes.json) 覆盖创建、编辑、归档、恢复、人工确认五路已有 POST，包子路径 `@planemem/contracts/openapi/context-item-writes.json`。五个成功分别引用 [context-item-write Schema](../schemas/context-item-write.json) 的操作封套锚点；原正文也使用独立操作锚点。须本地加载本 OpenAPI、相邻 context-history OpenAPI，以及 context-item-write/context-item-read/context-history 三份 Schema，保留相对路径并注册完整 ID；未运行生成器或校验器。

所有 POST 都要 JSON 对象，归档/恢复用头传控制值时仍发送 `{}`。原键可在头或正文提供，双处须完全一致；非创建操作的正安全版本可在正文 expected_version、If-Match、If-Match-Version 提供，所有已提供值须数值一致。旧版本头允许前导零，SDK 输出规范弱标签。正文标题/类型/理由先检查长度再 trim，confidence 四舍五入到三位小数，日期规范为 UTC 毫秒；content 和来源原文/顺序保留。创建补默认值、固定 proposed/版本1；更新至少有一个实际字段，不允许改分类，省略状态时 excluded 保持，否则退回 proposed。归档增加版本并置 excluded，恢复清除归档时间但仍 excluded；人工确认才严格检查来源链、到期和人工权限。

原键桶按项目和可信 actor/client/key 隔离，五种操作共用；指纹绑定操作、路径ID、原版本和规范字段。事务先取项目流锁，再查原回执，之后才执行新写的当前版本/生命周期/来源检查。同键异文返回409；同文重放复查历史分类和当前条目/父项目可见性，允许当前状态已推进或归档，不重新写条目/历史/事件。成功统一200，只有命令元数据、原事件/版本/时间/游标、当前读取trace及原版本ETag，没有正文、当前状态或完整确认理由。重放ETag可能已旧；另起命令前重新读取。结果未知时保留原身份/键/路径/版本/正文；这里没有独立只读回执查询，原POST重试在未执行时仍会写入。

新写的条目、前后历史、同步事件和回执在同一事务中保存；Policy决定观察在事务前，不是提交回执。创建当前只有项目ID外键，没有显式父项目可见性/删除状态查询；其他修改和重放通过 findItem 检查父项目/条目，且流锁不是父项目行锁。普通创建/编辑只校验来源结构，允许过期时间和未固定本地revision，不能当作来源已通过。非创建路径会覆盖可选正文 item_id，即使异文；该字段不提供绑定，新客户端应省略。以上缺口没有在本轮改运行代码。

实际本地 Policy 支持相应能力或管理员规则，配置 OPA 时使用其决定；确认处理器额外强制可信 human 和 context.review/admin。restricted 检查仍使用真实能力。旧POST在认证前通用解析原始正文，1MiB超限返回400 INVALID_JSON；无独立415/严格UTF-8/总期限/两笔容量或完整响应预算保证。现有SDK写入仅通用封套检查，尚未消费新完整回执Schema。只源码文档人工审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布；P0-01/R-001未完成。

## 当前与归档上下文详情

2026-11-05，TODO **P0-01**：[context-item-reads.json](context-item-reads.json) 描述已有 `GET /v1/context-items/{item_id}` 和 `GET /v1/context-items/{item_id}/archived`，包子路径 `@planemem/contracts/openapi/context-item-reads.json`。成功引用独立 [context-item-read Schema](../schemas/context-item-read.json) 的 `ContextItemCurrentEnvelope` 与 `ContextItemArchivedEnvelope`；公共参数/鉴权/错误复用相邻 context-history OpenAPI，字段级快照/标量/确认复用 context-history Schema。本地加载两份 OpenAPI 和两份 Schema、保留相对路径并注册 Schema 完整 ID；不扩展已封闭的历史快照对象。

两种详情均检查未删除且可见的父项目与条目，并返回与保存版本一致的外层 revision、弱 ETag 和来源列表；活动/归档路径不互相替代。当前详情在同一个只读一致事务中读取保存内容、确认记录和本地来源图；归档详情只返回保存内容与归档时间，不附当前来源检查或确认提示。外层 trace 是本次读取，data.trace_id 保留原保存 trace；ETag 只描述版本，不随来源新鲜度、权限或时间变化自动改变。

当前详情完整描述 sources_current/source_check、直接引用位置诊断和可选 confirmation_readiness。普通检查允许 proposed 来源，但 confirmed 节点要求其本地后代保持确认；严格准备检查要求至少一条来源及所有本地后代已确认，外部来源不联网核验。准备提示仅对有 context.review 或管理员角色的可信人工客户端、且条目为 proposed 时产生。confirm_allowed 还检查有效到期时间，仅是当时提示，不是未来写入 Policy/OPA 决定、锁或预留。

来源图最多加载 4096 节点，64 行一批，路径 32 条边、遍历 1000000 步；单节点超过 32 条来源为 invalid，遍历超限为 limit，普通/严格检查共享工作预算。失败检查通常仍是 HTTP 200 的完整详情，不能解释为来源通过；隐藏后代不通过诊断泄露。图限制不等于正文、数据库或响应大小限额。共享/客户端 4 KiB 查询、2 MiB 成功、16 KiB 错误及默认 30 秒等待也不是服务端总期限/两笔容量保证。旧 GET 不运行完整共享解析器、不严格拒绝正文/所有条件头、不在读取后复查会话；这些边界明确保留。

只做源码文档人工审阅、指定格式和 Git 文本检查；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。P0-01/R-001 仍未完成，完整 WCP/MCP、SDK/Mock 接线与破坏性差异 CI 继续待补。
## 上下文版本历史

2026-11-05，TODO **P0-01**：新增 [context-history.json](context-history.json)，覆盖 `GET /v1/context-items/{item_id}/history` 和 `GET /v1/context-items/{item_id}/versions/{version}`。包子路径为 `@planemem/contracts/openapi/context-history.json`；完整成功分别引用 [context-history Schema](../schemas/context-history.json) 的 `ContextHistoryPageEnvelope` 和 `ContextRevisionEnvelope`，只需本地注册这一份独立 Schema 的完整 `$id`。`kind` 是共享查询对象的本地选择字段，不是 HTTP 查询参数。

目录默认 25 条、最多 100 条，按数字版本倒序；只在确有下一页时返回最后一条版本作为 `next_before_version`，否则省略。当前条目和历史行都受项目范围与 restricted 能力过滤，归档条目仍可读取历史。每次请求使用独立只读一致快照；分页不保证跨页快照、完整历史或连续版本，也不校验未读取正文的摘要。指定版本没有记录或不可见时返回 404，不用当前正文替代。

历史详情包含原完整快照、归档时间、原保存 trace 和确认记录；baseline 不补造操作者/客户端/事件，confirm 才有确认对象。外层 trace 是本次读取，来源按原顺序绑定请求版本与原快照。两个成功都没有外层 revision、etag、server_cursor 或 HTTP ETag。SHA-256 仅覆盖按对象键排序、保持数组顺序的 `{item, archived_at}`，不覆盖摘要行的归属字段或 confirmation，也不是签名、外部来源核验或当前写权限。

权限沿实际 Policy 的 context.read/管理员规则，restricted SQL 过滤仍要求真实 `data.restricted.read`；这两个旧 GET 不强制独立可信客户端声明，也无读取后的会话到期复查、父项目行查询或实时来源遍历。Gateway 只做已有存储检查，并未调用完整共享解析器。4 KiB 查询、256 KiB 目录、2 MiB 单版、16 KiB 错误是共享解析/专用客户端边界，不能当作服务端统一限额、两笔容量或总期限。GET 正文及缓存/写条件未专门严格拒绝；通用 If-Match 解析不构成条件读取。错误映射和这些缺口均明确保留。

仅源码文档人工审阅、指定格式和 Git 文本检查；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。完整 WCP/MCP、SDK/Mock 机器契约接线与破坏性差异 CI 仍待补，P0-01/R-001 未完成。

## 指定版本文件下载

2026-11-05，TODO **P0-01** / T0.3 / T4.1 / R-001：新增 `artifact-download.json`（OpenAPI 3.1.0），包子路径 `@planemem/contracts/openapi/artifact-download.json`，覆盖已有 `GET /v1/artifacts/{artifact_id}/versions/{version}/content`。本地加载该 OpenAPI 及 schemas 下的 artifact-download、artifact-comparison 两份完整资源，保留相对目录并注册 `$id`。新 Schema 根为**解码后的四字段请求**，不是成功响应；内部含 Uint8Array 的封套及 SDK 顶层 content 不冒充 HTTP JSON。

请求必须指定明确的 Artifact/正安全版本，并带 `X-Expected-Artifact-SHA256`（裸小写64位十六进制）及 `X-Expected-Artifact-Size`（规范十进制、0–1 GiB）。原路径 version 必须已经是规范数字，不接受 percent 编码的数字别名；Artifact ID 单次解码。无 URL 查询/current 别名；按源码列出正文 framing、Range、缓存和写条件的拒绝名单，不宣称拒绝所有其他头。缺 Content-Length 或字面值 0 才符合无正文条件。

两次可见性/导出检查均覆盖当前记录和选定历史记录，要求可信客户端、有效会话及实际 artifact.read，管理员不替代能力。public 无额外导出能力要求；internal/confidential 需 data.export 或 data.restricted.export；restricted 同时需 data.restricted.read 和 data.restricted.export。本地与配置的 OPA export.artifact 检查均须通过；OPA 不可用按拒绝处理，拒绝审计失败则报审计不可用。读取后还核对快照未变、完整字节长度与 SHA-256，再等待持久放行审计。放行审计之后到发送完成之间没有持续授权/到期复查保证。

200 返回原始 `application/octet-stream`，空文件仍为200/长度0；按 OpenAPI3.1 原始二进制表示省略正文 Schema，不设 JSON/base64/字符长度。响应完整描述精确长度、生成的安全下载文件名、no-store/close/nosniff/CSP/accept-ranges:none、协议版本、请求trace、选定 Artifact/版本/hash 和放行 audit_id/stage。响应三项范围头是 `encodeURIComponent(保存范围)`，请求范围头仍是原值；无 ETag、Content-Range，服务器不设置 Content-Encoding，既有客户端也容许 identity。客户端必须按原目标独立比较头、长度并核验实际摘要。

release 只表示内容通过核验并获准释放，不能证明客户端接收或保存。每次明确下载均产生独立放行记录，不按 trace 幂等；失败或取消后记录仍可能存在。发送阶段 finish 只表示交给传输；开始发送后发生关闭/错误/超时会断开连接，不追加 JSON 或新的408/504，部分字节不能作为成功。

服务器下载容量为两笔，与实际 MCP 内容适配器共用，上传容量独立；从准备一直占用至 HTTP 发送结算。可配置内容限额0–1GiB，默认64MiB或继承存储设置；协议描述超过1GiB为400，合法描述超过较低配置上限为413。60秒仅是发送观察期限，未涵盖认证、元数据/对象、策略或强制审计；SDK180秒及传输自身预算、客户端错误16KiB另行说明。完整正文在内存核验/复制，未提供流式hash、Range或断点续传。

错误描述覆盖400/401/403/404/409/413/429/500/503；区分持久对象hash错误的400与Gateway核对错误的500，描述不符的409、两槽满的503，以及缺reader/强制审计、持久存储和可选观察不同retryable。可选失败/传输观察不能替代强制放行审计；on_audit回调失败也可能在已有持久release之后阻止本次发送。所有接口状态均记录现有实现，没有执行下载或改变行为。

源码依据为 Gateway server/http/artifact-downloads/artifact-download-audit、contracts/artifact-download、auth分类规则、PolicyService及SDK下载器。仅人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/下载/API/数据库或发布；P0-01/R-001 未完成、evidence 为空。

## 文件创建与追加上传

2026-11-05，TODO **P0-01** / T0.3 / T4.1 / R-001：新增 `artifact-upload.json`（OpenAPI 3.1.0），包子路径为 `@planemem/contracts/openapi/artifact-upload.json`。描述已有 `POST /v1/artifacts` 和 `POST /v1/artifacts/{artifact_id}/versions`，不执行上传或修改运行逻辑。

本地加载此 OpenAPI 和 `schemas/artifact-upload.json`、`artifact-original.json`、`artifact-comparison.json` 三份完整 Schema，保留相对目录并注册 `$id`。新 Schema 根为完整上传成功，另有按创建/追加操作区分的原请求与成功锚点；复用原五项身份/命令/公开元数据，不将原回执查询的 replayed=true 限制误套到首次保存。

两路只接受恰好两个带 filename 的文件部件：`request` 为 application/json，严格 UTF-8 解码后的完整 `{ identity, command }`；`content` 为原始文件字节。拒绝普通文本表单字段、多余/重复部件、URL 查询和压缩编码；Content-Encoding 仅允许缺省或 identity。原文件名不参与存储地址或 Artifact 元数据，request JSON 不做重复键专用拒绝。

OpenAPI 用 multipart Encoding 的 contentType 与 Content-Disposition 表达文件部件；request 的 Schema 描述**解码后的 JSON 对象**，工具仍须保留带 filename 的文件发送形式。原始 content 使用无类型/文本编码/字符长度限制的 Schema 与 application/octet-stream 编码提示，不伪装成 base64 JSON；实际 parser 不限制 content 部件的媒体类型，SDK 使用 octet-stream。此次查阅 [OpenAPI 3.1 官方文件/Multipart/Encoding 说明](https://spec.openapis.org/oas/v3.1.0.html#considerations-for-file-uploads)，没有运行生成器或证明任一客户端兼容。

读正文前核对 Bearer 范围、可信客户端、实际 artifact.write、已配置 writer 和写条件；完整原身份/路径/参数与 Policy/决定审计检查发生在 multipart 解析后。两路 Idempotency-Key 都必须等于原 request_key；创建禁止 If-Match，追加必须提供对应原 expected_version 的弱版本标签，均禁止 If-Match-Version。现有 parseEtag 接受前导零后按数字比较，SDK 发送规范形式；不是一般 HTTP ETag 列表/通配符语义。

持久服务先核对本次完整字节/size/hash，即使原键已记录也不跳过输入核验；父项目和原身份/键锁内优先查回执。精确重放返回原历史保存结果，可以早于当前版本；无回执的追加才检查当前版本与原预期一致，沿用原名称/MIME/分类/来源并保存下一版本。首次不可变对象 put/readback 核验后，同一数据库事务保存当前元数据、历史快照、原回执；对象与数据库不构成跨系统事务，数据库失败可能留下未引用对象。

两种成功都为 200、status=recorded：首次 `replayed=false/content_state=verified-at-save`，历史重放 `true/not-checked`。首次保存 trace 等于外层请求 trace，重放保留原元数据 trace。只有一个精确 Artifact/版本来源，无外层 revision、JSON/HTTP ETag 或 Location；内层 ETag 描述保存版本，不能当最新写前提。上传不会返回 not-observed；未知/丢失结果保留原身份/键/命令/版本/内容并显式查原回执，不能自动换键或改版本。

每服务器两笔上传容量覆盖正文读取、原生解析及下游处理，等待结束才释放。配置内容限额 0–1 GiB，未提供时通常为 64 MiB 或继承存储设置；request 最多 1 MiB，整个正文最多内容限额+1 MiB+64 KiB。120 秒仅约束正文读取；解析/授权/审计/持久化不在该总期限内，没有流式或全局内存上限承诺。客户端完整成功 4 MiB/错误 16 KiB、SDK 默认 180 秒与 transport 自身预算不等于 Gateway 统一响应或事务时限。无存储后会话到期复查保证。

错误区分 400 输入/摘要/中断、401/403、404 不存在/不可见、408 正文超时、409 原键异文/版本冲突/旧快照、413 Gateway 超限、429 通用限流、500 坏存储/返回异常、503 缺 writer/两槽占满/存储不可用。持久服务自身较低上传限额当前报 INVALID_INPUT；缺 writer 的 retryable=false、容量占满为 true，外层/命令层 INTERNAL_ERROR 的默认值也不同。上传应用入口在认证前设 connection: close 和 x-trace-id，代理/parser 在此之前的错误不在该保证内。失败不否定此前提交。

源码依据为 Gateway server/http/artifact-upload/artifact-writes、PersistentArtifactService、contracts/artifact-upload 和 SDK 上传器。仅人工源码审阅、指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/上传/API/数据库或发布。P0-01/R-001 未完成、evidence 为空；其余 WCP/MCP、SDK/Mock 机器契约接线与破坏性差异 CI 仍缺。

## 文件上传身份与原请求回执

2026-11-05，TODO **P0-01** / T0.3 / T4.1 / R-001：新增 `artifact-original.json`（OpenAPI 3.1.0），包子路径为 `@planemem/contracts/openapi/artifact-original.json`。只描述已有两路读取，不包含 multipart 上传或二进制下载，也不改变运行处理器。

| 路径 | WCP 操作 | 机器结构 |
| --- | --- | --- |
| `GET /v1/artifacts/upload-context` | `artifact.upload-context` | `artifact-original.json#ArtifactUploadContextEnvelope` 完整成功 |
| `POST /v1/artifacts/receipt` | `artifact.receipt` | `#ArtifactReceiptQuery` 请求、`#ArtifactReceiptEnvelope` 完整成功，均位于 schemas/artifact-original.json |

本地加载 OpenAPI 文件及 `schemas/artifact-original.json`、`schemas/artifact-comparison.json` 两份完整资源，保留相对目录并注册各 `$id`。新 Schema 根为回执完整成功；上传身份必须选对应锚点，不能误用根。comparison 仅提供公开元数据、来源和标量，不使用其本地比较结果根。没有新增运行时 JSON 导入、依赖或生成器。

两路均要求 Bearer 验证、可信非空客户端、实际 `artifact.write` 和 Policy 放行；管理员角色不替代上传能力。上传身份同步处理器在路由授权/审计后再次检查会话到期，返回五项身份、规范到期时间、`max_bytes` 及读取能力提示。它不查询父项目或文件、证明存储就绪、预留请求键/版本或授权未来上传。`max_bytes` 可为 0，最大 1 GiB，持久服务仍有自身限额。旧原请求不能用新读出的身份静默替换。

回执 POST 为只读，完整正文只有 `{ identity, command }`；五项身份逐一等于当前可信会话。创建命令保留原名称/MIME/分类/有序来源，追加命令保留原 Artifact/预期版本，两者均带原键和 hash/size。当前上传限额不应改写历史 size；追加 expected_version 最大为安全整数减一。来源次序、重复、缺省字段均有语义，原键不是 HTTP 查询幂等头。

`recorded` 与 `not-observed` 都返回 200。前者具有原公开元数据、`replayed=true`、`content_state=not-checked` 及精确 Artifact/版本来源；后者只回显 identity/command/status，来源为空。根无 revision/ETag，保存元数据保留原 trace 与内层 ETag。共享运行解析器继续核对原请求、创建版本 1/追加版本加一、原范围/hash/size/来源及两层 trace，不读取正文或重新计算对象摘要。

持久回执读取先核对父项目；已记录结果还核对当前可见性及原历史快照。缺回执的追加目标也必须当前可见，不能把无权访问伪装为不存在。查询不取得写入端的原请求 advisory lock，并发保存可能在本次未观察到之后提交，所以 `not-observed` 和错误都不能判定原写失败、授权换键/换身份或自动重发。

两路拒绝 URL 查询及 Idempotency-Key、If-Match、If-Match-Version；没有目录入口那套完整正文/framing/缓存/Range/编码头检查。GET 正文未读取；POST 沿通用 1 MiB JSON 解析且发生在认证前，未专门强制 Content-Type、严格 UTF-8 或重复 JSON 键。专用客户端另有原请求 1 MiB、完整回执 4 MiB、上传身份/错误 16 KiB 与默认 30 秒预算，不能冒称 Gateway 全部响应/期限/容量保证。回执处理器无数据库读取后会话到期复查。

OpenAPI 保留实际错误映射：`ARTIFACT_UPLOAD_CONTEXT_INVALID` 当前落为 400；原键异文/旧快照为 409，不存在/不可见为 404，坏存储为 500，缺读取器/存储不可用为 503。早期错误头不齐、外层认证/审计失败、retryable 与客户端映射分别记录。身份接口不因未配置 Artifact 存储而自动报 503。

源码依据为 Gateway server/http/router/authenticated-context/artifact-upload-context/artifact-receipts、PersistentArtifactService 和 contracts/SDK 对应解析器。仅人工源码文档审阅/指定格式/Git 文本检查，未执行校验器、生成器、编译、类型检查、测试、接口、数据库或发布。P0-01/R-001 未完成、evidence 为空；其余 WCP/MCP、SDK/Mock 机器契约接线和破坏性差异 CI 待补。

## 文件元数据读取

2026-11-05，TODO **P0-01** / T0.3 / T4.1 / R-001：新增 `artifact-reads.json`（OpenAPI 3.1.0），包子路径为 `@planemem/contracts/openapi/artifact-reads.json`。描述现有四个 GET，不修改运行逻辑。

| 路径 | WCP 操作 | 完整成功 Schema |
| --- | --- | --- |
| `/v1/artifacts` | `artifact.registry.list` | `artifact-registry.json#ArtifactRegistryEnvelope` |
| `/v1/artifacts/{artifact_id}` | `artifact.read` | `artifact-read.json#ArtifactCurrentReadEnvelope` |
| `/v1/artifacts/{artifact_id}/versions` | `artifact.versions.list` | `artifact-versions.json#ArtifactVersionsEnvelope` |
| `/v1/artifacts/{artifact_id}/versions/{version}` | `artifact.version.read` | `artifact-read.json#ArtifactHistoricalReadEnvelope` |

本地加载本 OpenAPI 及 `schemas/` 下 `artifact-read.json`、`artifact-comparison.json`、`artifact-registry.json`、`artifact-versions.json` 四份完整资源，保留相对目录并注册各 `$id`。新详情 Schema 复用 comparison 中的公开元数据和历史封套锚点，**不使用其本地比较结果根**作为 HTTP 响应；没有新增运行时 JSON 导入或校验器依赖。`planemem.local` 标识不表示托管服务。

四路均要求 Bearer 验证、原项目范围、实际 `artifact.read` 和 Policy 放行，管理员角色不替代该能力；受限数据还要求 `data.restricted.read`。范围是现有一般标识符，不能仅因 SDK 的额外限制就将全部 HTTP 范围写成 ULID。可选 expected actor/client 头分别比较可信身份，不要求成对，也不提供身份。文件目录额外要求已验证且未过期的客户端，在读取前后复查；其他三路使用既有认证上下文，未专门要求 client claim，也没有同样的读取后到期复查。

文件目录按名称 ASCII 折叠字面子串和分类筛选，默认/最大 20 条，按 Artifact ID 的 C/ASCII 序倒序；游标绑定范围、账号、客户端、受限能力、规范筛选和页大小。版本目录默认 10、最多 20 条，`at_version` 固定包含上界，`before_version` 为排他位置，需同时提供上界且不得超过它。两者均保留完整 `next_query`；不存在跨页数据库快照承诺，不补造缺失历史。每页当前权限与探测行仍需通过核验。

两目录只接受各自列出的单值查询，数字必须为无前导零的正十进制安全整数；拒绝有正文的 framing、写条件、缓存条件、Range 和 Content-Encoding。两个详情接口拒绝所有 URL 查询，但旧入口没有同样的正文/禁止头检查：GET 正文未读取，通用版本头只做语法解析，不构成 CAS、304 或 206。新文档不会修复这些差异。

当前详情具有外层/内层/HTTP ETag 且与版本相同；历史详情只保留内层保存 ETag，不能用作当前写前提。两目录没有外层 revision/ETag，详情带完整公开元数据而不暴露 storage_key。外层 trace 为本次读取，元数据 trace 保持保存值。所有成功的 `content_state=not-checked` 均表示未读取文件正文，不能推导对象存在、摘要已核验或上传结果。

目录查询对象分别限制 8 KiB/4 KiB，完整成功限制 256 KiB；这些不是原始 URL、数据库扫描或分配限额。详情 2 MiB 和错误 16 KiB 是专用客户端的限制，不能冒称 Gateway 详情处理器的统一保证。四个处理器没有专用 30 秒/两笔容量边界，数据库语句/锁时限也不等于整个请求期限。

错误描述覆盖 400/401/403/404/409/429/500/503 及 retryable：不存在或当前不可见为 404，旧版本缺可信快照为 409，坏存储/非法完整页为 500，未配置读取器/持久存储失败为 503。不返回部分页、伪造历史或替换为当前版本。早期认证/输入错误未保证 x-trace-id、WWW-Authenticate 或 Retry-After，保留错误正文 trace。

源码依据为 Gateway server/http/authenticated-context/artifact-reads/artifact-registry/artifact-versions、Artifact persistent 服务及 contracts 共享解析器。仅人工源码审阅、格式/Git 文本检查；未执行校验器、生成器、编译、类型检查、测试、接口、数据库或发布。P0-01/R-001 未完成、evidence 为空；其余 WCP/MCP、SDK/Mock 机器契约接线和破坏性差异 CI 待补。

## 保存包生成与完整读取

2026-11-05，TODO **P0-01** / T0.3 / T4.1 / R-003：新增 `context-pack-operations.json`（OpenAPI 3.1.0），包子路径为 `@planemem/contracts/openapi/context-pack-operations.json`。描述已有 `POST /v1/context-pack/compile` 与 `GET /v1/context-pack`，不执行接口、不修改路由或现有处理逻辑。

| 接口 | 选择/输入 | 成功内容 |
| --- | --- | --- |
| POST `/v1/context-pack/compile` | 可省略 budget_tokens/ttl_seconds；原幂等键必须在头或正文提供 | 新保存或原请求重放均为 200；完整 JSON 保存封套，无 rendered |
| GET `/v1/context-pack` | 单值可选 pack_id/format；省略 ID 选最新可见版本 | 三种 format 都返回完整 JSON；markdown/mcp 另含 data.rendered |

本地加载 OpenAPI 及相邻 `schemas/context-pack-read.json`、`schemas/context-pack-save.json` 两份完整资源，保留相对目录和各自 `$id`。成功结构引用 read Schema；生成请求的预算/TTL复用 save Schema 标量。正文幂等键采用现有 HTTP handler 的较宽规则，没有把 SDK/原请求文件的更严格文本规则套给旧 HTTP。无须加载目录/比较 Schema，也不要联网请求 planemem.local。

### 原身份、幂等与完整读取

两接口均验证 Bearer、三个项目范围头，并经 `context.read` Policy action；实际许可取决于当前策略及经认证规范化的能力。生成另外要求可信非空 client claim；旧完整 GET 没有这一专用门槛，缺少 client claim 时仍沿 authenticatedContext 的已有 fallback，不能把目录/身份/回执入口的严格要求套到它。两个 expected-identity 头分别可选，仅与已验证身份精确比较。traceparent 非空时优先于 x-trace-id，旧入口不强制两者一致或解析 W3C 格式；两个都缺省才生成 trace。

生成请求默认预算 4096、TTL 3600 秒，范围分别为 128–32768 和 60–86400。正文仅接受 budget_tokens、ttl_seconds、idempotency_key；推荐原键放 Idempotency-Key 头，正文 `{}` 可使用默认参数。键在头或正文至少一处，双处必须同文；原 handler 检查 1–255 UTF-16 单元且无空白，SDK/历史原请求格式还有控制字符/代理项限制。跨头/正文的必填与相等关系由运行时处理，OpenAPI body Schema 无法单独表达。

保存按原 scope/actor/client/key 定位，指纹包含规范参数、restricted 权限桶和已有 expected_version；锁内写入完整包/来源清单、版本/游标及 ContextPackIssued。相同原请求重放仍检查当前项目、原包正文、有效期与来源。参数/可见性变更返回 409；过期 410、来源陈旧 409，不生成替代包。响应不回显原键、请求 TTL 或“新建/重放”标记。发送后失败或超时应保留完整原请求并查询已有 save-receipt，不能推断未保存或自动换键。

读取在只读 repeatable-read 事务内检查父项目和保存 restricted 可见性，按版本/ID降序选择。省略 ID 并不表示“找一个未过期包”：先选最新，再检查它；过期/陈旧就返回错误，不回退旧包。指定不可见/不存在或无可见最新包返回 404。完整检查包含原包摘要、保存元数据、候选和排除项的来源清单、依赖快照及当前来源状态；历史回执查询与元数据目录不做这类完整读取。

`format=json`（含省略）不带 rendered；markdown 和 mcp 都增加 `data.rendered={uri,mimeType,text}`，其中 mimeType 为 text/markdown。HTTP 仍是 application/json，包含完整 pack；format=mcp 不是 JSON-RPC 包装，也没有发起 MCP 调用。根成功 Schema 接受两种结构，格式专用锚点由扩展注解提供，消费方须结合原查询选用并继续核对完整正文/摘要。

成功 ETag 等于正文 etag，并对应 data.version/revision；server_cursor 是原保存事件游标，不是读取时最新高水位。外层 trace 属于当前调用，内层 pack.trace_id 保留创建时的值；两者不必相同，重放也不会重写原包。

### 现有服务端与客户端边界

本文件据实记录这两个旧入口，不能从目录/回执文档复制更强保证：

- POST 在认证前使用通用 JSON reader，实际正文最多 1 MiB，缺失/非对象/非法或超限统一 400 INVALID_JSON；没有专门强制 Content-Type、空查询、严格 UTF-8 或重复 JSON 键策略。调用者应发送 application/json、无 URL 查询的规范对象。
- GET 不解析请求正文，也没有目录入口的正文/条件头拒绝检查。应不带正文或写入、缓存、Range 条件；接受某些条件头语法不表示支持条件读取。通用 If-Match/If-Match-Version 会检查语法和相互一致性，但这两个 handler 不做 CAS，读取不会返回 304/206。生成时额外版本值还影响原请求指纹，应省略。
- 两 handler 没有专用两笔容量或 30 秒等待上限，也没有服务端统一 2 MiB 成功/16 KiB 错误限制。4 KiB 规范查询/参数、2 MiB 完整成功及 16 KiB 错误是共享客户端的检查；客户端期限不证明 SQL 已取消或写入已回滚。
- 授权时检查 token 有效性；这两个 handler 没有数据库工作后的专门到期复查。成功包的来源/有效期判断发生于处理器读取，不能保证其在送达后一直新鲜。
- 早期 JSON/认证/输入拒绝可能不带 x-trace-id；命令错误带该头，所有应用 JSON 响应均 private, no-store。未承诺 WWW-Authenticate、Retry-After 或 Connection: close。

这些差异作为尚待开发的边界记录，文档不会自动修复实现。所有 x-* 都是说明注解，不是运行时限制。结构 Schema 仍不能证明权限、原键归属、摘要、跨字段关系或完整字节预算。

| HTTP状态 | 原HTTP错误码及 retryable |
| --- | --- |
| 400 | INVALID_JSON、INVALID_INPUT、INVALID_REQUEST_CONTEXT；生成候选/来源图超限 CONTEXT_SOURCE_LIMIT 也为400，均false |
| 401 / 403 | UNAUTHENTICATED / DENIED，false |
| 404 | CONTEXT_PACK_NOT_FOUND，false |
| 409 | CONTEXT_PACK_STALE；生成还可能 IDEMPOTENCY_KEY_REUSED，false |
| 410 | CONTEXT_PACK_EXPIRED，false |
| 429 | 通用actor/path RATE_LIMITED，true；无专用容量错误 |
| 500 | CONTEXT_PACK_INVALID为false；意外边界INTERNAL_ERROR通常true |
| 503 | CONTEXT_PACK_STORAGE_UNAVAILABLE、WORKBENCH_AUTH_UNAVAILABLE、AUDIT_PERSISTENCE_UNAVAILABLE，true |

错误 details 保持开放，客户端可能重新映射 retryable；它不授权自动重发。存储 helper 将缺少数据库或非 ContractError 的内部异常归为存储不可用，不能把每个503都解释成数据库未提交。反向代理/HTTP解析层的错误不保证这份 JSON 结构。

源码依据：Gateway 的 server/http/authenticated-context/context-packs，共享 metadata/context-pack-read/context-pack-compile 及 SDK 对应适配器。只做人工源码审阅和格式/Git文本检查，未执行校验器、生成器、接口、数据库、编译、类型检查、测试或发布；P0-01/R-003 保持未完成、evidence 为空。

## 保存身份与历史回执

`context-pack-save.json`采用OpenAPI 3.1.0，包子路径为`@planemem/contracts/openapi/context-pack-save.json`，覆盖已有`GET /v1/context-pack/save-context`和`POST /v1/context-pack/save-receipt`。成功身份/历史封套及POST原查询引用相邻`../schemas/context-pack-save.json`完整资源的锚点；错误沿五字段ErrorEnvelope，保留开放details。它不描述保存包提交接口，也不改变路由或运行时校验。

本地加载两份完整文件，保留openapi与schemas相邻布局，并配置解析器基址及Schema $id映射；无需目录或完整包读取Schema，不向planemem.local下载。servers默认相对根路径，使用者须配置实际Gateway基址（含部署路径）。OpenAPI/2020-12、外部锚点与Reference Object的description覆盖兼容性尚未验证；所有x-*扩展只作说明，不是执行约束。

两个接口都要求Bearer、三范围头、认证客户端和未过期实际context.read。actor/client/能力来自已验证身份，HTTP expected_actor/client头可独立省略，提供时必须相等；POST正文仍须完整五字段身份与原restricted桶。traceparent的非空值优先，其次x-trace-id，两者都缺省时生成trace；本接口对每个已提供trace头都检查相等，所以两个头冲突或出现空值会被拒绝。该字段目前作不透明标识，并未执行W3C trace解析。

| 边界 | 身份GET | 历史回执POST |
| --- | --- | --- |
| 查询/片段 | 不接受 | 不接受 |
| 正文 | 不发送；Content-Length缺省或字面量0 | 完整原查询JSON，原键在正文，不是Idempotency-Key头 |
| 正文头 | 拒绝transfer/content-encoding | 必须application/json，可带唯一UTF-8 charset；Content-Length若存在须规范1–4096，无transfer/content-encoding |
| 重复及条件头 | 原始头名不区分大小写拒绝重复，禁止写入/缓存/Range条件 | 同左；重复头规则不意味着JSON.parse检测重复正文属性 |
| 读取内容 | 当前可信身份、会话期限与权限提示；不检查项目存在 | 可见父项目和保存指纹/历史元数据；不检查包正文或来源 |
| 200 | 完整16 KiB身份封套、空来源 | 完整16 KiB recorded或not-observed，两者均成功 |
| 响应头 | 成功带trace；早期认证/输入失败可能没有trace头 | 直接Node HTTP入口在认证前设置trace及Connection: close，包括提前拒绝 |
| 专用容量/期限 | 身份处理器没有独立两槽或30秒预算 | 每router两笔、处理器30秒；底层结束释放，超时不保证SQL取消 |

全部应用JSON响应带private, no-store，两个成功响应均无ETag，不处理条件缓存为304。HTTP代理/其他协议可能改变Connection等逐跳头，文档描述直接服务端边界；不据此要求HTTP/2携带该头，也不保证外层HTTP解析或代理错误使用应用封套。GET的早期错误不保证WWW-Authenticate，POST也不增加该保证；限流不承诺Retry-After。

| HTTP状态 | 身份GET | 历史回执POST |
| --- | --- | --- |
| 400 | INVALID_INPUT：查询/正文条件/重复及禁止头/trace不一致 | INVALID_INPUT：同类条件、无效或超4 KiB正文、原查询结构；超限不映射为413 |
| 401 | UNAUTHENTICATED | UNAUTHENTICATED |
| 403 | DENIED：范围、预期身份、权限/策略或会话 | DENIED：另含完整原身份/restricted不符 |
| 404 | 不以身份查询证明项目存在；其他路由边界错误见default | CONTEXT_PACK_NOT_FOUND：父项目不可见；原记录缺失是200 not-observed |
| 409 | 无专用身份冲突码 | IDEMPOTENCY_KEY_REUSED：原参数/权限指纹不同 |
| 429 | RATE_LIMITED：通用actor/path频率限制，retryable=true | 通用频率为true，历史两槽占满为false |
| 500 | CONTEXT_PACK_SAVE_CONTEXT_INVALID为false；INTERNAL_ERROR为true | CONTEXT_PACK_RECEIPT_INVALID为false；INTERNAL_ERROR为true |
| 503 | 认证或审计不可用，retryable=true | 认证/审计不可用为true；历史存储不可用/读取超时为false |

未另注明的专用输入/认证/拒绝/未找到/冲突错误retryable=false。布尔值来自原HTTP错误，不可用SDK固定映射反推；错误码不是穷尽枚举，retryable也不是自动重发原保存的授权。

原始已定义头部对序列化后限16 KiB，不等于HTTP线缆字节或单头限制。POST正文原始字节和解析后查询分别限4 KiB；身份/历史成功封套16 KiB。历史30秒从处理器开始，外层认证、正文读取、策略/审计和发送响应不在其中；客户端自己的总期限和16 KiB错误读取限制另行生效，不声明服务端统一错误字节上限或全HTTP耗时上界。

原Gateway/身份/权限、查询回显、历史预算/TTL/来源及本地文件摘要仍沿[原请求Schema说明](../schemas/README.md#contextpack-原请求与历史回执)与[ContextPack运行契约](../../../docs/design/01-contracts/context-pack-runtime.md)。源码依据为server/authenticated-context/http/router和save-context/save-receipt处理器。未调用接口、SQL或校验工具；R-003未完成、evidence为空，完整WCP OpenAPI、本地解析/生成和真实客户端兼容证据仍待补。

## 保存包元数据目录

`context-pack-directory.json`采用OpenAPI 3.1.0，包子路径为`@planemem/contracts/openapi/context-pack-directory.json`，仅覆盖`GET /v1/context-packs`。成功JSON复用`../schemas/context-pack-directory.json`完整资源及其标量/游标锚点；错误沿`packages/contracts/src/errors.ts`的五字段封套。此文件是接口文档，不是生产路由或新的运行时校验器。

本地消费时保留`openapi/`与`schemas/`的相邻目录关系，为解析器提供文档的本地基址，并注册完整目录Schema的`$id`。通过包子路径获得内容后，也要显式配置本地资源映射；只复制OpenAPI文本而丢失基址不能可靠解析相对引用。`planemem.local`仅是Schema标识，不是下载地址。无需加载完整包读取或比较Schema。外部Schema、锚点、2020-12及Reference Object描述覆盖的工具兼容性仍待验证；本轮不执行加载或生成示例。

### 请求与响应

- 使用当前Gateway地址与Bearer令牌，提供`x-tenant-id`、`x-workspace-id`、`x-project-id`三范围头，必须与可信授权范围一致。真实actor/client/角色/能力来自已验证身份。处理器要求未过期会话及规范后的实际`context.read`；既有认证层可能将`workbench.read`或指定工作台客户端的`Base`映射为该能力，单有admin不够。
- HTTP的`x-expected-actor-id`、`x-expected-client-id`可分别省略，提供时必须与可信身份相等；它们不是身份来源。CLI JSON成对约束不属于本HTTP参数规则。客户端字段按共享isSyncIdentifier规则；不要误套CLI额外排除DEL的规则。
- 当前server优先采用非空`traceparent`，其次非空`x-trace-id`，均缺省则生成`trace_http_<ULID>`。这里把traceparent当不透明标识，没有执行W3C Trace Context解析。成功读取要求有效共享trace，完整返回体与`x-trace-id`头保持所选值。
- 只接受各至多一次的`pack_id`、`limit`、`cursor`查询。limit为1–100，省略25，URL须为无符号、无前导零的十进制整数；响应query显式带limit。未知/重复/空参数无效。公开GET不带JSON正文；`content-length`仅可缺省或字面量`0`，拒绝transfer-encoding和文档列出的写入、条件缓存及Range头。OpenAPI的参数表和自定义扩展不能独立强制这些额外规则。
- 200完整响应只含六字段元数据，精确筛选找不到或不可见的包返回空页，父项目不可见返回404。所有应用JSON响应发送`cache-control: private, no-store`，成功页带`x-trace-id`且没有ETag，不返回304。提前认证/输入拒绝可能没有`x-trace-id`响应头，必须保留并读取错误体trace；不承诺WWW-Authenticate或Retry-After头。

| HTTP状态 | 当前主要错误码与语义 |
| --- | --- |
| 400 | INVALID_INPUT：查询/禁止条件/游标失效，retryable=false；其他边界错误仍沿公共封套 |
| 401 | UNAUTHENTICATED：缺失或拒绝凭据，retryable=false |
| 403 | DENIED：范围/原身份不符、策略拒绝或执行期间到期，retryable=false |
| 404 | CONTEXT_PACK_NOT_FOUND：父项目不可见，retryable=false；不同于精确包查询空页 |
| 429 | RATE_LIMITED：通用actor/path限流为true，目录两容量占满为false |
| 500 | CONTEXT_PACK_INVALID为false；意外命令错误INTERNAL_ERROR默认序列化为true |
| 503 | 存储不可用/目录等待超时为false；认证不可用/审计持久化不可用为true |

表中的布尔值是原始HTTP错误体的`retryable`。SDK和MCP固定错误映射可能另置false，不能反推原始HTTP封套；retryable不表示客户端自动重试、切换账号或刷新游标。`details`保留开放诊断对象，错误码不是穷尽枚举，外层代理或HTTP解析失败也不保证应用JSON形状。

### 运行时边界

`x-runtime-limits`、`x-rejected-request-headers`、`x-required-normalized-capabilities`和`x-wcp-operation`是说明性扩展。原实现负责规范查询4 KiB、单记录2 KiB、成功封套256 KiB，以及普通JSON/UTF-16/跨字段关系。4 KiB是解析后查询预算，不是原始URL限制；16 KiB错误上限由各客户端读取器施加，不表示服务端统一错误大小限制。

目录处理器每router两笔容量、30秒等待期限，外层认证、策略/审计和响应发送不在该期限内；数据库操作超时后未必可取消，底层结束才释放槽位。查询和Schema不能证明数据库扫描成本或整个HTTP耗时上界。

真实可见性过滤先于limit+1，版本/ID降序与绑定游标、规范原请求、唯一ID及完整续页由原实现检查。游标不是授权或跨页快照；目录不检查完整包正文/hash/来源，过期或来源变化仍可列出。完整包读取、编译、MCP资源候选目录和其他WCP路径不属于本文档。

源码依据为Gateway的`server.ts`、`authenticated-context.ts`、`http.ts`、`router.ts`、`context-pack-directory.ts`，以及共享目录解析器/错误封套；使用说明见[ContextPack契约](../../../docs/design/01-contracts/context-pack-runtime.md)和[独立目录结构](../schemas/README.md#保存-contextpack-元数据目录)。R-003保持未完成、`evidence: []`。全量OpenAPI、自动一致性、本地解析/生成工具和真实客户端兼容证据待补；仅源码文档人工审阅与格式文本检查，未执行校验器/生成器、编译、类型检查、测试、API/数据库或发布。
