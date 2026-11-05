# 原消费者确认与当前游标读取（开发契约）

2026-11-05，TODO P0-01：新增 [同步消费 OpenAPI](../../../packages/contracts/openapi/sync-consumer.json) 和 [消费者 Schema](../../../packages/contracts/schemas/sync-consumer.json)，定义当前位点空 HTTP 查询、本地原身份选择、明确确认正文及两类完整成功。无记录和已确认到零分别保留 recorded=false/true；读取不比较流高水位，确认同值不刷新 updated_at，回退拒绝。确认提交后的最后会话检查可能拒绝已写入结果，须保留原身份/目标；当前位点不是原请求回执或本地保存证明。精确记录 GET 身份头独立可选、POST 头成对或均省略、认证前通用 1 MiB 正文与共享 16 KiB/32 KiB 预算差异。仅源码契约，不改运行实现；未编译、类型检查、测试、运行校验器/生成器/接口/数据库或发布，P0-01/R-001 未完成、evidence 为空。

2026-11-03：仅源码与文档，未编译、类型检查、测试、调用 SDK/MCP/CLI/API、打开数据库、执行迁移、运行服务或发布。复用 014_sync_acknowledgements，无新依赖/schema/迁移；PostgreSQL 016–049 与先前 SQLite 升级仍未执行，R-005 未完成。

## 原身份与明确确认

POST /v1/sync/ack / sync.ack 现要求完整普通 JSON `{expected_identity,cursor}`，其中 expected_identity 精确包含原 tenant_id/workspace_id/project_id/actor_id/client_id，cursor 为非负安全整数。参数最多 16 KiB，拒绝额外字段、非有限 JSON、批次键、版本条件；HTTP 只接受 JSON，无查询、写入/缓存/范围头。此为旧接口有意收紧：只有 cursor 的旧 REST/SDK/MCP/CLI 调用会失败，不能从当前账号静默补原身份。

发现/执行要求 authenticated_client=true、有限未过期 token_expires_at、sync.read 或 admin，继续经过原 Policy/Audit。完整原身份与可信上下文逐项一致，预期账号/客户端头只作前置条件，不能覆盖身份。数字 cursor 不绑定账号或项目；必须将完整身份、已持久保存的页面与目标游标一起保存后再明确确认。服务器不能证明调用方真的持久保存了页面，不把调用参数当作本地保存证据。

Gateway 先完整解析原命令并准备可表示的成功封套，再进入数据库写事务。事务内按范围和当前分类权限锁定可见父项目，拒绝缺失/隐藏/已删除项目；核对流高水位为安全整数，拒绝超前 cursor。既有按五项身份唯一键的 upsert 保持单调：相等可重复确认且 updated_at 不推进；低于已保存位点返回 CURSOR_REGRESSION，不回退。核对 RETURNING 的十进制原值等于请求 cursor，写入前及提交前重新检查身份权限提示和到期。身份/目标与上下文均有独立快照。

确认不写同步事件、不应用 payload、不修改上传 outbox、不创建请求键或历史回执。凭据检查与数据库提交并非同一原子步骤；提交/响应中断或之后到期仍可能产生已提交但未确认的结果。保留原身份和目标，不根据异常宣称回滚。

成功完整封套为 schema_version=1、当前 trace_id、一个 `sync-cursor` 来源、server_cursor=原 cursor，data 为 `{identity,client_id,cursor}`。identity 全量回显并与原请求一致；来源 id 为原 client_id + ':' + cursor。保留旧 client_id/cursor 字段，增加身份绑定；完整业务封套最多 32 KiB。只确认这个目标已由此次事务返回，不证明本地内容、源投影或更晚的服务器位点。

## 当前位点读取

新增 GET /v1/sync/cursor / sync.cursor，不接收参数、请求体、查询或写入/缓存/范围条件。身份前置条件可由预期账号/客户端头提供。与确认使用相同可信 sync.read/admin 权限；父项目可见性与五项身份的 acknowledgement 在同一只读事务语句中连接读取，不扫描其他消费者、不读取事件正文。

data 精确包含 `{identity,cursor,recorded,expires_at,permissions:{acknowledge_sync:true}}`，server_cursor 为本次读到的确认位点，**不是流高水位**。没有记录时 recorded=false、cursor=0、source_refs=[]；明确确认过 0 时 recorded=true、cursor=0，仍有 `sync-cursor` 来源。记录损坏、非安全值或封套无法表示返回 SYNC_CURSOR_INVALID；缺失/隐藏项目返回 NOT_FOUND，数据库不可用返回 SYNC_STORAGE_UNAVAILABLE，均不伪装为 0。

identity 来自可信当前会话，expires_at 为同一会话规范 UTC 到期时间，交付前重新检查未过期。初次准备新消费者可读取并保存该身份；已有消费记录或未知确认必须带原身份约束，不能用新读取的身份覆盖缺失/不同的旧身份。权限提示只描述当前操作，不保证未来权限或本地数据完整。

这是当前状态查询，没有原请求键/原 trace/历史确认记录。读到 recorded=true 且 cursor >= 原目标，只说明同一消费者当前位点已覆盖该数字，可能由另一次确认推进；不证明某次原请求成功或本地已保存。读到较小位点或无记录，也不证明仍在途的确认以后不会提交。查询不会自动重试确认、调整目标、下载页面或结算本地状态。

## SDK 与固定下载

`getSyncCursor({expected_identity?,timeout_ms?,signal?}={})` 返回当前完整位点封套，可选原身份同时约束范围与账号/客户端头并校验回显。省略时仍核对 SDK 上下文已有 actor/client；普通字符串账号可由只带项目范围的客户端读取后保存，不能借此补认旧记录。

