# 会话运行与工具调用明细

2026-11-05，TODO P0-01：[session-registry Schema](../../../packages/contracts/schemas/session-registry.json)新增统一POST的sessions/session模型，复用本文件对应的SessionClosureState/SessionCommandIdentity/权限定义。注意operation=session返回WorkbenchSessionEnvelope，无独立GET SessionStateEnvelope要求的外层tenant_id/workspace_id/project_id；SDK getSessionState仍走下述GET。新Schema不改变处理器或读取限制，未编译、测试、执行校验器/生成器/接口或发布。

2026-11-05，TODO P0-01：新增 [session-reads OpenAPI](../../../packages/contracts/openapi/session-reads.json) 和独立 [session-activity-read Schema](../../../packages/contracts/schemas/session-activity-read.json)，完整覆盖下列五个读取接口，包子路径对应文件名。只新增机器契约源码与说明；不修改当前处理器或 SDK，不作为运行证据，P0-01/R-001 仍未完成。

机器契约边界补充：运行/工具版本为正安全整数，序号上限 2147483647；状态终止时间不接受扩展年份。目录数字查询允许前导零，翻页位置不绑定原身份/筛选/页大小，也不要求边界记录存在。仅选中的 limit 条数据被解析，lookahead 只用于续页判断；工具目录关联同会话运行但不完整解析运行元数据。source_refs 扩展保留，无数量限制或当前来源权限检查；model 可为空字符串，工具名/trace 只要求非空。父会话/运行终态不要求子项同时终态。

SDK getSessionState 核对完整状态封套、当前 trace/范围/唯一 session 来源与身份提示结构，但没有传 expectedIdentity；四种活动方法只用通用封套和完整 data 解析，没有独立核对外层 trace 相等/唯一来源或详情额外身份权限提示。五路没有专用响应总字节/并发槽/整次期限或读取后身份到期复查；HTTP 解析有效版本头后忽略它，不返回 ETag，误带键也不缓存旧成功。仅人工源码文档审阅/指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

更新：2026-11-02。本轮仅修改源码与文档，未编译、类型检查、测试、启动服务、运行迁移或发布。

## 读取入口

会话目录已单独增加服务端筛选与分页，默认 25、最多 100 条；SDK/CLI/MCP/Web 只读一页，按原筛选/页大小显式续页。列表未包含某会话不代表不存在，详情和恢复仍按 ID 独立读取。完整响应、游标和 046 未执行索引见 [会话目录分页](session-registry-runtime.md)。

会话详情现有“审计记录”入口按 session_id 打开 /audit 的精确筛选页，禁用预取，审计页独立要求 audit.read，不能用会话读取权限替代。Gateway 已知会话目标操作的入口决策审计记录原会话 ID 并写入现有数据库列；仅表示请求目标及入口决定，不确认执行结果。历史空字段及没有明确会话目标的操作不回填，resume 关联父会话而不推断子会话。详见 [审计会话关联](workbench-audit-runtime.md)，仅源码，无运行证据。

| 方法与路径 | 查询参数 | 返回 data |
| --- | --- | --- |
| GET /v1/sessions/{session_id} | 无 | session_id、status、version、ended_at |
| GET /v1/sessions/{session_id}/runs | before_sequence、limit | session、runs、可选 next_before_sequence |
| GET /v1/sessions/{session_id}/runs/{run_id} | 无 | session、run |
| GET /v1/sessions/{session_id}/tool-calls | run_id、before_id、limit | session、tool_calls、原 run_id 筛选、可选 next_before_id |
| GET /v1/sessions/{session_id}/tool-calls/{tool_call_id} | 无 | session、run、tool_call |

以上读取入口要求签名令牌及项目范围内的 context.read；不要求 session.write 或写入客户端身份。策略与审计仍经过网关；HTTP 路由不退回自报身份的离线读取。即使提供幂等头，读取也不会复用先前的成功响应缓存。

