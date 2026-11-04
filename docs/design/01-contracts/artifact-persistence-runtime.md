# Artifact 持久化服务基础（源码阶段）

2026-11-02：`apps/artifact-service/src/persistent.ts` 新增 `PersistentArtifactService`，由包入口导出。旧 `ArtifactService` 保留内存兼容实现。当前已补入 PostgreSQL/S3 适配、显式服务器配置、HTTP/SDK/CLI/MCP/工作台按原请求上传、可审计下载，以及元数据与原请求回执查询源码；工作台另有新请求的可视化准备并交接至原上传流程。以上均没有运行验证。

当前仅源码与文档开发，未编译、类型检查、测试、连接业务存储、启动服务、执行迁移或发布。S3 开发曾尝试检索官方文档，但未返回可读结果，不作为接口核对证据。`045_artifact_command_receipts.sql` 只新增文件，016–045 均未执行；不提供运行或恢复验收证据。

## 身份与权限

每次调用传入 `ArtifactAccess`：`tenant_id/workspace_id/project_id/actor_id/client_id/trace_id/capabilities`。这些字段必须来自已验证的调用上下文，不能直接信任公开请求正文。服务复制上下文和写入参数，再开始异步访问。

读取要求 `artifact.read`；创建、追加和原回执查询要求 `artifact.write`；内容恢复同时要求读写。父项目和当前 Artifact 必须存在、未删除、归属同一范围且分类可读。项目、当前记录或目标历史快照为 restricted 时还要求 `data.restricted.read`。当前记录失去可见性后，原成功回执也不会绕过授权返回。

服务内部返回 storage_key 供存储协作，它不是公开下载 URL。调用方仍须完成 Policy、身份验证及审计集成。

## 写入描述与服务方法

所有写请求包含 `request_key`、裸小写 64 位十六进制 `sha256` 和非负安全整数 `size`（字节）。正文单独以 `Uint8Array` 传入，不放进命令或回执 JSON。请求键最长 255 字符且不含空白。

| 方法 | 输入及行为 |
| --- | --- |
| `createArtifact(access, command, content)` | `operation: artifact.create`，附 `name/mime/classification/source_refs`；服务分配 ULID，创建版本 1。 |
| `putVersion(access, command, content)` | `operation: artifact.put-version`，附 `artifact_id/expected_version`；精确匹配当前版本后追加，沿用原名称、媒体类型、分类和来源。 |
| `getArtifact(access, artifactId)` | 返回当前元数据，并核对当前版本快照，不读正文。 |
| `getVersion(access, artifactId, version)` | 返回指定历史元数据；先核对当前记录的可见性，不用当前元数据替代历史快照。 |
| `readVersion(access, artifactId, version)` | 读取历史元数据后读取对象，核对长度及 SHA-256，返回独立正文副本。 |
| `restoreVersion(access, command, sourceVersion)` | 读取指定历史正文，核对原追加命令的 hash/size，然后按原预期版本追加。历史记录不被改写。 |
| `getCommandReceipt(access, command)` | 按原身份、原键及完整原参数读取持久回执；不上传、不写入、不自动重试。 |

新建名称最长 255 字符；媒体类型为无参数的 type/subtype；来源最多 200 条，保留数组顺序和原字段文本，不自动去重或改写。未知命令字段拒绝。追加版本必须为正安全整数，耗尽安全整数范围时拒绝。

`restoreVersion` 是内容恢复便捷方法，`sourceVersion` 不属于追加命令指纹；相同字节内容不区分源版本，来源元数据沿用当前 Artifact。需要确认原恢复结果时直接调用 `getCommandReceipt`，不依赖再次读取源对象。带源版本的独立恢复命令及审计来源仍待开发。

## 数据库与对象端口

`ArtifactDatabase` 提供 `query` 和 `transaction`；事务回调必须在同一连接执行，仅在 COMMIT 已确认后 resolve，回滚或提交结果未知时 reject，不得隐式重放回调。此处 SQL 使用 PostgreSQL 行锁和事务级 advisory lock；端口本身不是连接池。

`apps/api-gateway/src/artifact-persistence.ts` 提供基于已有 postgres 3.4.7 的 `PostgresArtifactDatabase` 实际 SQL 适配器，以及 `createPersistentArtifactService(database, objects, options)` 显式组合工厂；均从 Gateway 包导出。传入调用方持有的根 postgres 客户端与不可变对象适配器，构造不联网、不执行迁移、不建立新连接池、不注册路由。连接池创建、连接/获取超时、关闭和凭据由调用方负责；应使用默认字段命名及不改写数据的驱动配置。不得把已有事务客户端当作根客户端传入。

适配器通过驱动 `begin('isolation level read committed', ...)` 在同一连接上执行事务，返回值装入对象再解包，避免驱动把数组结果解释为待执行查询列表；只有 begin 确认 COMMIT 后才返回。事务回调结束后，保留的事务句柄拒绝新增查询。查询返回普通行数组，由领域服务继续校验行内容；驱动错误不转换为空列表或成功结果，也不重放回调。

可配置 `statement_timeout_ms`（默认 30000）、`lock_timeout_ms`（默认 5000）、`idle_transaction_timeout_ms`（默认 120000）及工厂 `max_bytes`（服务默认 64 MiB）。三个数据库时间值必须为 1–2147483647 的整数毫秒，锁超时不大于 SQL 超时。使用参数化 `set_config(..., true)` 设置事务本地限制，不修改连接池其他事务的默认值。独立 query 同样包在有界事务中；SQL 文本仅供可信内部服务使用，值参数只接受字符串、布尔值、null、安全整数和有效 Date 副本，JSON 由服务序列化后显式转换为 jsonb。

上述限制不是整个请求的总时限，也不替代连接池排队或对象传输超时。对象上传/读回期间数据库处于事务空闲等待，可能触发空闲事务超时；这会使事务失败并保留原请求待查，不允许降级为内存成功。对象适配器仍必须自行限制传输时间和读取字节数。

`ImmutableArtifactObjects.putIfAbsent` 只在对象不存在时创建，已存在的对象不得覆盖。`read(key, maxBytes)` 必须在读取过程中执行上限，`undefined` 表示对象不存在，零字节对象必须返回空字节数组。服务默认单次上限 64 MiB，可在构造时配置；目前完整正文在内存中处理，尚非流式或分片上传。

对象键为 `artifacts/{tenant}/{workspace}/{project}/{artifact_id}/sha256/{hash}`，范围分段 URL 编码。包含 Artifact ID，避免不同文件上传相同内容冲突于现有 storage_key 唯一约束；同一 Artifact 的相同内容版本可以引用同一不可变对象。

写流程：

1. 解析原参数并复制正文（包括 Node Buffer），检查长度和 hash。
2. 开启事务，锁定可见父项目，再按完整身份/原键获取事务锁。
3. 优先核对原回执；无回执时才锁定当前 Artifact 并检查预期版本。
4. 创建不可覆盖对象，读回并核对长度与 hash。
5. 同事务保存当前元数据、不可变版本快照和原命令成功回执，确认提交后返回。

对象操作期间保持数据库锁，生产适配器需设置有界超时。对象存储与 PostgreSQL 不构成跨系统原子事务：对象成功而数据库回滚可能留下未引用对象；创建重试还可能使用新 ULID。服务不在失败或未知结果时自动删除对象，保留策略与孤立对象清理待开发。

## S3 对象适配（源码，兼容性待验证）

`S3ArtifactObjects` 在 Artifact 包导出，实现不可变对象端口，使用 Node 内置 fetch、SHA-256 与 HMAC；没有新增第三方依赖。按普通桶的 path-style GET/PUT 和 SigV4 实现，不支持目录桶、访问点、预签名 URL、分片或自动区域发现。当前没有签名样例、AWS/MinIO 运行证据；必须保持源码阶段标记，不能据此启用生产上传。

构造需要 `endpoint/region/bucket/credentials`。端点只接受根路径、无账号密码、无查询或 fragment 的 HTTPS URL；内部 HTTP MinIO 必须明确设置 `allow_http: true`。桶预先存在，配置仅来自可信服务端；不读取客户端自报端点，不自动创建桶、修改桶策略、跟随重定向或删除对象。请求构造保留原对象键字节语义，范围编码中的百分号会再次按 HTTP 路径编码，避免解码后改变键名。

`credentials(signal)` 每次操作调用一次，返回 `access_key_id/secret_access_key` 及可选 `session_token`；提供者负责从服务端配置或凭据系统取值和轮换。代码不缓存凭据、不记录认证头、不把远端错误正文或 URL 放入公开错误。超时后即使提供者晚返回，也不会继续发起上传；提供者本身应响应 signal 释放其资源。

默认 `timeout_ms=30000`，范围 1–2147483647 毫秒，覆盖凭据异步获取、HTTP 请求及响应读取；同步复制/哈希无法被事件循环计时器抢占。默认 `max_bytes=64 MiB`，允许 0–1 GiB；正文仍完整驻留内存，存在复制/扩容的额外峰值，不表示支持流式大文件。每次 read 同时受调用方 maxBytes 和适配器 max_bytes 限制。

PUT 复制输入字节后签名，请求携带 `If-None-Match: *` 和 payload SHA-256。仅处理 200 和 412 为端口返回，412 不视为新上传成功；领域服务随后必须读回并核对 hash/size，才能提交元数据。409、403、其他状态及传输异常均抛错，不自动重试或去掉条件头。实际端点必须支持并执行条件写入，这一点尚未通过兼容性验证。

GET 仅接受 200 正文；404 响应最多读取 16 KiB，且只有有界 Error/Code 内容明确为 `NoSuchKey` 时返回 undefined，不把缺桶、权限不足、代理 HTML 或任意 404 当作文件不存在。不解析 XML 实体。读取拒绝非 identity 内容编码、非法 Content-Length、声明超限、实际超限和长度不符；缺少长度时逐块计数并有界扩容，零字节对象返回空数组。领域服务再校验最终 SHA-256。

上传/读取不在应用层自动重放。超时会中止 fetch，操作外层及时拒绝；结果未知仍按原身份/参数/版本/键查持久回执。S3 层使用 `S3_UNAVAILABLE/S3_TIMEOUT/S3_RESPONSE_INVALID/S3_TOO_LARGE` 的脱敏错误及可选 HTTP 状态；领域服务对存储调用失败仍使用现有 `ARTIFACT_OBJECT_UNAVAILABLE` 封套，不向客户端暴露桶、键或凭据。

Gateway 新增 `createS3PersistentArtifactService(database, objectOptions, databaseOptions?)`，把 S3 与 PostgreSQL 适配显式组合，领域服务和对象适配使用相同 max_bytes。构造不执行网络请求、迁移或注册路由。其使用形态如下，`db`、配置及凭据提供者由服务器负责供应：

