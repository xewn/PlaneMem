# 同步变化完整分页与有界读取（开发契约）

2026-11-05，TODO P0-01：新增 [同步消费 OpenAPI](../../../packages/contracts/openapi/sync-consumer.json) 与 [完整变化页 Schema](../../../packages/contracts/schemas/sync-changes.json)，复用 [消费者身份 Schema](../../../packages/contracts/schemas/sync-consumer.json)。保留事件与来源扩展字段，明确省略游标与显式零不同、权限过滤导致跳号、逐请求快照和无自动确认；完整业务 payload 尚未建模。有效 canonical 存储事件会展开并核对标识，不符合 canonical 形状的旧记录沿既有 payload 包装路径，不直接视作 canonical 损坏。现有 changes 没有独立父项目可见性查询、canReadSyncStream 检查或读取后到期复查；Policy/事件过滤不能替代这些边界。仅描述源码，未改运行实现或运行接口/校验器/生成器/编译/测试/数据库；P0-01/R-001 未完成、evidence 为空。

2026-11-03：仅源码与文档，未编译、类型检查、测试、调用 SDK/MCP/CLI/API、启动服务、打开数据库、执行迁移或发布。无新依赖/schema/迁移；PostgreSQL 016–049 与先前 SQLite 升级仍未执行，R-005 未完成。

## 查询与完整页面

复用 GET /v1/sync/changes / sync.changes。查询仅接受可选 cursor（非负安全整数）及 limit（1–500，默认 100），普通 JSON 最多 4 KiB。拒绝额外字段、显式 null/undefined、访问器、非普通原型或其他非有限 JSON。HTTP 仅接受这两个单值整数 URL 参数，无请求体、范围/缓存或写入条件。省略 cursor 仍从当前可信账号/客户端的服务器 acknowledgement 开始；显式 cursor=0 才是从零读取，失败不会回退成零。

共享 parseSyncChangesEnvelope 被 Gateway 返回前、SDK 和 MCP 使用，完整业务封套最多 4 MiB，沿用 syncJsonSnapshot 的深度 64/节点 100000 限制。顶层精确为 schema_version=1、当前 trace_id、source_refs、server_cursor、data；data 精确包含 tenant/workspace/project、changes、next_cursor、has_more。拒绝额外外层字段、范围不符、水位不一致或低于请求 cursor。

每页最多请求 limit 条，event_id 唯一、server_cursor 严格递增且大于已知请求 cursor、不超过 next_cursor；event_type、历史 trace、source_refs 与对象 payload 必须有效，accepted=true。事件若带三层范围字段，必须与本页一致。顶层来源必须等于按页面事件顺序拼接的来源，保留重复引用和额外字段；对象键排列不影响比对。历史 trace 无须等于本次请求 trace。

has_more=true 时必须恰好有 limit 条且 next_cursor 等于末条游标；has_more=false 时允许空页，也允许 next_cursor 大于末条游标，因为权限过滤可能跳过不可见事件。无效/超限页面整体失败，不截断、不交付部分事件、不移动确认游标。Gateway 返回 SYNC_CHANGES_INVALID（HTTP 500）而非伪造空页；调用者可保留原 cursor，显式调小 limit 再读，不能保证单条超大历史事件能通过该边界。

共享解析校验流记录和分页边界，原事件 payload/附加历史字段完整保留为参考数据，不证明任意事件专有 schema、当前来源可见性、投影应用或调用者已持久化。Gateway 原有数据库事务、权限过滤和 canonical 验证继续执行；旧非 canonical 记录包装兼容保留。每页为独立数据库读取，跨页不是固定快照。当前可见性不授权应用历史内容。

## SDK

`getSyncChanges(query={}, {expected_identity?,timeout_ms?,signal?}={})` 使用 bounded-json，成功正文限 4 MiB、错误限 16 KiB。默认本地单页等待 30 秒，timeout_ms 为 1–2147483647；查询/上下文/选项在等待前固定，传输只接收另一个请求对象。Fetch 校验 HTTP 200、当前 trace 响应头、JSON 媒体类型和完整正文；共享解析再次核对业务封套。可选 expected_identity 为保存的原消费者五项身份，准备时与范围及 SDK 已有身份约束一致，发送完整预期账号/客户端头；迭代时固定该副本。不提供时沿用上下文已有约束，否则由当前 token 决定账号/客户端。下载不新增原身份回显，真实传输和可信 Gateway 执行身份前置条件；任意自定义 transport 不能因此视为可信。

