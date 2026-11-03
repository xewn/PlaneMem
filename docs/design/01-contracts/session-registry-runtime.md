# 会话目录筛选与分页（源码阶段）

更新：2026-11-02。仅源码和文档；未编译、类型检查、测试、执行 SQL/迁移/CLI/MCP、运行浏览器/服务或发布。

## 请求与权限

继续使用 `POST /v1/workbench/query`，请求为 `{operation:'sessions', query?, status?, client_id?, limit?, cursor?}`。只接受这些字段；Gateway 沿用 context.read 策略、项目范围及入口审计，没有新增写操作或管理权限要求。只有存在、未删除且当前分类可读的父项目内记录可返回；不可读项目与没有匹配记录都不披露会话，返回空页。

- query 最多 500 字符，去除首尾空白，空串等价于未筛选。对 session_id/client_id/actor_id/trace_id 合并文本做 PostgreSQL lower + strpos 字面子串匹配；不是 SQL 通配符或全文查询，大小写折叠遵循数据库设置。
- status 精确匹配 running、paused、ended、abandoned、failed；空串不筛选。
- client_id 精确匹配，最多 1024 字符；空串不筛选，不做自动大小写/空格归一化。
- limit 默认 25，允许 1–100 的安全整数。cursor 为原样传回的规范不透明字符串，最多 1024 字符。

输入文本拒绝控制字符和孤立代理项。继承写条件在 SDK/CLI/MCP 读取适配中清理或不发送；显式 CLI 写键及 MCP 额外字段被拒绝。

## 查询与游标

按 started_at 降序、session_id 的 C 排序升序，游标精确保留 UTC 六位微秒时间和 ID。绑定摘要包括版本、tenant/workspace/project、restricted 读取能力、规范化 query/status/client_id 和实际页大小。改变范围、能力、筛选或 limit 后必须从首屏重新读取；省略 limit 与显式 25 等价。

游标编码是可检查的位置与查询绑定，不是签名、权限凭据或不可篡改的历史证明。每页仍重新执行正常权限与项目可见性过滤。不同页读取不同数据库快照，新增、状态变化和权限变化可能使后续结果不同；has_more 只描述本次读取时存在额外匹配行，不保证下一次非空，不提供冻结历史或总条数。

查询先在 MATERIALIZED CTE 中按范围/父项目/筛选/游标选 limit+1 个会话，再只为这些候选读取运行与工具计数以及最新检查点。运行/工具表通过全局唯一 session_id 外键归属已授权会话，不虚构它们不存在的范围列；检查点另核对完整范围。计数与版本以十进制文本读取，显式拒绝非规范或超出 JavaScript 安全整数范围，避免 count::int 溢出或静默舍入。

`046_session_registry_pagination.sql` 仅增加匹配 scope、started_at、C 排序 ID 的索引文件，没有执行。已有 027 工具调用分页索引可用于 session_id 前缀计数，但也仍未执行。索引/页大小不保证查询耗时、聚合计数成本、数据库并发或总进程内存上限。

## 完整响应

```text
{ schema_version:1, trace_id, scope, source_refs,
  data:[{ session_id, client_id, actor_id, parent_session_id, resume_origin,
          status, version, started_at, ended_at, trace_id,
          run_count, tool_call_count, checkpoint_id, checkpoint_revision }],
  has_more, next_cursor?, session_permissions:{write_sessions}, session_identity? }
```

source_refs 固定为 postgres 的 wcp_sessions/wcp_agent_runs/wcp_tool_calls/wcp_session_checkpoints，顺序固定。started_at 为 UTC 六位微秒，ended_at 为 UTC 毫秒或 null；version、计数、checkpoint_revision 是安全整数，parent/resume_origin/checkpoint 的空值保持显式 null。旧无 resume_origin 的历史记录保持 null，不补造来源。