session 仅含 session_id、status、version，是本次读取时取得的会话摘要。明细包含各自的 ID、状态、version、trace_id 和 source_refs；运行另含 sequence 及可选 model，工具记录另含 run_id 和 tool_name。明细 version 是记录版本，不能代替会话版本。列表不重建命令回执中的历史 session_version，亦不证明某个请求键曾成功。

## 分页与范围

新增 session.read 单会话读取使用同条 SQL 校验父项目可见性并取得当前状态、版本和 ended_at；running/paused 的 ended_at 必须为 null，ended/abandoned/failed 必须为规范 UTC 时间。封套包含 tenant_id/workspace_id/project_id、当前请求 trace、唯一 session 来源、session_permissions.write_sessions；仅已验证客户端有 session_identity。共享 parseSessionStateEnvelope 核对这些字段，拒绝错误会话、范围、来源、时间和不一致的身份提示。不返回写入 ETag，不携带原请求键，不作为原请求成功证明。

SDK getSessionState(sessionId)、CLI sessions get（JSON 仅 session_id，拒绝 --key）和 MCP get_session_state 复用该响应解析。嵌入 CLI 和 MCP 清除继承的写入键/版本，REST 绕过成功缓存。工作台 getWorkbenchSessionState 改用该 GET，并保留原身份请求头和响应身份校验；现有 workbench.query 的 session 操作继续兼容。只更新当前显示状态，不重写恢复请求、不解除未知结果、不自动写入。此增量没有新迁移，016–044 均未执行，尚无编译、类型检查、测试或运行证据。

- limit 默认 25，范围 1–100。重复、未知或类型错误的查询参数被拒绝。
- 运行按 sequence 降序，before_sequence 为排他的正整数上界；下一页传原 next_before_sequence。
- 工具调用按 ID 的字节顺序降序，before_id 为排他上界；下一页传 next_before_id，并保留 session_id / run_id 筛选。可先读取会话全部工具记录，再筛选某次运行。
- 每页取 limit+1 条判断是否还有结果，不返回全量总数或不可读记录计数。共享解析器检查记录所属会话、运行筛选、版本、来源结构、排序及下一页边界。
- 所有 SQL 绑定 tenant/workspace/project/session；工具记录还必须关联同一会话的运行。无权范围与不存在会话同为 SESSION_NOT_FOUND；不存在于该会话的 run_id 返回 RUN_NOT_FOUND。存储不可用返回 SESSION_STORAGE_UNAVAILABLE，损坏数据返回 SESSION_ACTIVITY_INVALID，不用进程缓存伪造结果。

分页是实时读取，不是固定快照。每页会话摘要、可选运行筛选存在性和有限明细已改为同一 SQL 语句读取；跨页新增记录或状态更新仍可能改变后续页面，不能作为整个会话在同一时点的导出证明。返回首页可读取前部新记录。

项目可见性增量：活动列表与详情在实际 SQL 中要求父项目未删除、分类有效，restricted 项目还需 data.restricted.read。不可见父会话与不存在统一 SESSION_NOT_FOUND，不能伪装成空页。单页使用父会话加有限 LATERAL 明细连接，父项目和明细处于同一语句快照。只有源码开发，没有运行验证；详见 [会话项目可见性](session-project-access-runtime.md)。

单次运行详情按 session_id / run_id 直接读取，不依赖当前分页。一个 SQL 语句同时读取会话摘要和所属运行，因此两个版本来自同一次语句的读取快照；后续写入仍须校验并发版本。所有查询参数被拒绝。响应额外提供 session_permissions.write_sessions 作为工作台显示提示，要求已验证客户端以及 session.write 或 admin；实际提交仍独立经过策略判定，提示不等于执行许可。

单次工具调用详情按 session_id / tool_call_id 读取，同条查询返回会话摘要、所属运行和工具记录，不依赖分页。共享解析器核对三者所属关系、状态、版本及来源；工具必须关联同一会话的运行。无目标工具返回 TOOL_CALL_NOT_FOUND，工具存在但所属运行关系损坏返回 SESSION_ACTIVITY_INVALID。所有查询参数被拒绝；权限提示与单次运行详情相同。工具收尾使用会话和工具的两个版本，显示的运行版本不作为收尾条件。