```ts
const artifacts = createS3PersistentArtifactService(db, {
  endpoint: configuredEndpoint,
  region: configuredRegion,
  bucket: configuredBucket,
  credentials: loadServerArtifactCredentials,
  max_bytes: 64 * 1024 * 1024,
  timeout_ms: 30_000,
});
```

这个独立组合示例不会启动服务器。连接池等待时限、凭据提供者内部取消、桶权限及条件写入能力、系统时钟、签名路径兼容性、存储保留/版本策略和业务审计仍需后续工作。

## 元数据读取 HTTP 与 SDK

新增 `GET /v1/artifacts/{artifact_id}`（artifact.read）和 `GET /v1/artifacts/{artifact_id}/versions/{version}`（artifact.version.read）。前者读当前元数据，后者读指定历史快照；不接受查询参数。ID 必须为 ULID，路径版本必须为无前导零的正安全十进制整数。读取不接受文件正文，不调用对象 PUT/GET，也不自动创建 Artifact。

两者始终使用令牌验证的 scope/actor/client/capabilities，需要 `artifact.read`，不能用 `context.read` 或仅 admin 角色代替。restricted 项目、当前记录和目标历史记录仍要求 `data.restricted.read`。服务按当前项目和记录可见性过滤，再核对持久快照；网关再次检查公开结果的范围/目标/分类。Policy 与 OPA 增加 artifact.read 映射；沿用网关的授权决定审计，并附 Artifact 引用。这是授权决定记录，不是下载审计或成功读取的证据。

`createPlatformServer` 支持以下显式配置：

- `artifact_reader`：可信 `ArtifactMetadataReader`，实现 getArtifact/getVersion，必须执行当前父项目/Artifact 可见性和历史快照校验；外部资源生命周期由调用方负责。
- `artifact_receipts`：可信 `ArtifactReceiptReader`，实现 getCommandReceipt，必须执行原身份/命令绑定、当前项目/Artifact 可见性与原历史快照校验。可单独提供，也可和 artifact_reader 一起提供；单独配置元数据 reader 不会自动开放回执。
- `artifact_storage`：服务端 `S3ArtifactOptions`，要求已有 DATABASE_URL，构造双适配服务，数据库池沿用服务器现有生命周期。元数据 GET 仅访问 PostgreSQL，不执行 S3 请求。

artifact_storage 与任何 reader 同时配置，或 reader 缺方法时拒绝配置；存储配置会让两个读取入口共享同一个持久服务。对应 reader 未配置时，合法、已授权的请求返回 503 `ARTIFACT_STORAGE_UNAVAILABLE`，不回退内存。未读取新的 S3 环境变量，不配置或创建桶。`workbench_db` 不是事务存储的替代项。服务器配置接入仅有源码，尚未启动。

响应为标准封套：`schema_version/trace_id/source_refs/revision/data`，data 为 `{ artifact, snapshot, content_state }`。snapshot 为 current 或 historical，content_state 固定 not-checked，表示没有访问正文，也不确认原写请求。artifact 包含范围、名称、媒体类型、分类、来源、hash/size、版本/ETag、原 trace 与时间；**不含 storage_key、桶地址、凭据、下载 URL 或正文**。

当前读取的外层 ETag 和 HTTP ETag 对应返回版本；历史读取仅在 artifact 快照内保留当时 ETag，外层和 HTTP 均不返回 ETag，不能当作当前写条件。两个入口都绕过写入幂等缓存，返回 private/no-store，忽略继承的写条件；历史读取不改变原请求、原键或恢复状态。

SDK 新增 `getArtifact(id)` 和 `getArtifactVersion(id, version)`。`packages/contracts/src/artifact-read.ts` 由网关与 SDK 共享，严格校验目标/范围、原 metadata 字段、内容描述、来源、版本/ETag、ISO 时间和当前/历史标签；额外字段及 storage_key 拒绝。SDK 不自动重试、不读文件正文、不把缺失版本降级为当前版本。

错误状态：无令牌 401；缺能力/分类权限 403；不可见或不存在 404；无可信旧快照 409；持久快照或响应结构不一致 500；存储未配置/不可用 503；非法 ID/版本/查询 400。数据库迁移缺失不自动执行，仍按存储不可用拒绝。

## CLI 与 MCP 元数据读取

CLI 新增 `artifacts get`（JSON 仅 artifact_id）和 `artifacts version`（JSON 为 artifact_id/version）。网络入口支持 --json 或 --json-file，嵌入 runWorkctx 支持 --json；两者复用严格查询与完整响应解析。历史版本必须为正安全整数，不接收版本字符串、不省略版本；当前读取不能带 version。拒绝 --key、正文 idempotency_key/expected_version、身份/scope 覆盖及重复选项。嵌入调用清除继承的写键与预期版本，保留可信权限和范围。返回原响应元数据，不使用内存旧类或本地 outbox。

MCP 新增 `get_artifact`、`get_artifact_version`，分别接收相同字段。工具发现要求实际 artifact.read，admin 角色不替代该能力。调用复用现有 HTTP 读取处理与授权决定审计，准备请求时清除继承写条件；响应适配器检查工具、GET 路径及完整共享封套。这两个元数据工具不访问文件正文，不建立额外 Artifact resources；独立上传/下载工具见后文。

两个入口均保留 snapshot/current/historical 与 content_state=not-checked；缺失历史版本不改读当前版本。无存储键、下载 URL、正文或原命令回执；历史结果不提供当前写条件。遇到错误直接返回，不自动重试、换身份或建立新请求。CLI 成功退出 0 仅确认元数据读取，使用错误退出 2；MCP 无效成功响应转为 isError。无新增迁移、依赖或运行证据。

## 回执与结果未知

回执 ID 是 `[tenant, workspace, project, actor, client, request_key]` 的 SHA-256；命令指纹来自严格解析后的完整规范字段。身份内同一键换操作、内容或参数会返回 `IDEMPOTENCY_KEY_REUSED`，不能静默建立新写入。

确认结果为 `{ status: recorded, artifact, replayed, trace_id }`。初次提交 replayed 为 false；原键重放或回执查询为 true。artifact 是当时保存的历史快照，包含原 trace；外层 trace 是本次调用。即使当前版本推进，仍返回原成功版本，且核对其不可变历史快照。

未观察到回执返回 `{ status: not-observed, trace_id }`，不证明失败；并发写可能尚未提交。存储不可用或提交结果未知也不能证明失败。调用方应保留原身份、参数、版本和键，明确查询回执后再决定是否原样重试，不自动改键或替换预期版本。当前元数据不是原命令结果证据。回执确认元数据提交，不证明正文现在仍可读或已完成审计发布。

## 原请求回执 HTTP/SDK 查询（源码阶段）

公开回执查询为只读 `POST /v1/artifacts/receipt`，操作名 artifact.receipt，需要已验证账号/客户端、artifact.write 和原范围；admin 不能替代实际能力。正文为 `{ identity, command }`：identity 必须包含原 tenant_id/workspace_id/project_id/actor_id/client_id，且逐项等于令牌上下文。command 为上文完整创建或追加命令，包含原 request_key、sha256/size 及原创建参数或 artifact_id/expected_version。不接受正文内容、额外字段、URL 查询参数、Idempotency-Key 或版本前置头。身份字段只作相等约束，不授予权限；查询不会创建文件、追加版本或读对象。

公开封套为 `{ schema_version: 1, trace_id, source_refs, data }`。data 回显已校验的 identity/command，status 为 not-observed 或 recorded；recorded 另含无存储地址的 artifact 历史快照、replayed=true 和 content_state=not-checked。recorded 的外层来源精确引用保存的 Artifact/版本，not-observed 来源为空。不返回外层 revision/ETag，也不把历史保存结果转换为当前写条件。当前版本推进后仍读取原结果；缺少回执时，追加请求的目标也必须当前可见，缺失/无权读取不能伪装成 not-observed。

`packages/contracts/src/artifact-command.ts` 从服务提取原命令类型/解析，保留字段顺序、来源规范化和指纹语义；旧服务包入口继续导出。`artifact-receipt.ts` 严格核对身份、原键/参数、原内容描述、创建版本 1 或追加 expected_version+1、原来源和响应 trace。Gateway 和 SDK `getArtifactReceipt({ identity, command })` 共用解析；SDK 要求scope及已配置的账号/客户端与原身份匹配；未配置的身份也始终附加原账号/客户端前置头供Gateway验证，不继承写条件、不自动重试，响应损坏不转成无回执。请求绑定与交给 provider/transport 的对象分离。

查询沿用 Gateway 授权决定审计；追加查询可附目标 Artifact 引用，但该审计不确认原写入成功、正文可读或下载。当前 HTTP/SDK/CLI/MCP/工作台查询、按原请求上传与可审计下载只有源码，上传/下载见后文。无新依赖或迁移；未编译、类型检查、测试、连接存储、启动服务或发布。

CLI `artifacts receipt` 支持网络 --json/--json-file，嵌入 runWorkctx 使用 --json；输入与 HTTP 相同，不接受 --key、额外字段或重复选项。网络请求先核对配置项目，再附原账号/客户端前置头；嵌入要求已验证客户端、artifact.write 与完整原身份相等，清理上下文继承的键和版本。查询成功退出 0 包括 recorded/not-observed，需读取 status 判断是否已观察到原成功；用法错误退出 2，其他错误退出 1，不以错误或空回执宣布原操作失败。

MCP `get_artifact_receipt` 的 schema 严格区分原创建/追加命令，不标记为写操作。发现和调用要求实际 artifact.write 与已验证客户端，admin 不能代替；清除外层继承写条件，保留嵌套 command 的原键/版本。协议保存独立请求快照以校验结果，核对 POST 路径、可信身份、响应 trace 和完整原回执；损坏成功响应返回 isError。这两个回执命令均不上传/下载、不自动重试、不创建 outbox 或自动变更原身份/参数。

## 公开上传 HTTP/SDK（源码阶段）

| 路径 | 原 command.operation | 写条件 |
| --- | --- | --- |
| `POST /v1/artifacts` | `artifact.create` | Idempotency-Key 必须等于原 request_key，禁止版本头。 |
| `POST /v1/artifacts/{artifact_id}/versions` | `artifact.put-version` | 原 artifact_id 等于路径；Idempotency-Key 等于 request_key；If-Match 为原 expected_version 对应的 `W/"version-N"`。 |

