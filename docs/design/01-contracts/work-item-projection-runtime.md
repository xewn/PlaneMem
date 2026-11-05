# 工作项投影详情（开发状态）

## 2026-11-05 P0-01 完整机器模型

新增[work-item-projection Schema](../../../packages/contracts/schemas/work-item-projection.json)和包子路径，完整描述统一查询work_items/work_item的原请求/规范筛选、本地保存记录/来源、两种游标内容及内置/SDK封套。版本保留正int64字符串；原ID不强制ULID，不新增保存文本/来源的控制字符或字节限制。规范原记录去扩展，SDK外层来源只验证并保留扩展，可接受Mock来源，不强行等于postgres表来源。

人工源码对照澄清：默认SQL为updated_at DESC、id（数据库默认排序规则），仅due_asc明确id COLLATE C；两者都使用原微秒位置，不能用显示时间重建。共享完整页核对分类/owner/assignment/日期条件和重复ID/数量/续页，不独立核对搜索子串或排序。内置HTTP没有SDK8KiB请求、2MiB候选和30秒每次等待限制，也没有MCP/Mock的专用并发槽；输入/输出和不同消费边界在Schema分开记录。整条workbench入口其余操作仍需模型，不计新增OpenAPI路由；P0-01/R001未完成、evidence为空。仅人工源码文档审阅/指定格式/Git文本检查，未编译、测试、运行校验器/生成器/SDK/API/数据库或发布。

## 2026-11-04 保存截止日期排序增量

工作项列表新增 `sort=updated_desc|due_asc`。省略、空串及显式updated_desc统一规范化为原默认，保持更新时间倒序/ID升序以及原v1–v4筛选绑定和位置编码。MCP未使用时省略或明确updated_desc，不接受空串。due_asc按保存due_at从早到晚，null统一放在最后；同一截止时刻按本地ID升序。排序不自动排除已完成/取消/无日期项目，不读取当前时间、不表示逾期或实时Plane状态。

Gateway在权限和全部筛选之后、LIMIT之前执行 `due_at ASC NULLS LAST, id COLLATE "C" ASC`。续页使用数据库原微秒时间及C顺序ID：有日期位置之后读取更晚日期、相同日期更大ID及null；已经进入null区段时，只读取更大ID的null记录。位置由专用v2编码固定due_asc、微秒UTC日期或null以及本地ID，不使用客户端显示精度构造续页，拒绝非规范base64url、非法日期/ID及其他位置版本。需要续页的保存日期须可表示为0001–9999年有效微秒UTC时间，否则整页拒绝，不发出无法继续的游标。记录本身的时间格式仍按原投影返回，显示时间相同不代表数据库微秒完全相同。

due_asc查询键使用v5，固定原范围/受限数据可见性及所有搜索、状态、优先级、负责人、分配、日期条件和排序。续页应原样保留排序与条件；改变排序须去掉cursor回首页，limit仍可调整，trace不参与绑定。默认排序不会使用新位置。Mock使用独立v3绑定/v2位置，预存按微秒及Unicode标量ID排序的目录，同样把null放在末尾；默认Mock仍保留v1/v2绑定，生产与Mock游标不可交换。

SDK listWorkItemProjections/workItemPages、CLI work-items list JSON、MCP list_work_item_projections都接受sort，仍沿原有界输入/完整页校验/期限。示例（未执行）：`{"sort":"due_asc","status":"todo","due_before":"2026-12-01"}`。Web下拉选择最近更新或截止日期升序，提交从第一页开始；看板各列保持当前结果相对顺序，列表是整页顺序，卡片/表格显示原保存日期或No due date。换视图、选择任务、详情return_to、错误原页重试及原条件第一页保留排序，清除筛选也保留当前排序。无日期筛选与due_asc可组合，此时全部条目仅按ID升序。

排序由Gateway/Mock执行，客户端不对单页重新排序，也不从显示精度证明数据库细粒度顺序；共享解析仍核对完整记录、过滤、重复ID、页大小及续页结构。读取之间记录可能修改/删除，不提供跨页一致快照、自动去重、预取或后台遍历。本任务无新路由/数据库schema/迁移/索引/依赖，仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行产品/SDK/CLI/MCP/Mock/API/SQL/浏览器或发布；真实SQL性能、null/微秒续页、兼容和导航证据仍待补，R-002未完成、evidence为空。

## 2026-11-04 保存截止日期筛选增量