运行/工具单条详情为已验证客户端额外返回 session_identity={tenant_id,workspace_id,project_id,actor_id,client_id}，不包含凭据。共享 parseSessionCommandIdentity 限定字段与有界标识。没有已验证客户端的只读请求不返回该字段，写入提示仍为 false。工作台核对响应 trace、项目范围和身份，再以身份/记录组合固定组件；身份字段是原请求恢复的前置条件，不是授权证明。写入与回执仍独立经过网关令牌和策略校验。

## 独立会话状态与恢复页

2026-11-02 源码增量：`/sessions/detail?session=...` 严格接受一个 session ULID，拒绝重复或额外参数，使用 `getWorkbenchSessionState` 及共享封套校验单独读取目标会话。不读取整份会话列表，不依赖运行/工具列表、检查点历史、审计或汇总；会话不存在、不可见、身份校验失败或响应异常时显示错误，不选择其他会话或构造写入身份。

页面展示打开时的 status/version/ended_at/read trace，明确该快照不会随表单操作自动更新。已有 CheckpointForm/EndSessionForm 复用可信身份和权限提示，各自按原身份与会话恢复未解决请求；组件 key 不含版本和状态。原地读取、原请求导入/导出、回执查询与明确重试沿用原模型。当前会话已关闭或写权限变化不清除原请求，当前状态也不证明原命令成功。页面无已验证客户端身份时仅展示读取结果及说明，不启用恢复表单。

会话注册表和其错误页增加按 ID 打开的原生 GET 表单；详情页读取失败也保留该入口。注册表选中详情、会话创建/续接成功、交接详情、检查点详情及运行/工具页面接入独立状态页，相关命令结果在新标签页打开以保留原表单。新页提供注册表/父子关系、活动、开始运行、检查点历史和再次读取的导航；这些目标页独立读取，不承诺同时快照。后续历史分页增量已将检查点历史导航接到 `/sessions/history`，不再依赖注册表；详见 [检查点历史分页](checkpoint-context-runtime.md)。

打开页面只读，不自动保存、关闭、查询回执或重发。恢复存储沿用同标签页原格式，不自动跨标签页传递；需要时显式导出原请求，再在相同账号/客户端/项目导入。尚未发送的草稿和确认状态不作持久恢复。无 API、事务、恢复格式或迁移变更；仅源码和文档开发，未编译、类型检查、测试、浏览器/服务运行或发布。

## 状态与时间

现有运行/工具表未保存执行时间、耗时、参数正文或结果正文，因此接口与页面不会推断这些内容。工具 ID 排序不能证明准确执行先后；运行 sequence 是会话内分配的序号。结束会话不会自动将运行改成 completed，也不会将工具记录改成 succeeded；页面展示原始记录状态，不把它当作客户端当前仍在执行的证据。

独立的 run.finish 命令可将运行记录更新为 completed/failed，列表读取该持久状态。运行自身 version 与会话摘要 version 应分别用作收尾的 expected_run_version 与 expected_version；并发变化仍可能导致冲突，需审阅后重新准备请求。见 [进度命令](session-command-runtime.md)。

独立的 tool.finish 将原工具调用从 started 补记为 succeeded/failed，可在所属运行或会话关闭后提交。工具记录 version 用作 expected_tool_version，会话摘要 version 用作 expected_version；工具收尾不推进运行版本，也不推断运行结果。列表读取新的工具状态，但当前状态不证明原请求键成功；结果未知时仍需查询原命令回执。

## 客户端

