# 资料上传与版本历史内存 Mock

日期：2026-11-04。仅源码和文档人工审阅；未编译、类型检查、测试、执行 SDK/Mock/API/数据库或发布。本文记录开发约定，不作为运行兼容性证据。

## 接线与权限

SDK 导出 `MockArtifactStore`、`MockArtifactSeed` 和 `MockArtifactSession`。store 初始为空，固定一个 tenant/workspace/project；不同模拟账号可通过 `connect(session)` 共享该 store，或配置 `new MockWcpServer({artifacts:{store,session}})`。未配置 artifacts 时原 Mock 路由保持。

```ts
const store = new MockArtifactStore({
  scope: { tenant_id, workspace_id, project_id },
  max_upload_bytes: 4 * 1024 * 1024,
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

## 六条路由

| 路由 | 行为 |
| --- | --- |
| GET /v1/artifacts/upload-context | 返回模拟身份、到期时间、单次上传限制与读取能力 |
| POST /v1/artifacts | multipart 创建 version 1 |
| POST /v1/artifacts/{id}/versions | 原 If-Match 版本一致时追加一版 |
| GET /v1/artifacts/{id} | 当前元数据与当前 ETag |
| GET /v1/artifacts/{id}/versions/{version} | 不可变历史元数据，无外层 ETag |
| POST /v1/artifacts/receipt | 核对完整原上传请求，返回 recorded/not-observed |

现有 `createArtifact/putArtifactVersion/getArtifact/getArtifactVersion/getArtifactReceipt` 可通过上述 transport 接线。SDK 当前没有上传身份的专用方法；该 GET 路由可直接通过 transport 调用并使用共享 `parseArtifactUploadContextEnvelope` 核验。二进制下载尚不支持，不能用此实现宣称 downloadArtifactVersion 或模拟下载审计已完成。

所有路由拒绝查询参数、片段、错误方法及多余写条件。GET 不接收正文。支持 JSON/bounded-json 响应上限与 AbortSignal；没有自动重试。

## 上传、并发与历史

上传必须使用原生 FormData，恰好包含 `request` 和 `content` 两个 Blob。request 类型为 application/json，完整正文是现有 ArtifactReceiptQuery；文件名不参与身份。检查请求键、原 operation、路径、原 If-Match、文件长度和 SHA-256；空文件允许，摘要仍必须匹配。依赖环境提供 FormData、Blob 和 Web Crypto；不新增依赖。

首次异步读取前捕获头部、路径、响应限制、信号及两个不可变 Blob 引用，后续更换 FormData 条目不改变在途请求。先读取有界 JSON，再读取内容并计算摘要。包括重放在内，每次上传都核对本次字节；响应 replayed=true/content_state=not-checked 表示没有重新保存和重新检查已存对象。

摘要完成后才同步读取账本、核对当前版本、准备完整响应和进行状态写入，中间不再 await。相同账号/客户端/请求键比较规范完整命令；操作或参数不同返回 IDEMPOTENCY_KEY_REUSED。相同命令重放原资料版本，不分配新 ID、不追加历史。追加使用的 expected_version 已过期则返回 ARTIFACT_VERSION_CONFLICT；先查询原键，因此成功追加的原请求可在后来版本出现后重放原结果。此单进程约束不替代真实数据库事务或对象存储语义。

新版本沿用名称、MIME、分类、来源和 created_at，仅更新内容描述、版本、ETag、trace、updated_at。每版保留独立元数据和内容；原回执引用原版，后续追加不改写它。返回值经共享契约解析与有界复制，调用方更改返回数据不影响存储。对历史或回执的元数据读取均标记 content_state=not-checked，不验证已存字节。原追加回执缺失时仍先核对目标可见性，不能把不可见目标误报为 not-observed；not-observed 不证明失败或授予重发资格。

## 容量与失败

默认单次上传上限 16 MiB，seed.max_upload_bytes 可设为 0 至 16 MiB；request JSON 最多 1 MiB；响应最多 2 MiB，并受调用方更低限制约束。最多两个在途上传，超过返回 ARTIFACT_UPLOAD_BUSY；finally 释放占用。Blob 读取和摘要不能被 AbortSignal 中断，但 await 返回后会检查取消/到期并拒绝提交。

最多 1000 条成功命令，也就是最多 1000 个保存版本；全部内容加规范账本 JSON 的累计编码预算为 64 MiB，不是进程堆内存测量。同内容追加也计入新版本的存储预算。配置/头部各最多 16 KiB。纯 JSON 限制复用 syncJsonSnapshot 的深度、节点与普通属性约束。

完整响应契约、复制、容量、当前版本、取消及到期检查均在状态修改前完成；失败不产生新的版本或回执。Mock 不模拟真实提交已发生但响应丢失的未知状态。所有内容仅在内存保存，无自动清理、导出、持久化或重启恢复。

## 后续证据与范围

待获准后验证 SDK multipart 兼容、摘要/长度拒绝、并发同键/同版本、原历史重放、身份/分类隔离、返回数据复制、容量/响应/取消/到期失败和旧 Mock 兼容。当前 evidence 保持空。

二进制下载及模拟释放记录、历史种子/恢复、动态项目/资料权限、真实认证/Policy/审计/数据库/对象存储、网络未知与其余 WCP Mock 路由仍未完成。P0-02 与 R-001 不因此标记完成。
