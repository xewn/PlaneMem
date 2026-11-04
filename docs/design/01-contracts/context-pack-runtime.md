# 持久化 ContextPack 开发说明

2026-11-05新增[网页历史回执留存与找回](#网页历史回执留存与找回2026-11-05源码增量)：显式浏览器双槽保存、原绑定20条完整目录、共享回执文件导入导出及原请求导出，保留原时间与历史语义；载入不查询或发送。仅源码文档，未编译、类型检查、测试、渲染、执行网页/文件/接口或发布。

2026-11-05新增[保存回执文件与离线查看](#保存回执文件与离线查看2026-11-05源码增量)：完整原请求与历史查询观察可显式留存新文件，离线核对规范摘要和原文绑定；本地写入失败保留查询输出，不变更历史结果或触发重发。仅源码文档，未编译、类型检查、测试、执行CLI/文件工作流或发布。

2026-11-05新增[MCP原保存回执查询](#mcp原保存回执查询2026-11-05源码增量)：工具按原身份/权限桶/键/显式参数查询历史记录，沿上下文读期限与容量，完整核验原查询及封套，不发保存或自动重试。仅源码文档，未编译、类型检查、测试、执行MCP/API或发布。

2026-11-05新增[网页原保存回执查询](#网页原保存回执查询2026-11-05源码增量)：准备与恢复共用面板显式查询完整原请求，不发保存；已确认历史保留，显示固定包链接、完整元数据及内容/来源尚未检查。仅源码文档，未编译、类型检查、测试、渲染、执行网页/接口或发布。

2026-11-05新增[原保存请求回执查询](#原保存请求回执查询2026-11-05源码增量)：Gateway/SDK/网络CLI只读匹配原保存请求的历史记录，不触发保存；明确区分历史已记录与快照中未观察到，内容及来源均另行检查。仅源码文档，未编译、类型检查、测试、执行客户端/接口/数据库或发布。

2026-11-05新增[CLI完整保存原请求](#cli完整保存原请求2026-11-05源码增量)：与Web共用8 KiB原格式，新文件准备/离线审阅/明确确认提交；Gateway路径、身份权限及原参数键固定，同token复核后完整保存回执检查。仅源码文档，未编译、类型检查、测试、执行客户端/接口或发布。

2026-11-05新增[CLI/MCP保存身份入口](#climcp保存身份入口2026-11-05源码增量)：CLI context save-identity及MCP get_context_pack_save_context读取完整可信身份/期限/权限提示，沿原上下文读期限与容量，不保存包或替换原请求。仅源码文档，未编译、类型检查、测试、执行客户端/接口或发布。

2026-11-05新增[网页原请求准备与恢复](#网页原请求准备与恢复2026-11-05源码增量)：完整原请求固定网关/身份/权限桶/参数/键，浏览器双槽保存和完整分页找回，文件导入导出；每次发送同token复核原save-context，身份变化不改绑。仅源码文档，未编译、类型检查、测试、渲染、执行浏览器/API/保存请求或发布。

2026-11-05新增[保存前可信身份读取](#保存前可信身份读取2026-11-05源码增量)：Gateway/SDK/Mock统一返回当前完整身份与会话期限，为跨登录原请求绑定提供基础；不读取保存包、不预留键或覆盖旧请求。仅源码文档，未执行API/SDK/Mock、编译、类型检查、测试或发布。

2026-11-05补充[Mock显式保存与重放](context-pack-mock-runtime.md#显式保存与重放2026-11-05源码增量)：预置完整保存场景接入SDK提交，首次激活后读取/目录可见，同键重放且参数/权限桶变化拒绝；失败不回滚已激活包。无真实编译器或数据库，预置时间/版本保持，R-003未完成、evidence为空。仅源码文档，未执行Mock/SDK/API/保存请求、编译、类型检查、测试或发布。

2026-11-05完善[网页保存包提交核验](#网页保存包提交核验2026-11-05源码增量)：保存改为完整有界回执/摘要核验，提交后401/到期/4xx不清除unknown；成功后的缓存刷新失败不再要求重发。仅源码文档，未编译、类型检查、测试、渲染/浏览器/API/保存请求或发布。

2026-11-05完善[MCP保存包提交核验](#mcp-保存包提交核验2026-11-05源码增量)：专用执行器检查完整回执、HTTP状态及摘要，固定原可信身份与参数，独立30秒/两笔容量，失败保留unknown。仅源码文档，未运行保存请求、编译构建、类型检查、测试或发布。

2026-11-05完善[CLI保存包提交核验](#cli-保存包提交核验2026-11-05源码增量)：三个入口共用SDK完整回执/摘要核验，增加有界输入、等待期限及原身份约束；嵌入保存容量和授权后检查独立管理，失败保留unknown。仅编辑源码文档，未运行保存命令、编译构建、类型检查、测试或发布。

2026-11-05完善[SDK保存包提交核验](#sdk-保存包提交核验2026-11-05源码增量)：专用单次POST捕获原请求、限定等待期限，核对完整返回包与摘要、原预算及最大有效期；派发后失败保留结果未知，不自动重试。此处仅开发保存方法源码，未实际执行包编排/保存请求、编译构建、类型检查、测试或发布。

2026-11-05新增[网页双包对比候选查找](#网页双包对比候选查找2026-11-05源码增量)：按编号或任一侧保存内容查找候选，叠加只看变化，保留原两包/显示模式/返回链；匹配为空不会改变完整报告总计或来源比较。仅源码文档，未编译、测试、渲染或发布。

2026-11-05新增[网页保存包包内筛选](#网页保存包包内筛选2026-11-05源码增量)：完整读取后可搜索保存候选编号、正文或排除原因，并显示全部/仅入选/仅排除；筛选始终固定本次实际包编号，完整统计/来源/响应不被裁剪。仅源码文档，未编译、测试、渲染或发布。

2026-11-05新增[保存包目录OpenAPI源码](../../../packages/contracts/openapi/README.md)：`@planemem/contracts/openapi/context-pack-directory.json`仅描述既有GET /v1/context-packs，复用本地目录Schema。按实际HTTP入口区分可分别提供的身份条件、traceparent优先级、早期错误可缺x-trace-id头，以及429/503不同错误来源的retryable；全量OpenAPI和工具/自动一致性/运行证据仍待补。未改运行时，只源码文档人工审阅与格式文本检查，未执行校验器/生成器、编译、类型检查、测试、API/数据库或发布。

2026-11-05新增[独立保存包目录Schema](../../../packages/contracts/schemas/README.md#保存-contextpack-元数据目录)：`@planemem/contracts/schemas/context-pack-directory.json`自包含输入/规范/CLI查询、游标词法、六字段记录、范围/来源标记和完整metadata-only/not-checked分页封套。完整本地资源注册后解析锚点，无需完整读取Schema或联网加载。时间/用量关系、原请求绑定、唯一ID/排序/页大小、规范游标、字节和UTF-16预算仍由原实现核对，真实权限与可见性由可信处理器决定；结构不能证明包内容/来源有效。仅源码文档人工审阅与格式文本检查，未执行校验器/生成器、编译、类型检查、测试或发布；目录OpenAPI源码见本文顶部链接，全量接口目录、本地加载和自动一致性证据仍待补。

2026-11-05新增[保存包Mock目录](context-pack-mock-runtime.md#保存包元数据目录2026-11-05源码增量)：既有固定保存包数据接入SDK单页/分页元数据读取，保持可见范围和独立游标绑定；不在列表阶段核验包正文或来源。仅源码文档，未执行Mock/SDK、编译、测试或发布。

2026-11-05新增[MCP保存包目录读取](#mcp-保存包目录读取2026-11-05源码增量)：`list_context_packs`提供严格身份下的单页元数据发现，保留原筛选/续页，不逐包读取正文或核验来源。仅源码文档，未编译、测试、运行或发布。

2026-11-05新增[CLI保存包目录读取](#cli-保存包目录读取2026-11-05源码增量)：`context list-packs`网络及嵌入入口读取完整元数据页，支持精确编号和显式续页；不改变已保存包。仅源码文档，未编译、测试、运行或发布。

2026-11-05新增[SDK保存包目录读取](#sdk-保存包目录读取2026-11-05源码增量)：完整单页读取及固定身份的按需分页，支持取消/超时和页数上限；不读取正文或核验来源。仅源码文档，未编译、测试、运行或发布。

2026-11-05新增[保存包元数据目录](#保存包元数据目录2026-11-05源码增量)：GET /v1/context-packs及网页分页浏览，跨页选择基础包和对比包；目录不证明完整内容或来源当前可用。仅源码文档，未编译、测试、渲染或发布。

2026-11-04新增[网页独立查看](#网页保存包独立查看2026-11-04源码增量)：保存包读取不再必须经过上下文目录页面；提供显式编号/最新选择、完整内容、原请求重试与目录/对比返回入口。仅源码文档，未编译、测试、渲染或发布。

2026-11-04新增[独立保存包对比Schema](../../../packages/contracts/schemas/README.md#保存-contextpack-对比)：`@planemem/contracts/schemas/context-pack-comparison.json`提供查询、候选/报告、SDK/CLI/MCP完整结果及网页内部组合锚点。需与本地context-pack-read资源一起注册，复用完整json封套；不联网加载。跨字段绑定、真实摘要及精确差异仍由原实现核对；仅源码文档，未执行Schema校验器、生成器、编译、类型检查、测试或发布。

更新：2026-11-02。本文记录代码实现；未执行编译、类型检查、测试、数据库迁移、部署或发布。

2026-11-04新增[独立完整读取Schema](../../../packages/contracts/schemas/README.md#保存-contextpack-完整读取)：`@planemem/contracts/schemas/context-pack-read.json`提供查询、完整保存包、回执和格式专用封套定义。旧sections实体保持；原请求绑定、来源顺序、合计预算、渲染内容和真实SHA-256仍沿下文运行时检查，Schema结构不能替代。仅源码文档与格式文本检查，未执行校验器、生成器、编译、类型检查、测试或发布。

2026-11-04新增[保存包Mock](context-pack-mock-runtime.md)：独立固定完整包、权限桶及来源变化场景接入SDK getContextPack；支持最新/指定包与json/markdown/mcp，完整内容和SHA-256核验，2 MiB响应、两容量/30秒及取消。模拟来源状态不替代真实来源检查，未执行任何Mock或SDK。

## SDK 保存包提交核验（2026-11-05源码增量）

`client.compileContextPack({ budget_tokens?, ttl_seconds? }, { idempotency_key, timeout_ms?, signal? })` 返回 `Promise<ContextPackReadEnvelope>`，复用既有 `/v1/context-pack/compile` 单次POST。`@planemem/sdk` 根导出 `WcpContextPackCompileOptions` 和规范参数类型 `ContextPackCompileParameters`；contracts根导出 `parseContextPackCompileParameters`、`parseContextPackCompileEnvelope` 和4 KiB输入上限。这里的compile指产品保存包方法，本文增量只编辑其源码，没有执行这个方法，也没有进行项目编译构建。

调用开始时捕获原项目范围、trace、可选actor/client、参数和键。输入及选项仅接收白名单自有普通字段，拒绝未知字段、访问器、符号及自定义原型；SDK将平面可选undefined省略，共享解析器要求有限普通JSON。预算默认4096，整数128–32768；有效期默认3600秒，整数60–86400；请求明确发送两项规范值。Gateway原本也先规范默认值再计算请求指纹。必填幂等键为1–255 UTF-16单元，拒绝空白、C0/DEL及孤立代理项；trace/client沿现有读取入口的isSyncIdentifier约束，最多255单元。原context上的版本/写条件不继承。发送独立参数副本，完整响应始终与预先捕获的原参数比较。

原context含actor/client时分别发送相等约束头，继续允许旧调用方省略其中一项或两项；省略的身份条件无法固定凭据续期前后的账号/客户端。SDK不会以客户端字段代替可信认证，真实授权、来源新鲜度、请求键归属和幂等重放仍由Gateway负责。

默认30秒期限包括凭据等待、响应接收、完整解析和WebCrypto SHA-256，允许timeout_ms为1–2147483647整数、signal取消；同步解析结束后也检查期限。WebCrypto能力在派发前预查。SDK只调用一次transport，`bounded-json`成功封套上限2 MiB，Fetch传输错误体上限16 KiB，其自身更短的期限仍可先结束。自定义传输必须尊重这些请求选项；SDK仍会对返回对象做有界普通JSON快照、完整结构和摘要核验并丢弃迟到结果。取消仅停止本地等待，不能证明远端保存撤销。

共享提交解析复用完整json读取校验：外层trace、项目范围、版本/JSON ETag、游标、候选及来源、时间和用量关系均需一致，并额外要求返回预算等于原预算、保存时间至到期的间隔不大于原TTL。来源可缩短有效期，因此不要求间隔恰好等于请求TTL；幂等重放可保留原保存时间和包内trace。SDK按既有规范JSON计算完整包SHA-256，只排除包顶层trace/hash，与返回pack_hash相等才交付独立完整封套，不返回部分内容。通用transport不暴露HTTP响应头/状态，SDK核对的是JSON中的ETag，不声称核对HTTP ETag；回执没有原键或请求TTL回显，预算/期限及摘要匹配不能证明键归属。

失败使用固定消息，不回传原键或不完整包。details包含 `compile_stage=input|integrity|transport|response`、`compile_dispatch_state=not-sent|started` 和 `server_outcome=not-checked|unknown`，retryable固定false。调用transport之前的失败为not-sent/not-checked，不能否定更早的同键保存；一旦调用transport，任何失败（含4xx、取消、超时、非法回执或摘要异常）均保守记为started/unknown，不声称已获知服务端最终结果。无自动重试、新键生成、读回或本地恢复存储。调用方应自行保留原项目、账号/客户端约束、预算、期限和幂等键；需要恢复时显式使用完全相同的原请求，不能据本次错误断定没有保存。

兼容性变化：非法参数以前可同步抛错，现在通过Promise拒绝传递；调用方需await/catch。只返回浅层data、缺少完整包/来源/游标或提供错误摘要的旧自定义传输和模拟替身会被拒绝，需按完整响应迁移。现有MockContextPackStore仍只支持读取/目录，不因此获得保存实现。Gateway、Web、CLI、MCP入口源码没有改动；它们现有的请求、错误映射和恢复逻辑不自动等同于本SDK方法。

R-003仍未完成，evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、运行SDK/Mock/CLI/MCP/API、实际编排/保存ContextPack、执行数据库或发布。完整响应兼容、真实重放/身份续期、取消和期限、来源缩短TTL及摘要故障等运行证据仍待补。

## 入口与身份

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/v1/context-pack/compile` | 从当前项目的 ContextItem 生成并保存新包 |
| GET | `/v1/context-pack` | 读取最新可见包，或由 `pack_id` 指定历史包 |
| GET | `/v1/context-packs` | 按权限列出保存包元数据，供选择编号；不读取完整包 |

这些路由均要求 Bearer token 和 `x-tenant-id`、`x-workspace-id`、`x-project-id`，范围必须与令牌一致。读取及编译使用 `context.read` 策略动作，编译还要求有效客户端身份和 `Idempotency-Key`；目录要求有效客户端身份及实际context.read，拒绝写条件。身份、能力、来源内容不能从请求正文覆盖。`data.restricted.read` 决定是否允许纳入或读取 restricted 数据，管理员角色不自动绕过这个内容过滤。

编译、读取与检查点/续接的绑定消费均在自身事务内检查当前父项目存在、未删除及分类可见；写入路径取得项目同步流锁后持有父项目共享锁直至事务结束。项目不可见返回 CONTEXT_PACK_NOT_FOUND，不复用历史包或请求回执绕过当前访问条件。

编译正文仅接受 `budget_tokens`、`ttl_seconds` 和可选的 `idempotency_key`；正文和请求头同时提供请求键时必须一致。

| 参数 | 默认值 | 范围 |
| --- | --- | --- |
| `budget_tokens` | 4096 | 整数 128–32768 |
| `ttl_seconds` | 3600 | 整数 60–86400 |

读取接受可选 `pack_id`（ULID）和 `format`（`json`、`markdown`、`mcp`）。重复或未知查询参数返回错误。不提供 ID 时取当前权限下版本最大的完整快照；如果它已过期或失效，返回相应错误，不悄悄回退到更早版本。

## 选择与预算

来源为 `wcp_context_items` 中当前项目内未删除、状态为 `confirmed`、`proposed` 或 `expired` 的记录。`excluded` 不参与编译。无 restricted 读取能力时，restricted 记录在 SQL 查询阶段排除，不在 exclusions 中泄漏它们的 ID。编译最多读取 1000 条可见候选记录；超过上限返回 `CONTEXT_SOURCE_LIMIT`，不静默截断。

排序结合 L0–L4 层级、High/Medium/Low 优先级、confirmed 状态和 confidence，同分按 ID 的代码单元顺序排序。proposed 记录仍保持 `confirmed: false`。内容由标题和正文组成；非字符串正文以 JSON 表示。来源保留 ContextItem ID/revision 及其原始 source refs。

Token 数是每条内容 `max(1, ceil(content.length / 4))` 的估计，基于 JavaScript 字符串长度，不是某个模型的 tokenizer。预算只约束所选内容，不包含 JSON、Markdown 标题和来源等呈现开销。持久化入口使用严格预算，无法放入的条目进入 `budget` exclusions，不采用优先级超预算例外。通用编译器为兼容旧调用保留非严格模式。

包的到期时间取请求最大寿命与所有入选来源到期时间的最早值。已过期来源进入 `expired` exclusions。新包可以为空，明确返回空 items 和对应 exclusions。

## 持久化与重试

需要已有运行时迁移及 `016_context_pack_documents.sql`。该迁移尚未执行，提供完整 JSON 文档、来源指纹清单、权限桶、持久请求键和同步游标字段。部署此代码前必须安排数据库升级；同步读取也会引用新增字段。缺少数据库或所需表结构时不回退为临时内存结果。

同一事务在项目同步流锁内分配单调 pack version 和 server cursor，保存快照与来源清单，替换相同 restricted 可见性桶的 latest 标记，并追加 `ContextPackIssued`。事件只含包 ID、hash、version 和预算统计，不传输上下文正文。同步查询按保存的权限桶筛选事件。

请求键绑定 tenant/workspace/project、actor 和 client。相同键、预算、TTL 与可见性范围重试时读取原快照并重新检查有效性，不创建第二个包。改变参数或 restricted 可见性后复用原键返回 `IDEMPOTENCY_KEY_REUSED`。不确定结果时保留原参数和键重试；已过期或来源失效后，使用新键重新编译。

`pack_hash` 使用真正的 SHA-256，格式为 `sha256:` 加 64 位十六进制字符。哈希对对象键进行递归稳定排序，排除包顶层 trace/hash；items 内的来源 trace、scope、revision、内容、exclusions、预算和到期时间参与计算。旧的短哈希不会与新哈希兼容。历史上只有元数据、没有完整文档的 pack 行保留，但新读取接口不会将它们当作可恢复快照。

## 读取、失效与错误

GET 在只读 repeatable-read 事务中读取包与来源，检查文档结构、scope、hash、预算、到期时间和来源清单完整性。候选来源发生修改、删除、状态变化或重新分类时，来源指纹不匹配，原包失效；这也包括当时因预算或过期而排除的候选项。新增加的来源不会改变已保存快照，需重新编译才能纳入。有效性检查基于该次数据库快照。

返回标准 WCP envelope，`data` 含 `pack_id`、`version`、`created_at`、`used_tokens` 和完整 `pack`；外层保留 trace、revision、ETag、server_cursor 和 source_refs。`format=markdown|mcp` 仍返回 JSON envelope，同时增加 `data.rendered = { uri, mimeType, text }`，不是裸 Markdown 响应。HTTP 成功与错误响应均标记 `Cache-Control: private, no-store`。

| 错误 | HTTP | 调用方处理 |
| --- | --- | --- |
| `CONTEXT_PACK_NOT_FOUND` | 404 | 指定包不存在或当前无权读取；可编译新包 |
| `CONTEXT_PACK_STALE` | 409 | 来源改变，使用新请求键重新编译 |
| `CONTEXT_PACK_EXPIRED` | 410 | 包已过期，使用新请求键重新编译 |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 原键参数或权限范围不一致 |
| `CONTEXT_SOURCE_LIMIT` | 400 | 当前项目候选超过 1000 条，或来源链检查达到节点/深度/工作上限 |
| `CONTEXT_PACK_INVALID` | 500 | 存储文档或来源元数据无效，需检查数据 |
| `CONTEXT_PACK_STORAGE_UNAVAILABLE` | 503 | 存储不可用；保留原请求参数与键重试 |

## 客户端与工作台

- SDK：`compileContextPack`、`getContextPack`，类型来自 `@planemem/contracts`。
- CLI：`context compile`、`context get`，均返回 WCP JSON envelope。
- MCP：`compile_context_pack`、`get_context_pack`，以及 `work://project/{project_id}/context-pack/{pack_id}` 和 `work://project/{project_id}/context-pack/latest` 资源模板。模板读取返回带来源信息的 JSON envelope，每次都重新检查有效性。
- Web `/context`：支持关键词、层级、分类、状态和条目类型筛选，显示条目正文、来源及 revision；展示保存包的预算、hash、有效期、入选内容和 exclusions，并可编译新包。排除项提供 source/expired/budget/policy 的说明和处理提示，可在新标签页打开当前条目；入选内容也提供当前条目入口。说明描述保存时的选择结果，不把已失效包的旧正文作为当前有效内容展示。列表筛选不会改变编译输入。

工作台提交成功前检查回执的包 ID、版本、预算、token 统计、scope 标识、时间及摘要格式，异常响应保留为未知结果；该检查不在客户端重算内容哈希，完整快照及来源验证仍由网关读取流程负责。不确定提交结果时锁定原参数和请求键，后续登录、权限或一般 4xx 错误不会自动清除未知状态，也不会因错误刷新页面而丢弃原请求。

MCP resources/list 已增加保存包发现：按 ID 顺序每页最多检查 8 个候选，复用正常 context.pack.read 后仅返回通过检查的 pack_id URI。拒绝、未找到、过期和来源变化会跳过，存储不可用/损坏返回错误；没有 latest 别名。游标按最后扫描候选推进，空 resources 仍可能带 nextCursor，客户端应继续分页直至没有 nextCursor。目录检查不承诺稍后读取仍有效，具体分页规则见 [MCP 运行时](mcp-runtime.md)。036 目录索引仅写入文件，未执行。

对同一保存请求，网关只在找到原持久包后返回 `CONTEXT_PACK_STALE`（409）或 `CONTEXT_PACK_EXPIRED`（410）。工作台保留结构化错误码，以这两种明确结果结束未知状态，显示原包已保存但不可用，并要求用户点击“Prepare a fresh pack request”后再提交；不自动换键或发起第二次写入。只有错误状态码、没有对应业务码时，不按此规则解除锁定。普通读取遇到这两种错误则提示核对当前知识并生成新包，不能原地刷新旧快照。

## Web 保存包完整读取（2026-11-04，源码增量）

`readWorkbenchContextPack` 在等待会话前捕获 latest 或指定 `pack_id`；显式空串、非法 ID 不再变成 latest。新增共享 `parseContextPackReadQuery` / `parseContextPackReadEnvelope` 与 `contextPackReadHashJson`，分别负责输入、完整结构与规范摘要输入；结构解析本身不计算 SHA-256，也不证明权限或来源真实性。原 `parseContextPackReceipt` 及编译/命令提交路径保持原行为。

- 查询是最多 4 KiB 的普通 JSON，只接受可选 `pack_id` 与 `format=json|markdown|mcp`，默认 json。Web 当前请求 json；共享契约也覆盖另外两种 JSON 封套格式，后续客户端可复用。
- 成功响应最多 2 MiB，错误最多 16 KiB；完整 UTF-8、媒体类型、声明长度、HTTP 状态和请求 trace 一并核对。原请求的 30 秒期限覆盖接收、结构校验和摘要计算，并在读取前后复核原会话到期状态。
- 完整封套拒绝未知字段，核对原 ID/项目、正安全版本/游标、正文与 HTTP ETag、完整来源及传输 trace。保存包的 `trace_id` 是编译时的记录，不要求等于本次 GET trace。
- 保留全部正文、来源顺序/重复和可选字段；所选项及排除项合计最多 1000、ID 不重复，入选来源按首次出现去重后必须恰好等于包来源，外层来源为包引用加包来源。检查层级/分类/确认/置信度/优先级、严格预算及内容长度估计，不重新排序或截断；时间要求与当前持久化入口一致的 UTC 毫秒格式和有效日历时间。
- Web 服务端使用 Node SHA-256 对规范内容重算摘要：对象键递归排序、数组顺序保持，仅排除包顶层 trace/hash，保留条目 trace。摘要不匹配时不交付任何包内容。来源清单与实时可用性仍由网关数据库快照检查；客户端校验不是认证、来源访问或未来有效性保证。
- json 格式不接受额外 rendered；markdown/mcp 格式要求 rendered 存在，URI 必须为原项目和具体包 ID，文本必须完整匹配既有 Markdown 规则，空包对应空文本。
- 固定错误提示不展示服务端任意错误文本；未找到/来源改变/过期代码还需分别匹配 404/409/410。包读取失败仍保留独立目录，异常响应提供保留原筛选、条目、页位置及包选择的显式重试。重试 latest 仍为 latest；指定包不自动改读其他包或重新编译。

超限/不完整的旧返回将明确失败，不自动缩小包、隐藏条目或回退旧快照。SDK、CLI 与 MCP 工具/资源/候选目录专用适配见下文，Mock见[独立保存包读取](context-pack-mock-runtime.md)，独立Schema见本文顶部链接；Schema/解析器自动一致性、OpenAPI及运行兼容证据仍待后续任务。R-003 保持未完成，`evidence: []`；本轮仅源码文档人工审阅与格式/文本检查，未编译、类型检查、测试、运行产品/浏览器/API/数据库或发布。

## SDK 保存包完整读取（2026-11-04，源码增量）

`WcpClient.getContextPack(input?, options?)` 现在返回 `Promise<ContextPackReadEnvelope>`。输入沿共享 `ContextPackReadQuery`（可选 pack_id/format），新增 `WcpContextPackReadOptions`（timeout_ms/signal）；这三个类型均从 SDK 根入口导出。`data` 保持完整 `ContextPackReceipt`，外层 revision/etag/server_cursor/source_refs 保留。

- 异步前复制合法项目、可选 actor/client 相等约束、包选择和格式；这两个可选身份字段不是授权声明，实际权限仍由 Gateway 判定。读取不带上下文的 idempotency_key/expected_version/if_match；省略 format 时保留原 URL，默认 json。显式空 ID、未知/继承/访问器字段、无效期限或 signal 被拒绝；平面可选 undefined 字段仍按省略处理。
- 4 KiB 查询、2 MiB 完整响应沿共享契约，核对完整正文、原范围/指定包/请求 trace、来源顺序、预算估计、版本/JSON 内 ETag/游标、UTC 毫秒时间及格式。markdown/mcp 仍为 JSON 封套，其 URI 与全文必须吻合原具体包。未知字段和部分返回不被默默丢弃，自定义 transport 的结果同样先复制并完整核验。
- 默认 30 秒总预算覆盖凭据等待、网络读取、结构校验和共享规范内容的 WebCrypto SHA-256 计算。timeout_ms 为 1–2147483647 的整数；signal 取消和期限检查前后生效，结束清理定时器/监听器。底层忽略取消时仅停止本地等待，迟到结果不交付，不保证底层请求或摘要已停止。
- SHA-256 能力缺失/执行失败返回 `CONTEXT_PACK_INTEGRITY_UNAVAILABLE`，保存摘要不匹配返回 `CONTEXT_PACK_HASH_MISMATCH`，结构/大小错误返回 `GATEWAY_RESPONSE_INVALID`，取消/超时分别为 `GATEWAY_REQUEST_CANCELED` / `GATEWAY_REQUEST_TIMEOUT`。只保留匹配原 trace 的已知错误代码并映射固定提示，不透传任意服务端/自定义 transport 文本。
- Fetch 复用 bounded-json，成功 2 MiB、错误 16 KiB，并核对完整字节/UTF-8/媒体类型与响应 trace。通用 WcpTransport 返回值不包含 HTTP ETag 或实际状态，SDK 仅核对 JSON 内版本/ETag，不声称拥有 Web 那样的 HTTP ETag 或业务错误状态码配对检查。transport 自身更短期限仍可能先结束读取。
- 非法输入现在以 Promise 拒绝报告；旧调用方若只包围同步调用，需改为 await/catch。自定义 transport 须支持 bounded-json、max_response_bytes、signal，提供完整合法封套及真实保存 hash；SDK 不补造字段、摘要、来源，也不回退 latest、自动重试或编译新包。

以下为未执行的接线示例，`client` 为带原项目上下文的 WcpClient，`savedPackId` 为调用方持有的保存包 ID：

```ts
const controller = new AbortController();
const pending = client.getContextPack(
  { pack_id: savedPackId, format: 'markdown' },
  { timeout_ms: 30_000, signal: controller.signal },
);
// 用户取消时调用 controller.abort()；同一 Promise 通过 await/catch 接收结果。
const envelope = await pending;
const receipt = envelope.data;
```

摘要一致性不是来源真实性或持续有效性证明；Gateway 继续检查保存包和来源数据库快照。CLI 与 MCP 工具/资源/候选目录适配见下文，Mock见[保存包模拟读取](context-pack-mock-runtime.md)，独立Schema见本文顶部链接；Schema自动一致性、取消与旧调用兼容等运行证据仍缺，R-003 未完成、`evidence: []`。本轮只开发并人工审阅源码文档、格式及文本，不编译、类型检查、测试、执行 SDK/产品/API/数据库或发布。

## CLI 保存包完整读取（2026-11-04，源码增量）

`workctx context get` 的网络 main、`callGateway` 和嵌入 `runWorkctx` 均接入现有上下文专用读取执行器，再调用 SDK `getContextPack`。输出保留完整原封套，结构、JSON 内版本/ETag/游标、原范围/trace、完整内容/来源/预算及 rendered/SHA-256 检查沿上述共享契约。

- 最多一个 `--json` 或 `--json-file`，省略等于 `{}`；输入含可选 pack_id、format=json|markdown|mcp，最多 4 KiB。空 ID 不回退 latest；JSON 内可提供成对 expected_actor_id/expected_client_id，只有一项或不合法则用法错误。网络支持有界 `--json -`，嵌入不读 stdin；文件沿现有稳定文件读取，文件/stdin 采集发生在 SDK 预算前，等待 EOF 不受该期限控制。
- 可选 `--timeout-ms` 为 1–2147483647 的整数，默认 30000；成功 2 MiB、Fetch 错误 16 KiB，涵盖接收/校验/摘要。不接受 --key、--output、写字段、未知或重复参数，不自动编译、回退、重试、保存或截断输出。
- 嵌入复制可信上下文、清除写条件，调用前后复核未过期实际 context.read；admin 不替代该能力。完整项目/actor/client 来自该上下文，可选 expected 只约束相等；核对 SDK 实际 GET 路径、头、无正文、bounded-json 和响应上限，再由原 router 执行 context.pack.read，保持原策略与审计。
- 嵌入完整结构检查后复核入选项 sensitivity；缺少 data.restricted.read 时拒绝任何 restricted 入选内容。排除项只有 ID/理由，其可见性和候选来源检查仍由 Gateway 负责，不从缺失分类推断权限。SDK 再独立核对完整响应与 SHA-256，不把来源引用视为外部真实性证明。
- 保存包、目录、当前/归档详情、历史、版本、比较共用每 router 两笔读取容量。SDK 超时只停止等待，底层 router 真正结束才释放；容量约束该嵌入 router 等待，不声称覆盖之后 SDK 的本地摘要计算、输出写入或网络服务端并发。
- 通用 SDK 返回值不暴露 HTTP ETag 或实际状态，CLI 只核对 JSON 内版本/ETag；网络 Fetch 沿有界 JSON 媒体类型/字节/trace 处理。结构不完整、未知字段、超限或摘要错误均失败，不再接受旧的元数据占位封套。

`context get` 默认 latest 的用法与 JSON 输出形状保持，默认格式请求会规范为 json。CLI/SDK 兼容、权限/容量/超时、输入边界与真实 Gateway 摘要运行证据待补；MCP 工具/资源/候选目录适配见下文，Mock见[保存包模拟读取](context-pack-mock-runtime.md)，独立Schema的CLI查询锚点保留成对身份约束，见本文顶部链接。R-003 未完成，`evidence: []`；仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行 CLI/SDK/产品/API/数据库或发布。

## MCP 保存包工具完整读取（2026-11-04，源码增量）

`get_context_pack` 通过 `dispatchMcp` 的上下文专用执行器读取；参数仍是可选 pack_id/format，省略 ID 表示 latest，省略格式表示 json。只接受完整普通 JSON，输入最多 4 KiB；工具 Schema 使用 ULID 定义，与实际查询解析一致。身份和项目仅从可信上下文复制，不接受参数里的身份或写条件。

- 工具发现、prepare 与调用均要求已认证且未过期的客户端、实际 context.read、完整 scope/actor/client/trace，admin 不代替读取能力。HTTP 入口沿统一工具分类要求客户端认证。旧的直接 `prepareMcpTool` 调用会收到 `MCP_TOOL_EXECUTOR_REQUIRED`，须迁到 dispatchMcp 或专用执行器。
- 清除继承写条件，固定原项目的内部 GET /v1/context-pack；内部 ApiGateway 按既有约定将查询放入 body（不是外部 HTTP GET 正文），仍通过原权限策略、项目可见性、来源检查和审计。
- 完整成功 2 MiB、错误 16 KiB，普通 JSON 复制后核验 HTTP 状态/content-type/x-trace-id；成功 HTTP ETag 必须等于共享封套中的版本 ETag，错误不能携带 ETag。未找到/来源改变/过期错误代码还须分别匹配 404/409/410。错误只输出原 trace 的已知固定提示，原任意错误文本不透传。
- 共享校验保留原包、项目、内容、来源、预算、版本/游标及记录 trace，并核对 json/markdown/mcp 格式；渲染 URI 与全文匹配具体保存包。额外检查入选 restricted 分类与可信读取能力；排除项的可见性仍由 Gateway 决定，不从只有 ID/理由的记录推断授权。
- Node SHA-256 沿共享规范输入重算，仅排除包顶层 trace/hash，条目 trace 保留。摘要不可用或不一致分别报告 CONTEXT_PACK_INTEGRITY_UNAVAILABLE / CONTEXT_PACK_HASH_MISMATCH，不交付任何未核对包。摘要一致不代表外部来源真实性、当前写授权或未来有效性；保存内容仍是非可信引用资料。
- 包、目录、当前/归档详情、历史、版本与比较共用每 ApiGateway 两笔读取容量。30 秒单调期限覆盖内部读取、校验、摘要与输出包装；保存包使用 MCP_CONTEXT_PACK_BUSY/TIMEOUT，原其他工具错误码保持。超时只结束等待，底层工作真正结束才释放名额；不保证能中断数据库或同步摘要，也不涵盖外部 HTTP 发送。
- 返回仍为单条 content text，文本中是完整原 WCP 封套，业务上限 2 MiB，二次转义包装上限 4 MiB+4096。没有部分正文、自动换包、重试、编译、来源访问或写入。

本增量只覆盖工具调用；保存包 resources/read 和 resources/list 候选发现的专用边界见下文，Mock见[保存包模拟读取](context-pack-mock-runtime.md)，独立Schema见本文顶部链接，其根结构不包含MCP外层包装。R-003 未完成，`evidence: []`，需要补调用/发现/权限、旧替身与生产返回兼容、摘要/格式、容量/超时等运行证据。本轮仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行 MCP/产品/API/数据库或发布。

## MCP 保存包资源完整读取（2026-11-04，源码增量）

`resources/read` 的 `work://project/{project_id}/context-pack/{pack_id}` 与 `work://project/{project_id}/context-pack/latest` 现由上下文资源专用处理器读取，与当前条目资源共享实现和容量。原 URI、application/json MIME、单个 contents 元素及外层 source_refs 保持；text 中是完整保存包 WCP 封套，具体 pack_id 由其中的 data 明确给出。

- 仅接受最多 4 KiB 的 `{ uri }` 普通 JSON，额外字段被拒绝。项目和最后一个路径段只解码一次，项目必须等于可信上下文，包段只能是合法 ULID 或精确 latest；无查询参数、片段、多余斜杠或自动纠正。响应保留原输入 URI，latest 不伪装成固定版本引用；非法或跨项目选择不触发包读取。
- 在处理器内复制可信身份，要求已认证、未过期、实际 context.read 与完整 scope/actor/client/trace，admin 不替代；清除继承写条件。先核对父项目可见性，再执行原 context.pack.read，保留内层策略与审计。策略/审计耗时后也重新检查期限和身份，过期则不启动数据读取。
- 完整内层封套最多 2 MiB，复用共享结构解析，核对原项目/指定包/trace、版本与 JSON 内 ETag/游标、来源、预算、全部入选和排除内容。资源固定读取 json 格式；Markdown/MCP 渲染选择继续使用 get_context_pack 工具。入选 restricted 内容必须有相应可信能力，排除项与来源可见性仍由 Gateway 判断。
- Node SHA-256 按共享规范内容核对保存摘要，不匹配或摘要能力失败明确报错；记录 trace 与本次读取 trace 分别保留。不交付不完整、超限或未经核对的包，不访问外部来源、不自动换包/重试/编译或写入。
- 包与当前条目资源共用每 router 两笔容量及处理器 30 秒期限，沿既有 MCP_CONTEXT_RESOURCE_BUSY/TIMEOUT。期限涵盖项目可见性、内层读取、结构/摘要和输出包装；超时底层真正结束才释放名额。工具读取有独立容量；处理器之前的外层授权/审计和之后的 HTTP 发送不在该期限内。
- 错误封套最多 16 KiB，核对原 trace 后映射固定提示；不透传底层任意错误文本。内层 router 返回业务对象，不具备 HTTP 头或状态，因此只核对 JSON 内 ETag，不声称 HTTP ETag/业务错误状态码配对检查。完整包装包含转义正文及重复来源，总上限 6 MiB+8192，不截断正文或来源。

旧的直接条目资源函数导出保持，现与保存包共用容量；不完整的旧保存包替身需补齐真实封套和摘要。模板和其他资源读取保持既有实现；资源候选目录的独立边界见下节。R-003 未完成、`evidence: []`，URI/权限/摘要/容量/超时/旧调用兼容运行证据仍缺。本轮仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行 MCP/产品/API/数据库或发布。

## MCP 资源目录完整读取（2026-11-04，源码增量）

`resources/list` 经 `mcp.catalog` 的 resources 分支进入独立目录处理器。返回仍是资源 URI/name/MIME 元数据，`nextCursor` 表示还有候选需要检查；包正文只用于验证，不放入目录结果。非包候选只做元数据发现，不代表已经逐项读取或授权正文。

- 捕获可信身份，要求 schema v1、已认证未过期客户端、实际 context.read、完整 scope/actor/client/trace 和有效能力/角色集合；admin 不替代。清除继承写条件。内部查询仅接受 kind=resources 与可选 Base64url cursor，完整普通 JSON 最多8 KiB；这不等于新增整个外层 JSON-RPC 参数校验。
- v3 游标绑定原项目范围、账号、客户端、actor_type 与排序去重后的完整能力/角色集合。旧 v1/v2 游标或身份/权限变化明确要求首屏重读；trace 和到期时间不参与绑定，同身份与权限的有效新令牌可继续。游标只表达续页位置，不授予数据权限或提供快照保证。
- 数据库候选完整复制为普通 JSON，最多256 KiB和101项；所有项先核对精确 kind/id 形状、有效种类/编号、项目 overview ID、proposal/session/pack ULID、严格UTF-8 C顺序、无重复且排他地位于原游标之后。损坏或超限拒绝整页，不能截断后返回。查询和原可见性条件保持，项目不可见仍为空目录；未执行 SQL 或迁移。
- 每页最多检查100个候选，其中最多8个包。候选包调用原 context.pack.read，保留策略/审计，固定原ID与json格式；完整封套最多2 MiB，校验原scope/ID/trace、版本/JSON内ETag/游标、全部内容/来源/预算，再核对 Node SHA-256 及入选 restricted 权限。摘要一致不证明来源真实性或未来可用性，来源当前有效性仍由原 Gateway 读取负责。
- 候选错误须为完整16 KiB以内、原trace的合法封套，映射已知固定提示。仅 DENIED、CONTEXT_PACK_NOT_FOUND/EXPIRED/STALE 可跳过；损坏、摘要错误、存储失败或未知错误中止整页，不伪装为空目录。跳过的包仍推进最后已检查位置，因此空 resources 配合 nextCursor 是合法续页，调用方应按游标判断结束。
- 每router独立两笔目录容量，单调30秒期限覆盖候选查询、逐包授权/读取、完整校验、摘要与包装；阶段性重验身份与期限，过期或超时不再启动后续包读取。MCP_RESOURCE_DIRECTORY_BUSY/TIMEOUT 明确报告容量或等待失败。超时底层工作实际结束才释放容量，不保证中断已有数据库调用或同步摘要；工具与资源正文读取使用各自容量。
- 最终完整目录封套最多1 MiB，保留 schema_version/trace_id/source_refs（mcp/catalog）/data。内层router不提供HTTP状态或ETag头，仅检查JSON内ETag；外层授权审计、协议包装及网络发送不在处理器预算内。无自动翻页、换包、重试、编译或写入。

R-003 未完成，`evidence: []`。真实数据库返回/SQL成本、游标迁移与令牌续期、候选内容/错误、容量/超时及客户端兼容证据仍待补；模板和其他资源正文边界另行开发，保存包Mock见[独立模拟读取](context-pack-mock-runtime.md)，独立完整包Schema见本文顶部链接，资源目录元数据不属于该Schema根。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

## 后续范围

网页已增加指定双包只读对比，详见下一节；比较仍使用现有完整读取，不提供失效包的绕过入口。

ContextItem 已补充公开创建、编辑、归档、恢复和人工确认，见 [ContextItem 开发说明](context-item-runtime.md)。持久包已接入 [本地来源链递归检查](context-source-runtime.md)：无效链以 source 理由排除，选中内容的寿命不超过任何有效本地后代的寿命；source_manifest 保存 dependency_hash，读取时再次核对，旧包缺少摘要时要求新键重新编译。此改动未新增迁移，也没有重写旧包。

检查点已增加持久包 ID 绑定和续接前校验，见 [检查点上下文绑定](checkpoint-context-runtime.md)。旧内嵌包仍只保留历史哈希/来源，续接明确标记未验证，不自动迁移。

外部来源自动摄取仍待接入；搜索 hit 索引不会自动变成 ContextItem。工作项投影读取仍走已有路径。模型专用 tokenizer、更大项目的候选分页、保留/清理策略、后台失效通知和运行验证仍待后续工作。

## 网页指定保存包对比（2026-11-04，源码增量）

`/context/packs/compare`比较同项目两个明确保存ID。上下文页面顶部提供入口，保存包卡片可预填已读到的具体ID；省略一侧只显示表单，不读取包，也不自动选择latest。两ID必须为不同ULID，不要求版本升序；相同ID、重复/未知参数、非法格式在发起读取之前失败。提供`from`、`to`、`show=all|changes`及可选`return_to`页面参数，后续候选查找参数`q`见下节，业务查询仍只对应`{from_pack_id,to_pack_id}`，最多4 KiB。

返回地址只允许应用内`/context`或`/context/packs`及其合法查询，重新使用对应导航解析器核对筛选、页大小、游标、条目/包或基础包及允许的原搜索返回；拒绝片段、重复参数和外部地址。地址最多16 KiB字符，页面参数普通JSON最多24 KiB。返回原浏览位置不会重新选包或赋予权限；比较页不根据URL切换账号或项目。全部/只看变化、反向比较及失败重试保留两包原ID、显示选项和已核对的返回地址。切换显示方式会重新读取原两ID；无预取或自动重试。

Web先捕获同一会话/项目范围及Gateway基址，随后两次顺序GET都固定指定pack_id与json格式，使用原令牌、无缓存且拒绝重定向。两次读取、完整解析、SHA-256及本地比较共用30秒总期限，阶段检查会话到期并同时检查墙钟/单调期限；finally清理定时器和取消信号。会话获取、页面渲染及响应发送不在该读取期限内，尚无独立Web比较并发名额。每侧沿既有2 MiB成功/16 KiB错误、HTTP状态/content-type/原trace/ETag、完整原范围/内容/预算/来源及Node SHA-256核对。

比较前必须两侧全部读取成功；任何权限、到期、来源变化、摘要、容量、网络或结构错误都不交付半份比较，不重编译、不回退旧包或latest。`CONTEXT_PACK_EXPIRED/STALE`仍由原Gateway检查，因而这个入口不能比较目前已无法读取的历史包。成功表示两次各自的读取观察，不是同一数据库快照，也不保证第一包在第二次读取后仍有效；不恢复条目、不刷新来源、不执行写入。

共享`parseContextPackComparisonQuery`和`compareSavedContextPacks`由contracts根入口导出，附带`ContextPackComparisonQuery`、`SavedPackCandidate`、`SavedContextPackComparison`类型。纯比较函数接受两份完整json成功封套，分别有界复制和结构校验，要求同原项目、两个不同包ID；**它不会计算摘要或检查实际读取权限**。已有的rendered返回不能直接替代json封套。共享结果最多8 MiB，Web保留两份完整原封套与比较的组合最多12 MiB，均受原普通JSON的深度/100000节点限制；单份合法不保证组合一定可交付，超限整份失败，不截断候选、正文或来源。

对比规则如下：

- 按候选ID联合两边的入选和排除列表，状态为selected/excluded/absent；保留完整原条目或排除理由和各自列表从1开始的位置。行顺序先取基础包入选、排除，再追加对比包尚未出现的候选，最多2000个ID。不是按名称合并或推断当前知识是否删除。
- added/removed指候选只在一边出现，不仅指入选内容；两边存在但selected与excluded互换计changed并显示Selection。两边都入选时分别比较Layer、Content、Sources、Confirmation、Confidence、Priority、Classification、Saved trace、Revision、Expiry及Selection reason；两边都排除时比较排除理由。缺失可选字段与已提供字段不同。
- 同状态下比较绝对位置，标记Order；前方候选增删造成后续编号变化也会记录，不能据此推断发生了主动重排。对象键顺序不算内容变化，数组顺序、字符串空白、正文全文和来源顺序保留；不进行语义摘要或忽略保存trace。
- 单列保存ID、版本、创建时间、保存游标、包摘要、保存trace、预算、估算用量、到期时间及入选/排除数量。原HTTP读取trace不当作保存内容变化，单独显示供定位。包内容摘要相同并不要求保存ID/版本相同。
- 聚合来源保留两侧完整引用及顺序，独立显示变化。每候选可展开两侧正文及完整保存字段；只看变化隐藏same候选及相同元数据，来源相同时保留提示。候选无变化时仍显示可能变化的包信息，不把空差异当成同一保存记录。

Web、下节SDK、CLI及MCP已接入双包对比，专用Schema见本文顶部链接；旧完整读取Schema描述各侧封套，新的对比Schema引用它描述本地组合。R-003未完成、`evidence: []`；双侧完整性/摘要、状态迁移/位置/字段、原范围/期限、导航与真实页面兼容都缺运行证据。本轮只源码文档人工审阅和格式文本检查，未编译、类型检查、测试、渲染、启动浏览器/产品/API/数据库或发布。

## 网页双包对比候选查找（2026-11-05，源码增量）

`/context/packs/compare`新增可选单值`q`，与独立查看页采用相同的文字边界：trim前最多256 UTF-16单元，拒绝C0/DEL控制字符和孤立代理项，空白规范为省略；不截断过长或错误参数。完整页面输入仍限24 KiB，原两包ID/模式/有限返回校验保持；只有两侧明确且有效才调用比较读取。

候选查找在完整双侧读取、摘要核验和共享差异报告之后进行，不缩小网络读取或绕过未显示候选的检查。按JavaScript小写后的字面包含匹配候选ID、任一侧入选正文、任一侧排除原因码；不存在的一侧不会匹配，不搜索元数据/来源JSON或当前项目，也不执行正则。先得到全体文字匹配，再应用show=changes隐藏same候选；顶部added/removed/changed/same总计仍表示原完整报告，元数据和聚合来源继续只受既有show模式影响，不受q影响。

候选区显示文字匹配数/全部候选数及当前可见数，被changes隐藏的未变匹配另有数量。两包都空、文字无匹配、文字有匹配但全部未变这三种情况分别提示；后者提供保留q的“Show all matching candidates”，不让空列表暗示没有其他属性或来源变化。清除文字只移除q，保留两ID、show和return_to；匹配结果按原报告顺序，保留原状态、差异标签、两侧完整值及各自入选/排除位置。

上方选择表单和结果区查找均可编辑q；模式切换、反向比较、失败重试保留q及原两包/返回位置。打开任一完整包时，将带q的比较地址作为已经验证的return_to，原read导航会重新解析并保留它；读页自身的包内q是独立显示条件，不将比较q误用为单侧筛选。比较页只接受context或保存包目录返回，仍无读页递归或任意外部返回。每次GET仍重新读取原两包，保持原总读取期限、权限和完整性要求，无latest、自动分页/重试/写入。

范围仅compare页面及导航与文档，不改变共享报告/API/SDK/CLI/MCP，也不新增样式或依赖。R-003保持未完成、`evidence: []`；两侧selected/excluded/absent匹配、大小写/Unicode边界、空状态/变化模式、反向及单包往返、完整报告保持和真实浏览器兼容仍缺运行证据。仅源码人工审阅与格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

## SDK 指定保存包对比（2026-11-04，源码增量）

`WcpClient.compareContextPacks({from_pack_id,to_pack_id}, options?)`返回`Promise<WcpContextPackComparisonResult>`。查询沿共享4 KiB普通JSON规则，两ID都必填且为不同ULID，保留方向，不接收format/latest/写字段。options复用`WcpContextPackReadOptions`：默认timeout_ms=30000，允许1–2147483647的安全整数，可传signal；非法输入以Promise拒绝，不发起第一份读取。

调用前client context必须含合法tenant/workspace/project/actor/client及trace，actor与scope为ULID、client满足原上下文读取标识及共享完整身份约束（包括拒绝DEL字符）。参数、选项与身份在任何异步等待之前捕获；访问器、未知字段、非普通对象被拒绝。读取上下文不继承请求键、版本或If-Match。每次固定指定ID与json格式，并带相同`x-expected-actor-id/x-expected-client-id`及项目头；即使transport刷新凭据，也不能悄悄更换原身份约束。约束不是凭据，实际认证和来源当前有效性由Gateway负责。

两次顺序读取复用原`readSavedContextPack`，每份完整2 MiB封套核对原ID/scope/trace、JSON版本/ETag、全部内容/来源/预算后计算WebCrypto SHA-256。共享纯模型生成最多8 MiB差异；SDK完整返回（含两侧原封套、查询、身份及差异）最多12 MiB，最终复制脱离内部引用。原普通JSON深度/100000节点限制也作用于组合，任一超限为GATEWAY_RESPONSE_INVALID，不返回半份或截断数据。

外层单调预算覆盖两侧等待、摘要、比较和最终复制；内层单包读取收到同一外层取消信号，不会给第二份重新延长总期限。每阶段复查预算，超时归一为GATEWAY_REQUEST_TIMEOUT、显式取消为GATEWAY_REQUEST_CANCELED，不交付迟到结果；finally清理外层计时器与监听，内层沿原清理机制。同步解析/比较不能中途抢占，不能保证终止已经在运行的transport或WebCrypto任务。本增量不新增SDK并发限制；Mock或Gateway保留自身容量规则。

结果包含：

| 字段 | 含义 |
| --- | --- |
| schema_version / kind | 1 / saved-context-pack-comparison，本地组合格式 |
| comparison_origin / read_consistency | local / separate-reads，两次读取不是同一数据库快照 |
| content_state | pack-hashes-checked，两侧完整保存摘要均已核对 |
| source_state | not-checked，SDK不独立访问或刷新来源；不否认Gateway已有来源检查 |
| query / identity_constraints | 原双ID与完整账号/客户端/项目约束，无token |
| from / to | 两份完整原json封套，方向、保存内容与trace保持 |
| comparison | 上节共享完整候选/字段/来源/统计差异 |

已知读取错误保留固定代码并使用对比固定说明；过期/来源变化/不可读、摘要不可用或不匹配、第二次网络失败等都使整次对比失败，不自动回退latest/旧包、重试、重编译或保存。通用`WcpTransport`不暴露HTTP状态与ETag头，本方法只核对JSON内ETag，不能声称HTTP头核验；FetchTransport错误仍沿16 KiB完整限制。自定义transport必须支持bounded-json/signal并交付完整封套，不能依靠两个旧不完整替身获得有效对比。

SDK根导出`WcpContextPackComparisonResult`、`ContextPackComparisonQuery`、`SavedPackCandidate`、`SavedContextPackComparison`以及纯`parseContextPackComparisonQuery/compareSavedContextPacks`。纯比较可用于已持有封套的结构差异，但自身不做摘要/权限核验；不能把其输出标记为SDK已检查结果。原`MockContextPackStore`通过两次普通GET即可接线，同一store保留完整种子、模拟权限和失效状态，不新增比较路由或跨数据集同步。

以下仅为未执行的源码用法，client已由调用者以完整身份构造，两个包均需在该会话下可读：

```ts
import type { WcpClient, ContextPackComparisonQuery } from '@planemem/sdk';

declare const client: WcpClient;
declare const selection: ContextPackComparisonQuery;
const cancellation = new AbortController();
const result = await client.compareContextPacks(selection, {
  timeout_ms: 15_000,
  signal: cancellation.signal,
});
// result.from/result.to保留完整两侧，result.comparison.candidates包含原方向差异。
// 需取消时由调用方调用cancellation.abort()；不会重发或编译包。
```

CLI及MCP对比适配见后续章节，组合Schema见本文顶部链接；自动一致性和SDK/Mock/真实Gateway兼容、身份刷新/总预算/取消/完整结果边界运行证据仍待补。R-003保持未完成、`evidence: []`；本轮仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

## CLI 指定保存包对比（2026-11-04，源码增量）

`workctx context compare-packs` 在网络 main/callGateway 与嵌入 runWorkctx 中调用上节 SDK `compareContextPacks`。它与条目版本命令 `context compare` 独立；两侧均为指定的已保存包，不能省略编号读取 latest。输入恰含四字段：不同 ULID `from_pack_id`、`to_pack_id`，以及 `expected_actor_id`、`expected_client_id`。账号及客户端必须与当前可信读取身份一致，项目沿用原配置。

必须选择一个 `--json` 或 `--json-file`，UTF-8 输入上限4 KiB。文件沿用稳定普通文件读取；仅网络入口允许 `--json -` 有界读取标准输入，嵌入入口拒绝 stdin。拒绝额外/重复选项、写字段、`--key` 和 `--output`。`--timeout-ms` 为1至2147483647的整数，默认30000，覆盖两次SDK读取、摘要核对、比较和结果复制；文件/stdin采集及stdout发送不计入该期限。

嵌入入口捕获并清理原上下文写条件，要求已认证、未过期、实际具有 `context.read` 的完整身份。按from/to原顺序，仅允许两次显式 `format=json` 包读取；核对GET路径、完整身份/范围/trace头、无正文及2 MiB响应限额。沿用Gateway原授权与审计，并在包处理器执行前再次检查取消及权限；该检查也覆盖原 `context get` 包分支。完整解析后核对入选restricted条目权限，SDK继续执行SHA-256核对。八种上下文读命令共用每router两笔容量，等待超时后仍保留名额至底层router真正结束。

stdout返回上节完整SDK结果：原query/identity_constraints、from/to及comparison；差异上限8 MiB、完整组合上限12 MiB，仍受既有JSON深度/节点限制。保留local、separate-reads、pack-hashes-checked、source_state=not-checked语义；候选移除不表示项目知识删除。任一包过期、来源变化、不可读、摘要异常、超时或第二次读取失败，整次命令失败；不返回半份结果，不自动换包、重试、编译或保存。通用transport不暴露HTTP状态/ETag头，只核对JSON内ETag；两次读取不构成同一数据库快照。

示例仅供使用说明，本轮未执行。先准备 `pack-comparison.json`，将示例身份替换为原项目下实际账号/客户端，两包编号替换为可读保存包：

```json
{
  "from_pack_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "to_pack_id": "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  "expected_actor_id": "01ARZ3NDEKTSV4RRFFQ69G5FAX",
  "expected_client_id": "workctx-local"
}
```

```text
workctx context compare-packs --json-file pack-comparison.json --timeout-ms 30000
```

反向比较须显式交换两个包编号；命令不会覆盖输入文件。R-003未完成、`evidence: []`，网络/嵌入/SDK兼容、总期限/授权等待/容量、文件/stdin输入和完整输出仍缺运行证据；MCP对比见下节，独立组合Schema见本文顶部链接。本轮仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布。

## MCP 指定保存包对比（2026-11-04，源码增量）

新增只读工具 `compare_context_packs`。输入只允许 `from_pack_id`、`to_pack_id` 两个不同ULID，上限4 KiB；未知字段、相同编号、format/latest、调用者提供的身份或写条件均拒绝。完整身份取自捕获的可信上下文，清除继承的幂等键/版本/If-Match。工具发现、HTTP客户端要求、prepare和实际调用复用上下文专用读门禁：已认证且未过期，完整项目/账号/客户端/trace，实际具有context.read，admin不代替该能力。`prepareMcpTool` 保持明确返回MCP_TOOL_EXECUTOR_REQUIRED，实际比较由dispatchMcp或专用执行器执行。

按原方向顺序执行两次指定 `format=json` 包读取。内部ApiGateway沿用原GET路由、策略和审计，查询在内部请求body传递，不创建新REST比较路由。每侧完整成功2 MiB、错误16 KiB，核对HTTP状态/type/trace/ETag、原范围和指定编号、保存内容/来源/预算；Node SHA-256核对保存摘要，入选restricted条目需要可信data.restricted.read。过期、来源变化、不可读和摘要失败仍阻止整次返回；第一侧失败不开始第二侧，第二侧失败不交付第一侧内容。

结果为单个MCP文本项，其text是完整JSON组合，与SDK/CLI采用相同字段：schema_version=1、kind=saved-context-pack-comparison、comparison_origin=local、read_consistency=separate-reads、content_state=pack-hashes-checked、source_state=not-checked，以及query、identity_constraints、完整from/to和comparison。共享比较模型保持候选选中/排除/未出现、完整正文/理由/位置/来源/预算差异；候选移除不表示项目知识删除。比较上限8 MiB，完整结果12 MiB，转义MCP文本包装24 MiB+4096；仍沿既有JSON节点/深度约束，不截断或省略大字段。

八类上下文读工具共用每ApiGateway两笔容量，本次两侧读取、摘要、比较、完整序列化和文本包装共用一次30秒期限。阶段间复查期限及捕获权限；沿MCP_CONTEXT_PACK_BUSY/TIMEOUT及固定已知错误说明。超时停止等待后，槽位保留至底层工作实际结束，后续阶段不会启动第二次读取。内部ApiGateway请求没有中止能力，已开始的授权/审计/读取可能继续；外层授权审计与HTTP发送不计工具期限，同步解析也不能抢占。无自动换包、重试、编译、来源访问或写入，两次读取不构成同一数据库快照，摘要一致不证明外部来源真实。

调用示例仅用于说明，本轮未执行，需替换为当前项目可读的真实保存包编号：

```json
{
  "jsonrpc": "2.0",
  "id": "compare-saved-packs",
  "method": "tools/call",
  "params": {
    "name": "compare_context_packs",
    "arguments": {
      "from_pack_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "to_pack_id": "01ARZ3NDEKTSV4RRFFQ69G5FAW"
    }
  }
}
```

反向比较须显式交换两编号。R-003保持未完成、`evidence: []`；发现/调用/prepare兼容、完整双侧及转义输出边界、超时/共享容量和真实Gateway/MCP客户端兼容仍缺运行证据，独立组合Schema见本文顶部链接。本轮仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行MCP/SDK/Mock/产品/API/数据库或发布。

## 网页保存包独立查看（2026-11-04，源码增量）

`/context/packs/read`提供独立的只读查看页。原`/context?pack=...`依然保留，但它先读取context目录，目录失败会阻断保存包展示。新页面直接复用`readWorkbenchContextPack`，无需目录或当前条目详情成功；未选包时只显示查找表单，不读取latest。上下文页面头、保存包卡片链接、目录失败恢复，以及对比结果/失败页的两侧入口均接到新页。

包选择参数只允许单个`pack`、`latest`、`return_to`，后续包内显示参数`q`/`show`见下节。`pack`要求完整ULID，显式空串或非法编号直接失败；`latest`只能为字符串`1`，并与pack互斥。用户可输入编号，也可点击独立的“Read the latest visible pack”按钮。latest每次重新选择最新可见包，成功后提供实际保存ID的固定链接；不把latest当作失效编号或读失败后的回退。

`return_to`只能是本应用`/context`目录、`/context/packs`保存包目录或`/context/packs/compare`对比地址，逐字段使用已有导航解析器重新构建。单个返回地址最多64 KiB字符，完整导航输入JSON最多96 KiB；原context 16 KiB、compare 24 KiB等内部约束仍执行。拒绝未知/重复/数组参数、外部地址、片段和任意读页嵌套；对比页已验证的context或保存包目录返回可以保留一层，保存包目录本身没有return_to。目录筛选/游标/基础包、对比两个ID/显示方式/原目录返回在返回按钮中保留，链接不会自动重定向或授予权限。

读取使用原当前会话与项目边界，沿用完整json包2 MiB、错误16 KiB、HTTP状态/type/trace/ETag、保存范围/预算/来源/内容及Node SHA-256核对和30秒读取期限。页面只有完整读取成功后才显示版本、创建/到期、预算、摘要、原编号及完整入选条目正文/保存字段；排除原因和完整来源、完整响应封套也可展开。内容按文本显示，来源仅作为保存引用，不执行其中的HTML或指令，不访问外部来源。过期、来源变化、不可读和完整性异常均沿原错误失败。

失败保留原pack或latest选择以及return_to，用GET表单显式重试；不会自动刷新、换包、重试、重新编译或写入。latest重试可能选择不同包，界面有说明；固定ID重试始终使用原ID。成功可用具体包ID预填新的对比，也可返回原对比页继续原两侧选择。原编译和目录页面行为不变；页面渲染、交互及HTTP发送不在读取期限内，不承诺总页面容量或来源持续有效。

R-003未完成、`evidence: []`。独立读取与目录故障隔离、有效/非法URL、身份/过期/来源/摘要错误、完整正文空白/Unicode显示、返回/重试/最新固定链接和真实浏览器兼容仍缺运行证据。本轮只源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

## 网页保存包包内筛选（2026-11-05，源码增量）

独立`/context/packs/read`增加显示条件`q`和`show`。`q`在trim前最多256 UTF-16单元，拒绝C0/DEL控制字符与孤立代理项，空串或全空白规范为省略，不静默截断。`show`只允许all/included/excluded，缺省或all规范省略，显式空值/未知枚举报错。所有参数仍须单值且在白名单，完整导航仍限96 KiB，不允许借显示条件扩展return_to层级或外部跳转。未选包时不自动读取，查找表单和显式latest动作保留现有显示条件。

完整2 MiB包及原响应/范围/版本/来源/摘要校验成功后，才计算用于显示的数组：q按JavaScript小写后的字面包含匹配入选ID或完整正文、排除ID或原因码（policy/expired/budget/source）。不使用正则/数据库搜索，不对来源或保存JSON的其他属性作全文索引，不修改包内容、确认状态、预算或原校验输入。全部候选在读阶段照常验证，隐藏内容不绕过权限/完整性检查。

显示结果保持原入选列表序号和排除顺序；顶部保存统计不变，另显示可见条数/原总数和当前隐藏的列表。真正空列表与有条目但无文字匹配采用不同提示，清除筛选可回到完整列表。入选完整正文/字段与匹配排除原因可展开，来源和完整原响应始终保留，不因筛选删减；区段链接仅指向当前可见列表以及完整来源区段。

筛选GET表单、清除链接和固定链接使用这次读取实际返回的pack_id，并保留原有限return_to；即使从latest进入，筛选也不会再次选最新包。固定链接保留q/show，清除只去掉显示条件；每次GET仍重新授权并完整读取相同保存ID，不缓存为永久可读。显式“Read latest again”保留原动作和显示条件，可能读取新的包；读取失败继续保留原pack/latest、q/show及return_to供显式重试，不退回全量或切换包。比较入口仍按既有规则保留基础包和原目录/对比返回，没有增加读页递归返回。

范围仅read页面与导航及文档，复用既有样式；无Gateway/SDK/CLI/MCP/共享协议、数据库或新依赖变更。R-003未完成、`evidence: []`，文字/Unicode/空匹配、原序号和完整数据、固定latest筛选、返回/错误恢复及真实浏览器兼容证据待补。仅源码人工审阅和格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

## 保存包元数据目录（2026-11-05，源码增量）

`GET /v1/context-packs`与`/context/packs`网页提供保存包编号发现。该目录只显示已保存的`pack_id`、`version`、`created_at`、`expires_at`、`budget_tokens`、`used_tokens`，不读取pack_document正文、摘要或source_manifest，不逐包核对当前来源。过期或来源变化的记录仍可能出现；点击完整读取/对比时沿原路径检查内容、摘要、来源和当前权限，失败不会自动换包。

- 身份：已验证且未过期的客户端、合法账号/项目范围及实际context.read；管理员不替代该能力。只读repeatable-read事务先检查父项目存在、未删除及分类可见，再按同范围、pack_document非空和保存read_restricted过滤。没有restricted读取能力时隐藏restricted包；不返回隐藏总数。父项目不可见返回CONTEXT_PACK_NOT_FOUND/404。
- 查询：只接受单值可选`pack_id`（完整ULID）、`limit`（默认25、1–100）、`cursor`。HTTP页大小只接受无前导零的正整数文本，拒绝未知/重复查询、非空正文/transfer-encoding、幂等/写条件、条件缓存与Range。共享JSON查询限4 KiB。精确编号无匹配时返回空页，不回退latest。
- 分页：按version DESC、pack_id的ASCII/C顺序DESC，先过滤后取limit+1；逐条检查，包括多取的一条。游标为规范base64url编码的位置及SHA-256绑定，绑定范围/账号/客户端/actor_type/角色能力/页大小/精确筛选；身份或条件改变须重新开始。游标不是签名、授权或冻结跨页快照，每页重新授权；并发变更可能改变后续可见记录。精确编号查询不产生next_cursor。
- 响应：schema_version=1、原trace_id、单个`{type:'context-pack-directory',id:project_id}`来源标记、完整scope、规范化原query（显式limit）、`content_state='metadata-only'`、`source_state='not-checked'`、data数组和可选next_cursor。单条快照2 KiB、完整响应256 KiB，核对安全整数版本、UTC毫秒创建/到期先后、预算128–32768及used不超预算、唯一编号、顺序/游标位置与原筛选。异常整页失败，不显示部分结果；来源标记仅指目录项目，不是包来源引用或内容真实性证明。无HTTP/外层ETag。
- 资源边界：每router独立两笔目录读取容量，30秒单调处理器期限覆盖事务等待、元数据校验与封套生成；容量占用返回RATE_LIMITED/429，超时返回CONTEXT_PACK_DIRECTORY_TIMEOUT/503，底层工作实际结束才释放。不能保证取消已发出的数据库调用、限制全局SQL扫描成本或同步工作耗时；外层认证/授权/审计和HTTP发送不计该期限。异常元数据CONTEXT_PACK_INVALID/500，存储不可用CONTEXT_PACK_STORAGE_UNAVAILABLE/503，非法参数/绑定INVALID_INPUT/400。
- Web：在当前会话范围内读取一页，完整校验HTTP状态/JSON/trace/无ETag及共享封套，成功256 KiB、错误16 KiB；另有30秒读取期限和阶段性会话到期检查。会话获取、渲染和发送不计读取期限。失败保留原筛选/游标显式重试，另可回首屏；无自动翻页、重试或缩页。网页参数pack/limit/cursor/base均单值，空pack表单表示不筛选；base为已选基础包ULID，仅用于导航，不发送Gateway。基础包随筛选/翻页保留，从任意页选择不同包后进入原对比页；read/compare返回保留目录位置及base，目录没有return_to，返回解析保持有限层级。

本轮无新依赖或迁移，SQL源码复用016索引，未执行SQL。SDK、CLI和MCP目录适配见下文，Mock目录见[模拟保存包目录](context-pack-mock-runtime.md#保存包元数据目录2026-11-05源码增量)；独立目录Schema及局部OpenAPI见本文顶部链接，全量OpenAPI与权限/分页/超时/真实浏览器兼容证据待补。现有MCP资源候选目录仍按其原协议执行，不能与本元数据目录混同。R-003未完成、`evidence: []`；仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、渲染、执行产品/CLI/SDK/MCP/Mock/API/数据库或发布。

## SDK 保存包目录读取（2026-11-05，源码增量）

`client.listContextPacks(query?, options?)`返回`Promise<ContextPackDirectoryEnvelope>`，读取既有`GET /v1/context-packs`的一页元数据。SDK根导出`WcpContextPackDirectoryQuery`（共享规范查询的可选字段形式）、`WcpContextPackDirectoryReadOptions`、`WcpContextPackDirectoryPagesOptions`，以及共享`ContextPackDirectoryQuery/Record/Scope/Envelope`类型。

- 查询只接受pack_id/limit/cursor，平面可选undefined允许并在共享解析前移除；拒绝未知/继承/访问器字段、空编号或非法游标，不把错误筛选变成latest。JSON查询4 KiB，limit默认25、最大100；URL始终携带规范limit。固定调用时的项目范围/trace及已提供actor/client约束，清除原写条件，不发正文，不改已有完整包读取/编译/对比。
- 请求使用bounded-json与256 KiB成功限额；共享解析器再次限制并复制完整JSON，包括自定义transport的对象。核对scope、规范query、trace、目录来源标记、metadata-only/not-checked、全部六字段记录及排序/唯一性/原游标位置/续页一致性，不显示或返回部分页。目录不需要WebCrypto、不读取或核验包摘要，过期/来源变化包仍可能列出，明确调用getContextPack或compareContextPacks才检查完整包。
- options仅timeout_ms/signal，timeout_ms默认30000、整数1–2147483647，期限覆盖transport凭据等待、网络、完整读取和本地响应校验。同步校验只能在阶段边界检查，不能被计时器抢占；取消/超时后不交付迟到数据，finally清理计时器与监听。Fetch另有自身期限，两者先到者生效；停止本地等待不证明服务端SQL已取消。没有新增SDK并发限制，也没有自动重试、缩页或换包。
- `contextPackPages(query?, options?)`返回`AsyncGenerator<ContextPackDirectoryEnvelope, void, unknown>`。调用时就捕获筛选/页大小/原游标/超时/信号，并要求合法完整actor_id/client_id；每次next才开始一页读取且重用相等身份头，每页独立期限、等待调用方处理时不启动计时器或预取。max_pages默认100、整数1–1000；到限页没有续页时正常结束，仍有续页时下一次next抛CONTEXT_PACK_DIRECTORY_PAGE_LIMIT而不发请求。yield前保存续页，修改返回query/data/next_cursor不会改变迭代器的后续请求；无需累积全量页，也不自动去重。参数错误在创建迭代器时同步抛出，单页方法错误为Promise拒绝。break/return结束迭代；要立即停止进行中的读取应取消signal，return本身不会中止底层请求。
- 游标的身份/角色能力/条件绑定仍由Gateway检查；令牌刷新须保持原账号/客户端和游标条件，绑定变化明确失败，不能自动回首屏。跨页不是数据库快照，后续可见记录可能变化；即使完整页校验通过也不代表历史或来源当前有效。

错误保留匹配原trace的已知code，但使用SDK固定文本且retryable=false。非法输入INVALID_INPUT；身份/会话DENIED、UNAUTHENTICATED；不可见项目CONTEXT_PACK_NOT_FOUND；存储/元数据异常沿CONTEXT_PACK_STORAGE_UNAVAILABLE、CONTEXT_PACK_INVALID；服务端目录超时CONTEXT_PACK_DIRECTORY_TIMEOUT、容量RATE_LIMITED。SDK本地取消/超时为GATEWAY_REQUEST_CANCELED/TIMEOUT，完整响应异常为GATEWAY_RESPONSE_INVALID；未知或trace不匹配错误为GATEWAY_UNAVAILABLE，不输出任意服务端异常文本。

通用WcpTransport只返回解析正文，不提供HTTP状态或响应头，SDK不声称核对HTTP ETag或错误code/HTTP状态映射。Fetch沿既有bounded-json检查成功200、响应trace、JSON类型和完整成功字节，错误正文16 KiB及错误trace，401沿会话错误处理；自定义transport必须实现bounded-json/signal及完整响应，SDK收到对象后的限额不能代替网络接收限制。CLI/MCP适配见后续章节，Mock保存包store目录接入见[模拟目录](context-pack-mock-runtime.md#保存包元数据目录2026-11-05源码增量)；SDK读取器本身不使用WebCrypto，Mock传输为游标绑定使用WebCrypto，不能据此声称完成包摘要核验。

下面仅展示调用方式，假设client已配置正确范围和原actor/client；未执行：

```ts
const first = await client.listContextPacks({ limit: 25 }, { timeout_ms: 30_000 });
// Save the complete query and continuation before handing the page to mutable UI code.
const nextQuery = first.next_cursor
  ? { ...first.query, cursor: first.next_cursor }
  : undefined;
if (nextQuery) {
  const next = await client.listContextPacks(nextQuery);
  // Render next.data as saved metadata; open a specific pack separately.
}

const controller = new AbortController();
const pages = client.contextPackPages(
  { limit: 25 },
  { max_pages: 10, timeout_ms: 30_000, signal: controller.signal },
);
for await (const page of pages) {
  // Process each complete page here. A further continuation after 10 pages raises an error.
  // Breaking stops later pages; controller.abort() cancels local waiting during an active read.
}
```

R-003未完成、`evidence: []`。原条件/身份捕获、空页/精确筛选/分页顺序、变更输入与返回值、错误/取消/迟到结果、页数上限/生成器关闭及真实transport/Gateway兼容仍缺运行证据；独立目录Schema及局部OpenAPI见本文顶部链接，全量OpenAPI和自动一致性待补。本轮仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行SDK/Mock/CLI/MCP/产品/API/数据库或发布；无共享契约/Gateway/Web/依赖/迁移改动。

## CLI 保存包目录读取（2026-11-05，源码增量）

`context list-packs`读取当前项目的一页保存包元数据，网络main/callGateway和嵌入runWorkctx统一通过SDK `listContextPacks`。它与列出来源条目的`context list`分开，也不会隐式调用getContextPack、比较包或编译新包。

- 最多一个`--json`或`--json-file`，省略输入为`{}`。完整输入（含身份约束）上限4 KiB，文件要求既有稳定普通文件、严格UTF-8；仅网络入口允许`--json -`有界读取stdin，嵌入不接stdin。可选`--timeout-ms`为正整数文本、最大2147483647，默认30000。拒绝重复/未知选项、多个输入源、--key/--output及写字段。
- JSON只允许pack_id/limit/cursor，以及可选但必须成对的expected_actor_id/expected_client_id。身份约束验证后作为请求头/本地可信身份相等条件，剥离出业务查询；项目范围仍取原CLI配置或嵌入上下文。limit默认25、最大100；pack_id是精确ULID筛选，不接受format/latest，非法或空ID不变成其他选择。续页沿原limit/pack_id/账号客户端传回next_cursor；改变身份/权限/页大小/筛选需移除cursor重新开始。
- 返回完整schema_version/trace_id/source_refs/scope/query/content_state/source_state/data/next_cursor，256 KiB成功限额，Fetch错误16 KiB。保留metadata-only/not-checked和六字段记录，校验原范围/查询/trace、顺序/唯一性/续页位置。列表可能包含过期或来源变化的包；随后明确使用context get或context compare-packs时才检查完整包可用性。每次仅一页，无自动迭代、缩页、重试或保存文件，空页不能推断原包已经删除。
- 嵌入要求已验证、未过期的实际context.read和完整合法项目/账号/客户端，固定原身份并核对SDK的确切GET路径、原头、无正文与256 KiB响应限额。调用原context.pack.list处理器前沿router策略/审计，并在授权后再检查取消/到期；父项目及read_restricted过滤由原处理器负责。六字段目录没有分类标记，不能据此独立证明restricted过滤，嵌入调用方必须配置可信原处理器。返回后再次完整核验与权限/取消检查，不返回半页。
- 九类上下文读取共用每router两笔嵌入容量；SDK超时只停止等待，底层router实际结束才释放。生产目录处理器另外保留自身容量/期限。30秒本地SDK预算覆盖等待与响应核对，文件/stdin采集和stdout发送在外；stdin等EOF不可由该期限取消。通用transport不提供HTTP状态/ETag头，SDK只承诺已暴露正文的完整绑定校验，Fetch沿既有bounded-json检查。

成功为退出码0和完整JSON；参数不合法沿USAGE_ERROR/退出码2，读取失败沿退出码1且无部分stdout。已知错误code及固定文本沿SDK，令牌到期/权限改变/非法绑定不自动换账号或回首屏。仅源码示例，未执行：

```sh
workctx context list-packs
workctx context list-packs --json-file saved-pack-list.json --timeout-ms 30000
```

`saved-pack-list.json`示例（身份须换成当前账号与客户端；下一页在同一对象增加cursor，值来自上页next_cursor）：

```json
{
  "limit": 25,
  "expected_actor_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "expected_client_id": "workctx-cli"
}
```

R-003未完成、`evidence: []`。三入口一致性、参数/文件/stdin边界、身份与权限/取消、元数据排序/分页/错误、底层容量保留及真实CLI/Gateway兼容尚无运行证据；MCP目录见下节，Mock目录和独立目录Schema及局部OpenAPI见本文顶部链接，全量OpenAPI和自动一致性待补。本轮仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布；无SDK/共享契约/Gateway/Web/MCP/Mock/schema/依赖/迁移变化。

## MCP 保存包目录读取（2026-11-05，源码增量）

`list_context_packs`通过tools/call列出当前项目的一页已保存ContextPack元数据，供选择具体pack_id后调用get_context_pack或compare_context_packs。仅六字段保存元数据，不读取包正文、hash或来源；过期/来源变化包仍可能列出，metadata-only与not-checked标记必须保留。它不替代resources/list现有候选目录的逐包检查、扫描预算或资源URI返回协议。

- 工具Schema是封闭对象，仅可选pack_id（精确ULID）、limit（默认25，1–100）和cursor（规范base64url，最多2048字符）；完整输入4 KiB，空对象合法，未知字段、外部身份、写条件、format/latest均拒绝。入口使用共享严格解析器，直接调用执行器也不能绕过字段与大小边界。
- 工具发现、HTTP已验证客户端要求、prepare和协议调用复用上下文读取门禁：必须完整可信tenant/workspace/project/actor/client/trace、未过期且含实际context.read，管理员不替代。prepareMcpTool对合格调用返回MCP_TOOL_EXECUTOR_REQUIRED，避免绕过有界执行器；使用dispatchMcp或executeContextReadTool。身份在异步读取前捕获，原写条件移除，不能从arguments补入或替换。
- 内部ApiGateway请求为GET /v1/context-packs，按既有内部约定把规范化查询放入内部body；公开HTTP GET仍使用URL查询参数。沿原router策略审计与目录处理器当前父项目/read_restricted过滤。六字段元数据没有分类/正文证据，执行器不据此独立推断restricted可见性；可信原处理器必须负责过滤。
- 成功必须HTTP200、application/json、相同x-trace-id、无ETag；完整业务封套上限256 KiB，包含schema_version/trace_id/source_refs/scope/query/content_state/source_state/data/next_cursor。共享解析器核对原范围/查询/trace、固定目录来源标记、全部记录及排序/唯一性/筛选/游标/下一位置。错误正文上限16 KiB、相同trace且code/status一致：INVALID_INPUT=400、DENIED=403、NOT_FOUND或CONTEXT_PACK_NOT_FOUND=404、RATE_LIMITED=429、CONTEXT_PACK_INVALID=500、存储/目录等待/认证或审计服务不可用=503；未知code或不一致响应变成GATEWAY_RESPONSE_INVALID。输出只用固定文本和retryable=false，不泄漏任意内部异常。
- MCP结果是单个content文本项，text中保留完整业务JSON，业务上限256 KiB；转义后的content包装另限512 KiB+4096。整体JSON-RPC外壳/请求ID和网络发送不在该文本包装上限内。超限或不完整均整次失败，不截断或交付半页；错误沿现有tools/call isError结果封装。
- 九类上下文工具共用每ApiGateway两笔容量，30秒单调期限覆盖内部Gateway读取等待、完整解析和MCP包装；阶段性重验当前捕获身份的到期/能力。目录容量占满为MCP_CONTEXT_PACK_DIRECTORY_BUSY，本地超时为MCP_CONTEXT_PACK_DIRECTORY_TIMEOUT，服务端目录处理器超时沿CONTEXT_PACK_DIRECTORY_TIMEOUT。底层工作结束才释放，超时不能保证中止内部ApiGateway/数据库调用，也不能抢占同步校验；外层HTTP认证/发送不计该期限。未新增独立并发池或全局SQL限额。

每次只取一页；next_cursor作为下一次cursor时保留原limit/pack_id、账号客户端与角色能力，绑定改变需显式重新开始。无自动翻页、缩页、重试、换包、编译或写入，页与页不是同一快照，列表显示不代表完整包现在可读或来源真实有效。仅源码调用示例，未执行：

```json
{
  "jsonrpc": "2.0",
  "id": "saved-pack-list",
  "method": "tools/call",
  "params": {
    "name": "list_context_packs",
    "arguments": { "limit": 25 }
  }
}
```

R-003未完成、`evidence: []`。工具发现/客户端/prepare/协议兼容、完整查询与身份捕获、错误状态/页边界/转义输出、页序/续页及容量/超时/真实MCP兼容尚缺运行证据。Mock目录和独立目录Schema及局部OpenAPI见本文顶部链接，全量OpenAPI和自动一致性待补；本轮仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。无新REST路由、SDK/CLI/Web/Mock/schema/依赖/迁移变更。

## CLI 保存包提交核验（2026-11-05源码增量）

`context compile`从通用提交迁移至独立CLI适配，网络main、程序调用callGateway与嵌入runWorkctx统一使用SDK compileContextPack。保留既有命令及默认预算4096/最大寿命3600秒，增加完整回执/摘要核验和总等待期限；不实际执行本节命令，只开发源码。

- 输入最多一个 `--json` 或 `--json-file`，省略为{}，包括身份约束和正文键在内共4 KiB；文件沿稳定普通文件/严格UTF-8读取，内联文本也按UTF-8字节限额，兼容开头BOM。仅网络入口允许有界 `--json -`，嵌入拒绝stdin。`--timeout-ms`默认30000，接受1–2147483647规范正整数文本；未知/重复选项、多输入源、--output、业务未知字段和版本/写条件均拒绝。文件/stdin采集在SDK期限之前，EOF等待不可用该期限取消，stdout输出也在期限之外。
- JSON允许budget_tokens/ttl_seconds、可选idempotency_key，以及可选但必须成对的expected_actor_id/expected_client_id。预算/期限共享严格整数范围128–32768/60–86400，规范默认值明确发送。请求键必需，可来自--key或JSON；嵌入另允许原可信context.idempotency_key，程序调用允许options.key，所有提供的来源必须逐字相等，冲突不覆盖也不生成新键。键限1–255 UTF-16单元，拒绝空白、C0/DEL和孤立代理项。账号为ULID，客户端为有效非空、最多255单元标识；身份约束剥离出业务正文，只用于相等头或嵌入原身份比较。
- 网络范围来自原CLI配置/传入options，token、范围、trace、参数、键在异步保存前捕获。显式身份约束成对发送，省略时沿旧认证方式，不能固定未指定的身份。Fetch与SDK共用所选期限配置，SDK总期限覆盖凭据/网络/完整响应/摘要；完整成功2 MiB、Fetch错误体16 KiB，通用transport无HTTP状态/响应头，核对JSON内ETag。
- 嵌入要求已验证、未过期的实际context.read及完整项目/账号/客户端，管理员角色不代替实际能力或restricted权限。原context复制后仅以一致原键提交，清除expected_version/if_match；严格核对一次POST的路径、八个头、规范正文、bounded-json及2 MiB限额。原router仍负责策略/审计，授权审计之后再次检查取消和身份有效期，才允许handler执行；handler结束后复查，完整封套核验后另拒绝无data.restricted.read却含restricted入选内容的结果，SDK继续摘要核验，交付前再检查身份有效期。父项目可见性、真实来源、存储及请求键归属仍由可信原handler负责，客户端检查不能替代。
- 嵌入每router独立最多两笔保存，与九类上下文读取容量分开。SDK超时只停止等待，底层router实际结束前不释放保存名额；卡住的底层操作仍占容量。取消发生在授权等待期间时，授权结束后不会继续派发handler；已经进入handler的操作仍可能完成保存，返回前取消/过期/结构/摘要检查失败也不能撤销保存。

成功退出0、stdout为完整原WCP封套，不裁剪包或添加自造键归属证明。参数/文件错误沿USAGE_ERROR退出2；请求/权限/回执失败退出1，不输出半份内容。SDK错误的compile_stage/compile_dispatch_state/server_outcome和固定恢复说明保留：尚未调用传输为not-sent/not-checked，调用传输后包括4xx、嵌入容量拒绝或回执异常在内的失败均保守started/unknown；该标记不是“handler已经执行”的证明，也不否定过去的同键保存。没有自动重试、读回、换键或本地持久化；调用方保留原项目、账号/客户端约束、预算、期限和键，仅显式以相同请求恢复。

兼容性变化：旧不完整自定义/模拟回执会失败；嵌入替身需要可信有效身份、实际context.read和完整可校验回执。新增严格输入白名单、字节上限和重复选项检查；以前被忽略的嵌入选项不再静默忽略。当前MockContextPackStore仍不提供保存实现。SDK无原键/请求TTL回显，完整预算、最大有效期和摘要匹配仍不能证明原键归属；省略身份约束的旧网络调用不能获得身份固定保证。没有新增进程信号处理或stdout交付保证，进程终止/输出失败也不能据此否定远端保存。

仅源码示例，未执行；`saved-pack-request.json`需由调用方保留，账号/客户端填写自己的原身份：

```sh
workctx context compile --key pack-001 --timeout-ms 30000
workctx context compile --json-file saved-pack-request.json --timeout-ms 30000
```

```json
{
  "budget_tokens": 4096,
  "ttl_seconds": 3600,
  "idempotency_key": "pack-001",
  "expected_actor_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "expected_client_id": "workctx-cli"
}
```

R-003未完成，evidence为空。三入口/输入和文件边界、旧键兼容、授权等待取消、过期及容量保留、完整真实回执/摘要和未知结果恢复均待运行证据。本轮只源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行CLI/SDK/Mock/API/保存命令、数据库或发布；未改变Gateway、SDK、共享契约、Web、MCP、Mock、Schema、依赖或迁移。

## MCP 保存包提交核验（2026-11-05源码增量）

`compile_context_pack`沿既有tools/call名称和write语义进入专用执行器。发现、prepare以及直接执行共同要求schema_version=1、authenticated_client=true、有效未过期令牌、实际context.read、合法项目/账号ULID及非空客户端/trace；管理员角色不替代实际能力。工具身份全部来自捕获的可信上下文，禁止参数覆写账号、客户端、范围或版本。mcpToolRequiresClient继续通过write标记生效。

输入为最多4 KiB普通有限JSON，仅budget_tokens、ttl_seconds、idempotency_key；共享解析规范默认4096/3600和整数范围128–32768/60–86400。工具Schema仍要求显式idempotency_key，直接调用兼容此前可信context.idempotency_key回退，两个来源同时提供时必须相同；不自动生成键。键1–255 UTF-16单元，拒绝空白、C0/DEL及孤立代理项。捕获原参数、完整身份和键后发送独立规范参数副本，清除外层版本条件；保留明确原键及身份相等头，实际内部身份仍以可信context为准。

每次最多一次内部POST /v1/context-pack/compile，仍沿原ApiGateway路由、策略/审计及持久幂等处理。完整响应仅接受HTTP200，核对application/json、x-trace-id和HTTP ETag与JSON内版本ETag相等；成功2 MiB、错误16 KiB。共享保存解析覆盖完整封套/范围/候选/来源/用量/时间关系，预算等于原预算，保存至到期间隔不超过原TTL，允许来源缩短有效期和重放原创建时间/包内trace。没有data.restricted.read时拒绝返回restricted入选项。Node SHA-256能力在派发前初始化，随后按原完整包规范JSON计算摘要，仅匹配pack_hash才包装完整内容；不交付半份或未核对包。

错误要求五字段普通封套、原trace、无ETag及已知code/status组合，并丢弃上游消息/details/retryable，改用固定文本和本地未知结果诊断。映射针对当前**内部ApiGateway**：INVALID_INPUT、CONTEXT_SOURCE_LIMIT、WORKBENCH_AUTH_UNAVAILABLE为400，DENIED为403，路由/handler/包不存在为404，旧键重用或来源变化为409，包过期410，RATE_LIMITED429，存储数据损坏和INTERNAL_ERROR500，存储或审计不可用503；INTERNAL_ERROR只转换为固定GATEWAY_UNAVAILABLE。外层HTTP认证监听器另有其401/503行为，不能套用这些内部映射；未知或不一致组合返回GATEWAY_RESPONSE_INVALID。

整次执行自输入捕获起共用30秒期限，包含内部等待、完整解析、Node摘要及MCP转义文本包装，阶段结束均复查期限和身份有效期。独立每ApiGateway最多两笔保存，与上下文读取容量分开；MCP_CONTEXT_PACK_COMPILE_BUSY表示本次未调用内部接口，TIMEOUT表示停止等待。超时名额只在底层工作实际结束后释放，迟到结果不会再交付。**内部api.handle不可取消**：即使超时发生在策略/审计等待期间，内部操作之后仍可能执行保存；不提供授权后取消、数据库回滚或进程终止恢复保证。外层HTTP认证和实际网络发送不计入工具期限。

输出沿content文本返回完整WCP封套，封套2 MiB，工具content包装上限4 MiB+4096；JSON-RPC外层元数据继续由协议层添加。失败由协议层返回isError及固定错误JSON，details含compile_stage=input/integrity/transport/response/output、compile_dispatch_state=not-sent/started和server_outcome=not-checked/unknown。调用api.handle前失败仅not-checked，不能否定历史同键保存；开始调用后任何错误（含4xx、返回核验/摘要/包装失败）均unknown，不采纳上游“未保存”声明。调用方保留原项目、账号/客户端、预算、期限和键，显式恢复时只能使用相同原请求；无自动重试、换键、读回、回执文件或恢复存储。完整摘要和参数关系仍不能证明原请求键归属，回执没有原键/请求TTL回显；真实权限、来源有效性和幂等绑定由服务端负责。

兼容性：旧prepareMcpTool裸HttpRequest路径对本工具返回MCP_TOOL_EXECUTOR_REQUIRED，调用方迁移至dispatchMcp或专用执行器；不完整模拟响应、缺ETag/trace、错误状态映射或摘要的旧替身会失败。工具发现现在要求有效且具有实际context.read的可信完整身份。SDK/CLI/Web与Mock源码在本增量未改，Mock仍无保存实现。仅源码示例，未执行：

```json
{
  "jsonrpc": "2.0",
  "id": "save-context-pack",
  "method": "tools/call",
  "params": {
    "name": "compile_context_pack",
    "arguments": {
      "budget_tokens": 4096,
      "ttl_seconds": 3600,
      "idempotency_key": "pack-001"
    }
  }
}
```

R-003未完成、evidence为空。工具发现/prepare兼容、真实身份/重放、完整状态及回执/摘要、超时与迟到写入、占用容量和MCP输出边界均待运行证据。本轮仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行MCP/API/SDK/CLI/Mock/保存请求、数据库或发布；无REST路由、共享契约、依赖或迁移变化。

## 网页保存包提交核验（2026-11-05源码增量）

`compileWorkbenchContextPack(budget, ttl, key)`保留原公开函数签名，server-api重导出新的独立保存helper，表单action直接使用它。预算/期限沿共享严格整数解析，原键1–255 UTF-16单元、拒绝空白/C0/DEL/孤立代理项；表单字段只接受一个字符串，重复字段拒绝，键不再trim后替换。旧validatePackReceipt浅检查保留供旧调用方使用，本保存流程不再调用它。

输入先捕获，再读取有效session；沿现有token claims、session配置及运行配置顺序选择合法ULID范围，捕获本次token/到期时间/Gateway/参数/键。Gateway仅http(s)、无嵌入凭据/查询/片段，Node SHA-256在派发前初始化。单次POST使用原键及项目头，不继承写版本条件；完整成功2 MiB、错误16 KiB，复用有界流读取/严格UTF-8/JSON和解码后字节限额。30秒单调时钟期限覆盖fetch、完整接收、结构和摘要核验，以AbortController及整次Promise竞速停止本地等待，丢弃迟到结果并取消可用的响应体；session读取、表单采集、缓存刷新和导航在期限外。停止等待或中止fetch不能证明服务器撤销保存。

除早期401外，响应必须HTTP200或有效错误状态、application/json及原x-trace-id，错误禁止ETag。401可能缺少业务trace/正文，直接给固定重新登录提示并保留提交后unknown。其他错误必须是五字段有界普通封套且code/status匹配：输入/来源上限400，权限403，不存在404，来源变化/键重用409，到期410，容量429，保存数据损坏500，存储/认证/审计不可用503；未知或不一致错误按响应无效处理，不透传上游文本/details。

成功复用共享完整保存封套验证，核对范围、trace、版本/游标、来源/候选/用量及时间关系，原预算精确相等、保存到到期不大于原TTL；来源缩短寿命和重放原保存时间/包内trace允许。HTTP ETag必须等于JSON内ETag，Node SHA-256按保存包规范JSON计算并精确匹配pack_hash后才返回完整封套。每个阶段复查期限及本次session到期。真实权限、restricted内容筛选和来源状态仍由Gateway决定；本helper没有独立能力声明，摘要与回执仍未回显原键/请求TTL，不能证明键归属。

ContextPackSaveError携带固定code/message、可用时已核验HTTP状态，以及compile_stage=input/session/integrity/transport/response、compile_dispatch_state=not-sent/started、server_outcome=not-checked/unknown。开始调用fetch后任何错误（包括401、4xx、会话到期、回执或摘要异常）均保守unknown；提交前失败不能否定历史同键保存。action按当前派发标记或此前未解决状态保持uncertain，不再按HTTP<500推断安全换键。无自动重试、换键、读回或本地保存。

表单未知状态继续锁定原预算/寿命；只有收到完整核验的409 CONTEXT_PACK_STALE或410 CONTEXT_PACK_EXPIRED时标记不可用，并允许用户显式“Start a separate fresh request”。该按钮不会把原结果改称未保存，文案明确可能已有原保存；它仅建立一个新的请求键供随后手动提交。其他未知错误仍要求沿原请求恢复。完整成功后取得已核验pack_id再跳转；revalidatePath失败不转成“保存未确认”并引导重发。后续打开包仍执行原独立读取核验，可能因来源变化或过期失败。

历史限制（本节描述上一轮源码增量）：当时会话和范围快照只覆盖一次调用，跨重新登录的账号/客户端和原Gateway/项目尚未固定，也未增加身份端点或持久原请求。下节“网页原请求准备与恢复”已增加新网页入口的完整绑定和浏览器原文保留，并替换本节旧表单的自动跳转行为；旧三参数helper仍仅提供单次调用保证，真实浏览器运行证据尚缺。

R-003未完成、evidence为空。完整网络回执/摘要、未知错误/过期重试、超时与迟到结果、session变化、缓存失败跳转及真实浏览器兼容证据待补。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、渲染、运行浏览器/API/SDK/CLI/MCP/Mock/保存请求、数据库或发布；无后端、共享协议、样式、依赖或迁移变化。

## 网页原请求准备与恢复（2026-11-05源码增量）

网页保存入口分为准备、审阅固定原请求和显式发送。准备只读取可信save-context，不提交保存；它捕获规范Gateway基址、完整tenant/workspace/project/actor/client、restricted读取桶、原请求键及显式budget_tokens/ttl_seconds。原请求为schema_version=1、kind=context-pack-save、binding/request_key/parameters的封闭普通JSON，最多8 KiB，拒绝未知/缺失字段、非普通值和非法标识。原预算/期限必须显式，键不trim或自动替换；参数默认值仅在初始编辑器显示。绑定不保存token、cookie或会话期限，因此原身份的有效会话续期可以重新使用，但读取一个新身份不能改写旧绑定。

Gateway基址仅http(s)、无凭据/查询/片段，URL规范化后保留路径并移除尾部斜杠；输入绑定必须已经是规范值，基址文本最多4096字符。准备和恢复都由服务器当前配置生成基址；提交前必须与当前配置规范基址相等，客户端文件不能使服务器把token发送到另一个地址。五项身份沿save-context的严格限制，restricted为必填布尔值。编码按固定字段顺序产生完整原文，文件导入允许JSON格式/键顺序差别，但不补缺字段、不接受省略参数或替换请求键；导入内容仍须逐项审阅，文件不是签名或历史保存证据。

准备成功后所有原参数冻结并显示Gateway、完整身份、预算、期限、权限桶及请求键。用户可显式保存浏览器副本或导出context-pack-original.json；下载提示只确认已请求浏览器下载，不声称文件已落盘或包已保存。发送必须再次审阅勾选，前端先保存并确认完整浏览器副本，再调用只接受original/confirmed的server action。重复字段、未知字段、超限/非法原文拒绝。每次发送（包括重试）都核对同一原文，不能借新的表单预算或当前登录信息覆盖原请求。未发送的新请求、已核验成功或过期/来源变化反馈可显式保留原文后另起新键；其他未知结果维持原请求，浏览器副本不会自动删除。

浏览器存储为独立IndexedDB数据库planemem-context-pack-originals，原文与SHA-256分别放在originals/directory，以规范完整绑定及原键定位；同源浏览器之外不自动同步。WebCrypto计算固定原文摘要后，在同一readwrite事务检查两槽：同时缺失才add，同文及相同摘要保留，缺一槽/损坏/同键异文拒绝，不覆盖或删除。写入后同事务完整读回，等待事务提交后才返回，再复查本地期限。跨标签页同数据库事务串行处理；浏览器保存失败或结果未知时，本次UI发送不会启动，但已有保存/其他标签页或服务器结果仍可能存在。无法使用IndexedDB或WebCrypto时可导出原文，发送按钮的流程会阻止本次提交；本增量不添加绕过保留原文的发送选项。

新增/context/packs/recover独立页，只读取当前可信保存身份，不依赖当前包、上下文条目列表或项目记录是否可读。按完整当前绑定逐页读取最多20份原请求：目录先按原绑定前缀及排他续页键扫描，逐份同readonly事务读取原文/摘要，核对规范原文和槽键，再在返回页面前计算全部摘要。单份8 KiB、页面最多160 KiB原文；任一损坏/不匹配使本页完整失败，不显示部分通过。第21个合法槽键只表明存在下一页，不加载它的正文；下一页仍须独立完整核验，不代表跨页快照或全数据库审计。读不存在数据库不创建它；未被目录引用的孤立正文不属于本目录审计范围。

恢复页也可选择最多8 KiB原请求文件。列表打开或文件导入只加载完整原文并与当前Gateway/身份/restricted桶比较，不写浏览器、不调用保存；用户在原请求面板再次保存或发送时才写缺失副本。同范围已存在异文时不覆盖。权限桶或账号/客户端改变会隐藏旧绑定目录并拒绝不匹配文件，需恢复原身份和权限后再读；不把“没有找到”解释为未提交。旧无完整身份绑定的表单不能从当前会话猜回原身份，本增量不迁造这类恢复数据。

服务器compileWorkbenchContextPack保留前三参数兼容，新增可选原binding；新网页action始终提供完整binding，旧未绑定helper调用不获得该恢复保证。绑定调用先捕获一次session/token和当前scope/Gateway，比较原基址与项目，再用**同一个token**执行save-context GET：原actor/client头、完整16 KiB响应、HTTP状态/type/trace/无ETag、完整身份/期限/权限桶均核对。错误必须是已知身份读取码及相符HTTP状态；早期401给固定重新登录错误。权限桶或完整身份不同立即停止，不自动采用返回的新绑定。

随后POST使用同一token、原scope、参数、键及x-expected-actor-id/x-expected-client-id，Gateway再次执行真实权限/原身份条件。该GET和最多一次POST、完整回执/摘要核验共用服务器30秒单调时钟预算；保存时每阶段检查本次session与可信身份期限的较早者。session获取及输入预检仍在服务器计时外；独立准备/恢复身份GET也有30秒本地期限。绑定不等于锁定未来权限，来源、幂等键和事务仍由Gateway权威处理。请求期内会话凭据固定，之后重试会重新捕获有效会话并要求同一原绑定。

前端准备、浏览器保存/摘要、恢复文件/目录及保存action等待分别复用30秒本地操作预算，IndexedDB打开/事务沿原工具各10秒；用户可停止等待，组件离开时取消本地等待。保存前的截止检查阻止迟到本地工作继续派发；已调用server action后停止等待不撤销服务器保存，迟到结果不改写当前页面。反馈保持unknown，不因权限/登录/输入错误清除历史不确定性。只有真实POST收到已核验409 STALE或410 EXPIRED才允许本面板标记不可用，身份读取错误不能冒充保存结果。

服务器完整核验原2 MiB封套/预算最大TTL、HTTP ETag及SHA-256后，action返回原文与已核验pack_id/version/trace。前端核对回显原文并显示固定包读取链接；不自动导航丢失原请求，也不因revalidatePath失败提示重发。原浏览器副本保留，成功回执只在当前页面显示，尚无历史成功回执持久化；原请求结果只读接口已在后续[原保存请求回执查询](#原保存请求回执查询2026-11-05源码增量)接入SDK/CLI，Web接入见[网页原保存回执查询](#网页原保存回执查询2026-11-05源码增量)。重新载入原请求一律提示它可能已提交，再次发送需明确审阅。浏览器副本及普通文件不证明远端状态、真实来源或历史因果。

R-003未完成、evidence为空。真实浏览器关闭页面/续期恢复、双槽事务/跨标签页、完整目录/文件、输入/权限桶变化、超时和迟到写入、固定原身份重放及旧调用兼容证据待补。浏览器清理会删除恢复数据，当前没有备份/清理/容量策略或跨浏览器同步。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/API/SDK/CLI/MCP/Mock/保存请求、数据库或发布；未改共享协议、后端保存事务、其他客户端、依赖、样式或迁移。

## 保存前可信身份读取（2026-11-05源码增量）

新增GET /v1/context-pack/save-context → context.pack.save-context，供调用方在准备保存请求前取得可信原身份。HTTP沿真实Bearer认证、三范围相等检查及已认证client要求，既有workbench能力映射保持；策略前要求当前可信上下文确有context.read且token未过期，admin角色不能单独替代。随后沿context.read的OPA/本地策略和原审计链，handler在授权/审计等待之后重新核对认证客户端、实际能力和期限，构造完整结果后再检查一次到期。只返回调用方自身的认证元数据，不访问项目记录、保存包、来源图或编译器；项目是否仍可见和保存是否获准仍由实际保存请求决定。原审计仍可能持久写入读取决定。

共享`ContextPackSaveContextEnvelope`包含且只包含schema_version=1、当前trace_id、空source_refs及data；data严格包含以下字段：

| 字段 | 含义与约束 |
| --- | --- |
| identity | tenant_id/workspace_id/project_id/actor_id/client_id五项原身份；前三项与actor沿现有保存客户端ULID限制，client为1–255 UTF-16合法标识，拒绝C0/DEL/孤立代理项 |
| expires_at | 可信token到期时间，四位非零年份UTC毫秒格式；SDK与网关分别核对当前尚未到期 |
| permissions.compile | 必须为true，表示本次身份读取通过实际context.read和客户端门禁；不是未来保存承诺 |
| permissions.read_restricted | 当前可信能力是否包含data.restricted.read；保存时仍须重查，变化可能影响原键指纹 |

`parseContextPackSaveContextEnvelope`先复制有界普通JSON，最多16 KiB并沿既有深度/节点限制，拒绝访问器、非普通对象、隐藏字段、非有限值及未声明字段，再核对五项身份、时间形状、空来源、原trace和原项目范围。可分别指定原actor_id/client_id作为相等约束，缺省不猜测身份；返回独立对象。trace限255 UTF-16，拒绝空白值/C0/DEL/孤立代理项。解析器验证结构和绑定，不自行证明远端可信或当前时钟有效；不能把结构合法的历史身份直接当作仍有效的会话。

HTTP路径无查询、片段或正文，content-length只可缺省或0，禁止transfer-encoding。按rawHeaders读取原始头，16 KiB普通JSON预算内拒绝大小写重复，不能依赖Node合并后的头绕过身份条件。禁止idempotency-key、if-match、if-match-version、x-expected-version、if-none-match、if-modified-since、if-unmodified-since、range、if-range及content-encoding；traceparent与x-trace-id若出现都须等于本次trace。三范围及可选x-expected-actor-id/x-expected-client-id只能约束已验证值，不能覆盖身份。内部ApiGateway也检查这些头，handler只接受空命令输入并拒绝context上的幂等键/版本条件；内部空对象代表无参数，HTTP有正文的GET仍拒绝。内部路径匹配本身是精确GET，错误方法/路径为404；公开HTTP对此身份路径的错误方法/查询为400。

成功沿200 application/json、private, no-store、原x-trace-id，无ETag。非法输入400、权限/原身份不符403、认证失败401、速率限制429、可信身份无法表示500 CONTEXT_PACK_SAVE_CONTEXT_INVALID，认证设施或审计不可用503；原速率/审计机制保持，提前认证拒绝不保证业务trace响应头。身份handler不设额外并发池或服务器等待期限，外层认证/策略/审计可能等待，客户端本地期限不证明服务端中止。没有新增数据库表、键预留、保存事务或迁移。

SDK新增`getContextPackSaveContext(options = {})`，options仅timeout_ms/signal，默认30秒。调用开始捕获原范围、trace和可选原actor/client，移除继承写条件；最多一次bounded-json GET、完整16 KiB成功，Fetch错误沿原16 KiB限制，期限包括传输层的凭据等待/接收与结构核验。解析完整封套后核对原身份及当前到期，再检查本地期限；超时、取消和异常不交付半份或迟到结果。错误转固定白名单说明，不透传上游details；未知错误GATEWAY_UNAVAILABLE。通用WcpTransport只暴露JSON，SDK不声称独立检查HTTP状态或响应头。非法输入通过Promise拒绝，不发送保存、不自动重试，也不把返回身份写回原WcpClient或已有恢复请求。

`MockContextPackStore`通过既有MockWcpServer配置支持同一GET；无需compilations，可在packs为空、visible_pack_ids为空或project_readable=false时读取自身身份，但仍要求原显式会话read_context=true且未过期。请求遵守原范围/可选账号客户端条件、无正文/查询/写头/缓存/Range及重复头限制。输出16 KiB或调用方更小限额，返回原完整身份、固定expires_at及read_restricted，独立于包/目录内容和pending激活状态，不计算摘要、不占原读取或保存容量。30秒/signal沿原预算，只执行本地阶段检查；这不构成真实认证或授权审计证据。

以下为未执行的SDK接线示例。仅读取当前身份，不应使用它自动替换一份已有原请求的身份；恢复旧请求时应先在原client上下文设置旧账号/客户端相等条件，发现变化即停止原请求的发送。

```ts
const authority = await client.getContextPackSaveContext({ timeout_ms: 10_000 });
const originalIdentity = authority.data.identity;
const currentExpiry = authority.data.expires_at;
const visibilityBucket = authority.data.permissions.read_restricted;
// Retain the complete original binding when preparing a new save request.
// Reading authority alone does not submit or reserve an idempotency key.
```

本增量提供可信身份发现基础；网页接线已由上节“网页原请求准备与恢复”补充，包含跨重登录的原绑定核对和浏览器原文恢复；CLI/MCP身份读取入口见下节。独立Schema/OpenAPI及历史成功回执持久化仍待补。读取当前身份不能找回旧键、证明历史保存、证明项目可读或延长旧权限；既有compile入口保持其原兼容行为。R-003未完成、evidence为空，真实认证/策略审计/会话到期、HTTP与内嵌限制、SDK/Mock兼容和取消/限额运行证据待补。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行校验器/API/SDK/Mock/保存请求、数据库或发布。

## CLI/MCP保存身份入口（2026-11-05源码增量）

CLI新增`context save-identity`，网络main/callGateway和嵌入runWorkctx共用既有context-history适配，并调用SDK getContextPackSaveContext。最多一个4 KiB内联JSON或稳定普通文件，省略输入为{}；网络可用有界`--json -`，嵌入拒绝stdin。输入只接受可选成对expected_actor_id/expected_client_id，两者只转为原身份相等头，不允许外部提供新的项目、权限或会话期限。未知/重复选项、--key、--output、写字段和不成对约束拒绝。可选--timeout-ms为1..2147483647整数，默认30000；文件/stdin采集及stdout发送在SDK期限外。

网络客户端固定原Gateway配置、token、三范围、trace与可选身份，发送一次GET /v1/context-pack/save-context，无正文、查询或写条件；完整成功16 KiB，Fetch错误16 KiB。SDK核对完整共享封套、原范围/可选账号客户端、trace及到期；通用transport只返回JSON，SDK不声称独立读取HTTP头或状态。返回的是当前身份，不是完整保存原请求，也未包含原Gateway、预算、TTL和请求键。不要把重新读取的身份自动覆盖已有绑定；本入口不修改现有compile行为。

嵌入入口捕获原可信上下文、清除继承写条件，要求认证客户端与实际未过期context.read；外部成对身份必须与捕获值相等。只接受SDK规定的确切GET路径、六个原身份/范围/trace头、无正文、bounded-json及16 KiB限额。沿context.pack.save-context授权审计，在handler执行前复查取消和到期；返回后完整核对五身份、可信会话期限相等且未过期、restricted提示与原能力相等。与原九类上下文读取共用每router两路容量，SDK停止等待后底层router实际结束才释放名额。成功stdout为完整原封套；输入错误退出2，读取/身份/响应错误退出1，无半份输出或文件写入。

MCP新增`get_context_pack_save_context`，省略arguments等同{}；严格4 KiB空对象，拒绝外部身份、写字段及任何其他参数。发现、prepare、客户端要求与执行沿isContextReadTool统一门禁：schema_version=1、可信认证客户端、实际未过期context.read和完整身份，admin角色不能代替能力。prepareMcpTool要求专用执行器，不退回通用工具调用。单次内部GET使用捕获原身份头及空输入，经既有ApiGateway策略/审计和身份handler；不读取项目记录、包或来源。

MCP成功必须200 application/json、原x-trace-id、无ETag；完整16 KiB封套核对原五身份、会话期限相等且未过期、restricted提示与原能力相等。错误最多16 KiB，拒绝未知字段、错误trace及未知或不匹配code/status：INVALID_INPUT/400、UNAUTHENTICATED/401、DENIED/403、NOT_FOUND/404、RATE_LIMITED/429、CONTEXT_PACK_SAVE_CONTEXT_INVALID/500及认证/审计不可用503，转固定文本，不透传上游details。输出为原完整封套的JSON文本，二次转义包装32 KiB+4096。

十类MCP上下文工具共用每Gateway两路容量；本工具整次读取/校验/包装共用30秒单调时钟期限，使用MCP_CONTEXT_PACK_SAVE_CONTEXT_BUSY/TIMEOUT。超时不取消内部ApiGateway，容量保留至底层真实结束，迟到结果不返回；原handler在策略审计之后再核对期限。进入执行器前的认证/外层审计及HTTP发送不计入期限。CLI/MCP均不自动重试、保存、换键或保留文件，读取身份不能证明保存成功/历史键归属/项目记录可读，也不能保证未来授权。

以下只是未执行的调用示例：

```text
workctx context save-identity --timeout-ms 10000
workctx context save-identity --json-file original-identity.json
```

第二条的文件必须只包含成对`expected_actor_id`和`expected_client_id`，取自原请求，不接受完整网页原请求文件；Gateway与项目仍由原CLI环境配置提供。MCP tools/call示例为`{"name":"get_context_pack_save_context","arguments":{}}`，不调用compile工具。

R-003未完成，evidence为空。真实网络/嵌入/MCP调用、权限发现、参数/身份不符、损坏/过期响应、超时/容量与旧工具兼容证据待补；CLI完整原请求文件流程由下节补充，MCP完整恢复、历史回执及独立Schema/OpenAPI仍待开发。本节身份入口增量仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/MCP/SDK/API/产品/数据库或发布；当轮无共享契约、SDK、REST保存器、Web、Mock、独立schema、依赖或迁移变化。

## CLI完整保存原请求（2026-11-05源码增量）

共享`context-pack-save-original.ts`接收原Web的PACK_ORIGINAL_BYTES、PackSaveBinding/PackSaveOriginal及规范Gateway/身份/原请求解析、编码、相等检查。根导出供Web与CLI使用，Web save-model保留同名重导出和原浏览器槽键计算。既有schema_version=1/kind=context-pack-save、Gateway含路径/五身份/restricted/显式预算TTL/原键的8 KiB封闭格式和规范字段顺序保持，无浏览器数据迁移；原文件不包含token/cookie、会话期限或成功回执，也不是签名/保存证据。

CLI网络main新增以下三条命令。下面只是未执行的用法示例，ORIGINAL_KEY由调用者为这份新请求明确选择，重试保留同一文件及键：

```text
workctx context prepare-save --key ORIGINAL_KEY --output NEW_ORIGINAL.json --json-file DRAFT.json
workctx context inspect-save --json-file NEW_ORIGINAL.json
workctx context submit-save --json-file NEW_ORIGINAL.json --reviewed --timeout-ms 30000
```

prepare-save要求--key和新--output，最多一个可选--json-file草稿（4 KiB），只接受budget_tokens/ttl_seconds，省略草稿为{}并使用4096/3600默认值，最终原文两参数均显式。禁止草稿身份/键/未知字段，原键精确保留、不trim或生成；同键不同参数的最终拒绝仍由服务器决定。先核对输出目录/新目标和稳定普通草稿，再读取一次可信save-context，捕获当前完整身份、权限桶、规范配置Gateway和原参数键。准备从不POST保存包。

原文复用既有文件输出工具：在已存在目录内独占建立临时普通文件（模式0600），写入、sync、同句柄读回SHA-256、关闭后以独占硬链接发布新目标；目标已有文件或链接均不覆盖，文件系统不支持硬链接时明确失败。发布后再完整稳定读取最终路径，核对精确字节及规范原文；失败保留已发布目标和可用恢复路径，不删除用户目标。仅清理工具自身仍拥有的临时文件；清理失败返回cleanup_pending/temporary_path。输出路径预检和本地发布不与网络超时竞速，发布开始后等待真实结果，避免先报超时后迟到写文件。该流程不承诺目录项fsync或设备掉电后的持久性。

准备成功输出完整原请求、original_file、规范request_sha256、identity_observed_expires_at、saved-and-read-back及not-sent/not-checked。观察到的期限只在准备结果中，原文件不冻结旧会话到期时间；后续同身份续期允许重新提交。准备完成不证明项目记录可读、未来保存获准或同键历史不存在。占用目标/本地失败不会自动选择新文件或请求键。

inspect-save只接受一个--json-file（8 KiB），不要求网络凭据或环境项目；main在读取环境变量前分发，嵌入runWorkctx也支持这一离线命令。稳定普通文件经严格UTF-8和完整共享模型解析，输出规范完整original、原路径、规范request_sha256及原字节file_sha256，明确structure-checked/not-checked/not-sent。格式空白/字段顺序不同可产生不同file_sha256和相同request_sha256；摘要不是签名、远端回执或原文件历史证明。

submit-save必须提供完整--json-file及--reviewed，只可另给timeout-ms；不接受新键、预算、TTL、账号、输出路径、内联JSON或stdin。第一次稳定读取原文件后，比较配置WORKCTX_URL规范基址（含路径）及三范围与原binding；不匹配时不发身份GET或保存POST，也不采用文件URL作为独立网络目标。认证token从本次配置捕获一次，身份GET和保存POST使用同一token，GET携带原actor/client相等条件。完整16 KiB可信身份核对原五身份、未过期会话及restricted桶，任何变化均停止，不自动更新绑定。

身份通过后再次稳定读取相同文件路径，核对全部原字节和规范原文，变化、缺失或读取失败停止本次保存；仅通过后允许一次原参数/原键POST。读取采用文件大小/mtime/ctime前后检查及完整内容，没有跨进程文件锁；最后读取后的外部文件变化不能改变已捕获的发送副本，也不构成永久文件保留保证。文件不是认证资料，用户必须自行保留原文，不从重新登录或损坏文件猜造缺失身份。

新流程复用FetchWcpTransport和SDK完整读取/提交器，通过受限fetch适配保留规范Gateway的路径前缀：SDK的根/v1路径只可为save-context GET和compile POST，适配再追加到捕获的配置基址；输入URL必须仍为配置origin，无query/hash，重定向沿error。没有修改通用SDK的URL行为，旧compile不获得新文件保证；此适配不会把token发往原文件指定的另一基址。

默认30秒或显式1..2147483647毫秒覆盖身份GET、第二次文件读取、最多一次POST、完整2 MiB封套/预算最大TTL/HTTP ETag/SHA-256及restricted内容检查。第一次原文件/草稿采集和新文件发布、stdout输出在网络期限外；准备网络预算只覆盖身份读取。每阶段核对单调时钟、AbortController及所读会话期限，第二次文件读取即使迟到也必须再次检查才允许发送。响应除早期401外核对状态200或4xx/5xx与原trace，身份及错误响应无ETag；SDK有界UTF-8/JSON读取和固定错误继续生效，成功保存HTTP ETag必须与已核验JSON一致。原restricted=false时拒绝回执中的入选restricted内容。

本适配器只在即将调用真实POST fetch时标记started；身份GET和本地失败不会标记保存派发。此后任何失败包括HTTP错误、过期、超时、摘要/ETag不符均unknown，不能借SDK或上游details改称未保存。输出固定错误说明及自有compile_dispatch_state/server_outcome/recovery，不透传远端details；未发送本次POST也不能否定过去同键保存。超时停止本地等待并取消可用响应体，不保证服务器撤销提交；无自动重试、换键、读回、删除原文件或自动写成功回执。成功stdout保持完整原SDK保存封套，不伪造键归属证明。

这三条命令不读stdin，拒绝重复/未知/无关选项；CLI用法错误退出2，原文件不可用/网络/身份/保存失败退出1。准备/提交由具有明确Gateway配置和token的网络main执行；嵌入runWorkctx不从裸router推断远端Gateway，只开放离线审阅，callGateway通用对象接口尚未增加文件工作流。Web导出原文件可由CLI审阅/提交；CLI新文件可在Web原恢复页导入，但仍必须匹配当前原Gateway、完整身份和权限桶。旧无绑定表单不迁造，原context compile及MCP保存工具保持兼容行为。

R-003未完成、evidence为空。跨Web/CLI规范字节与导入恢复、真实权限续期/路径前缀、文件并发/硬链接/故障/读回、取消与迟到工作、完整回执/ETag/restricted及旧调用兼容仍缺运行证据。MCP和嵌入完整原请求流程、历史回执持久化、恢复目录/备份清理和独立Schema/OpenAPI仍待补；只读查询见下方后续增量。此原文件任务仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/SDK/网页/API/产品/数据库或发布；无SDK、后端保存器、MCP、Mock、独立schema、依赖、数据库、样式或迁移变化。

## 原保存请求回执查询（2026-11-05源码增量）

新增只读`POST /v1/context-pack/save-receipt`，对应`context.pack.save-receipt`。查询完整原请求对应的既有保存记录，不调用compile、不预留请求键、不更新保存数据。使用POST承载有界原请求，不能因此把它作为保存重试；权限策略和查询审计仍沿Gateway流程。

contracts根导出`ContextPackSaveReceiptQuery`、`ContextPackRecordedSave`、`ContextPackSaveReceiptEnvelope`、查询/响应解析器与`contextPackSaveReceiptQuery(original)`。请求最多4096 UTF-8字节，只允许以下四字段；五项身份完整，预算/TTL都必须显式给出，沿既有范围，不接受默认补全或写条件：

```ts
{
  identity: { tenant_id, workspace_id, project_id, actor_id, client_id },
  read_restricted: boolean,
  request_key: string,
  parameters: { budget_tokens: number, ttl_seconds: number }
}
```

提取helper接受共享完整8 KiB Web/CLI原请求，省略Gateway位置后得到上述查询；调用方必须自行固定并核对原网关。服务端只核对当前可信身份，不信任正文提供身份。认证客户端、未过期实际context.read、全部五项身份及restricted桶精确相等后，才在只读repeatable-read事务内检查原父项目存在、未删除且分类可见。管理员角色不能代替实际能力声明。

公开HTTP先认证及能力检查，再读4 KiB正文。限定JSON POST，无URL查询/hash；原始头总计16 KiB，拒绝大小写重复头、幂等/版本写条件、条件缓存/Range、Content-Encoding及Transfer-Encoding；Content-Length如有必须为1..4096，Content-Type允许JSON及可选UTF-8。trace和身份头只作为可信context的相等约束。内部ApiGateway也检查头部，handler拒绝context中的写条件。认证、策略/审计和公开正文读取不计入handler的30秒期限。

按既有`commandReceipt`由原actor/client/键计算存储request_key，并由显式预算/TTL和restricted计算原保存指纹；不添加表或迁移，不改变保存事务。只查询原tenant/workspace/project下至多两条标量元数据及`pack_document IS NOT NULL`，不读取完整pack_document或source_manifest，也不取得保存流锁。无行返回not-observed；多行、缺失正文标记、无效指纹或元数据拒绝，合法指纹不符返回IDEMPOTENCY_KEY_REUSED。旧调用若曾带额外expected_version参与指纹，本入口不能据新原文件重建它，不猜测替换历史参数。

成功为200，JSON、private/no-store、原x-trace-id、无HTTP ETag；闭合响应最多16384 UTF-8字节。外层固定schema_version=1/trace_id/source_refs/data，data.original完整回显规范查询并逐项匹配：

- `data.status = "not-observed"`：无receipt，source_refs为空。仅表示本次只读快照未观察到匹配键；并发保存可能随后提交，不能证明失败、允许换键或自动重发。
- `data.status = "recorded"`：receipt仅有pack_id/version/created_at/expires_at/budget_tokens/used_tokens/pack_hash/server_cursor/content_state/source_state，source_refs只引用该包及版本。版本与游标为正安全整数，预算等于原预算、用量不超预算、有效期为正且不超原TTL，时间及sha256摘要格式均严格检查；content_state与source_state固定为not-checked。

recorded可描述已经过期、来源后来变化或不再是最新版本的包，不因当前时间超过expires_at拒绝历史记录；真正读取内容时仍需原完整读取流程重新授权、检查来源及计算摘要。本接口只返回存储摘要，不计算正文哈希，不证明内容现时可读或历史来源真实。原文件及此普通JSON都不是服务端签名证明。

handler每router独立最多两路读取，30秒本地等待；超时或取消等待不等于数据库工作终止，直到实际事务完成/失败才释放名额。容量不足RATE_LIMITED为429；原项目不可见CONTEXT_PACK_NOT_FOUND为404；身份/权限不符DENIED为403；输入INVALID_INPUT为400；不同原指纹IDEMPOTENCY_KEY_REUSED为409；损坏元数据CONTEXT_PACK_RECEIPT_INVALID为500；存储不可用CONTEXT_PACK_STORAGE_UNAVAILABLE或读取超时CONTEXT_PACK_RECEIPT_TIMEOUT为503。handler错误使用固定消息且retryable=false，不透出原键、数据库错误或部分记录。

SDK新增`getContextPackSaveReceipt(query, {timeout_ms?, signal?})`，默认30000毫秒，捕获原范围及可选actor/client约束，单次有界POST并完整核验返回查询与封套；主动传原actor/client相等头，不继承写条件，不自动重试。通用transport不暴露HTTP头/状态，SDK不声称独立核对这些字段；Fetch的既有有界JSON、UTF-8、状态及trace控制继续适用。网关基址由调用方核对，不接受响应中的新地址。

网络CLI新增`context save-receipt --json-file ORIGINAL.json [--timeout-ms 30000]`。完整稳定读取原文件一次（8 KiB），先比较配置Gateway规范基址含路径和三项项目范围，再调用SDK；使用配置token，文件不能指定另一目标。受限fetch只放行一次save-receipt POST，不允许身份GET或compile POST，响应要求原trace/合法状态/无ETag（早期401沿已有处理）。不接受内联JSON/stdin、key/output/reviewed或重复未知选项，不写文件。文件读取在网络预算前，stdout交付在网络预算外；成功输出完整封套。错误沿固定消息与not-sent/not-checked保存派发标记，它只说明本次没有发保存，不否认更早同键保存。失败后仍保留原文件，不根据结果自动发送。

R-003仍未完成、evidence为空。此接口增量接Gateway/SDK/网络CLI，Web后续接入见下节；MCP、Mock、嵌入runWorkctx、独立Schema/OpenAPI及历史回执文件/浏览器持久化尚未适配。真实认证/策略审计、原指纹兼容、并发保存快照、过期/损坏记录、响应限额/取消/容量保留及跨Web/CLI文件兼容待运行证据。本轮只源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行CLI/SDK/API/Mock/产品/数据库或发布，无依赖或迁移变化。

## 网页原保存回执查询（2026-11-05源码增量）

准备后的固定请求与`/context/packs/recover`载入的原请求共用面板新增“Query original save record”。必须显式点击，载入/导入/选择目录项不查询、不发送保存；查询不要求发送确认，也不先写入浏览器副本，因此完整文件已载入而浏览器存储不可用时仍可查询。查询期间与当前面板的保存/导出/另起请求互斥，开始查询撤销旧发送确认。

新`queryPackSaveReceipt` action只接受一份original文本，拒绝其他/重复字段和非文本，沿完整8 KiB模型解析，再返回规范原文和完整历史封套。错误只返回固定消息及本次trace，保留原文；不调用compile、原文存储或revalidatePath，不将读取结果伪装成完整保存响应。

独立`readWorkbenchContextPackSaveReceipt`捕获完整原请求及当前session，session必须有有效token和未过期整数期限；配置Gateway规范基址含路径、当前三项范围必须与原请求相等，正文不能提供替代网络目的地。仅向配置Gateway发送一次save-receipt POST，原五项身份/restricted/原键/显式参数构成共享4 KiB查询，账号/客户端额外作为相等头；真实身份和restricted能力由Gateway再次核对，不从本地解码声明推断授权。不调用save-context GET或保存POST，无自动重试。

server reader每模块实例最多两路在途查询，30秒单调期限覆盖session获取、HTTP等待、正文及完整解析，逐阶段复查session到期；超时abort并停止本地等待，名额到实际底层工作结束才释放，迟到session不会再派发。它不保证跨实例全局限流，也不能保证底层网关工作被取消。客户端另有30秒本地等待及“Stop waiting”；停止/离开后忽略迟到结果，服务端自己的期限继续生效，不把停止等待解释为保存取消。

成功HTTP必须200、JSON、原trace且无ETag，成功/错误均限制16 KiB解码UTF-8正文；错误必须匹配白名单与状态码，早期401沿认证失败处理，不透传上游details或正文。完整共享封套解析核对原查询、预算/最大寿命、元数据/来源引用和not-checked标记。浏览器再核对action回显的完整原文及原查询，才展示结果；摘要只是存储元数据，不在此读取正文重算。

recorded独立显示历史包编号/版本、保存和到期时间、预算/用量、完整原响应和固定包读取链接，明确内容及来源未检查、可能已经过期或不可用。它关闭当前原请求的发送入口；准备页仍可明确保留原文后另起一个请求，查询不会自动换键或另存包。若与同页已核验保存编号/版本或既有历史元数据冲突，拒绝新观察并保留旧结果。

not-observed只显示本次快照未观察到，完整响应可展开；保留既有已确认保存和历史记录，不将其降级为未保存，也不赋予自动重发资格。查询错误、取消、超时及恢复身份提示同样不清空旧结果或原文，保留的空观察标注为历史查询，不伪装成本次失败结果。新有效recorded可更新本页查询trace，保存正文仍需另行打开读取。查询结果默认只保存在当前页面内存，刷新/返回原目录会丢失未留存观察；后续显式历史文件导出/持久化见[网页历史回执留存与找回](#网页历史回执留存与找回2026-11-05源码增量)，原请求副本格式仍独立。

R-003未完成、evidence为空。真实session/原Gateway路径/身份权限变化、HTTP状态/头/错误限额、过期和损坏历史、查询取消/迟到/容量保留、原文相等和既有确认结果不降级、跨页丢失提示等均缺运行证据。本轮仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/接口/数据库或发布；不改协议、后端、SDK、CLI、MCP、Mock、存储格式或依赖。

## MCP原保存回执查询（2026-11-05源码增量）

新增`get_context_pack_save_receipt`，接入既有`executeContextReadTool`，不通过通用工具转发。输入为上文共享4 KiB闭合查询：identity完整五字段、read_restricted布尔、request_key原键、parameters内显式budget_tokens/ttl_seconds；均必填，无默认补全。不接受Gateway URL、完整原文件外层、idempotency_key/expected_version等写条件，调用方从所保留原请求准确提取字段。contracts的`contextPackSaveReceiptQuery(original)`可辅助提取，MCP工具本身不读取本地文件。

工具目录提供严格嵌套object schema、四项ULID/客户端标识和预算128–32768、期限60–86400秒；真实解析仍复用共享普通JSON/字节/标识检查，不能只凭schema通过。发现/prepare/执行要求认证客户端、schema_version=1、可信完整身份/trace、未过期token和实际context.read，管理员角色不能代替实际能力。原identity逐字段与可信会话相等，restricted桶与当前实际data.restricted.read精确一致；正文身份只是约束，不替代会话授权。Gateway继续检查父项目当前可见及存储指纹。

原目标由调用方保持：MCP执行内部已配置的Gateway，没有外部Gateway URL可供等价比较；不要把另一个MCP端点的相同身份/请求键当作原保存位置证明。工具不自动读取当前save-context来改绑原请求，不补造缺失字段或为查询生成新键。

捕获独立context/query后清除继承idempotency_key/expected_version/if_match，原输入中的写字段直接拒绝。单次内部POST /v1/context-pack/save-receipt，传入原范围/actor/client相等头和JSON类型；派发正文再解析复制，避免内部处理修改嵌套字段影响保留的比对原查询。仅原历史查询，无compile POST、内容/来源读、保存或自动重试。

响应要求200或有效错误状态、JSON类型、原x-trace-id和无ETag；完整业务JSON及错误各16 KiB，错误字段闭合且码与内部ApiGateway状态表相符。内部WORKBENCH_AUTH_UNAVAILABLE沿现有ApiGateway的400映射，不混用公开HTTP认证的503；其他如请求键冲突409、损坏回执500、存储/handler超时503沿原语义。错误固定信息、retryable=false，不传出上游details/部分记录。成功经共享原查询及完整封套核验，保留完整source_refs和data，不裁剪元数据。

输出沿MCP `content: [{type: "text", text: 完整WCP封套JSON}]`，转义后的content包装限32 KiB+4096，外层JSON-RPC元数据由原协议添加。recorded仅证明匹配历史保存元数据，content_state/source_state固定not-checked，过期/后来来源变化仍可能返回记录；需要内容时另行读取固定pack_id。not-observed只是查询快照未观察到记录，不能证明没有保存，也不能作为自动重发或换键许可。输出失败不能否定先前保存，调用方保留完整原请求。

十一类上下文读共享每ApiGateway两路容量；本工具使用MCP_CONTEXT_PACK_SAVE_RECEIPT_BUSY/TIMEOUT，30秒从执行器开始覆盖内部授权审计等待、读取和完整输出核验，逐阶段复查有效身份。内部api.handle不可被此计时器取消，超时停止本地等待但名额保留至底层实际结束；公开HTTP认证/外层审计与网络交付不在执行器期限内。prepareMcpTool返回MCP_TOOL_EXECUTOR_REQUIRED，调用者须使用dispatchMcp或专用执行器，不能绕过限额/输出核验。readOnlyHint为true，未注册新写操作或REST路径。

R-003仍未完成、evidence为空。工具发现/认证客户端/直接prepare门禁、严格原身份与restricted绑定、HTTP与完整封套/错误边界、共享容量/迟到授权、旧十类读取兼容和客户端展示均待运行证据。Mock/嵌入CLI、MCP完整原文件与持久恢复流程、历史回执备份/清理及独立Schema/OpenAPI仍有缺口。本轮仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行MCP/API/产品/数据库或发布；无SDK/CLI/Web/Mock/共享协议/依赖/迁移变化。

## 保存回执文件与离线查看（2026-11-05源码增量）

新增共享`ContextPackSaveReceiptDocument/File`及结构解析/规范JSON helper，从contracts根导出。文件只允许document/document_sha256两字段，最多32 KiB；document最多28 KiB，闭合五字段：schema_version=1、kind=context-pack-save-observation、observed_at、original和receipt。original沿完整8 KiB Web/CLI原请求格式，保留Gateway、五身份、restricted、原键和显式参数；receipt沿完整16 KiB只读查询封套，必须精确匹配original提取的原查询，包含recorded或not-observed及原trace/source_refs。

observed_at为本地接收并准备留存时的UTC时间，严格有效四位年份ISO毫秒格式；不是服务端保存时间或签名，不与服务端created_at强行排序，也不因导入时已过期而失效。document_sha256为规范document UTF-8的64位小写SHA-256，不是整个文件字节摘要。共享解析只检查摘要形状及完整结构/原请求绑定，适配器必须计算规范document摘要并比较；实际文件摘要另行返回，空白/字段顺序可改变实际文件摘要但不改变规范document摘要。

网络CLI `context save-receipt --json-file ORIGINAL.json [--timeout-ms 30000] [--output NEW_RECEIPT.json]`新增可选output。读取完整原文件、预检新输出路径后才查询；已存在文件/链接、原请求文件本身或不可用目录均拒绝，不进行查询。保留既有原Gateway含路径/范围与token约束和单次只读POST，不自动补身份、读正文或发送保存。无output时成功返回原完整查询封套，兼容旧行为。

指定output时，网络期限只覆盖原查询；成功之后构造历史document及摘要，调用既有新文件工具独占创建临时文件、写入/同步/摘要读回、硬链接发布，再重新稳定读取目标文件，核对完整结构、document摘要、全部实际字节和文件摘要。不存在覆盖回退，不删除原请求或已有目标；临时文件清理未完成保留路径。文件发布开始后等待其实际结束，不用网络计时器与文件写入竞速；进程退出/中断或外部后续改写不构成保证。

指定output的成功或本地失败均使用独立外层封套，`data.status=receipt-observed`，包含完整original、receipt、已构造时的receipt_file及local。文件本身只含receipt_file，不含stdout外层或本地路径。local.state=saved-and-read-back时返回目标路径、实际文件摘要/字节数和cleanup_pending，退出0；本地捕获/发布/读回失败为save-failed，返回阶段、候选摘要/恢复路径并退出1，stdout仍保留完整原请求和远端观察，已构造文件也完整保留。若查询失败或超时，不启动文件保存；失败不重查、不重发，也不改变recorded/not-observed含义。stdout交付本身不能保证，需保留输出或已经创建的文件。

新增`context inspect-receipt --receipt-file RECEIPT.json [--json-file ORIGINAL.json]`，main在登录/项目环境检查前处理，嵌入runWorkctx也有独立离线分支，仅使用调用trace，不授权或调用router。拒绝输出、网络超时、键、确认、stdin/内联JSON、重复或未知选项。稳定普通文件读取上限32 KiB、严格UTF-8、完整结构及规范document摘要核验；可选原文件上限8 KiB，规范完整原文必须相等，包括Gateway/全部身份/权限桶/键/参数，不仅比较pack_id或请求键。

离线成功输出完整receipt_file及实际文件摘要/大小、可选原文件摘要，标注observation_state=historical、server_authenticity/current_server_outcome/content_state/source_state均not-checked；file_state=structure-and-digest-checked只代表文件自洽。外层source_refs为空，原历史引用保留在文件内部，避免冒充本次新读。用法错误退出2，文件不可用/摘要异常/原文不匹配退出1，不输出部分通过结果；不根据历史not-observed重发，不联网刷新或改写时间。

普通JSON和自带摘要可被一起改写，不认证网关或远端来源；历史文件中原Gateway也只是保留声明，离线核对不能证明实际请求曾发到该目标。此格式是查询观察文件，不是原请求文件或完整ContextPack正文，不能直接传submit-save。当前无失败stdout外层直接导入/离线补存命令，已有候选可从data.receipt_file保留为独立文件再检查；浏览器历史目录/持久化及CLI原请求提取见后续源码增量，自动恢复、批量备份清理另行开发。

R-003未完成、evidence为空。文件格式/规范摘要/历史绑定、非UTF-8与损坏边界、输出路径竞争/硬链接/清理、发布后完整读回、本地失败保留观察、离线main/嵌入入口及已有查询返回形状兼容均缺运行证据。本轮只源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/SDK/API/文件工作流/数据库或发布；无后端、SDK、Web、MCP、Mock、依赖或迁移变化。

## CLI从历史回执提取原请求（2026-11-05源码增量）

新增`workctx context extract-original --receipt-file RECEIPT.json --output NEW_ORIGINAL.json [--json-file ORIGINAL.json]`。普通main和嵌入runWorkctx均在凭据读取/网络或router派发前处理，参数只有上述三个文件选项，拒绝重复、未知选项、stdin、内联JSON及额外位置参数。inspect-receipt原返回格式保持，仍拒绝output。该命令只接受共享回执文件，不接受save-receipt的stdout外层封套或裸查询结果。

先稳定读取32 KiB以内完整UTF-8文件，复用共享闭合结构、原请求/回执精确绑定以及规范document SHA-256实算；可选json-file再稳定读取8 KiB独立原请求，比较全部规范字段，保留独立文件实际摘要。未通过此阶段不写文件，也不交付部分通过的候选。recorded/not-observed及过期历史均只保留原义，不改observed_at/trace，也不将本地摘要视为服务器认证。

候选原文件使用既有8 KiB规范格式，完整保留Gateway含路径、五身份、read_restricted、request_key和显式budget_tokens/ttl_seconds。先预检调用方指定的新路径；已有文件/链接或输入文件本身拒绝，不覆盖。发布前再次稳定读取完整回执并比较全部实际字节，内容、空白或字段顺序变化都停止。此复读检查只约束捕获期间的输入，不能阻止之后外部改写文件；可选独立原文件的匹配仅代表它被读取时的内容，不提供文件锁。

本地写入沿现有独占临时文件、同步、摘要读回和硬链接发布；目标目录必须存在且支持硬链接，无覆盖回退。发布后稳定读取8 KiB目标，核对全部实际字节、SHA-256及完整原请求解析和规范相等，全部成功才报告local.state=saved-and-read-back。文件工作等待实际结束，不与网络/本地超时竞速，不承诺进程中断或外部文件变更后的持久性。

输出使用本地封套和空source_refs；data.status=original-extracted只表示已从历史提取候选，包含完整receipt_file、来源路径/实际摘要/大小、original/request_sha256及可选matched_original。receipt_file_state=structure-and-digest-checked；observation_state=historical，服务器认证、当前结果、内容和来源均not-checked，compile_dispatch_state=not-sent。成功local给出路径、实际摘要/大小和临时清理状态，退出0，next_action=review-original-file。

已得到完整候选后，目标预检、源复读、发布或目标读回失败均保留完整data和候选摘要/大小，local.state=save-failed及phase，退出1；不重查、不重发、不自动选新路径。发布失败保留既有工具的恢复信息；已发布但无法确认时标记published-unconfirmed并保留目标及未清理临时路径。next_action改为keep-observation-and-review-local-state，避免把失败当作原文件已保存。输入损坏或独立绑定不匹配走原错误封套退出1，用法错误退出2。

保存出来的是原请求文件，可由`context inspect-save --json-file NEW_ORIGINAL.json`审阅，之后显式`context save-receipt`重新查询或`context submit-save --reviewed`沿既有当前身份复核提交；提取本身不授予重发许可，不调用这些操作或查当前身份。历史not-observed不能证明之前没有保存，recorded也不证明目前内容/来源可用。

R-003仍未完成、evidence为空。普通/嵌入离线派发、旧inspect兼容、完整绑定/摘要损坏、原文件变化、目标竞争/无覆盖、发布/清理/读回失败保留候选均待运行证据。失败stdout整体离线补存、批量备份/清理、嵌入在线查询等仍待开发。本轮仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/文件流程/产品/API/数据库或发布；无共享格式、SDK、Gateway、Web、MCP、Mock、依赖或迁移变化。

## 网页历史回执留存与找回（2026-11-05源码增量）

准备/恢复共用面板在完整查询核验成功后立即构造共享历史document，observed_at固定为本次浏览器观察时间，保留原请求及完整receipt。当前recorded与最近not-observed仍独立显示；保存、导出或重载已有历史均不改时间/trace/原键，也不重新查询。当前保存成功响应仍与查询观察区分，本项不从原提交的浅显示信息补造历史查询或自动保存全部提交正文。

新增共享历史entry面板，显式“Save this observation in browser”“Export historical receipt”“Export its original request”。前两项按共享规范document计算WebCrypto SHA-256，形成与CLI相同的32 KiB文件；原请求导出保留原8 KiB格式，可从历史中恢复完整Gateway/身份/权限/参数/键，不需浏览器存储或摘要功能可用，也不会直接提交。完整历史document可展开审阅。点击下载只确认已请求下载，不宣称用户磁盘文件已经写入。

新独立IndexedDB `planemem-context-pack-save-history`存observations和directory双槽，不改原请求数据库。键由完整规范Gateway/tenant/workspace/project/actor/client/read_restricted绑定与document_sha256构成，最多16 KiB；正文为规范完整共享文件，目录为该document摘要。保存前核对完整原文/回执关系并实算摘要，再在同事务中检查双槽：缺失才一起添加并完整读回，同文同摘要保留，异文、错误摘要、部分槽或非规范存储拒绝。确认只在事务完成后返回；超时/取消时结果可能未知，页面保留完整document，可再次显式保存同文，不清除历史。

不同观察时间、trace或结果产生独立摘要槽，新的not-observed不会覆盖旧recorded，也不会将所有历史合并为一个当前保存结论。普通文件可能自洽但并非可信服务器来源，导入的互相矛盾观察可以作为不同历史副本并存，不能覆盖准备页当前真实查询得到的确认状态。

新增`/context/packs/receipts`，页面沿已有可信save-context读取确定当前完整原绑定；仅此身份发现需要网络，不查询历史保存结果或发送保存。绑定失败提示恢复原账号/客户端/项目/网关/权限后重载；CLI离线检查入口仍可在无网页登录时检查独立文件。恢复原请求页及准备/恢复面板提供历史导航。

用户显式读取目录，按完整绑定和摘要键升序每页最多20份，包含完整32 KiB以内文件；在同一只读事务取得正文/目录双槽和下一页位置，事务后逐份重算document摘要，全部通过才显示页。额外一键仅判断是否有下一页，不把元数据当正文。不存在数据库时只读打开中止创建并返回空页，不初始化历史库。分页按摘要顺序，不是时间排序，也不是跨页一致快照；新增历史可能落在已有游标之前，需要明确重读首页。目录不宣称发现缺失目录键的孤立正文或完成全库审计。

文件导入先检查32 KiB大小、完整ArrayBuffer/严格UTF-8、共享闭合结构、完整原绑定和规范document摘要，再只载入审阅；不会自动保存、查询Gateway、恢复发送确认或更改原请求库。明确保存后才进入相同的缺失添加流程。浏览器导出的文件可由CLI inspect-receipt读取，CLI --output文件可在网页同原绑定下导入；历史的created_at/expires_at允许已过期，内容及来源仍not-checked，普通JSON与摘要不认证服务器。

历史面板与父页查询/发送/目录/导入共享本页互斥，开始历史操作撤销旧发送确认；每项本地异步流程30秒，底层存储另沿既有10秒打开/事务限制。停止等待/离开会取消可取消工作并丢弃迟到状态，完整已选观察不因其他文件失败而清空。不同标签页的缺失添加由数据库事务协调，无跨页自动刷新；本项无删除、批量清理或覆盖。打开历史包链接明确使用当前会话另行读取，历史记录不绕过现时授权。

R-003未完成、evidence为空。跨Web/CLI文件规范一致性、原绑定/摘要损坏、双槽并发/故障/取消、20份完整分页与新条目重读、文件导入不写入、原请求导出及旧查询确认不被历史覆盖均缺运行证据。自动留存、历史筛选/时间排序、逐份删除、完整备份恢复/清理、跨范围审计及浏览器配额处理仍待开发。本轮仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/文件/接口/数据库或发布；无共享协议、CLI、SDK、Gateway、MCP、Mock、依赖或数据库迁移变化。