- SDK：listSessionRuns(sessionId, { before_sequence?, limit? })、getSessionRun(sessionId, runId)、listSessionToolCalls(sessionId, { run_id?, before_id?, limit? })、getSessionToolCall(sessionId, toolCallId)；使用共享参数及响应校验。
- CLI：runs list、tool-calls list；JSON 包含 session_id 和可选分页/筛选字段，无需 --key。runs get 只接受 session_id、run_id，返回所选运行和会话版本；tool-calls get 只接受 session_id、tool_call_id，返回工具、所属运行及会话。limit 放在 JSON 内，CLI 的 --limit 仍用于同步队列。
- MCP：list_session_runs、get_session_run、list_session_tool_calls、get_session_tool_call；均标为只读，目录要求 context.read。
- 工作台：会话详情新增 Browse runs and tool calls，打开 /sessions/activity 的独立标签页，避免离开仍有未确认操作的原会话表单。运行详情可跳转对应工具记录，工具页可保持运行筛选继续翻页，并显示 ID、记录版本、trace 与来源引用。

## 工作台创建运行与工具记录

2026-11-03 独立恢复增补：`/sessions/recover` 接入 run.start/tool.call，活动创建页成功和失败均提供同标签页导航。按原会话槽或原会话/所属运行槽明确加载，或导入有界原文本；保持原可选模型、工具名称/初始状态、版本与键，名称不 trim，不填默认值，不要求当前记录读取成功。新建运行/工具调用 ID 只来自匹配历史回执，不执行模型或工具，见 [会话与活动独立恢复](session-request-recovery-runtime.md)。原创建页继续负责新草稿和当前状态审阅；仅源码，未编译、测试或运行。

后续客户端协接：创建响应及通用历史回执封套解析已提取至 `packages/contracts/src/session-command-clients.ts`，SDK/CLI/MCP 与 Web 复用。Web 的恢复文件与页面行为保持下述独立约束；各入口新要求的原身份和参数规则见 [进度命令客户端](session-command-runtime.md)。本次仍只有源码与文档，无运行证据。

2026-11-02 / ADR-015：活动列表增加 Start a run，运行详情和按运行筛选的工具列表增加 Record a tool call，均在新标签页打开 `/sessions/activity/create`。页面只接受 session、operation 和工具操作必需的 run；开始运行不接受 run。身份/项目/会话/操作/运行固定组件及恢复槽，不随列表翻页、筛选或当前版本改变。

运行草稿可填 model，空输入表示省略该字段；工具草稿要求 tool_name，可选择 started/succeeded/failed。名称限制为 1024 个 UTF-16 单元，拒绝空白名称、控制字符和孤立代理项；原始非空字符串不 trim，保留请求指纹。新活动要求 running 会话，工具还要求所属运行 running。页面记录活动，不调用模型或执行工具，也不记录工具输入/输出。

发送前保存并读回 `{schema_version:1,request:{identity,sessionId,operation,key,version,...}}`，run.start 增加可选 model；tool.call 增加 runId/toolName/status。最多 32768 个 UTF-16 单元，未知字段拒绝。原身份包含 tenant/workspace/project/actor/client；写入、回执及原地读取通过可信登录核对并发送原身份前置条件。旧 finish 恢复格式独立保留。

存储不可用、损坏或存在不同原请求时不发送写入、不覆盖原槽；已有内存请求仍可导出和查询回执。重载/导入统一恢复为未知结果并取消确认，不自动查询或提交。导入不能替换另一原请求或未清空的未发送草稿。响应丢失、网络/408/5xx、键冲突及损坏回执均保留未知状态；后续拒绝、未查到回执、权限消失、会话/运行结束或当前版本变化都不清除它。

Read current state 独立读取当前会话或运行详情；不改变原版本、参数、键或回执状态。未知时允许查询原回执，恢复写入权限后可重新确认并原键重试，即使当前生命周期已推进。未知时不能准备新请求。成功或明确未成功的请求可在显式读取并审阅当前可写活动状态后准备新草稿；原请求先保留在导出文本区，再移除匹配的恢复槽并分配新键，下一次写入仍需确认。成功后的当前读取不能落后于已确认回执的会话版本。所有并发条件仍由后端再次校验。

