# 架构决策记录摘要

## ADR-001：Plane 作为 Work Control Plane

选择 Plane 保存项目和工作项，WorkMesh 只保存引用、投影和跨客户端过程。原因：减少重复主库、复用项目管理能力、降低升级和一致性风险。

## ADR-002：ai-memory 作为记忆实现

采用上游 `akitaonrails/ai-memory`，因为它提供 git-backed Markdown、生命周期 Hook、跨 Agent handoff、MCP/HTTP、claim-once 和零 LLM 默认路径。WorkMesh 通过 Adapter 集成，不读其 SQLite。

## ADR-003：模块化单体起步

目录按边界拆分，但首期可在一个部署单元运行；事件吞吐、隔离或故障域需要时再拆进程。

## ADR-004：事件追加和乐观并发

事件不覆盖，状态写入带 expected_version/If-Match；负责人、截止时间、审批和任务状态发生并发时生成 Conflict。

## ADR-005：WCP 独立于 MCP

MCP 是客户端传输/适配方式，WCP 是业务契约，避免客户端协议变化绑定领域模型。

## ADR-006：FTS 优先，向量可选

先使用 ai-memory/SQLite FTS 与 WorkMesh/PostgreSQL FTS，pgvector 作为 Feature Flag；评测达标后再默认启用。

## ADR-007：敏感事实必须确认

AI 只输出 candidate/proposed；verified 只能由授权人确认，所有确认带来源和审计。

## ADR-008：版本锁定和可回滚

Plane、ai-memory、WorkMesh、Schema、迁移和配置统一进入 release manifest，升级必须经过兼容矩阵和备份恢复测试。

## ADR-009：Plane 队列运行指标与业务查询分离（开发中）

2026-11-02：P1 接收队列和 P6 监测协作扩展到 `apps/api-gateway/src/plane-inbox-metrics.ts`、队列 worker/server 生命周期、Compose 环境变量及 `deploy/observability`。工作台查询继续遵守项目与分类权限；运维指标由默认关闭的 `PLANE_INBOX_METRICS_ENABLED` 显式启用，读取整个数据库接收队列，包括当前业务查询不可见的行，不复用管理员汇总接口，也不授予业务读取权限。

采集器使用独立单连接池、只读事务与语句超时，每次采集完成后等待 30 秒；HTTP 抓取只导出内存快照，不触发数据库扫描。只使用固定状态标签，禁止 tenant/project/event/actor/trace 等标识或原文。最近采集失败、从未成功或样本超过 90 秒时不导出队列数量/时间序列，另外导出采集成功、新鲜度与最后成功时间，避免把观测故障当作空队列。

所有网关实例观察相同数据库，不应对各实例队列 gauge 求和；worker 状态保持实例级。告警覆盖采集故障、worker 轮询异常、到期积压、记录版本缺口和拒绝记录，规则只提供待部署的默认阈值。启用前需将已有无认证 `/metrics` 放在受限运维网络；本次仅新增源码、配置和文档，未开启开关、编译、测试、运行服务、执行迁移或部署，不声明告警投递已接通。

## ADR-010：版本缺口诊断只使用可见的当前已提交基线（开发中）

2026-11-02：P1/P4/P5 将队列诊断扩展到共享 contracts、Gateway、SDK/CLI/MCP 和工作台。同一数据库语句先定位真实已提交流的最高版本，再核对该版本的诊断样本（最多两条）是否均有可读接收回执；不能使用较低的“最新可见”版本代替真实基线。最高版本不存在、旧记录无接收回执或可见性不满足时，统一返回 baseline_unavailable，不返回隐藏版本、事件 ID 或数量。

只有可读、唯一的最高已提交版本才能推导下一版本和目标之前尚未提交的版本区间；候选接收回执另按现有分类权限过滤，缺少可见候选不证明事件未收到。最高版本有可读重复记录时显示流歧义，不计算下一版本；候选列表限制条数并标注截断，不提供隐藏数量。诊断只比较已提交版本，不保证索引、别名、策略或初始化检查可通过，不调用补拉、重试或事件变更。页面独立打开，避免打断人工重试恢复流程。以上只开发源码和说明，不执行测试、迁移或发布。

## ADR-011：工作项删除保留观察标记并停用索引（开发中）

2026-11-02：先支持自有 Canonical Event `WorkItemDeleted`，封套仍为 v1，必须为 work_item、含 project_id，payload 只有必填 external_id。这是经过既有签名入口接收的观察事件，不宣称已实现原生 Plane Webhook 的自动转换。删除沿用持久去重、版本顺序、aggregate/别名/索引锁；事件、删除快照、失效索引、回执和审计在一个事务提交。

040 迁移给观察快照增加 deleted_at。已删除快照保留来源与别名，只保存删除事件字段；对应索引同版本软删除并移除原摘要，分类不降低。现有已删除/过期索引允许被更新为更高版本的删除标记，但普通更新不允许复活删除快照；显式恢复由后续 ADR-012 单独事件协议补充。工作台本地工作项和外部记忆副本不由本事件直接删除。

活动观察保留 data.schema_version=1；删除观察使用 data.schema_version=2 和 deleted_at（等于源事件时间），避免旧解析器将删除标记当作活动快照。直接 state 读取在当前范围/分类下返回标记；context 读取经同样授权确认删除后返回 410，调用外部记忆之前停止。父项目不可见仍为 404。本增补扩展至事件契约、Plane 投影、Gateway、共享客户端解析器和工作台；项目删除、外部副本清理仍待开发，恢复由 ADR-012 补充。040 仅写迁移文件，不编译、测试、执行迁移、启动服务或发布。

## ADR-012：恢复观察绑定确切删除并保留索引约束（开发中）

2026-11-02：在 ADR-011 基础上开发 WorkItemRestored 自有 Canonical 事件，覆盖事件/共享契约、Plane 投影、Gateway、队列诊断和工作台。恢复封套必须为 work_item、含 project_id 与 causation_id；payload 含 external_id、非空 title/status 和 restored_from={event_id,aggregate_version}。restored_from 指向原删除，causation_id 必须与其 event_id 一致，恢复版本必须为原删除版本加一。恢复以本次活动观察字段替换删除快照，不回填旧事件内容。

缺失前置已提交版本时继续等待；当到达紧接版本，最新事件必须正是声明的删除，且 external_id 不变。写事务在既有 aggregate/别名/索引锁内锁定并核对删除快照、删除源事件和同版本已删除索引；缺失、不匹配或过期索引拒绝恢复。快照与索引一起清除 deleted_at，分类保持最高等级，expires_at 保留，历史删除事件不改写。普通更新仍不能复活记录，也不通过人工队列重试伪造恢复事实。

当前恢复观察为内层 schema_version=1 活动记录，额外带 restored_from；旧活动解析器可继续读取内容，新解析器核对删除引用与当前版本。普通后续更新没有该顶层标记，重新删除仍返回内层 v2。此为源事件观察协议，不是用户直接调用 Plane 的恢复命令，原生 Plane 恢复映射和外部副本恢复不在本次实现中。没有新增迁移，仍依赖未执行的 040；不编译、测试、运行或发布。

## ADR-013：Plane 观察目录与本地工作项分开读取（开发中）

2026-11-02：新增工作项当前观察元数据目录 GET /v1/plane/work-items，操作 workitem.observed.list，要求可信身份和 context.read。与 P1/P2/P4/P5 协接，责任范围为共享契约、Gateway 读取、SDK、CLI、MCP 和 Web；不改变观察写入或队列。目录按 external_id 的 Unicode 标量顺序分页，state=active/deleted/all，默认 active，limit 默认 25、最多 100。游标绑定范围、身份、restricted 可读能力、筛选和页大小，过滤权限与可用性后才取页，不提供隐藏计数。

同一数据库语句读取当前父项目、快照、来源事件和同版本索引。活动行必须未删除且索引未过期；删除行只显示最小删除元数据，即使旧索引过期也可发现。父项目缺失/不可见返回 404，可见项目零匹配返回空页。只返回标题/状态摘要、标识、版本、源时间/事件类型和分类，不返回 payload、描述、来源正文或外部记忆。标题和状态限制为 2000/255 个 Unicode 字符，删除条目两者为 null；分类取当前索引与父项目较高等级。

目录只代表当前可读观察；不代替详情授权，不证明 Plane 同步完整，也不保证跨页冻结快照。Web 提供筛选、翻页和详情链接，保留按 ID 查询；SDK/CLI/MCP 共享响应解析器。按用户要求仅开发源码/文档/索引迁移文件，不编译、测试、运行或发布。

2026-11-02 检索增补：同一责任范围增加 query 字面包含筛选，只匹配 external_id、aggregate_id 及当前显示的活动标题摘要。仅忽略 ASCII 英文字母大小写，其余 Unicode 按原字符匹配；不检索描述、历史标题或外部记忆。检索词最长 500 个 UTF-16 单元，拒绝控制字符和孤立代理项，去除首尾空白。共享响应解析器复核条目匹配，数据库先按权限/状态/检索词过滤再分页。游标升至 v2 并绑定规范化检索词，旧游标需回第一页。Web 保留从目录到详情再返回时的合法筛选/游标；不接受任意返回 URL。无新迁移，不执行测试或运行验证。

## ADR-014：Plane REST 传输限制重试并保留写入不确定性（开发中）

2026-11-02：为现有 PlaneClient 增加原生 fetch 传输及构造入口，不改当前接口路径映射，不宣称固定 Plane 版本已经兼容。配置只接受 HTTP(S) origin，ID 编码为单一路径段，拒绝重定向和越界路径；请求/响应有大小限制，超时覆盖响应读取，并支持调用方取消。凭据、响应正文与 URL 不进入错误详情。

只有 GET 对可重试网络故障或 408/429/5xx 做有界退避，遵守 Retry-After；等待要求超出本地上限时直接返回错误，不提前重试。POST/PATCH 从不自动重试，发送后失败或收到无法验证的成功响应均标记 write_outcome=unknown；本地输入拒绝为 not_sent。相同请求键不被当作已验证的 Plane 幂等保证。现有数据读取方法保留，增加 Result 版本返回 status、trace_id 和可用的原始 ETag；不把 WCP/观察版本生成的 ETag 当作 Plane 写入依据。

T1.2 责任范围扩展至连接器公共导出、README、兼容性说明和需求追踪；无数据库迁移，不连接真实 Plane，不触发命令或更新观察投影。遵守用户仅开发要求，不编译、类型检查、测试、启动或发布。

2026-11-02 读取增补：新增 getWorkItem/getWorkItemResult，沿用当前更新路径的单记录地址做 GET，校验返回 ID。项目与工作项另提供 IfChanged 方法，必须显式传入一个原始 ETag，发送 If-None-Match；使用 not_modified 判别结果，304 分支没有 data，不自动填充缓存或更新观察。304 仅在相应条件 GET 下接受；若响应提供 ETag，必须有效且与请求标记弱比较相同，缺失时只保留 requested_etag，不伪造响应头。普通读取或写入收到 304 均拒绝。当前状态读取不能证明某次未知写命令曾提交，也不能在创建结果没有 ID 时自动定位新记录。原生端点与条件请求支持仍待固定版本验证；不执行网络请求或测试。

## ADR-015：运行和工具收尾保留原请求并绑定身份（开发中）

2026-11-02 收尾客户端协接：T3.1/T4.2/T4.3/T5.1 将原身份及共享响应解析扩展到 run.finish、tool.finish、end。SDK/CLI/MCP 和 Web 均核对原版本、结果、来源和 trace；同终态无变化允许版本增量 0，真实转换增量 1。结束响应中的创建账号/客户端不等于本次结束操作者，不据此禁止同项目授权用户收尾；校验原操作身份仍由可信上下文/HTTP 前置条件完成。无后端事务/路由/迁移变更，仅源码与文档，不编译、测试或发布。

2026-11-02 活动创建客户端协接：T3.1/T4.2/T4.3/T5.1 扩展至共享会话命令身份绑定、活动创建封套解析、SDK startAgentRun/recordToolCall/getSessionCommandReceipt、CLI 网络/嵌入入口和 MCP 创建/通用回执适配；工作台复用共享响应校验。原正文额外字段只在历史回执查询中保留，新创建输入限定已声明字段；身份只作为令牌前置条件。查询清除新写入键和继承版本，不自动重试/持久化。无后端业务事务或迁移变化，仅源码与文档开发，仍不编译、类型检查、测试、运行服务或发布。

2026-11-02 活动创建协接：T3.1/T5.1 在工作台 server-api 与 sessions/activity 内补齐 run.start、tool.call 创建入口及独立原请求恢复模型。复用现有进度写入/回执和当前状态读取，不调整后端事务或旧收尾恢复格式。提交前保存原身份、会话版本、参数和键；结果未知时只允许原请求查询/重试，当前记录不解除未知状态。新草稿须明确读取并审阅当前状态；修改范围包含活动契约、TODO 和需求追踪。只开发源码与文档，不编译、类型检查、测试、执行迁移或发布。

2026-11-02 项目可见性协接：会话活动详情/分页、进度/检查点/续接回执及持久进度、检查点、旧领取/续接路径补入父项目删除、有效分类和 restricted 读取能力边界。持久写入先锁定可见项目，再读取/锁定会话；检查点持久重试不得绕过数据库回到成功缓存。活动分页改为单语句读取可见父会话和有限明细，避免分步读取后返回已失去可见性的记录。不增加对外业务字段或迁移，只开发源码和文档，不编译、测试或发布。

2026-11-02 开始客户端协接：将普通开始的共享绑定/响应解析接入 SDK、CLI 网络与嵌入调用、MCP 开始/只读回执工具。三个入口都保留原身份、原始可选参数和键，不通过当前会话反推开始成功；SDK 可使用构造时固定的完整身份作为默认。查询不带新写入键/版本、不自动重试；更新契约、示例和追踪。无新增迁移，016–044 仍未执行，仅源码和文档开发。

会话开始也纳入原请求恢复边界：普通 `session.start` 使用已认证 actor/client，新增与会话创建同事务保存的开始回执（迁移 044，未执行）以及独立只读查询。原始可选参数参与指纹；旧会话只有原始键而没有开始回执时不推断成功、不补造归属。Web 在发送前保存原请求，刷新后只恢复未知状态，由用户查询或明确重试；已有会话状态不能替代开始回执。当前增量只开发源码与文档，不编译、测试、执行迁移或发布。

2026-11-02 创建客户端协接：范围扩展至共享创建绑定/成功响应解析、SDK、CLI 网络及嵌入调用、MCP 创建/回执适配和 Web 响应解析复用。创建与查询都要求原身份、检查点、目标和请求键，保留可选原参数，不自动重提或生成新键；仅 SDK 可从固定完整构造上下文取默认身份。更新公开说明与 R-004，无新迁移、不执行编译、类型检查、测试、服务或发布。

2026-11-02 创建交接协接：扩展至共享创建命令/回执契约、会话服务、Gateway 持久事务与只读查询、HTTP 缓存、工作台创建恢复和 server-api。新增 043 迁移文件，以原身份和参数绑定创建成功；旧记录缺少创建账号证据时不补认。创建前保存原请求，响应未知后锁定检查点、目标和键，支持重载及有界导入导出。仅开发源码和文档，不编译、测试、执行迁移或发布。

2026-11-02 领取客户端协接：扩展至共享领取成功响应校验、SDK client/continuity、CLI main/remote/嵌入调用适配、MCP catalog/protocol/专门领取适配器。三个入口保留原身份/范围/版本/键并查询同一持久回执；身份字段只作前置条件，MCP/嵌入调用对比已验证 context，HTTP 使用 expected 身份头。更新公开文档及 R-004；无新迁移，仅开发，不编译、类型检查、测试、服务运行或发布。

2026-11-02 领取协接：扩展 P3/P4/P5 至共享交接领取回执契约、ContinuationService、PostgresSessionStore、Gateway 路由/策略/缓存边界及工作台领取恢复表单。新增 042 迁移文件保存原请求指纹与最小历史领取回执，领取及回执同事务。带键领取要求可信身份和原版本，无记录时不从当前归属补造原请求成功；旧无键路径保留。工作台恢复绑定原身份和版本。仅源码开发，042 及已有未执行迁移均不运行，不编译测试或发布。

2026-11-02 续接协接：范围扩展至 handoffs 独立恢复模型/操作/表单、工作台页面、server-api 和 Gateway workbench/query。续接沿用固定 workbench-resume-{handoff_id} 键，绑定已验证身份、父会话、交接和预期检查点；预期检查点用于结果校验，不增加业务命令字段。发送前保存并读回原请求；重载/导入按未知处理并撤销确认，不自动发送。保留状态/权限变化后的恢复入口，回执与重试仍由服务端鉴权。无迁移，仅源码开发，不编译测试或发布。

