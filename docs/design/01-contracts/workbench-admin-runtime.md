# 工作台管理查询快照（源码阶段）

2026-11-05，TODO P0-01：新增[完整管理Schema](../../../packages/contracts/schemas/workbench-admin.json)，并组合到[工作台统一查询OpenAPI](../../../packages/contracts/openapi/workbench-query.json)。严格封闭请求/快照/封套，建模计数的available/安全整数与not-authorized/null、两项context计数同态、四种准确有序来源及六种固定not-checked。文本不是ULID且允许纯空白，运行时另查UTF-16/孤立代理项、真实毫秒日历、16KiB候选和可信scope/trace。可选expectedAccess来自可信嵌入上下文；网络SDK不能仅凭响应断言当前能力。单SQL版本/计数与配置Gateway版本不证明外部服务或部署健康，Mock来源是协议模拟。统一HTTP没有MCP两槽或数据库全程期限；SDK默认30秒本地预算、错误净化retryable=false保持独立。P0-01/R-001未完成、evidence为空；只人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、执行校验器/生成器/SDK/Mock/API/数据库或发布。

更新：2026-11-02。仅修改源码与文档，没有编译、类型检查、测试、实际 SQL/HTTP 请求、浏览器/服务运行或发布。

## 入口与范围

继续使用 `POST /v1/workbench/query`，请求仅允许 `{ "operation": "admin" }`。当前上下文必须包含可信客户端、admin 角色、实际 admin.read 和有限未过期的令牌期限；角色不代替实际能力。原 Gateway admin.read 策略及入口决定审计保持，处理器独立检查并在数据库返回后重新检查会话期限。读取不使用写入幂等成功缓存，也没有自动重试或轮询。

tenant/workspace/project 来自可信上下文。项目必须存在、未删除且分类可读；不可读与不存在均返回 NOT_FOUND，不返回假零。管理查询使用自身 admin.read 策略，再按实际 audit.read/context.read 限制各组计数，不宣称逐项调用了其他数据路由或它们的策略。

- audit_records 需实际 audit.read，按项目过滤，并在没有 data.restricted.read 时排除 restricted 审计。
- running_sessions 与 open_conflicts 需实际 context.read；会话只统计 running，冲突只统计 open。父项目可见性和既有来源行/冲突敏感级别规则在 SQL 计数内生效。
- 缺少对应能力为 `{state:'not-authorized',value:null}`，不执行该计数分支，不返回零冒充空记录；有权限为 `{state:'available',value:非负安全整数}`。admin.read 本身不隐含其他实际能力。

## 返回封套

共享 `WorkbenchAdminEnvelope` 保留 schema_version=1、当前 trace_id，新增明确 scope 与完整 data：

```text
data = {
  read_at, gateway_version,
  database: { state: 'read-succeeded', version },
  counts: { audit_records, running_sessions, open_conflicts },
  checks: {
    audit_write: 'not-checked', identity_provider: 'not-checked',
    policy_service: 'not-checked', plane_connector: 'not-checked',
    telemetry: 'not-checked', release_readiness: 'not-checked'
  }
}
```

database.version 来自当前数据库连接的 server_version 设置，read_at 来自同一语句的 statement_timestamp，以 UTC 毫秒文本返回。计数与设置在一次 SQL 中读取，COUNT 转十进制文本后检查安全整数范围，避免 int 溢出或浮点静默舍入。gateway_version 仍是 Gateway 配置声明，不能作为已签名镜像、发布清单或实际部署版本验证。

来源依次为 runtime/api-gateway、postgres/pg_settings、postgres/wcp_projects；按可用计数组添加 wcp_audit_records 或 wcp_sessions/wcp_conflicts。它们描述数据来源，不是来源页面地址、额外权限或健康凭证。封套解析严格限制完整键集合、当前范围/trace、时间、版本文本长度、计数状态/值一致性和来源顺序；两个 context 计数必须同为可读或不可读。未知外部健康断言直接拒绝。

整个成功 JSON 最多 16 KiB；数据库异常返回 WORKBENCH_DATABASE_UNAVAILABLE，损坏结果返回 WORKBENCH_ADMIN_INVALID/500，不退回硬编码服务健康或旧成功数据。查询时间是语句观察时间，页面不承诺持续健康、运行时钟同步或跨请求一致快照。

## 工作台读取与展示

Web 绑定服务端会话范围及原查询 trace，成功要求 HTTP 200 和匹配 x-trace-id，完整解析后才展示。成功和错误正文都限 16 KiB，严格 UTF-8 JSON 与媒体类型；无压缩的规范 Content-Length 必须匹配实际字节，压缩响应限制解码后大小。复用共用 workbench-response reader，原 audit-response 包装保留原 16 MiB/16 KiB 限额。

从 fetch 派发到正文读取及解析后的检查共用 30 秒期限；服务端会话获取不包含在该期限内。取消尽力停止本地网络/正文等待，不取消 Gateway 已在进行的 SQL；同步解析不保证可中断，但迟到成功被拒绝。数据库查询成本、服务器并发和总进程内存不由这个字节/等待限制保证。401 提示重新登录，其他错误为有限说明与本次 trace，不回显上游原始消息。