列表共享查询新增 `due=scheduled|unscheduled`、`due_from` 和 `due_before`。scheduled只要求保存的due_at非null，unscheduled只匹配null；不等同于已安排工作流、已完成或逾期。两日期必须是真实 `YYYY-MM-DD`（0001–9999年），拒绝无效闰日、零年、时间/偏移后缀、空白、数组和其他类型。省略或空串表示不使用该字段；MCP schema不接受空串，未使用时省略。unscheduled不能与任一日期边界共用；同时给出两日期时必须due_from早于due_before。

due_from是指定日期UTC零时的包含下界，due_before是指定日期UTC零时的不包含上界，区间自动排除无日期记录。只设置一侧表示开放区间，不读取客户端/服务器当前日期、不自动隐藏done/cancelled，也不改变原due_at。例如 `{"due_from":"2026-11-01","due_before":"2026-12-01","status":"todo"}` 只选UTC 2026年11月范围内的待办；`{"due":"unscheduled","assignment":"unassigned"}` 查无保存截止日期且无保存负责人的记录。若要包含结束日整天，应传入下一日作为due_before；接口不自动改写边界。

Gateway在原权限和未删除条件下，LIMIT/前瞻之前用参数化 `due_at IS [NOT] NULL`、`>= UTC零时`、`< UTC零时` 筛选，其他筛选仍AND组合。更新时间倒序/ID升序、25默认/100上限及现有响应预算不变。共享完整页校验逐项核对null/区间；错误条目整页失败，不在客户端删项或缩页。日期边界只到零时，已有毫秒/微秒记录在日边界两侧保持相同筛选含义；输出保留原时间值，不新增时间格式迁移。

生产分页键含任一日期新条件时使用v4并固定原范围/可见性/搜索/状态/优先级/负责人/分配条件及全部日期条件；无日期新条件时保持原v1–v3键。续页必须带回相同条件，改变有无日期或任一日期须去掉cursor回首页。Mock使用独立v2日期绑定并复用共享匹配在分页前过滤，无新条件保留独立v1绑定；生产与Mock游标不能混用，limit仍不参与绑定，跨页没有快照承诺。

SDK listWorkItemProjections/workItemPages、CLI work-items list JSON及MCP list_work_item_projections都支持新字段。Web新增有无截止日期和两个明确标注UTC的日期输入；选择无日期清空并禁用区间，切回不会恢复旧区间。只改控件不查询，提交从第一页开始；看板/列表切换、下一页、选择任务、详情return_to及错误原页重试保留新条件，错误页“原条件第一页”仅清除游标/选择。非法日期/互斥组合仍在读取前拒绝，详情外部返回地址限制保持。

区间核对要求返回的保存due_at为带明确Z或数值时区偏移的ISO时间，不用当前机器时区解释无时区旧字符串。真实Gateway输出和Mock种子已有明确UTC时间；带日期区间时，旧无时区fixture/自定义传输响应会整页拒绝，需提供明确时区。仅有无日期筛选不改变原实体时间接受范围。

本任务无写命令、新路由、数据库schema/迁移/索引或依赖变化，仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行产品/SQL/API/SDK/CLI/MCP/Mock/浏览器或发布。真实UTC边界、完整页核对、查询性能、客户端/游标兼容和浏览器导航证据待补，R-002仍未完成、evidence为空。

## 2026-11-04 工作台读取与失败恢复增量

Web `listWorkbenchWorkItems`、`getWorkbenchWorkItem`以及现有 `queryWorkbench` 的 work_items/work_item 分支共用专用有界响应读取。等待会话前复制并规范化原查询，规范请求正文最多8 KiB；身份来自当前会话，仍仅一次POST /v1/workbench/query，no-store、redirect=error，不自动重试或翻页。读取沿既有30秒AbortSignal及绝对期限，覆盖网络等待、正文与完整解析；会话获取在该期限之前，同步解析不能中途抢占，结束后再次核对期限和会话到期。

完整成功HTTP 200，解码正文最多2 MiB；400–599错误最多16 KiB。要求JSON类型、正确x-trace-id、无ETag，正文另受普通JSON深度/节点/规范化字节约束。成功外层只允许schema_version/trace_id/source_refs/data及列表next_cursor；验证来源、共享完整记录、详情原目标或列表大小/重复ID/状态/优先级/精确负责人/分配条件/续页。记录可选范围字段必须匹配当前请求，版本、记录来源和记录trace保持其原含义。超限、错目标/trace或不完整记录整份失败，无截断正文或部分页。共享解析不重做数据库locale搜索排序，也不验证外部来源真实性。

错误只展示固定文案和本次trace，不回显远端message/details。HTTP 401直接要求登录并取消正文；发送前和读取结束后检查当前会话快照到期，错误读取或网络失败时已到期也要求重新登录。正文读取使用现有有界流读取与取消，不能把本地超时解释为服务器查询或审计已撤销。Web不从未验证的JWT字段推断context.read或restricted权限，仍由Gateway鉴权、Policy/Audit及数据库可见性负责；原投影没有强制范围回显，不把内容检查当作权限证明。

