# 原同步事件回执查询（开发契约）

2026-11-05，TODO P0-01：新增 [同步上传 OpenAPI](../../../packages/contracts/openapi/sync-upload.json) 与 [原投递 Schema](../../../packages/contracts/schemas/sync-original.json)，定义完整原身份/原事件、recorded/not-observed、历史投递及无外层游标的封套。保留 null/省略默认值与历史扩展回显，规范指纹比较不证明保存原 JSON 字节。当前父项目/来源/历史/冲突权限、完整事件核对、查询后到期与2 MiB边界按现存实现记录；认证后原始读取仍不是 fatal UTF-8/整操作期限，同名 SYNC_STORAGE_UNAVAILABLE 此读取 retryable=false，而上传包装为true。未改运行实现或执行校验器/生成器/编译/类型检查/测试/接口/数据库及发布；P0-01/R-001 未完成、evidence 为空。

2026-11-03：仅源码与文档接入，未编译、类型检查、测试、执行 SDK/CLI/API、启动服务、打开数据库或发布。无新依赖、schema 或迁移；PostgreSQL 016–049 及先前 SQLite 三列升级均未执行。此增量不代表 R-005 或同步恢复闭环完成。

## 输入与身份

新增 `sync.event.receipt` / `POST /v1/sync/events/receipt`，只查询一条原事件。JSON 精确包含 `{identity,event}`：identity 为原 tenant_id/workspace_id/project_id/actor_id/client_id，event 为原上传事件全文，保留可选字段存在状态、额外字段和数组顺序。不要将整个 outbox 行、expected_identity 或批次封套直接当作查询输入。

原事件使用共享上传快照校验；单事件放入 `{events:[event]}` 后仍须不超过 1 MiB。完整查询上限为 1 MiB + 16 KiB；只接受有限普通 JSON，拒绝访问器、非普通原型、符号、循环、稀疏数组、undefined、非有限数字和超过共享深度/节点限制的值。原事件若显式携带五项身份字段，必须与 identity 一致。

Gateway 要求可信未过期的 sync.write/admin 身份，并经过现有 Policy/入口 Audit；五项身份均须与可信上下文匹配。只读入口仍会留下既有访问审计，不写同步事件、批次回执、冲突或本地队列。SDK 发送两个预期身份头作为前置条件，头不会覆盖令牌身份。可用同一账号/客户端的新令牌；当前账号不能代替未知的历史发送者。

HTTP 只接受 POST JSON，无查询参数、批次键、版本/缓存/范围条件或 Content-Encoding；鉴权后才有界读取正文。直接 router 输入同样拒绝外层 idempotency_key/expected_version。网络返回 private/no-store，沿用当前请求 trace。

## 查询语义

查询在 repeatable-read 只读事务中核对当前父项目可见性，再按原五项身份和 event_id 查找现有 wcp_sync_uploads。它不依赖某次 claim 的批次键，也不重新发送原事件。

| data.status | 含义 | 边界 |
|---|---|---|
| `recorded` | 找到匹配的原投递和完整持久事件 | receipt.accepted=true 为 ClientEventRecorded；false 为已记录的 ConflictDetected |
| `not-observed` | 本次读取快照未观察到该原身份/event_id 的上传记录 | 不证明失败、回滚、从未发送或稍后不会提交；没有 receipt，source_refs 为空 |

只有记录行不存在才能返回 not-observed。并发上传可能在读取快照之后提交；曾因校验、游标或来源问题被拒绝的上传也可能没有逐事件记录。该入口不返回旧批次的所有拒绝原因，不确认整个批次，也不决定能否安全重发。

recorded 的 receipt 精确包含 event_id、accepted、server_event_id、正安全整数 server_cursor、original_trace_id、规范 UTC recorded_at，以及固定 `source_application='not-checked'`；accepted=false 另有必需 conflict_id。source_refs 只引用对应 sync-event。外层 trace 是本次查询，original_trace_id 和 recorded_at 来自原历史事件。

服务器按既有 parseSyncUploadEvent 和 SHA-256 指纹规则核对原内容，默认 sensitivity=internal、source_refs=[]；原指纹规则和旧记录不变。这证明既有规范化上传内容匹配，不证明服务器曾保存原 JSON 字节、键顺序、被规范化丢弃的额外字段或可选字段的原始写法。响应回显调用方提供的完整事件，客户端逐字段核对；回显本身不是服务器存储原文的证据。