2026-11-02：扩展 P3/P4/P5 协接范围至共享会话身份契约、Gateway 活动详情、工作台 server-api、运行/工具收尾表单和共享恢复组件。详情只为已验证客户端提供当前 scope/actor/client 身份；收尾、回执查询和原地刷新携带原身份前置条件，网关以已验证声明检查，不将浏览器字段当作鉴权来源。

提交前将原操作、记录 ID、会话/明细版本、结果、请求键及身份保存至同标签页 sessionStorage 并读回。保存失败不发新写请求。重载或导入后只恢复原请求，按结果未知处理并撤销确认，必须手动查回执或重新确认原键重试；不自动发送，也不信任浏览器保存的成功标记。未知结果禁止换键/改参数，读取当前终态不能解除。支持有界 JSON 导出/导入；不包含令牌、工具输入/输出或来源正文。损坏缓存阻止写入，不自动删除；只读回执可在存储失败时继续。此为标签页恢复信息，关闭标签页须事先导出，并非跨设备持久队列。

无数据库迁移，不修改收尾命令的业务事务。仅开发与源码审阅，不编译、类型检查、测试、启动服务、执行迁移或发布。

2026-11-02 会话结束增补：共享恢复范围扩展到 session.end，恢复格式只保存原 session_id、会话版本、结束状态、键和身份，不伪造运行/工具版本。工作台 sessions 查询补入可信身份；新增 workbench.query 的 session 单条状态读取，供结束表单原地刷新，绑定项目可见性且不依赖列表筛选。责任范围包含 Gateway workbench/query 与 repository、共享会话状态解析、工作台 sessions 页面/结束表单。重载和导入仍不信任缓存成功、不自动执行；关闭状态与当前版本不解除原请求未知结果。仅源码开发，不运行验证或发布。

2026-11-02 检查点增补：P3/P4/P5 协接扩展至工作台检查点表单、独立请求模型/操作、server-api 身份前置条件及原地会话状态读取。保存前持久化六类原笔记数组、可选包 ID、原会话版本、请求键与身份，恢复时不再规范化已发送笔记。正文有界且导出明确包含笔记；未发送编辑仍只在当前页。响应丢失按未知处理，任何后续包失效/权限/未查到都不能解除；只有匹配回执成功后可经当前状态刷新明确准备新检查点。存储损坏或保存失败阻止写入，恢复不自动查询/提交，不将历史回执解释为包当前有效。无迁移，仅开发、不编译测试或发布。
2026-11-02 会话当前状态读取协接（ADR-015）：补充 GET /v1/sessions/{session_id} / session.read，范围包含共享封套解析、Gateway 路由/读取策略、SDK、CLI 网络与嵌入入口、MCP 和工作台原地读取。返回同一次读取的状态、版本与结束时间，以 context.read 和父项目可见性限制访问；可信身份和可写提示不授予权限。当前状态不确认任何原请求成功，不替换恢复中的原版本或键。无新增迁移，只开发源码和文档，不编译、类型检查、测试、运行服务或发布。

2026-11-02 检查点客户端协接（ADR-015）：共享检查点原请求绑定、正常保存/只读回执封套解析，扩展至 SDK、CLI 网络和嵌入、MCP 及工作台 server-api。保留原六类数组、可选包/记忆引用、版本、键、身份及历史额外字段；新写入限定声明字段，历史查询不重新规范化。解析当前请求 trace、历史记录来源、原笔记和包绑定，不将当前状态或包有效性当作原保存证据。沿用已有保存事务，无新迁移；只开发，不编译、类型检查、测试、启动服务或发布。

2026-11-02 续接客户端协接（ADR-015）：共享续接原身份/父会话/交接/有效 require_claimed/键绑定、可选预期检查点及正常/历史响应解析，扩展 SDK、CLI 网络和嵌入、MCP、Web。预期检查点只作客户端结果约束，不加入业务命令；子会话当前版本和状态允许推进，原 resume_origin 必须一致。完整响应核对检查点、交接、子会话与包关系；最小历史回执固定 not-checked。工作台仍用固定原键，不改变恢复格式、不自动重发。无新迁移，仅源码开发，不编译、测试、类型检查、运行服务或发布。

2026-11-02 历史检查点详情协接（ADR-015）：新增 GET /v1/sessions/{session_id}/checkpoints/{checkpoint_id} / session.checkpoint.read，以 context.read 和同语句父项目可见性过滤读取指定历史检查点；与保存/回执、当前会话状态分开。范围含共享参数/封套解析、Gateway、SDK、CLI、MCP、工作台独立详情页及保存/历史/交接链接。返回原六类笔记、引用、来源、记录 trace、revision 与保存时间，包状态固定 not-checked；不访问外部记忆或自动续接。无新迁移，仅源码和文档，不编译、测试、类型检查、运行服务或发布。


2026-11-02 定向交接准备协接（ADR-015）：T3.1/T5.1 增补 /handoffs/create 独立工作台页面，按会话/检查点 ID 读取并固定可信身份前置条件，避免定向准备依赖全量列表及无关看板读取。复用现有创建原请求恢复、回执与显式提交；读取失败不选择其他版本，原请求优先于链接目标。范围仅工作台、契约说明及需求追踪，无迁移或后端事务变更；不编译、测试、运行或发布。

2026-11-02 单条交接读取协接（ADR-015）：T3.1/T4.2/T4.3/T5.1 增补 session.handoff.read 和 GET /v1/handoffs/{handoff_id}，范围覆盖共享契约、Gateway 同语句权限与记录读取、SDK/CLI/MCP、工作台独立详情及共享表单展示。当前归属/版本不代表原创建/领取/续接结果，旧无账号归属不补认；复用原恢复槽，不自动发送。无新迁移，只改源码和文档，不编译、测试、类型检查、运行或发布。

2026-11-02 交接原地刷新协接（ADR-015）：T3.1/T5.1 在独立交接详情新增只读 server action、客户端快照绑定及页面级互斥，复用 session.handoff.read。原领取/续接表单保持挂载，当前记录与原命令结果分离，确认绑定读取轮次；读失败保留快照和恢复槽，写后显式重读再继续。纯展示 helper 从服务端错误组件拆出，保留原导出。无 API/事务/恢复格式/迁移变更，仅源码与文档，不编译测试或运行。

2026-11-02 看板附属读取隔离协接（ADR-015）：T5.1/T3.1 交接页与概览页独立处理主数据和附属查询，失败不伪装为零、空列表或权限不足；检查点选项解析包含在隔离范围，可信身份下保留创建恢复表单。交接计数改读正式概览，按 ID 的独立详情/准备导航在队列失败时仍可使用。各读取不是跨请求事务快照，原恢复身份/参数/键及未知状态不变。无 API、事务或迁移变更，仅源码和文档，不编译、测试、类型检查、运行或发布。

2026-11-02 独立会话恢复页协接（ADR-015）：T3.1/T5.1 新增 /sessions/detail，以已有单会话 GET 读取可信状态/身份，复用检查点及结束会话恢复表单，解除这些入口对全量注册表的依赖。正常与错误注册表保留按 ID 导航，创建/续接和关联详情接入。原恢复格式、未知状态及请求身份/版本/键不变；页面快照与表单刷新分别展示，不自动写入或传递跨标签页状态。无 API、事务或迁移变更，仅源码与文档，不编译、测试、类型检查、运行或发布。

2026-11-02 检查点历史分页协接（ADR-015）：T3.1/T5.1 复用 workbench checkpoints 查询，增加共享参数/记录/分页解析及同语句可见父会话与有限历史读取。缺失父会话不返回假空页，损坏记录/游标拒绝；封套增加 session_id 和可信身份/权限提示，data 仍为数组。新增独立历史页并接入状态/详情/注册表，旧内嵌入口保留。无新增 HTTP 路由、写事务或迁移，仅源码与文档，不编译、测试、类型检查、运行或发布。

2026-11-02 检查点历史客户端协接（ADR-015）：T3.1/T4.1/T4.2/T4.3 增补 session.checkpoints.list 与 GET /v1/sessions/{id}/checkpoints，复用工作台既有持久分页及父会话可见性。公共封套增加并校验 scope，SDK listSessionCheckpoints、CLI checkpoints history 和 MCP list_session_checkpoints 共享查询/响应解析；只读授权、不自动翻页、不解释为原回执。无新迁移，仅源码和文档，不编译、类型检查、测试、网络调用、运行或发布。

2026-11-02 Artifact 持久化基础协接（ADR-015）：T2.1 开始开发独立于旧内存 fixture 的持久 Artifact 服务，责任范围扩展 apps/artifact-service/src、deploy/migrations/045_artifact_command_receipts.sql、契约说明、TODO 与需求追踪。元数据/版本/原身份请求回执同事务，正文使用不可覆盖对象存储端口；先校验父项目权限和版本，再发布对象及提交指针，失败不伪造成功。旧内存类暂留兼容，不宣称已接入 Gateway、S3 或审计/事件发布。遵循用户只开发要求，不编译、类型检查、测试、安装依赖、执行迁移、启动服务或发布。

2026-11-02 Artifact 数据库适配协接（ADR-015）：T2.1 扩展至 apps/api-gateway/src/artifact-persistence.ts、Gateway 包导出/依赖及 workspace 锁文件，复用 Gateway 已声明的 postgres 3.4.7 驱动。提供 ArtifactDatabase 实际 SQL 适配及显式组合工厂，不注册公开路由、不创建独立连接池、不启动对象存储。事务同连接执行，确认提交后返回，限制 SQL/锁/事务空闲时间；不隐式重放。真实 S3/MinIO、认证入口、审计/事件仍待开发。只改源码和文档，不安装、编译、类型检查、测试、联网、执行迁移、运行服务或发布。

2026-11-02 Artifact S3 适配协接（ADR-015）：T2.1 在 apps/artifact-service/src 增加原生 fetch/crypto 的 S3 SigV4、条件 PUT 和有界 GET 适配，Gateway artifact-persistence 增加双适配组合工厂，更新契约、任务状态及需求追踪。仅支持明确配置的 path-style 普通桶端点；不覆盖对象、不跟随重定向、不自动建桶或重试、不生成公开 URL。凭据由服务端调用方提供，错误不回显凭据/URL/远端正文。官方文档检索未返回可读结果，不作为接口核对证据；不连接业务存储、不安装依赖、不编译、测试、执行迁移或发布。签名/条件写入及 MinIO 具体版本兼容性均待后续证据。

2026-11-02 Artifact 元数据读取协接（ADR-015）：范围扩展共享 artifact-read 契约、Gateway 读取注册/服务器配置/鉴权/状态映射、Policy 与 OPA 的 artifact.read、SDK 及文档。新增当前/历史元数据 GET，仅接收已验证范围和 artifact.read；服务端显式注入 reader 或 S3 配置与既有数据库组合。公开响应移除 storage_key，内容状态固定 not-checked；不表示下载授权、正文可读或原写入回执。无写路由、无新迁移，仅源码与文档，不编译、类型检查、测试、运行或发布。

2026-11-02 Artifact CLI/MCP 读取协接（ADR-015）：T4.2/T4.3 范围扩展 workctx cli/main/remote/独立 artifact-read 适配、Gateway mcp/catalog/protocol/独立 artifact-read 适配及各契约/任务/追踪。新增 artifacts get/version 与 get_artifact/get_artifact_version，复用共享元数据校验和已注册读取路由；禁止写键、身份覆盖和自动降级为当前版本。MCP 发现要求实际 artifact.read，不因 admin 身份扩大工具可见性；继承写条件清除。无新依赖、迁移、业务写入或正文下载，仅源码与文档，不编译测试或运行发布。

2026-11-02 Artifact 工作台协接（ADR-015）：T5.1 扩展至 web-console server-api、/artifacts 页面/查找表单/页面查询解析、导航和样式，以及契约/任务/需求追踪。复用签名当前/历史元数据 GET 与共享封套校验；无参数只展示查询入口，缺失/无权限/存储错误不伪装为空目录。展示分类、大小、版本、时间、来源与当前/历史区别，存储键/正文不进入 UI；保留错误后的查找入口，不增加上传/下载按钮。仅源码开发，不编译、类型检查、测试、启动浏览器/服务、迁移或发布。

同次协接补充：根 .gitignore/.prettierignore 中的 artifacts 通配忽略了新页面源码，责任范围加入这两个配置文件，只放行 apps/web-console/src/app/artifacts 及其子文件；其他生成证据目录继续忽略，不移动或删除产物。

2026-11-02 Artifact 原请求回执协接（ADR-015）：T2.1/P4 扩展共享 artifact-command/receipt 契约、持久模型共享解析、Gateway 回执注册/配置/身份校验及 Policy/OPA、SDK 与契约/任务/需求追踪。新增只读 POST /v1/artifacts/receipt，必须提供原身份、完整命令和原键，绑定令牌身份和 artifact.write；查到回执仍按当前可见性过滤，公开响应移除存储键，历史结果不作为当前写条件。不触发上传、对象访问或自动重试；未观察到不证明原请求失败。共享命令规范化保留既有指纹字段顺序和语义。无新依赖或迁移，只改源码和文档，不编译、类型检查、测试、运行服务或发布。

2026-11-02 Artifact CLI/MCP 回执协接（ADR-015）：T4.2/T4.3 范围扩展 CLI main/remote/cli/独立 artifact-receipt、MCP catalog/protocol/独立 artifact-receipt 及任务/契约/追踪。新增 artifacts receipt 和 get_artifact_receipt，完整 identity/command 共用共享查询/响应解析；原身份是相等约束，嵌入/MCP 必须是已验证客户端，MCP 目录要求实际 artifact.write。查询清除继承写条件，保留 command 内原版本/键；不上传、下载、保存 outbox 或重试。无新依赖或迁移，仅源码与文档，不编译、类型检查、测试、运行或发布。

2026-11-02 Artifact 工作台回执协接（ADR-015）：T5.1 范围扩展 /artifacts/receipt 页面/导入表单/动作/展示模型、server-api、Artifact 导航和局部样式，更新契约/任务/追踪。导入有界 JSON 只在本页准备原 identity/command，显式查询才发送只读回执请求；可信会话与原身份逐项约束，完整响应双端校验。未知/拒绝/错误保留原请求，确认结果只描述原历史快照，不改键/版本或自动重提。提供原 JSON 导出和新标签页查看元数据，导入不自动写入浏览器存储；无新 API、依赖或迁移，不编译、类型检查、测试、浏览器/服务运行或发布。

2026-11-02 Artifact 上传协接（ADR-015）：T2.1/T4.1/T0.5 扩展共享写结果契约、Gateway multipart 有界读取/并发限制/持久写注册、服务器鉴权与 SDK Fetch 上传。POST 创建及追加版本要求原 identity/command、内容、原 Idempotency-Key 和追加 If-Match；认证后读取，复用持久事务与不可变对象，不自动重试。写结果绑定原历史快照且不提供当前 ETag，区分首次保存校验与回执重放。补充契约/任务/TODO/R008，无新依赖或迁移；只改源码和文档，不编译、类型检查、测试、运行、迁移或发布。

2026-11-02 Artifact CLI 上传协接（ADR-015）：T4.3 范围扩展 workctx main/remote/cli、独立 artifact-upload 参数/本地文件读取/响应适配及契约/任务/TODO/R008。新增 artifacts create/put-version，要求保存的 --json-file 与明确 --file；读取普通文件时限制大小，拒绝读取期间变化并核对原 size/SHA-256。网络 multipart 与嵌入可信 writer 复用原身份/命令/版本/键及上传结果解析；未知结果保留原请求，不自动重试或改写本地文件。无新依赖/迁移，只改源码和文档，不编译、类型检查、测试、上传实际文件、运行服务或发布。

2026-11-02 Artifact 可审计下载协接（ADR-015）：T2.1/T4.1/T0.5 扩展指定版本 content GET、独立下载注册/有界并发/二进制响应、共享下载描述校验与 SDK Fetch 二进制读取。下载要求真实 artifact.read、已验证客户端、原版本/hash/size 及当前/历史分类导出权限；读取前后校验可见性与内容，持久 release 审计确认后发送字节，不声称客户端交付完成。禁止 Range/条件缓存/写头，不签发公开 URL、不回退当前版本、不自动重试。复用既有审计持久端口及 Policy/OPA，无新依赖/迁移；只改源码和文档，不编译、类型检查、测试、连接存储、运行或发布。

