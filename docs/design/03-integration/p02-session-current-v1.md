# P02 外部会话当前读取 v1

2026-11-05。对应工厂 51 号 TODO 的 GAP-04 / T03.02–05、“首件岗位执行”。**源码已改，待统一验证**。本项只实现外部连续性基础设施的当前会话来源，不赋予 Node 服务任何 ABP 模块认证或工厂执行批准权。

主线适配基于 `a4a05d23ae2e833d48063b352fb7751e3c77d946`，保留其独立开发的 OIDC、当前会话、项目可见性及已有完整网关。工厂旧分支候选 `7886438d9b4d2cfd2752c84a707aabe02a674133` 使用不同旧基线；此处只移植本项，未把旧分支全部历史或旧 continuity 写入协议并入 main。两个提交不是相同可重建输入；P02 后续必须明确选择目标完整版本并处理差异。主线使用显式 `session_current_configuration`，无环境默认端点或摘要。

## 读取入口与响应

`POST /v1/continuity/session-current` 是只读操作 `session.current.read`。请求仅包含：

```json
{
  "protocol_version": "p02-session-current-v1",
  "endpoint_ref": "由受控配置明确选择",
  "configuration_digest": "64位小写十六进制摘要",
  "session_id": "原session.start创建的规范ULID",
  "challenge": "调用方为此次观察新生成的32字节随机数的小写十六进制"
}
```

规范 ULID 使用大写 Crockford 字母表、26 字符且首位 0–7。HTTP 正文限制 4 KiB、严格 UTF-8 和平面字符串对象，拒绝重复键（包括 Unicode 转义的重复）、大小写别名和嵌套对象。拒绝未声明字段、错误协议与端点/配置。scope 请求坐标须经现有 authenticatedContext 验证，actor/client、能力和到期时间来自 OIDC 票据，禁止落到旧头部身份路径。新入口优先 X-Trace-Id，再 traceparent。相同 HTTP idempotency-key 或 challenge 也会重新查存储、重新授权；服务不保存 nonce 去重表，调用方必须生成并核对新 challenge，不能把重复 nonce 的旧响应当新证明。

外层仍为 `schema_version/trace_id/source_refs/data`。当前观察的外层 source_ref 指向 session_id；原 session.start 的历史 source_ref 仍指向 client_id，不能改写两者原语义。data 包含请求协议/端点/配置/session/challenge、tenant/workspace/project、actor/client/trace，以及：

- `observed_at`：读取 SQL 语句开始时的数据库 UTC 毫秒时间。
- `session_json`：该语句生成的完整公开会话业务投影原文；保持数据库输出的空白与顺序。
- `session_digest`：上述原文 UTF-8 字节的 SHA-256 小写十六进制。
- `authorization`：独立身份摘要、当前授权引用及原到期时间；不返回凭据。

业务投影包含 Session 的 schema、全部归属字段、session/parent、status/version、started/ended、trace/source_refs，并保留主线可选 resume_origin，按主线合同解释且要求父会话和规范交接/检查点ID。可选 parent/resume_origin/ended 仅数据库 NULL 时省略；不递归剥除 source_refs 中的 NULL。全部已知状态原样返回，包含 ended/failed/abandoned；调用方依自身策略拒绝不可用状态，不能只因返回 200 就继续执行。

这不是数据库物理原字节，不含 created_at/idempotency_key 等内部列，也不包含 runs、tool calls、checkpoints、交接页面、完整历史或停止证据。它不能代替原创建回执、P02 当前绑定/完整历史、P09 原准入、独立批准或完整 `IExecutionAuthority`。

## 实际来源与有界读取

`PostgresSessionCurrentStore` 每次在独立 READ COMMITTED 只读事务内执行准确 session/tenant/workspace/project/actor/client 条件查询，同一语句核对所属项目存在、未删除且分类为 public/internal/confidential。v1 对 restricted 项目保守拒绝，即使票据有附加能力也不扩权；未授该能力不能绕过主线可见性。没有数据库时不降级到内存 Map；不存在、不属于当前完整归属及项目不可见均为相同缺失。该 SELECT 观察已提交版本，能看到其他进程已提交的更新。它不等待整个会话域写锁，不承诺返回后会话仍未变化，也不是跨来源原子撤权。