正常创建响应核对封套 trace/source_refs、记录 schema_version/原参数/来源、明细 version=1、session_version=原版本+1 和合法标识/序号，再投影为最小历史回执；重试记录内的 trace 可以是最初提交的 trace。只读回执同样核对封套和原操作/会话/版本，在服务端操作及浏览器两次解析。成功链接在新标签页打开创建的运行或工具详情，不把历史回执当作当前状态，不自动刷新或跳转原表单。

此增量没有新增后端命令、数据库迁移或执行证据；复用现有 026 等持久化基础，016–044 仍未执行。未编译、类型检查、测试、服务运行或发布，浏览器恢复/权限变化/并发创建等场景待后续授权验证。

## 工作台运行结果

运行列表的 Open run details 在新标签页打开 `/sessions/activity/run?session=...&run=...`，固定读取选中的运行；列表新增记录或翻页不会移除该表单。只读用户可查看详情，有写入提示且运行仍为 running 时可选择 completed/failed 并确认提交。父会话已关闭不妨碍补记结果，不会重开父会话，也不会修改已有工具状态或停止客户端。

表单保留原会话版本、原运行版本、目标状态和请求键。修改目标状态或明确采用最新的两个版本时更换请求键并取消确认。已知版本冲突后，先刷新当前记录、审阅并采用版本，再重新确认；不会自动覆盖新版本。

网络错误、超时、服务端错误、无效响应、请求键冲突及浏览器丢失服务端操作响应会保留未知结果。未知状态锁定状态选择和采用新版本，但允许原请求重试、原回执查询和原地读取详情。之后的拒绝、冲突、未查到回执或读取到终态都不会清除未知状态；只有校验通过的原操作回执可确认成功。

Refresh current record 通过独立只读操作更新页面内的当前记录和权限提示，不刷新整页、不替换原请求。读取失败保留旧记录及恢复入口；权限消失或运行变为终态时，已提交请求的反馈仍保留。成功回执显示历史版本，当前记录需自行刷新；两个标签页之间不自动同步状态。相关会话与工具链接打开新标签页。

已提交请求新增同标签页恢复与导出/导入，详见下文。尚未提交的选择只存在于当前表单，不保存确认状态。本轮没有新增数据库迁移；收尾写入仍依赖 026、028，均未执行。页面及新增读取接口未进行运行验证。

## 工作台工具调用结果

工具列表的 Open tool call details 在新标签页打开 `/sessions/activity/tool?session=...&tool=...`。详情展示原工具名称、当前记录状态和版本、所属运行状态/版本、会话状态/版本以及 trace/source_refs。返回会话、所属运行和同组工具的链接均打开新标签页，保留当前草稿。

有写入提示且工具仍为 started 时，可选择 succeeded/failed 并明确确认；运行或会话已关闭不会隐藏该入口。提交只补记原工具调用结果，不执行工具、不验证输出，也不改变父状态。选择另一结果或采用当前会话/工具版本会更换请求键并取消确认；不会自动采用刷新后的版本。

与运行表单相同，结果未知时保留原 tool_call_id、状态、两个版本和请求键；可以重试或查询原 tool.finish 回执。认证失败、拒绝、冲突、无效响应、未查到回执、当前记录变为终态都不清除先前未知状态；浏览器丢失服务端操作响应同样保留恢复入口。详情刷新为独立只读操作，成功只更新当前记录与权限提示，失败保留原记录；两种情况都不替换请求或确认状态。成功回执展示历史版本，当前详情需手动刷新。

工具收尾与运行收尾共用下述原请求恢复流程。单次工具读取及工作台工具收尾均为源码接入，未进行运行验证，无新增迁移，写入仍依赖未执行的 026、029。

## 运行和工具原请求恢复

2026-11-03 独立入口增补：运行/工具详情成功及错误视图提供同标签页 `/sessions/recover`。页面只读取可信身份元数据，用户明确选择操作、按原会话/资源 ID 读取精确槽或导入原文本，不要求当前活动详情成功。保留原结果、两个版本及请求键，初始未知、重新确认重试，不改当前状态或生成新请求；存储冲突不覆盖，原回执继续服务端授权。完整流程见 [检查点与收尾独立恢复](session-request-recovery-runtime.md)，仅源码，未编译、测试或运行。