2026-11-02 Artifact CLI 下载协接（ADR-015）：T4.3/T0.5 扩展 CLI 下载命令、共享完整二进制结果解析、固定版本元数据/内容读取和本地保存。显式 --output，下载前检查目标不存在，校验内存字节后写同目录独占临时文件、同步并读回核验，以不覆盖的硬链接发布；不支持时失败并保留可辨识恢复信息，不回退覆盖式 rename。网络复用 SDK 有界传输，新增 workspace 依赖及锁文件链接但不安装；嵌入走可信 router 并复核完整结果。上传普通文件有界读取抽取共用，更新契约/任务/TODO/R008。只改源码和文档，不编译、类型检查、测试、实际下载/保存样本、安装、执行迁移、运行或发布。

2026-11-02 Artifact MCP 下载协接（ADR-015）：T4.2/T4.1 扩展 mcp/catalog、protocol、独立 artifact-download 适配、服务器 MCP 下载并发交接及契约/任务/TODO/R008。新增 download_artifact_version，输入明确 artifact_id/version/sha256/size，要求已验证客户端、实际 artifact.read、有效会话和既有当前/历史导出权限；复用 artifact.download 及持久 release 审计。MCP 独立硬上限 4 MiB，完整封套与 SHA-256 校验后返回文本摘要和 application/octet-stream 内嵌 blob，urn:sha256 标识内容而非可访问 URL，不注册文件资源枚举或持久缓存。与 HTTP 共用实例下载名额并持有至响应结束，嵌入协议按 ApiGateway 实例限流。不重试、不自动换版本、不打印原始字节数组。无新依赖/迁移，只改源码和文档，不编译、类型检查、测试、实际下载、启动服务或发布。

2026-11-02 Artifact 工作台下载协接（ADR-015）：T5.1/T4.1 扩展 web-console Artifact 页面/独立下载组件、同源 POST 二进制转发路由、共享有界读取与选择/错误模型、server-api 固定会话范围提取及契约/任务/TODO/R008。页面显示的版本/hash/size/范围固定，显式获取后双端核验，浏览器独立点击保存，不自动执行文件或冒充本地保存完成。路由严格同源/JSON/专用请求头、有限正文、可信会话、项目绑定及两路并发；当前令牌通过原 Gateway 历史元数据与审计下载，服务端使用 Node SHA-256，浏览器使用 Web Crypto，最多 64 MiB，无重试或自动换版本。取消/失败保留描述及已确认审计，临时字节仅驻内存并可丢弃，卸载取消/释放 URL。不新增依赖/迁移；只改源码与文档，不编译、类型检查、测试、实际下载/保存、运行浏览器/服务或发布。

2026-11-02 Artifact MCP 上传协接（ADR-015）：T4.2/T4.1 扩展 MCP create_artifact/put_artifact_version 工具目录、原请求与规范 Base64 适配、协议写调用及服务器认证前置/有界 JSON 接收。参数仅保存的 request={identity,command} 和 content_base64，原键/追加版本由 command 决定，不注入新键或重试。MCP 内容最多 4 MiB、规范原请求最多 1 MiB；普通 MCP 正文维持 1 MiB，已验证有效 writer 可扩展至 8 MiB。声明大正文读取前、未知长度实际超过普通上限的字节被保留前，取得与 multipart 共用上传名额并转交执行到持久写返回；小型未知长度普通请求不依赖上传容量或 writer 配置。复用原上传 body reader 的 120 秒时限，增加可信扩容回调，不改变 multipart 语义。鉴权在读取正文前完成，工具需求在解析后再次检查；大正文只允许两个上传工具，不扩大其他操作载荷。失败区分本次未派发与派发后结果未知，完整结果校验并提示 get_artifact_receipt 原回执恢复。无新依赖/迁移，仅源码/文档，不编译、类型检查、测试、实际上传、运行或发布。

2026-11-02 Artifact 工作台上传协接（ADR-015）：T5.1/T4.1/T2.1 扩展 /artifacts/upload 导入/文件校验/明确提交与原地回执查询、同源 submit 路由、共享有界字节读取/上传失败模型、server-api 单次会话快照、Artifact 导航及契约/任务/TODO/R008。保存的原 identity/command 不重写，浏览器和代理独立核对最大 64 MiB 内容的长度/SHA-256，再以原键/版本调用既有 multipart Gateway；完整结果双端校验，未知结果保留请求、仅显式查原回执，不自动重试。代理先检查同源/专用头和会话，再以两路容量限制有界读取及上游请求，输入 120 秒、上游 150 秒；浏览器提交 300 秒，取消/离开清理文件内存但不声称撤销已派发写入。抽取既有下载 bounded reader 共用并保留原下载上限；不新增 Gateway 路由、依赖或迁移，不编译、类型检查、测试、实际上传、浏览器/服务运行或发布。

2026-11-02 Artifact 新请求准备协接（ADR-015）：T5.1/T4.1/T2.1 扩展共享 artifact-upload-context 契约、Gateway 只读 upload-context 注册/路由/策略映射及 Web 独立服务端准备读取、新准备页/字段模型/文件核对与既有上传表单衔接。新建资料包括名称、MIME、分类和可选来源，追加使用明确目标当前元数据的原版本；可信账号/客户端/项目只能来自已验证会话的只读响应。新接口要求真实 artifact.write 和有效可信客户端，返回自身身份/到期/服务器上限/读取能力提示，不授予未来上传许可、不检查存储健康、不生成键。Web 使用同一令牌快照读取准备身份和可选目标，只有明确准备动作生成一次新请求键；完整原 JSON 和已核对 Blob 同页交接至现有导出/确认/上传/原回执流程。导入旧请求不经过新准备，准备后不改键/版本或自动发送。无依赖/迁移变更，仅源码和文档，不编译、类型检查、测试、运行、实际上传或发布。

2026-11-02 Artifact 下载观察审计协接（ADR-015）：T4.1/T4.2/T6.2 扩展 artifact-downloads、独立 artifact-download-audit、server 及 MCP 下载适配，记录固定阶段失败与服务端发送结束/中断/错误/超时。保留既有 mandatory release 审计；补充观察有界尽力持久化，不掩盖原始错误，不携带内容、存储地址或异常文本，不宣称客户端保存。更新 Artifact/MCP 契约、任务、TODO/R008；无新依赖/迁移，仅开发，不编译、类型检查、测试、运行或发布。

2026-11-02 工作台审计定位协接（ADR-015）：T5.1/T4.1/T6.2/T0.5 扩展共享 workbench-audit 查询/记录/完整封套解析、workbench query/repository 参数化精确筛选与返回范围、Web server-api 及 audit 页面。支持 resource/trace_id/action/audit_id 交集筛选，最多 200 条并明确 has_more；详情保留完整追踪号和来源标识，关联 audit source_ref 通过同权限精确读取。保持 audit.read、项目范围和 restricted 过滤，不新增写入、导出或脱敏操作，移除未接入按钮。先更新协接范围，再修改源码与契约/TODO/R007；不编译、类型检查、测试、运行或发布。

2026-11-02 审计历史翻页协接（ADR-015）：T4.1/T5.1/T6.2/T0.5 扩展 workbench-audit 共享游标/微秒时间/页序校验、独立 audit-pagination 绑定键、repository 键集读取和 audit 页面导航。游标绑定项目、restricted 可见性和四项原筛选，按 occurred_at/审计 ID 严格递减，不用 offset；每页重新授权和过滤。保留 200 条上限并使 has_more 与 next_cursor 一致，来源精确查询重置游标，筛选和错误恢复可回首屏。游标不是凭据或签名快照，新增/回填/权限变化不保证跨页冻结历史。无新依赖/迁移，仅源码和文档，不编译、类型检查、测试、运行或发布。

2026-11-02 审计读取大小限制协接（ADR-015）：T4.1/T5.1/T6.2/T0.5 扩展 workbench-audit 大小/字段可用状态契约、repository 分页后投影及 Web audit-response 有界读取/server-api 接入/页面提示。SQL 对已选页记录限制元数据 16 KiB、details 32 KiB、来源 16 KiB，超限详情/来源显式省略而不伪造空值，异常/超限元数据拒绝该页；共享解析独立校验状态和整页 16 MiB。Web 成功/错误正文分别限 16 MiB/16 KiB，沿用一次 30 秒期限、完整 UTF-8 JSON、无自动重试，不返回部分页。保留原权限和游标，不新增导出或写操作；无依赖/迁移，只改源码和文档，不编译、类型检查、测试、运行或发布。

2026-11-02 单条审计视图导出协接（ADR-015）：T4.1/T5.1/T6.1/T6.2/T0.5 扩展共享 audit-export 固定范围/记录摘要/响应契约、Gateway audit-export 处理器/server/http 接入及 export.audit 策略映射、Web audit/export 同源代理和明确获取/保存控件。只导出当前选中且已审阅的有界记录视图，使用内容 SHA-256 固定快照，重新读取/核验/授权并持久 release 审计后返回；保留省略标记，不承诺全量原文或批量快照。真实 audit.read、可信有效客户端及分类导出能力必需，源和放行审计分别关联，客户端保存始终未确认。无自动重试/身份覆盖/写键缓存；同源代理不把令牌交给浏览器。无依赖/迁移，只改源码和文档，不编译、类型检查、测试、实际导出、运行或发布。

单条审计视图导出同次协接补充：T6.1 责任范围明确包括 deploy/opa/policy.rego 的 export.audit 分类规则。入口按 audit.read 授权，处理器获得可信分类后再执行本地与 OPA 导出策略；实际能力要求不受 admin 角色豁免。仅源码，不运行 OPA 或测试。

2026-11-02 审计 SDK 协接（ADR-015）：T0.5/T6.2 扩展 packages/sdk/src/client.ts、独立 audit.ts、request-budget.ts、bounded-json.ts、fetch-transport.ts、index.ts 和 README/契约/任务/TODO/R007。新增审计精确筛选分页读取及已审阅单条 document 导出；固定范围/内容，独立摘要校验，bounded-json 限成功/错误正文并支持取消及整次等待期限。保留旧 JSON/二进制调用，无自动重试/翻页/保存、无新服务路由/依赖/迁移；只改源码和文档，不编译、类型检查、测试、运行、实际导出或发布。

2026-11-02 审计 CLI 协接（ADR-015）：T4.3/T6.2 扩展 apps/workctx-cli/src/main.ts、cli.ts、独立 audit.ts、README 以及审计读取/导出契约和任务/TODO/R007。新增 audit list/get/export，使用既有 SDK 类型化读取/导出及 bounded-json；export 必须是单条已审阅查询封套文件、--reviewed 和新输出路径，完整核验后复用既有普通文件读取与独占临时文件/读回/硬链接保存。网络与嵌入入口一致，保留 scope/可信能力、持久放行与本地保存区分；不自动替换记录、翻页、重试或入队。无新依赖/迁移，只改源码和文档，不编译、类型检查、测试、实际读写样本、运行或发布。

2026-11-02 审计 MCP 协接（ADR-015）：T4.2/T6.2 扩展 apps/api-gateway/src/mcp/catalog.ts、protocol.ts、独立 audit.ts 及 MCP/审计契约、任务、TODO/R007。新增列表/单条读取和显式 reviewed=true 的原范围/ID/摘要导出，工具发现及执行要求可信有效客户端与实际能力；复用已有 workbench.query/audit.export，不新增服务端业务路由。单条读取附可审阅导出描述，完整响应/摘要校验后返回文本；两路适配准备限额及截止时间，超时底层工作保留名额直到结束，输出限额不冒充 HTTP 发送或全进程内存保证。无文件资源/自动保存/重试或依赖/迁移变更，仅源码和文档，不编译、类型检查、测试、实际查询/导出、运行或发布。

2026-11-02 会话审计定位协接（ADR-015）：T0.5/T4.1/T4.2/T4.3/T5.1/T6.2 扩展 contracts/workbench-audit、Gateway audit-session-target/server/workbench repository/audit-pagination、MCP catalog、Web audit/session 详情，以及 SDK/CLI 说明、契约/任务/TODO/R007。增加 session_id 精确筛选及返回校验/游标绑定，明确操作的入口审计仅关联合法原请求目标；不重写历史、不将会话筛选读取本身关联成会话操作、不推断创建/认领结果。新导航仍走独立当前授权。无新依赖/迁移，仅源码和文档，不编译、类型检查、测试、执行查询、运行或发布。

2026-11-02 管理快照协接（ADR-015）：T0.5/T4.1/T5.1/T6.3 扩展 contracts/workbench-admin/index、Gateway workbench repository/query/server 管理权限、Web server-api/audit-response/共用 workbench-response/admin 页面及契约/TODO/R011。移除健康/开关/数据库版本/发布就绪的静态推断，提供严格有界的查询观察封套、真实版本/时间和按实际能力及分类过滤的计数；无数据权限为不可读，未探测能力为 not-checked。只有源码与文档，不编译、测试、调用外部探测、执行迁移或发布。

2026-11-02 管理快照客户端协接（ADR-015）：T0.5/T4.2/T4.3/T6.3 扩展共享 workbench-admin 可选可信能力绑定、SDK admin/client/index、CLI admin/main/cli、MCP admin/catalog/protocol 及说明/契约/TODO/R011。新增 getAdminSnapshot、admin snapshot 与 get_admin_snapshot，固定项目、无查询输入、完整快照校验、有限错误和本地等待；可信嵌入另核对管理员/实际能力/有效期与返回计数可用性。无自动探测、文件写入、重试或 Mock 证据，无新依赖/迁移，仅源码开发，不编译、测试、调用或发布。

2026-11-02 会话目录分页协接（ADR-015）：T0.5/T4.1/T4.2/T4.3/T5.1 扩展共享 session-registry、Gateway workbench 与 046 目录索引文件、SDK listSessions、CLI sessions list、MCP list_sessions 和工作台 sessions/server-api。原无界目录替换为项目/权限/筛选绑定的键集分页，先选页再加载聚合元数据，完整响应校验，页面统计只描述当前页；保留独立详情恢复入口。无自动翻页、写操作或新依赖，仅源码/文档，不编译、测试、执行迁移或发布。

2026-11-02 交接目录分页协接（ADR-015）：T0.5/T4.1/T4.2/T4.3/T5.1 扩展共享 handoff-registry、Gateway workbench 与 047 目录索引文件、SDK listHandoffs、CLI/MCP 目录和 Web handoffs/server-api。原全量合并列表改为范围/权限/筛选/页大小绑定的键集分页，持久交接优先于同 ID 历史投影，完整摘要省略与身份元数据校验；会话 handoff 资源只返回首屏并提示工具续页。修复 MCP list_sessions 重复注册和静默覆盖。无新依赖，只改源码/文档，不编译、测试、执行迁移或发布。

2026-11-03 检查点目录分页协接（ADR-015）：项目级 checkpoints 查询增加 query/checkpoint_id/limit/cursor 筛选分页、微秒位置及范围绑定游标；按会话的既有历史分支保留。范围包括共享 checkpoint-registry、Gateway workbench/048 索引文件、SDK/CLI/MCP/Web 目录和交接创建选择器，以及契约/TODO/R004。摘要显式省略、完整封套校验，页面翻页不替换保存的原创建请求。仅源码与文档，不编译、类型检查、测试、执行迁移或发布。

2026-11-03 独立恢复身份协接（ADR-015）：新增只读 session.command-context 及完整共享契约，仅返回可信当前身份、到期和会话/领取权限提示；沿用既有能力策略与入口审计，不读取目录或创建回执。范围扩展 Gateway server/http/独立处理器、contracts、SDK/CLI/MCP 适配、Web server-api 和 handoffs/recover/CreateForm/导航，关联契约/TODO/R004。专用恢复页不要求目录、当前会话或交接详情成功，导入/重载保留原请求并重新授权。无新迁移或依赖，只开发源码与文档，不编译、类型检查、测试、运行或发布。

2026-11-03 领取/续接独立恢复协接（ADR-015）：T5.1/T5.2 在 handoffs/recover 增加精确本标签页槽位读取和有界原文本导入，身份来自既有 session.command-context。原表单新增固定原请求恢复模式，保留原键/版本/检查点/require_claimed 与未知状态；不要求当前详情、不推断新请求、不扫描浏览器存储、不自动查询或写入。详情成功及失败均保留同标签页恢复导航；对应模型/契约/TODO/R004 纳入范围，无 API/事务/格式/迁移/依赖变化。只开发源码与文档，不编译、类型检查、测试、运行或发布。