SQL 使用已有 wcp_sessions 表，无新表或迁移；设置语句 5 秒、锁等待 2 秒上限。正文传输上限 64 KiB，引用最多 256 条，字符串/版本/状态/时间严格解释；BIGINT 超过 JavaScript 安全整数直接拒绝，不将其截断为合法版本。非毫秒时间拒绝，不静默丢掉微秒。JSON 来源由 SQL 类型列生成，内部解释器不作为任意远端原始 JSON 的重复键检查器；后续 P02 HTTP 消费端须独立处理重复键、严格 UTF-8、大小/深度和响应原文。

事务完成/释放后才进行最后授权。每次调用的 UTC 与单调时钟总窗固定 30 秒，等待不续期。HTTP 断开后触发取消，已开始的存储/权威调用完整等待并在返回边界拒绝；不使用 Promise.race 遗留后台操作。连接池排队和权威回调尚不支持硬取消，故不是 30 秒硬截止 SLA。实际成本、容量与跨进程时序待统一验证。

## 当前授权与默认拒绝

主线 HTTP 入口强制使用已有 Bearer/OIDC authenticatedContext（包括 requireClient），不信任 actor/client/capability 头。本入口还必须独立配置 `PlatformServerOptions.session_current_authority`，且每次读取前后调用 `SessionCurrentAuthority.authorize`。该端口必须从可信认证边界确定身份并重新读取准确对象权限，不得凭传入头部、历史回执、静态配置或角色字符串返回允许。返回 grant 绑定完整目标及 challenge/trace，固定身份摘要、授权引用和到期时间，两次必须一致，不能中途续窗。缺实现时 503，缺权/错误目标/变化/过期拒绝。CLI 没有允许型默认实现或环境开关。HTTP 票据由主线原验证器验证一次，后续授权端口必须承担独立当前身份/对象权限复查；不能声称原 JWT 在每次读取边界都已重新验证。

现有 `context.read` 是额外的路由权限，不新增一个会被旧未知动作规则自动放行的能力名。当前入口要求显式且尚未过期的 token_expires_at 和 context.read，不采用既有通用路由的“默认延长五分钟”。实际路由策略和审计在读取前、读取后都执行，第二次审计失败不返回正文；最终再检查独立当前权威。不存在也完成末次核权才返回 404。入口成功、错误、限流和解析错误均标记 Cache-Control: no-store，进程 HTTP 幂等成功缓存不参与此入口。

**主线已有 OIDC 路径接线，但本项独立当前对象权威尚未安装，因此默认服务器不能成功返回此来源。** 源码接线不是生产联调证据。后续沿同 TODO 实现实际当前授权与受控来源，并明确旧工厂分支与主线的完整协议兼容，再开发 P02 出站读取/当前授权、E02 原会话与当前会话关联；然后交接创建/原页面、P23、完整执行权威及既定恢复/取证/消费审核。上级 TODO 保持未完成。

## 待统一验证

新增 p3 场景仅源码，存储、权限与身份为显式内存夹具：同键重复读当前结束状态、原件保留、读取后撤权/身份或期限变化、缺权零读、缺失末次核权、错误归属/协议/字段/大整数、取消等待、审计失败和原文摘要。

p4 场景为实际 PostgreSQL 两连接/主线 SessionService 持久写入与保留的旧 Map，核对其他写者结束后当前读变化、最初返回对象仍 running、完整归属隔离和大整数拒绝；不复用旧分支不存在于主线的写入包装器，也不冒称核验了完整原操作回执。只有整厂开发全部完成后，才允许在指定远端 k3s Job 中执行；明确的接受标记、Linux、Kubernetes 环境和 downward API 节点 IP 在创建连接前检查。数据库需先按统一计划迁移并准备隔离夹具 scope。该场景不是生产认证或 HTTP 联调证据。

本项未运行任何还原、编译、应用、静态检查、测试、迁移、远端调用或部署。
