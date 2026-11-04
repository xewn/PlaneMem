# 资料上传与版本历史内存 Mock

日期：2026-11-04。仅源码和文档人工审阅；未编译、类型检查、测试、执行 SDK/Mock/API/数据库或发布。本文记录开发约定，不作为运行兼容性证据。

## 接线与权限

SDK 导出 `MockArtifactStore`、`MockArtifactSeed`、`MockArtifactSession`、`MockArtifactDownloadAccess` 和 `MockArtifactDownloadRelease`。store 初始为空，固定一个 tenant/workspace/project；不同模拟账号可通过 `connect(session)` 共享该 store，或配置 `new MockWcpServer({artifacts:{store,session}})`。未配置 artifacts 时原 Mock 路由保持。

```ts
const store = new MockArtifactStore({
  scope: { tenant_id, workspace_id, project_id },
  max_upload_bytes: 4 * 1024 * 1024,
  max_download_bytes: 4 * 1024 * 1024,
});
const transport = new MockWcpServer({
  artifacts: {
    store,
    session: {
      identity: { tenant_id, workspace_id, project_id, actor_id, client_id },
      expires_at, // 调用时仍有效的 ISO UTC 时间
      project_readable: true,
      read_artifacts: true,
      write_artifacts: true,
      read_restricted: false,
      download_access: {
        export_data: true,
        export_restricted: false,
        policy_allowed: true,
      },
    },
  },
});
const client = new WcpClient(transport, {
  tenant_id, workspace_id, project_id, actor_id, client_id, trace_id,
});
```

示例中的 tenant/workspace/project/actor 应使用现有契约的 ULID 类型，expires_at 使用调用时仍有效的时间；这符合 WcpClient 的上下文要求。直接 transport 仍遵守资料契约允许的普通账号标识符。

构造和连接配置按有界纯 JSON 复制；未知字段、非布尔权限、不同项目身份或无效时间拒绝。权限只来自固定会话。三项范围请求头必须匹配；已提供的预期 actor/client 头必须匹配，上传和原回执的正文五项身份必须全部匹配。

写入/回执/上传身份要求 write_artifacts；元数据读取要求 read_artifacts。实际记录操作还要求 project_readable；上传身份只描述会话，不证明项目存在或有未来写入资格。restricted 资料要求 read_restricted；创建时拒绝无权写入，读取/追加/重放时按当前可见资料核对。此版本不提供动态权限或删除模拟；来源引用只保存原文，不推导额外来源权限。

## 九条路由

| 路由 | 行为 |
| --- | --- |
| GET /v1/artifacts/upload-context | 返回模拟身份、到期时间、单次上传限制与读取能力 |
| POST /v1/artifacts | multipart 创建 version 1 |
| GET /v1/artifacts | 按名称和分类分页查找当前项目文件摘要 |
| POST /v1/artifacts/{id}/versions | 原 If-Match 版本一致时追加一版 |
| GET /v1/artifacts/{id} | 当前元数据与当前 ETag |
| GET /v1/artifacts/{id}/versions | 固定上界的历史摘要目录，显式分页 |
| GET /v1/artifacts/{id}/versions/{version} | 不可变历史元数据，无外层 ETag |
| POST /v1/artifacts/receipt | 核对完整原上传请求，返回 recorded/not-observed |
| GET /v1/artifacts/{id}/versions/{version}/content | 固定版本二进制内容与模拟释放记录 ID |