2026-11-03 检查点/收尾独立恢复协接（ADR-015）：新增 Web sessions/recover 的可信身份页、本地精确槽加载/有界原文本导入及固定原请求操作组件，覆盖 checkpoint.save/end/run.finish/tool.finish。复用既有模型、动作、回执和身份前置条件；原表单仅提取共用存储键，导航接入会话查找、运行/工具详情及交接恢复页。关联 T5.1/T3.1/T3.2、契约/TODO/R004；原笔记数组、包选择、版本、结果和键完整保留，不伪造当前记录、不自动发送、不换键，不新增 API/迁移/依赖。仅源码和文档，不编译、类型检查、测试、运行或发布。

2026-11-03 开始/活动创建独立恢复协接（ADR-015）：扩展 sessions/recover 覆盖 session.start/run.start/tool.call，复用原 start-model/actions 和 lib/activity-create/既有创建动作；抽出原存储键供正常表单与恢复加载共用。开始会话不要求未知的新会话 ID，运行创建按原会话槽、工具创建按原会话/运行槽定位，全部固定原正文/身份/键及适用版本。创建页成功/失败与会话/交接导航同步，关联 T5.1/T3.1、契约/TODO/R004；无新 API/事务/格式/依赖/迁移，只开发源码与文档，不编译、类型检查、测试、运行或发布。

2026-11-03 检查点全文读取边界协接（ADR-015）：共享历史/详情封套增加 UTF-8 大小限制，详情 2 MiB、十条历史页 8 MiB；Gateway 在 SQL 输出前限制正文，历史前瞻只取位置，不返回截断笔记，超限明确报错。SDK/Web/CLI 网络读取接入完整响应与本地期限，CLI/MCP 复用共享解析；历史/详情错误保留查找及原请求恢复入口。范围为 contracts、Gateway checkpoint-read/history/workbench/http、SDK、CLI 适配、Web server-api/历史/详情及契约/TODO/R004，关联 T0.5/T3.2/T4.1/T4.2/T4.3/T5.1。无新迁移/依赖，只开发源码与文档，不编译、类型检查、测试、运行或发布。

### 2026-11-03 冲突独立详情（ADR-015 增补）

2026-11-03 冲突独立详情协接（ADR-015）：新增只读 conflict.read / GET /v1/conflicts/{conflict_id}，按原三层范围、项目及来源可见性读取完整双方值和历史决策，BIGINT 版本使用十进制字符串，SQL NULL 与 JSON null 明确区分，旧决策元数据单独标记。contracts/Gateway/SDK/CLI/MCP/Web 接入同一完整解析与有界读取，工作台新增按 ID 页面和目录失败查找入口。范围包括上述子项目源码、WCP/MCP 说明、TODO/R-006；不改决策写事务或生成原请求，不新增依赖/迁移，仅源码与文档，未编译、类型检查、测试、运行或发布。

### 2026-11-03 冲突目录分页（ADR-015 增补）

2026-11-03 冲突目录分页协接（ADR-015）：GET /v1/conflicts 与 workbench conflicts 改为元数据分页，默认 25、最多 100，支持文本/状态/实体类型/精确 ID 筛选；Unicode 标识符按 C 顺序、游标绑定原范围/受限数据能力/筛选/页大小。完整共享契约接入 SDK/CLI/MCP/Web，原目录详情按 ID 独立读取，保留既有解决表单并拒绝不安全数值版本，筛选/续页不丢弃原页表单。范围包含 contracts/Gateway/SDK/CLI/MCP/Web、049 索引文件及契约/TODO/R-006；不执行迁移，不改原决策事务，不编译、类型检查、测试、运行或发布。旧全量/全文消费者与 fixture/Mock 需迁移，不补造运行证据。


2026-11-03 冲突原请求回执协接（ADR-015）：新增只读 conflict.receipt / POST /v1/conflicts/receipt，原 identity/request_key/完整有效 command（含路由 conflict_id 和原 expected_version）作为绑定，沿用现有 commandReceipt 指纹规范，读取 013 保存的决定及同步事件。父项目/来源可见性与当前 verified conflict.resolve 身份核对；返回 recorded/not-observed，旧元数据无法核实、参数不匹配和存储错误明确失败。contracts/Gateway/SDK/CLI/MCP/Web 回执导入页、契约/TODO/R-006 纳入范围。保留旧决定事务与未知原请求，不自动重试、不生成键，不宣称完整恢复闭环；无新增依赖/迁移，只开发源码与文档，不编译、类型检查、测试、运行或发布。


2026-11-03 冲突决策保存与恢复协接（ADR-015）：新增 conflict.command-context / GET /v1/conflicts/commands/context 作为已验证且未过期的 conflict.resolve 身份读取；Web 决策先冻结并保存完整 identity/request_key/command，再显式发送原 resolve 请求。独立 conflicts/recover 页按原身份/冲突 ID 精确读取本标签页 sessionStorage 或有界导入，不要求当前目录或详情。未知结果不换键、不更新版本、不自动提交或查询；写响应仅视为等待回执，只有既有完整 receipt 解析可确认结果。原请求保存冲突不覆盖，存储失败仍允许导出和回执查询。补父项目锁、写版本安全范围及历史事件可见性/一致性保护。范围为 contracts、Gateway、Web、契约/TODO/R006；SDK/CLI/MCP 的专用 command-context 包装暂不扩展。不新增迁移/依赖，不编译、类型检查、测试、运行、发布或执行迁移。

2026-11-03 冲突操作身份客户端协接（ADR-015）：在既有 GET /v1/conflicts/commands/context / conflict.command-context 上补 SDK getConflictCommandContext、CLI conflicts identity（网络和嵌入）及 MCP get_conflict_command_context。读取仅返回可信原身份/到期/解决权限提示；不读目录、详情或回执，不生成/覆盖原请求，不自动写入/重试。SDK 支持默认 30 秒期限、timeout_ms/signal 和 16 KiB 有界完整响应；CLI 拒绝正文/写键/多余及重复选项，嵌入比对可信原上下文；MCP 发现/调用要求已验证且未过期 resolver，清除继承写条件、固定原请求并完整核对身份/到期/200/trace。抽出 Gateway 身份数据助手供同包 MCP 复用；contracts 可补共享可信元数据一致性校验。范围为 contracts/Gateway/SDK/CLI/MCP、契约/README/TODO/R006；不新增迁移/依赖，不扩展 MCP 外层容量/发送/期限保证。仅源码与文档，不编译、类型检查、测试、运行或发布。

2026-11-03 固定原冲突请求提交协接（ADR-015）：新增共享完整旧 resolve 响应解析与仅 unconfirmed 的规范提交结果，SDK submitConflictDecision(original,{reviewed:true,timeout_ms?,signal?}) 固定原身份/完整命令/键/版本，复用既有 resolve 路由；不生成键、不自动查询回执/重试。CLI conflicts submit 要求已有原请求 JSON 文件和 --reviewed，先有界读取完整正规文件，拒绝临时 JSON/stdin/新键及重复选项；网络/嵌入都通过 SDK。MCP submit_original_conflict 接受完整 original 与 reviewed=true，核对可信身份/外层前置条件、固定请求并完整验证结果；写工具仍要求 resolver。Web 原提交响应接入同一完整解析，只有显式 receipt 可确认原绑定。范围为 contracts/SDK/CLI/MCP/Web/Gateway 接线和契约/README/TODO/R006；无新增路由、指纹变化、依赖或迁移。旧 resolve 入口兼容保留，完整跨客户端草稿准备/持久化及外层容量/发送/期限边界另记。只开发源码与文档，不编译、类型检查、测试、运行或发布。

2026-11-03 固定原请求协接补充：源码阅读发现 WcpClient 通用 RequestContext 构造器只允许 ULID actor_id，但 Gateway 可信 OIDC sub 与冲突原身份契约允许普通字符串。冲突专用 SDK receipt/submission 改为始终匹配三层范围，并核对调用上下文中已提供的 actor/client 约束；原请求完整五字段仍通过预期身份头发送，并由 Gateway 对可信身份完全比对。CLI 网络/嵌入以范围上下文构造 SDK，嵌入仍独立比对完整原身份。身份读取嵌入适配同样避免把非 ULID actor 填进通用构造器，完整返回身份/到期仍与可信原上下文比对。无需修改通用元数据或放宽 Gateway 权限，不伪造替换原身份；相关 SDK/CLI 既有回执与身份适配、README/契约纳入本轮范围。仅源码与文档，无编译、类型检查、测试、运行或发布。
2026-11-03 CLI 原冲突文件准备协接（ADR-015）：新增 conflicts prepare --json-file DECISION.json --output NEW_ORIGINAL.json，只读取可信冲突身份，使用调用者明确的命令/版本生成一次新键，完整保存原 identity/request_key/command，不发送决定。复用已有正规文件有界读取和不覆盖文件保存实现，输出保存/读回状态并保留失败恢复路径；已有目标文件不替换。conflicts receipt 文件模式改为专用有界入口，网络/嵌入均可读取同一原文件，submit 复用读取助手。范围为 CLI src/README、冲突契约说明、TODO/R006 与 ADR；不变更 Gateway/SDK 公开协议、旧指纹、依赖或迁移。原命令含已有键/原请求封套时不得重新准备；不自动读当前冲突、查询回执或提交。仅源码与文档，不编译、类型检查、测试、运行、迁移或发布。
2026-11-03 浏览器冲突原请求持久保存协接（ADR-015）：新增仅浏览器使用的 IndexedDB 原请求存储，按原五字段身份/冲突 ID 精确槽读写；新准备在同一 readwrite 事务读取已有值，仅空槽生成一次键并添加完整原请求，提交事务前读回比对。现有不同/损坏数据不得覆盖，保存成功后才允许明确发送。表单初次加载同时核对旧 sessionStorage 槽；旧副本仅在显式保存/准备时复制，保留旧值，不做自动迁移/清理。恢复页分别读取浏览器持久副本或旧标签页副本，存储失败/冲突保留导出及只读回执；加入异步忙碌保护、连接/事务本地等待上限和陈旧加载抑制。范围为 Web conflicts 源码、契约/TODO/R006 与 ADR，不改 Gateway/SDK/CLI 协议和 SQL，不新增依赖；浏览器 schema 初始化只写源码，未运行。仅开发源码与文档，不编译、类型检查、测试、浏览器运行、迁移或发布。
2026-11-03 同步发送与完整回执协接（ADR-015）：Context Bridge Gateway publisher 增加固定原批次/范围/键、请求 trace、凭据/HTTP/完整正文统一本地等待预算、有界 UTF-8 JSON 读取及完整批次回执解析；未知结果不结算为已送达。共享 contracts 解析覆盖完整事件集合、合法拒绝形状、原 client_cursor 与 server_cursor/来源/范围/trace；SDK uploadEvents 和 SQLite 自定义 publisher 结算共用。CLI sync flush 传递本次 trace。范围为 contracts、SDK、Bridge outbox、CLI main/README、同步契约/TODO/R005 及协接文档；不改服务端指纹、批次/事件幂等策略、SQLite schema、依赖或迁移。当前原账号/客户端持久绑定、旧 SDK/MCP 传输边界与真实恢复证据仍独立待补。仅源码与文档，不编译、类型检查、测试、执行同步、运行服务或发布。
2026-11-03 SDK 同步上传传输协接（ADR-015）：新增 SDK sync-upload、WcpSyncUploadOptions，uploadEvents 接入既有 bounded-json 与本地等待预算，成功 256 KiB/错误 16 KiB，固定原批次/范围/键、共享完整回执解析、无自动重试。request-budget 共用计时改用单调时钟，bounded-json 清理异常不遮蔽原错误且始终关闭预算。范围为 SDK 源码/导出/README、同步契约、任务/TODO/R005；不改 Gateway 输出/指纹、MCP/CLI 入口或队列身份/schema，不新增依赖/迁移。仅源码与文档，不编译、类型检查、测试、运行同步、执行迁移或发布。
2026-11-03 原同步身份持久绑定协接（ADR-015）：新增 sync.command-context/SDK/CLI 身份读取；新入队保存完整 expected_identity，并以新增本地账号/客户端列与完整命令校验和持久化，发送批次不混合原身份，Bridge 发送预期身份头。旧缺身份记录保留并阻止发送，不自动补身份；同本地键不同原事件/身份明确拒绝。SDK uploadEvents 增加可选原身份约束，CLI enqueue 必须带原身份。范围为 contracts、Gateway 注册/HTTP/授权、SDK、Bridge、CLI 网络/嵌入身份入口及文档/TODO/R005；只写本地 schema 升级源码，不打开 SQLite、不执行任何迁移。无新依赖，不编译、类型检查、测试、运行或发布。
2026-11-03 原同步事件回执协接（ADR-015）：新增只读 sync.event.receipt / POST /v1/sync/events/receipt，以完整原 identity/event 核对既有 015 上传指纹和持久事件，返回 recorded/not-observed；不使用批次键、不重发事件或补写旧队列身份。共享契约、Gateway 只读事务/可见性/HTTP、SDK getSyncEventReceipt、CLI sync receipt 网络/嵌入与文档/TODO/R005 纳入范围；复用原事件规范化和指纹，无新依赖/schema/迁移。只修改源码和文档，不编译、类型检查、测试、执行请求、打开数据库或发布。

2026-11-03 本地原事件显式结算协接（ADR-015）：Bridge 新增原行回执核对/事务内结算与已有库专用打开模式；CLI outbox reconcile EVENT_ID 复用 SDK 原事件回执，网络/嵌入入口均保持原身份和完整事件。回执读取不持有 SQLite 写事务；完成后重读整行/租约，只有完全匹配且原投递已记录才结算，保留原命令、尝试和调度。活跃发送、并发变化、缺原身份/摘要损坏/已有回执冲突拒绝；未观察到不修改、不重发、不自动 retry。范围为 Bridge/CLI 源码、README、同步契约、任务/TODO/R005；无新依赖/schema/迁移，不改变旧 flush 策略，不提供旧行猜测性身份绑定。只修改源码和文档，不编译、类型检查、测试、运行、打开数据库或发布。

