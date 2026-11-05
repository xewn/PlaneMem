# WCP API 契约 v1

2026-11-05，TODO P0-01：[会话启动与原回执三路 OpenAPI](../../../packages/contracts/openapi/README.md#会话启动与原回执) 与 session-start Schema 覆盖当前命令身份、普通启动及原启动查询。完整定义原业务字段/身份键、当前会话/历史回执及 SDK 规范封套，明确事务锁与可见性先于重放、旧记录未知、单快照查询和实际 HTTP/SDK 预算差异。OpenAPI 累计 70 路；P0-01/R-001 未完成、evidence 为空，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[检查点与交接三路 OpenAPI](../../../packages/contracts/openapi/README.md#检查点历史与交接详情) 及 checkpoint-read/handoff-read Schema 覆盖历史、指定检查点和当前交接详情。完整定义六类笔记/引用/十条分页、候选封套字节限制、旧领取归属与当前身份权限提示；明确父项目可见性、前瞻位置核对、保存内容不代表原请求成功/包有效及实际 SDK/HTTP 边界。该轮使 OpenAPI 累计六十七路，P0-01/R-001 未完成、evidence 为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[会话状态与活动五路 OpenAPI](../../../packages/contracts/openapi/README.md#会话状态与活动读取) 与 session-activity-read Schema 覆盖当前会话状态、运行目录/详情、工具目录/详情。完整描述原查询/数字版本与序号/分页/来源扩展/当前身份提示/成功封套；明确可见父项目、同语句快照、原始位置不绑定身份及 SDK 实际解析差异，不把状态当作原请求回执。该轮使 OpenAPI 累计六十四路，P0-01/R-001 未完成、evidence 为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[Plane 收件箱六路 OpenAPI](../../../packages/contracts/openapi/README.md#plane-收件箱与原重试回执) 及 plane-inbox/plane-inbox-retry Schema 覆盖列表、概览、详情、版本诊断、调度及原调度回执查询。完整描述元数据/身份提示、游标计数/真实提交水位、规范命令及历史回执；明确可信管理员/人工调度、可见性与完整事件核对先于重放，查询也持事务锁，排队不代表应用。该轮使 OpenAPI 累计五十九路；P0-01/R-001 未完成、evidence 为空。未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[旧索引五路 OpenAPI](../../../packages/contracts/openapi/README.md#旧索引内容与管理)及context-index Schema覆盖目录/状态GET与内容写入/删除/恢复POST，完整描述原始请求/规范命令/状态/身份权限/历史内容与元数据回执。明确游标可改页大小、重放先后、恢复不延长到期和capture非原子；修正搜索/观察MEMORY_PROVIDER_OFF未配置与disabled的retryable差别。该轮使OpenAPI累计五十三路；P0-01/R-001未完成、evidence为空，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[双搜索 OpenAPI](../../../packages/contracts/openapi/README.md#项目与旧索引搜索)及独立search Schema覆盖POST /v1/search和POST /v1/context/search。完整定义请求/项目分页/bigint版本及旧索引安全数字revision/记忆命中/完整封套，明确游标可改页大小、数据库排序、来源与记忆降级/HTTP边界。该轮使OpenAPI累计四十八路；其余WCP/MCP等仍缺，P0-01/R-001未完成、evidence为空。未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[Plane观察读取 OpenAPI](../../../packages/contracts/openapi/README.md#plane观察读取)及observed-read Schema补齐项目状态、工作项状态/上下文和观察目录四路。完整建模快照活动/删除/恢复、临时记忆摘要和目录元数据，明确身份筛选游标、可见性联结、分类差异及真实HTTP/SDK解析边界。该轮使OpenAPI累计四十六路，P0-01/R-001未完成、evidence为空；仅源码文档人工审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[建议写入与原回执 OpenAPI](../../../packages/contracts/openapi/README.md#建议写入与原回执)和proposal-write/proposal-original Schema补齐创建、确认、拒绝、原创建与原审核查询五路。规范原查询不同于旧写正文，写入重放不同于只读持久事件核对；完整定义human审核、键/版本/来源关系、recorded/not-observed和实际HTTP预算。建议八路源码目录已描述，该轮使OpenAPI累计四十二路；P0-01/R-001未完成、evidence为空。仅源码文档人工审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[建议读取与提交身份 OpenAPI](../../../packages/contracts/openapi/README.md#建议读取与提交身份)及 proposal-read Schema覆盖目录、完整详情、submission-context三路。目录续页、直接派生筛选、来源/祖先可见性与权限提示按源码描述；详情当前来源观察不证明外部引用或后续审核授权，身份直返不经过命令Policy/审计/限流。该轮使OpenAPI累计三十七路，建议POST等剩余机器契约与接线仍缺，P0-01/R-001未完成、evidence为空。仅人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[冲突读取与原决定 OpenAPI](../../../packages/contracts/openapi/README.md#冲突读取与原决定)补齐五路已有接口的机器描述，新增完整分页/详情、原命令/回执/身份、旧HTTP提交与专用客户端结果Schema。读取保留bigint字符串、JSONB文本及SQL NULL/legacy状态；提交/原回执分别描述真实重放、完整性与权限边界，不宣称源字段已应用。该轮使OpenAPI源码覆盖三十四路；P0-01/R-001未完成、evidence为空。未改运行逻辑、未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[同步上传与原投递 OpenAPI](../../../packages/contracts/openapi/README.md#同步上传与原投递)覆盖 events:batch、sync/commands/context、sync/events/receipt 三路，新增原始/有效批次、逐项拒绝、字段建议、发送身份与完整历史回执 Schema。区分批次原正文指纹与规范事件指纹、头键优先及重放早于新来源检查；原事件查询复查当前来源/历史权限，但不证明整个批次或源字段应用。仅描述既有实现，客户端256 KiB等限制不冒称旧上传服务端保证；OpenAPI 源码现覆盖二十九路。P0-01/R-001 未完成、evidence 为空，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[同步消费与确认 OpenAPI](../../../packages/contracts/openapi/README.md#同步消费与确认)覆盖已有 changes/cursor/ack 三路，新增完整分页、原身份、当前位点及确认成功 Schema。省略 cursor 读取已确认位置，读页不自动确认；分页权限过滤允许跳号，历史事件/来源扩展保持开放。当前位点区分无记录与确认到零；确认绑定原身份/目标、禁止回退，提交后到期拒绝仍可能已提交。变化路由缺独立父项目检查与读取后到期复查，客户端预算不冒称服务端保证。OpenAPI 源码现覆盖二十六路；P0-01/R-001 未完成、evidence 为空，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-05，TODO P0-01：[上下文条目写入 OpenAPI](../../../packages/contracts/openapi/README.md#上下文条目写入)覆盖已有创建/编辑/归档/恢复/确认五路POST，提供原正文与按操作的完整回执Schema。回执包含历史版本/事件/时间/游标，不是当前条目；原键同文重放在新写版本/生命周期/来源检查前查回执，但仍复查当前身份/权限/可见性。新写同事务保存条目、历史、事件和回执，恢复保持excluded，确认严格检查本地来源。create缺显式父项目可见性、正文ID被路径覆盖、旧通用解析/SDK边界照实记录。未改运行实现，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布；P0-01/R-001未完成、evidence为空。

2026-11-05，TODO P0-01：[当前与归档上下文详情 OpenAPI](../../../packages/contracts/openapi/README.md#当前与归档上下文详情)描述两路已有 GET，复用历史字段与公共 HTTP 组件，新增完整实时检查/确认准备和归档详情 Schema。父项目/条目可见性、同事务来源图检查、版本/ETag和原来源绑定均明确；允许确认只是本地读取提示，旧 HTTP 边界和客户端预算不冒称服务端保证。未改运行实现、未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布；P0-01/R-001 未完成、evidence为空。

2026-11-05，TODO P0-01：[上下文版本历史 OpenAPI](../../../packages/contracts/openapi/README.md#上下文版本历史)覆盖已有 GET 历史目录与指定版本。完整 Schema 约束 baseline 空归属、命令状态、原快照/确认、分页及无外层 ETag 的成功；明确 hash/来源/范围跨字段检查、当前/历史分类过滤、逐请求只读一致快照和客户端预算不等于服务端保证。未改变运行逻辑，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。P0-01/R-001 未完成，evidence 为空。

2026-11-05，TODO P0-01：[指定版本文件下载 OpenAPI](../../../packages/contracts/openapi/README.md#指定版本文件下载)新增现有 GET /v1/artifacts/{artifact_id}/versions/{version}/content 的机器描述。新 Schema 根仅描述解码请求及绑定元数据/HTTP标量，成功明确为原始octet-stream；完整列出范围/版本/hash/长度/放行审计头、读取前后导出检查、两笔容量和仅发送阶段60秒期限。放行/发送结束不等于客户端收存。未改运行实现，未运行下载、校验器、生成器、编译、测试、数据库或发布；P0-01/R-001未完成、evidence为空。

2026-11-05，TODO P0-01：[文件创建与追加上传 OpenAPI](../../../packages/contracts/openapi/README.md#文件创建与追加上传)新增已有 POST /v1/artifacts 和 POST /v1/artifacts/{artifact_id}/versions 的机器描述。复用原身份/命令，独立完整成功 Schema 严格配对首次保存与重放状态，描述原键/版本、文件部件、两笔容量/120 秒仅正文预算和错误。未改运行逻辑或执行上传、校验器、生成器、编译、测试、数据库及发布；P0-01/R-001 未完成、evidence 为空。

2026-11-05，TODO P0-01：[文件上传身份与原请求回执 OpenAPI](../../../packages/contracts/openapi/README.md#文件上传身份与原请求回执)新增现有 GET upload-context 与只读 POST receipt 的机器描述，完整 Schema 覆盖原五项身份、创建/追加命令、recorded/not-observed 和当前能力提示。原回执只读且不等待并发上传完成，未观察到不是原上传失败证明；客户端限额不冒称服务端保证。未改运行行为，未执行校验器、生成器、编译、测试、接口、数据库或发布；P0-01/R-001 未完成、evidence 为空。

2026-11-05，TODO P0-01：[文件元数据读取 OpenAPI](../../../packages/contracts/openapi/README.md#文件元数据读取)覆盖现有文件目录、当前详情、版本目录和指定历史详情四路 GET。新增详情完整 Schema，复用原目录和公开元数据/历史封套；区分真实权限/客户端检查、分页、当前与历史 ETag、错误和服务端/客户端限额。仅机器契约源码，未改运行行为或执行校验器、生成器、编译、测试、接口、数据库及发布；P0-01/R-001 未完成、evidence 为空。

2026-11-05，TODO P0-01：[保存包生成与完整读取 OpenAPI](../../../packages/contracts/openapi/README.md#保存包生成与完整读取)新增现有 POST /v1/context-pack/compile 和 GET /v1/context-pack 的机器描述。成功复用完整包 Schema，覆盖稳定键/参数与原身份重放、显式或最新读取、三种格式、ETag/原游标/双层trace及404/409/410等错误。准确区分旧HTTP通用1MiB正文与客户端4KiB/2MiB/16KiB预算，不声称具有目录入口的专用期限/容量/禁止头检查。仅源码文档，未运行校验器、生成器、接口、数据库、编译、测试或发布；完整WCP/机器契约接线仍缺。

2026-11-05保存身份/历史回执OpenAPI增补：独立`context-pack-save.json`描述已有GET save-context及POST save-receipt，复用原请求独立Schema，明确认证/原身份/双trace、无查询/禁止条件、正文与响应限额、两接口不同的期限/容量/早期响应头及错误状态。使用说明见[保存身份与历史回执OpenAPI](../../../packages/contracts/openapi/README.md#保存身份与历史回执)，不新增路由或改变JSON，不涵盖保存提交和完整WCP目录。仅源码文档，未运行校验器、生成器、编译、类型检查、测试、API/SQL或发布。

2026-11-05原保存回执增补：新增只读`POST /v1/context-pack/save-receipt` → `context.pack.save-receipt`，4 KiB完整原身份/restricted/键/显式参数查询；真实未过期context.read、认证客户端、原身份及权限桶相等、父项目可见后，在只读快照中匹配既有保存指纹。16 KiB闭合封套返回recorded历史元数据或not-observed；不访问包正文/来源，不保存、预留键或自动重发。成功200、private/no-store、原trace且无ETag；无查询参数，拒绝重复/写/缓存/Range/编码头。SDK与网络CLI已接源码，详细形状、错误及限制见[原保存请求回执查询](context-pack-runtime.md#原保存请求回执查询2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行接口/客户端/数据库或发布。

2026-11-05保存身份客户端增补：CLI `context save-identity`和MCP `get_context_pack_save_context`接入已有GET /v1/context-pack/save-context，无新增REST路由。CLI可选成对原账号/客户端相等条件；MCP身份只来自可信会话。完整16 KiB身份/有效期/权限提示检查、30秒读取预算及原容量保持，不保存、预留键或自动替换原绑定。见[CLI/MCP保存身份入口](context-pack-runtime.md#climcp保存身份入口2026-11-05源码增量)，仅源码文档，未编译、类型检查、测试、执行CLI/MCP/SDK/API或发布。

2026-11-05保存原身份增补：新增只读`GET /v1/context-pack/save-context` → `context.pack.save-context`，无查询/正文/写/缓存条件，要求可信未过期实际context.read与认证客户端；16 KiB完整封套返回当前五项identity、expires_at及compile/read_restricted提示。SDK getContextPackSaveContext和Mock已接源码，不读包或来源，不证明项目可见、保存结果或后续授权。身份原文及期限规则、头部/状态和限制见[保存前可信身份读取](context-pack-runtime.md#保存前可信身份读取2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行API/SDK/Mock或发布。

2026-11-05 CLI保存包目录增补：`context list-packs`网络main/callGateway和嵌入runWorkctx接入既有GET /v1/context-packs与context.pack.list。4 KiB可选查询/稳定文件/仅网络stdin，原筛选游标及可选成对身份约束；通过SDK有界单页读取和默认30秒期限核对完整256 KiB元数据封套，不自动翻页或读取正文。嵌入沿原handler权限过滤并共用上下文读容量，详见[CLI保存包目录](context-pack-runtime.md#cli-保存包目录读取2026-11-05源码增量)。仅源码文档，无新服务端路由；未编译、测试、执行CLI/API或发布。

2026-11-05 SDK保存包目录增补：`listContextPacks`与`contextPackPages`接入既有GET /v1/context-packs，保持原范围/身份约束、规范查询及完整元数据封套；默认30秒有界读取和取消，迭代固定完整账号客户端、显式按需续页与页数上限。没有新服务端操作或写入；transport响应信息限制、类型和未执行示例见[SDK保存包目录](context-pack-runtime.md#sdk-保存包目录读取2026-11-05源码增量)。仅源码文档，未编译、测试、执行SDK/API或发布。

2026-11-05 保存包目录增补：新增只读`GET /v1/context-packs` → `context.pack.list`，单值可选pack_id/limit/cursor，默认25最大100；拒绝正文、写条件、条件缓存和Range。要求已验证未过期客户端及完整项目身份、实际context.read，按父项目和保存read_restricted过滤。响应包含scope/query/trace、固定来源标记、metadata-only/not-checked、六字段data数组及可选next_cursor；不返回正文/hash/来源，不排除过期或来源已变化包。4 KiB查询、2 KiB单条、256 KiB完整响应，版本/ID降序、身份及条件绑定游标；无外层ETag或跨页快照。项目不可见404、非法查询400、容量429、目录等待超时/存储不可用503、异常完整元数据500。Web/SDK/CLI/MCP/Mock及独立Schema已有源码接入，HTTP定义见[保存包目录OpenAPI](../../../packages/contracts/openapi/README.md)，全量接口目录和自动一致性/运行证据仍缺；详细边界见[保存包元数据目录](context-pack-runtime.md#保存包元数据目录2026-11-05源码增量)。仅源码文档，未编译、测试、执行SQL/API或发布。

2026-11-04 CLI上下文目录读取增补：context list三入口统一SDK有界完整读取，仍为POST /v1/workbench/query的operation=context。8 KiB可选JSON/文件/仅网络stdin、默认30秒timeout-ms、2 MiB完整成功响应及原scope/query/trace/记录/续页核验；可选成对expected_actor_id/expected_client_id剥离为身份相等头，不进入业务正文。嵌入与其他上下文读取共用两笔容量并核对实际context.read/到期/restricted；每次一页，页大小与筛选固定续读，不自动重试/缩页。完整兼容边界见[CLI上下文目录](context-item-runtime.md#2026-11-04-cli上下文目录完整读取增量)。仅源码文档，未编译、类型检查、测试、执行或发布。

2026-11-04 工作项排序：workbench.query的work_items新增sort=updated_desc/due_asc。默认规范化省略、旧筛选与游标保持；due_asc以微秒截止日期升序/null最后/同日期ID的C顺序分页，新v5查询绑定/v2位置固定全部条件和排序。SDK/CLI/MCP/Web/Mock同步；不改变原记录或默认排序，不提供跨页快照，见[工作项排序](work-item-projection-runtime.md)。仅源码文档，未编译、测试、执行或发布。

2026-11-04 工作项截止日期筛选：workbench.query的work_items增加due=scheduled/unscheduled与due_from/due_before，按已保存due_at是否null及严格UTC YYYY-MM-DD区间（含起始、不含结束）筛选。无日期与区间互斥，起始须早于结束；新日期条件使用v4游标绑定全部筛选，无新条件保持v1–v3。SDK/CLI/MCP/Web/Mock同步，权限和筛选先于LIMIT、响应整页核对，不自动判断逾期或改状态。详见[工作项筛选](work-item-projection-runtime.md)，仅源码文档，未编译、测试、执行或发布。

2026-11-04 工作项CLI读取增补：work-items list/get网络及嵌入入口复用SDK有界读取，支持--timeout-ms、8 KiB JSON/文件/仅网络stdin和2 MiB完整成功响应；CLI可选成对expected_actor_id/expected_client_id只转为身份前置头，不加入POST workbench.query正文。列表仍每次一页，原共享字段、路由和数据库保持。说明及兼容限制见[工作项运行契约](work-item-projection-runtime.md)，仅源码文档，未编译、测试、执行或发布。

2026-11-04 项目文件目录结构增补：`GET /v1/artifacts`的独立JSON Schema源码现为`packages/contracts/schemas/artifact-registry.json`，可通过contracts显式子路径引用。输入/规范查询/续页/当前摘要/页面/封套均有资源锚点；游标规范解码、身份权限绑定、原查询与来源/排序关系等仍由运行时执行，不把结构有效当作授权。见[Schema说明](../../../packages/contracts/schemas/README.md#项目文件目录)和[项目目录契约](artifact-registry-runtime.md)。未编译、执行校验器、测试或发布，完整OpenAPI和自动一致性证据仍缺。

2026-11-03 独立恢复身份增补：新增只读 `GET /v1/sessions/command-context`，无业务参数/写条件，强制可信有效客户端，按既有读/写/领取能力或 admin 语义执行策略及入口审计；只返回当前身份、到期和权限提示，来源为空，不读取目录或业务记录。完整封套限 16 KiB，SDK/CLI/MCP/Web 接入，专用 `/handoffs/recover` 保留原创建请求；不授予后续权限或证明项目存在/原请求成功。详见 [独立恢复身份](session-command-context-runtime.md)，无新迁移，未编译、测试或运行。

2026-11-03 检查点目录分页增补：`POST /v1/workbench/query` 的 operation=checkpoints 在不带 session_id 时接收 query/checkpoint_id/limit/cursor，默认 25、最多 100 条；带 session_id 时仅允许 before_revision，保持原历史模式。项目分页新增 scope/has_more/next_cursor、微秒时间、摘要 8 KiB 省略状态和完整 2 MiB 封套，SDK/CLI/MCP/Web 源码接入。048 索引只写文件，016–048 均未执行；详见 [检查点目录分页](checkpoint-registry-runtime.md)。未编译、测试、运行或发布。

2026-11-03 交接目录分页增补：`POST /v1/workbench/query` 的 operation=handoffs 仅接受 query/status/session_id/origin/limit/cursor，默认 25、最多 100 条。按 updated_at 微秒降序/ID 升序，游标绑定范围/受限数据能力/筛选/页大小；当前持久记录优先于同 ID 投影，摘要限 8 KiB 且明确省略，完整封套限 2 MiB。SDK/CLI/MCP/Web 源码已接入，旧全量消费者需迁移。047 索引文件未执行，016–047 均未执行；详见 [交接目录分页](handoff-registry-runtime.md)。未编译、测试、运行或发布。

2026-11-02 会话目录分页增补：`POST /v1/workbench/query` 的 operation=sessions 只接受 query/status/client_id/limit/cursor，按项目/可读父项目筛选后分页，默认 25、最多 100 条。完整封套新增 scope/has_more/next_cursor，started_at 保留 UTC 微秒，版本/计数为安全整数；旧全量行为替换，续页必须保持筛选与页大小。SDK/CLI/MCP/Web 已接入源码，046 排序索引仅写文件、未执行，详见 [会话目录分页](session-registry-runtime.md)。未编译、测试、运行或发布。

2026-11-02 管理快照增补：`POST /v1/workbench/query` 仅 `{operation:admin}` 接收可信有效管理员及实际 admin.read，按实际 audit/context 读取能力返回项目计数或明确不可读；数据库版本/读取时间来自同一 SQL。完整 scope/trace/来源与 16 KiB 封套校验，外部健康和发布就绪保持 not-checked。旧 services/release 静态响应被替换，消费者需同步更新，详见 [管理快照](workbench-admin-runtime.md)。仅源码，未编译、测试、运行或发布。

2026-11-02 Artifact 准备增补：新增只读 `GET /v1/artifacts/upload-context`，要求已验证客户端、实际 artifact.write 与未过期会话，不接受查询字段或写条件。封套 data 仅含自身 identity、expires_at、max_bytes、can_read/can_read_restricted 提示；沿用写能力授权决定审计，不生成请求键/Artifact、不检查存储健康或预留版本。工作台以此准备新建资料与固定当前版本的追加原请求，再交给已有上传流程。详见 [Artifact 持久化](artifact-persistence-runtime.md)；只改源码和文档，未编译、测试或运行。

2026-11-02 Artifact 下载增补：`GET /v1/artifacts/{artifact_id}/versions/{version}/content` 接收必需的 X-Expected-Artifact-SHA256 与 X-Expected-Artifact-Size，固定历史版本，不回退当前版本。要求已验证客户端、实际 artifact.read 及当前/历史分类导出权限；内容核验并确认持久 release 审计后返回二进制附件，审计失败不发送正文。成功响应是 application/octet-stream，使用范围/目标/hash/长度/trace/审计响应头，不使用通用 JSON 封套；错误仍为 JSON。拒绝 Range、条件缓存和写头，无外层 ETag 或存储 URL。SDK downloadArtifactVersion 接入有界读取及 SHA-256 核验；详见 [Artifact 持久化](artifact-persistence-runtime.md)。仅源码，未运行验证。

2026-11-02 Artifact 上传增补：`POST /v1/artifacts` 创建文件，`POST /v1/artifacts/{artifact_id}/versions` 追加版本。仅接受 multipart 的 request JSON 文件部件和 content 二进制文件部件；原 identity/command、Idempotency-Key 与追加 If-Match 必须一致。认证及实际 artifact.write 校验先于正文读取，复用持久回执/版本事务；结果不提供外层 ETag，不自动重试。默认 64 MiB 文件、1 MiB 请求描述、每实例两路上传和 120 秒正文读取期限；详见 [Artifact 上传](artifact-persistence-runtime.md#公开上传-httpsdk源码阶段)。仅源码开发，未编译、类型检查、测试、运行或发布。

2026-11-02 Artifact 读取增补：新增 `GET /v1/artifacts/{artifact_id}` 和 `GET /v1/artifacts/{artifact_id}/versions/{version}`，必须验证令牌及 artifact.read，当前/历史快照均核对当前范围可见性。返回元数据与 content_state=not-checked，不含存储键或正文；历史读取没有外层/HTTP ETag。服务器须显式配置持久 reader 或 S3+既有数据库；未配置返回 503。共享校验和 SDK 方法已补入源码，未运行；见 [Artifact 持久化](artifact-persistence-runtime.md)。

2026-11-02 创建交接增补：`POST /v1/sessions/{session_id}/handoff` 现在要求已验证身份并以持久事务保存创建回执，响应增加 create_receipt；新增只读 `POST /v1/sessions/{session_id}/handoff/receipt`，使用原 request_key 和 handoff 参数查询。旧无账号回执记录不补认成功，工作台保留原请求并提供恢复。043 迁移文件未执行，详见 [创建交接回执](handoff-create-runtime.md)。

新增只读 `GET /v1/plane/work-items` 当前观察元数据目录，要求可信身份和 context.read，支持 query 字面包含检索、state=active/deleted/all、limit 和绑定游标 v2；与本地工作项列表分开。检索词匹配当前标题摘要或 ID，只忽略 ASCII 英文字母大小写，删除行仅匹配 ID。权限、关联完整性和检索过滤先于分页，不返回历史正文。SDK/CLI/MCP/Web 已接入源码，041 排序索引仅写文件、未执行，见 [观察目录](observed-state-runtime.md#当前工作项观察目录2026-11-02仅源码)。

开发补充：`POST /v1/workbench/query` 支持 `operation=work_item`、本地 `item_id` 的独立投影详情读取，要求 context.read；版本为十进制字符串，不能用作 Plane 写入条件。SDK/CLI/MCP/工作台入口与限制见 [工作项投影详情](work-item-projection-runtime.md)，本批未运行验证。

## 通用请求

2026-11-02 SDK 审计增补：`listAuditRecords(query, options)` 与 `exportAuditView(reviewedDocument, options)` 已接入上述既有读取/导出路由，固定范围、完整响应核验及独立摘要；新增 bounded-json 传输限额和取消/期限，不自动翻页、重试或保存文件。调用说明及两层期限见 packages/sdk/README.md。无新服务端接口、依赖或迁移，未编译、测试、实际调用或发布。

2026-11-02 审计导出增补：`POST /v1/audit/export` 接受固定 scope/audit_id/sha256，仅导出已审阅的单条有界视图。要求实际 audit.read、导出能力与有效可信客户端；再读取/核验/授权，持久 release 后返回最多 128 KiB 的完整 JSON 封套。原文省略标记保持，浏览器另行请求保存，release 不证明客户端保存完成。请求最多 4 KiB，无查询/条件头或幂等缓存；详见 [单条审计视图导出](audit-export-runtime.md)。仅源码，未编译、测试、运行或发布。

2026-11-02 审计大小增补：audit 返回记录增加 details_state/details_bytes/source_refs_state/source_refs_bytes。SQL 分页后限制元数据 16 KiB、详情 32 KiB、来源 16 KiB，超限详情/来源显式省略，原审计不修改；整页封套上限 16 MiB，超限/异常元数据拒绝页面。Web 成功/错误正文分别限 16 MiB/16 KiB并共用一次 30 秒读取期限，不显示部分页。前后端源码需配套，详见 [工作台审计定位](workbench-audit-runtime.md)。未编译、测试、运行或发布。

2026-11-02 审计翻页增补：audit 查询支持绑定当前项目、restricted 可见性与原筛选的 cursor，200 条上限保持；has_more=true 同时返回 next_cursor。按微秒 occurred_at 与审计 ID 严格递减读取，前后端校验页序/位置/下一页一致性，错误不自动回首屏。游标不是权限凭据或冻结历史快照，audit_id 精确查询不接受 cursor。详见 [工作台审计定位](workbench-audit-runtime.md)。仅源码和文档，未编译、测试、运行或发布。

2026-11-02 审计定位增补：`POST /v1/workbench/query` 的 `operation=audit` 支持 resource/trace_id/action/audit_id/session_id 精确交集筛选，保留 audit.read、可信项目和 restricted 过滤。session_id 要求 ULID，绑定分页游标，只匹配既有会话字段；新入口审计按明确操作关联请求目标，不能证明业务成功，不回填历史。返回最多 200 条记录，新增外层 scope/has_more；原 data 数组不变，空结果不证明原操作失败。Gateway/Web 共用完整校验，新 Web 不接受缺少新增字段的旧响应。字段长度、页面跳转和源码阶段限制见 [工作台审计定位](workbench-audit-runtime.md)。未编译、测试、运行或发布。

Plane Webhook 开发补充：`POST /v1/plane/webhook` 已改为持久接收并处理，响应新增 `durable=true` 与 HTTP 202 `queued`（尚未确认投影生效）；200 accepted/duplicate 表示已处理，409 rejected 保留冲突，不再无数据库回退内存。完整语义及未执行的 037 迁移见 [Plane 接收与重试](plane-inbox-runtime.md)，未运行验证。

新增管理员只读 `GET /v1/plane/events` 和 `GET /v1/plane/events/{event_id}`，要求令牌身份、admin 角色及 admin.read 策略；按项目和有效分类过滤，只返回处理元数据。列表支持状态、aggregate、limit 和绑定游标，工作台已接入；038 目录索引未执行，参见 [接收目录与回执](plane-inbox-runtime.md)。

新增 `GET /v1/context/index` 元数据分页目录，query 按 ID 包含，state/managed_by 筛选，limit 默认 25、最大 100，cursor 绑定范围/读取能力/筛选。返回 data.items 和可选 data.next_cursor；状态单查增加 index_permissions/index_identity 供工作台绑定请求。034 排序索引未执行，见 [旧索引管理](legacy-context-lifecycle-runtime.md)。

新增 `GET /v1/context/index/{id}` 元数据状态读取及 `POST .../{id}/delete`、`POST .../{id}/restore` 管理手工索引。写入要求稳定键、原 expected_revision 和 reason，软删除/恢复增加版本并保存历史回执，恢复保留分类和到期时间。033 迁移仅写文件；见 [旧索引管理](legacy-context-lifecycle-runtime.md)。

旧 `/v1/context/index` 与 `/v1/context/search` 现在要求令牌鉴权，分别使用持久回执写入与 PostgreSQL 检索；增加分类/到期并依赖未执行的 032 迁移。旧无分类记录回填 restricted，索引更新不降级，搜索 budget 1–100。变更说明见 [旧索引持久读取](legacy-search-runtime.md)。

新增只读 `POST /v1/search`，令牌身份与 context.read 必需，提供工作项/上下文当前记录的 FTS 或字面包含及游标分页；默认 20、最多 50 条，续页位于 data.next_cursor。031 全文索引仅写文件，范围和旧搜索迁移缺口见 [项目搜索](project-search-runtime.md)。

`operation=overview` 已提供同语句项目汇总、上下文分层统计与有限预览，拒绝多余字段；不可见项目返回 404，不能用全零响应表示缺失。SDK/CLI/MCP/Web 入口与口径见 [项目概览读取](workbench-overview-runtime.md)。本批无新增迁移、未运行验证。

工作项列表`operation=work_items`默认25、最多100条，允许query/status/priority/owner/assignment/due/due_from/due_before/sort/cursor/limit。priority=P0..P3，owner精确保存文本；assignment按owner非空/空串筛选，unassigned与精确owner互斥。日期及sort按顶部增量规则，默认updated_desc，未知字段拒绝；响应外层next_cursor显式续页，须保留全部筛选和排序。due_asc采用v5绑定/v2位置，默认排序保留v1–v4，换条件回首页。单页不是全项目，详见[工作项投影读取](work-item-projection-runtime.md)。030索引仍仅迁移文件，本次未新增/执行迁移、编译或测试。

```http
Authorization: Bearer <token>
X-Tenant-Id: tenant_01
X-Workspace-Id: workspace_01
Idempotency-Key: request_01
If-Match: W/"version-8"
traceparent: 00-...
```

## 最小接口

原同步事件查询见 [原事件回执](sync-event-receipt-runtime.md)：提供保存的完整 identity/event，复用原规范化指纹核对历史投递；recorded/not-observed 不确认源实体应用或未知上传失败，不重发、不结算本地队列。Gateway/SDK/CLI 仅源码接入。

同步原身份与离线队列新增开发契约见 [原同步身份](sync-identity-runtime.md)：新入队保留 expected_identity，Bridge 上传带原账号/客户端前置条件；旧缺身份行保留并阻止发送，不自动按当前令牌补绑定。SDK getSyncCommandContext、CLI sync identity 只读；直接 uploadEvents 可选原身份。服务器事件/批次指纹不变，本地新增三列仅源码，未执行迁移、编译或测试。

| 方法 | 路径 | 所有者 | 结果 |
|---|---|---|---|
| GET | `/v1/artifacts` | Artifact | 当前项目文件目录；名称/分类筛选、每页1–20条，身份/范围/权限/筛选绑定cursor和完整next_query；只读摘要，见[运行契约](artifact-registry-runtime.md)，仅源码未验证 |
| GET | `/v1/artifacts/{artifact_id}/versions` | Artifact | 真实artifact.read和当前/历史可见性；limit默认10最多20、at_version上界及before_version位置；完整next_query显式续页，摘要不读正文、无ETag。见[运行契约](artifact-versions-runtime.md)及[独立Schema](../../../packages/contracts/schemas/README.md)；仅源码，未运行验证 |
| GET | `/v1/plane/events` | Plane Adapter / Admin | 当前范围可见的持久接收元数据分页 |
| GET | `/v1/plane/events/{event_id}` | Plane Adapter / Admin | 单个事件的当前处理回执元数据 |
| POST | `/v1/events:batch` | Sync | 接受/拒绝事件、server_cursor |
| GET | `/v1/sync/commands/context` | Sync | 读取可信原发送身份/到期/上传权限提示；无参数或写条件 |
| POST | `/v1/sync/events/receipt` | Sync | 按原 identity/event 查询 recorded/not-observed；无批次键，不重发或结算队列 |
| GET | `/v1/sync/changes?cursor=` | Sync | 增量事件 |
| POST | `/v1/sync/ack` | Sync | 确认游标 |
| GET | `/v1/projects/{id}/state` | Plane Adapter | 项目状态投影 |
| GET | `/v1/work-items/{id}/state` | Plane Adapter | 持久 Plane 工作项观察快照 |
| GET | `/v1/plane/work-items` | Plane Adapter | 当前项目可见的工作项观察元数据分页 |
| GET | `/v1/work-items/{id}/context` | Context | ContextPack |
| POST | `/v1/sessions` | Session | Session |
| GET | `/v1/sessions/{session_id}` | Session | 当前 status/version/ended_at；context.read 与父项目可见性过滤，无查询参数，当前状态不确认原请求成功 |
| POST | `/v1/sessions/{id}/runs` | Session | AgentRun |
| POST | `/v1/sessions/{id}/runs/{run_id}/finish` | Session | 记录 completed/failed，校验会话与运行版本并保存回执 |
| GET | `/v1/sessions/{id}/runs` | Session | 按运行序号分页的记录明细 |
| GET | `/v1/sessions/{id}/checkpoints` | Session | 签名 context.read；可选 before_revision，十条历史分页及范围/会话/游标校验，见 checkpoint-context-runtime.md；仅源码开发 |
| GET | `/v1/sessions/{id}/runs/{run_id}` | Session | 单次运行和会话摘要，返回各自当前版本 |
| GET | `/v1/sessions/{id}/tool-calls` | Session | 按 ID 分页的工具记录，可按 run_id 筛选 |
| GET | `/v1/sessions/{id}/tool-calls/{tool_call_id}` | Session | 单次工具调用及所属运行、会话，返回各自当前版本 |
| POST | `/v1/sessions/{id}/tool-calls` | Session | ToolCall |
| POST | `/v1/sessions/{id}/tool-calls/{tool_call_id}/finish` | Session | 补记 succeeded/failed，校验会话与工具版本并保存回执 |
| POST | `/v1/sessions/{id}/checkpoint` | Session | Checkpoint |
| GET | `/v1/sessions/{session_id}/checkpoints/{checkpoint_id}` | Session | 指定历史检查点笔记、引用与保存时间；context.read，包状态 not-checked，不作为原请求回执 |
| POST | `/v1/sessions/{id}/checkpoint/receipt` | Session | 本人原始保存请求的只读回执，不检查包有效性 |
| POST | `/v1/sessions/{id}/handoff` | Session/Memory Adapter | HandoffRef |
| GET | `/v1/sessions/command-context` | Session | 只读可信当前身份/到期/权限提示；不查询目录或业务回执，见 session-command-context-runtime.md |
| POST | `/v1/handoffs/{id}/claim` | Session | 带键领取按原版本保存持久 claim_receipt；旧无键路径保留 |
| GET | `/v1/handoffs/{handoff_id}` | Session | context.read 精确读取当前交接及所属会话/检查点；不构成原请求回执，见 handoff-read-runtime.md |
| POST | `/v1/handoffs/{id}/claim/receipt` | Session | 本人原领取参数和键的只读历史回执，仍需领取权限 |
| POST | `/v1/sessions/{id}/resume` | Session/Context | ResumeReceipt |
| POST | `/v1/sessions/{id}/resume/receipt` | Session | 按原身份/请求键核对交接与子会话的只读回执 |
| POST | `/v1/sessions/{id}/end` | Session | ended Session |
| POST | `/v1/sessions/{id}/commands/receipt` | Session | 本人原 run.start/run.finish/tool.call/tool.finish/end 请求的只读历史回执 |
| GET | `/v1/context-pack` | Context | JSON/Markdown/MCP-ready pack |
| POST | `/v1/context-pack/compile` | Context | 持久化 ContextPack 与同步游标 |
| POST | `/v1/context-items` | Context | 新建待确认来源条目的回执 |
| GET | `/v1/context-items/{item_id}` | Context | 当前可见来源条目 |
| POST | `/v1/context-items/{item_id}/update` | Context | 按版本编辑条目 |
| POST | `/v1/context-items/{item_id}/archive` | Context | 按版本归档条目 |
| POST | `/v1/context-items/{item_id}/confirm` | Context Approval | 人工确认 proposed 版本并保存理由 |
| GET | `/v1/conflicts` | Conflict | 元数据分页，默认 25/最多 100，完整值单独读取；见 conflict-registry-runtime.md |
| GET | `/v1/conflicts/{conflict_id}` | Conflict | 独立完整详情；十进制版本与 JSON 文本值，见 conflict-read-runtime.md |
| POST | `/v1/conflicts/{id}/resolve` | Conflict | 保存决策；固定原请求客户端复用此路由，写响应仍需原回执确认，见 [提交说明](conflict-submission-runtime.md) |
| POST | `/v1/conflicts/receipt` | Conflict | 原 identity/request_key/完整有效 command 的只读回执；见 conflict-receipt-runtime.md |
| GET | `/v1/conflicts/commands/context` | Conflict | 已验证且未过期的 resolver 原身份；不读目录/详情/回执，见 conflict-recovery-runtime.md |
| POST | `/v1/proposals/{id}/confirm` | Approval | verified 状态 |
| POST | `/v1/proposals/{id}/reject` | Approval | rejected 状态 |
| POST | `/v1/proposals` | Intelligence | 持久化待审核建议回执 |
| GET | `/v1/proposals` | Intelligence | 筛选与分页摘要 |
| GET | `/v1/proposals/submission-context` | Gateway Auth | 调用者自身身份、范围与提交前置条件协议版本 |
| GET | `/v1/proposals/{id}` | Intelligence | 正文、provenance、来源有效性 |

当前 API Gateway 已实现表中的项目状态/工作项上下文 GET 路由，以及 Session continuity POST 路由。项目状态和工作项上下文来自 Plane webhook 形成的 scoped projection，读取仍必须携带租户、工作区、项目、actor、client、trace 和 `context.read` capability；同名外部项目在不同 tenant/workspace/project scope 下不会互相覆盖。Session/Checkpoint/Handoff 的 scope、幂等、版本和 claim-once 规则由 `@planemem/session-service` 负责，网关只负责 HTTP 路由、策略和审计。

`GET /v1/projects/{id}/state` 与 `GET /v1/work-items/{id}/state` 返回持久 Plane 观察快照的版本、状态、字段和 source refs；均强制 Bearer token、scope 和 context.read，并关联源事件、同版本索引及当前项目校验可见性，不回退内存。工作项 ID 为 external_id 或 aggregate_id，与工作台本地 ID 区分。`GET /v1/work-items/{id}/context` 返回同类快照及本地摘要/可选 ai-memory recall；兼容字段 context_pack 是命中集合，不是持久 ContextPackReceipt。外部无分类记忆要求 restricted 读取权限，可选失败时标 degraded，必需依赖则失败。详见 [Plane 观察状态持久读取](observed-state-runtime.md)，本批未做运行验证。

当未配置 `DATABASE_URL` 时，网关使用进程内的 `session-service`，适用于离线 fixture。配置 `DATABASE_URL` 后，网关启动前从 PostgreSQL 恢复 Session、AgentRun、ToolCall、Checkpoint 和 Handoff，成功写入后再返回响应；`010_session_continuity_persistence.sql` 提供幂等键、检查点和交接表。Helm Service 仍使用 `ClientIP` 会话亲和降低同一运行期的跨副本路由漂移，但数据库是重启恢复的权威来源。生产验收必须验证迁移、跨租户 scope、并发版本冲突和备份恢复。

## 写入规则

会话运行/工具明细 GET 接口使用 context.read，按项目范围读取持久记录，默认 25、最多 100 条。运行使用 before_sequence，工具记录使用 before_id 并保留可选 run_id；记录状态不代表客户端当前执行状态。见 [会话活动明细](session-activity-runtime.md)，027 索引迁移未执行。

运行追加、工具调用追加和结束会话已增加行锁、版本校验及业务/回执原子提交；均要求稳定请求键，新增 session_version 表示原写入后的会话版本。026 迁移仅开发未执行，详见 [会话进度命令](session-command-runtime.md)。

检查点支持 `context_pack_id` 绑定持久包，与旧内嵌 `context_pack` 互斥；续接返回包检查状态，有效绑定返回完整包回执。绑定写入和续接要求额外上下文读取授权，在同一事务内核对包/来源后写入；旧哈希仅为未验证历史信息。024 迁移未执行，详见 [检查点上下文绑定](checkpoint-context-runtime.md)。

Proposal 提交、读取和审核已开发，详见 [Proposal 运行时说明](proposal-runtime.md)。审核必须具备签名 human 身份、`proposal.review`、请求键及当前 expected_revision。018 迁移仅写入文件；审核不会直接改变 Plane 或 ContextPack。

Proposal 创建可选 derived_from（原 proposal_id/revision）保存独立修订关系：检查原建议可见性和版本，重新绑定新来源，保持分类下限；新建议仍 proposed，原决定不变。关系复用 provenance JSONB，无需新增存储列，最多 32 次派生；列表/详情/审核/回执/同步共同检查关联链可见性。未执行编译、测试或发布，分页索引增补见下文。

Proposal 列表新增可选查询参数 derived_from（原建议 ULID 字符串），与 status/kind/before/limit 组合查询可见直接修订；不递归列出全部后代，不返回隐藏计数。SDK/CLI/MCP 和工作台同步接入共享查询解析器。023 派生分页索引迁移仅新增文件，尚未执行。

worker 持久提交队列在写入前请求 `/v1/proposals/submission-context`，用同一令牌核对 actor/client 与项目范围。此端点要求有效客户端身份，无查询参数，返回 WCP envelope、空 source_refs，以及 data 中的 identity_preconditions=1、actor_id/client_id/tenant_id/workspace_id/project_id；不返回凭据或内容，也不授予写权限。已验证令牌的路由接受可选 `X-Expected-Actor-Id` / `X-Expected-Client-Id`，与已验证身份不符返回 DENIED，不能用这些头覆盖身份。队列发送两者并固定原请求键，见 [worker 说明](../../../workers/intelligence/README.md)。

ContextItem 的字段、版本、请求键和归档语义见 [ContextItem 运行时开发说明](context-item-runtime.md)。写入使用 `context.write`，读取使用 `context.read`；新建和编辑不授予事实确认状态。新增 017 迁移目前仅写入文件，未执行。

ContextItem 列表通过 `/v1/workbench/query`、`operation=context` 提供 cursor/limit 分页，默认 25、最多 100 条；下一页使用响应外层的字符串 `next_cursor`，保留原筛选。单次查询不再代表全量数据。019 排序索引迁移仅写入文件，未执行。

归档列表显式传入 archived=true；`GET /v1/context-items/{item_id}/archived` 读取归档详情，`POST /v1/context-items/{item_id}/restore` 使用归档后的 expected_version 和请求键恢复为 excluded。前者 context.read，后者 context.write；restricted 权限照常检查。恢复约束和索引的 020 迁移仅写入文件，未执行。

上下文历史：`GET /v1/context-items/{item_id}/history?before_version=...&limit=25` 列出已记录版本；`GET /v1/context-items/{item_id}/versions/{version}` 读取单份历史快照，均要求 context.read，且历史与当前分类同时可读。021 历史表迁移仅写入文件、尚未执行；新条目写入依赖该表，历史详情不提供当前版本 ETag。

上下文确认：`POST /v1/context-items/{item_id}/confirm` 要求签名 human 身份、有效客户端、context.review、原 expected_version、理由及请求键。确认只接受未过期 proposed 内容，本地来源链须为同项目可见、已确认的固定版本；成功增加版本并保存确认历史。当前 GET 增加 confirm_allowed/confirmation 和 sources_current/source_check，历史详情也可读取确认元数据。022 迁移仅写入文件，未执行；后续条目编辑会撤去当前确认。来源使用时递归检查已接入确认、Proposal 及持久 ContextPack，后台级联通知仍待开发，见 [来源链说明](context-source-runtime.md)。

持久化 ContextPack 的路由、请求键、预算、到期及来源失效规则见 [ContextPack 运行时开发说明](context-pack-runtime.md)。这两条路由使用令牌身份及 `context.read`，编译额外要求客户端身份；GET 可传 `pack_id` 和 `format`。该代码依赖新增的 016 迁移，目前仅完成开发修改，未执行迁移、编译或测试。

- 先检查 Policy，再检查 idempotency，再检查 expected_version；
- 成功写入生成 Canonical Event；
- Plane 变更先为 observed，只有有效 Plane response/webhook 才确认；
- 版本不匹配返回 409 并生成 ConflictDetected；
- 响应包含 `trace_id`、`schema_version`、`revision`、`etag`、`server_cursor`、`source_refs`。

## 错误封套

```json
{
  "code": "WORK_ITEM_VERSION_CONFLICT",
  "message": "工作项版本已经发生变化",
  "details": {"expected_version": 18, "current_version": 19},
  "trace_id": "trace_01",
  "retryable": false
}
```