管理页展示三项计数、运行时声明版本、实际数据库报告版本、UTC 读取时间、项目范围及来源，提供明确刷新和独立记录页面入口，导航禁用预取。原 System healthy、Uptime signal、事件延迟进度、固定 PostgreSQL 16、按记录数猜测的开关、硬编码发布清单与拓扑健康点已移除。外部连接器、身份提供器、策略服务、审计写入恢复、遥测交付与发布就绪在本端点均为未检查；读取成功只说明该次查询返回，不能证明这些能力健康。

导出的 `AdminPanel.view(unknown, expectedTrace?)` 纯模型也使用完整封套校验；缺少原 trace 返回 error，普通用户为 denied，ready 只说明可展示已校验数据。纯模型不替代服务端授权。

## SDK、命令行与 MCP

SDK 新增 `getAdminSnapshot(options?)` 及 `WcpAdminOptions`，只允许 timeout_ms/signal。固定构造上下文中的项目及 trace，复用 bounded-json 的完整 HTTP 200、匹配响应头、UTF-8 JSON 与字节限制，再用共享解析器核对完整封套并返回独立对象。成功/错误各 16 KiB，本地期限默认 30 秒，调用方可配置 1–2147483647 毫秒或取消；Fetch 自身期限也独立生效。自定义 transport 仍受等待和完整对象校验，但不冒充网络流式大小保证。取消不能撤销已派发工作，同步解析后继续检查期限；不接受继承写条件，不自动重试或保存。令牌不透明，SDK 不自行推测实际能力。

CLI 新增 `admin snapshot [--timeout-ms N]`，网络使用固定 WORKCTX_* 范围及令牌，SDK 和 Fetch 使用相同期限；嵌入 runWorkctx 使用复制的可信上下文，清理写条件并在 router 前后检查管理员/实际 admin.read/有效期。只允许空业务输入，拒绝 JSON、文件、写键、队列、重复标志与额外位置参数。stdout 为完整封套；退出 0 只表示该次读取成功，用法错误 2，其他错误 1。没有文件保存或 outbox。

MCP 新增 `get_admin_snapshot`，arguments 仅为空对象。发现和调用均要求 authenticated_client=true、admin 角色、实际 admin.read、有限未过期的会话，角色不代替能力；使用现有 admin.read 策略/审计路由。复制上下文、清除继承写条件，只派发固定 admin 查询。成功要求 HTTP 200 与匹配 trace 响应头，完整共享解析后返回单项 content 文本 JSON。注解为 readOnlyHint=true、destructiveHint=false、idempotentHint=true；只读结果仍随时间变化，不构成缓存或自动重试许可。

共享解析器增加可选可信 expectedAccess；嵌入 CLI/MCP 用实际 audit.read/context.read 核对计数状态，既拒绝越权可用，也拒绝有能力却被错误标成不可读的响应。网络 SDK 无可信令牌能力视图，仍由 Gateway 决定计数权限。SDK/MCP 仅返回有限错误说明与原 trace，不回显上游消息/详情。

MCP 每个 ApiGateway 实例最多两笔管理快照准备，等待 30 秒，满额返回 MCP_ADMIN_BUSY，无排队。超时只停止外层等待，在途工作和校验实际结束前保留名额；执行前后及成功返回前检查期限/会话。Gateway 成功与错误对象序列化各限 16 KiB，二次转义后的 MCP result 限 2×16 KiB+4096 字节。限制不含外层 JSON-RPC 包装、HTTP 发送或进程总内存，也不取消底层 SQL；准备结束释放名额，不保留到发送结束。没有新增资源 URI、外部健康探测或本地文件写入。

## 兼容与未完成范围

这是同一路径的源码阶段响应替换：旧 data.release/services/audit_count/active_sessions/open_conflicts 与 workbench_health 来源不再返回，消费者需同步切换。旧 AdminHealth 的服务健康 fixture 也不再满足新模型；本轮没有修改或执行测试，相关契约/客户端证据仍待补齐。没有新增依赖或迁移，016–045 仍未执行。

专用 SDK/CLI/MCP 入口已有源码；后续管理快照 Mock 源码见下节，fixture 兼容与运行证据尚未补齐。外部服务主动探测、真实开关配置读取、发布清单验证、持续健康历史和事件延迟观测仍缺。R-011 和 T5.3 保持未完成，不把源码状态作为运行证据。

## 管理快照 Mock（2026-11-05 源码增量）

按 TODO P0-02 新增独立 `MockAdminStore`，通过 `MockWcpServer` 的 admin 配置承接原 `getAdminSnapshot`。显式单项目/受限读取场景提供完整固定快照，当前模拟会话独立决定管理员入口和各组计数权限；不从其他 Mock 数据集计算数量，不把缺能力改成零，不自动降级到另一受限场景。完整返回沿本契约及 expectedAccess 解析，详见[管理快照 Mock](admin-mock-runtime.md)。

原种子时间/版本保持，外部 checks 全部 not-checked；协议固定的 read-succeeded 和 runtime/postgres 来源在此只是模拟投影，不证明真实数据库读取、认证、审计、健康或发布就绪。同步内存处理前后检查预算/会话/信号，无网络或异步探测。未编译、类型检查、测试、运行 SDK/Mock/SQL/HTTP 或发布；P0-02/R-011 保持未完成。