2026-11-03 MCP 原同步读取协接（ADR-015）：增加 get_sync_command_context / get_sync_event_receipt 的发现、准备、独立执行及完整共享校验；可信未过期 sync.write/admin 才可使用，继承写条件清理，原身份不替换。两读取工具共用每 ApiGateway 两笔准备名额和 30 秒单调本地期限，超时后底层工作结束才释放；输入/成功/错误/二次转义 result 分别限制。HTTP 对可信 sync writer 增加回执协议封套余量，最终按工具名和上限拒绝滥用，Artifact 扩容容量仍独立约束。范围为 MCP catalog/protocol/新适配、server 及 MCP/同步契约、任务/TODO/R005；不改 upload_events/下载/ack 或队列，不新增依赖/schema/迁移，仅源码和文档，不编译、类型检查、测试、运行 MCP/服务、执行迁移或发布。
2026-11-03 MCP 原同步批次上传协接（ADR-015）：直接迁移 upload_events，要求保存的 expected_identity、完整 events 与显式原 idempotency_key，核对已验证未过期 sync.write/admin 身份及继承前置条件。新增专用 MCP 适配、完整共享回执解析、30 秒本地期限和每 Gateway 两笔独立上传准备容量；派发后错误仅标记 unknown，超时保留底层名额。HTTP 小型 sync 封套余量同时支持原事件回执与上传，Artifact 扩容保持独立。范围为 MCP catalog/protocol/适配、server 正文门禁、契约/TODO/R005；不改变持久指纹或自动重试/保存/结算，无新依赖/迁移。仅源码与文档，不编译、类型检查、测试、执行工具/API、运行服务或发布。
2026-11-03 同步变化分页传输协接（ADR-015）：完善既有 GET /v1/sync/changes 的共享完整页面解析、Gateway 返回前校验、SDK getSyncChanges/syncPages 与 MCP get_sync_changes 有界读取。核对完整范围/trace/来源、页大小、唯一事件/严格递增游标和续页水位，保留原事件附加字段与权限过滤跳号。SDK 支持本地期限/取消并固定分页参数，MCP 独立两笔准备容量/30 秒期限；不自动 ack、重试、保存或应用事件。范围扩展 contracts、SDK、Gateway server/http/MCP、契约/README/TODO/R005；确认游标写入和 CLI 适配另续，无新依赖/schema/迁移。仅源码与文档，不编译、类型检查、测试、调用接口、运行服务或发布。
2026-11-03 同步确认身份与当前游标协接（ADR-015）：迁移 sync.ack / acknowledgeSync / acknowledge_sync 为显式原 expected_identity 与安全 cursor，核对可信未过期 sync.read/admin、父项目可见性及单调持久确认，不接收批次键/版本。新增 sync.cursor / GET /v1/sync/cursor / SDK getSyncCursor / MCP get_sync_cursor，读取同一身份的当前确认位点与可信到期提示；当前位点不是原请求历史回执，也不证明本地已保存。共享契约与完整有界响应、SDK 30 秒/取消、MCP 独立读写容量和派发后 unknown 纳入；不自动确认、重试、查询或本地保存。范围为 contracts、Gateway 认证/持久化/server/http/MCP、SDK、契约/README/TODO/R005；CLI 继续可提交完整 JSON，专用恢复入口后续补齐。旧无身份 ack 调用需迁移，无新依赖/schema/迁移，仅源码与文档，不编译、类型检查、测试、调用接口、打开数据库、运行或发布。
2026-11-03 ADR-015 CLI 同步消费入口协接：将 sync changes/ack 从通用执行路径迁入专用 SDK 有界适配，新增 sync cursor。读取可省略 JSON；确认必须提供保存的 expected_identity/cursor，保留 --json 与稳定普通 --json-file 二选一兼容，不新增 reviewed 门槛。三者仅接受可选 --timeout-ms，拒绝 stdin/重复参数/键及版本；输入限 16 KiB。网络及嵌入均固定原范围与输入，嵌入要求可信未过期 sync.read/admin，完整响应经共享契约解析，确认错误区分本次未派发与派发后未知。不自动翻页、确认、查询、重试或持久化。范围为 CLI main/remote/runWorkctx/专用适配、README/契约/TODO/R005；无依赖/schema/迁移，只开发源码和文档，不编译、类型检查、测试、运行或发布。
2026-11-03 ADR-015 本地同步页面保存协接：sync changes 增加 --output，以显式原 expected_identity/起始 cursor 保存完整单页、有效 limit、前页摘要与 SHA-256 校验；复用现有独占临时文件/同步/读回/硬链接不覆盖发布，不创建 SQLite 消费表或迁移。sync inspect --page-file 离线核验并显示恢复参数；changes/ack/cursor 支持互斥 --page-file，分别从完整校验文件派生续页查询、原确认和原身份。保存不代表事件应用、服务端确认或全局最新消费进度，不自动确认/查询/重试/扫描文件。范围为 contracts 新文件格式、CLI consumer/保存与本地检查/main/runWorkctx、README/契约/TODO/R005。目录原子性与掉电保证沿用现有实现边界，可信当前身份仍由 Gateway 核验。只修改源码和文档，不编译、类型检查、测试、运行、打开数据库、迁移或发布。
2026-11-03 ADR-015 本地同步收件箱协接：新增独立 SQLite 收件箱 schema v1 和 SqliteSyncInbox，显式创建新库，已有库不自动建表/升级，不复用 outbox。完整已保存页面按原五字段身份隔离，校验规范 document 摘要；BEGIN IMMEDIATE 内追加不可变页面与推进 received_cursor/head/page_count，首篇必须 cursor=0/无前页，后续必须接当前头摘要与游标/页大小，拒绝缺页/分叉/混身份；重导完全同页不回退头。只表示连续接收，event_application 保持未核验，不调用服务器确认。CLI inbox init/import/status/head 均为本地显式操作，head 可导出已存头页到新文件用于现有恢复命令；状态须核验当前完整头页。范围协接 Bridge inbox/类型导出、CLI main/runWorkctx/本地命令与保存复用、契约/README/TODO/R005。新 SQLite schema 只写源码，不打开数据库或执行迁移；不编译、类型检查、测试、运行或发布。
2026-11-03 ADR-015 收件箱确认日志协接：新增显式启用的 SQLite ack 扩展 v1，不改变核心收件箱 v1、不隐式迁移。发送前事务记录保存页/原身份/目标 cursor/原 trace 与 unconfirmed 意图，每身份最多一笔未解决意图；完整成功响应经共享契约绑定后才能记 confirmed。明确只读观察可记 observed，表示同身份当前确认已达到目标，不能冒充原请求回执；低于目标保持未知。新增本地 inbox enable-ack/ack-status 与网络/嵌入 inbox ack/ack-observe，必须指定已有库与完整原页面文件，复用有界 SDK/30 秒预算，持锁期间不请求网络，不自动重试。范围协接 Bridge 日志/schema/接口、CLI、契约/README/TODO/R005；仅源码与文档，不打开数据库、执行扩展、编译、类型检查、测试、运行或发布。

2026-11-03 ADR-015 固定原目标重试协接：新增显式启用的 dispatch 扩展 v1，首次意图与派发占用同事务登记；重试必须指定最新原派发 ID，固定身份/页面/cursor/request trace，以新派发 ID 记录本次调用。占用期限为请求预算加 60 秒，本地期限届满不证明远端停止；仅显式命令可接替，迟到证据保留在各派发记录中。没有派发记录的旧未知意图不自动补造发送历史，继续允许只读观察。协接 Bridge/CLI/文档/TODO/R005，仅编辑源码，不编译、类型检查、测试、执行命令入口、打开数据库、迁移或发布。

2026-11-03 ADR-015 确认历史读取协接：新增按原身份分页的 ack-history/ack-dispatch-history 与按 ID 的 ack-get/ack-dispatch-get。分页固定首笔读取的上界序号及记录 ID，续页携带原身份/上界，正文证据按各次读取时状态返回，不称为跨页冻结快照。每页有界且仅输出经完整校验的摘要，详情保留完整证据；派发历史可限定原 record_id。均为本地只读，不查询服务器、不改占用、不自动确认/重试，不新增 schema。范围 Bridge/CLI/契约/TODO/R005，仅源码与文档，不编译、类型检查、测试、运行或打开数据库。

2026-11-03 ADR-015 确认凭据文件协接：新增版本化本地 ack-evidence 文件，包含完整原页面、原确认记录和可选精确派发记录；共享解析固定身份/页面摘要/cursor/原 trace/证据状态绑定，适配层独立核验页面与整个凭据文档 SHA-256。ack-get/ack-dispatch-get 可导出到新 --output，读事务结束并关闭库后才写文件；另设不打开数据库的离线 inspect。文件只保留本地历史，摘要不是服务器签名，不能仅凭文件把未知状态升级为 confirmed 或导入释放门禁。协接 contracts/Bridge/CLI/文档/TODO/R005，无 schema/依赖变化，仅开发，不编译、测试、执行接口或打开库。

2026-11-03 凭据恢复协接补充：增加 inbox ack-evidence-page，从完整核验的凭据中把内嵌原页面单独保存到新文件，复用已有 saved-page 格式/摘要/原 trace 与不覆盖保存。只有使用方另行选择已有同步或 inbox 命令时才继续消费；提取本身不打开库或请求服务器。

2026-11-03 ADR-015 旧确认意图显式恢复协接：新增独立 recovery 扩展 v1，不修改 core/ack/dispatch v1。ack-recover 必须指定最新原 record_id 与原页面，仅对缺派发历史的 unconfirmed 原意图登记恢复；恢复凭据与首笔新派发同事务提交，保存“此前本地派发记录缺失、此前远端结果未知”，不补造历史发送。重复恢复/已有派发转向精确 ack-retry，终态只返回本地结果。enable-ack-recovery 显式启用，ack-recovery-get 按原身份/record_id 本地读回。恢复保留原身份/cursor/trace，不能阻止旧客户端/远端仍在执行；不自动恢复或换目标。范围 Bridge/CLI/文档/TODO/R005，仅源码，不编译、测试、执行扩展、打开库或运行服务。

2026-11-03 ADR-015 恢复凭据档案协接：新增 ack-evidence 文档 v2，携带完整原页面/原记录/恢复首派发及不可变恢复凭据。v1 原字段与规范序列化保持不变，现有 ack-get/ack-dispatch-get 仍生成 v1；仅 ack-recovery-get --output 明确生成 v2。共享解析核对恢复 ID、原 record_id、first_dispatch_id、调用 trace/登记时间和此前未知标志；离线 inspect/page 接受两版，不迁移旧文件或写回日志。范围 contracts/Bridge/CLI/文档/TODO/R005，无新数据库 schema，仅源码，不编译、类型检查、测试、打开库、生成样本或发布。

2026-11-03 确认调用结果独立保留协接（ADR-015）：CLI ack/ack-retry/ack-recover/ack-observe 增加显式 --result-output，新路径在打开库/请求前预检；仅当本次取得完整匹配服务器结果时保存独立 sync-ack-result v1。保存原页面、请求前原记录/派发快照、本次 invocation trace、完整结果及日志更新是否确认；不把未入库结果拼造为已确认日志，也不把本地重放当作新服务器结果。日志失败时保持原错误和 server_result，文件保存失败另附状态；普通成功的文件失败同样保留完整服务器结果。关闭库后保存，复用不覆盖文件发布/读回；新增离线 inspect/page，不导入或结算日志。范围 contracts/CLI/文档/TODO/R005，无新 schema/依赖，只开发，不编译、类型检查、测试、运行服务/CLI、打开库或发布。

2026-11-03 收件箱完整页面链审计协接（ADR-015）：Bridge 增加 auditPages，CLI 增加本地 inbox audit-pages --inbox 与 expected_identity/max_pages JSON。在一个只读事务中核对消费者行数、实际页面行数与头检查点，从头沿前驱逐页校验完整页面/摘要/原身份/序号/游标/limit，直到从零根页；计数必须覆盖所选 consumer_key 的全部页面，不把头/相邻前页核验当成全链审计。默认最多 1000 页，可显式提高到安全正整数；预算不足明确未完成，不返回局部通过，不生成跨快照续页凭据。只报告所选消费者页面链，不声称全库物理完整性、约束定义或确认/派发/恢复历史审计；不修复、不修改、不请求网络。范围 Bridge/CLI/契约/README/TODO/R005，无新 schema/依赖，仅源码文档，不编译、类型检查、测试、运行命令、打开库、迁移或发布。

2026-11-03 历史页面选择与恢复协接（ADR-015）：Bridge 增加原消费者页面摘要分页和精确 document_sha256 读取，CLI 增加 inbox page-history/page-get。分页默认 20、最多 50，续页固定原身份/上界序号与摘要，并绑定上次末页序号/摘要；单次读事务核验当前头、边界和返回页面及其相邻前页，缺页/边界变化拒绝，不声称跨命令快照或全链审计。page-get 可输出完整原页，或 --output 独占保存原格式到新文件；无目标不导出空文件。范围 Bridge/CLI/契约/README/TODO/R005，无 schema/依赖变化，不写库或请求网络；仅开发，不编译、类型检查、测试、运行 CLI、打开库或发布。

2026-11-03 确认历史只读审计协接（ADR-015）：新增 Bridge auditAcknowledgements 与 CLI inbox ack-audit，严格 expected_identity/max_entries 查询（默认 1000、安全正整数）。已有 ack 扩展必需；按已知对象探测可选 dispatch/recovery，部分存在必须完整核对后才读，完全缺失单独报告，不隐式启用。在单次读事务核对实际总行数预算、全量原确认/派发序号与完整证据/原页绑定、待确认/active 唯一性、恢复首派发元数据及跨消费者引用。无派发/恢复凭据不推断旧远端结果，不重算租约或写状态。区分数据损坏和存储不可读，补正底层派发/恢复读取中异常被过宽捕获的问题。只审计所选消费者及其关联边界，不替代页面链/物理库/schema 定义审计。范围 Bridge/CLI/契约/README/TODO/R005，无 schema/依赖变化，仅开发，不编译、类型检查、测试、打开库或运行。
2026-11-03 本地消费者发现协接（ADR-015）：Bridge 增加 listConsumers，CLI 增加 inbox consumers，用已有收件箱找回完整原身份和已校验接收位置。查询仅限 limit/after_consumer_key，默认 20、最多 50，按规范身份摘要键升序续页；每次单独读取事务，成员和状态为当次快照，不设置虚假的跨命令固定上界。选择行需通过规范身份 JSON/摘要键校验，返回项另核验检查点、完整头页与相邻前页，损坏不得跳过。外层 scope=null，条目包含完整原身份；不借当前账户筛选或赋予远端权限。范围 Bridge/CLI/契约/README/TODO/R005，无 schema/依赖变化，只修改源码文档，不编译、类型检查、测试、打开库、运行或发布。

2026-11-03 完整页面链归档协接（ADR-015）：增加 workctx.sync-page-chain v1 共享文件契约、Bridge readPageChainArchive/restorePageChainArchive 及 CLI inbox export-pages/inspect-pages/restore-pages。单消费者完整根到头归档，最多 1000 页、16 MiB 文档，复用逐页解析及独立 SHA-256 校验；导出同一读事务核验实际行数与整链，离线检查不打开库。恢复只允许空消费者或完全相同的已有完整链；BEGIN IMMEDIATE 内写入全部页面及检查点，失败回滚、提交异常保持 unknown，不合并或覆盖不同链。归档文件不携带确认/派发/恢复日志、租约或已应用状态，不能作为全库备份或服务器认证。范围 contracts/Bridge/CLI/契约/README/TODO/R005，关联 T0.5/T3.4/T4.3，无 schema/依赖变化，仅源码文档，不编译、类型检查、测试、运行命令、打开库或发布。

2026-11-03 页面链前缀比较与显式追加协接（ADR-015）：新增 Bridge comparePageChainArchive/appendPageChainArchive 及 CLI inbox compare-pages/append-pages。比较在单次读事务完整审计本地链，逐页核对归档重叠部分，报告相同、本地为空、本地前缀、归档前缀或分叉；只为相同/可追加前缀生成绑定原身份、归档摘要和本地头摘要/页数的 append_query。追加必须显式提供该查询，BEGIN IMMEDIATE 中重新检查整链和检查点，仅追加未保存后缀，提交前全链读回；过期计划、分叉或较旧归档拒绝。原 restore-pages 的空目标/完整相同规则不变。范围 Bridge/CLI/契约/README/TODO/R005，无 schema/归档格式/依赖变化，仅源码文档，不编译、类型检查、测试、打开库、运行或发布。

2026-11-03 页面链追加查询保存协接（ADR-015）：compare-pages 增加可选 --output NEW_QUERY，预检新路径后执行原只读完整比较，仅在兼容时将本次 append_query 四字段对象保存为可直接交给 append-pages --json-file 的文件。保存发生在读事务结束并尝试关闭连接后，使用独占临时文件/不覆盖发布及最终字节/解析读回；不同链不生成计划，文件失败保留完整比较和恢复路径。文件不包含新授权或租约，不重新读头替换已选定检查点，追加仍逐项重核过期前提。范围 CLI/契约说明/README/TODO/R005 与 T4.3，无共享格式/schema/依赖变化；仅源码文档，不编译、测试、打开库、生成文件或运行。

2026-11-03 页面链归档离线选择协接（ADR-015）：新增 CLI inbox archive-history/archive-page，从完整核验后的现有归档分页查看页面摘要、按精确摘要读取或提取单页，整个分支不加载 Bridge 或打开数据库。历史默认 20、最多 50，续页必须绑定原归档 document_sha256；精确详情同时绑定归档和页面摘要，文件被替换为不同文档时拒绝。提取保留原页面格式/下载 trace/摘要，以新文件独占发布及读回，不导入、确认或将归档当作当前服务端状态。范围 CLI/归档契约说明/README/TODO/R005 与 T4.3，无共享格式/schema/依赖变化，仅源码文档，不编译、类型检查、测试、打开库、生成样本或运行。
2026-11-03 离线结算失败回执保留协接（ADR-015）：Bridge 原事件核对在完整回执验证后保留本次回执，即使后续预算、并发比较、本地证据冲突或事务提交失败。新增核对专用事务状态，区分未提交与提交未知，回滚失败不遮蔽原错误；CLI 关闭失败保留原错误/回执及 close_pending。范围为 Bridge/CLI 源码、原核对契约、README、T3.4/T4.3、TODO/R005。无离线回执导入结算、自动重发、schema/依赖变化；仅开发源码文档，不编译、类型检查、测试、打开数据库、执行命令或发布。
2026-11-03 原事件回执文件协接（ADR-015）：新增共享 workctx.sync-event-receipt v1 文件，仅包装完整查询回执及文档摘要；CLI outbox reconcile 可选 --result-output，在核对结束并尝试关闭库后独立保存完整已验证回执，失败分支同样可保存。新增 outbox inspect-result --result-file 离线完整核验/查看，不打开库或请求服务。保存状态不替代本地结算状态，摘要不提供服务器认证，不允许文件导入结算或自动重发。范围 contracts/CLI/README/核对与文件契约/T0.5/T4.3/TODO/R005，无新依赖/schema/迁移；仅源码文档，不编译、类型检查、测试、生成样本、打开库、执行命令或发布。
2026-11-03 发送队列有界读取协接（ADR-015）：将 CLI outbox list 从全量 inspect 改为现有队列的只读摘要分页，默认 20/最多 50，按原项目/可选状态及 BINARY event_id 续页；新增 outbox get EVENT_ID 完整读取并校验原命令，活跃发送可查看但不抢占。Bridge 增加 listRecords/readRecord、只读现有库模式、受限 SQL 投影与读取事务；旧 inspect 仅保留兼容，不用于新读取/恢复。列表不返回正文或宣称内容完整，损坏元数据/详情明确错误，不补空 payload。范围 Bridge/CLI/README/读取契约/T3.4/T4.3/TODO/R005，无依赖/schema/迁移变化；仅源码文档，不编译、类型检查、测试、打开数据库或运行。
2026-11-03 工作台原同步回执协接（ADR-015）：新增 /sync/receipt 页面及同源有界查询代理，载入完整原 identity/event 或 workctx.sync-event-receipt v1 文件后显式查询既有 Gateway 原回执。文件结构/摘要离线验证，历史导入结果与本次可信查询分开展示，不自动补当前身份、上传、确认游标或结算本地队列。保留原查询/最新完整响应并支持下载原查询及回执文件，浏览器下载仅表示交付尝试。范围 Web 源码/导航、原回执与文件契约、T5.1/TODO/R005；不变更 Gateway/SDK/共享文件格式，不放宽全局 Server Action 限额，无依赖/schema/迁移。只开发源码文档，不编译、类型检查、测试、浏览器/服务运行或发布。