两条路由只接受 `multipart/form-data`，恰好两个带 filename 的文件部件：`request` 的 Content-Type 为 application/json，内容是 UTF-8 `{ identity, command }`；`content` 为原始文件字节。request 不接受普通文本表单字段、无效 UTF-8 或额外字段；禁止重复/多余部件、URL 查询参数、压缩 Content-Encoding 和 If-Match-Version。文件部件的名称及媒体类型不作为 Artifact 元数据，名称/媒体类型/分类/来源以原 command 为准，追加沿用原记录的这些字段。

Bearer 令牌必须验证账号、客户端与项目范围，并具有实际 artifact.write；admin 角色不能代替能力。先验证身份、写权限和写头再读上传正文；解析后逐项匹配原 identity、操作、路径、键和版本。Gateway policy/OPA 与持久服务继续检查当前项目/Artifact 可见性，restricted 创建及记录需要 data.restricted.read。未配置持久 writer 时读取正文前返回 503，不回退内存实现。

服务器配置可选择 artifact_storage 与既有 DATABASE_URL 组合，或显式注入 artifact_writer（createArtifact/putVersion），并可分别注入 artifact_reader/artifact_receipts；显式适配器与 artifact_storage 互斥。writer 是可信服务端端口，必须遵守不可变对象验证、可见性和持久原回执约定。单独 writer 不启用回执查询；需另行注入同一服务的 artifact_receipts。artifact_upload_max_bytes 默认取 artifact_storage.max_bytes，未提供则为 64 MiB，允许 0–1 GiB；持久服务仍执行其自身上限。

request 部件最多 1 MiB，整个请求最多文件上限 + 1 MiB + 64 KiB 包装余量，声明长度和实际字节数均有界。原生 multipart 解析在读完整个有界正文后进行，不提供流式或 S3 multipart 上传；内存同时包含解析和保存副本。每个服务器实例最多两路上传，名额从读取开始保持到持久调用结束，超额返回 503 ARTIFACT_UPLOAD_BUSY。正文读取总期限 120 秒，超时返回 408；超限返回 413。上传响应关闭该连接，以处理认证拒绝、超限或超时后未读的正文；客户端断开或响应丢失不代表事务未提交。

持久服务校验原 size/SHA-256，持有原身份/键锁并先查原回执，再检查新追加的当前版本；新对象条件写入并读回校验后，将元数据、历史快照和回执同事务保存。原键命中返回原成功版本，不额外创建版本；不会用当前版本替换原 expected_version。授权决定审计不记录文件字节，且不构成保存完成审计或事件发布。

HTTP 200 封套由 artifact-upload 共享解析器核对：schema_version/trace/source_refs，以及 data 内的原 identity/command、status=recorded、公开 artifact 历史快照和内容状态。首次保存为 replayed=false、content_state=verified-at-save（保存时对象读回已通过，原记录 trace 等于本次 trace）；原键重放为 replayed=true、content_state=not-checked（本次没有读取存储正文）。两者都不保证正文现在仍可下载，不含 storage_key、外层 revision 或外层/HTTP ETag；快照内部 ETag 仅描述保存时的版本。响应字段、身份或目标不符返回错误，不能将其当作成功或失败证明。

SDK `createArtifact(original, bytes)` / `putArtifactVersion(original, bytes)` 接收已保存的 ArtifactReceiptQuery 和 Uint8Array。调用前保留原 identity/command；SDK 在异步传输前复制规范化请求和字节，按原命令设置键/版本头，不继承上下文旧写条件。FetchWcpTransport 原生发送 FormData，由 fetch 生成 boundary，并在等待 token 前固定头和正文；自定义 transport 也须支持 FormData。SDK 检查长度和协议上限，SHA-256 由持久服务核验；不自动保存 outbox、不生成请求键、不自动重试。原传输默认 30 秒超时，可通过 timeout_ms 显式调整；任何超时、损坏响应或中断都应保留原请求，再显式 getArtifactReceipt 查询。

本增量无新依赖、迁移或运行证据。MCP/工作台按原请求上传及下载授权审计的后续源码增补见下文，大文件流式上传仍待开发；本次仅修改与格式化源码、同步文档，不编译、类型检查、测试、连接存储或运行服务。

## 指定版本下载 HTTP/SDK（源码阶段）

入口为 `GET /v1/artifacts/{artifact_id}/versions/{version}/content`。必须先选择明确历史版本并提供 `X-Expected-Artifact-SHA256` 和 `X-Expected-Artifact-Size`（规范十进制字节数）；服务核对目标的不可变描述，不支持 current 别名，不在历史缺失时降级。禁止 URL 查询参数、正文、Range/If-Range、条件缓存头和 Idempotency-Key/If-Match/If-Match-Version。描述不符返回 409 ARTIFACT_DESCRIPTOR_CONFLICT；损坏记录返回 500，未配置内容/审计持久端口返回 503，不返回文件内容。

下载必须有已验证账号/客户端、有效令牌及实际 artifact.read；admin 不能替代能力。持久 getVersion/readVersion 检查项目、当前记录和历史快照可见性。Gateway 还对当前及目标历史分类执行本地 canRead/canExport 与 export.artifact Policy/OPA：public 可导出，internal/confidential 需要 data.export 或 data.restricted.export，restricted 需要 data.restricted.read 和 data.restricted.export。源码在对象读取前后再次核对这些约束及历史快照一致性；权限代表最后一次授权读取时的状态，不保证整个网络发送期间权限永不变化。

服务器可显式提供 artifact_content（getArtifact/getVersion/readVersion），其元数据方法也作为未单独配置 artifact_reader 时的后备；或使用统一 artifact_storage 与既有 DATABASE_URL。显式内容适配器和 artifact_storage 互斥。持久审计由 audit_persist 或既有 DATABASE_URL 的审计实现提供，on_audit 回调和内存 AuditService 不能单独启用下载。注入的内容/审计端口是可信服务端适配器，必须遵守当前可见性、有界读取及持久保存承诺。

在发布字节前，Gateway 验证返回元数据与 trace、内容长度和 SHA-256，复制内容以隔离 provider 修改，读取后再次检查可见性/导出策略。随后创建并等待持久 `artifact.download.release` 审计，绑定账号、客户端、项目、Artifact/版本、分类、字节数和本次 trace；审计失败不发送正文。分类或导出策略拒绝会持久记录 `artifact.download.denied`，普通授权决定审计仍保留。每次显式尝试使用独立 audit_id，不按用户 trace 或请求键复用成功记录。细节遵循 AuditService 分类脱敏，记录不含字节、存储地址或凭据。

release 记录表示内容已校验且获准释放，`delivery_confirmed=false`；不能证明客户端收到或保存了文件。断线、发送失败、响应丢失时，已经保存的 release 记录仍可能存在；SDK 自身校验成功才代表本次调用取得了匹配字节。没有伪造 audit_id，也没有用 HTTP finish 事件补认交付成功。所有对象读取失败的细分审计、客户端收取确认和跨进程交付追踪仍未实现。

成功为 HTTP 200 二进制 `application/octet-stream`，固定安全附件名 `<artifact_id>-v<version>.bin`，设置 private/no-store、nosniff 和限制性 CSP。不返回 storage_key、签名 URL、外层 ETag、Content-Range 或原始文件名响应头。响应头绑定 `X-WCP-Schema-Version: 1`、X-Trace-Id、X-Tenant-Id/X-Workspace-Id/X-Project-Id、X-Artifact-Id/X-Artifact-Version/X-Artifact-SHA256、Content-Length、X-Artifact-Audit-Id 和 `X-Artifact-Audit-Stage: release`。三个范围响应头使用 encodeURIComponent 的规范 UTF-8 百分号编码，避免非 ASCII 范围进入原始响应头；SDK 按相同编码比较。错误仍返回标准 JSON 错误封套。

artifact_download_max_bytes 默认取 artifact_storage.max_bytes，否则为 64 MiB，可设 0–1 GiB；实际读对象还受持久服务自身上限及记录 size 限制。HTTP 每实例最多两路下载，名额从处理开始保持到响应 finish/close 或失败；超额返回 503 ARTIFACT_DOWNLOAD_BUSY。发送阶段最多 60 秒，超时关闭响应。此期限不替代数据库、对象适配器及策略 provider 的自身时限。完整字节在内存校验后发送，尚无流式 hash、范围下载或断点续传。

SDK `downloadArtifactVersion(id, version, { max_bytes? })` 先读取指定历史元数据，超过调用方上限则不发内容请求；默认 64 MiB，最大 1 GiB。客户端上下文必须固定项目/账号/客户端，内容请求附原身份前置头、版本/hash/size，且不继承写条件。FetchWcpTransport 新增 response_type=bytes 与必需 max_response_bytes，限制实际读取字节，失败时不返回部分内容；错误正文最多 1 MiB。自定义 transport 须返回 `{ status, headers, content: Uint8Array }`，headers 使用小写名称并保留校验头，不能把字节转换成 JSON 数组。

SDK 只接受完整 200，校验范围/目标/版本/trace/hash/长度/审计头，复制字节后通过 Web Crypto SHA-256 再核验；任何异常不返回内容，不自动重试。返回 schema_version、trace_id、固定版本 source_refs，data 包含公开 artifact、audit_id、audit_state=release-recorded 与 content_state=verified，顶层 content 为独立 Uint8Array。SDK 不打开或保存文件，不把该结果视为原上传回执。Fetch 默认 30 秒超时仍可显式配置；工作台下载见下节。

以上仅源码和文档，未编译、类型检查、测试、下载样本、连接业务存储或运行服务。未新增依赖或迁移，016–045 保持未执行。

## CLI 上传（源码阶段）

`workctx artifacts create --json-file ORIGINAL.json --file CONTENT` 和 `workctx artifacts put-version --json-file ORIGINAL.json --file CONTENT` 分别接入创建及追加上传。必须使用已保存的原 identity/command JSON，不接受 --json、--key、stdin、重复选项或额外参数；配置项目必须与原身份一致。Gateway 仍以签名账号/客户端验证原身份，不从文件中的 identity 授予权限。

独立 artifact-upload helper 在打开及取得句柄后检查普通文件，限制分配大小，以同一句柄读取完整内容并探测额外字节，读取前后检查大小/mtime/ctime；检测到变化或读取错误即停止。内容 size/SHA-256 必须精确匹配原描述，再生成内存 multipart 快照；JSON 文件及规范化内容最多 1 MiB。默认本地内容上限 64 MiB，--max-bytes 可显式设为 0–1 GiB；HTTP --timeout-ms 默认 180000，范围 1–2147483647。服务端继续独立限制和校验，不因 CLI 预检查而省略权限/内容核验。

嵌入 runWorkctx 支持相同保存文件参数及 --max-bytes，拒绝 HTTP 专用 --timeout-ms；先检查可信 authenticated_client 和实际 artifact.write，再匹配完整身份并读取内容。清除继承写条件后从原 command 设置键/版本，以独立请求副本调用 artifact.create/put-version；未配置持久 writer 不回退旧内存服务。网络与嵌入都校验完整上传封套，不自动查询回执或重试。

