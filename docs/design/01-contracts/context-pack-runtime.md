# 持久化 ContextPack 开发说明

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

`/context/packs/compare`比较同项目两个明确保存ID。上下文页面顶部提供入口，保存包卡片可预填已读到的具体ID；省略一侧只显示表单，不读取包，也不自动选择latest。两ID必须为不同ULID，不要求版本升序；相同ID、重复/未知参数、非法格式在发起读取之前失败。提供`from`、`to`、`show=all|changes`及可选`return_to`页面参数，业务查询对应`{from_pack_id,to_pack_id}`，最多4 KiB。

返回地址只允许应用内`/context`及其合法查询，重新使用原上下文浏览解析器核对筛选、归档视图、页大小、游标、条目/包及原搜索返回；拒绝片段、重复参数和外部地址。地址最多16 KiB字符，页面参数普通JSON最多24 KiB。返回原浏览位置不会重新选包或赋予权限；比较页不根据URL切换账号或项目。全部/只看变化、反向比较及失败重试保留两包原ID、显示选项和已核对的返回地址。切换显示方式会重新读取原两ID；无预取或自动重试。

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

参数只允许单个`pack`、`latest`、`return_to`。`pack`要求完整ULID，显式空串或非法编号直接失败；`latest`只能为字符串`1`，并与pack互斥。用户可输入编号，也可点击独立的“Read the latest visible pack”按钮。latest每次重新选择最新可见包，成功后提供实际保存ID的固定链接；不把latest当作失效编号或读失败后的回退。

`return_to`只能是本应用`/context`目录、`/context/packs`保存包目录或`/context/packs/compare`对比地址，逐字段使用已有导航解析器重新构建。单个返回地址最多64 KiB字符，完整导航输入JSON最多96 KiB；原context 16 KiB、compare 24 KiB等内部约束仍执行。拒绝未知/重复/数组参数、外部地址、片段和任意读页嵌套；对比页已验证的context或保存包目录返回可以保留一层，保存包目录本身没有return_to。目录筛选/游标/基础包、对比两个ID/显示方式/原目录返回在返回按钮中保留，链接不会自动重定向或授予权限。

读取使用原当前会话与项目边界，沿用完整json包2 MiB、错误16 KiB、HTTP状态/type/trace/ETag、保存范围/预算/来源/内容及Node SHA-256核对和30秒读取期限。页面只有完整读取成功后才显示版本、创建/到期、预算、摘要、原编号及完整入选条目正文/保存字段；排除原因和完整来源、完整响应封套也可展开。内容按文本显示，来源仅作为保存引用，不执行其中的HTML或指令，不访问外部来源。过期、来源变化、不可读和完整性异常均沿原错误失败。

失败保留原pack或latest选择以及return_to，用GET表单显式重试；不会自动刷新、换包、重试、重新编译或写入。latest重试可能选择不同包，界面有说明；固定ID重试始终使用原ID。成功可用具体包ID预填新的对比，也可返回原对比页继续原两侧选择。原编译和目录页面行为不变；页面渲染、交互及HTTP发送不在读取期限内，不承诺总页面容量或来源持续有效。

R-003未完成、`evidence: []`。独立读取与目录故障隔离、有效/非法URL、身份/过期/来源/摘要错误、完整正文空白/Unicode显示、返回/重试/最新固定链接和真实浏览器兼容仍缺运行证据。本轮只源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

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