2026-11-03 同步原查询浏览器恢复协接（ADR-015）：本轮范围为 T5.1 的 /sync/receipt、独立浏览器 original-store、运行契约/TODO/R005。新增显式 IndexedDB 原查询保存、每页 20 条加一条前瞻的元数据目录及完整原文载入；按五字段原身份与 event_id 固定槽，同槽异文/损坏拒绝覆盖。originals 与 directory 同事务添加并读回，查询结果和导入历史不自动持久化；目录不证明正文或远端状态，载入重新绑定完整原查询。读取不存在的库中止初始化，显式保存才建 v1 schema；不自动迁移/修复。打开及事务各 10 秒本地预算，页面卸载取消等待，失败保留内存与导出。无 Gateway/共享契约/SQL/依赖变化，只编辑源码和文档，不编译、类型检查、测试、执行浏览器/服务、打开数据库或发布。

2026-11-03 浏览器同步回执历史协接（ADR-015）：本轮 T5.1 增加显式保存完整 v1 回执文件和历史目录恢复，复用既有文件格式/摘要解析。独立 planemem-sync-receipts v1 按文档摘要保存不可覆盖内容及有界目录，多次不同查询保留各自原 trace，不设置伪造的最新时间或覆盖旧记录。原查询存储的连接/事务/成对读取保护提取为本目录内共享助手，保持原库名称/schema/行为；新库只由明确保存初始化。摘要工作在事务外，载入完整核验摘要/所选目录，保存前核验并在同事务添加/逐字读回；历史来源单独展示，后续查询仍需明确操作。范围 Web 原回执页面/model/存储助手、运行契约、T5.1/TODO/R005，无共享格式/Gateway/SQL/依赖变化；只编辑源码文档，不编译、类型检查、测试、运行或发布。

2026-11-03 SDK 离线原事件回执文件协接（ADR-015）：本轮范围为 T0.5 的 packages/sdk 独立文件编码/检查模块、根及独立子路径导出、README、文件运行契约、TODO/R005。复用既有 v1 文件格式和完整共享解析，使用 WebCrypto 独立核验文档摘要/完整输入字节摘要；输入字节在首次异步等待前复制，支持有界 UTF-8 JSON 文本/Uint8Array，检查可绑定指定原查询和文档摘要。离线函数无需 WcpClient/凭据/文件路径/数据库/网络，输出仅 prepared 或 inspected 和历史来源，不代表已保存、已应用或当前服务器确认。复用单调本地等待预算，错误映射为文件专用类别，不透传正文或底层异常。无共享格式/Gateway/Web/CLI/SQL/依赖变化；只开发源码文档，不编译、类型检查、测试、运行 SDK、生成样本或发布。

2026-11-03 收件箱本地投影应用协接（ADR-015）：本轮 T3.4 扩展 inbox/application-model、application-schema、applications 和 SqliteSyncInbox 公共包装，新增显式应用扩展初始化、固定原消费者/应用名称版本的投影读取、指定原页及预期应用前驱的同步 reducer 事务。调用方提供受信同步事件处理函数，每个类型必须显式支持；输入页面/当前投影先完整核验，处理结果仅写本地投影快照，事件去重记录/不可变页面步骤/应用头同事务保存并读回。应用状态独立于 received_cursor/ack，不把任意页面接收提升为应用成功。投影上限 1 MiB，单页处理有字节/调用/单调时间边界；未知事件、异步 handler、过期前驱、损坏或重复事件拒绝整页。范围 Bridge/README、独立运行契约、TODO/R005；无 Gateway/CLI/共享格式/依赖变化。新 SQLite 扩展只写源码，不打开库、执行 schema、编译、类型检查、测试、运行或发布。具体业务 reducer、CLI 选择与应用历史审计/导出仍须后续接入。
2026-11-03 收件箱应用状态 CLI 协接（ADR-015）：本轮跨 T3.4/T4.3 接入 inbox enable-applications 与 inbox application-status，复用既有 Bridge 应用扩展和严格查询。启用仅接受已有库路径；查询须显式给出完整原身份及 application 名称/版本，可含本地 timeout_ms，解析完成后才只读打开库。主程序/嵌入调用均走本地分流，无账号/令牌/网络；完整投影与本地应用边界原样保留，关闭失败不覆盖结果或原提交未知状态。范围 CLI 源码/帮助/README、应用运行契约、任务协调/TODO/R005；不增加业务 reducer、执行应用命令或 schema。只开发源码和文档，不编译、类型检查、测试、执行 CLI、打开数据库、初始化/迁移或发布。
2026-11-03 上下文生命周期同步应用协接（ADR-015）：本轮跨 T0.5/T3.4/T4.3 新增共享 ContextItemCreated/Updated/Confirmed/Archived/Restored 同步事件解析、固定 context-item-lifecycle/1 本地元数据投影及 CLI application-apply。按现有 Gateway 生产者的 item_id/version/status/archived 四字段处理，不虚构正文/权限/当前来源检查。必须从创建版本 1 起连续推进，确认仅允许 proposed，归档/恢复按原状态迁移；缺基线/断档/分类改变/不支持事件拒绝整页。明确列出其他当前同步类型为本投影范围外，只保留原应用 ledger，未知类型不忽略。复用原页/预期前驱事务与 1 MiB/64 MiB 边界，CLI 只内置适配器不加载外部代码；应用状态与 ack 独立。范围 contracts/Bridge/CLI/README/运行契约/TODO/R005，无新依赖/schema，不运行编译、类型检查、测试、CLI、数据库或迁移。任务完成后按用户要求提交并推送 main，提交带 [skip ci]。
2026-11-03 应用历史结构审计协接（ADR-015）：本轮 T3.4/T4.3 增加 auditApplicationHistory 和本地 application-audit，固定完整原身份/application，在同一只读事务完整遍历应用头到根，核对实际步骤/事件计数、原页链、全部快照摘要/事件 ledger 及空页投影不变性。按页数/事件数/累计文档快照字节/时间限定，超限明确未完成；不重跑 reducer、不修复、不发送 ack，不把结构审计当作业务语义或服务器认证。范围 Bridge/CLI/README/应用审计契约/TODO/R005，无新 schema/依赖；只开发源码文档，不编译、类型检查、测试、运行 CLI/数据库或迁移。完成后独立提交推送 main，提交带 [skip ci]。
2026-11-03 应用历史浏览协接（ADR-015）：T3.4/T4.3 新增 readApplicationHistory/readApplicationSnapshot 与 CLI application-history/application-get。列表固定首次应用头的序号/原页摘要/投影摘要，续页同时绑定末项三元边界，默认20/最多50，完整核验选中步骤/事件 ledger 和一条前瞻；详情按原页摘要读取完整历史投影，可绑定预期投影摘要。当前应用头独立摘要展示，不回退或重放。读取有64MiB选中源文档/投影字节预算及原查询时间预算，拒绝边界变化/断链/损坏，不自动升级、导出、恢复或确认。范围 Bridge/CLI/契约/README/TODO/R005，无schema/依赖变化，仅源码文档，不编译、类型检查、测试、运行或数据库操作。完成后单任务提交推送main，带[skip ci]。
2026-11-03 应用历史重放协接（ADR-015）：T3.4/T4.3 增加内置 context-item-lifecycle/1 只读历史重放核对及 CLI application-replay。单次读取事务先完整结构审计，再从 JSON null 按原页/事件正序运行当前固定内置 reducer，逐页比对完整保存投影；返回本次范围/进度/预算和适配器，不写入或修复历史。严格查询在打开库前选择固定适配器，沿用结构页/事件/源字节/时间限额，新增累计重算字节限额并保持单页 64 MiB、投影 1 MiB。失败保留精确页/事件位置与安全诊断，不回显异常正文、不报部分通过。范围 Bridge/CLI/契约/README/TODO/R005，无 schema/依赖变化；只开发源码文档，不编译、类型检查、测试、运行 reducer/CLI 或打开库。完成后单独提交推送 main，带 [skip ci]。
2026-11-03 应用目录协接（ADR-015）：T3.4/T4.3 新增 readApplicationCatalog 与 CLI application-list，按完整原消费者列出已持久应用名称/版本和当前头摘要。原身份必填，默认20/最多50，按应用摘要键BINARY顺序续页；严格核验应用描述与摘要键及每个选中头/原页/ledger（含一条前瞻），返回原应用查询、固定本次上界的历史查询和指定快照查询。单一只读事务，64MiB逐应用源文档/投影预算、512KiB响应和原本地期限；不输出投影正文或冒充全库/全历史审计，不冻结跨调用目录，缺描述的孤立行不在目录范围。范围Bridge/CLI/契约/README/TODO/R005，无schema/依赖变化，仅源码文档，不编译、类型检查、测试、运行或数据库操作。完成后单独提交推送main，带[skip ci]。
2026-11-03 应用历史归档协接（ADR-015）：T0/T3.4/T4.3 新增独立应用归档v1共享契约（完整原身份/应用描述、根到应用头的原页面及逐页投影/摘要/原应用trace），最多1000页、文档16MiB、投影1MiB；空页保持前投影，跨页事件ID唯一，适配层核对全部页面/投影/外层摘要。Bridge只读完整结构审计后导出，CLI application-export独占保存并最终读回，application-inspect离线摘要、application-archive-get绑定档案/页面摘要读快照；离线入口不加载Bridge/数据库。文件工作在释放读取事务并尝试关闭后进行，失败保留路径/关闭状态；归档不认证来源/业务语义，不包含未应用接收后缀、确认日志或数据库物理状态，本任务不实现导入恢复。范围共享契约/Bridge/CLI/文档/README/TODO/R005，无schema/依赖变化；只开发，不编译、类型检查、测试、运行、生成样本或打开库。完成单独提交推送main，带[skip ci]。
2026-11-03 应用归档恢复协接（ADR-015）：T3.4/T4.3 新增 restoreApplicationArchive 与 CLI application-restore，严格原身份/应用/归档摘要查询在打开库前绑定。单次 BEGIN IMMEDIATE 内只允许空应用或完整相同历史；完整核对已有接收链与归档重叠前缀，可保留较新接收后缀或追加缺失原页，再原子插入逐页投影/原trace、由原事件派生ledger及应用头，并完整审计读回；不覆盖/回退/合并不同应用历史。源链每遍最多10000页/64MiB，应用归档沿用1000页/16MiB/1MiB投影，默认30秒最多90秒事务期限。提交/回滚异常保留unknown与归档查询/恢复进度，不把重试自动当新请求。需要已有core与application扩展，不初始化schema、不运行reducer、不确认远端，不认证归档来源/业务语义。范围Bridge/CLI/契约文档/README/TODO/R005，无schema/依赖变化；只开发，不编译、类型检查、测试、执行restore或数据库，完成单独提交推送main，带[skip ci]。
2026-11-03 应用恢复预览协接（ADR-015）：T3.4/T4.3 新增 previewApplicationArchiveRestore 与 CLI application-restore-preview，沿用完整原身份/应用/归档摘要查询，在只读打开已有库前验证文件，单一只读事务完整审计目标应用历史和原消费者接收链。共享恢复比较逻辑，输出空/相同/前缀/较长/分叉关系、首个正序差异摘要、可恢复性及预计写入数量；合法不兼容历史返回 conflict，损坏/预算不足仍报未完成。预览不输出投影正文、不初始化/写入/reducer/确认，结果只代表本次快照，不锁定后续目标；实际恢复重新核对。源链10000页/64MiB、应用1000页/16MiB、默认30秒最多90秒，512KiB预览响应；无schema/依赖变化，仅源码文档，不编译、类型检查、测试、运行接口或打开库。完成单独提交推送main，带[skip ci]。
2026-11-03 应用恢复目标绑定协接（ADR-015）：T3.4/T4.3 在严格恢复/预览查询新增可选 expected_target={schema_version:1,application_history_sha256,received_history_sha256}，旧查询维持原兼容恢复策略，新预览返回绑定完整目标逻辑历史的 restore_query。共享比较在完整结构审计后给出域隔离的确定性流式摘要，覆盖原消费者/应用键、头到根每页摘要、逐页投影摘要/原应用trace及总页/事件数；接收摘要含全部较新后缀。实际恢复在同一写事务内、任何插入前分别核对应用/接收摘要，变化报 TARGET_CHANGED，前后读回不误用原目标约束。预览带旧约束时不静默换新，返回 conflict 与原/观察目标；未知提交保留原约束，不因目标变化认定未写入。成功提供前后目标摘要；不锁定跨调用、不持久保存预览、不认证来源。范围Bridge/CLI/契约文档/README/TODO/R005，无schema/依赖变化，仅源码文档，不编译、类型检查、测试、运行接口或打开库；完成单独提交推送main，带[skip ci]。
2026-11-03 应用恢复请求保存协接（ADR-015）：T4.3 为 application-restore-preview 增加可选 --output NEW_FILE，保存严格的原恢复查询 JSON（含 expected_target），可直接用于既有 application-restore --json-file，不新增封装格式或schema。输出路径在打开库前预检，预览事务结束并尝试关闭后，仅 restore_allowed=true 时保存；冲突保留正常预览并标记未创建，不自动刷新目标或执行恢复。复用独占临时文件/同步/读回/硬链接发布，最终有界读回核对全部字节/摘要，失败保留原查询、输出/临时路径、清理/关闭状态；发布后未确认不删除目标。512KiB响应与16KiB查询上限，保存不在数据库事务期限内。范围CLI/契约文档/README/TODO/R005，无schema/依赖变化，仅源码文档，不编译、类型检查、测试、运行命令、生成样本或打开库；完成单独提交推送main，带[skip ci]。

2026-11-03 应用恢复持久回执协接（ADR-015）：新增显式可选 application-restore-receipts v1 扩展，不修改 core/application v1。恢复查询可显式携带 restore_request_id，按原消费者/应用/请求 ID 登记完整规范查询摘要和紧凑历史结果；回执与原页面、应用历史同事务写入并读回。相同 ID/相同查询只返回原回执，不重放或将当前投影冒充历史结果；不同查询复用 ID 明确拒绝。新增只读精确查询与显式启用入口，预览保留 ID，命中回执时不再生成恢复计划。缺记录仅表示本次数据库快照未观察到，不能推断未知提交已回滚；保留原请求、约束和错误。范围 Bridge/CLI/契约/README/TODO/R005，仅源码文档；不编译、类型检查、测试、打开数据库、执行扩展/命令、生成样本或发布，evidence 为空。

2026-11-03 应用恢复原查询找回协接（ADR-015）：新增只读 application-restore-receipt-get，按完整原身份/应用/restore_request_id 获取完整已校验历史回执及原恢复查询；本次读取 timeout_ms 独立于回执中的原 timeout_ms，不替换原目标约束、归档摘要或请求 ID。保留已有完整查询精确核对入口，新增选择不接受归档摘要/目标约束。可选 --output 在打开库前预检，结束读事务并尝试关闭后仅对已找到回执独占保存原查询 JSON；缺记录不生成文件、不推断回滚。范围 Bridge/CLI/契约/README/TODO/R005，无新 schema/依赖；仅源码文档，不编译、类型检查、测试、运行接口/CLI、打开库、生成样本或发布。