`acknowledgeSync(cursor,{expected_identity,timeout_ms?,signal?})` 必须显式提供原身份，不接收键或版本；SDK 上下文已有身份约束也须一致。完整命令、选项和上下文在等待前固定，传输接收独立副本，完整响应按另一份原命令核对。旧单参数方法调用需迁移。

两方法使用 bounded-json，成功最多 32 KiB、错误最多 16 KiB，默认本地 30 秒，可配置 1–2147483647 毫秒及取消信号。方法预算在参数准备后开始，覆盖传输、完整解析及交付前检查；Fetch 自身预算取先到者，延长等待需同时配置。同步工作不能抢占，自定义 transport 忽略 bounded-json/signal 时无法约束其内部执行与缓冲。

错误为固定白名单代码/文案及当前 trace，retryable=false，不回显上游正文/details。确认失败带适配器生成的 details.dispatch_state：调用 transport 之前 not-sent，之后 unknown；只描述本次调用，不证明过去没发送或远端回滚。超时/取消后不会自动查询或重发，调用者可显式 getSyncCursor({expected_identity:原身份})。

getSyncChanges/syncPages 选项另增加可选 expected_identity，准备时核对并复制，固定整个迭代的预期身份头。get_sync_changes MCP 参数也支持该字段，额外身份只作为前置条件，不进入 HTTP 查询或数据库业务输入。ApiGateway 对下载和当前位点读取校验给定身份头（允许只约束一个字段，拒绝重复头）；确认/上传仍要求给定身份头成对存在。新流程可以先保存 getSyncCursor 返回身份，再用同一身份读取页面及明确确认。下载响应仍不回显消费者身份，真实传输/可信 Gateway 是身份前置条件的执行边界，不信任任意自定义 transport。

## MCP 与兼容范围

新增 get_sync_cursor，参数仅可选 expected_identity；迁移 acknowledge_sync，参数必填 expected_identity/cursor。两者发现与调用均检查可信未过期 sync.read/admin；读取清除继承键/版本，确认拒绝任何继承键/版本。get_sync_cursor 的可选原身份仅用于本地核对与前置条件头，内部实际 GET 无正文。readOnlyHint 分别为 true/false，idempotentHint=true 不等于自动重试许可。

专用执行器共享同一实现，**读、写分别各有每 ApiGateway 两笔准备容量**，不与变化页/上传/原事件回执名额混用，保留显式恢复读取空间。均为 30 秒单调本地期限，满额 MCP_SYNC_CURSOR_BUSY；超时 MCP_SYNC_CURSOR_TIMEOUT，底层结束前继续占名额，迟到成功不交付。API 接收独立请求，完整成功核对 200、JSON 媒体类型、当前 trace、原身份与游标；读取到期时间还须与可信上下文完全一致。

完整业务成功 32 KiB、原错误 16 KiB、二次转义 MCP text result 64 KiB + 4096 字节；不包含协议最后追加字段、RPC id 或 HTTP 发送，也不是全局内存/数据库成本限制。确认错误由适配器设置 not-sent/unknown，忽略上游同名详情。读不会自动确认，写不会自动读位点。

## CLI 消费与显式查询

sync changes、sync ack 与新增 sync cursor 已接专用适配；main 在通用文件读取前分流，直接 callGateway 同样使用 SDK，嵌入 runWorkctx 使用固定传输适配。读取可省略 JSON，changes 仅 cursor/limit/expected_identity，cursor 仅 expected_identity；ack 必须提供保存的 expected_identity/cursor。保留 --json 或 --json-file 二选一兼容，输入限 16 KiB，文件须为读取前后大小/时间一致的普通 UTF-8 文件，可有 BOM。禁止 stdin、重复/未知选项、额外字段、--key/版本，不新增 reviewed 标志，也不从当前身份填补确认输入。

三者 --timeout-ms 默认 30000、允许 1–2147483647，同时配置 SDK 和 HTTP 传输；本地输入读取不计入网络期限。完整下载成功最多 4 MiB，确认/当前位点最多 32 KiB，网络错误最多 16 KiB；输出保留完整业务封套。嵌入要求可信未过期 sync.read/admin，读取清除继承键/版本，确认拒绝继承键/版本；固定原身份、路径/头/正文和独立输入/上下文，读取当前位点核对完整可信身份及精确到期。网络上下文只放三层范围，兼容普通字符串 actor；原身份通过前置条件头与确认正文绑定。

确认派发状态由适配器掌握：参数/文件/本地授权失败 not-sent，网络进入 transport 后或嵌入调用 router 后 unknown；不采用上游同名详情。SDK 截止等待后底层 router 可能继续，迟到结果不自动交付或触发其他命令。sync cursor 只读当前确认，不证明某次历史请求或本地消费成功；调用者显式用保存的 expected_identity 查询。无自动翻页、确认、重试、查询、应用事件或本地保存。

消费者本地事务保存、关闭进程后的消费位点恢复、权限变化重放、旧 Mock/fixture/消费者迁移及真实并发/断线/提交不确定性证据仍待补齐，不能把源码当作已运行闭环。本次无依赖/schema/迁移，未编译、类型检查、测试、运行或发布。
2026-11-03 CLI 本地恢复增补：sync changes --output 已可保存完整页面/原身份/显式起点及摘要，sync inspect --page-file 离线核验，changes/ack/cursor --page-file 从完整核验文件派生原输入。保存不代表事件应用或历史确认；目录持久性、全局本地消费事务与整链连续性仍未实现，见 [本地同步页面文件](sync-saved-page-runtime.md)。上文普通输出行为适用于未指定 output/page-file 的调用。