列表错误页仅在原浏览参数验证成功时提供显式GET“Retry this page”，保留q/status/priority/owner/assignment/due/due_from/due_before/cursor/view/item；“First page with these filters”保留筛选和视图、清除旧游标及选择，适用于原游标因账号/项目/筛选绑定变化被拒绝的情况。非法参数仅提供固定重新浏览入口。详情继续按已验证item/return_to重试并返回原列表或搜索位置，缺失与不可见仍同样处理。没有新增自动恢复或后台分页。

本增量无新路由/数据库/schema/依赖；仅源码文档人工审阅及格式/文本检查，未编译、类型检查、测试、执行Web/API/浏览器/数据库或发布。真实鉴权、期限/超限、错误映射、原导航恢复及旧响应兼容证据仍待补，R-001/R-002保持未完成、evidence为空。

2026-11-04：SDK已另补可选[工作项目录与详情Mock](work-item-mock-runtime.md)，用固定数据集、模拟权限和独立游标接入现有列表/详情方法。没有真实数据库、Plane来源刷新或权限审计，生产游标与Mock游标不能互换；仅源码文档，未运行验证。

2026-11-02：本批仅修改源码和文档，未编译、类型检查、测试、运行服务、执行迁移或发布。不代表已有运行验证。

## 读取入口

`POST /v1/workbench/query`，正文为 `{"operation":"work_item","item_id":"本地工作项 ID"}`。复用令牌鉴权、context.read 策略、审计和限流；不要求写客户端或请求键。范围由令牌和当前项目确定，不能通过正文指定其他项目。

item_id 是 `wcp_work_items.id`，不是 Plane external_id；允许非 ULID 标识，要求 1–255 字符，无首尾空白或控制字符。详情拒绝未知字段、数组、空 ID。一次查询按 tenant/workspace/project/id 读取未删除记录，缺少 data.restricted.read 时排除 restricted；缺失、已删除、跨项目或不可见统一返回 WORK_ITEM_NOT_FOUND / HTTP 404。损坏的投影返回 WORK_ITEM_PROJECTION_INVALID / HTTP 500，数据库不可用返回 503，不退回内存数据。

响应保留 WCP schema_version/data/trace_id/source_refs 封套。data 为共享类型 WorkItemProjection，含本地 ID、外部 ID、标题、状态、优先级、负责人、进度、描述、到期时间、分类、创建/更新时间、记录 trace_id/source_refs 和 version。version 是无损正十进制字符串，范围为 PostgreSQL 正 BIGINT；列表也增加同格式 version。详情解析器核对所请求 ID、字段、状态、版本和引用。数据库 Date 在返回前转为时间字符串。

所有 workbench.query 读取绕过进程内幂等响应缓存，即使客户端误带请求键，也重新检查可见性并读取当前投影。HTTP 响应继续 private, no-store。

## 列表分页补充

`POST /v1/workbench/query` 的 `operation=work_items` 现支持query/status/priority/owner/assignment/due/due_from/due_before/sort/cursor/limit。默认25条，每页1–100条；query最多500字符，搜索external_id/title/owner，空可选筛选字段表示不过滤、空sort表示默认。共享parseWorkItemListQuery拒绝未知字段和非法筛选/排序/游标，日期及排序规则见上方增量；SDK/CLI/Web使用同一规范化逻辑，MCP不用的可选字段省略。

响应 data 仍是数组，条目增加 created_at 并与详情使用相同字段验证。存在后续数据时在外层返回 next_cursor；调用方把它作为下一次 cursor，并保留查询、状态、优先级和负责人条件。没有 next_cursor 即当前读取结束，不能把单页条数当项目总数。SDK `listWorkItemProjections`、CLI `work-items list`、MCP `list_work_item_projections` 均接入；共享响应解析验证页大小、重复 ID、所选状态/优先级/负责人和游标形状。

按 updated_at 降序、id 升序读取 limit+1 条，游标保留数据库微秒时间，并绑定租户、工作区、项目、restricted 可读权限和规范化筛选。跨范围或换筛选使用旧游标返回 INVALID_INPUT，必须回到第一页；limit 可调整。游标是位置描述，不是授权凭据，每页均重新检查范围和可见性。此分页不是快照：并发更新、删除或权限变化可能使记录移动或当前页为空。

