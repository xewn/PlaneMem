# OpenAPI 源码契约

这里的文档描述已有HTTP实现，尚未经过OpenAPI校验器、生成器、编译、类型检查、测试或运行验证。文档中的版本不表示已发布或部署；目前覆盖保存包生成/完整读取、保存身份/历史回执和保存包目录五个接口，尚不是完整WCP接口目录。

## 保存包生成与完整读取

2026-11-05，TODO **P0-01** / T0.3 / T4.1 / R-003：新增 `context-pack-operations.json`（OpenAPI 3.1.0），包子路径为 `@planemem/contracts/openapi/context-pack-operations.json`。描述已有 `POST /v1/context-pack/compile` 与 `GET /v1/context-pack`，不执行接口、不修改路由或现有处理逻辑。

| 接口 | 选择/输入 | 成功内容 |
| --- | --- | --- |
| POST `/v1/context-pack/compile` | 可省略 budget_tokens/ttl_seconds；原幂等键必须在头或正文提供 | 新保存或原请求重放均为 200；完整 JSON 保存封套，无 rendered |
| GET `/v1/context-pack` | 单值可选 pack_id/format；省略 ID 选最新可见版本 | 三种 format 都返回完整 JSON；markdown/mcp 另含 data.rendered |

本地加载 OpenAPI 及相邻 `schemas/context-pack-read.json`、`schemas/context-pack-save.json` 两份完整资源，保留相对目录和各自 `$id`。成功结构引用 read Schema；生成请求的预算/TTL复用 save Schema 标量。正文幂等键采用现有 HTTP handler 的较宽规则，没有把 SDK/原请求文件的更严格文本规则套给旧 HTTP。无须加载目录/比较 Schema，也不要联网请求 planemem.local。

### 原身份、幂等与完整读取

两接口均验证 Bearer、三个项目范围头，并经 `context.read` Policy action；实际许可取决于当前策略及经认证规范化的能力。生成另外要求可信非空 client claim；旧完整 GET 没有这一专用门槛，缺少 client claim 时仍沿 authenticatedContext 的已有 fallback，不能把目录/身份/回执入口的严格要求套到它。两个 expected-identity 头分别可选，仅与已验证身份精确比较。traceparent 非空时优先于 x-trace-id，旧入口不强制两者一致或解析 W3C 格式；两个都缺省才生成 trace。

生成请求默认预算 4096、TTL 3600 秒，范围分别为 128–32768 和 60–86400。正文仅接受 budget_tokens、ttl_seconds、idempotency_key；推荐原键放 Idempotency-Key 头，正文 `{}` 可使用默认参数。键在头或正文至少一处，双处必须同文；原 handler 检查 1–255 UTF-16 单元且无空白，SDK/历史原请求格式还有控制字符/代理项限制。跨头/正文的必填与相等关系由运行时处理，OpenAPI body Schema 无法单独表达。

保存按原 scope/actor/client/key 定位，指纹包含规范参数、restricted 权限桶和已有 expected_version；锁内写入完整包/来源清单、版本/游标及 ContextPackIssued。相同原请求重放仍检查当前项目、原包正文、有效期与来源。参数/可见性变更返回 409；过期 410、来源陈旧 409，不生成替代包。响应不回显原键、请求 TTL 或“新建/重放”标记。发送后失败或超时应保留完整原请求并查询已有 save-receipt，不能推断未保存或自动换键。

读取在只读 repeatable-read 事务内检查父项目和保存 restricted 可见性，按版本/ID降序选择。省略 ID 并不表示“找一个未过期包”：先选最新，再检查它；过期/陈旧就返回错误，不回退旧包。指定不可见/不存在或无可见最新包返回 404。完整检查包含原包摘要、保存元数据、候选和排除项的来源清单、依赖快照及当前来源状态；历史回执查询与元数据目录不做这类完整读取。

`format=json`（含省略）不带 rendered；markdown 和 mcp 都增加 `data.rendered={uri,mimeType,text}`，其中 mimeType 为 text/markdown。HTTP 仍是 application/json，包含完整 pack；format=mcp 不是 JSON-RPC 包装，也没有发起 MCP 调用。根成功 Schema 接受两种结构，格式专用锚点由扩展注解提供，消费方须结合原查询选用并继续核对完整正文/摘要。

成功 ETag 等于正文 etag，并对应 data.version/revision；server_cursor 是原保存事件游标，不是读取时最新高水位。外层 trace 属于当前调用，内层 pack.trace_id 保留创建时的值；两者不必相同，重放也不会重写原包。

### 现有服务端与客户端边界

本文件据实记录这两个旧入口，不能从目录/回执文档复制更强保证：

