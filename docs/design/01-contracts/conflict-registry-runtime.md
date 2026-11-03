# 冲突元数据目录分页

更新：2026-11-03。仅源码与文档开发，未编译、类型检查、测试、调用接口、运行浏览器或服务、执行迁移、部署或发布。R-006 保持未完成。

## 接口与兼容性

`GET /v1/conflicts` / `conflict.list` 和 `POST /v1/workbench/query` 的 `operation=conflicts` 共用分页读取与完整响应解析。默认 25 条，limit 为 1–100 的整数。此增量替换旧全量列表形状；调用者不能再把一次响应当成全部冲突，不能从列表取双方值、选中值、逐条 source_refs 或决策事件。完整值和历史决策需使用独立 `GET /v1/conflicts/{conflict_id}`，见 [独立详情](conflict-read-runtime.md)。旧 `WcpConflict` 类型保留但标记废弃；当前 SDK 返回 `ConflictRegistryEnvelope`。

| 字段 | 规则 |
| --- | --- |
| query | 最多 500 个 UTF-16 单元，去除首尾空白，空串视为未筛选；拒绝控制字符及孤立代理项 |
| status | open 或 resolved；空串视为未筛选 |
| entity_type | 既有同步标识符，精确匹配；空串视为未筛选 |
| conflict_id | 既有冲突详情标识符，精确匹配；不能为 `.` 或 `..` |
| limit | 默认 25，最多 100 |
| cursor | 最多 2048 字符的规范 Base64URL，显式续页时保留原筛选及页大小 |

所有筛选取交集，拒绝未知字段。公共 GET 拒绝重复参数、正文 framing、写入条件、Range 和条件缓存头。HTTP query 的 limit 先按规范正十进制解析再校验范围；Workbench、SDK、CLI JSON、MCP 使用数字。可信上下文仍通过 context.read 策略与入口审计；读取不接受上下文写入键或 expected_version，CLI/MCP 嵌入入口清除继承的写条件。

query 仅在 conflict_id/entity_type/entity_id/field/actor_id/trace_id 六项元数据中做字面子串匹配，只折叠 ASCII A–Z。百分号、下划线不是通配符；不查复制值、不做 Unicode 大小写或规范等价转换。排序固定为 conflict_id 的 PostgreSQL UTF-8 `COLLATE "C"` 升序，共享解析按 Unicode 标量顺序核对，避免 JavaScript UTF-16 排序对非 BMP 字符产生不同位置。状态不是排序键。

## 范围、位置与返回

SQL 在同一语句中读取当前可见父项目和页面；父项目须匹配 tenant/workspace/project、未删除且分类合法。复用 `visibleConflicts`，以保存分类和来源当前分类/可见性控制冲突。restricted 需要当前 data.restricted.read。不可读父项目返回 404/NOT_FOUND；可读项目没有匹配记录时返回空页。

游标格式是 UTF-8 JSON `[1, binding, conflict_id]` 的无填充 Base64URL，解码后重新编码核对规范形式。binding 为 SHA-256，覆盖版本标记、三层范围、受限数据读取能力、ASCII 折叠后的规范 query、status/entity_type/conflict_id 和 limit。Gateway 在查询前核对 binding，拒绝失效或不匹配游标，不自动改读首屏。该摘要不是签名或权限凭据，客户端可构造位置；每次仍重新授权并按当前可见性查询。

SQL 读取 limit+1 个位置，仅为前 limit 条构造元数据，第一个额外位置不读取值或完整元数据。`has_more=true` 必须对应完整 limit 条及最后一条 ID 的 next_cursor；false 不返回 next_cursor。共享解析核对记录数量、唯一升序、原游标下界、每项筛选、末条游标和续页 binding 一致性。SDK 不自行推导服务器权限绑定，服务器负责核对请求绑定。