工作台看板/列表标注“当前页”，选中任务和视图切换保留当前位置；翻页清除当前选择，筛选提交从第一页开始。错误页提供重新浏览入口。概览工作项总数、各状态和完成比例使用 overview 汇总，不再按预览页计算；预览最多五项，明确标注最近更新。后续上下文统计、有限预览和页面说明见 [项目概览读取](workbench-overview-runtime.md)。

新增 `030_work_item_pagination.sql` 为有/无状态筛选提供活动记录分页索引，仅新增文件，未执行。未编译、类型检查、测试、启动服务或发布。

### 优先级与负责人筛选（2026-11-04，仅源码）

priority 只接受 `P0/P1/P2/P3`，大小写精确。owner 是本地投影中保存的负责人文本，最多 255 个 JavaScript 字符单位，不是令牌 actor_id 或账号目录查询；空字符串表示不过滤，纯空白、控制字符、DEL、孤立代理字符、数组、null 和超长文本拒绝。非空 owner 保留原文，首尾空格、大小写、Unicode 组合形式均不归一化。使用参数化 `COLLATE "C"` 相等条件，`%`、`_`、引号等是普通文本，没有通配或 SQL 含义。空负责人专门筛选见下节assignment增量。

所有筛选以 AND 组合，在权限过滤后的数据库查询中、LIMIT 和前瞻之前生效。返回的整页再复用共享解析逐项匹配；出现错状态、错优先级或错负责人时整页返回 `WORK_ITEM_PROJECTION_INVALID`，不在客户端静默删项。SDK、网络 CLI、Web 本身也使用共享结果解析；嵌入 CLI/MCP 接收 Gateway 已校验结果。不新增路由、写入、来源检查或权限承诺。

新增筛选非空时，查询摘要使用 `work-item-list-v2` 并包含原 query/status、priority 和完整 owner。没有非空新增筛选时保持原 `work-item-list-v1` 摘要，旧无新增筛选的游标仍可继续；游标外层编码版本、时间精度和位置结构保持。增加、移除或改变任一非空新筛选均不能沿用旧游标；错误提示从第一页重启。limit 仍可调整，不纳入该目录绑定，与原接口一致。

网页新增优先级下拉框、负责人精确输入及匹配说明。首次/下一页、任务选择和看板/列表切换均保留筛选，提交或清空筛选会丢弃旧 cursor 和选择；清空保留当前视图。仅按新字段筛选时也显示“清空筛选”和匹配为空提示。重复/未知 URL 参数和未知视图拒绝，不能通过数组隐式选择另一种筛选。输入使用已有可换行筛选布局。

开发调用形状（未执行）：SDK `listWorkItemProjections({status:'blocked',priority:'P0',owner:'Alice'})`；CLI `workctx work-items list --json-file filters.json`，原文件内容 `{"priority":"P0","owner":"Alice"}`；MCP `list_work_item_projections` 使用相同字段。续读时保留这些字段并带回 next_cursor。

本次只修改源码和文档，没有编译、类型检查、测试、调用 API/CLI/MCP、浏览器检查、数据库访问或发布。没有新增索引/迁移/依赖，原 030 等迁移状态保持未执行。组合筛选在真实数据规模下的性能、大小写/空格/Unicode 边界、旧游标兼容、客户端与网页导航均待运行证据，不宣称已验证。

### 负责人分配状态筛选（2026-11-04，仅源码）

新增可选`assignment: 'assigned' | 'unassigned'`和共享枚举WORK_ITEM_ASSIGNMENTS。共享解析接受省略或空串为不过滤，拒绝其他大小写、空白、null、布尔和数组；MCP schema只接受两枚举，不筛选时省略字段。`unassigned`严格对应本地保存的owner为空串，`assigned`对应非空字符串，SQL使用`COLLATE "C"`空串比较；原表owner为NOT NULL，不把损坏null、纯空白或占位名字自动改写成未分配。此字段只描述投影保存情况，不认证账号有效性或当前Plane分配。

unassigned与非空精确owner互斥，整份查询在读取前拒绝；owner空串仍表示省略，可以与unassigned使用。assigned可与精确owner组合，并与原query/status/priority全部按AND筛选。数据库先按权限及筛选取LIMIT+1，完整结果解析再逐项核对空串/非空条件，不静默丢弃错项。SDK、网络CLI和Web沿共享输入及响应解析；嵌入CLI/MCP沿Gateway查询。后续独立Mock增量已加入同一筛选的模拟读取，见上方说明，不替代真实运行证据。

含assignment时查询摘要采用`work-item-list-v3`，固定原范围、受限数据权限、query/status/priority/完整owner及assignment。省略或规范化为空时保留原v1/v2摘要和游标编码，旧筛选可继续；添加、移除或改变assignment必须回第一页，即使精确owner令结果集合相同也不复用旧条件游标。页大小仍可调整，分页仍非一致快照。

