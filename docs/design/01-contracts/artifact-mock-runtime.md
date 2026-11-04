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

## 七条路由

| 路由 | 行为 |
| --- | --- |
| GET /v1/artifacts/upload-context | 返回模拟身份、到期时间、单次上传限制与读取能力 |
| POST /v1/artifacts | multipart 创建 version 1 |
| POST /v1/artifacts/{id}/versions | 原 If-Match 版本一致时追加一版 |
| GET /v1/artifacts/{id} | 当前元数据与当前 ETag |
| GET /v1/artifacts/{id}/versions/{version} | 不可变历史元数据，无外层 ETag |
| POST /v1/artifacts/receipt | 核对完整原上传请求，返回 recorded/not-observed |
| GET /v1/artifacts/{id}/versions/{version}/content | 固定版本二进制内容与模拟释放记录 ID |

现有 `getArtifactUploadContext/createArtifact/putArtifactVersion/getArtifact/getArtifactVersion/getArtifactReceipt/downloadArtifactVersion` 可通过上述 transport 接线。上传身份专用方法默认30秒期限、支持取消、16 KiB响应限制，并核验完整身份/权限提示/到期时间，详见 [SDK上传身份读取](artifact-persistence-runtime.md#sdk-上传身份读取源码阶段)。下载只模拟进程内内容释放，不能用此实现宣称真实审计、网络传输或客户端收妥已完成。

所有路由拒绝查询参数、片段、错误方法及多余写条件。GET 不接收正文。元数据/回执支持 JSON/bounded-json 响应上限，内容路由必须使用 bytes；Mock 支持 AbortSignal，没有自动重试。

## 上传、并发与历史

上传必须使用原生 FormData，恰好包含 `request` 和 `content` 两个 Blob。request 类型为 application/json，完整正文是现有 ArtifactReceiptQuery；文件名不参与身份。检查请求键、原 operation、路径、原 If-Match、文件长度和 SHA-256；空文件允许，摘要仍必须匹配。依赖环境提供 FormData、Blob 和 Web Crypto；不新增依赖。

首次异步读取前捕获头部、路径、响应限制、信号及两个不可变 Blob 引用，后续更换 FormData 条目不改变在途请求。先读取有界 JSON，再读取内容并计算摘要。包括重放在内，每次上传都核对本次字节；响应 replayed=true/content_state=not-checked 表示没有重新保存和重新检查已存对象。

摘要完成后才同步读取账本、核对当前版本、准备完整响应和进行状态写入，中间不再 await。相同账号/客户端/请求键比较规范完整命令；操作或参数不同返回 IDEMPOTENCY_KEY_REUSED。相同命令重放原资料版本，不分配新 ID、不追加历史。追加使用的 expected_version 已过期则返回 ARTIFACT_VERSION_CONFLICT；先查询原键，因此成功追加的原请求可在后来版本出现后重放原结果。此单进程约束不替代真实数据库事务或对象存储语义。

新版本沿用名称、MIME、分类、来源和 created_at，仅更新内容描述、版本、ETag、trace、updated_at。每版保留独立元数据和内容；原回执引用原版，后续追加不改写它。返回值经共享契约解析与有界复制，调用方更改返回数据不影响存储。对历史或回执的元数据读取均标记 content_state=not-checked，不验证已存字节。原追加回执缺失时仍先核对目标可见性，不能把不可见目标误报为 not-observed；not-observed 不证明失败或授予重发资格。

## 容量与失败

默认单次上传上限 16 MiB，seed.max_upload_bytes 可设为 0 至 16 MiB；request JSON 最多 1 MiB；响应最多 2 MiB，并受调用方更低限制约束。最多两个在途上传，超过返回 ARTIFACT_UPLOAD_BUSY；finally 释放占用。Blob 读取和摘要不能被 AbortSignal 中断，但 await 返回后会检查取消/到期并拒绝提交。

最多 1000 条成功命令，也就是最多 1000 个保存版本；全部内容加规范账本 JSON 的累计编码预算为 64 MiB，不是进程堆内存测量。同内容追加也计入新版本的存储预算。配置/头部各最多 16 KiB。纯 JSON 限制复用 syncJsonSnapshot 的深度、节点与普通属性约束。

完整响应契约、复制、容量、当前版本、取消及到期检查均在状态修改前完成；失败不产生新的版本或回执。Mock 不模拟真实提交已发生但响应丢失的未知状态。所有内容仅在内存保存，无自动清理、存储快照导出、持久化或重启恢复。

## 固定版本下载

session 可选 `download_access: {export_data,export_restricted,policy_allowed}`，三项均为必需布尔值，未知字段拒绝。省略时不能下载，原上传/元数据行为保持。read_artifacts 和 project_readable 仍必需；policy_allowed 模拟开发者指定的导出策略结果，不调用真实 Policy/OPA。分类规则与现有权限逻辑对齐：public 不额外要求导出能力，internal/confidential 要求 export_data 或 export_restricted，restricted 同时要求 read_restricted 与 export_restricted。即使 public 也需要显式 download_access 和 policy_allowed=true。当前资料和历史版本均核对分类。

下载只接受明确的版本路径，`x-expected-artifact-sha256` 和规范十进制 `x-expected-artifact-size` 必须匹配所选历史元数据。范围及已给出的预期账号/客户端头继续核对。拒绝正文、分段/缓存条件/写条件、transfer-encoding 及非零 content-length；不提供“下载最新版”捷径。descriptor 不符返回 ARTIFACT_DESCRIPTOR_CONFLICT，历史不存在返回 ARTIFACT_VERSION_NOT_FOUND，读取/导出拒绝不能释放内容。

transport 请求必须指定 `response_type:'bytes'` 与安全整数 `max_response_bytes`，范围0至共享下载契约上限；实际文件大小还受 store 的 max_download_bytes 限制。后者独立于上传限制，默认16 MiB，可设0至16 MiB。零上限允许空文件。下载不能突破上传存储中的版本大小，也不会因调用方给出较高限制分配相应大小的缓冲区。

最多两个在途下载，独立于上传并发；超过返回 ARTIFACT_DOWNLOAD_BUSY。复制所选版本字节后重新计算SHA-256，摘要等待结束再次核对会话、当前及历史权限和固定版本对象。下载期间可追加新版本，仍返回已选历史内容；不会改写版本或原上传回执。Web Crypto摘要不能主动取消；Mock在其完成后检查AbortSignal和到期状态。现有SDK下载选项仍只有max_bytes，其Fetch transport对取消的限制也未改变。

返回200、独立Uint8Array及现有共享契约要求的完整二进制响应头：固定范围/版本/摘要/长度/trace、application/octet-stream、下载附件、no-store、nosniff、无ETag/Content-Range，audit-stage为release。先验证所有头部、字节完整性和释放记录容量，再同步记录并返回。SDK沿既有流程先读历史元数据、再取内容，最后独立核验响应头和SHA-256。

每次成功下载保存一条 `MockArtifactDownloadRelease`，包含 `simulation:true`、原五项身份、完整所选历史元数据、本次trace/时间及独立ULID。相同文件重复下载产生不同记录，不使用上传请求键去重。最多1000条、累计16 MiB编码预算，独立于上传账本；满额拒绝新的释放，已有资料和原回执保留。记录不保存另一份文件字节。格式/权限/摘要/容量/取消/到期失败不新增释放记录；本版本不模拟拒绝审计或传输完成观察。

持有store的开发者可调用 `store.getDownloadRelease(auditId)` 取得有界复制的记录；合法但未记录的ID返回undefined，非法ID拒绝。这是可信配置端的本地观察方法，无公开WCP路由，不提供普通客户端审计访问。修改返回记录或文件字节不影响存储和后续下载。`audit_state=release-recorded` 在此只表示已写入上述模拟内存记录，既不是持久审计，也不证明调用方完成SDK校验、接收、保存或打开了文件。

## 后续证据与范围

待获准后验证 SDK multipart和下载兼容、摘要/长度拒绝、并发同键/同版本、原历史重放、身份/读取/导出分类隔离、返回数据复制、空文件/容量/响应/取消/到期失败、下载期间追加历史保持、释放记录绑定与旧 Mock 兼容。当前 evidence 保持空。

历史种子/恢复、动态项目/资料权限、拒绝审计与传输观察、真实认证/Policy/审计/数据库/对象存储、网络未知与其余 WCP Mock 路由仍未完成。P0-02 与 R-001 不因此标记完成。
