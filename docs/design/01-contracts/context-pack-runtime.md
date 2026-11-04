# 持久化 ContextPack 开发说明

更新：2026-11-02。本文记录代码实现；未执行编译、类型检查、测试、数据库迁移、部署或发布。

2026-11-04新增[独立完整读取Schema](../../../packages/contracts/schemas/README.md#保存-contextpack-完整读取)：`@planemem/contracts/schemas/context-pack-read.json`提供查询、完整保存包、回执和格式专用封套定义。旧sections实体保持；原请求绑定、来源顺序、合计预算、渲染内容和真实SHA-256仍沿下文运行时检查，Schema结构不能替代。仅源码文档与格式文本检查，未执行校验器、生成器、编译、类型检查、测试或发布。

2026-11-04新增[保存包Mock](context-pack-mock-runtime.md)：独立固定完整包、权限桶及来源变化场景接入SDK getContextPack；支持最新/指定包与json/markdown/mcp，完整内容和SHA-256核验，2 MiB响应、两容量/30秒及取消。模拟来源状态不替代真实来源检查，未执行任何Mock或SDK。

## 入口与身份

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/v1/context-pack/compile` | 从当前项目的 ContextItem 生成并保存新包 |
| GET | `/v1/context-pack` | 读取最新可见包，或由 `pack_id` 指定历史包 |

两条路由均要求 Bearer token 和 `x-tenant-id`、`x-workspace-id`、`x-project-id`，范围必须与令牌一致。读取及编译使用 `context.read` 策略动作，编译还要求有效客户端身份和 `Idempotency-Key`。身份、能力、来源内容不能从请求正文覆盖。`data.restricted.read` 决定是否允许纳入或读取 restricted 数据，管理员角色不自动绕过这个内容过滤。

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

ContextItem 已补充公开创建、编辑、归档、恢复和人工确认，见 [ContextItem 开发说明](context-item-runtime.md)。持久包已接入 [本地来源链递归检查](context-source-runtime.md)：无效链以 source 理由排除，选中内容的寿命不超过任何有效本地后代的寿命；source_manifest 保存 dependency_hash，读取时再次核对，旧包缺少摘要时要求新键重新编译。此改动未新增迁移，也没有重写旧包。

检查点已增加持久包 ID 绑定和续接前校验，见 [检查点上下文绑定](checkpoint-context-runtime.md)。旧内嵌包仍只保留历史哈希/来源，续接明确标记未验证，不自动迁移。

外部来源自动摄取仍待接入；搜索 hit 索引不会自动变成 ContextItem。工作项投影读取仍走已有路径。模型专用 tokenizer、更大项目的候选分页、保留/清理策略、后台失效通知和运行验证仍待后续工作。