方法预算在本地参数准备后开始，覆盖传输等待、解析和交付前检查；同步 CPU 工作不能中途抢占。Fetch 自己的预算与方法预算取先到者，延长等待需同时配置。取消/超时只结束本地等待，不证明服务端查询/审计停止。自定义 transport 须尊重 bounded-json/max_response_bytes/signal，忽略约束的内部缓冲和执行不受 SDK 保证；不退回无限正文模式。错误只输出白名单代码、固定文案、当前 trace，retryable=false，不透传正文/details、不自动重试。

`syncPages(query={}, options={})` 仍为按需异步迭代，调用时固定 query、SDK 上下文和选项，第一次 next() 才请求。每页有独立预算，使用者处理页面的间隔不计入；取消信号可阻止后续请求。交出页面前独立保存 next_cursor/has_more，调用者修改页面对象不会改写后续路径；更改原 query/options 也不会影响迭代。未请求 next() 不预取，return()/break 后不读下一页。若调用者主动并发排队多个 next()，遵循异步生成器本身的排队语义，不宣称自动控制调用方处理时序。无效迭代参数在创建迭代器时同步拒绝。

读取及迭代均不保存、应用事件或调用 acknowledgeSync。调用方应先按自己的事务持久保存完整页面、原身份与下一游标，再明确确认；[原消费者确认](sync-cursor-runtime.md) 已另行要求显式身份并支持只读当前位点。WcpSyncChange/WcpSyncPage 继续作为共享类型别名导出，新增 WcpSyncChangesOptions 和 SyncChangesQuery/Request/Envelope 类型。严格参数、完整来源和大小限制会拒绝部分旧 Mock/fixture/非规范响应，兼容迁移尚待补齐。

## MCP

get_sync_changes 工具名和 cursor/limit 参数保留，另支持可选 expected_identity；包含原身份的完整 arguments 上限 16 KiB，内嵌数字查询仍限 4 KiB。发现和执行要求 authenticated_client=true、有限未过期 token_expires_at、sync.read 或 admin，保留 mcp.discover、原 sync.read Policy/Audit 和来源过滤。原身份必须与可信上下文完全一致，转成预期身份头；清除继承写键/版本，arguments 不接受写条件。内部 GET 适配的 body 只承载已解析数字查询，并非网络 GET 请求体。

专用执行器独立固定可信上下文和查询，将另一个副本传入 ApiGateway；成功须为 200、当前 trace 头、JSON 媒体类型和完整共享页面。返回单个 text content，其中为完整封套。MCP 错误正文限 16 KiB；二次转义后的 text result 限 8 MiB + 4096 字节，不含最终 schema_version/trace_id、RPC id 或 HTTP 包装。普通请求体额度不变，不能借用原上传/回执的额外 80 KiB。

每 ApiGateway 两笔下载准备名额，与原身份/回执读取和上传名额分别计算；满额 MCP_SYNC_CHANGES_BUSY，不排队。30 秒单调本地期限从参数准备前开始，超时 MCP_SYNC_CHANGES_TIMEOUT，底层工作结束前保留名额，迟到结果不交付；交付前再次核对会话未过期。容量覆盖准备/执行/解析，不覆盖 HTTP 发送，也不是进程内存、连接数或数据库成本上限。只准备请求的 prepareMcpTool 不提供执行期限/容量。

没有自动分页、保存、重试、ack 或事件应用。accepted=true 只是可见流条目标识，不能当作原上传成功回执；请用保存的 identity/event 查询 [原事件回执](sync-event-receipt-runtime.md)。[确认游标绑定与当前位点](sync-cursor-runtime.md) 已接 Gateway/SDK/MCP/CLI；CLI sync changes 也已通过专用 SDK 路径验证完整有界页，输入为可选 cursor/limit/expected_identity JSON 或稳定普通文件，限 16 KiB，可选 30 秒默认期限。持久消费检查点、权限变化后的重放策略，以及旧消费者/Mock/fixture 和真实跨端恢复证据仍待补齐。
2026-11-03 CLI 本地页面增补：sync changes --output 以显式原身份/起点保存完整页面及摘要，不覆盖已有目标；--page-file 可恢复原消费者/下一游标/页大小，sync inspect 离线核验。仅新增明确选择的单页文件保存，不是自动分页或消费事务，详见 [本地同步页面文件](sync-saved-page-runtime.md)。
