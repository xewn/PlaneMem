# 工作台审计定位（源码阶段）

2026-11-05，TODO P0-01：新增[完整审计Schema](../../../packages/contracts/schemas/workbench-audit.json)，并组合到[工作台统一查询OpenAPI](../../../packages/contracts/openapi/workbench-query.json)。精确查询/互斥条件、完整十六字段记录/省略状态、规范微秒位置/游标内容和200条完整封套均有模型。普通查询文本允许孤立代理项而拒绝控制字符/DEL；保存session_id不要求ULID，details为任意JSON，不沿用导出规范器更强的有限数值/深度/节点规则。原JSONB字节计数和实际序列化字节分别核对，元数据超限或第201条候选损坏也整页失败；审计SQL没有当前可读父项目联结，不能从父项目隐藏推导审计记录必定消失。SDK本地30秒/16MiB与HTTP无全操作期限分开，MCP可信客户端门禁不扩大成统一HTTP前提。P0-01/R-001未完成、evidence为空；只人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、执行校验器/生成器/SDK/Mock/API/数据库或发布。

更新：2026-11-02。本轮仅源码和文档，未编译、类型检查、测试、运行服务/浏览器或发布。

## 精确查询

MCP 源码现提供 list_audit_records/get_audit_record，复用相同完整封套、精确筛选和逐页校验，要求实际 audit.read、可信客户端及有效会话。list 不自动跟随游标；get 只按 audit_id 精确定位，data.page 保留原封套，并附带当前有界视图的导出准备描述。描述不授予导出权限，也不证明人工审阅或记录存在性；详见 [MCP 运行时](mcp-runtime.md)。仅源码，无客户端兼容或实际查询证据。

复用 `POST /v1/workbench/query` 的 `operation=audit`，权限仍为 `audit.read`，保留当前 Gateway 策略和授权决定审计。tenant/workspace/project 只来自可信请求上下文；普通读取过滤 restricted，关联审计 ID 不绕过此条件。

除 operation 外只接受以下可选字符串；五项筛选组合为交集，cursor 仅指定继续读取的位置。不支持通配符、模糊匹配或大小写转换，不自动 trim：

| 字段 | 限制 | 含义 |
| --- | --- | --- |
| resource | 1–2048 个 UTF-16 单元 | 完整资源字符串 |
| trace_id | 1–512 个 UTF-16 单元 | 原操作追踪号，与本次查询 envelope trace_id 分开 |
| action | 1–256 个 UTF-16 单元 | 完整动作名称 |
| audit_id | ULID | 一条记录的精确标识 |
| session_id | ULID | 审计记录已有 session_id 字段的精确值，不解析资源或来源引用 |
| cursor | 规范 Base64URL，最多 1024 字符 | 上一页返回的 next_cursor，不能与 audit_id 同时使用 |

拒绝控制字符、未知字段、错误类型、空字符串及非 ULID audit_id，返回 INVALID_INPUT。Web 表单空字段省略，重复查询字段与无效本地 item 选择也拒绝。资源值沿用字符串精确比较；旧请求传 resource 空串或额外字段现在会失败，需要省略不用的筛选。

查询使用参数化 SQL，项目与 classification 过滤在排序和 LIMIT 之前。按 occurred_at DESC、audit_id COLLATE "C" DESC 读取最多 201 行，返回前 200 行，通过 has_more 表示本次读取还存在额外可见匹配，并在有下一页时返回 next_cursor。续页以时间/ID 严格小于上一页末条的位置继续，不使用 offset。可用完整 trace/audit ID 定向定位记录。现有 007 的范围/时间、trace 索引及 audit 主键保持，无新索引或迁移；大数据量查询计划和排序成本尚无运行证据。

## 返回和校验

既有 schema_version=1、data 数组、trace_id 和 source_refs 保持；外层含 scope={tenant_id,workspace_id,project_id}、has_more:boolean 和有更多结果时的 next_cursor。来源为 `{type:postgres,id:wcp_audit_records}`。单条记录包含 audit_id、actor_id、client_id、nullable session_id、action、resource、result、classification、details、原 trace_id、source_refs、occurred_at，并要求 details_state/details_bytes/source_refs_state/source_refs_bytes。字段状态和大小限制见下节。