stdout 只在完整成功时输出原历史结果；参数/大小/hash 错误退出 2，文件读取/远端错误退出 1。发送前错误的 dispatch_state=not-sent 仅描述本次调用，不确认原请求以前失败。发送后的错误附 artifact_outcome=unconfirmed 与保留原 JSON/内容、显式查询 artifacts receipt 的提示；网络查询可直接重用同一 --json-file，嵌入回执仍传 --json。上传不生成或改写原文件/请求键/版本，不保存 outbox，也不把本地路径当作 Artifact 名称发送。当前没有命令执行或传输验证证据。

## CLI 下载（源码阶段）

`workctx artifacts download --json-file QUERY.json --output NEW_FILE` 或 `--json OBJECT` 只接收 artifact_id 和明确的正整数 version；查询最多 16 KiB。重复/额外参数、stdin、--key 和覆盖选项拒绝。--max-bytes 默认 64 MiB，可设 0–1 GiB；HTTP --timeout-ms 默认 180000，范围 1–2147483647，分别作用于元数据和内容请求，不是写盘超时。网络和嵌入 runWorkctx 共用流程；嵌入拒绝 HTTP 超时参数、要求可信 artifact.read 和未过期会话，清除继承键/版本。输出路径预检在网络请求前完成，父目录必须存在，目标不得已有文件、目录或链接。

HTTP 复用 SDK FetchWcpTransport 的 bytes 模式：历史元数据响应最多 2 MiB、严格 UTF-8/JSON 与完整封套校验；内容限选中 size，固定令牌/范围/版本/hash/size，验证完整 200 和响应头。嵌入依次执行 artifact.version.read/artifact.download。共享 parseArtifactDownloadEnvelope 绑定 scope/trace/目标/描述/source_refs/审计状态并复制内容，CLI 独立计算 SHA-256；解析器本身不计算 hash。失败不会回退当前版本、刷新令牌或自动重试，不打印正文或保存 outbox。

下载完整校验后，CLI 在已解析真实父目录内创建独占随机 `.workctx-artifact-*.part`，按实际写入长度循环写盘、同步并从同一句柄读回 hash/size，关闭后检查临时文件 dev/ino，再通过硬链接创建最终文件。最终路径被其他调用占用则失败，不支持硬链接时不回退可能覆盖的 rename/copy。清理前再次核对临时文件身份；从不删除最终路径或扫描清理别人的临时文件。该设计用于用户自己控制的目录，不保证抵御恶意并发替换，文件同步也不保证父目录落盘或断电持久性；Windows 权限由现有 ACL 决定。

stdout JSON 保留公开 artifact、固定版本来源、audit_id/audit_state=release-recorded/content_state=verified，并增加 local.state=saved/path/content_state/cleanup_pending，不包含 Uint8Array。发布成功但临时清理失败仍为成功并附临时路径；保存失败退出 1，错误包含 local_state=not-saved、目标路径及必要临时恢复信息，用法错误退出 2。not-saved 只说明本次未创建最终文件，不能据此删除已有目标。已经通过封套校验的 release 审计即使后续 hash 或保存失败仍保留；其他内容请求失败标记 unconfirmed，不捏造 audit_id。服务端 release 不是本地保存证明。

共用有界普通文件读取抽取至 artifact-files，上传语义保留。新增 CLI 对 SDK 的 workspace 依赖和锁文件链接，未安装依赖；没有实际下载或保存样本、编译、类型检查、测试、服务运行或发布。无新迁移，016–045 未执行；文件系统兼容性、故障路径和权限行为仍无运行证据。

## MCP 上传（源码阶段）

`create_artifact` 和 `put_artifact_version` 接收 `{ request: { identity, command }, content_base64 }`。调用方先保存原请求及准确内容，identity 只约束可信会话，原键和追加版本只取自 command，不接受外层写条件。发现/执行均要求已验证客户端、实际 artifact.write 和未过期会话；原身份、命令操作、规范请求大小、Base64 编码、长度和 SHA-256 全部核对后，复用 Gateway artifact.create/put-version 及原持久事务。内容最多 4 MiB 且遵守较小服务器配置上限，规范 request 最多 1 MiB；不提供分片、流式或自动重试。

HTTP MCP 在读取前鉴权，严格 UTF-8 JSON 对象与无压缩 Content-Type。普通正文1 MiB，具备实际artifact.write的有效认证调用者可扩展至8 MiB；已声明大正文或读取扩展触发前，申请与multipart共用的两路附件名额。已有同步/建议原请求额度可能先保留有限正文，但解析确认附件工具后仍须取得同一容量。扩展支持这两个上传工具及下述prepare_artifact_upload（同步/建议已有专用例外保留），读取总期限120秒，失败关闭连接。因读取工具名之前不能区分准备与上传，扩展只先检查身份和预留容量；确认实际大正文上传后再核对持久writer配置，未配置仍拒绝，不回退内存。小上传在解码/hash前申请，实际写入由原路由检查writer。准备不要求持久writer可用，名额转交其只读执行器；嵌入上传/准备默认共用每ApiGateway两路，可信宿主可转交同一gate的已有名额。

成功只返回完整校验的原历史上传封套文本，不回显内容；首次 verified-at-save、重放 not-checked 均不证明当前可下载。派发前失败标记本次 not-sent，派发后错误统一标记结果 unconfirmed；保存原 JSON/内容，显式 get_artifact_receipt 查询同一身份与命令，不换键/版本。未观察到原回执仍不证明失败。无新依赖/迁移，016–045 未执行；只有源码和文档，未编译、类型检查、测试、实际上传、运行或发布，MCP 客户端兼容性仍未核验。详见 [MCP 运行时](mcp-runtime.md)。

## 工作台按原请求上传（源码阶段）

新增 `/artifacts/upload`，由原回执页面及新准备页面的新标签页链接进入。粘贴或导入已保存的 UTF-8 request={identity,command}，复用回执页规范化及 1,000,000 字节限制；展示原项目/账号/客户端、键、长度/hash、创建名称/分类/来源或追加目标/原版本。导入不提交、不生成新键或补造原参数，新上传请求的可视化准备见下节。原 JSON 可导出或展开复制，页面不把请求写入 URL、浏览器存储或 outbox。

选择本地内容后先按 File.size 和原 size 限制分配，有界读取完整内容，再用 Web Crypto SHA-256 核对原 hash；最多 64 MiB。只有核对通过才保留独立内存 Blob，明确确认已保存并审阅原请求后才能提交。上传使用已核对的副本，不重新读取可能改变的本地文件；原文件名只用于本页显示，上游 multipart 使用中性文件名，记录名称/MIME/分类始终取原 command。零字节文件也核对 hash；浏览器缺少安全散列支持时不提交。

新增工作台本地 `POST /artifacts/upload/submit`，不新增 Gateway 路由。要求 Origin 与 WEB_CONSOLE_URL 的 origin 完全匹配、如有 Sec-Fetch-Site 必须 same-origin、专用 `x-workctx-artifact-upload: 1` 和 `x-trace-id=trace_web_upload_<UUID>`；请求必须是无压缩 multipart，拒绝 URL 查询、Range、条件缓存及外层写头。先读取一个有效签名会话快照，再申请本进程两路上传容量；不把 Gateway token 发送给浏览器。已声明长度和实际读取均限制为 64 MiB + 1,000,000 字节原请求 + 64 KiB 包装余量；解析后只允许各一个 application/json request 文件和 content 文件，禁止额外/重复部件。

代理在内存有界接收后核对原项目范围、大小与 Node SHA-256，发送前再次检查这次会话快照是否过期。以原 request_key 和追加 expected_version 设置 Idempotency-Key/If-Match，经既有 multipart 路由；原账号/客户端、实际 artifact.write、分类可见性、原键/版本和持久对象事务继续由 Gateway 独立检查。Gateway 地址固定且拒绝用户信息/查询/片段，不跟随重定向、不自动续期/重试。原请求身份不是授予权限的凭据。

代理输入/解析阶段期限 120 秒，上游上传及读取结果期限 150 秒；两路名额覆盖接收、核对、Gateway 调用与结果核验，结束或异常释放。浏览器导入原 JSON 最多等待 30 秒，本地文件准备 120 秒，提交 300 秒，回执查询本地等待 45 秒；原生散列/本地解析未必可中途打断，但完成后必须检查取消状态，取消后不继续提交。复用抽取的有界字节 reader；既有下载包装保留 64 MiB 限制。当前全量内容在内存处理，有解析与发送副本，不是流式或磁盘暂存。

上传成功只接受完整 HTTP 200、匹配 trace 和 JSON 封套；代理与浏览器均以原请求校验完整 ArtifactUploadEnvelope，结果最多 2 MiB，错误正文最多 16 KiB。只展示原历史版本/trace，区分首次 verified-at-save 与回执重放 not-checked，不证明当前下载可用。返回成功结果不含内容副本、存储键或凭据；失败仅返回有限原因、本次 trace 和 not-sent/unconfirmed。已开始 Gateway 调用后的任何错误都保留未知语义，即使收到拒绝或客户端停止等待。

页面互斥导入、文件核对、上传和原地回执查询。明确本次未派发时，允许重新选择同一原文件、重新确认后再提交；派发后结果未知时本页禁止重复上传，只允许显式查原回执。recorded 显示原历史成功并可打开该版本；not-observed 或查询错误不证明原操作失败，不解除未知结果约束、不改变原键/版本。停止等待不撤销服务器已派发写入，已发送的只读回执 action 也可能继续完成；迟到结果不会覆盖当前页面状态。提交结束、丢弃、pagehide/缓存恢复或卸载释放内容准备状态和导出 URL，保留原请求供用户保存；无自动本地持久化。

无新依赖、迁移或 Gateway 写操作；只改源码和文档，未编译、类型检查、测试、实际上传、浏览器渲染/服务运行或发布，016–045 未执行。Next multipart、浏览器生命周期、反向代理容量/时限及真实存储行为没有运行证据；P2-01/R-008 保持未完成。

## CLI 上传原请求准备（源码阶段）

2026-11-04：`workctx artifacts prepare --json-file DRAFT.json --file CONTENT --output NEW_ORIGINAL.json` 只准备一个新上传原请求。草稿必填，创建示例：

```json
{
  "operation": "artifact.create",
  "name": "notes.txt",
  "mime": "text/plain",
  "classification": "internal",
  "source_refs": []
}
```

追加示例（替换为实际目标和已经审阅的版本）：