收尾客户端增补：Web 的正常收尾/结束响应已改为先经 contracts 的 session-finish-clients 完整封套解析，再转换最小历史回执；SDK/CLI/MCP 同步复用。无变化终态接受 delta=0，记录 trace 可以是原提交 trace，结束会话的创建者无需等于本次操作者。原 finish 恢复格式与页面条件保持不变，损坏回执继续保留未知结果。无新迁移及执行证据，详见 [进度命令](session-command-runtime.md)。

2026-11-02 / ADR-015：工作台新增共享 finish-model、finish-actions 和 finish-recovery。发送前先保存并读回 sessionStorage 原请求，存储槽绑定当前浏览器 origin、tenant/workspace/project、actor/client、操作、会话和目标记录。保存失败不发送写请求；加载存储完成前不能提交，损坏/不同请求不会被新请求覆盖。表单显示存储错误，可重读存储；已有内存原请求的只读回执查询可以在存储写入失败时继续，不会替换保存内容。

运行/工具恢复格式为 `{schema_version:1,request:{operation,identity,key,sessionId,resourceId,version,resourceVersion,outcome}}`，最多 32768 个 UTF-16 单元。run.finish/tool.finish 结果分别限定 completed/failed 和 succeeded/failed；两个版本均为正安全整数，标识为 ULID，键遵守既有长度/字符约束，未知字段拒绝。后续会话结束增补允许 operation=end，只保存会话版本并拒绝 resourceId/resourceVersion，结果仅 ended/abandoned/failed；原两种格式继续可读。恢复内容不保存令牌、输入/输出、来源正文、成功标记或用户确认。

重载或导入只恢复原键、原两个版本和原结果，统一视为尚未确认；即使前一页面曾显示成功，也需要手动查原回执。无自动查询/重试，恢复后确认取消；可以无需勾选确认查询回执，重新提交必须确认原结果。未知状态仍禁止换键、选择另一结果或采用新版本；当前记录已经终态或版本推进不会解除未知状态。只有校验过的匹配 receipt 可显示成功。原地刷新不改变原请求，后续认证失败、拒绝、未查到回执仍保留未知状态。

Export original request 将原请求复制到页面文本框，用户自行保留；Restore original request 严格核对同身份/项目/会话/操作/记录并保存，不能覆盖另一个已存在或无法解析的请求。关闭标签页或清理浏览器存储可能丢失恢复信息，应先导出；这不是跨设备持久任务队列。不同账号或项目不会读取旧存储槽；原请求仍要求返回原身份/范围。权限不足时保留恢复信息但不能执行写入或回执查询，详情不可读时需恢复访问后再进入原页面。

工作台 server-api 在发送收尾/回执/原地刷新前核对当前登录 scope 与原 scope，并携带 x-expected-actor-id/x-expected-client-id；网关现有检查以已验证声明比对。换账号/客户端不能让原请求在新身份下提交。收到的历史回执在服务器操作和浏览器再次按原请求解析，不以当前状态相同推定原键成功。前端与服务器均不改写底层收尾事务或观察状态。

本增补只修改源码与说明；同标签页重载、浏览器禁用存储、导入/导出、账号/项目变化、终态下恢复和响应丢失等场景均尚未运行验证。会话结束已通过后续增补复用此恢复流程，并新增按 ID 单条状态读取，见 [会话结束入口](session-command-runtime.md#工作台结束入口)；检查点也已通过独立恢复格式保留原笔记数组，见 [检查点恢复](checkpoint-context-runtime.md#工作台原请求恢复)。其余表单仍需各自接入。

027_session_activity_indexes.sql 只增加两种工具分页查询的索引，文件已新增但未执行。运行序号分页复用原有索引；单条工具读取使用既有主键。新增明细页及客户端行为尚无运行验证。