工作台提供All assignments、With saved owner、Without saved owner选项。选择Without saved owner会清空并禁用精确owner输入，切回其他选择不会恢复被清空的名字；只改表单本地状态，提交GET才读取。应用/清空筛选从首页开始，选择任务、下一页、视图切换和详情return_to保留assignment；直接URL中的互斥条件、重复或非法参数在查询前拒绝。单独分配筛选也显示清空入口和匹配为空提示，页面数量继续只表示当页。

开发示例（未执行）：SDK `listWorkItemProjections({assignment:'unassigned',status:'todo'})`；CLI `workctx work-items list --json-file filters.json`，内容`{"assignment":"unassigned","priority":"P0"}`；MCP `list_work_item_projections`使用相同字段。下一页保留全部条件并传回next_cursor；CLI帮助及输入白名单已同步。

仅源码文档人工审阅，未编译、类型检查、测试、执行CLI/SDK/MCP/Mock/API/产品/浏览器/数据库或发布。无新数据库schema、迁移、依赖、写入或来源刷新；输入边界、空串/空白区别、互斥组合、SQL筛选、整页错项拒绝、v1/v2/v3游标、真实客户端及Web返回导航仍待运行证据，R-002保持未完成。

## 工作台详情返回路径（2026-11-04，仅源码）

工作项看板/列表的详情入口新增`return_to`，保存原q/status/priority/owner/assignment/due/due_from/due_before/cursor/view和当前详情item。共用work-items/navigation.ts解析浏览参数、构造内部列表/详情链接；显式item始终按本地ID契约验证，无效ID不再渲染不可用选择链接。默认首项进入详情时也显式保存该选择，页外选中项仍可独立读取并返回原页。

详情的“Back to results”回到原视图、筛选和分页位置。从工作项目录进入时，“Open in board/list”只改变视图，保留其余条件。刷新详情及读取失败后的显式重试均使用原 item 与已规范化 return_to；404、权限或网络读取错误仍提供原结果返回链接，不用其他项目或工作项替换失败目标。缺少 return_to 的旧详情链接继续可用，返回默认看板并保留所选 item。全局搜索已接独立返回分支，保留搜索查询/筛选/分页和所选工作项；切换工作项看板/列表时使用默认目录条件，不推断搜索条件与目录筛选等价。

return_to 允许字面 `/work-items` 或 `/work-items?` 后的已知参数，也可使用 [项目搜索导航](project-search-runtime.md) 规定的 `/search?` 路径，均最多 16384 个 JavaScript 字符单位。拒绝外部/协议相对/其他路径、片段、重复/未知字段、数组、非法视图/筛选/游标及与详情 item 不同的选择。解析后从固定内部路径重新构造 URL，所有值通过 URLSearchParams 编码；不直接展示任意输入路径、不自动重定向。工作项目录省略返回选择时使用本次详情 item；搜索返回必须明确绑定 work_item 类型及相同 ID。无效返回参数在数据读取前拒绝，错误页仅提供固定工作项列表入口。

导航不保存结果快照、记录内容、令牌或身份，不写浏览器存储；返回后仍重新读取当前权限范围。原游标若因项目/权限变化失效，列表保留原有重新浏览入口；导航不能证明原记录仍在原页或来源仍有效。筛选提交/清空和实际翻页继续清除原选择；详情刷新不修改原列表位置。

本次仅源码与文档，未编译、类型检查、测试、浏览器检查、接口调用或发布；API/数据库/依赖不变。待运行证据包含从后续页/不同视图返回、精确负责人空格与 Unicode、页外选择、直接旧链接、刷新/失败重试、非法返回地址与重复参数、跨项目/权限变化后的游标拒绝。

## SDK 与其他读取入口

### SDK 有界读取和按需分页（2026-11-04，仅源码）

`listWorkItemProjections(query?, options?)`和`getWorkItemProjection(itemId, options?)`新增`WcpWorkItemReadOptions={timeout_ms?,signal?}`，旧调用参数仍可省略。每请求默认30秒，timeout_ms必须是1–2147483647的安全整数；预先取消时不派发，等待中取消或到期停止本地等待并拒绝迟到结果。Fetch自身期限与方法期限取先到者，覆盖凭据、网络、完整读取和解析；同步解析不能被中途抢占，返回前再次检查期限。终止等待不证明服务器读取或审计被取消。

请求固定POST workbench.query、原operation/本地ID或规范筛选，JSON最多8 KiB。只携带当前范围、trace及构造上下文已有actor_id/client_id的相等条件；不继承idempotency_key/expected_version/if_match。身份条件要求真实服务端核对，不授予权限；若需要在凭据刷新时固定账号和客户端，须在WcpClient上下文显式配置两者。未提供的身份条件不能被SDK补造。原投影封套没有范围回显，SDK不以记录内容证明服务器授权。

