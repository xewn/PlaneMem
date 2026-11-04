# 工作项投影详情（开发状态）

2026-11-04：SDK已另补可选[工作项目录与详情Mock](work-item-mock-runtime.md)，用固定数据集、模拟权限和独立游标接入现有列表/详情方法。没有真实数据库、Plane来源刷新或权限审计，生产游标与Mock游标不能互换；仅源码文档，未运行验证。

2026-11-02：本批仅修改源码和文档，未编译、类型检查、测试、运行服务、执行迁移或发布。不代表已有运行验证。

## 读取入口

`POST /v1/workbench/query`，正文为 `{"operation":"work_item","item_id":"本地工作项 ID"}`。复用令牌鉴权、context.read 策略、审计和限流；不要求写客户端或请求键。范围由令牌和当前项目确定，不能通过正文指定其他项目。

item_id 是 `wcp_work_items.id`，不是 Plane external_id；允许非 ULID 标识，要求 1–255 字符，无首尾空白或控制字符。详情拒绝未知字段、数组、空 ID。一次查询按 tenant/workspace/project/id 读取未删除记录，缺少 data.restricted.read 时排除 restricted；缺失、已删除、跨项目或不可见统一返回 WORK_ITEM_NOT_FOUND / HTTP 404。损坏的投影返回 WORK_ITEM_PROJECTION_INVALID / HTTP 500，数据库不可用返回 503，不退回内存数据。

响应保留 WCP schema_version/data/trace_id/source_refs 封套。data 为共享类型 WorkItemProjection，含本地 ID、外部 ID、标题、状态、优先级、负责人、进度、描述、到期时间、分类、创建/更新时间、记录 trace_id/source_refs 和 version。version 是无损正十进制字符串，范围为 PostgreSQL 正 BIGINT；列表也增加同格式 version。详情解析器核对所请求 ID、字段、状态、版本和引用。数据库 Date 在返回前转为时间字符串。

所有 workbench.query 读取绕过进程内幂等响应缓存，即使客户端误带请求键，也重新检查可见性并读取当前投影。HTTP 响应继续 private, no-store。

## 列表分页补充

`POST /v1/workbench/query` 的 `operation=work_items` 现支持 query/status/priority/owner/assignment/cursor/limit。默认 25 条，每页 1–100 条；query 最多 500 字符，搜索 external_id/title/owner，空 query/status/priority/owner/assignment 表示不过滤。共享 `parseWorkItemListQuery` 拒绝未知字段、非法状态、优先级、负责人、分配状态和游标；SDK/CLI/Web 使用同一规范化逻辑。

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

工作项看板/列表的详情入口新增 `return_to`，保存原 q/status/priority/owner/assignment/cursor/view 和当前详情 item。共用 `work-items/navigation.ts` 解析浏览参数、构造内部列表/详情链接；显式 item 始终按本地 ID 契约验证，无效 ID 不再渲染一个不可用的选择链接。默认首项进入详情时也显式保存该选择，页外选中项仍可独立读取并返回原页。

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

MockWorkItemStore沿现有bounded-json和取消信号接入，无新增Mock路由。CLI/MCP/Web未增加这些SDK选项或遍历命令，生产Gateway/共享投影/数据库/依赖不变。仅源码文档人工审阅，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布；真实取消/迟到/超限/错误、旧传输兼容、重复游标/页数上限及分页消费仍待运行证据，R-001/R-002保持未完成且evidence为空。

### 其他读取入口

- SDK：`getWorkItemProjection(itemId, options?)`，共享输入/响应解析器，返回 WCP 封套；有界读取及取消见上节。
- CLI：`workctx work-items get --json-file work-item.json`，文件内容 `{"item_id":"本地 ID"}`，无需 --key。
- MCP：`get_work_item_projection`，输入 item_id，要求 context.read，声明只读。
- 工作台：`/work-items/detail?item=...` 独立读取指定任务，展示描述、版本、时间和来源；刷新表单重新请求详情。来源 URI 作为文本展示，不自动访问。
- 看板/列表提供详情入口。显式指定 item 不在筛选结果中时，不选择另一条任务；保留原 ID 并提供独立读取入口。没有指定 item 时仍默认选择第一条。

这是本地保存的只读投影，不证明当前 Plane 状态或来源仍然有效。local version 不能用于 Plane If-Match；source_refs 是已记录证据，不表示已检查外部来源。get_work_item_context 和新增 get_work_item_state 已使用独立的持久 Plane 观察快照读取，使用 external_id/aggregate_id，见 [Plane 观察状态](observed-state-runtime.md)；两类投影尚不自动互相同步。本批没有新增 Plane 写入流程。单条读取复用 008 表，列表新增的 030 索引迁移仍未执行。