共享 workbench-audit 解析器供 Gateway 和 Web 使用，核对 ULID、枚举、必要文本、有效 UTC 时间、来源引用、唯一记录 ID、最多 200 条、筛选一致性、scope 和本次查询 trace。每页时间/ID 必须严格递减，续页记录必须严格早于入站游标。has_more=true 必须返回 200 条及规范 next_cursor，下一位置必须正好指向本页末条、保持入站绑定键且不能原样重复；无更多记录时不能返回游标。audit_id 精确筛选至多返回一条。

Gateway 在 SQL 中把时间格式化为六位微秒 UTC 字符串，避免数据库 Date 转换丢失小数精度；共享记录解析兼容三位毫秒 UTC 输入并补零到六位，检查真实日历并拒绝 year=0000。新 SQL 始终保留原微秒，不按毫秒重排。异常记录返回不含原内容的 WORKBENCH_AUDIT_INVALID；Web 对错范围/错 trace/乱序/错误游标或不匹配结果返回 GATEWAY_RESPONSE_INVALID，不降级成空列表。Gateway 另核对 restricted 不会进入不具备对应权限的返回列表。

Web 通用 queryWorkbench 的 audit 分支使用完整解析，所以概览和交接页的审计预览同样接入校验，原附属读取失败隔离保持。前后端源码需配套：旧响应缺少 scope/has_more、字段大小/可用状态，或 has_more=true 却没有 next_cursor，会被新解析器拒绝，不能当成已兼容部署证据。

## 字段与传输大小限制

Gateway 的单条元数据（身份、动作、资源、结果、分类、时间与原追踪号）限制为 16 KiB，details 为 32 KiB，source_refs 为 16 KiB。SQL 先物化权限/范围/筛选后的最多 201 条记录，再计算原 JSON 文本的 UTF-8 字节数与有限投影。超限 details 返回 null、details_state=too-large；超限来源返回 []、source_refs_state=too-large。没有超限时为 available，包括原始 JSON null 和空来源数组；二者不可与省略状态混淆。*_bytes 始终报告数据库原 JSON 文本大小，SQL 的空格/数值表示可能与响应重新序列化不同，不当作 HTTP Content-Length。

SQL 不把超限详情/来源原正文返回应用。元数据本身超限则投影为 null，Gateway 拒绝该页，不截断资源/身份、不跳过记录或制造可匹配的替代值；非数组来源同样标记异常并拒绝。共享解析独立检查正整数大小、available 的字节上限、too-large 必须确实超过限制且只有 null/[] 占位；旧字段状态缺失或自相矛盾直接失败。保留数据库记录原内容、分类与审计 ID，不执行脱敏、更新、删除或原文导出。

共享解析额外限制单条投影最多 68 KiB、整个封套最多 16 MiB 的 UTF-8 JSON，并继续核对范围/筛选/页序/来源。Gateway 也验证第 201 条预读记录的字段和分类。SQL 处理原大 JSON 仍需数据库资源，投影限制不代表数据库内存/查询成本上限；应用序列化、解码和结构解析有副本，传输字节限制也不是进程总内存上限。超限元数据或异常预读记录可使该页失败，不承诺自动绕过损坏记录。

Web audit 查询使用独立有界 JSON reader，复用现有字节流读取器；成功正文最多 16 MiB，错误正文最多 16 KiB。成功只接受完整 HTTP 200 和 application/json（可带 utf-8 charset），严格解码 UTF-8 后解析完整 JSON；无压缩 Content-Length 必须规范、在上限内且与实际一致，压缩响应不拿线上长度当作 Fetch 已解压正文长度，但仍限制实际解码后字节。没有声明长度也逐块限制，不返回部分 JSON/部分页。

请求、读取、解析与完整封套核验共用从派发前开始的 30 秒期限。异步流支持超时取消，解析后检查截止时间；同步 JSON/契约解析未必可以中途打断，迟到结果不会展示为成功。错误/超限时取消剩余正文；401 取消正文并要求登录，403 仍走权限错误/预览隔离。其他错误只呈现有限说明、本次查询 trace 和合法错误码，不回显上游原始 message/details。保持无自动重试、无跳页或降级读取。

