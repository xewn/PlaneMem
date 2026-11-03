# Plane REST 传输开发契约

2026-11-02：仅开发源码与说明，未编译、类型检查、测试、连接 Plane、执行命令、启动服务、安装依赖或发布。没有新增迁移，016–041 仍未执行。此增补实现现有客户端的 HTTP 传输与失败处理，不宣称已验证 Plane 0.26.0 原生路由、鉴权、分页、ETag 或请求键语义。

## 公共入口

`@planemem/plane-connector` 导出 FetchPlaneTransport、createFetchPlaneClient、PlaneRequestOptions、PlaneApiResult 和 PlaneConditionalResult。工厂以同一 base_url 配置构造传输与 PlaneClient；手工注入自定义 PlaneTransport 的方式保留。base_url 只接受 HTTP(S) origin，不接受路径、查询、fragment 或内嵌凭据，避免客户端相对路径静默绕过部署前缀。

旧方法仍返回数据对象，新增 getProjectResult/createWorkItemResult/updateWorkItemResult/listAttachmentsResult 返回 `{data,status,trace_id,etag?}`。trace 是当前客户端配置中的可信请求 trace，不采用响应中的任意追踪头。etag 只保留格式有效的原始服务器值；缺失或格式无效不补造。只读方法与写方法均接受末尾可选 `{signal}`，附件列表的 cursor 参数仍在 options 之前。

项目和工作项结果必须为 JSON 对象、含有效 ID；项目读取和工作项读取/更新必须返回请求的确切 ID。version 可选，存在时必须是非负安全整数，不把它转换为可用 ETag。附件仍采用既有 `{items,has_more,next_cursor?}` 契约，最多 1000 条；has_more 与游标存在性一致，下一游标不得等于当前输入。不增加未验证的原生分页转换。

## 工作项读取与条件读取

getWorkItem(projectId, workItemId, options?) 返回工作项，getWorkItemResult 返回带状态/trace/可选原始 ETag 的结果。GET 沿用现有更新资源地址 `/api/projects/{projectId}/issues/{workItemId}`，尚未验证固定 Plane 版本原生兼容性。

getProjectIfChanged(projectId, ifNoneMatch, options?) 和 getWorkItemIfChanged(projectId, workItemId, ifNoneMatch, options?) 必须传入一个服务器 ETag，支持弱标记但不支持通配符或列表。发送 If-None-Match，返回 PlaneConditionalResult；not_modified=false 含新 data，not_modified=true 的 status 为 304 且没有 data。两者保留 requested_etag，etag 仅表示实际返回且有效的响应头，不以请求标记补造。

仅相应条件 GET 接受 304；普通读取与写入收到 304 均返回 PLANE_RESPONSE_INVALID，不自动重试。304 不要求 JSON 媒体类型或正文，自定义传输必须返回 data=undefined。若 304 带 ETag，则必须是唯一有效值，并与请求标记去除可选 W/ 前缀后的不透明内容相同；重复、畸形或不匹配均拒绝。缺失响应 ETag 允许返回 304。新 2xx 仍按资源身份和 JSON 契约解析，可以没有 ETag。

调用方若保留正文/ETag，必须绑定相同 origin、workspace、project、resource、凭据身份及权限上下文；变化后重新完整读取。客户端不缓存、不合并，也不把读取结果写成观察事件。当前记录或 304 只反映本次读取，不能证明某个先前未知写命令已提交；创建结果未知且没有资源 ID 时，不能通过此接口自动定位。调用示例见连接器 README，未执行。

## 请求与数据边界

客户端固定配置副本；凭据或 trace 变化需构造新实例。项目、工作项和 workspace 标识按单一路径段编码，并拒绝分隔符、URL 控制字符、点路径和双重编码入口。Bearer token、trace、请求键和 ETag 在网络前校验；update 只接受一个带引号的原始 ETag，拒绝通配符。客户端在发送前保存 JSON 数据副本，拒绝循环、稀疏数组、非 JSON 值、非普通对象和 getter，禁止 JSON.stringify 静默丢字段。

fetch 只访问配置 origin 的 `/api/` 路径，不跟随重定向，不附带浏览器 cookie。单次尝试默认 30 秒，包括完整响应体读取；默认请求 1 MiB、响应 4 MiB。响应按流累计实际解码字节，Content-Length 只作提前拒绝提示，不能绕过流上限。成功响应必须使用 JSON 媒体类型和有效 UTF-8，随后由 typed client 检查资源形状与身份。错误状态不解析或返回响应正文，只保留状态及有界 Retry-After/有效 ETag。任何失败都不输出凭据、正文、原始 URL 或原始异常消息。

传输可配置 timeout_ms=1–120000、max_request_bytes=1–16777216、max_response_bytes=1–33554432；typed client 写入仍最多 1 MiB，JSON 结构上限为 64 层/100000 节点。读取响应的结构限制同样适用。此增补没有下载二进制附件功能。

## 重试、取消与未知结果

传输本身只尝试一次；PlaneClient 仅自动重试 GET 的传输失败和 408/429/5xx。max_retries 默认 2、最多 5；重试为指数退避加抖动，基础 250 ms、最大等待 30000 ms，可配置基础 1–10000 和最大等待到 60000。有效 Retry-After 秒数或日期是最早重试时间，实际等待取其与本地退避较大值；超出最大等待则停止自动重试，并在错误中保留 retry_after_ms。非法/缺失头使用本地退避。畸形成功响应与资源身份不符不自动重试。

调用方取消会中止正在进行的请求、响应读取和退避；超时按每次尝试计算，需要全操作截止时间时由调用方 signal 控制。每次完成都释放计时器和取消监听。当前没有持久任务队列或崩溃后的自动命令恢复。

POST/PATCH 从不自动重试。网络开始后无法确认结果、非成功 HTTP、无法解析/验证的 2xx 均在错误 details 中标记 write_outcome=unknown，retryable=false；本地输入失败或发出前取消标记 not_sent。retryable=false 不能解释为上游没写入。请求键只原样传递，未验证服务端幂等保证；调用方必须保留原请求并以授权的上游读取/命令对账确认结果，不能自动换键。更换 trace 或凭据不改变这一边界。

主要错误码：PLANE_INPUT_INVALID、PLANE_REQUEST_CANCELLED、PLANE_TRANSPORT_UNAVAILABLE、PLANE_RESPONSE_INVALID、PLANE_API_ERROR。下游应按 code、write_outcome、status 和 retry_after_ms 处理，不解析错误文本。当前未接入 Gateway Plane 写命令路由、策略/审计的外部操作事务或观察事件生成；成功 API 数据不能直接标为 observed。

## 待补证据

保留已有固定版本能力矩阵的未验证状态。旧客户端 fixture 以无关工作项 ID 代替项目/更新结果，已不满足新增身份校验；本轮未修改或运行测试。后续恢复验证时需要覆盖路径/重定向、错误正文隔离、慢响应/取消、响应限制、Retry-After、资源 ID、请求快照、写入未知结果和真实 Plane 契约；新增工作项 GET、条件读取两分支、304 缺失/弱/重复/不匹配 ETag 和普通请求拒绝 304 同样没有运行证据。上述清单只记录待办，不代表已执行。