成功完整JSON最多2 MiB，Fetch错误正文最多16 KiB；自定义transport也必须支持bounded-json/signal，SDK在返回后仍独立检查普通JSON大小/复杂度并复制。外层只接受schema_version/trace_id/source_refs/data及列表可选next_cursor；trace必须等于本次请求，详情不接受续页字段。列表继续复用共享页/条目/状态/优先级/精确owner/assignment/重复ID/游标校验；详情核对本地ID。记录若额外携带范围字段，必须匹配当前上下文。记录原version、时间、来源和trace保留，不把外层trace覆盖到记录内。超限、坏条目或错trace整份失败，不返回部分页面。错误只保留固定允许代码和本次trace，retryable=false，不回显传输底层消息。

普通查询/选项对象会在等待前复制，拒绝未知字段、非普通对象、访问器、符号或隐藏字段；已有可选查询属性值为undefined仍表示省略。传输请求正文与保留的查询条件也是不同副本，传输修改正文不能放宽返回校验。返回结果与transport原对象分离。旧自定义传输/fixture若返回Date、undefined属性、错trace、扩充封套或超限内容，需改为完整匹配的JSON封套；本增量没有宣称这些旧消费者已迁移或验证。

新增显式`workItemPages(query?, options?)`异步迭代器，options为`WcpWorkItemPagesOptions`，在读取选项上增加max_pages。创建时固定上下文、全部规范筛选、初始cursor、limit、期限值及signal引用；创建无网络请求或计时器，参数错误在创建时同步抛出。第一次next才请求第一页，每次next最多一笔请求，没有预取。每页独立预算，消费者处理页面的时间不计入下一页预算；修改原参数/选项或已返回页的next_cursor不会改变后续请求。需要中断正在等待的next时使用AbortSignal；return或break本身不是中断正在进行请求的接口。

max_pages默认100，允许1–1000；limit仍默认25、最多100。完整页在yield前保存原续页游标；无游标时自然结束。已返回max_pages页且仍有续页时，下一次next报WORK_ITEM_PAGE_LIMIT，且不会再发送请求；上次完整页的next_cursor仍可由调用方保存，并配合原筛选显式启动新的单页读取或迭代器。上限不是“所有结果已读完”，不得捕获后把部分集合标记为全量。每次迭代保留有界游标集合，重复使用起始位置或先前续页游标时整页拒绝，避免循环请求。

目录仍是动态读取，不保证跨页快照、源数据新鲜度或唯一遍历。并发更新可能让同一ID在不同页出现，SDK不静默去重或重排，也不使用客户端语言规则复核数据库全文匹配和ID排序。迭代器不合并全部记录、不自动重试/保存/确认；调用方需要自行保留已处理页及原筛选。单页和详情方法仍只发送一笔读取，不因出现next_cursor自动继续。

开发示例（未执行，client由调用方配置）：

```ts
const controller = new AbortController();
const filters = { assignment: 'unassigned' as const, limit: 25 };
const page = await client.listWorkItemProjections(filters, {
  timeout_ms: 15_000,
  signal: controller.signal,
});
const detail = await client.getWorkItemProjection('local-work-1', {
  signal: controller.signal,
});
const pages = client.workItemPages(filters, {
  timeout_ms: 15_000,
  signal: controller.signal,
  max_pages: 20,
});
// 每次next才读取；result.value为完整封套，value.next_cursor可连同filters保存。
const result = await pages.next();
await pages.return(undefined); // 没有预取下一页。
```

MockWorkItemStore沿现有bounded-json和取消信号接入，无新增Mock路由。CLI单页/详情及MCP专用读取的后续适配见下文；Web未增加这些SDK选项或遍历命令，生产REST/共享投影/数据库/依赖不变。仅源码文档人工审阅，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布；真实取消/迟到/超限/错误、旧传输兼容、重复游标/页数上限及分页消费仍待运行证据，R-001/R-002保持未完成且evidence为空。

### 命令行有界读取（2026-11-04，仅源码）

`workctx work-items list/get`的真实网络main、程序调用callGateway和嵌入runWorkctx现统一经过专用适配，复用上述SDK单页/详情方法。新增`--timeout-ms`，默认30000，范围1–2147483647，拒绝空值、负数、小数、指数表示及前导零。成功stdout仍是完整WCP封套，最多2 MiB；网络错误正文最多16 KiB，错trace/目标/条目/筛选/超限均整份失败，不输出部分成功。USAGE_ERROR退出2，其他读取错误退出1，成功退出0。