```json
{
  "operation": "artifact.put-version",
  "artifact_id": "01J000000000000000000000001",
  "expected_version": 3
}
```

草稿复用现有写命令字段校验，拒绝额外字段、旧identity/command包装、request_key/idempotency_key、sha256/size。只允许上述三个必填文件参数及可选一次 `--max-bytes`、`--timeout-ms`；不接受内联JSON、stdin、重复参数或额外位置参数。草稿必须为UTF-8普通文件，输入与规范化完整原请求各最多1 MiB。输出必须在现有目录内选择全新路径，已有文件或链接均拒绝；草稿和目标路径先检查，之后才发只读请求。

读取已认证且实际具备artifact.write的当前上传身份，固定范围、账号、客户端与期限。内容文件默认最多64 MiB；`--max-bytes` 接受0至1 GiB十进制整数，实际上限取用户值与服务器身份封套max_bytes的较小值。使用同一文件句柄有界读取、额外字节探测及前后长度/mtime/ctime核对，计算读取字节的SHA-256；零字节文件允许。此观察不锁定文件，后续上传入口仍须核验所选内容与原请求hash/size完全相同。

创建restricted资料要求当前restricted读取能力提示；追加还要求实际artifact.read，并按原身份读取当前元数据（完整响应上限2 MiB），核对范围/目标/trace/版本及restricted权限。当前版本必须等于草稿明确填写的expected_version，否则ARTIFACT_VERSION_CONFLICT，不自动刷新版本。HTTP绑定原账号/客户端前置头，嵌入router使用固定可信上下文并在读取前后核对；嵌入准备拒绝继承idempotency_key/expected_version。身份提示和元数据观察不预留版本、不确认存储健康或将来写入权限。

使用同长度占位键先校验完整请求与大小，确认读取期限和身份未到期后才分配一次 `workctx-artifact-<ULID>` 新键。保存格式沿用 `{ identity, command }`，没有令牌或内容字节。临时文件独占创建，写入、同步、完整读回后通过硬链接不可覆盖地发布；不支持硬链接的文件系统明确失败，没有覆盖替代方案。再打开最终文件核对精确长度、SHA-256及完整规范化原请求，成功返回original_file/request_sha256、原身份/键/版本/内容描述符、identity_observed_expires_at、local_state=saved-and-read-back、upload_dispatch_state=not-sent和next_action=review-original-file。stdout是结果摘要，不是可直接上传的原请求文件。

`--timeout-ms` 为1至2147483647毫秒，默认180000；使用单调准备期限，在本地读取结束及远程读取前后检查。只读网络等待有剩余预算，迟到结果不会继续保存；本地文件I/O始终等待结算，故这不是硬性的整命令墙钟上限。开始保存前再次检查身份到期和期限；保存开始后不与超时/到期竞速，完整等待保存、清理尝试与最终读回。保存后会话到期不会删除原文件，也不授权后续上传。

保存失败返回ARTIFACT_PREPARATION_SAVE_FAILED，保留output_path/save_phase和有待清理时的temporary_path/temporary_state；最终读回失败返回ARTIFACT_PREPARATION_READBACK_FAILED、published-unconfirmed及输出/临时路径。清理只针对本次拥有的临时文件；不删除或替换最终目标。失败时检查已报告路径，不把失败理解为可以直接生成另一请求；成功但cleanup_pending=true也需检查临时路径。所有准备路径都不发送上传、不查询上传回执或自动重试。

明确审阅保存的文件之后，可按其操作使用以下既有命令（示例未执行）：

```text
workctx artifacts create --json-file NEW_ORIGINAL.json --file CONTENT
workctx artifacts put-version --json-file NEW_ORIGINAL.json --file CONTENT
workctx artifacts receipt --json-file NEW_ORIGINAL.json
```

上传结果不明时保留原文件、原键与版本，用原回执入口查询；不重新prepare以替换未知请求。CLI增量没有新增依赖或迁移；SDK准备与本地检查由后续源码增量补齐，MCP准备另有后续源码，专用失败副本恢复仍缺；仅源码文档人工审阅，未编译、类型检查、测试、执行CLI/SDK/Mock/API/数据库或发布。文件系统兼容、失败恢复、身份变化与上传衔接均无运行证据，R-001仍未完成。

## CLI 原请求离线核验（源码阶段）

2026-11-04：新增 `workctx artifacts inspect-request --json-file ORIGINAL.json`，可选 `--file CONTENT`，有内容时才可指定 `--max-bytes N`。必填原文件，拒绝stdin、内联JSON、重复选项、未知参数和额外位置参数。HTTP CLI在项目/令牌读取前进入本地处理；嵌入CLI只取调用trace，不访问router或用当前身份改写文件。两入口共用处理函数；没有Gateway/API/MCP新路由，也没有数据库访问或文件写入。

原文件按普通文件稳定读取规则核对同句柄长度/mtime/ctime及额外字节，最多1 MiB，严格UTF-8解码，完整解析 `{ identity, command }` 后再次限制规范结果大小。创建与追加均保留五项原身份、原键、内容描述符、全部创建元数据或原artifact_id/expected_version；prepare成功摘要、检查结果封套或回执响应不作为原文件接受。无效请求返回ARTIFACT_REQUEST_INVALID，不尝试修复字段或生成替代请求。

提供内容时，按原command.size精确读取并核对SHA-256；内容默认最多64 MiB，`--max-bytes` 接受0至1 GiB十进制整数（含零字节）。长度/预算/读取期间变化按既有文件错误拒绝，摘要不符为ARTIFACT_HASH_MISMATCH。未提供内容时，不依据命令中的sha256/size推断内容已经核验；无内容的检查也不将默认内容预算施加到原描述符。所有文件I/O等待结束，没有隐藏后台读取或取消后继续写入。

成功返回status=locally-valid、original_file/request_bytes、完整original，以及两个不同用途的SHA-256：request_sha256覆盖实际文件原字节（包括空白/BOM等），可与prepare保存摘要人工比对；canonical_request_sha256覆盖共享解析器规范化后请求的UTF-8 JSON，同一规范命令不因外层空白/字段排列不同而变化。两个摘要都不是签名、身份认证或持久回执。source_refs为空，不以用户文件伪造已确认服务器来源。

content_state为not-checked或matches-original；仅后者返回本次选择的content_file。identity_state固定not-authenticated、server_outcome固定not-checked、upload_dispatch_state固定not-sent（仅指本次检查），不检查当前版本、会话有效期、权限、存储健康或历史上传结果。成功退出0只确认所选本地检查完成，文件/内容可能在检查后变化，也没有双文件原子快照。失败没有部分成功结果，保持原文件；参数用法错误退出2，其他错误退出1，既有文件上限/长度检查可能归为USAGE_ERROR。

以下示例仅作使用说明，未执行：

```text
workctx artifacts inspect-request --json-file NEW_ORIGINAL.json
workctx artifacts inspect-request --json-file NEW_ORIGINAL.json --file report.pdf --max-bytes 67108864
```

也可选择prepare报告的已发布文件或保留临时文件进行检查；检查通过不证明它就是预期来源，须核对原身份/命令及此前保存的摘要。检查结果中的original供审阅，整个stdout封套不能交上传入口；后续继续使用原JSON文件和完全相同内容。曾经上传而结果不明时，仍需用原文件查询artifacts receipt，不自动prepare、改版本或重新上传。本增量不恢复/移动/补存/清理文件，无新依赖或迁移；只有源码文档人工审阅，未编译、类型检查、测试、执行CLI/SDK/API/数据库或发布，运行证据仍待补。

## SDK 原请求准备（源码阶段）

2026-11-04：新增 `WcpClient.prepareArtifactUpload(draft, content, options?)`，导出 `WcpArtifactPreparationOptions`、`WcpPreparedArtifactUpload` 与 `ArtifactUploadDraft/ArtifactReceiptQuery` 类型。contracts新增 `ArtifactUploadDraft/parseArtifactUploadDraft`，CLI prepare同步使用；草稿格式与上面的创建/追加示例相同。拒绝旧identity/command/request_key/idempotency_key/hash/size，追加版本必须显式提供，既有完整写命令和HTTP协议不变。

准备只接受非共享ArrayBuffer上的Uint8Array，在第一次异步等待前完整复制内容并捕获有界规范草稿；后续修改调用方对象或字节不影响本次准备。SharedArrayBuffer内容拒绝；最大内容预算默认64 MiB，max_bytes接受0至1 GiB安全整数，零字节允许，读取上传身份后还须满足其max_bytes。不是流式大文件接口；调用方分配及并发调用没有全局内存上限。

options只接受普通对象自身数据属性max_bytes/timeout_ms/signal，拒绝未知字段、访问器或继承配置；timeout_ms默认180000，范围1至2147483647。SDK上下文不能继承idempotency_key/expected_version/if_match，避免把旧写条件带入新准备。缺Web Crypto SHA-256或安全随机能力时在网络读取前拒绝，不降级到非加密摘要。原上下文scope及可选账号/客户端约束固定，上传身份复用16 KiB完整校验及到期检查；追加元数据使用原完整身份前置头、2 MiB有界JSON、目标/范围/trace/版本完整校验。restricted创建要求对应读取能力，追加要求实际artifact.read，并匹配明确审阅版本与当前restricted权限提示。

共享单调预算覆盖身份读取、内容摘要、追加元数据和最终原请求摘要；各次等待带signal，完成后检查期限及身份到期。只读transport/Web Crypto底层可能在取消/超时后继续结算，迟到读取不会推进后续步骤；已经开始的摘要不能强行停止。不是上传、版本预留、权限锁、存储健康检查或结果回执。Fetch自身期限仍独立生效，自定义transport仍需实现有界JSON和signal，其预先分配对象不受此接口全局限制。

在全部输入/读取校验后以同长度占位键确认完整请求不超过1 MiB，再分配一个workctx-artifact-ULID新键，生成request_json及其UTF-8 SHA-256。最终摘要或到期检查失败会丢弃本次内存结果，可能已生成的键没有保存或上传，不自动另生成键。成功返回data.original、request_json/request_bytes/request_sha256、identity_observed_expires_at，local_state=prepared-not-saved、upload_dispatch_state=not-sent、next_action=save-and-review-original；source_refs为空。没有文件访问、自动上传、回执查询或重试。固定错误不回显底层异常/响应细节，retryable=false。

调用方须把request_json按UTF-8保存为完整原请求文件（不要保存整个结果封套，也不要双重JSON编码），并核对字节摘要和内容后，再显式提交原请求。下例只展示准备，未执行：

