# MCP 原同步身份、上传与事件回执（开发契约）

2026-11-03：仅源码与文档，未编译、类型检查、测试、执行 MCP/SDK/CLI/API、启动服务、打开数据库、迁移或发布。无新依赖/schema/迁移；PostgreSQL 016–049 和先前 SQLite 升级仍未执行，R-005 不因此完成。

## 工具与权限

| 工具 | arguments | 返回 |
|---|---|---|
| `get_sync_command_context` | `{}`，也可省略 arguments | 原身份契约完整封套：当前可信 identity、expires_at、permissions.upload_events=true |
| `get_sync_event_receipt` | 保存的完整 `{identity,event}` | 原事件回执完整封套：recorded/not-observed 及适用历史 receipt |
| `upload_events` | 保存的完整 `{expected_identity,events,idempotency_key}` | 完整原批次上传封套，包含逐事件 accepted/rejected |

工具发现和执行均要求 authenticated_client=true、有限未过期的 token_expires_at，以及实际 sync.write 或 admin 角色。协议握手/工具目录继续经过既有 mcp.discover 策略及审计；操作继续经过原 Gateway Policy/Audit 和可见性判断。两个读取工具的 readOnlyHint=true，upload_events 为 false；三者 idempotentHint=true、destructiveHint=false、openWorldHint=false。只读指不改同步业务记录，重复读取仍可形成访问审计。

身份读取不接受参数，不读取项目目录或原投递。返回身份与到期时间必须和独立保存的可信上下文完全一致，交付前重新检查未过期。该提示用于准备新事件，不证明父项目可见、未来权限或已保存旧事件；不能用于猜测、覆盖或补写旧原身份。

回执必须带原五项身份和完整事件，不带批次键。原身份与可信上下文完全匹配，支持普通字符串账号；原事件可选字段、额外字段及数组顺序保留，不填充新原内容。沿用共享严格 JSON/完整上传快照校验及旧规范化指纹语义，见 [原事件回执](sync-event-receipt-runtime.md)。工具 schema 允许保留原事件额外字段，顶层和 identity 仍拒绝未知字段。

两个读取工具准备请求时清除继承的写键/版本；arguments 中不允许额外写条件。读取实际派发只用固定 GET /v1/sync/commands/context 或 POST /v1/sync/events/receipt；回执附预期账号/客户端头。可信上下文和原查询各自保存，Gateway 只拿另一个副本，不能以可变请求对象替换结果核对基准。

## 原批次上传

upload_events 直接要求 expected_identity、events、idempotency_key 三个字段，顶层不接受其他字段。身份精确五字段，必须与当前已验证身份一致；原事件内若带 tenant/workspace/project/actor/client，也必须一致。events 为 1–100 个唯一事件 ID 的完整普通 JSON 对象，保留额外字段、可选字段是否存在及数组顺序，沿用共享上传快照校验，不重新填充默认值。调用者须先保存原身份、完整批次和键；工具没有文件或队列持久化能力。

显式原键必填，不能由继承上下文补入；继承键存在时必须相同，继承 expected_version 一律拒绝。键遵循既有 1–255 非空白字符约束。固定派发 POST /v1/events:batch，正文只含原 events，键放入上下文和头，原账号/客户端作为预期身份头。不会把 expected_identity 加入持久命令指纹，也不会获取新身份替换旧身份。

执行器独立保留原上下文和批次，只将另一个副本交给 Gateway。成功必须为 200、当前 trace 响应头和 JSON 媒体类型，再以共享 parseSyncUploadEnvelope 校验完整范围、来源、水位、逐事件恰好一次的 accepted/rejected 及历史引用。合法部分拒绝仍返回完整封套，不能将工具正常返回解释为全部接受；历史重放拒绝项的 trace 可以是原记录 trace，顶层仍须为本次 trace。

每个 ApiGateway 两笔上传准备容量，与两个读取名额独立；满额 MCP_SYNC_UPLOAD_BUSY，不排队。30 秒单调本地期限覆盖准备、等待、解析及结果准备；MCP_SYNC_UPLOAD_TIMEOUT 只停止本地等待，底层结束前继续占位，迟到成功不交付。已派发后的权限到期、Gateway 错误、无效或超限响应均不能推断回滚。

错误仅返回固定白名单代码、文案和当前 trace，retryable=false；适配器自行设置 details.dispatch_state：api.handle 调用之前为 not-sent，此后为 unknown，绝不信任上游同名详情。not-sent 仅指本次未调用，不证明原事件以前没有发送。保留完整原请求后可显式逐事件查询 get_sync_event_receipt；工具不会自动查询、重试、换键或结算本地队列。

上传 arguments 普通 JSON 上限 1 MiB + 16 KiB，内嵌 `{events}` 另限 1 MiB；完整成功封套 256 KiB，Gateway 错误对象 16 KiB，二次转义的 MCP text result 为 512 KiB + 4096 字节。这些是本地对象/结果准备边界，不包含 HTTP 接收/发送、JSON-RPC 最终包装或底层存储分配。同步 JSON 工作无法抢占，结束后检查期限；仅准备请求的 prepareMcpTool 不执行上传，也不提供执行器容量或等待保证。