支持内联`--json`或`--json-file`二选一，每份原始UTF-8输入最多8 KiB；列表省略两者等价`{}`，详情仍必须提供item_id。文件复用稳定普通文件读取：打开后检查实际句柄及大小，读取后检查长度/修改时间/变化时间，损坏UTF-8/JSON/变化或超限拒绝，不修改文件。网络入口继续支持有界`--json -`，最多读8193字节以探测超限；嵌入入口不读取stdin。读取文件或等待stdin EOF在SDK期限之前，不宣称--timeout-ms会中断本地输入等待。

列表原query/status/priority/owner/assignment/cursor/limit及详情item_id保持原语义。CLI查询可额外携带成对`expected_actor_id`和`expected_client_id`：账号遵守SDK ULID规则，客户端为最多1024字符的非空无控制字符文本，必须两者同时提供。它们只转成SDK构造上下文和HTTP身份相等头，发送前从workbench查询正文剥离，不作为数据字段或授权。网络令牌仍由WORKCTX_ACCESS_TOKEN提供，每笔读取固定调用时令牌；不提供这对条件时不推断当前账号。续页需要账号连续性时，应保存原两值并保持不变。

嵌入入口复制可信上下文，要求authenticated_client=true、明确未到期token_expires_at和实际context.read能力；若查询提供预期账号/客户端，必须与该上下文完全相等。始终固定可信账号/客户端传入SDK，去掉上下文写键/版本，核对SDK路径、方法、全部头、完整原正文及响应模式后才调用router.execute；Router仍执行原Policy/Audit。派发前、返回后及完整解析后重查期限/能力，无data.restricted.read却收到restricted记录时整份DENIED，不静默删行。每router最多两笔嵌入读取，SDK超时后名额保留到实际Router读取结束；后来的调用可得到RATE_LIMITED，不排队重试。未认证、缺期限/能力或使用非ULID上下文的旧嵌入fixture需要显式迁移，未声称已完成兼容验证。

拒绝--key/--output/重复/未知选项、正文写条件和未知查询字段。成功数据保留原记录来源、版本、记录trace和外层本次trace；只执行一页或一条详情，不自动调用workItemPages，不保存文件、不重试。续页须保留全部原筛选和可选身份条件并传回外层next_cursor；换筛选时回首页。超限可减小limit重读当前位置，单条详情超限不会改读其他任务。动态目录和本地投影的来源限制保持，读取成功不等于全项目遍历完成。

开发命令形状（未执行）：

```text
workctx work-items list --timeout-ms 15000
workctx work-items list --json-file filters.json --timeout-ms 15000
workctx work-items get --json-file selection.json --timeout-ms 15000
```

filters.json示例为`{"assignment":"unassigned","limit":25}`；selection.json示例为`{"item_id":"local-work-1","expected_actor_id":"01J000000000000000000000004","expected_client_id":"editor"}`。未创建或执行示例文件。

本次只修改CLI源码和文档，MCP/Web/生产Gateway/数据库/schema/依赖不变；SDK先前开发的有界实现直接复用。未编译、类型检查、测试、执行CLI/SDK/Mock/API/产品/数据库或发布。真实网络/嵌入兼容、身份头、稳定文件/stdin边界、超限/超时/迟到/容量及退出码证据仍缺，R-001/R-002保持未完成。

### MCP 有界读取（2026-11-04，仅源码）

`list_work_item_projections`和`get_work_item_projection`改由专用executeWorkItemReadTool执行。tools/list、prepareMcpTool、直接执行器及HTTP tools/call的客户端要求保持一致：必须是schema_version=1、authenticated_client=true、有实际context.read、明确未到期token_expires_at及有效完整范围/账号/客户端/trace的上下文。admin角色不替代context.read能力，发现时可见不保证之后调用仍获授权；真实Router仍执行原Policy/Audit，父项目与记录可见性沿原数据库读取。没有注册新的工具名、REST路由或读取资源。

两工具内层arguments普通JSON最多8 KiB。列表字段为query/status/priority/owner/assignment/due/due_from/due_before/sort/cursor/limit，默认25最多100条，详情只接受本地item_id。复用共享解析及MCP schema语义：不用的枚举/负责人/日期省略，不能发送空串，sort可省略或显式updated_desc；unassigned不能与非空owner组合，unscheduled不能与日期区间组合。拒绝未知字段、写条件、范围、账号及CLI专用expected_actor_id/expected_client_id；身份只来自已验证MCP上下文，不接受参数覆盖。不提供工具内timeout或自动翻页选项，保留全部原筛选和排序显式传回next_cursor读取下一页。