```ts
const prepared = await client.prepareArtifactUpload(
  {
    operation: 'artifact.create',
    name: 'notes.txt',
    mime: 'text/plain',
    classification: 'internal',
    source_refs: [],
  },
  new TextEncoder().encode('Meeting notes'),
  { max_bytes: 1024 * 1024, timeout_ms: 180000 },
);
// Persist prepared.data.request_json and confirm its SHA-256 before any upload.
```

SDK本身不证明调用方已保存或审阅，不保留正文副本供以后重试；后续createArtifact/putArtifactVersion须使用完全相同内容，服务器仍独立核验hash/size。上传及getArtifactReceipt现在始终核对tenant/workspace/project和已配置actor/client；省略的actor/client采用完整original中的值作为请求头前置约束，由Gateway与已认证会话逐项核对。普通字符串账号可不放入SDK构造上下文（其actor仍保留既有ULID校验），原文件不能授予身份或替换已配置身份。下载方法的完整上下文要求不在本增量修改。

SDK准备返回的原文件可由CLI inspect-request检查，并由已有上传/原回执命令读取；已上传而结果不明时应查同一原请求回执，不再prepare替换原键/版本。资料Mock已有只读路由可承接准备，但兼容性未实际运行。MCP准备另有后续源码，调用方文件保存/恢复及运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、执行SDK/CLI/Mock/API/数据库或发布，R-001不标记完成。

## MCP 原请求准备（源码阶段）

2026-11-04：实际Gateway MCP新增 `prepare_artifact_upload({draft,content_base64})`，草稿使用与CLI/SDK相同的ArtifactUploadDraft（新建完整元数据，或artifact_id及明确审阅的expected_version）。只接受这两个字段，拒绝旧原请求包装、身份、键、hash/size、外层写条件、继承的idempotency_key/expected_version以及额外字段；不自动改成当前版本。

工具目录及直接调用均要求有效已认证客户端和实际artifact.write，admin不能代替。annotations为readOnlyHint=true、idempotentHint=false、destructiveHint=false：准备只读服务端，但每次成功生成不同新键，不能自动重试或用于替换已经上传却结果不明的原请求。该操作需要多次只读核验，dispatchMcp使用专用executeArtifactPreparationTool；同步prepareMcpTool拒绝为它生成不完整单一HTTP请求，返回MCP_TOOL_EXECUTOR_REQUIRED，权限不符先DENIED。

输入完整快照最多8 MiB，草稿及最终原请求各最多1 MiB；Base64字符串上限为4*ceil(4 MiB/3)，原生解码后重新编码必须完全一致，拒绝空白、URL字母表、缺失padding及非零padding bits。解码内容最多4 MiB，同时不超过server gate.maxBytes和上传身份max_bytes，空内容允许。取得名额后同步捕获规范草稿、字节数和Node SHA-256，再开始异步读取，调用方后续改输入不影响结果。不保存或返回正文；没有文件系统访问和上传写路由调用。

通过同一ApiGateway.handle读取上传身份与可选当前元数据，保留认证/Policy/授权审计边界，固定原可信上下文副本并逐步检查到期。身份响应最多16 KiB并与完整可信身份/期限/能力精确比对；元数据响应最多2 MiB并核对目标/范围/trace/版本。创建restricted要求restricted读取能力；追加要求实际artifact.read，restricted资料额外核对权限，当前版本必须等于草稿中的expected_version。HTTP状态/JSON媒体类型/响应trace均检查，错误响应最多16 KiB，未知/损坏/异trace封套返回固定GATEWAY_RESPONSE_INVALID，不输出底层细节。

所有准备与实际上传共用两路容量（HTTP同时与multipart共用）；大正文的已持有名额只转交一次，小正文及嵌入在解析/解码之前取得名额。准备从执行器入口开始单调30秒本地期限，每步检查身份和期限，超时返回MCP_ARTIFACT_PREPARATION_TIMEOUT，底层api.handle未结束继续占槽，直到其结算finally释放；迟到结果不进入后续准备。没有底层强制取消承诺，期限不涵盖前置HTTP正文读取与最终网络发送，不证明客户端收到结果。同步有界解析/摘要不能被计时器抢占，但后续期限检查会拒绝超时结果。

用同长度占位键先构造完整结果检查容量，再分配一次workctx-artifact-ULID，重新完整解析并计算规范JSON摘要；安全随机能力缺失明确拒绝。最终业务封套最多3 MiB+16 KiB，包含text的MCP转义结果最多6 MiB+36 KiB，超限整份拒绝，不截断。JSON-RPC外层由原协议包装，以上结果限额不包含外层id等字段。成功data与SDK准备一致：original、request_json/request_bytes/request_sha256、identity_observed_expires_at、local_state=prepared-not-saved、upload_dispatch_state=not-sent、next_action=save-and-review-original；source_refs为空，不伪造已保存Artifact引用。原请求生成后若最终到期或封套失败，丢弃结果，没有持久保存或上传。

示例仅说明输入，未调用工具（空内容示例）：

```json
{
  "draft": {
    "operation": "artifact.create",
    "name": "empty.txt",
    "mime": "text/plain",
    "classification": "internal",
    "source_refs": []
  },
  "content_base64": ""
}
```

工具客户端须把request_json作为原UTF-8 JSON保存并核对摘要，不能保存整段MCP/业务封套或双重编码字符串。审阅后才明确将完整original与相同content_base64交create_artifact/put_artifact_version；状态未确认时继续用原文件get_artifact_receipt，不再prepare替换原键/版本。当前准备不预留版本、检查存储健康、确认上传权限未来有效，也不证明客户端已保存。无新SDK依赖、schema或迁移；仅源码文档人工审阅，未编译、类型检查、测试、执行MCP/API/SDK/数据库或发布，客户端/大正文/超时/并发及存储衔接均无运行证据，R-001保持未完成。

## SDK 元数据与原回执有界读取（源码阶段）

三个既有入口保留返回封套，新增可选 `WcpArtifactReadOptions`：

```ts
const current = await client.getArtifact(artifactId, { timeout_ms: 30_000, signal });
const historical = await client.getArtifactVersion(artifactId, reviewedVersion, { signal });
const receipt = await client.getArtifactReceipt(savedOriginal, { signal });
```

示例只说明接口，未执行。`timeout_ms` 为1至2,147,483,647的安全整数，省略时30,000；选项仅接受timeout_ms/signal的普通数据属性，拒绝未知字段、访问器和符号。调用开始同步捕获配置、范围/trace、查询和完整原请求，随后创建本地异步等待预算。它不是同步输入校验的硬墙钟上限；Fetch transport自身期限仍独立生效。预先取消不派发读取；到期或取消后不接受迟到结果，不自动重试。

当前与固定历史元数据使用bounded-json GET，完整成功响应最多2 MiB；原回执使用bounded-json POST，原请求输入及规范副本各最多1 MiB，成功响应最多4 MiB；Fetch错误最多16 KiB。自定义transport返回的结果也须通过有界普通JSON快照与共享完整解析，拒绝超限、访问器/循环/非JSON对象、错误范围/目标/版本/trace和不匹配回执，不返回部分结果。transport须实现bounded-json与signal；其自行分配的对象/网络缓冲不受SDK全局内存上限控制。

请求仅附范围、trace和身份前置头，不继承上下文中的幂等键、If-Match或写条件。元数据查询附已配置的actor/client约束；原回执核对三层范围及所有已配置身份约束，始终从保存original发送完整原账号/客户端前置头供Gateway核对。请求正文与本地回执验证期望分别复制，即使transport修改正文也不会改变本地原请求判断。读取不重新准备原请求、不换键、不刷新原版本或上传内容。

成功元数据保留current/historical与content_state=not-checked；原回执保留recorded/not-observed及原历史版本语义。失败只返回同trace的有限错误码、固定消息、retryable=false和本次只读状态，不透出上游异常详情；原回执错误明确not-confirmed-by-this-read。not-observed、取消、超时、权限拒绝或响应损坏均不证明此前上传失败，也不授权新键重发。upload_dispatch_state=not-sent仅描述这次读取，不描述此前上传。

SDK导出WcpArtifactReadOptions、ArtifactReadDetail、ArtifactMetadataView和ArtifactReceiptEnvelope。既有downloadArtifactVersion内部历史元数据查询随之获得默认30秒及2 MiB限制；其内容阶段和max_bytes接口不变，没有增加整个下载的超时/取消能力。Mock既有读取路由源码支持这些transport选项，尚无执行证据。

本增量只有源码文档和人工审阅；没有服务端协议、schema或依赖变化，未编译、类型检查、测试、执行SDK/Mock/API/数据库或发布。实际传输、取消/迟到、数据隔离和兼容性证据仍待补。

## SDK 上传身份读取（源码阶段）

2026-11-04：`WcpClient.getArtifactUploadContext({timeout_ms?,signal?})` 接入既有 GET /v1/artifacts/upload-context，导出 `WcpArtifactUploadContextOptions` 和 `ArtifactUploadContextEnvelope`。返回当前可信五项 identity、expires_at、max_bytes、can_read/can_read_restricted；不生成请求键、不选择文件、不预留版本，也不检查对象存储健康。调用方必须另行保存并审阅新上传的完整原请求；恢复旧请求时禁止用新身份替换原身份。

调用时捕获SDK上下文，要求固定项目和有效trace；已设置的actor/client作为请求头前置约束并与响应再次核对。未设置时可以读取当前会话身份，普通账号字符串遵守资料身份契约，不强制将响应账号转为ULID。WcpClient构造上下文仍沿用既有ULID规则，本增量不修改该公共约定。

不继承上下文中的幂等键、If-Match或expected_version；无正文与查询参数。默认本地等待30秒，timeout_ms允许1至2147483647的安全整数，signal沿用共享请求期限机制。预先取消不派发，期限覆盖自定义transport等待及响应校验；结束后清理定时器与取消监听。不自动重试、缓存或保存；停止等待不保证远端请求及其授权决定审计被撤销。

请求使用bounded-json，成功正文最多16 KiB，Fetch错误正文沿用16 KiB。共享响应解析前再次有界复制纯JSON，因此自定义transport不能返回超限封套、访问器/循环/额外字段等非契约数据；返回值独立于transport原对象。完整核对schema/trace/空source_refs/三项范围/五项身份、规范日期、0至1 GiB整数上限和布尔提示，并拒绝已过期会话及不匹配的已绑定actor/client。

已知同trace错误仅保留错误码，使用固定消息且retryable=false；未知错误或异trace错误统一GATEWAY_UNAVAILABLE，不回显远端详情。无效/过期响应为GATEWAY_RESPONSE_INVALID。自定义transport须执行bounded-json的读入字节限制和signal；SDK返回后的复制检查不能替代读入过程限额。权限提示不证明项目可读、分类可导出或后续上传一定成功。