这是旧工具输入契约的有意收紧：旧调用若未保存 expected_identity 将失败，不能用当前身份静默补齐。旧消费者、Mock 和 fixture 迁移以及真实协议兼容证据尚待补齐。

## 完整结果与等待

成功必须是 HTTP 适配的 200、匹配本次 trace 的响应头及 JSON 媒体类型。有限普通 JSON 快照先排除访问器/循环/非有限值/超限结构，再调用共享完整响应解析器；回执逐项核对原 identity/event、状态、来源和历史引用。返回一个 text content，text 是完整业务封套 JSON。历史正文始终是参考数据，不能作为工具指令执行。

recorded 只说明规范化原投递与已保存历史事件匹配；accepted=false 表示原上传生成冲突，不代表当前冲突仍未解决。source_application 始终 not-checked。not-observed 不证明失败、回滚或稍后不会提交，不能因此换身份/换事件/换键重发。两个读取工具没有文件保存、上传、下载/ack、自动重试或本地队列结算；需要本地明确结算时另用 [outbox reconcile](outbox-reconciliation-runtime.md)。

两工具共用每个 ApiGateway 实例两笔准备容量，从参数准备前占用，涵盖底层执行、解析和文本结果准备。满额返回 MCP_SYNC_BUSY，不排队。30 秒单调本地期限包含准备和等待；超时返回 MCP_SYNC_TIMEOUT，底层工作及校验结束前仍保留名额，迟到成功不交付。不能由超时推断数据库读取/入口审计已取消。

同步 JSON/摘要工作无法中途抢占，结束后检查期限；凭据实际到期仍用真实时间判断。容量在结果准备结束释放，不覆盖后续 HTTP 发送，也不是全局连接数、进程内存或数据库成本限制。

| 边界 | 上限 |
|---|---|
| 身份参数普通 JSON | 16 KiB，同时必须为 `{}` |
| 原事件查询 arguments | 1 MiB + 16 KiB；内嵌单事件上传快照另受 1 MiB 限制 |
| 身份完整成功封套 | 16 KiB |
| 原事件完整成功封套 | 2 MiB |
| Gateway 原错误对象 | 16 KiB |
| 准备的 MCP text result（二次转义后） | 对应成功封套上限的两倍 + 4096 字节 |

result 大小不包含协议最后追加的 schema_version/trace_id、JSON-RPC id 与 HTTP 包装；不宣称总输出、总分配或发送内存有同一上限。错误只保留允许的代码、固定文案和当前 trace，retryable=false，不透传 Gateway 原 message/details。业务错误仍为 MCP isError=true，not-observed 是合法读取结果、不是工具错误。

## HTTP 正文余量

HTTP 仍先鉴权后读 MCP JSON。普通正文上限保留 1 MiB；可信未过期 sync writer（含 admin）在解析工具名之前最多缓冲 1 MiB + 80 KiB，其中原查询/上传参数上限之外的 64 KiB 用于 JSON-RPC 封套/空白余量。解析后，只有 get_sync_event_receipt 和 upload_events 能使用超过普通上限的这段 sync 额度，arguments 本身仍受更小上限；身份工具和其他普通操作不能借用。

因此接近 1 MiB 的完整原事件可以带原身份进入 MCP，而不是被协议封套挤掉。该额度有限，不支持任意长度的 id 或任意多空白；超限继续报既有正文限制错误并停止派发。

Artifact writer 的更大上传额度继续独立处理。只有 Artifact 能超过回执 HTTP 额度，须先取得原上传容量和存储配置；解析出 Artifact 工具且正文超过普通 1 MiB 时，工具准备前必须已有或补取原上传名额。双能力客户端在工具名未知阶段可以先缓冲这段小型 sync 余量，因此不能再宣称所有超过 1 MiB 的字节都已事先取得 Artifact 名额。非上传操作释放可能取得的上传预留。HTTP 正文接收期限沿用现有有界读取器，与工具执行的 30 秒预算分开。

## 后续范围

get_sync_changes 已另接 [完整分页与有界读取](sync-changes-runtime.md)，要求可信未过期 sync.read/admin，独立两笔准备容量/30 秒期限、4 MiB 完整封套，并可固定保存的消费者身份。acknowledge_sync 已要求原身份/游标，新增 get_sync_cursor 查询同一身份当前位点，两者各自两笔准备容量/30 秒期限、32 KiB 完整成功封套，见 [原消费者确认](sync-cursor-runtime.md)；不与本文原身份/事件回执读取共用名额。upload_events 和确认工具不替调用者保存原请求。Web 同步恢复、本地旧行身份追溯/绑定、后台重试门禁、跨设备保存、旧消费者/Mock/fixture 迁移和真实 MCP 客户端/并发/超时/恢复证据仍待补齐。