## 翻页绑定与边界

游标编码为规范 Base64URL JSON `[1,queryKey,occurred_at,audit_id]`，时间固定六位微秒 UTC、ID 为 ULID、queryKey 为 SHA-256 十六进制。共享解析重新编码后逐字匹配，拒绝额外数组项、错误版本、非规范 Base64/JSON、无效日历及尾位。queryKey 由 Gateway 对版本命名空间、tenant/workspace/project、read_restricted 布尔值和原 resource/trace/action/audit-ID 筛选计算；存在 session_id 时额外在键输入数组末尾加入 'session_id' 与原值，无该筛选的键保持。增加、移除或改变会话条件均使原游标失效，cursor 自身不进入键。

每次读取先重新执行原鉴权，Gateway 再对当前范围/权限/筛选计算绑定键。原游标与这些条件不符时返回 INVALID_INPUT，不执行该页 SQL、不自动回退首屏；Web 保留表单并提供显式回首屏入口。绑定键不是签名或保密值，游标也不授予任何读取权限；重新构造合法位置不能越过当前 SQL 范围/分类限制。

这是逐次当前可见读取，不是冻结历史快照。正常新增的较新记录不会插入当前向旧方向翻页的位置，但回填较旧记录、删除/保留策略、权限及记录过滤字段变化可改变后页内容。回到首屏会重新读取最新可见记录；无下一页只描述本次查询时刻，不证明系统没有其他历史或未来记录。未实现稳定审计导出快照或全量扫描承诺。

## 页面行为

`/audit` 显示五个精确筛选，cursor 从导航 URL 读取，行选择 item 仅控制详情，不发送给 Gateway。选择行保留筛选和当前 cursor；“Older matching records”保留原筛选并使用返回游标、清除旧选择；“Newest matching records”和错误时的首屏入口保留单值筛选并移除 cursor/item。提交表单也清除旧页和选择，来源/trace/action/session 独立查询重新从首屏读取。拒绝重复 cursor，不自动修复或重试。无效输入/读取失败保留表单并显示错误，显式 item 不在本页时不选其他记录，可独立精确查该 ID；未指定 item 时可默认显示首条。

显示本页的 Shown/Allowed/Denied/Errors 数量与 has_more 提示，不称项目总量或累计历史数量。原追踪号完整显示，Open this trace、Find this action 和资源链接重建精确查询；这些操作是新的读取，不沿用旧数据作为权限凭证。不存在的可见匹配不证明记录不存在，也不证明原操作失败。

available 来源显示完整类型/ID/版本；只有 type=audit 且 ID 为合法 ULID 才提供当前项目内精确跳转，源 URI 仅作文本。too-large 来源明确显示因大小未包含及原 JSON 字节数，不显示“没有来源”。available details 显示紧凑 JSON，避免缩进扩大深层内容；too-large 详情明确显示未包含和原大小，不把 null 占位展示成原始详情，也不自动尝试无限制读取。所有导航禁用预取，不自动发起关联读取。下载动作旁明确 release 与服务端 finished 都不能确认客户端收到/保存。

原未接入的 Export JSON、Redact、Copy JSON 按钮已移除，Open trace 改为真实查询链接。后续增量已接入独立的 [单条审计视图导出](audit-export-runtime.md)：明确审阅、固定范围/摘要、重新授权与持久放行后准备 JSON，再独立请求保存；省略内容不补取。复制/脱敏、全量原文导出、稳定历史快照、观察 outbox/补偿和客户端回执仍待后续开发。

## SDK 审计查询 Mock（2026-11-05 源码增量）

新增独立 `MockAuditStore`，通过 `MockWcpServer` 可选 `audit` 配置接入原 `listAuditRecords`，覆盖本契约的精确筛选、ID 定位、微秒排序和游标分页。显式模拟数据集及可见范围，保留字段可用性和原字节数；完整输出仍经共享封套解析。此增量覆盖历史记录中的审计查询 Mock 缺口，导出放行 Mock 仍未提供。详见[审计 Mock 契约](audit-mock-runtime.md)。