现有资料Mock无需新增路由即可支持该方法。仅源码文档人工审阅，未编译、类型检查、测试、执行SDK/Mock/网关/数据库或发布。身份约束、取消/期限、大小边界、错误归一化及真实transport兼容仍待运行证据，R-001不标完成。

## CLI 与 MCP 上传身份读取（源码阶段）

2026-11-04：新增 `workctx artifacts identity [--timeout-ms 30000]` 和 MCP `get_artifact_upload_context({})`。只返回既有上传身份封套；不读取或写入文件、不生成请求键、不执行上传、不准备完整原命令，也不替换旧请求的identity/request_key/expected_version。能力提示不能证明项目可读、文件可导出、存储健康或后续上传成功。

CLI使用既有WORKCTX_URL、Bearer令牌与tenant/workspace/project配置，普通HTTP路径复用SDK `getArtifactUploadContext`，成功输出完整JSON封套。仅允许可选一次timeout-ms，1至2147483647的规范正整数；拒绝JSON/JSON文件、键、文件路径、输出路径、额外位置参数和重复选项。默认30秒本地预算，成功及Fetch错误16 KiB，无缓存/重试。内嵌runWorkctx路径复制可信上下文，删除继承的幂等键/版本，以同一空输入调用router.execute；共享结果校验器核对全部五项身份、规范到期时间和两个读取能力提示。SDK上下文只传范围与trace，因此可信账号可以是资料契约允许的普通字符串，不冒充客户端输入的账号。

Gateway抽取canReadArtifactUploadContext和artifactUploadContextAuthority，真实REST行为仍要求authenticated_client=true、有限未过期token_expires_at和实际artifact.write；admin不代替。新增ARTIFACT_UPLOAD_CONTEXT_INVALID表示可信身份无法表示，SDK和MCP均使用固定错误消息。artifactUploadContextResult先有界复制再完整解析，并与原可信authority比较；max_bytes只能从服务端响应获取，仍受共享0至1 GiB规则约束。现有注册处理器复用authority，不改变上传协议或存储写入。

MCP工具发现与直接调用都检查上述权限，标为只读、非破坏性，无需请求键。参数只能是普通空JSON对象；禁止通过参数传入identity、范围、timeout或写条件，范围来自认证上下文。专用执行器删除继承写条件，以原可信上下文的独立副本调用既有GET路由，再核对HTTP状态、content-type、trace、完整响应以及原身份/到期/能力提示。

每个ApiGateway独立最多两笔MCP上传身份读取，默认30秒单调本地等待期限，参数/成功/错误封套各最多16 KiB，二次JSON转义结果最多36 KiB。超过容量返回MCP_ARTIFACT_CONTEXT_BUSY，超时返回MCP_ARTIFACT_CONTEXT_TIMEOUT；超时底层读取未结束仍占名额，直到其finally完成，迟到结果不发布。底层无取消承诺；此期限不覆盖HTTP外层最终发送，也不替代入口现有请求体限制。已知同trace错误只保留码和固定消息，未知/异trace/损坏响应统一GATEWAY_RESPONSE_INVALID，不回显底层详情。所有失败retryable=false，无自动重试。

沿用既有Policy/OPA与授权决定审计；没有新增审计事件、数据库、文件落盘或上传副作用。独立的apps/mcp-gateway通用注册容器保持原行为；本工具接在实际API Gateway MCP目录与协议入口。仅源码文档人工审阅，未编译、类型检查、测试、执行CLI/MCP/SDK/API/数据库或发布。CLI严格参数、HTTP与嵌入路径、MCP目录及直接调用、身份/期限/权限提示不匹配、容量/迟到结果和真实运行兼容仍待证据。

## 工作台新请求准备（源码阶段）

新增 `GET /v1/artifacts/upload-context` 与 `artifact.upload-context`，无输入字段、查询参数或写入前置头。必须是已验证客户端、实际 artifact.write、具有有限且未过期的 token_expires_at；admin 不能代替该能力。通过现有 artifact.write Policy/OPA 和授权决定审计，返回 schema_version/trace/source_refs=[]，data 为自身 identity、规范 UTC expires_at、服务器 max_bytes、can_read 与 can_read_restricted。共享解析器核对完整字段、项目、trace、日期、布尔能力提示及 0–1 GiB 上限；不返回 token、存储键、对象内容或其他账号身份。

该接口不生成命令键、不创建 Artifact、不检查存储健康或预留并发/版本。能力提示来自本次会话，不能替代后续项目/分类/策略与存储检查；即使持久 writer 尚未配置也只描述调用者，不宣称上传可成功。静态路由优先于 Artifact ID 模板，原元数据读取行为保留。

工作台新增 `/artifacts/upload/new`；无参数准备新文件，唯一可选 artifact 参数必须是单一合法 ID，用于准备已有文件的下一版本。文件主页、新上传/旧请求页及记录详情新增入口；从历史详情进入也重新读取当前记录，不把历史版本自动当作当前条件。页面始终提供旧请求恢复入口；准备读取失败时不隐藏恢复路径，也不生成草稿或改用旧记录。

服务端一次捕获会话与 Gateway 地址，以同一令牌读取 upload-context；追加时再读取指定当前元数据，并附已确认账号/客户端前提。两次读取合计 30 秒，context/错误最多 16 KiB，当前元数据最多 2 MiB；限制重定向、缓存与错误回显，完整封套绑定项目/目标/trace。追加准备还要求实际 artifact.read 和当前分类可见性，不回退历史/其他文件；会话或 context 到期时拒绝继续。浏览器只接收公开准备信息，不接收令牌。

新建表单编辑名称、无参数 MIME、分类和 0–200 条来源（type/id/可选非负安全整数 revision/可选 URI）；字段遵守原创建契约，restricted 选项依赖读取受限数据的提示。来源只记录用户审阅的引用，不自动访问或验证其可用性。追加表单展示当前目标名称/分类/版本，原 expected_version 固定为该次读取值；名称/MIME/分类/来源不在追加命令中重写。

选择内容后按 min(64 MiB, context.max_bytes) 有界读取，使用 Web Crypto 计算 SHA-256，保留独立 Blob 和长度/hash；零字节内容也有完整描述。文件名和合法 File.type 仅作为可修改的新建字段初值。准备前后检查会话期限，读取期限 120 秒；取消/离开/缓存恢复/卸载抑制迟到结果并释放准备状态，原生散列返回后仍检查取消。期间不发送内容或自动上传。

用户明确点击 Prepare original request 后先校验完整资料、来源、目标版本和 JSON 大小，再生成一次 `artifact_web_<UUID>` 请求键。新请求的 identity 来自可信准备响应，size/hash 来自已读内容，append 条件来自固定目标；规范 JSON 仍最多 1,000,000 字节。渲染、失败重读或导入原请求不会生成键，版本耗尽或参数无效不创建可提交请求。准备成功后组件同页交接原 JSON 和已校验 Blob 至既有上传表单，旧准备组件卸载；原文件无需再次读取。

交接后只能审阅/导出原 JSON、明确确认保存并提交、查询回执；未保存请求的浏览器磁盘状态无法由应用证明，导出动作不冒充实际落盘完成。原键/版本不随后续读取、会话变化或未知结果改变；已有上传/回执状态机继续阻止自动重试。用户需要不同内容或条件时单独打开新准备页，旧请求恢复必须使用导入入口，不能用新键替代未确认请求。

无新依赖/迁移，016–045 未执行；新增的是只读准备接口与客户端源码，持久写事务及上传协议不变。未编译、类型检查、测试、执行上传、浏览器/服务运行或发布；权限、并发版本变化、原键恢复、Next/浏览器兼容性仍缺运行证据。

## MCP 下载（源码阶段）

`download_artifact_version` 使用明确的 artifact_id/version/sha256/size；调用者先读取 get_artifact_version 并保留所选描述，不把当前元数据自动替换为历史参数。输入只含四个字段，禁止写入条件或身份覆盖。目录和调用均要求实际 artifact.read、已验证客户端和未过期会话；清理继承键/版本，复制请求后复用原 content GET 对应的 artifact.download 操作，当前/历史权限、导出策略、大小/hash 和持久 release 审计继续有效。

MCP 内嵌正文最多 4 MiB，同时受服务器较小配置上限约束；HTTP/SDK/CLI 保留自己的上限。完整交付封套校验后独立计算 SHA-256，才生成两项工具 content：公开元数据/固定版本来源/审计/交付状态的文本摘要，以及 MIME 固定为 application/octet-stream 的 base64 blob resource。`urn:sha256:<hash>` 仅标识内嵌内容，不是远程地址或授权令牌，不提供 resources/read/list 中的文件下载入口，也不透露存储键。历史内容明确为 untrusted-reference；客户端交付始终 not-confirmed，不自动保存或执行内容。

HTTP MCP 与二进制 GET 共用 ArtifactDownloadGate 的两路名额，处理失败立即释放，成功持有至 JSON 响应 finish/close/error；发送阶段期限 60 秒，连接提前关闭不无限保留名额。直接 dispatchMcp 使用按 ApiGateway 实例的两路内嵌限制，返回后释放，宿主可传入共用 gate/retain 接管发送生命周期。每次显式下载独立审计，不自动重试、降级或缓存字节。错误只返回 isError 文本；封套确认过的 audit_id 在后续完整性/编码失败时保留，其余派发后失败不假定没有放行记录。

无新依赖或迁移；只改源码与文档，未编译、类型检查、测试、实际下载、运行或发布，016–045 未执行。官方协议资料检索没有可读返回，内嵌 blob 在各声明协议版本/客户端的兼容性、发送与失败路径证据仍待核对。详细参数和结果说明见 [MCP 运行时](mcp-runtime.md)。

## 工作台下载（源码阶段）

`/artifacts` 的当前/历史详情增加 Download version 面板。页面加载只查询元数据，Fetch this version 才发送下载请求；选择固定为本页展示的 artifact_id/version/sha256/size 和 tenant/workspace/project，即使当前记录推进也不替换版本。64 MiB 以上只展示上限说明；其他下载仍受 Gateway 自身配置限制。支持取消，错误保留所选版本，重试必须再次明确点击。内容全部验证后才生成临时 Blob URL，用户另点 Save file 发起浏览器保存；文案只称“已请求保存”，不声明本地落盘完成。

新增工作台本地 `POST /artifacts/download`，不新增 Gateway 公共操作。请求 JSON 为 `{ query: { artifact_id, version, sha256, size }, scope: { tenant_id, workspace_id, project_id } }`，不接受额外字段。要求 Origin 等于 WEB_CONSOLE_URL 的 origin、提供 JSON Content-Type、`x-workctx-artifact-download: 1` 和本次随机 `x-trace-id=trace_web_download_<UUID>`；如有 Sec-Fetch-Site，必须为 same-origin。拒绝 URL 查询、范围/条件缓存/写入头及 Content-Encoding，不提供 GET 下载或跨源允许头。WEB_CONSOLE_URL 须配置为浏览器实际访问的 origin；浏览器不接收 Gateway bearer token。