封套含 schema_version=1、三层 scope、请求 trace_id、source_refs=`[{type:postgres,id:wcp_conflicts}]`、data、has_more、可选 next_cursor 和 conflict_permissions.resolve。每条 metadata 固定包含 conflict_id/entity_type/entity_id/field、base/local/server/version 四个十进制字符串、status、可空 resolution/actor_id、记录 trace_id。版本最大为 signed BIGINT，冲突 version 为正，其余允许零。open 的 resolution 必须为空；resolved 可保留旧记录缺失的 resolution。

resolve 提示只在 authenticated_client 为 true 且具备 conflict.resolve 或管理员角色时为 true；它不是写入授权或原请求回执。写入仍使用原 Gateway 决策流程重新核对。目录本身不返回身份、写入键、指纹、ETag 或源实体已应用标志。

页是实时视图，不是冻结快照。新增、更改筛选字段、权限变化和删除会影响后续页；新增在当前位置之前的 ID 不会在本轮后续页出现。页内数量不是项目总量。空页也不证明隐藏冲突不存在。

## 大小、客户端与界面

每条元数据最多 16 KiB UTF-8 JSON，完整业务封套最多 2 MiB。SQL 限制输出 ID 和元数据大小；损坏、缺字段、超限或不一致返回 500/CONFLICT_REGISTRY_INVALID，不截断字段或跳过坏记录伪装成功。显式 has_conflict 区分真实空页和超大 ID 被限制后的空输出。存储不可用沿用 WORKBENCH_DATABASE_UNAVAILABLE。

SDK `listConflicts(query?, options?)` 支持 timeout_ms/signal，默认一次本地 30 秒，使用 bounded-json，成功最多 2 MiB、错误最多 16 KiB。Fetch 校验成功 200、trace 头、媒体类型、UTF-8 和完整字节；完整解析后再次检查期限。网络 CLI `conflicts --json/--json-file` 走相同 SDK；嵌入 CLI 只接受一次 --json，原文本最多 16 KiB，固定上下文/请求并核对传输形状。拒绝重复参数及写键，不自动翻页、重试或入 outbox。

MCP `list_conflicts` 接受上述字段，固定原请求、检查 200 和原 trace，并复用完整封套解析。2 MiB 只限定内层业务 JSON；本增量没有新增 MCP JSON-RPC 二次转义/发送、准备容量或本地期限保证。

Web `/conflicts` 将筛选交给服务端，显示当前页计数、首屏/下一页和独立详情链接。类型输入为精确自由文本，不以当前页类型冒充全局可选项。selected item 与目录 conflict_id 筛选分开，显式选择可以不在当前页；比较面板单独按 ID 读取，失败局限在面板，目录和查找入口保留。版本和 JSON 文本原样显示。

现有决策表单仅在读取到的版本可由旧数字命令安全表示（冲突自身版本还需可加一）时提供。后端旧决策写事务仍使用 JavaScript 数值和解析后的复制值；此增量不声称支持任意精度决策写入。筛选、翻页、选择和审计导航在新标签页打开，原页的已编辑表单保留。原请求独立恢复、持久草稿及未知写入结果闭环尚未完成；新标签页查看不等于恢复了原请求。

## 迁移与待办

新增 `049_conflict_registry_pagination.sql`，只包含范围/ID 和范围/状态/ID 索引及迁移记录；未执行，016–049 均仍未执行，无新增依赖。限制只覆盖页面输出及客户端等待，不保证数据库内部排序/扫描/JSON 构造成本、全进程分配或底层取消。

Gateway/SDK/CLI/MCP/Web 的直接消费者已迁移源码。MockWcpServer 仍只覆盖旧项目创建路由，没有冲突目录替身；共享 fixture、外部旧消费者和兼容性证据仍待补齐。实际 SQL、Unicode 顺序、跨范围和权限变化、游标失效、超限/超时、页面导航及表单反馈均未运行验证，不以源码检查代替证据。

后续源码增量已新增 [原请求回执查询](conflict-receipt-runtime.md) 及独立 Web 导入页。旧决策表单尚未保存完整原身份/请求，固定原请求重发及持久恢复仍待开发；回执入口不根据当前目录生成请求。