2026-11-03 应用恢复回执目录协接（ADR-015）：新增 application-restore-receipt-list/listApplicationRestoreReceipts，按完整原身份/应用只读分页发现请求 ID。默认 20、最多 50，按请求 ID 的 BINARY 升序续页，不解释为时间顺序或跨命令冻结快照；下一页查询保留原范围/读取预算与末条 ID。逐条完整校验选中回执和额外一条前瞻记录后才输出紧凑历史摘要、原请求摘要及 get 查询；缺记录不推断回滚、不审计当前投影、不自动执行恢复。范围 Bridge/CLI/契约/README/TODO/R005，无 schema/依赖变化；仅源码文档，不编译、类型检查、测试、运行接口/CLI、打开库、生成样本或发布。

2026-11-03 应用恢复回执文件协接（ADR-015）：新增共享 workctx.sync-application-restore-receipt v1 文档/文件，完整保留既有规范原查询和历史回执；抽取查询/目标/回执结构解析到 contracts，固定现有字段顺序和数据库回执 JSON，SHA 仍由 Bridge/CLI 独立核验。get 新增与 output 互斥的 receipt-output，结束读取并尝试关闭后独占保存；新增离线 inspect/query，仅文件核验/原查询提取，不加载 Bridge、不打开库或导入结算。缺回执不导出空文件，文件失败保留历史结果、路径及关闭状态；摘要不认证来源。范围 contracts/Bridge/CLI/文档/T0.5/T3.4/T4.3/TODO/R005，无 schema/依赖变化，仅源码，不编译、类型检查、测试、执行命令、生成样本、打开库或发布。

2026-11-03 跨消费者应用恢复回执目录协接（ADR-015）：新增 listApplicationRestoreReceiptScopes / inbox application-restore-receipt-scopes，直接从独立回执表按 consumer_key/application_key 二元 BINARY 键分页，覆盖未创建消费者或应用头的空恢复回执。严格 limit/timeout_ms 与成对续页键，默认 20、最多 50；单次只读事务完整核验每个选中范围及额外前瞻的一个确定代表回执，恢复原身份/应用并生成现有 list/get 查询。只声明代表回执核验，不宣称范围内全部记录审计、时间顺序或跨页冻结；外层 scope=null，续页取最后返回项，完整响应 512 KiB，错误保留查询/未完成/关闭状态。范围 Bridge/CLI/文档/T3.4/T4.3/TODO/R005，无共享格式/schema/依赖变化，仅源码，不编译、类型检查、测试、执行命令、打开库或发布。

2026-11-03 应用恢复回执完整范围审计协接（ADR-015）：新增 auditApplicationRestoreReceipts / inbox application-restore-receipt-audit，严格原身份/应用与 max_receipts（默认 1000、上限 10000）、max_bytes（默认 64 MiB、上限 512 MiB）、读取 timeout_ms。已有 core/application/receipt 扩展必需，单次只读事务先有界核对实际行数，再按 BINARY ID 分批完整核验所有回执和累计规范字节；不依赖消费者/应用头，支持 empty 恢复。超预算、缺失/损坏、存储或事务失败均未完成，保留原查询、阶段/计数、选中 ID 和关闭状态；不输出部分通过或跨快照续页。仅证明所选本地历史回执自洽，不证明当前应用/接收链、服务器结果、来源或全库完整性。范围 Bridge/CLI/文档/T3.4/T4.3/TODO/R005，无 schema/共享格式/依赖变化，只开发，不编译、类型检查、测试、运行 CLI/接口、打开库或发布。

2026-11-03 建议生命周期同步投影协接（ADR-015）：按 Gateway proposals 现有 ApprovalRequested/Completed（aggregate_type=Proposal）生产者新增严格 proposal-sync 契约和固定 proposal-lifecycle/1 内置适配器。仅历史元数据，保存原 requested/latest 事件，创建 proposed/revision1 到 verified 或 rejected/revision2，严格原身份/来源/ID/分类/种类与递增游标，缺创建基线、重复终态、未知类型整页拒绝。最多 512 个建议，固定忽略现有其他 12 类事件，不含正文/理由/到期时间或来源授权事实。集中内置适配器选择，apply 与 readonly replay 按显式名称版本选择同一实现，既有 context-item-lifecycle/1 行为不变；通用历史/归档/恢复沿用。固定安全错误增加 INBOX_PROPOSAL_*，未知提交语义不变。范围 contracts/Bridge/CLI/文档/T0.5/T3.4/T4.3/TODO/R005，无 schema/依赖/Gateway wire 变化，仅源码，不编译、类型检查、测试、运行 reducer/CLI/接口、打开库、生成样本或发布。

2026-11-03 冲突生命周期同步投影协接（ADR-015）：按现有 sync-upload/conflict-persistence 生产者新增 conflict-sync 严格共享解析和 conflict-lifecycle/1 内置适配器。保存完整 detected/latest 原封套及已记录 resolved_value，缺检测基线不补造；当前检测版本1到决策版本2，严格同原 conflict/entity/field/三版本、递增游标与 prepend conflict 来源关系，分类可上调但不下调（对应当前源分类抬升）。原 client-event/实体来源后缀及 payload actor 与封套可选 actor 的规则一并校验；旧外部 conflict_id 的 resolved 封套可解析，但缺原检测时拒绝应用。固定忽略另12种现有事件，未知类型整页拒绝，最多512冲突及既有字节预算。集中选择器接 apply/replay，旧 context/proposal v1 规则保持；不把本地 resolved 当作源字段已更新、当前授权或原请求回执。范围 contracts/Bridge/CLI/文档/T0.5/T3.4/T4.3/TODO/R005，无 schema/依赖/Gateway wire 变化，仅源码，不编译、类型检查、测试、执行 reducer/CLI/接口、打开库、生成样本或发布。

2026-11-03 原页应用只读预览协接（ADR-015）：跨 T3.4/T4.3 增加 Bridge previewBuiltInApplicationPage 与 CLI inbox application-apply-preview，复用实际 apply 的完整原查询、固定内置适配器、页面选择/前驱/事件去重/同步归约及投影校验。抽取共享准备流程，实际写入保持原事务；预览只读打开已有库，在单次读事务返回当前已存状态和独立的预计投影/摘要/游标/事件数，完整响应上限 3 MiB。已应用页只核验原前驱和历史快照、返回当前已存状态，不重跑或回退。失败保留原查询/处理阶段和关闭状态；预览不写快照/ledger/回执、不确认，不提供未来执行保证，实际应用重新检查。范围 Bridge/CLI/文档/TODO/R005，无共享格式/schema/依赖变化；仅源码文档，不编译、类型检查、测试、运行 CLI/reducer、打开库、迁移或发布；完成后独立提交推送 main，使用 [skip ci]。
2026-11-03 待应用原页发现协接（ADR-015）：跨 T3.4/T4.3 增加 readBuiltInApplicationPendingPages 与 CLI inbox application-pending。严格原身份/固定内置 application/limit/timeout 查询，在已有库单次只读事务核验应用头及接收头，从应用头后选择连续待处理页（默认20、最多50，加一页前瞻）；原页完整核验、前驱/序号/游标/limit 连续，64 MiB 所选原页字节预算，完整响应512 KiB。返回已存应用检查点、接收检查点、窗口内原页摘要及仅首待处理页的 next_apply_query，空终页按页序号发现；有更多页时在显式应用推进后重新读取，不提供跳页续读。列表不执行 reducer，不声明业务可应用或全历史审计，不写入、确认或自动处理。失败保留原查询/阶段/选中页和关闭状态。范围 Bridge/CLI/文档/TODO/R005，无共享格式/schema/依赖变化；仅源码文档，不编译、类型检查、测试、运行 CLI/reducer、打开库、迁移或发布；完成后独立提交推送 main，使用 [skip ci]。

2026-11-03 浏览器同步保存副本移除协接（ADR-015）：T5.1 增加原查询/历史回执单条审阅后移除。目录选择先完整读取核验，独立审阅保留完整规范原文、原身份/事件及回执摘要，支持下载/复制；用户再次明确确认后，在已有库 readwrite 事务重读原文/目录，严格匹配已审阅原文和元数据，再同事务删除两槽并读回缺失。回执先在事务外独立核验 SHA，事务内比对完整原字节防止异步间隙变化；缺两槽返回 not-present，单边/损坏/异文拒绝，删除不初始化空库。成功或未知失败均保留审阅副本到用户关闭，忙碌/卸载/期限保护延续；不联动删除其他存储、远端回执或本地队列，不撤销投递、不批量清理。范围 Web 同步 receipt 存储/组件/文档/TODO/R005，无 shared wire/API/schema/依赖/迁移变化；仅源码文档，不编译、类型检查、测试、启动浏览器/服务、访问 IndexedDB 或发布；完成后单独提交推送 main，使用 [skip ci]。

2026-11-03 浏览器原查询批量备份恢复协接（ADR-015）：跨 T0.5/T5.1 增加 workctx.sync-originals-backup v1 独立文件与浏览器专用备份页，完整保存原 identity/event 查询，最多256条、文档32 MiB，按现有六字段原槽键排序唯一，文档SHA独立校验。导出在单次只读事务核对原文/目录总数与全部成对记录，缺失库为空，超限或损坏不出部分备份；显式恢复先核验文件并审阅，在单个 readwrite 事务核对所选全部现有槽后只add缺失项、成对读回，异文/单边/损坏拒绝整批，保留其他记录。导入不自动恢复，恢复不覆盖删除、不联系服务器或结算队列；文件与失败结果保留，空恢复不建库，限时/卸载保护延续。只覆盖原查询，历史回执批量备份另待补。范围 contracts/Web/README/契约/TODO/R005，无现有wire/API/schema/依赖/迁移变化；仅源码文档，不编译、类型检查、测试、运行浏览器/服务、访问 IndexedDB、生成样本或发布；完成后独立提交推送main，使用[skip ci]。

2026-11-03 浏览器历史回执完整备份恢复协接（ADR-015）：跨 T0.5/T5.1 新增 workctx.sync-receipts-backup v1，按文档 SHA 唯一递增保存完整既有历史回执文件，最多256份/32 MiB，整份及逐回执摘要均独立核验。单次只读事务计数并核对全部正文/目录，事务结束后验证全部摘要，损坏/超限不返回部分备份；显式恢复先重新核验文件所有摘要，再同一写事务预检全部目标、仅add缺失槽并完整读回，异文/单边损坏整批拒绝。专用新标签页审阅、完整下载/复制、确认恢复、结果未知保留文件；抽取与原查询共用的整笔限时/摘要和审阅组件，旧格式语义保持。恢复只写历史回执库，不生成原查询、不查询服务器、不确认投递或结算队列。范围 contracts/Web/文档/TODO/R005，无 API/schema/依赖变化；仅源码，不编译、类型检查、测试、运行浏览器/服务、访问 IndexedDB、生成样本或发布；按任务提交推送 main，使用 [skip ci]。

2026-11-03 发送队列完整原记录核验协接（ADR-015）：跨 T3.4/T4.3 增加 SqliteOutbox.auditRecords 与本地 outbox audit。严格原项目范围及 max_events/max_bytes/timeout_ms，默认1000行/64 MiB/30秒，最多10000行/512 MiB/90秒；单个只读事务先有界计数，再按 BINARY event_id 分批核验全部原记录、原身份、payload/完整命令摘要及范围内事件/幂等键唯一性，缺身份/损坏/超限整笔未完成。返回完整核验数量、原文本字节/状态和租约统计，非远端证明；失败保留查询/阶段/已核验进度/选中事件及回滚/关闭状态，不返回部分通过。复用单条读取的有界 SQL 投影和原命令核验，允许查看活跃发送但不续租/重试/结算。CLI 网络主程序与嵌入共用只读已有文件入口，输入先核验再打开，无 schema/依赖/API 变化。范围 Bridge/CLI/README/契约/TODO/R005；仅源码文档，不编译、类型检查、测试、执行CLI/服务、打开数据库或发布；任务独立提交并推送 main，使用 [skip ci]。

2026-11-03 发送队列完整档案与离线核验协接（ADR-015）：T3.4/T4.3 增加单项目 workctx.sync-outbox-archive v1，保存全部既有本地列（含原 payload/source_refs JSON 文本、原身份/命令摘要、调度/租约/投递诊断），最多1000行/32 MiB，集合摘要独立核验。Bridge readArchive 复用完整只读 audit 遍历收集原行，先计数/全内容校验再完成集合，不输出部分备份；抽取原事件检查为无数据库模块，原发送/核对语义不变。CLI outbox export 显式输出新文件，读事务结束并尝试关闭后独占保存/读回；outbox inspect-archive 通过独立包子路径离线核验原文件、每行原摘要与唯一性，不加载 SQLite。严格范围/预算/文件大小/字段和UTF-8顺序，文件只是历史快照不授予租约或证明远端结果，恢复/合并/发送者协调另待补。范围 Bridge/CLI/包导出/README/契约/TODO/R005，无数据库schema/依赖版本/API变化；仅源码文档，不编译、类型检查、测试、运行CLI、打开库、生成样本或发布；按任务提交推送main，使用[skip ci]。


2026-11-03 发送队列持久暂停协接（ADR-015）：跨 T3.4/T4.3 新增按项目持久发送控制及 outbox send-control/pause/resume。显式暂停在同一写事务创建可选 local_outbox_send_control 表并保存新 generation、原因/时间/trace；变更绑定原 scope 与 expected_generation，拒绝陈旧操作。发送领取事务每次读取控制，指定项目暂停报错，无范围 drain 跳过暂停项目；已领取批次仍可能完成，过期租约不证明发送已停止。只读状态提供有界 sending 元数据统计，暂停不停止入队/显式重排/回执结算，不取消在途请求、不改原行或自动恢复。CLI 只打开已有队列，缺控制表读为未配置、正常构造/读取/领取不初始化该表。范围 Bridge outbox/CLI/README/契约/TODO/R005，新增可选本地表的源码，不执行schema或迁移；不编译、类型检查、测试、执行CLI/服务、打开数据库、生成样本或发布。按任务提交并推送main，使用[skip ci]。旧发送器不认识控制，跨版本协调、原发送者确认停止及档案恢复仍待补。



2026-11-03 发送队列受控档案恢复协接（ADR-015）：跨 T3.4/T4.3 新增 restoreArchive/readRestoreReceipt 与 outbox restore/restore-receipt。完整重核原档案/原查询，首次恢复要求目标项目为空且持久暂停 generation 精确匹配，预检全库事件ID/键冲突后整事务写入原内容与持久回执。sent/conflict 保留历史终态；pending/sending/failed 转为 failed、清空租约并标 OUTBOX_RESTORED_REVIEW_REQUIRED，原正文/引用字符串、身份/键/摘要/尝试/调度/trace保持；完整原档案同事务保存，保留被替换的诊断/租约历史。显式本地扩展表记录原查询/原档案、恢复时间trace及归一后摘要；同恢复ID相同原查询仅返回既有历史回执，不重灌已变化队列。只读原回执用于处理提交未知，缺失不解释为原操作失败。恢复不自动发送/resume/retry，不证明旧发送者已停止，非空合并/跨版本协调另待补。范围 Bridge outbox/CLI/README/契约/TODO/R005；只写可选本地表初始化源码，不打开数据库、不执行schema/迁移，不编译、类型检查、测试、运行CLI/服务、生成样本或发布。按任务提交推送main并带[skip ci]。


2026-11-03 发送队列恢复历史协接（ADR-015）：T3.4/T4.3 新增 restore-history/restore-get/restore-export，只读已有库。目录按 BINARY restore_id 有界分页，仅校验元数据并明确原档案未核验；单条读取与原档案导出复用完整历史核验，原查询遗失也可按项目/ID找回。导出在读取结束及关闭尝试后独占写新文件，保留历史回执和失败路径；不改变当前队列、暂停状态或发送行为，无新 schema/依赖。仅源码文档，不编译、类型检查、测试、运行 CLI/接口、打开库、迁移或发布；任务独立提交推送 main，使用 [skip ci]。


2026-11-03 发送队列恢复预览协接（ADR-015）：T3.4/T4.3 新增 previewArchiveRestore/outbox restore-preview，复用固定原查询、完整档案、历史精确回执、全库恢复ID占用、暂停generation/空项目/原事件键冲突及不可变v1映射检查。只读已有库单事务；已完成原请求仅返回历史，首次恢复返回原状态/预计状态和待处理/清租约统计，Bridge完整预览结果128 KiB。明确仅本次预览、未写入且实际执行重新检查；不生成候选提交回执、预留ID或创建schema，不自动pause/resume/retry/发送。CLI复用稳定文件和范围核验，无网络/依赖/迁移变化。范围Bridge/CLI/契约/README/TODO/R005；仅源码文档，不编译、类型检查、测试、运行CLI/接口、打开库、初始化或发布，完成后独立提交并推送main，使用[skip ci]。