路由先读取一次有效签名会话快照，再有界解析最多 16 KiB 的 UTF-8 JSON 并核对页面 scope，项目不符不联系 Gateway。原会话令牌和范围用于两个无缓存、拒绝重定向的请求：最多 2 MiB 的指定历史元数据，以及绑定选定 hash/size 的 content GET。当前/历史权限与导出策略仍由 Gateway 独立验证。严格核对元数据封套、内容响应头、长度及 Node SHA-256 后才输出附件；响应固定 application/octet-stream、id-vN.bin 文件名、private/no-store/no-transform、identity 编码和 nosniff，不转发任意上游响应头、存储地址或令牌。

工作台路由每进程最多两路，名额覆盖输入读取、上游访问和返回流消费；正文输入期限 15 秒、上游两次请求合计期限 150 秒、返回流期限 60 秒。返回流按 64 KiB 分块，不采用未校验内容的直通流；本地流消费完、取消、失败或超时释放名额，流消费不证明远端客户端保存完成。浏览器为本次操作单独设置 180 秒期限，支持取消与页面离开中止；这些期限不替代 Gateway、数据库或对象服务自己的限制。

浏览器再次核对完整 200、本次发送的 trace/范围/版本/hash/size/审计头和实际有界正文，使用 Web Crypto SHA-256 校验后才开放 Save file。没有校验能力时显示说明并且不发送请求；不将历史文件内容作为网页/脚本渲染。获取中的按钮互斥，临时 URL 在主动丢弃、组件卸载、pagehide 或页面缓存恢复时撤销，不保存到 localStorage/IndexedDB/outbox；原文件只通过显式浏览器下载保存。离开后的读取/校验结果不能重新挂载临时链接。

错误 JSON 仅包含本次 trace、有限 reason、audit_state 及已确认时的 audit_id，拒绝输出上游原始错误细节。正文请求派发前为 not-requested，派发后未确认记录为 unconfirmed；成功响应头确认的 release 审计在后续内容校验失败时保留。UI 将放行审计、内容已核验、浏览器保存请求分开展示；取消或网络失败不证明服务端未处理，也不自动重发。无新依赖/迁移，016–045 未执行；未编译、类型检查、测试、浏览器渲染、服务运行或实际下载/保存。Next 路由/浏览器/代理兼容性及中断场景仍无运行证据。

## 快照、完整性与旧数据


045 为 `wcp_artifact_versions` 增加可空 `metadata_snapshot`，并创建 `wcp_artifact_command_receipts`，回执通过 Artifact ID/版本外键关联历史记录。每个新版本存储完整 scope、名称、媒体类型、分类、来源、hash/size/key、版本/ETag、trace 和创建/更新时间。

读取核对当前行与最新快照、版本行与目标快照的 hash/size/key/trace/保存时间，并校验范围、版本及 ETag。历史元数据缺少可信快照时返回 `ARTIFACT_LEGACY_UNVERIFIED`；不把当前分类、来源或名称补造为旧版本证据。迁移不回填旧快照，旧数据导入/升级方案另行开发。

正文读取在授权事务完成后访问对象，代表该次授权快照，不持有整个下载期间的权限锁。对象缺失、读取失败、超限、hash/长度不符分别拒绝，不返回未核对的字节。

主要错误包括 `INVALID_INPUT`、`ARTIFACT_ACCESS_DENIED`、`ARTIFACT_NOT_FOUND`、`ARTIFACT_VERSION_NOT_FOUND`、`ARTIFACT_VERSION_CONFLICT`、`IDEMPOTENCY_KEY_REUSED`、`ARTIFACT_LEGACY_UNVERIFIED`、`ARTIFACT_STORED_INVALID`、`ARTIFACT_STORAGE_UNAVAILABLE`、`ARTIFACT_OBJECT_UNAVAILABLE`、`ARTIFACT_OBJECT_MISSING`、`ARTIFACT_TOO_LARGE` 和 `ARTIFACT_HASH_MISMATCH`。已解析身份的错误封套携带当前 trace。

## 尚未完成

PostgreSQL/S3 适配、显式服务器配置、HTTP/SDK/CLI/MCP/工作台按原请求上传、可审计下载、元数据与原回执查询及CLI/SDK/MCP/工作台新请求准备已有源码，尚未运行验证；S3 签名、条件写入和 MinIO 版本兼容性仍缺证据。下载处理阶段失败与 HTTP/MCP 发送观察已有源码，观察 outbox/丢失补偿和客户端收取/保存回执仍缺；事件 outbox、健康状态、保留与清理、流式大文件、旧数据升级、备份恢复与运行证据均待后续开发。没有签名下载链接，也不生成虚假的 audit_id。P2-01/R-008 保持未完成。

## 工作台查询（源码阶段）

另有 `/artifacts/receipt` 原回执查询页，从元数据页新标签页打开。支持粘贴 JSON 或选择 UTF-8 请求文件，输入仅接受已保存的 `{ identity, command }`；正文与规范化结果均限制 1,000,000 UTF-8 字节。文件读取前检查大小并拒绝无效 UTF-8，字段通过共享解析器校验；导入仅准备本页请求，不发送网络调用。页面展示原身份、键、内容描述及原创建/追加参数，加载后保持固定，另一个请求在新标签页打开。

显式 Check original receipt 经 Server Action 调用 server-api，只读取 `/v1/artifacts/receipt`；FormData 只能包含一个 request 文本，服务端再次校验大小/字段。Gateway 请求绑定原范围与账号/客户端前置头，不携带写条件；完整回执在服务端和浏览器均校验。UI 不从浏览器导入身份授予权限，不要求查询前刷新当前 Artifact，不把当前版本替换进原命令。浏览器导入的原客户端如果与当前登录客户端不同，Gateway 拒绝查询。

查询状态分为 recorded、not-observed 和读取错误；只有匹配的 recorded 展示原成功版本。not-observed、登录/权限/不可用/指纹冲突/缺历史快照/损坏响应保持原请求，均不确认原请求失败。读成功后提供原历史/当前元数据的新标签页入口；正文始终未检查。导入/查询互斥，不自动重试或上传；原 JSON 可下载或展示复制，导出只包含请求字段。页面不把请求写入 URL、浏览器存储或 outbox，重载/关闭后由用户重新导入已保存 JSON。无新 API、依赖或迁移，尚无浏览器渲染、编译、类型检查、测试或运行证据。

侧栏新增 Files & artifacts，进入 `/artifacts`。无参数时仅显示查询说明和两个 GET 表单；当前查询提交 `artifact`，历史查询提交 `artifact/version`。页面只接受这两个参数，拒绝重复字段、未知字段、非 ULID、空版本、前导零、指数表示及非正安全整数。非法历史参数不会降级为当前读取；查询失败保留查找入口。

`getWorkbenchArtifact` 使用当前登录会话的服务端 Gateway GET，复用无缓存请求和完整共享封套校验，绑定目标、版本、范围与本次 trace。页面展示名称、媒体类型、分类、精确字节数、版本及保存时间；来源 URI 仅作为文本展示。当前与历史记录可通过明确的新标签页链接相互查看，历史详情不作为当前写条件。保存的 hash/ETag、范围与原记录/本次读取 trace 放在可展开详情中。

缺少完整历史快照、记录不可用和服务不可用分别提示；登录、权限及其他错误沿用工作台错误组件。元数据面板标明该次查询只读取记录、来源当前可用性未检查，不确认原上传结果。下载由上面的独立面板明确发起，回执由单独页面查询；仍不提供目录枚举、自动重试或上传。根忽略配置仅放行新页面源码目录，生成产物忽略规则保留。当前无浏览器渲染、编译、类型检查、测试、服务或发布证据。

## 下载失败与发送观察审计（源码阶段）

既有 artifact.download.release 和 artifact.download.denied 持久审计保持原语义，release 确认仍是出正文的前置条件。新增 artifact.download.failure.<stage>：metadata-read、metadata-validation、descriptor-validation、authorization、storage-read、content-validation、recheck、release-audit、denied-audit；只记录已进入下载处理且完成输入、reader/sink 配置检查后的失败。正常权限拒绝沿用 denied，不重复记 failure；拒绝审计失败单独记 denied-audit。最初未认证、无效参数、容量/配置拒绝仍由既有授权/请求错误路径处理，不声称本增量覆盖所有失败。处理入口同时明确拒绝已到期会话。

二进制 HTTP 与 HTTP MCP 共用发送观察器，新增 artifact.download.transport.<http|mcp>.<finished|closed|error|timeout>。finish 或 writableFinished 仅表示服务端把响应交给传输层；提前 close、发送异常、60 秒发送期限分别记录 closed/error/timeout。首个终态只结算一次并清理本次监听器/定时器，发送名额先释放，补充审计再处理。同步写头/发送异常也按 error 结束并关闭响应。MCP 在封套确认后的 hash、编码或交接异常另记 failure.adapter-validation；直接嵌入调用没有 HTTP 传输事实，不补造 finished。

补充记录只使用可信调用身份/范围/trace、调用方请求的目标和长度，以及有限阶段/结果，不记录内容、hash、存储键、凭据、异常文本或隐藏元数据。resource 是请求目标，不证明记录存在；没有已确认 release 时 source_refs 为空。已有 release 的观察用 type=audit 的 source_ref 关联原放行记录。全部补充记录保守标记 restricted，沿用审计分类读取规则；details 仅保留数字/布尔值，release_audit_confirmed=false 表示未持有确认，不证明没有放行记录。delivery_confirmed 始终为 false，API 下载封套与响应头仍只报告原 release。

观察 sink 复用现有持久 audit_persist，每实例最多 8 个在途写入、每次最多等待 5 秒，无队列或重试。超时写入的名额直到实际 sink 结束才释放，挂起 sink 不会累积无限后台任务；容量满时跳过本次补充观察。失败/超时/跳过不改写原始下载错误、不回收已发送字节，也不冒充持久确认。on_audit 仅在持久写入返回后调用；内存记录、缺少终态或缺少回调都不能证明持久写失败或客户端未收取。进程退出、sink 故障时可缺记录，持久 outbox/补偿、客户端收取/保存回执仍未实现。

本次只修改源码与文档，没有新增依赖/迁移；016–045 仍未执行。未编译、类型检查、测试、运行服务、实际下载或发布，发送事件顺序、持久失败及客户端兼容性均无本轮运行证据。