同时核对原事件范围、发送者、客户端游标、聚合/事件类型、来源引用、分类、关联实体及历史 payload。FieldChangeProposed 的冲突记录还核对不可变原版本、字段和值；解决冲突后原投递仍为 accepted=false，并不因此改成 accepted=true。此接口不报告当前冲突解决状态，不证明源实体已应用、当前版本或下载消费已完成；这些需要相应独立读取。

## 可见性、错误与限制

当前项目必须可读；有关联来源时，来源仍须存在并可读。历史事件及关联冲突的敏感级别也须允许读取。不可见返回 NOT_FOUND，不能替换成 not-observed。已有上传行的事件缺失、形状损坏、不安全游标或元数据超限返回 SYNC_EVENT_RECEIPT_INVALID；可见记录的原事件 ID 与规范化指纹不符返回 EVENT_ID_REUSED（409），不覆盖原记录。存储不可用为 SYNC_STORAGE_UNAVAILABLE，认证过期/身份不符拒绝查询。

SQL 输出元数据和完整成功封套各限制 2 MiB，超限不截断、不返回部分回执。SQL 仍需构造元数据后测量大小，此限制不是数据库执行成本或全局内存上限。SDK 再核对独立原输入、完整封套、当前 trace、身份、事件、来源及状态形状，非法成功响应转为 GATEWAY_RESPONSE_INVALID。

## SDK 与 CLI

`client.getSyncEventReceipt({identity,event}, {timeout_ms?,signal?})` 默认本地等待 30 秒，允许 1–2147483647 毫秒。固定原输入后，给传输另一个副本，使用 bounded-json，成功上限 2 MiB、错误上限 16 KiB；返回前再次检查期限。Fetch 自有预算与方法预算中先到者生效，超过默认时间须同时配置两者。同步解析不能中途抢占；自定义传输须尊重上限和 signal，本地结束等待不证明底层请求已取消。

错误仅保留允许的代码、固定文案和本次 trace，retryable=false；不透传上游原始 message/details。不自动获取新身份、重试、生成键、保存文件或修改队列。可用只含三层范围及 trace 的 WcpClient 支持普通字符串账号；上下文若已给出 actor/client，则必须与原身份相同。

CLI 使用已保存的查询文件，示例仅说明用法，未执行：

```text
workctx sync receipt --json-file original-sync-query.json
workctx sync receipt --json-file original-sync-query.json --timeout-ms 30000
```

也允许 `--json ORIGINAL_QUERY`，两种输入只能选一个；拒绝 stdin `-`、写键、重复/未知参数。文件必须为上限内的稳定普通文件，严格解码 UTF-8/JSON；文件读取失败为 SYNC_RECEIPT_FILE_UNAVAILABLE，格式/参数问题为 USAGE_ERROR。网络和嵌入入口均复用 SDK；嵌入适配还检查准确路径、头、完整原正文以及调用前后的可信权限与到期时间。

退出码 0 仅表示本次查询完成，包括 not-observed；用法错误为 2，查询失败为 1。不打开 SQLite、不更新 sent/conflict/failed、不重置尝试、不触发 flush。调用方继续保留原身份、原事件和已有回执。

## 后续范围

MCP 已新增 get_sync_event_receipt({identity,event}) 和可信身份读取，保留原事件并核对完整结果，另有准备容量/期限/输出边界，见 [MCP 原同步读取](sync-mcp-runtime.md)。工具只读取，不接管本地结算或旧 uploader。

后续源码已新增独立 [本地核对与结算](outbox-reconciliation-runtime.md)：outbox reconcile 对指定完整原行查询回执后，事务内再次比对原行/租约，再明确结算；本页 sync receipt 仍仅查询。旧行身份追溯或人工绑定尚未提供，当前身份读取与本次回执不能成为自动补写旧身份的依据。Web 对应查询入口、旧消费者/Mock/fixture 迁移、断线/并发/迟到响应/重启运行证据均待补齐。既有 flush 的退避/重试策略不变，不能据此声称所有队列重试已先查回执。详见 [原同步身份](sync-identity-runtime.md) 和 [同步上传](sync-upload-runtime.md)。
2026-11-03 Web 读取补充：工作台 `/sync/receipt` 接入原查询/回执文件载入、显式只读查询及结果导出。同源代理固定原身份/事件、当前签名会话范围和预期身份头，使用有界完整正文与本地期限；导入历史与本次远端结果分开展示，失败保留原请求/先前完整响应。见 [工作台回执契约](sync-web-receipt-runtime.md)。无本地结算、自动上传/重试或共享格式变化；仅源码文档，未编译、测试或运行。
