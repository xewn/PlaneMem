# 工作项投影详情（开发状态）

2026-11-02：本批仅修改源码和文档，未编译、类型检查、测试、运行服务、执行迁移或发布。不代表已有运行验证。

## 读取入口

`POST /v1/workbench/query`，正文为 `{"operation":"work_item","item_id":"本地工作项 ID"}`。复用令牌鉴权、context.read 策略、审计和限流；不要求写客户端或请求键。范围由令牌和当前项目确定，不能通过正文指定其他项目。

item_id 是 `wcp_work_items.id`，不是 Plane external_id；允许非 ULID 标识，要求 1–255 字符，无首尾空白或控制字符。详情拒绝未知字段、数组、空 ID。一次查询按 tenant/workspace/project/id 读取未删除记录，缺少 data.restricted.read 时排除 restricted；缺失、已删除、跨项目或不可见统一返回 WORK_ITEM_NOT_FOUND / HTTP 404。损坏的投影返回 WORK_ITEM_PROJECTION_INVALID / HTTP 500，数据库不可用返回 503，不退回内存数据。

响应保留 WCP schema_version/data/trace_id/source_refs 封套。data 为共享类型 WorkItemProjection，含本地 ID、外部 ID、标题、状态、优先级、负责人、进度、描述、到期时间、分类、创建/更新时间、记录 trace_id/source_refs 和 version。version 是无损正十进制字符串，范围为 PostgreSQL 正 BIGINT；列表也增加同格式 version。详情解析器核对所请求 ID、字段、状态、版本和引用。数据库 Date 在返回前转为时间字符串。

所有 workbench.query 读取绕过进程内幂等响应缓存，即使客户端误带请求键，也重新检查可见性并读取当前投影。HTTP 响应继续 private, no-store。

## 列表分页补充

`POST /v1/workbench/query` 的 `operation=work_items` 现支持 query/status/priority/owner/cursor/limit。默认 25 条，每页 1–100 条；query 最多 500 字符，搜索 external_id/title/owner，空 query/status/priority/owner 表示不过滤。共享 `parseWorkItemListQuery` 拒绝未知字段、非法状态、优先级、负责人和游标；SDK/CLI/Web 使用同一规范化逻辑。

响应 data 仍是数组，条目增加 created_at 并与详情使用相同字段验证。存在后续数据时在外层返回 next_cursor；调用方把它作为下一次 cursor，并保留查询、状态、优先级和负责人条件。没有 next_cursor 即当前读取结束，不能把单页条数当项目总数。SDK `listWorkItemProjections`、CLI `work-items list`、MCP `list_work_item_projections` 均接入；共享响应解析验证页大小、重复 ID、所选状态/优先级/负责人和游标形状。

按 updated_at 降序、id 升序读取 limit+1 条，游标保留数据库微秒时间，并绑定租户、工作区、项目、restricted 可读权限和规范化筛选。跨范围或换筛选使用旧游标返回 INVALID_INPUT，必须回到第一页；limit 可调整。游标是位置描述，不是授权凭据，每页均重新检查范围和可见性。此分页不是快照：并发更新、删除或权限变化可能使记录移动或当前页为空。

工作台看板/列表标注“当前页”，选中任务和视图切换保留当前位置；翻页清除当前选择，筛选提交从第一页开始。错误页提供重新浏览入口。概览工作项总数、各状态和完成比例使用 overview 汇总，不再按预览页计算；预览最多五项，明确标注最近更新。后续上下文统计、有限预览和页面说明见 [项目概览读取](workbench-overview-runtime.md)。

新增 `030_work_item_pagination.sql` 为有/无状态筛选提供活动记录分页索引，仅新增文件，未执行。未编译、类型检查、测试、启动服务或发布。

### 优先级与负责人筛选（2026-11-04，仅源码）

priority 只接受 `P0/P1/P2/P3`，大小写精确。owner 是本地投影中保存的负责人文本，最多 255 个 JavaScript 字符单位，不是令牌 actor_id 或账号目录查询；空字符串表示不过滤，纯空白、控制字符、DEL、孤立代理字符、数组、null 和超长文本拒绝。非空 owner 保留原文，首尾空格、大小写、Unicode 组合形式均不归一化。使用参数化 `COLLATE "C"` 相等条件，`%`、`_`、引号等是普通文本，没有通配或 SQL 含义。空负责人暂不支持专门筛选。

所有筛选以 AND 组合，在权限过滤后的数据库查询中、LIMIT 和前瞻之前生效。返回的整页再复用共享解析逐项匹配；出现错状态、错优先级或错负责人时整页返回 `WORK_ITEM_PROJECTION_INVALID`，不在客户端静默删项。SDK、网络 CLI、Web 本身也使用共享结果解析；嵌入 CLI/MCP 接收 Gateway 已校验结果。不新增路由、写入、来源检查或权限承诺。

新增筛选非空时，查询摘要使用 `work-item-list-v2` 并包含原 query/status、priority 和完整 owner。没有非空新增筛选时保持原 `work-item-list-v1` 摘要，旧无新增筛选的游标仍可继续；游标外层编码版本、时间精度和位置结构保持。增加、移除或改变任一非空新筛选均不能沿用旧游标；错误提示从第一页重启。limit 仍可调整，不纳入该目录绑定，与原接口一致。