现有 `getArtifactUploadContext/createArtifact/putArtifactVersion/getArtifact/getArtifactVersion/listArtifacts/listArtifactVersions/getArtifactReceipt/downloadArtifactVersion` 可通过上述 transport 接线。上传身份专用方法默认30秒期限、支持取消、16 KiB响应限制，并核验完整身份/权限提示/到期时间，详见 [SDK上传身份读取](artifact-persistence-runtime.md#sdk-上传身份读取源码阶段)。下载只模拟进程内内容释放，不能用此实现宣称真实审计、网络传输或客户端收妥已完成。

只有历史目录GET和项目目录GET接受各自的分页/筛选查询参数，其余路由继续拒绝查询参数；所有路由拒绝片段、原始控制字符、错误方法及多余写条件。GET 不接收正文。元数据/回执/目录支持 JSON/bounded-json 响应上限，内容路由必须使用 bytes；Mock 支持 AbortSignal，没有自动重试。

## 项目文件目录

`GET /v1/artifacts`读取同一store既有上传形成的当前版本，与POST创建分别处理。`client.listArtifacts({query?,classification?,limit?,cursor?})`沿已有MockWcpServer配置接入，不增加构造参数、种子或导出类型。URL仅接受单值四字段，limit使用无前导零正安全整数；共享解析将名称去首尾空白，空串省略，长度最多255个JS字符；分类必须是明确枚举值，空串拒绝。默认20最多20，游标保持规范base64url；未知/重复字段、正文、写/缓存/范围条件、transfer-encoding及非零content-length均拒绝。

只有项目目录GET路径上限扩至8192字符，以容纳Unicode名称的百分号编码；解码后的完整查询仍受8 KiB共享限制。其他路由保持512字符上限和原查询规则，创建POST不因此接受查询参数。读取要求固定模拟会话read_artifacts、project_readable和未过期，原范围及可选预期账号/客户端头必须匹配。默认列表排除无权读取的restricted记录；显式restricted筛选而无read_restricted返回ARTIFACT_ACCESS_DENIED。

游标绑定与持久目录相同的artifact-registry-v1命名空间、五项原身份、read_restricted、规范名称/分类和limit，通过Web Crypto SHA-256计算。绑定字段不含正文或凭据；摘要不是签名或权限凭证，也不保证不同store的记录相同。完整next_query用于显式续页，改变账号/客户端/权限/筛选/页大小后旧游标拒绝，须移除cursor重读。仅ASCII A–Z折叠匹配名称字面子串，百分号和下划线不是通配符；分类精确匹配，在分页之前过滤。

每个store独立最多两笔在途项目目录读取，覆盖异步绑定摘要至完整页准备，finally释放；SDK取消或本地期限到达不会提前释放仍等待摘要的名额。摘要不可用在transport报ARTIFACT_INTEGRITY_UNAVAILABLE，SDK按既有固定未知读取错误处理。完成摘要后重新检查取消/会话期限，再同步读取当前状态；扫描既有文件ID键，按C等价字符串倒序和游标排他位置挑选最多limit+1条可见匹配记录。存储仍沿全部上传最多1000条/64 MiB约束，不声明数据库级内存或性能保证。

筛选只使用store自身已验证上传的字段；每条选中项及探测项再在2 MiB内复制元数据，核对完整契约、范围、ID及当前版本Map同一对象，解析16 KiB内摘要。生成has_more及完整next_query后，完整ArtifactRegistryEnvelope核验范围、trace、原查询、条数、ID顺序、筛选、来源和续页。封套最多256 KiB，且服从调用方更低响应限额；任何选中/探测记录无效均拒绝整页，不返回部分成功。

```ts
// 源码用法示例，未执行；文件来自同一store此前保存的上传。
const page = await client.listArtifacts({ query: 'report', classification: 'internal', limit: 20 });
// 只在明确选择下一页时调用，完整保留原筛选和位置。
if (page.data.next_query) {
  const next = await client.listArtifacts(page.data.next_query);
}
// 重新搜索时不携带旧cursor。
const refreshed = await client.listArtifacts({ query: 'report', limit: 20 });
```

返回当前摘要和来源计数，content_state=not-checked；不读取内容字节、不计算正文hash、不返回ETag/存储键/上传回执，不写版本、回执或下载释放记录。结果与store脱离。各页读取当时当前状态，新文件或版本可能在续页前加入；不是固定历史上界或跨页快照。没有自动分页、下载、文件保存或状态恢复。仍不模拟删除、动态权限/分类、损坏/缺失快照种子、SQL锁、持久事务或真实审计；独立Schema/运行证据待补，未编译、类型检查、测试或调用Mock。

## 历史版本目录

`GET /v1/artifacts/{id}/versions`读取同一store已保存的上传历史，与同一路径的POST追加分开。可省略参数，默认limit=10；URL只接受单值limit、at_version、before_version，解码后均为无前导零的正安全整数，limit最多20，before必须带原at且不超过它。未知/重复/空值/非规范数值和超过当前版本的上界拒绝；请求路径沿既有512字符上限。拒绝GET正文、写键/写版本/缓存/范围条件、transfer-encoding及非零content-length。SDK不需要新配置或新导出类型，已配置artifacts时既有MockWcpServer自动转给该store。

目录要求固定会话的read_artifacts与project_readable，三项范围与已提供的预期账号/客户端头仍必须一致，当前资料不可见继续报ARTIFACT_NOT_FOUND。当前元数据及每条选中/探测历史均先在2 MiB内复制并用完整元数据契约验证范围、目标、版本、描述、来源、时间及分类权限；当前记录也必须对应版本Map中的同一个对象。全部保存版本仍受既有1000条上限，目录只扫描版本键，最多完整投影limit+1条历史；探测行同样检查，拒绝整页时不返回部分列表。

首次上界取当前版本或调用方at_version，按降序及before的排他位置选页；完整ArtifactVersionsEnvelope共享校验后返回，并受256 KiB和调用方更低响应限额约束。摘要包含历史名称、类型、分类、hash/大小、时间、trace和来源计数；无正文、存储地址、外层ETag、上传回执或下载释放记录。返回结果与存储脱离，调用方修改页面不会改变历史。content_state固定not-checked；读目录不会计算内容摘要或观察实际下载可用性。

```ts
// 源码用法示例，未执行。artifactId来自同一store先前保存的上传结果。
const page = await client.listArtifactVersions({ artifact_id: artifactId, limit: 10 });
// 仅在用户明确选择较早页时执行，完整保留原上界和位置。
if (page.data.next_query) {
  const older = await client.listArtifactVersions(page.data.next_query);
}
// 重新读取最新目录时去掉旧上界/位置，不沿用旧next_query。
const latest = await client.listArtifactVersions({ artifact_id: artifactId, limit: 10 });
```

目录处理同步读取当前和选中历史，返回前再检查取消/会话到期；新上传只能在这次同步读取结束后提交。跨页可以追加版本，但旧next_query保持原上界；这不是实际数据库锁或跨页事务。SDK另沿既有默认30秒本地等待与signal丢弃迟到结果。目录无状态写入、自动翻页/重试、对象访问、原回执查询或文件保存，也不消耗下载释放记录容量。

store仍从空数据开始，只能通过现有上传生成历史；不新增历史种子/删除/损坏注入/动态分类与权限能力，故不能覆盖真实旧快照缺失、外部改库或来源可见性变化。独立schema、真实授权/持久存储/审计/并发及运行证据仍缺；仅源码文档人工审阅，未编译、类型检查、测试或调用Mock。

## 上传、并发与历史

SDK创建/追加入口现先固定原请求和非共享内容、独立核对原SHA-256，再以bounded-json/FormData及signal调用Mock。默认180秒本地预算、成功4 MiB完整响应上限由SDK执行；Mock原有multipart/预算/取消及同步提交检查继续独立生效。SDK发送前摘要不匹配或预取消不触达Mock；调用transport后的失败在SDK中一律保持原请求结果未知，不能据本地取消推断Mock或真实服务器没有写入。此处仅审阅源码接线，未运行场景；Mock不能证明真实网络未知或持久回执。

上传必须使用原生 FormData，恰好包含 `request` 和 `content` 两个 Blob。request 类型为 application/json，完整正文是现有 ArtifactReceiptQuery；文件名不参与身份。检查请求键、原 operation、路径、原 If-Match、文件长度和 SHA-256；空文件允许，摘要仍必须匹配。依赖环境提供 FormData、Blob 和 Web Crypto；不新增依赖。

首次异步读取前捕获头部、路径、响应限制、信号及两个不可变 Blob 引用，后续更换 FormData 条目不改变在途请求。先读取有界 JSON，再读取内容并计算摘要。包括重放在内，每次上传都核对本次字节；响应 replayed=true/content_state=not-checked 表示没有重新保存和重新检查已存对象。

摘要完成后才同步读取账本、核对当前版本、准备完整响应和进行状态写入，中间不再 await。相同账号/客户端/请求键比较规范完整命令；操作或参数不同返回 IDEMPOTENCY_KEY_REUSED。相同命令重放原资料版本，不分配新 ID、不追加历史。追加使用的 expected_version 已过期则返回 ARTIFACT_VERSION_CONFLICT；先查询原键，因此成功追加的原请求可在后来版本出现后重放原结果。此单进程约束不替代真实数据库事务或对象存储语义。

新版本沿用名称、MIME、分类、来源和 created_at，仅更新内容描述、版本、ETag、trace、updated_at。每版保留独立元数据和内容；原回执引用原版，后续追加不改写它。返回值经共享契约解析与有界复制，调用方更改返回数据不影响存储。对历史或回执的元数据读取均标记 content_state=not-checked，不验证已存字节。原追加回执缺失时仍先核对目标可见性，不能把不可见目标误报为 not-observed；not-observed 不证明失败或授予重发资格。

## 容量与失败

默认单次上传上限 16 MiB，seed.max_upload_bytes 可设为 0 至 16 MiB；request JSON 最多 1 MiB；普通JSON响应最多 2 MiB、历史目录最多256 KiB，均受调用方更低限制约束。最多两个在途上传，超过返回 ARTIFACT_UPLOAD_BUSY；finally 释放占用。Blob 读取和摘要不能被 AbortSignal 中断，但 await 返回后会检查取消/到期并拒绝提交。

最多 1000 条成功命令，也就是最多 1000 个保存版本；全部内容加规范账本 JSON 的累计编码预算为 64 MiB，不是进程堆内存测量。同内容追加也计入新版本的存储预算。配置/头部各最多 16 KiB。纯 JSON 限制复用 syncJsonSnapshot 的深度、节点与普通属性约束。

完整响应契约、复制、容量、当前版本、取消及到期检查均在状态修改前完成；失败不产生新的版本或回执。Mock 不模拟真实提交已发生但响应丢失的未知状态。所有内容仅在内存保存，无自动清理、存储快照导出、持久化或重启恢复。

## 固定版本下载

session 可选 `download_access: {export_data,export_restricted,policy_allowed}`，三项均为必需布尔值，未知字段拒绝。省略时不能下载，原上传/元数据行为保持。read_artifacts 和 project_readable 仍必需；policy_allowed 模拟开发者指定的导出策略结果，不调用真实 Policy/OPA。分类规则与现有权限逻辑对齐：public 不额外要求导出能力，internal/confidential 要求 export_data 或 export_restricted，restricted 同时要求 read_restricted 与 export_restricted。即使 public 也需要显式 download_access 和 policy_allowed=true。当前资料和历史版本均核对分类。

下载只接受明确的版本路径，`x-expected-artifact-sha256` 和规范十进制 `x-expected-artifact-size` 必须匹配所选历史元数据。范围及已给出的预期账号/客户端头继续核对。拒绝正文、分段/缓存条件/写条件、transfer-encoding 及非零 content-length；不提供“下载最新版”捷径。descriptor 不符返回 ARTIFACT_DESCRIPTOR_CONFLICT，历史不存在返回 ARTIFACT_VERSION_NOT_FOUND，读取/导出拒绝不能释放内容。

transport 请求必须指定 `response_type:'bytes'` 与安全整数 `max_response_bytes`，范围0至共享下载契约上限；实际文件大小还受 store 的 max_download_bytes 限制。后者独立于上传限制，默认16 MiB，可设0至16 MiB。零上限允许空文件。下载不能突破上传存储中的版本大小，也不会因调用方给出较高限制分配相应大小的缓冲区。

最多两个在途下载，独立于上传并发；超过返回 ARTIFACT_DOWNLOAD_BUSY。复制所选版本字节后重新计算SHA-256，摘要等待结束再次核对会话、当前及历史权限和固定版本对象。下载期间可追加新版本，仍返回已选历史内容；不会改写版本或原上传回执。Web Crypto摘要不能主动取消；Mock在其完成后检查AbortSignal和到期状态。SDK下载现支持max_bytes/timeout_ms/signal，元数据、内容及摘要共用默认180秒预算；Mock沿既有signal核对，不回滚已经保存的模拟放行记录。Fetch bytes亦已补独立凭据/正文期限与取消，均仅源码衔接，未执行。

返回200、独立Uint8Array及现有共享契约要求的完整二进制响应头：固定范围/版本/摘要/长度/trace、application/octet-stream、下载附件、no-store、nosniff、无ETag/Content-Range，audit-stage为release。先验证所有头部、字节完整性和释放记录容量，再同步记录并返回。SDK沿既有流程先读历史元数据、再取内容，最后独立核验响应头和SHA-256。

每次成功下载保存一条 `MockArtifactDownloadRelease`，包含 `simulation:true`、原五项身份、完整所选历史元数据、本次trace/时间及独立ULID。相同文件重复下载产生不同记录，不使用上传请求键去重。最多1000条、累计16 MiB编码预算，独立于上传账本；满额拒绝新的释放，已有资料和原回执保留。记录不保存另一份文件字节。格式/权限/摘要/容量/取消/到期失败不新增释放记录；本版本不模拟拒绝审计或传输完成观察。

持有store的开发者可调用 `store.getDownloadRelease(auditId)` 取得有界复制的记录；合法但未记录的ID返回undefined，非法ID拒绝。这是可信配置端的本地观察方法，无公开WCP路由，不提供普通客户端审计访问。修改返回记录或文件字节不影响存储和后续下载。`audit_state=release-recorded` 在此只表示已写入上述模拟内存记录，既不是持久审计，也不证明调用方完成SDK校验、接收、保存或打开了文件。

## 后续证据与范围

网络CLI上传另已切到Fetch bounded-json表单路径，嵌入CLI结果校验也限制完整纯JSON为4 MiB并规范化派发后未知错误。该CLI网络入口不接此进程内Mock，不能以本节接线说明替代HTTP multipart、期限或错误净化的运行证据；本轮未执行CLI/Mock。

SDK `getArtifact/getArtifactVersion/getArtifactReceipt` 现向既有Mock路由传入bounded-json、max_response_bytes及本地预算signal。Mock既有完整响应复制/大小检查、原身份前置头及取消检查可承接；SDK另核对全部共享封套，当前/历史上限2 MiB、原回执4 MiB，默认等待30秒。此处仅人工审阅源码兼容，未执行Mock；模拟响应不构成真实认证、持久回执或网络故障证据。SDK下载的元数据阶段随之获得有界读取；后续下载增量又将元数据、内容和摘要纳入同一可取消预算，见上文固定版本下载。

SDK `prepareArtifactUpload` 已有源码，可经此Mock的上传身份与当前元数据GET准备新原请求，不调用multipart写路由；当前模拟权限、版本和大小限制照常生效。调用方明确保存/审阅后才可交既有创建/追加方法，SDK允许省略构造上下文中的actor/client但始终发送原请求身份前置头。此衔接只有人工源码核对，尚未执行准备、上传或Mock场景。

待获准后验证 SDK multipart和下载兼容、摘要/长度拒绝、并发同键/同版本、原历史重放、身份/读取/导出分类隔离、返回数据复制、空文件/容量/响应/取消/到期失败、下载期间追加历史保持、释放记录绑定与旧 Mock 兼容。当前 evidence 保持空。

历史种子/恢复、动态项目/资料权限、拒绝审计与传输观察、真实认证/Policy/审计/数据库/对象存储、网络未知与其余 WCP Mock 路由仍未完成。P0-02 与 R-001 不因此标记完成。