- POST 在认证前使用通用 JSON reader，实际正文最多 1 MiB，缺失/非对象/非法或超限统一 400 INVALID_JSON；没有专门强制 Content-Type、空查询、严格 UTF-8 或重复 JSON 键策略。调用者应发送 application/json、无 URL 查询的规范对象。
- GET 不解析请求正文，也没有目录入口的正文/条件头拒绝检查。应不带正文或写入、缓存、Range 条件；接受某些条件头语法不表示支持条件读取。通用 If-Match/If-Match-Version 会检查语法和相互一致性，但这两个 handler 不做 CAS，读取不会返回 304/206。生成时额外版本值还影响原请求指纹，应省略。
- 两 handler 没有专用两笔容量或 30 秒等待上限，也没有服务端统一 2 MiB 成功/16 KiB 错误限制。4 KiB 规范查询/参数、2 MiB 完整成功及 16 KiB 错误是共享客户端的检查；客户端期限不证明 SQL 已取消或写入已回滚。
- 授权时检查 token 有效性；这两个 handler 没有数据库工作后的专门到期复查。成功包的来源/有效期判断发生于处理器读取，不能保证其在送达后一直新鲜。
- 早期 JSON/认证/输入拒绝可能不带 x-trace-id；命令错误带该头，所有应用 JSON 响应均 private, no-store。未承诺 WWW-Authenticate、Retry-After 或 Connection: close。

这些差异作为尚待开发的边界记录，文档不会自动修复实现。所有 x-* 都是说明注解，不是运行时限制。结构 Schema 仍不能证明权限、原键归属、摘要、跨字段关系或完整字节预算。

| HTTP状态 | 原HTTP错误码及 retryable |
| --- | --- |
| 400 | INVALID_JSON、INVALID_INPUT、INVALID_REQUEST_CONTEXT；生成候选/来源图超限 CONTEXT_SOURCE_LIMIT 也为400，均false |
| 401 / 403 | UNAUTHENTICATED / DENIED，false |
| 404 | CONTEXT_PACK_NOT_FOUND，false |
| 409 | CONTEXT_PACK_STALE；生成还可能 IDEMPOTENCY_KEY_REUSED，false |
| 410 | CONTEXT_PACK_EXPIRED，false |
| 429 | 通用actor/path RATE_LIMITED，true；无专用容量错误 |
| 500 | CONTEXT_PACK_INVALID为false；意外边界INTERNAL_ERROR通常true |
| 503 | CONTEXT_PACK_STORAGE_UNAVAILABLE、WORKBENCH_AUTH_UNAVAILABLE、AUDIT_PERSISTENCE_UNAVAILABLE，true |

错误 details 保持开放，客户端可能重新映射 retryable；它不授权自动重发。存储 helper 将缺少数据库或非 ContractError 的内部异常归为存储不可用，不能把每个503都解释成数据库未提交。反向代理/HTTP解析层的错误不保证这份 JSON 结构。

源码依据：Gateway 的 server/http/authenticated-context/context-packs，共享 metadata/context-pack-read/context-pack-compile 及 SDK 对应适配器。只做人工源码审阅和格式/Git文本检查，未执行校验器、生成器、接口、数据库、编译、类型检查、测试或发布；P0-01/R-003 保持未完成、evidence 为空。

## 保存身份与历史回执

`context-pack-save.json`采用OpenAPI 3.1.0，包子路径为`@planemem/contracts/openapi/context-pack-save.json`，覆盖已有`GET /v1/context-pack/save-context`和`POST /v1/context-pack/save-receipt`。成功身份/历史封套及POST原查询引用相邻`../schemas/context-pack-save.json`完整资源的锚点；错误沿五字段ErrorEnvelope，保留开放details。它不描述保存包提交接口，也不改变路由或运行时校验。

本地加载两份完整文件，保留openapi与schemas相邻布局，并配置解析器基址及Schema $id映射；无需目录或完整包读取Schema，不向planemem.local下载。servers默认相对根路径，使用者须配置实际Gateway基址（含部署路径）。OpenAPI/2020-12、外部锚点与Reference Object的description覆盖兼容性尚未验证；所有x-*扩展只作说明，不是执行约束。

两个接口都要求Bearer、三范围头、认证客户端和未过期实际context.read。actor/client/能力来自已验证身份，HTTP expected_actor/client头可独立省略，提供时必须相等；POST正文仍须完整五字段身份与原restricted桶。traceparent的非空值优先，其次x-trace-id，两者都缺省时生成trace；本接口对每个已提供trace头都检查相等，所以两个头冲突或出现空值会被拒绝。该字段目前作不透明标识，并未执行W3C trace解析。