2026-11-03 本地SQLite原生只读打开协接（ADR-015）：T3.4/T4.3 将SqliteOutbox/SqliteSyncInbox的readonly模式在DatabaseSync打开时传入readOnly，继续保留query_only和已有schema检查；只读打开失败不回退可写，不隐式创建或升级主库。Outbox在打开前严格检查existing/readonly布尔值，避免错误选项改变模式。正常写入/显式初始化模式沿用，不改CLI参数或共享格式。范围Bridge两构造器、现有读取契约、README/TODO/R005及协接文档，无新schema/依赖。仅源码文档，不编译、类型检查、测试、运行CLI/接口、打开数据库或发布；独立提交并推送main，带[skip ci]。


2026-11-03 发送队列恢复历史全范围核验协接（ADR-015）：T3.4/T4.3 增加auditRestoreReceipts/outbox restore-audit，原项目范围与max_receipts/max_bytes/timeout_ms严格解析，默认100份/64 MiB/30秒，上限1000份/512 MiB/90秒。单次只读事务先有界计数，再按BINARY恢复ID分批读取有界元数据；读取每份正文前核对原查询/档案存储字节预算及同范围ID唯一性，逐份复用完整历史和不可变v1映射核验。缺扩展为空历史，损坏/超预算/超时均未完成，保留阶段/选中ID/已核验进度/回滚和关闭信息；不返回部分通过、不修复或改当前队列。目录附全项目audit_query，CLI显式已有outbox，原生只读，无网络/输出文件/自动发送。范围Bridge/CLI/契约/README/TODO/R005，无schema/依赖变化；仅源码文档，不编译、类型检查、测试、运行命令、打开库或发布，任务独立提交推送main并带[skip ci]。


2026-11-03 发送队列单条恢复对照协接（ADR-015）：T3.4/T4.3 新增 compareRestoreRecord/outbox restore-compare，显式原项目、restore_id/event_id；单次只读事务先完整核验历史原档案及不可变v1恢复摘要，再读取该事件当前有界原行、核验原身份/摘要，逐列比较全部23个已知存储列。返回原档案/恢复基线/当前摘要与变化列，不输出正文或租约值；未观察到当前行和完全相同均不证明来源、删除或远端结果。固定90秒、结果128 KiB，保留查询/阶段/原错误详情及关闭状态；CLI原生只读已有文件，无网络/写入/自动发送。范围Bridge/CLI/契约/README/TODO/R005，无schema/依赖变化；仅源码文档，不编译、类型检查、测试、运行命令、打开库或发布，任务独立提交推送main并带[skip ci]。
2026-11-03 发送队列完整恢复历史备份协接（ADR-015）：T3.4/T4.3 新增单项目恢复历史备份格式、Bridge只读导出和CLI restore-history-backup/inspect-restore-history-backup。复用全项目有界审计遍历，完整收集每份原查询/源档案/恢复时间trace/归一摘要与历史回执，不截断；离线入口通过独立包子路径重核每份历史和集合摘要，无SQLite加载或网络。固定v1恢复映射共享，最多100份/64 MiB文档，查询预算先于正文加载；导出在完整读取及关闭尝试后独占写新文件，最终读回核验，失败保留定位/原查询/文件与关闭状态。只备份历史，不修改当前队列或提供来源认证；导入/清理/跨项目恢复后续开发。范围Bridge/CLI/包导出/契约/README/TODO/R005，无schema或依赖版本变化；仅源码文档，不编译、类型检查、测试、执行CLI/Bridge、打开库、生成样本或发布，独立提交推送main并带[skip ci]。
2026-11-03 发送队列恢复历史备份导入协接（ADR-015）：T3.4/T4.3 新增importRestoreBackup/previewRestoreBackupImport与outbox restore-history-import/restore-history-import-preview。严格scope/backup_sha256原查询，完整核验备份后同事务预检全局恢复ID：缺失补入、同项目完整原历史相同保留、异文/跨项目占用拒绝；候选目标原查询/档案读取总计64 MiB，重复/损坏整笔失败。实际导入用写事务插入全部缺失历史并完整读回比较，缺表仅非空首次导入显式创建既有可选表；预览只读。保持原恢复时间trace/回执/源档案，不读写当前事件或暂停控制、不发送。重复调用只证明本次内容已存在，不证明此前未知提交；无独立导入回执表，失败保留原查询/候选结果/事务及关闭状态。固定90秒、结果128 KiB；既有恢复ID继续保留历史幂等语义，不能用导入历史推断目标事件已恢复。范围Bridge/CLI/契约/README/TODO/R005，无新schema格式/依赖变化；仅源码文档，不编译、类型检查、测试、执行命令、打开库、执行初始化/迁移或发布，独立提交推送main并带[skip ci]。
2026-11-03 恢复历史备份离线取用协接（ADR-015）：T3.4/T4.3 新增restore-backup-history/get/export，仅读取完整历史备份文件。全文件与逐份原历史核验后分页发现或按原restore_id读取，续页和选中查询绑定backup_sha256，拒绝换档案继续；目录默认10/最多20项，完整元数据结果128 KiB。导出仅提取所选原事件档案，保存原document_sha256，独占新文件并完整读回；缺条目不创建文件，失败保留原历史/查询/输入输出路径及文件状态。原JSON/租约保留在文件，stdout只含摘要；不加载原生SQLite、不需项目配置/令牌/网络，不生成新的恢复请求或写队列。范围Bridge离线子路径/CLI文件和路由/契约/README/TODO/R005，无schema/依赖变化；仅源码文档，不编译、类型检查、测试、运行CLI/Bridge、打开库、生成样本或发布，独立提交推送main并带[skip ci]。
2026-11-03 恢复请求准备协接（ADR-015）：新增 prepareArchiveRestore/outbox restore-prepare，严格 scope/新 restore_id/reason，完整核验原事件档案，在同一只读事务观察暂停 generation、拒绝已占用恢复 ID、检查空项目和全局事件/键冲突，共享 v1 归一计划。CLI 打开前预检新输出路径，完成读取并尝试关闭后独占保存完整恢复查询，失败保留查询/计划/文件和关闭状态；实际恢复仍重新检查，不自动暂停/预留/恢复/发送。范围 Bridge/CLI/契约/README/TODO/R005，无 schema/依赖变化；仅源码文档，不编译、类型检查、测试、执行产品命令、打开库或发布，按任务独立提交推送 main，带 [skip ci]。

2026-11-03 恢复事件批量重新排队协接（ADR-015）：新增 restore-requeue/restore-requeue-preview，严格原项目/恢复ID/暂停generation/显式事件ID列表/原因。完整核验历史源档案，所选最多100条必须是非终态原事件且当前23列精确匹配不可变v1恢复基线，任一缺失/变化/终态整批拒绝。预览单读事务；实际BEGIN IMMEDIATE整批更新为pending并完整读回，原暂停控制和历史再核对，提交未知保留原请求/候选计划/事务状态；不自动resume、核对服务器或发送。CLI已有文件/原生只读预览、关闭状态；无schema/依赖变更，仅源码文档，不编译、类型检查、测试、运行产品命令、打开库或发布，独立提交推送main并带[skip ci]。

2026-11-03 批量重新排队持久回执协接（ADR-015）：原查询增加可选 requeue_id，保留六字段旧调用；带ID的显式操作在同一写事务保存原请求、历史绑定、选中前后完整列摘要和时间trace。复用固定v1映射，重读核验原恢复历史及选择摘要；精确重复只返回历史，异请求/跨项目ID拒绝。新增原查询只读回执入口，预览命中历史不检查当前队列；缺表/缺记录不证明原提交失败。可选新表只在实际带ID写入时初始化，构造/预览/查询不建表。本轮只开发源码文档，不编译、类型检查、测试、运行CLI/Bridge、打开库或执行schema；按任务提交推送main并带[skip ci]。

2026-11-03 批量回执按ID找回原请求协接（ADR-015）：新增 readRestoreRequeueRecord/outbox restore-requeue-get，严格scope/requeue_id选择，复用既有完整回执及父恢复历史/前后摘要校验，返回原七字段查询和历史回执；原精确请求查询/重复操作仍完整比对，不放宽。CLI可选output在打开库前预检，完整读取并尝试关闭后独占保存原请求并最终核对字节/SHA/JSON；缺记录不创建文件，错误保留原查询/回执/输出和关闭状态。范围Bridge/CLI/契约/README/TODO/R005，无新schema或依赖；只开发源码文档，不编译、类型检查、测试、运行命令、打开库或发布，按任务独立提交推送main并带[skip ci]。

2026-11-03 重新排队回执目录协接（ADR-015）：新增listRestoreRequeueReceipts/restore-requeue-history，原项目scope、默认10最多20、BINARY requeue_id续页。单读事务只读有界元数据，校验原查询SHA/范围ID/时间trace/摘要形状及页内和额外前瞻项，返回摘要和get_query/next_query；不加载父历史正文，不声称完整回执已核验。抽取共享元数据校验/SQL投影以保持单条读取一致。无schema/依赖变化，仅源码文档，不编译、类型检查、测试、运行CLI/Bridge、打开库或发布，按任务提交推送main并带[skip ci]。

2026-11-03 重新排队完整历史审计协接（ADR-015）：新增auditRestoreRequeueReceipts/restore-requeue-audit，在单项目单读事务核验全部持久批次原请求、父恢复历史、父回执和所选前后摘要。先有界计数、逐项读取长度并执行累计查询/档案预算，再读取正文；父历史按批次出现次数计费，拒绝重复ID、缺父历史和损坏，不返回部分通过。默认100最多1000批、64 MiB最多512 MiB、30秒最多90秒，输出128 KiB；CLI原生只读，保留失败阶段/批次ID/恢复ID/计数/读取和关闭状态，不修改当前队列/控制、不发送。无schema/依赖变化，仅源码文档，不编译、类型检查、测试、执行产品命令、打开库或发布，独立提交推送main并带[skip ci]。

2026-11-03 重新排队独立回执文件协接（ADR-015）：新增单批次文件格式，包含完整原重新排队回执及父恢复回执/源档案，复用固定v1映射逐项重算摘要；Bridge单读事务按scope/requeue_id取出，CLI只读导出至独占新文件并最终完整读回。新增无SQLite/配置/网络依赖的离线核验与摘要/ID绑定原请求提取，可显式保存原请求；stdout只给元数据或原请求/回执，不输出档案正文。缺项不创建文件，错误保留历史回执、查询、文件发布/清理和关闭状态；无数据库schema/依赖版本变化，仅源码文档，不编译、类型检查、测试、执行命令、打开库、生成样本或发布，独立提交推送main并带[skip ci]。

2026-11-04 重新排队单批次历史导入协接（ADR-015）：新增importRestoreRequeueFile/previewRestoreRequeueFileImport及restore-requeue-import/restore-requeue-import-preview。严格scope/document_sha256/requeue_id绑定完整独立回执文件，同事务检查父恢复ID和批次ID全局占用、完整原历史与回执元数据；只补缺失项，同内容保留，异文或跨项目拒绝。父历史缺失而批次元数据完整匹配时可只补父历史，预览明确关联状态。实际写入先补父历史，再补批次回执，写前/写后重新核对并完整读回；提交未知保留源回执、候选结果及事务状态。当前事件/控制不读写，不自动发送；重复只证明本次历史已存在，不证明此前导入提交。90秒/128 KiB结果，CLI预览原生只读、实际已有库，不输出源正文。复用既有可选表定义，仅源码文档，不编译、类型检查、测试、运行命令、打开库或执行schema；独立提交推送main并带[skip ci]。

2026-11-04 项目重新排队历史联合备份协接（ADR-015）：新增readRestoreRequeueBackup及restore-requeue-backup/inspect-restore-requeue-backup，复用同项目完整审计在单读事务收集全部批次。v1文件包含BINARY排序的完整批次回执和按原restore_id去重的父恢复回执/源档案；离线核验父历史、每份原查询/选中前后摘要、集合摘要及无悬空/未引用父项。最多100批/100父项、64 MiB文档，审计累计原输入预算默认64最多512 MiB（共享父每批计费），默认30最多90秒。关闭尝试后独占保存新文件并最终完整读回；错误保留原查询/收集进度/发布清理和关闭状态，超限不截断。无数据库schema或依赖版本变化，新增离线子路径；仅源码文档，不编译、类型检查、测试、运行命令、打开库、生成样本或发布，独立提交推送main并带[skip ci]。

2026-11-04 重新排队联合备份离线取用协接（ADR-015）：新增restore-requeue-backup-history/get/export，纯文件路径先完整核验备份全部父历史、批次及关联闭包，再按backup_sha256绑定分页/选中ID。默认10最多20，续页携带原摘要及after_requeue_id；get返回完整原请求/回执，可独占保存原请求；export将选中批次和完整父历史转为既有独立回执格式，保留备份观察时间/导出trace和原历史，衔接已有单批次导入。缺项明确not-found，写文件入口不创建缺项输出；复用独占发布和最终完整读回，错误保留原选择、源文件、历史与发布状态。无数据库/网络/配置依赖，无schema/依赖版本变化；仅源码文档，不编译、类型检查、测试、执行产品命令、打开库、生成样本或发布，单独提交推送main并带[skip ci]。

2026-11-04 重新排队联合备份原子导入协接（ADR-015）：新增importRestoreRequeueBackup/previewRestoreRequeueBackupImport及restore-requeue-backup-import/import-preview，严格scope/backup_sha256绑定整份已核验文件。抽取单批次导入的父历史/回执目标比较器，复用于联合导入；每个比较轮次按不同父ID读取一次，逐批验证元数据与已核验源回执完全一致，保留缺父历史时的source-only关联语义。单事务预检全部ID，缺失才写，相同保留，异文/跨项目拒绝；写父前重查、父写后核对整批计划、逐批写前重查，所有写后完整比较全部父历史/批次才提交。目标每完整轮次最多64 MiB、总比较读取最多256 MiB，固定90秒/128 KiB；空备份不建可选表。未知提交保留源摘要、候选计划/结果、选中ID/进度/事务状态。CLI源完整核验后打开已有库，预览原生只读；不恢复当前事件、不调整发送控制、不自动发送。无schema/依赖版本变化，仅源码文档，不编译、类型检查、测试、执行产品命令、打开库、初始化表、生成样本或发布；按任务提交推送main并带[skip ci]。

2026-11-04 客户端事件同步历史协接（ADR-015）：新增共享parseClientEventSyncChange与固定client-event-history/1本地适配器，消费Gateway既有ClientEventRecorded，完整保留原content/来源、原账号/客户端/事件ID、server_cursor及观察元数据。严格核对ClientEvent聚合、原身份与来源末尾绑定；FieldChangeProposed核对当前字段集合、base/observed版本并保留扩展content，普通事件拒绝伪造observed_version。投影按原账号/客户端/事件ID三元组排序去重、最多512项/1 MiB，拒绝重复身份、事件ID/cursor及回退；不把服务器接收当作业务字段生效，不重建缺失的原client_cursor/批次键/原敏感级别。接入既有apply/preview/pending/replay及通用状态/归档/恢复，未知类型拒绝整页，其余已有类型按固定v1忽略。范围contracts、Bridge inbox、CLI帮助、README/契约/TODO/R005及协调记录，无Gateway格式/schema/依赖变化；仅源码文档，不编译、类型检查、测试、运行reducer/CLI/API/Bridge、打开库、执行迁移、生成样本或发布；独立提交push main带[skip ci]。

2026-11-04 同步消费 Mock 协接（ADR-015）：T0.5 新增可显式共享的内存 MockSyncStore 与固定模拟身份会话，扩展 MockWcpServer 的 changes/cursor/ack/commands/context 四个同步路由。完整保存有界、顺序严格的原流，按显式可见事件集合分页；默认读取原身份确认位点，末页推进到流高水位，确认按原五字段身份隔离、禁止回退及超前。复用现有共享输入/响应解析，保持 trace/来源、取消与响应大小边界，构造/返回均隔离外部修改。模拟身份、权限和可见性由开发者配置，不从请求预期身份授权，不声称真实 Policy、持久化、未知写入或运行证据；未配置时保持原创建项目入口。范围 packages/sdk 源码/导出/README、开发契约、TODO/R001/R005 与本协调记录，无 Gateway/数据库/依赖变化。只开发源码文档，不编译、类型检查、测试、执行 Mock/产品、打开库、生成样本或发布；独立提交并推送 main，带 [skip ci]。