共享解析器校验完整范围/trace/来源/字段、状态与结束时间一致性、父子及续接引用、检查点 ID/版本成对、数据唯一性及严格排序。续页所有记录必须位于原游标之后；返回游标须指向本页最后一行、保持绑定键，has_more=true 必须是满页。status/client_id 精确筛选也独立核对；query 大小写匹配由数据库负责。失败不返回部分页或假零。权限提示和可信身份元数据只用于后续准备，实际写命令重新授权。

成功完整 JSON 最多 2 MiB；损坏数据库结果或元数据为 SESSION_REGISTRY_INVALID/500，数据库失败保留既有不可用错误。该大小上限在对象解析后校验，不能限制数据库读取前已经存在的超大历史字符串。

## 客户端与工作台

同日源码复核修正：旧批量工具注册中仍包含 sessions，导致重复 list_sessions 覆盖专用分页 schema。已移除旧注册并让 registry 对重复工具名直接拒绝，避免静默覆盖；未运行或测试。

SDK `listSessions(query?, options?)` 返回完整 `SessionRegistryEnvelope`，选项 `WcpSessionRegistryOptions` 支持 timeout_ms/signal，默认本地 30 秒。网络使用 bounded-json：成功 2 MiB、错误 16 KiB，完整 200/trace/媒体类型/UTF-8/长度检查；Fetch 自身期限独立生效。自定义 transport 接受同样的完整对象解析与本地等待预算；同步解析后检查截止时间，超时不取消已派发数据库工作。有限错误消息保留原 trace，不回显上游详情；不自动翻页、重试或保存。

CLI `sessions list` 支持无 JSON 或 query/status/client_id/limit/cursor 查询 JSON。网络 main 继续支持 `--json`/`--json-file` 二选一，嵌入 runWorkctx 使用 `--json` 且限制其文本 16 KiB；拒绝重复选项和写键。两条入口使用 SDK，固定项目/本次 trace，输出一页完整封套；网络固定本次令牌，等待默认 30 秒。该命令没有新增文件保存或 outbox，网络 main 仍沿用通用输入文件读取路径，不宣称文件读取包含在网络预算内。

MCP 新增 `list_sessions`，严格 schema 和独立适配器只准备固定 sessions 查询，清理写条件，结果按原请求快照校验。成功仅接受 200 与匹配 trace 响应头，返回完整封套的单项文本 JSON；只读、非破坏、幂等注解不表示结果不变化，也不是自动翻页或重试许可。没有新资源 URI。该工具复用既有 MCP HTTP 等待/限流，不新增独立准备名额、后台取消或 HTTP 发送容量保证。

Web 在服务端先解析筛选并读取一页，成功/错误正文各限 2 MiB/16 KiB，30 秒本地等待、严格响应头/完整封套校验；读取失败不显示旧成功数据。表单筛选重回首屏，行选择保留当前游标，下一页保留筛选并清除旧选择，提供首屏入口。统计卡只汇总当前页，运行/工具总数使用整数累计避免舍入；精确 client_id 用输入框，不把当前页的客户端集合当全量选项。

明确选中的记录不在本页时不会退回其他会话；提供按 ID 的独立详情入口。父会话链接直接进入独立详情，保留状态/检查点/未知请求恢复能力；目录读取失败仍可通过 ID 查找及重回首屏。目录中的审计导航带原 session_id，目标页面独立检查 audit.read。

## 兼容和未完成项

这是源码阶段同一路径的行为替换：旧无参数 listSessions/工作台查询现在只返回首个 25 条；消费者必须显式读取 next_cursor。新增 scope/has_more，started_at 固定微秒、版本和计数固定安全整数。旧 fixture/Mock/跨端消费者需同步迁移，不能把原全量断言作为新分页证据。

没有新依赖；016–046 迁移均未执行。数据库计划/性能、排序与分页边界、跨项目/受限项目、身份提示、客户端兼容和 UI 旅程均没有运行证据。任务及 R-004 保持未完成。