| 边界 | 身份GET | 历史回执POST |
| --- | --- | --- |
| 查询/片段 | 不接受 | 不接受 |
| 正文 | 不发送；Content-Length缺省或字面量0 | 完整原查询JSON，原键在正文，不是Idempotency-Key头 |
| 正文头 | 拒绝transfer/content-encoding | 必须application/json，可带唯一UTF-8 charset；Content-Length若存在须规范1–4096，无transfer/content-encoding |
| 重复及条件头 | 原始头名不区分大小写拒绝重复，禁止写入/缓存/Range条件 | 同左；重复头规则不意味着JSON.parse检测重复正文属性 |
| 读取内容 | 当前可信身份、会话期限与权限提示；不检查项目存在 | 可见父项目和保存指纹/历史元数据；不检查包正文或来源 |
| 200 | 完整16 KiB身份封套、空来源 | 完整16 KiB recorded或not-observed，两者均成功 |
| 响应头 | 成功带trace；早期认证/输入失败可能没有trace头 | 直接Node HTTP入口在认证前设置trace及Connection: close，包括提前拒绝 |
| 专用容量/期限 | 身份处理器没有独立两槽或30秒预算 | 每router两笔、处理器30秒；底层结束释放，超时不保证SQL取消 |

全部应用JSON响应带private, no-store，两个成功响应均无ETag，不处理条件缓存为304。HTTP代理/其他协议可能改变Connection等逐跳头，文档描述直接服务端边界；不据此要求HTTP/2携带该头，也不保证外层HTTP解析或代理错误使用应用封套。GET的早期错误不保证WWW-Authenticate，POST也不增加该保证；限流不承诺Retry-After。

| HTTP状态 | 身份GET | 历史回执POST |
| --- | --- | --- |
| 400 | INVALID_INPUT：查询/正文条件/重复及禁止头/trace不一致 | INVALID_INPUT：同类条件、无效或超4 KiB正文、原查询结构；超限不映射为413 |
| 401 | UNAUTHENTICATED | UNAUTHENTICATED |
| 403 | DENIED：范围、预期身份、权限/策略或会话 | DENIED：另含完整原身份/restricted不符 |
| 404 | 不以身份查询证明项目存在；其他路由边界错误见default | CONTEXT_PACK_NOT_FOUND：父项目不可见；原记录缺失是200 not-observed |
| 409 | 无专用身份冲突码 | IDEMPOTENCY_KEY_REUSED：原参数/权限指纹不同 |
| 429 | RATE_LIMITED：通用actor/path频率限制，retryable=true | 通用频率为true，历史两槽占满为false |
| 500 | CONTEXT_PACK_SAVE_CONTEXT_INVALID为false；INTERNAL_ERROR为true | CONTEXT_PACK_RECEIPT_INVALID为false；INTERNAL_ERROR为true |
| 503 | 认证或审计不可用，retryable=true | 认证/审计不可用为true；历史存储不可用/读取超时为false |

未另注明的专用输入/认证/拒绝/未找到/冲突错误retryable=false。布尔值来自原HTTP错误，不可用SDK固定映射反推；错误码不是穷尽枚举，retryable也不是自动重发原保存的授权。

原始已定义头部对序列化后限16 KiB，不等于HTTP线缆字节或单头限制。POST正文原始字节和解析后查询分别限4 KiB；身份/历史成功封套16 KiB。历史30秒从处理器开始，外层认证、正文读取、策略/审计和发送响应不在其中；客户端自己的总期限和16 KiB错误读取限制另行生效，不声明服务端统一错误字节上限或全HTTP耗时上界。