网页新增优先级下拉框、负责人精确输入及匹配说明。首次/下一页、任务选择和看板/列表切换均保留筛选，提交或清空筛选会丢弃旧 cursor 和选择；清空保留当前视图。仅按新字段筛选时也显示“清空筛选”和匹配为空提示。重复/未知 URL 参数和未知视图拒绝，不能通过数组隐式选择另一种筛选。输入使用已有可换行筛选布局。

开发调用形状（未执行）：SDK `listWorkItemProjections({status:'blocked',priority:'P0',owner:'Alice'})`；CLI `workctx work-items list --json-file filters.json`，原文件内容 `{"priority":"P0","owner":"Alice"}`；MCP `list_work_item_projections` 使用相同字段。续读时保留这些字段并带回 next_cursor。

本次只修改源码和文档，没有编译、类型检查、测试、调用 API/CLI/MCP、浏览器检查、数据库访问或发布。没有新增索引/迁移/依赖，原 030 等迁移状态保持未执行。组合筛选在真实数据规模下的性能、大小写/空格/Unicode 边界、旧游标兼容、客户端与网页导航均待运行证据，不宣称已验证。

## 工作台详情返回路径（2026-11-04，仅源码）

工作项看板/列表的详情入口新增 `return_to`，保存原 q/status/priority/owner/cursor/view 和当前详情 item。共用 `work-items/navigation.ts` 解析浏览参数、构造内部列表/详情链接；显式 item 始终按本地 ID 契约验证，无效 ID 不再渲染一个不可用的选择链接。默认首项进入详情时也显式保存该选择，页外选中项仍可独立读取并返回原页。

详情的“Back to results”回到原视图、筛选和分页位置。从工作项目录进入时，“Open in board/list”只改变视图，保留其余条件。刷新详情及读取失败后的显式重试均使用原 item 与已规范化 return_to；404、权限或网络读取错误仍提供原结果返回链接，不用其他项目或工作项替换失败目标。缺少 return_to 的旧详情链接继续可用，返回默认看板并保留所选 item。全局搜索已接独立返回分支，保留搜索查询/筛选/分页和所选工作项；切换工作项看板/列表时使用默认目录条件，不推断搜索条件与目录筛选等价。

return_to 允许字面 `/work-items` 或 `/work-items?` 后的已知参数，也可使用 [项目搜索导航](project-search-runtime.md) 规定的 `/search?` 路径，均最多 16384 个 JavaScript 字符单位。拒绝外部/协议相对/其他路径、片段、重复/未知字段、数组、非法视图/筛选/游标及与详情 item 不同的选择。解析后从固定内部路径重新构造 URL，所有值通过 URLSearchParams 编码；不直接展示任意输入路径、不自动重定向。工作项目录省略返回选择时使用本次详情 item；搜索返回必须明确绑定 work_item 类型及相同 ID。无效返回参数在数据读取前拒绝，错误页仅提供固定工作项列表入口。

导航不保存结果快照、记录内容、令牌或身份，不写浏览器存储；返回后仍重新读取当前权限范围。原游标若因项目/权限变化失效，列表保留原有重新浏览入口；导航不能证明原记录仍在原页或来源仍有效。筛选提交/清空和实际翻页继续清除原选择；详情刷新不修改原列表位置。

本次仅源码与文档，未编译、类型检查、测试、浏览器检查、接口调用或发布；API/数据库/依赖不变。待运行证据包含从后续页/不同视图返回、精确负责人空格与 Unicode、页外选择、直接旧链接、刷新/失败重试、非法返回地址与重复参数、跨项目/权限变化后的游标拒绝。

## 单条入口与边界

- SDK：`getWorkItemProjection(itemId)`，共享输入/响应解析器，返回 WCP 封套。
- CLI：`workctx work-items get --json-file work-item.json`，文件内容 `{"item_id":"本地 ID"}`，无需 --key。
- MCP：`get_work_item_projection`，输入 item_id，要求 context.read，声明只读。
- 工作台：`/work-items/detail?item=...` 独立读取指定任务，展示描述、版本、时间和来源；刷新表单重新请求详情。来源 URI 作为文本展示，不自动访问。
- 看板/列表提供详情入口。显式指定 item 不在筛选结果中时，不选择另一条任务；保留原 ID 并提供独立读取入口。没有指定 item 时仍默认选择第一条。

这是本地保存的只读投影，不证明当前 Plane 状态或来源仍然有效。local version 不能用于 Plane If-Match；source_refs 是已记录证据，不表示已检查外部来源。get_work_item_context 和新增 get_work_item_state 已使用独立的持久 Plane 观察快照读取，使用 external_id/aggregate_id，见 [Plane 观察状态](observed-state-runtime.md)；两类投影尚不自动互相同步。本批没有新增 Plane 写入流程。单条读取复用 008 表，列表新增的 030 索引迁移仍未执行。