参数和上下文先复制，清除继承idempotency_key/expected_version/if_match，只派发一次固定POST /v1/workbench/query，使用work_items或work_item操作。交给ApiGateway的请求是额外副本，不能通过Handler修改它来改变原查询或权限校验依据。prepareMcpTool只准备请求和检查权限/输入；完整预算与响应校验由dispatchMcp或专用执行器提供，直接自行调用api.handle不是本节的有界工具执行流程。

成功必须HTTP 200、JSON类型、正确x-trace-id且无ETag；只接受有界400–599错误封套及本次trace。完整成功业务JSON最多2 MiB、错误最多16 KiB，采用普通有限JSON快照与共享复杂度限制。外层只允许schema_version/trace_id/source_refs/data和列表可选next_cursor，详情不能携带续页；检查详情目标或整页记录、重复ID、状态/优先级/负责人/分配条件、页大小及续页结构。记录若附带范围字段，必须等于原上下文；原投影本身没有强制范围回显，不把内容校验当作授权证明。没有data.restricted.read却返回restricted时整份DENIED，不删掉记录后伪造成功页。

成功结果仍为MCP content中的一段JSON文本，文本内容是完整WCP封套，保留记录十进制版本、时间、来源/trace和外层本次trace。再次约束文本封套2 MiB及转义后的MCP result为4 MiB+4096字节；超限、错trace、错误条目/目标/筛选或非法返回整份失败，无部分成功、截断正文或减少条数。描述和来源仍是不可信保存资料，不认证外部来源或实时Plane状态；MCP不重做数据库locale文本搜索和ID排序。

每ApiGateway两工具共用两笔活动容量，固定30秒单调时钟预算覆盖输入、等待、完整解析和结果编码。第三笔返回MCP_WORK_ITEM_READ_BUSY；到期返回MCP_WORK_ITEM_READ_TIMEOUT。超时只停止外层等待，底层api.handle未结束仍占名额，结束后才释放；迟到结果不交付，不把超时解释为数据库读取/审计已取消。同步解析不能中途抢占，返回前重查期限及令牌权限。没有排队、自动重试、翻页、保存或写入。

错误使用固定允许代码、固定消息、本次trace和retryable=false，不回显底层异常、原错误details或数据。dispatchMcp沿既有工具错误包装返回isError=true；HTTP入口对缺少可信客户端仍可先行返回403。未知底层错误和损坏封套归为GATEWAY_RESPONSE_INVALID。普通MCP HTTP请求正文预算不扩容；这里限制的是工具arguments和结果，未提供新的跨请求取消协议。

未认证/缺期限/只有admin但无context.read的旧调用方不再可发现或调用这两工具；超限、额外封套字段、Date或undefined属性等旧fixture需迁移为完整规范JSON。开发调用形状（未执行）：`list_work_item_projections({assignment:'unassigned',status:'todo',limit:25})`及`get_work_item_projection({item_id:'local-work-1'})`。本次仅源码文档人工审阅，无共享契约/数据库/schema/依赖变化，未编译、类型检查、测试、执行MCP/API/产品或发布；真实授权/发现调用一致性、封套/错误/超限、到期/迟到/并发容量及旧客户端兼容证据仍缺，R-001/R-002保持未完成且evidence为空。

### 入口汇总

- SDK：`getWorkItemProjection(itemId, options?)`，共享输入/响应解析器，返回 WCP 封套；有界读取及取消见上节。
- CLI：`workctx work-items get --json-file work-item.json [--timeout-ms 30000]`，文件内容 `{"item_id":"本地 ID"}`，拒绝 --key；单页/详情大小与可选身份条件见上节。
- MCP：`get_work_item_projection`，输入 item_id，要求可信未过期context.read客户端，声明只读；完整限制见上节。
- 工作台：`/work-items/detail?item=...` 独立读取指定任务，展示描述、版本、时间和来源；刷新表单重新请求详情。来源 URI 作为文本展示，不自动访问。
- 看板/列表提供详情入口。显式指定 item 不在筛选结果中时，不选择另一条任务；保留原 ID 并提供独立读取入口。没有指定 item 时仍默认选择第一条。

这是本地保存的只读投影，不证明当前 Plane 状态或来源仍然有效。local version 不能用于 Plane If-Match；source_refs 是已记录证据，不表示已检查外部来源。get_work_item_context 和新增 get_work_item_state 已使用独立的持久 Plane 观察快照读取，使用 external_id/aggregate_id，见 [Plane 观察状态](observed-state-runtime.md)；两类投影尚不自动互相同步。本批没有新增 Plane 写入流程。单条读取复用 008 表，列表新增的 030 索引迁移仍未执行。