原Gateway/身份/权限、查询回显、历史预算/TTL/来源及本地文件摘要仍沿[原请求Schema说明](../schemas/README.md#contextpack-原请求与历史回执)与[ContextPack运行契约](../../../docs/design/01-contracts/context-pack-runtime.md)。源码依据为server/authenticated-context/http/router和save-context/save-receipt处理器。未调用接口、SQL或校验工具；R-003未完成、evidence为空，完整WCP OpenAPI、本地解析/生成和真实客户端兼容证据仍待补。

## 保存包元数据目录

`context-pack-directory.json`采用OpenAPI 3.1.0，包子路径为`@planemem/contracts/openapi/context-pack-directory.json`，仅覆盖`GET /v1/context-packs`。成功JSON复用`../schemas/context-pack-directory.json`完整资源及其标量/游标锚点；错误沿`packages/contracts/src/errors.ts`的五字段封套。此文件是接口文档，不是生产路由或新的运行时校验器。

本地消费时保留`openapi/`与`schemas/`的相邻目录关系，为解析器提供文档的本地基址，并注册完整目录Schema的`$id`。通过包子路径获得内容后，也要显式配置本地资源映射；只复制OpenAPI文本而丢失基址不能可靠解析相对引用。`planemem.local`仅是Schema标识，不是下载地址。无需加载完整包读取或比较Schema。外部Schema、锚点、2020-12及Reference Object描述覆盖的工具兼容性仍待验证；本轮不执行加载或生成示例。

### 请求与响应

- 使用当前Gateway地址与Bearer令牌，提供`x-tenant-id`、`x-workspace-id`、`x-project-id`三范围头，必须与可信授权范围一致。真实actor/client/角色/能力来自已验证身份。处理器要求未过期会话及规范后的实际`context.read`；既有认证层可能将`workbench.read`或指定工作台客户端的`Base`映射为该能力，单有admin不够。
- HTTP的`x-expected-actor-id`、`x-expected-client-id`可分别省略，提供时必须与可信身份相等；它们不是身份来源。CLI JSON成对约束不属于本HTTP参数规则。客户端字段按共享isSyncIdentifier规则；不要误套CLI额外排除DEL的规则。
- 当前server优先采用非空`traceparent`，其次非空`x-trace-id`，均缺省则生成`trace_http_<ULID>`。这里把traceparent当不透明标识，没有执行W3C Trace Context解析。成功读取要求有效共享trace，完整返回体与`x-trace-id`头保持所选值。
- 只接受各至多一次的`pack_id`、`limit`、`cursor`查询。limit为1–100，省略25，URL须为无符号、无前导零的十进制整数；响应query显式带limit。未知/重复/空参数无效。公开GET不带JSON正文；`content-length`仅可缺省或字面量`0`，拒绝transfer-encoding和文档列出的写入、条件缓存及Range头。OpenAPI的参数表和自定义扩展不能独立强制这些额外规则。
- 200完整响应只含六字段元数据，精确筛选找不到或不可见的包返回空页，父项目不可见返回404。所有应用JSON响应发送`cache-control: private, no-store`，成功页带`x-trace-id`且没有ETag，不返回304。提前认证/输入拒绝可能没有`x-trace-id`响应头，必须保留并读取错误体trace；不承诺WWW-Authenticate或Retry-After头。

| HTTP状态 | 当前主要错误码与语义 |
| --- | --- |
| 400 | INVALID_INPUT：查询/禁止条件/游标失效，retryable=false；其他边界错误仍沿公共封套 |
| 401 | UNAUTHENTICATED：缺失或拒绝凭据，retryable=false |
| 403 | DENIED：范围/原身份不符、策略拒绝或执行期间到期，retryable=false |
| 404 | CONTEXT_PACK_NOT_FOUND：父项目不可见，retryable=false；不同于精确包查询空页 |
| 429 | RATE_LIMITED：通用actor/path限流为true，目录两容量占满为false |
| 500 | CONTEXT_PACK_INVALID为false；意外命令错误INTERNAL_ERROR默认序列化为true |
| 503 | 存储不可用/目录等待超时为false；认证不可用/审计持久化不可用为true |

表中的布尔值是原始HTTP错误体的`retryable`。SDK和MCP固定错误映射可能另置false，不能反推原始HTTP封套；retryable不表示客户端自动重试、切换账号或刷新游标。`details`保留开放诊断对象，错误码不是穷尽枚举，外层代理或HTTP解析失败也不保证应用JSON形状。

### 运行时边界

`x-runtime-limits`、`x-rejected-request-headers`、`x-required-normalized-capabilities`和`x-wcp-operation`是说明性扩展。原实现负责规范查询4 KiB、单记录2 KiB、成功封套256 KiB，以及普通JSON/UTF-16/跨字段关系。4 KiB是解析后查询预算，不是原始URL限制；16 KiB错误上限由各客户端读取器施加，不表示服务端统一错误大小限制。

目录处理器每router两笔容量、30秒等待期限，外层认证、策略/审计和响应发送不在该期限内；数据库操作超时后未必可取消，底层结束才释放槽位。查询和Schema不能证明数据库扫描成本或整个HTTP耗时上界。

真实可见性过滤先于limit+1，版本/ID降序与绑定游标、规范原请求、唯一ID及完整续页由原实现检查。游标不是授权或跨页快照；目录不检查完整包正文/hash/来源，过期或来源变化仍可列出。完整包读取、编译、MCP资源候选目录和其他WCP路径不属于本文档。

源码依据为Gateway的`server.ts`、`authenticated-context.ts`、`http.ts`、`router.ts`、`context-pack-directory.ts`，以及共享目录解析器/错误封套；使用说明见[ContextPack契约](../../../docs/design/01-contracts/context-pack-runtime.md)和[独立目录结构](../schemas/README.md#保存-contextpack-元数据目录)。R-003保持未完成、`evidence: []`。全量OpenAPI、自动一致性、本地解析/生成工具和真实客户端兼容证据待补；仅源码文档人工审阅与格式文本检查，未执行校验器/生成器、编译、类型检查、测试、API/数据库或发布。