Mock 为满足现有解析器保留外层 `postgres/wcp_audit_records` 来源字面量，这只是模拟协议投影，不证明实际读取 PostgreSQL、完成真实认证或写入持久审计。游标绑定包含 store、完整身份、到期和显式可见集合，不能与生产游标互换。未编译、类型检查、测试、运行 Mock/SDK/HTTP/数据库或发布，R-007 不因此完成。

## 会话关联增量

session_id 作为参数化 SQL 精确条件，在排序和 201 条预读之前与原项目/权限/其他条件取交集；完整响应解析逐行核对该字段。null 不匹配具体会话，没有“无会话”或模糊关联查询。SDK listAuditRecords、CLI audit list 和 MCP list_audit_records 使用同一字段；CLI/MCP get 仍只接受 audit_id。无需新增依赖或迁移，查询计划与大项目成本尚无运行证据。

Gateway 的入口决策审计新增显式会话目标白名单：session.read、checkpoint/read/receipt/checkpoints.list、command.receipt、run.start/finish/read/runs.list、tool.call/finish/read/tools.list、end、handoff/handoff.receipt、resume/resume.receipt，以及 workbench.query 的 session/checkpoints。仅当顶层 session_id 为合法 ULID 时写入既有字段，默认 PostgreSQL sink 同步写该列；范围仍取可信请求上下文。新建会话/新建回执、交接认领/认领回执、仅按 handoff ID 的读取没有可直接确认的目标，保持未关联。不猜测 parent_session_id、嵌套请求、资源字符串或来源引用；audit 查询中的 session_id 仅筛选，不把查询本身关联到目标会话。

这些记录发生在入口策略判定时，包含 allowed/denied，但不证明会话存在、调用者拥有该会话或业务命令已完成；resume 关联原父会话，不能据此推断新会话 ID。查询仍只受审计能力和记录分类治理，不调用会话状态读取来扩大权限。历史未填字段的记录不回填，其他未关联操作不自动补链，因此空页不是“没有会话活动”的证明。

Web 会话详情提供在新标签页显式打开会话审计的入口；审计详情可按合法会话 ID 继续筛选或读取会话当前状态，两个页面分别重新授权，禁用预取。会话过滤页提示历史关联范围，入口审计详情提示授权决定不能代替命令回执。未执行实际 SQL、客户端调用、浏览器交互或测试，关联与查询只有源码实现。

## 证据状态

CLI 增量：`workctx audit list` 支持原精确筛选/cursor，`audit get` 只接受 audit_id，网络和可信嵌入均用 SDK 校验完整页面。查询输入可内联或普通 UTF-8 JSON 文件，最多 16 KiB；返回完整封套到 stdout，无自动翻页或保存。空匹配仍是空页，不推断记录不存在。单条输出可由调用方保存审阅，供独立 `audit export --json-file ... --reviewed --output ...` 使用；这与服务器持久放行后的导出封套分开。详见 audit-export-runtime.md 与 apps/workctx-cli/README.md；仅源码，无实际查询或文件保存证据。

SDK 增量：`WcpClient.listAuditRecords(query?, options?)` 消费原 audit 查询，支持五项精确筛选和 cursor，当前项目必需。使用完整共享封套解析并复制返回页；不自动取下一页或把没有匹配解释为原操作失败。查询不发送写条件，配置的 actor/client 以相等约束核对。新 bounded-json 传输限制成功 16 MiB/错误 16 KiB，严格完整 UTF-8 JSON、状态/trace/媒体类型和解码后的字节数；无压缩声明长度必须匹配，压缩按解码后上限。options 支持取消和整次本地期限（默认 30 秒），传输另有配置期限，先到期者生效。晚到凭据不发请求，晚到响应不返回部分页；自定义 transport 的网络限额需由其自己实现。源码调用说明见 packages/sdk/README.md，无 Mock 或运行证据。

无新依赖/迁移，016–045 仍未执行。本轮没有运行任何校验命令、类型检查、测试、浏览器、服务、实际查询或发布；权限/SQL/响应解析/页面交互和前后端兼容性只有源码实现，尚无运行证据。R-007 与相关任务保持未完成。
