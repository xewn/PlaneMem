# MCP HTTP 运行时开发说明

2026-11-04 上下文历史增补：list_context_item_history/get_context_item_version迁到专用执行器，新增compare_context_item_versions；发现和调用统一要求可信未过期实际context.read及完整身份。4 KiB参数、完整目录256 KiB/版本2 MiB/错误16 KiB、快照SHA-256，三工具每Gateway共用两笔容量和每调用30秒期限，超时保留底层名额。比较两次指定读取共享期限，16 MiB本地结果/32 MiB+4096转义输出；首读失败不继续、无部分结果/自动翻页/重试。prepareMcpTool明确要求专用执行器，普通HTTP输入及外层发送行为保持；详见[上下文MCP历史读取与对比](context-item-runtime.md#2026-11-04-mcp上下文历史与对比增量)。仅源码文档，未编译、测试、执行或发布。

2026-11-04 工作项排序：list_work_item_projections沿专用有界执行器与共享解析支持sort=updated_desc/due_asc；MCP schema及直接调用拒绝空排序，默认省略与updated_desc等价。新排序和全部条件进入生产v5游标绑定，权限/固定预算不变，见[工作项排序](work-item-projection-runtime.md)。仅源码文档，未编译、测试、调用或发布。

2026-11-04 工作项日期筛选：list_work_item_projections既有有界执行器沿共享解析支持due/due_from/due_before，并拒绝MCP schema不接受的空字段。按保存due_at有无及严格UTC日区间筛选，完整页再次核对；未使用字段省略，日期区间不能组合unscheduled。旧发现/实际context.read/输入响应/容量/30秒控制保持，新日期条件纳入生产v4游标绑定。详见[工作项筛选](work-item-projection-runtime.md)。仅源码文档，未编译、测试、执行或发布。

2026-11-04 工作项读取增补：list_work_item_projections/get_work_item_projection已接专用执行器，发现/prepare/调用要求可信未过期实际context.read及有效身份/trace，admin不替代。8 KiB参数、2 MiB完整成功/16 KiB错误、4 MiB+4096转义结果，原目标/整页筛选/trace/可选范围/restricted权限核对；两工具每Gateway共用两笔容量与30秒期限，超时底层未结束仍占槽。无部分成功/自动翻页/重试/写入，清除继承写条件，普通HTTP输入预算不变。源码与兼容限制见[工作项MCP读取](work-item-projection-runtime.md)。仅源码文档人工审阅，未编译、测试、执行或发布。

2026-11-04 版本对比增补：新增`compare_artifact_versions({artifact_id,from_version,to_version})`，发现和调用要求已验证未过期实际artifact.read。捕获同一身份，两次固定历史读取共用30秒/两笔比较容量，超时保留底层名额；4 KiB查询、每份2 MiB成功/16 KiB错误、8 MiB本地组合/16 MiB+4096转义结果，完整核对后返回两份原封套和共享字段/来源位置差异。`prepareMcpTool`明确要求专用执行器，不生成单请求替代；普通HTTP输入预算不变，无正文下载/当前替代/部分成功/重试。详见 [MCP版本对比](artifact-versions-runtime.md#mcp版本对比源码阶段)。仅源码文档，未编译、类型检查、测试、运行或发布。

2026-11-04 项目文件目录增补：新增`list_artifacts`专用执行器，发现、prepare及直接调用均要求已验证未过期实际artifact.read；严格query/classification/limit/cursor共享查询，8 KiB内层输入、256 KiB成功/16 KiB错误、二次转义结果512 KiB+4096字节。每Gateway独立两笔目录读取和固定30秒本地期限，底层未结束仍占用超时名额；完整scope/trace/筛选/排序/next_query和restricted权限检查，固定错误、retryable=false、read_kind=registry。清除继承写条件，仍沿普通HTTP正文限额，不自动翻页/下载/写文件；详见 [项目目录客户端](artifact-registry-runtime.md#命令行与-mcp源码阶段)。仅源码文档人工审阅，未编译、测试、执行MCP/API/数据库或发布。

2026-11-04 附件版本目录增补：新增只读 `list_artifact_versions({artifact_id,limit?,at_version?,before_version?})`，发现/调用要求已验证未过期实际artifact.read，admin不替代。首轮固定版本上界并返回完整next_query；仅历史摘要，不读正文或自动翻页。专用执行器每Gateway独立两笔、30秒等待，超时底层未结束仍占槽；输入4 KiB、成功256 KiB、错误16 KiB、二次转义结果512 KiB+4096字节。核对完整范围/trace/原查询/顺序/下一查询，固定错误及retryable=false，清除继承写条件；没有HTTP正文扩容或新数据库访问逻辑。见 [版本目录客户端](artifact-versions-runtime.md#命令行与-mcp源码阶段)，仅源码文档人工审阅，未编译、测试、执行MCP/API或发布。

2026-11-04 上传身份读取增补：新增只读工具 `get_artifact_upload_context({})`，发现与调用要求可信未过期客户端和实际artifact.write，admin不代替。返回完整身份/期限/上传上限/读取能力提示；不接受范围/身份/键或额外参数，不准备文件/命令或上传。独立两笔准备容量、30秒本地期限、成功/错误16 KiB、二次转义36 KiB；超时保留底层名额，核对完整原可信身份/期限/能力，错误固定且不重试。见 [CLI/MCP上传身份](artifact-persistence-runtime.md#cli-与-mcp-上传身份读取源码阶段)。仅源码文档，未编译、测试、调用或发布。

2026-11-04 原审核回执增补：get_proposal_review_receipt接收完整原identity/request_key/proposal_id/decision/expected_revision/reason，发现/调用都要求未过期可信human及proposal.review/admin。复用原审核只读路由和严格封套，不发送决定；not-observed不证明失败。每Gateway独立两笔准备名额、30秒本地等待，超时保留名额到底层结束；输入32 KiB、成功64 KiB、错误16 KiB、二次转义结果128 KiB+4096字节。保持普通HTTP 1 MiB，无大正文扩容权限；继承写条件清除，不保存结果或重试。见[CLI/MCP原审核查询](proposal-review-receipt-runtime.md#cli-与-mcp-原审核查询)，仅源码文档，未编译/类型检查/测试/运行或发布。

2026-11-04 提案创建回执增补：新增 `get_proposal_create_receipt({identity,request_key,draft})`，发现/调用要求可信未过期 proposal.write/admin，并核对原账号/客户端/项目。复用只读创建回执路由，完整原规范草稿必含分类/TTL，未知结果不触发创建/审核。每 Gateway 独立两笔准备名额、30秒本地期限，超时保留名额到底层结束；成功2 MiB、错误16 KiB、二次转义结果4 MiB+4096字节。普通 HTTP 1 MiB 不变，可信 proposal writer 可使用1 MiB+64 KiB封套额度，最终工具名必须匹配且内层原请求仍限1 MiB；Artifact 自身扩容预留保持。清除继承写条件，不生成键或保存回执；见 [CLI/MCP 原创建回执](proposal-runtime.md#cli-与-mcp-原创建回执)。仅源码文档，未编译、类型检查、测试、执行接口/数据库或发布。

2026-11-03 原消费者确认增补：迁移 acknowledge_sync 为保存的 expected_identity/cursor，新增 get_sync_cursor({expected_identity?}) 只读当前位点，区分无记录与明确确认到 0。当前位点不是原请求历史回执。二者要求可信未过期 sync.read/admin，读写各自两笔准备名额与 30 秒期限，超时保留底层名额；成功 32 KiB、错误 16 KiB、二次转义结果 64 KiB + 4096 字节，确认错误由适配器标明 not-sent/unknown。get_sync_changes 新增可选原身份前置条件。没有自动确认/查询/重试或本地保存，见 [原消费者确认](sync-cursor-runtime.md)，未运行验证。

2026-11-03 同步下载增补：get_sync_changes 已有专用完整分页执行器，要求可信未过期 sync.read/admin。成功限 4 MiB、错误限 16 KiB、二次转义结果限 8 MiB + 4096 字节；每 Gateway 独立两笔准备名额和 30 秒期限，超时保留底层名额。核对事件唯一性/游标顺序/完整来源/范围/trace，不自动翻页、保存或 ack；普通请求体额度不变，旧确认入口另续。见 [同步变化分页](sync-changes-runtime.md)，仅源码，未编译、测试或运行。

2026-11-03 原同步工具增补：get_sync_command_context 和 get_sync_event_receipt 返回完整可信身份提示/原事件历史回执；upload_events 现要求保存的 expected_identity、完整 events 和显式原 idempotency_key。发现/调用均要求可信未过期 sync.write/admin。读取共用两笔准备容量，上传独立两笔；30 秒单调等待，超时名额保留到底层结束。成功身份 16 KiB、单事件回执 2 MiB、批次上传 256 KiB、Gateway 错误 16 KiB，二次转义结果另限。上传逐项验证完整原批次，派发后错误为 unknown，不自动重试。HTTP 普通 1 MiB 不变，可信 sync writer 增加原回执/上传专用 80 KiB 封套余量；Artifact 请求大于普通上限时准备前仍必须预留独立上传名额。完整行为和边界见 [MCP 原同步工具](sync-mcp-runtime.md)；未编译、测试、运行或发布。

2026-11-03 固定原冲突请求提交增补：新增写工具 `submit_original_conflict({original,reviewed:true})`，发现/调用要求可信未过期 resolver；原 identity/request_key/完整 command 复制后沿用 resolve 路由，顶层不注入新键，继承写条件必须与原值一致。协议保留派发前副本，校验 200/trace/完整旧写响应，结果仅 unconfirmed，需显式 get_conflict_receipt。没有新增备份存储、自动重试、外层容量/发送/期限边界；见 [固定原冲突请求提交](conflict-submission-runtime.md)，仅源码，未运行或测试。

2026-11-03 冲突身份客户端增补：新增 `get_conflict_command_context({})`，发现与调用要求可信未过期客户端和 conflict.resolve 或 admin。复用 Gateway 可信元数据助手，固定无正文 GET /v1/conflicts/commands/context，清除继承写条件；200/原 trace 响应头和完整 16 KiB 内层封套均校验，五字段身份及到期须与原上下文完全一致，返回前再次检查有效期。没有目录/详情/回执查询、自动写入、键生成或原请求替换，不增加 MCP 外层容量/发送/期限保证；见 [冲突原请求保存与恢复](conflict-recovery-runtime.md)。仅源码，未运行或测试。

更新：2026-11-02。本次为代码接入记录，未执行编译、类型检查、测试、发布或部署。规划中的完整接口清单仍以 `mcp-interface.md` 为准。

## 入口与身份

2026-11-03 检查点全文增补：get_session_checkpoint、list_session_checkpoints 和 list_checkpoints 的会话历史模式固定原请求快照，成功核对 200/原 trace 并完整解析内层 JSON，详情 2 MiB、历史页 8 MiB；工作台模式保留身份/权限信息。Gateway 超限为 CHECKPOINT_READ_TOO_LARGE，不截断笔记或返回部分页。没有新增 MCP 文本二次转义/外层发送字节、独立准备名额或期限保证；详见 [检查点全文读取边界](checkpoint-read-runtime.md)。仅源码，未运行或测试。

2026-11-03 独立恢复身份增补：新增 `get_session_command_context({})`，发现及调用要求可信未过期客户端与现有读/写/领取能力或 admin 语义。固定 GET /v1/sessions/command-context，清理继承写条件，200/原 trace 响应头及完整 16 KiB 内层封套解析，身份/到期/提示与原可信上下文独立比对。无目录读取、自动恢复、资源 URI 或新增准备/期限/发送容量保证；实际命令仍重新授权，见 [独立恢复身份](session-command-context-runtime.md)。仅源码，未运行或测试。

2026-11-03 检查点目录增补：扩展既有 `list_checkpoints` 单一定义，无 session_id 时使用 query/checkpoint_id/limit/cursor 的项目分页，默认 25、最多 100；有 session_id 时仅允许 before_revision，保持十条历史模式，拒绝混用。项目目录专用适配固定原请求，成功校验 200/trace 及完整 2 MiB 封套，摘要限 8 KiB 并明确省略；历史资源和 GET 不改用项目游标。没有新增独立准备名额/期限/发送容量或自动遍历，详见 [检查点目录分页](checkpoint-registry-runtime.md)。仅源码，未运行或测试。

2026-11-03 交接目录增补：`list_handoffs` 专用 schema 接收 query/status/session_id/origin/limit/cursor，默认 25、最多 100 条；沿用 context.read，清理继承写条件，成功要求 200/原 trace 响应头并完整解析封套。摘要超过 8 KiB 明确省略，成功对象最多 2 MiB；身份/所有权提示不替代写授权或原请求回执。无新增独立准备名额、期限、后台取消或 HTTP 发送容量保证。既有会话 handoff 资源返回基础首屏及 continuation 工具参数，后续工具返回个性化封套，调用方需处理形状差异。旧批量 sessions/handoffs 注册已移除，重复工具名现在直接拒绝，避免覆盖分页定义。见 [交接目录分页](handoff-registry-runtime.md)，仅源码，未运行或测试。

2026-11-02 会话目录增补：新增只读 `list_sessions`，参数为 query/status/client_id/limit/cursor，默认 25、最多 100 条；沿用 context.read 策略和项目/父项目可见性，清理继承写条件。固定筛选、范围、受限数据能力和页大小绑定游标，按微秒 started_at 降序/ID 升序继续。成功要求 200/原 trace 响应头，独立适配器完整校验返回封套、顺序、游标和可信身份元数据后返回文本 JSON；不自动遍历、不新增资源 URI。成功对象限 2 MiB；复用现有 MCP 请求等待/限流，没有新增独立准备名额或 HTTP 发送容量。完整说明见 [会话目录分页](session-registry-runtime.md)。仅源码，未运行或测试。

2026-11-02 管理快照增补：`get_admin_snapshot` 仅接受空 arguments，目录与调用要求可信有效客户端、admin 角色及实际 admin.read，清除继承写条件后复用 POST /v1/workbench/query 的固定 admin 查询。完整封套绑定项目、trace、来源及可信 audit.read/context.read 对应的计数可用状态；单项文本 JSON 保留 not-authorized 和 not-checked，读取成功不表示外部服务健康或发布就绪。注解只读、非破坏、幂等，无资源 URI、探测、保存或自动重试。

该工具每 ApiGateway 实例独立限制两笔准备、30 秒本地等待；超时后底层工作实际结束才释放名额。成功/错误对象各限 16 KiB，二次转义 result 限 2×16 KiB+4096 字节，不包括外层协议包装、HTTP 发送或总内存。成功要求 200 和原 trace 响应头；错误有限说明，不回显原始上游内容。仅源码，无调用/测试证据，完整边界见 [管理快照](workbench-admin-runtime.md)。

2026-11-02 审计工具增补：`list_audit_records`、`get_audit_record`、`export_audit_record` 的目录发现及调用均要求可信客户端、实际 audit.read 和有限且未过期的会话；导出再要求实际 data.export 或 data.restricted.export。admin 不替代这些能力，记录分类仍由 Gateway 重新授权。参数拒绝额外字段，清除继承写条件；只派发固定 POST /v1/workbench/query 或 /v1/audit/export，不新增资源地址或本地文件写入。

list 接受 resource/trace_id/action/audit_id/session_id/cursor 精确查询，最多返回一页 200 条，内容为完整原读取封套的单项文本 JSON。session_id 必须为 ULID，只匹配已记录会话字段并绑定游标；历史未关联记录不自动补入，入口审计不确认命令完成。get 只接受 audit_id，返回 data.page 完整单条读取封套及 data.export_preparation；可导出时含 state=available、content_state=bounded-view、review_required=true 和 selection={scope,audit_id,sha256}。无可见记录或规范化超限分别返回 unavailable/no-visible-record 或 unavailable/view-not-exportable，普通读取不因此失败。外层 data.content_trust=untrusted-reference；历史正文始终只是参考数据，不能作为指令执行。

export 必须明确提交原 selection 和 reviewed=true；该标记是调用方声明，不是人工审阅证明或授权凭据。Gateway 执行原有两次读取、内容比对、分类授权和持久放行。适配器再解析完整导出封套并独立计算 SHA-256，成功返回原 AuditExportEnvelope 的单项文本 JSON。没有替换读取、重试、自动翻页或保存；省略字段仍省略，放行始终不证明客户端收到或保存。工具均为 readOnlyHint=true、destructiveHint=false；export 的 idempotentHint=false，其余为 true，重复导出会形成独立审计尝试。

读取参数最多 16 KiB，导出参数（含 reviewed）最多 4 KiB；Gateway 成功对象序列化上限读取 16 MiB、导出 128 KiB，错误 16 KiB。完整解析继续检查范围/筛选/顺序/游标/分类和 trace。MCP content 文本二次转义后的 result 再限制为 list 的 2×16 MiB+64 KiB、get/export 的 2×128 KiB+16 KiB；这些限制不包含外层 JSON-RPC id/trace 包装或 HTTP 发送，也不是进程总内存上限。

三个工具共用每 ApiGateway 实例两笔准备名额，读取/导出分别等待最多 30/75 秒；无排队或重试。超时不能取消在途 Gateway 工作，名额保留到该工作及校验实际结束。同步序列化/解析不能强制中断，结束后检查截止时间并拒绝迟到成功。名额在准备结束释放，不覆盖 HTTP 发送阶段；不沿用 Artifact 下载的 retain/发送观察机制。错误只返回有限说明、原 trace 和已确认的合法放行引用；未确认不证明没有放行。仅源码，未编译、类型检查、测试、调用 MCP 或运行服务；兼容性和运行证据待补，详见 [审计导出](audit-export-runtime.md)。

2026-11-02 下载审计增补：可信 HTTP retain 适配接收固定 query 与已确认 release_audit_id，复用二进制下载的发送观察器，按 finished/closed/error/timeout 记录 artifact.download.transport.mcp.*；finish 仅为服务端传输结束。先释放下载容量，再尝试有界持久观察。封套确认后的散列/编码/交接错误可另记 failure.adapter-validation；已有原始错误保持。嵌入调用可传可信 observe，但没有 HTTP 事实时不伪造发送终态。观察最多 8 笔在途、等待 5 秒，超时在途名额直到 sink 实际结束才释放；满额或故障可缺记录，不自动补偿。全部补充观察 restricted，不含正文/存储地址/异常文本；release 关联使用 audit source_ref。成功摘要与错误的 client_delivery_state 仍为 not-confirmed。仅源码与文档，未编译、测试、运行或发布。

2026-11-02 Artifact 上传增补：新增 `create_artifact` 与 `put_artifact_version`，参数严格为 `{ request: { identity, command }, content_base64 }`。request 必须是调用方事先保存的原请求，分别要求 command.operation=artifact.create/artifact.put-version；不接受外层 idempotency_key、expected_version 或额外身份字段。发现与调用都要求 authenticated_client=true、实际 artifact.write 和有效未过期会话；admin 不替代能力。原 identity 与可信项目/账号/客户端逐项相等，清除继承写条件后，仅从 command.request_key 和追加 command.expected_version 设置原条件，不生成新键或刷新版本。

规范化原 request 最多 1 MiB，解码内容最多 4194304 字节并受 artifact_upload_max_bytes 较小值限制。Base64 编码长度须匹配原 size，解码再编码逐字相等，拒绝空白、URL 字母表、缺失 padding 和非规范尾位；零字节内容允许空字符串。独立检查完整内容长度与 SHA-256 后，以独立请求和字节副本执行既有 artifact.create/put-version，继续经过原策略、分类可见性和持久写回执事务。结果只返回通过共享完整封套校验的文本 JSON，不回显上传内容；recorded 为原历史结果，首次 verified-at-save 与重放 not-checked 沿用 HTTP 上传语义。

HTTP MCP 先验证 Bearer/范围，再读取正文，要求 application/json（可带 charset=utf-8）及无压缩 UTF-8 JSON 对象。普通请求上限仍为 1 MiB，可信 sync writer 另有前述 80 KiB 原回执/上传封套余量；有效 Artifact writer 可进一步申请最多 8 MiB 正文。超过当前基础额度前须取得与 multipart 共用的两路 Artifact 上传容量，已知长度在读取前申请，未知长度在保留超额字节前申请。解析后只有原同步回执/上传能使用小型 sync 余量，更大额度仅允许上述两个 Artifact 上传工具。Artifact 正文大于普通 1 MiB 时，准备前须已有或补取其名额；双能力调用者可先缓冲小型 sync 余量。容量不足或未配置 writer 时拒绝 Artifact 扩容，正文读取总期限 120 秒，失败关闭连接。客户端兼容性尚未验证。

Artifact 请求取得名额后一直持有至写调用及响应校验结束；小上传在解码/hash 前申请同一名额。非 Artifact 操作释放可能取得的预留，无效 JSON-RPC、通知、拒绝或异常也释放本次名额，通知不执行上传。嵌入 dispatchMcp 默认按 ApiGateway 实例限制两路 Artifact 上传；可信 HTTP 宿主通过第六参数传入同一 gate/takeReservation，仅转交一次已有名额，第五参数保留下载选项。原同步上传另有独立准备容量，不占用这组 Artifact 名额。没有自动等待队列、重试、保存本地文件或恢复状态。

上传工具标记 readOnlyHint=false、destructiveHint=false、idempotentHint=true；幂等依赖原身份/参数/键，不是自动重试许可。工具执行失败返回 isError，发送前 details.dispatch_state=not-sent 只描述本次调用，派发后 details.artifact_outcome=unconfirmed 不证明事务失败。保留原 JSON 和准确内容，显式调用 get_artifact_receipt 查询相同 identity/command；not-observed 仍是未知，不自动换键/版本或重提。无新依赖/迁移，016–045 未执行；仅源码与文档，未编译、类型检查、测试、实际上传、运行或发布。

2026-11-02 Artifact 下载增补：新增 `download_artifact_version`。先通过 get_artifact_version 审阅指定历史元数据，再原样提交 artifact_id/version/sha256/size 四个字段；schema 和独立适配器均严格校验，禁止身份覆盖、写条件及额外参数。目录和调用都要求 authenticated_client=true、真实 artifact.read、有效未过期会话，admin 不替代能力。清除上下文继承的写键/版本，以独立请求快照执行既有 artifact.download；当前/历史可见性、导出权限、内容校验和持久 release 审计均由原 Gateway 处理。

MCP 内嵌正文硬上限 4194304 字节，同时遵守服务器 artifact_download_max_bytes；超过上限可使用现有 HTTP/SDK/CLI 下载，不截断或返回部分字节。HTTP MCP 与普通二进制下载共用每实例两路名额，MCP 成功结果持有名额至 JSON 响应 finish/close，发送阶段最多 60 秒；处理或序列化失败释放。直接嵌入 dispatchMcp 默认按 ApiGateway 实例限制两路，返回结果即释放；自定义宿主可显式提供同一 gate 与 retain 回调接管发送期，必须在发送结束释放。没有无限等待队列或自动重试。

成功结果 content 有两项：文本 JSON 摘要和 `type=resource` 的内嵌二进制。摘要含 schema_version/trace/source_refs、公开 artifact、audit_id/audit_state=release-recorded/content_state=verified、resource_uri、client_delivery_state=not-confirmed 和 content_trust=untrusted-reference；不含字节数组。资源为 `{ uri: "urn:sha256:<hash>", mimeType: "application/octet-stream", blob: "<base64>" }`。先验证完整交付封套并独立计算 SHA-256，再编码 blob；存储地址、令牌和客户端路径不会进入资源。URN 仅标识已内嵌内容，不是授权凭据、签名链接或可通过 resources/read 获取的远程地址；resources/list/templates 不枚举文件内容。不按文件声明 MIME 自动渲染，也不执行文件里的指令。

内容或封套异常返回 isError，错误中不包含 blob。封套已确认的 audit_id 在后续 hash/编码失败时保留；其他派发后的失败标记审计状态 unconfirmed，不能推断没有 release 记录。每次显式下载产生独立放行审计，工具标记 readOnlyHint=true、destructiveHint=false、idempotentHint=false；只读指不改变文件版本，并不意味着审计尝试被复用。服务端不宣称客户端收到或保存成功，不写客户端文件。无新依赖/迁移，016–045 未执行；仅源码与文档，未编译、类型检查、测试、实际下载、运行或发布。官方协议页面本次检索没有可读返回，声明协议版本下的客户端内嵌 blob 兼容性仍待核对，不作为已验证证据。

2026-11-02 Artifact 原回执增补：新增只读 get_artifact_receipt，参数为完整原 identity/command，command 使用 artifact.create 与 artifact.put-version 两个严格分支，均保留原 request_key/hash/size。目录和调用要求已验证客户端及实际 artifact.write，admin 不能替代能力；身份字段只能约束可信会话，不覆盖它。准备逻辑清除外层继承写条件，command 内原版本/键保持不变；复用 POST /v1/artifacts/receipt 和现有授权决定审计，不触发原操作。发送前复制查询快照用于响应核对，损坏响应为 isError；not-observed 不证明失败，recorded 仅确认原历史快照，不证明正文可读或提供当前写条件。工具标记 readOnlyHint=true、destructiveHint=false，不自动重试或保存恢复状态；无新依赖或迁移，未编译、类型检查、测试、运行或发布。

2026-11-02 Artifact 增补：新增只读 get_artifact/get_artifact_version，参数分别为 artifact_id 与 artifact_id/version。ID 必须为 ULID，version 为正安全整数，不接受 idempotency_key、expected_version 或身份覆盖。即使有 admin 角色，缺 artifact.read 也不在发现目录展示；调用仍经过网关 artifact.read 策略和当前项目/记录/历史分类可见性校验。通用准备逻辑清除继承写条件，响应适配器核对工具名、GET 路径、原目标/版本、范围、trace、来源与完整元数据。损坏成功响应返回 isError，不降级为当前版本、不重试、不读取对象。content_state 固定 not-checked；元数据不是上传回执或下载授权。仅源码接入，无新迁移、未编译测试或运行。

2026-11-02 收尾增补：finish_agent_run、finish_tool_call、end_session 也要求原 expected_identity，仅展示给已验证客户端，调用时对比可信上下文。保留原参数/键/版本，拒绝冲突的上下文条件；成功响应接入共享 session-finish-clients，核对原目标/结果/来源/trace 和 0 或 1 的合法版本增量。结束记录中的创建者身份不充当本次操作者；相同终态可无变化成功。未知结果仍显式调用 get_session_command_receipt，不从当前记录反推原键成功。无新增迁移，未编译、测试或运行验证。

2026-11-02 活动增补：start_agent_run、record_tool_call、get_session_command_receipt 均要求原 expected_identity（tenant/workspace/project/actor/client），只展示给已验证客户端，使用 session.write。适配器对比可信上下文，拒绝新创建的键/版本冲突，查询清除继承的键/版本。活动创建及查询响应复用共享封套解析器，核对原会话、版本、参数、来源和 trace。创建原 model/tool_name 保留字符，名称最多 1024 个 UTF-16 单元；历史查询 command 的额外原字段继续保留，不按新创建字段集合裁剪。MCP 不自动保存、查询或重试，调用方必须保存原请求；收尾/结束写入现已通过上面的独立增补接入。无新迁移、不执行编译测试或发布。

2026-11-02 开始增补：start_session 现在要求原 expected_identity（tenant/workspace/project/actor/client），保留原可选 parent_session_id/actor_id/client_id 和稳定 idempotency_key；新增只读 get_session_start_receipt，参数为原 expected_identity、request_key 和 session 原业务正文。两个工具只向已验证客户端展示，使用 session.write。查询清理继承的写入键/版本，不创建会话；普通开始拒绝版本条件。响应共用严格解析器，只有匹配 start_receipt 才能确认原开始；not-observed 不证明失败、不自动换键。044 未执行，仅源码开发，见 [开始会话回执](session-start-runtime.md)。

2026-11-02 创建增补：create_handoff 现在要求原 expected_identity（tenant/workspace/project/actor/client）、session_id、checkpoint_id 和 idempotency_key，保留原 target_client/from_client；新增只读 get_handoff_create_receipt，使用同一身份、session_id、request_key 和 handoff 原参数。两个工具仅对已验证客户端展示，沿用 session.write。查询清理外层继承的写入键/版本，不创建、领取或续接；输入身份不作为鉴权依据。成功结果通过共享解析器核对本次 trace、历史回执、原检查点/目标和当前交接，not-observed 不能证明失败，不自动换键。043 未执行，仅源码开发，见 [创建交接回执](handoff-create-runtime.md)。

入口为 `POST /mcp`，请求使用 JSON-RPC 2.0。每次请求提供：

- `Authorization: Bearer ...`。
- `x-tenant-id`、`x-workspace-id`、`x-project-id`，必须与令牌授权的范围一致。
- 可选 `x-trace-id` 或 `traceparent`；未提供时生成独立的 `trace_mcp_...`，响应头为 `x-trace-id`。

网关复用 `AUTH_SERVER_ISSUER`、`AUTH_SERVER_AUDIENCE` 配置的令牌验证器，也允许由服务初始化参数注入 `oidc_verify`。未配置验证器时返回服务不可用，不再以 `x-actor-id/x-client-id/x-capability` 请求头建立 MCP 身份。写入工具和同步确认要求令牌带有效客户端身份。

浏览器 Origin 必须列在 `MCP_ALLOWED_ORIGINS` 中，使用逗号分隔的精确 Origin；默认不接受带 Origin 的请求。已允许的 Origin 可执行 POST 预检，服务返回对应 CORS 响应头。原生客户端不需要发送 Origin。

初始化示例（仅文档示例，未执行）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "project-client", "version": "0.1.0" }
  }
}
```

当前代码接受协议版本 `2025-11-25`、`2025-06-18`、`2025-03-26`、`2024-11-05`；未知版本返回服务器首选版本，客户端需决定是否继续。传输为无会话状态的 HTTP JSON 响应，不声明订阅或列表变更通知。`notifications/initialized` 等无 id 的通知返回 HTTP 202 空响应，不执行工具。GET 流式连接未实现，返回 405。

## 已接入工具

WorkItemDeleted 自有 Canonical 观察新增内层 v2 删除标记：get_work_item_state 和对应资源在当前权限下返回 deleted_at 及最小 fields，活动状态仍为内层 v1；外层 envelope 不变。get_work_item_context 对已确认可见删除标记返回 OBSERVED_RECORD_DELETED，在外部记忆召回之前停止，不能把该错误回退为旧活动摘要。get_plane_event_diagnosis 新增 deleted_stream，表示较高普通版本不能恢复删除基线。040 迁移只写文件，原生 Plane 删除/恢复事件转换和项目删除未完成，见 [观察契约](observed-state-runtime.md)。

WorkItemRestored 自有 Canonical 恢复观察仍返回内层 v1，增加 restored_from={event_id,aggregate_version} 来源；共享解析器核对字段和版本。恢复只接受紧邻的确切删除，保留分类与索引到期；后续普通观察不带顶层 restored_from。MCP 没有向 Plane 执行恢复的工具，队列重试不会生成恢复事件。诊断 next_version 不检查恢复引用或删除索引，不能据此确认恢复会成功。无新增迁移、编译、测试或运行证据。

`list_observed_work_items`（context.read）读取当前项目保存的 Plane 工作项观察元数据，参数 state=active/deleted/all、limit=1–100 和 cursor。默认 active/25，按 external_id 升序；删除条目无旧标题/状态，活动条目标题/状态为限长摘要，完整状态使用 get_work_item_state。保留筛选、页大小和身份继续分页，每页重查权限与可用性；空页不证明上游无记录或同步完成。此工具不改变 resources/list 原本的本地工作项目录，不回放、不恢复、不查询外部系统。041 排序索引仅开发未执行，尚无运行证据。

该工具新增可选 query，最长 500 个 UTF-16 单元，去除首尾空白；按 external_id、aggregate_id 或当前活动标题摘要作字面包含匹配，只忽略 ASCII 字母大小写。删除行只按 ID 匹配。检索词与其他筛选一起绑定游标 v2，修改条件或持有旧 v1 游标时需要重新开始；不会读取历史正文或调用外部记忆。仍未编译、测试或运行。

新增 `get_plane_event_diagnosis`，输入只有 event_id（ULID），限可信 admin/admin.read，readOnlyHint=true、destructiveHint=false。在同一数据库快照比较目标与实际最新已提交流的可读基线，返回 position、下一版本、尚未提交区间和有界的可见候选元数据。不接受请求键或额外字段，不补拉/重试/重放。baseline_unavailable 不标记为工具失败，不能据此推断历史不存在；候选为空不能证明未收到，next_version 只表示版本关系，不授予人工重试许可。最新诊断样本不可读时不使用较低可见版本代替。完整说明见 [版本诊断](plane-inbox-runtime.md#版本缺口与候选回执诊断)。

新增管理员只读 `get_plane_event_queue_summary`，arguments 为空对象，接入 GET `/v1/plane/events/summary`。沿用可信客户端/admin 角色、admin.read 策略与项目/有效分类过滤；拒绝额外参数，标记 readOnlyHint=true、destructiveHint=false，不安排处理。返回单次数据库快照的字符串计数、队列时间及 checked_at，独立于列表筛选和分页。pending=due+delayed，version_gap 是 pending 子集；到期行可能正在处理但尚未提交，不能据此认定处理器停滞。零可见记录不证明同步完整或观察快照可用；读取错误保留错误语义，不能展示为零。详见 [队列概览](plane-inbox-runtime.md#当前可见队列概览)。

新增管理员只读 `list_plane_events`、`get_plane_event_receipt`，分别接入持久队列目录和单条处理元数据。目录只向可信 authenticated_client=true 且有 admin 角色的客户端显示；实际调用还经过 admin.read 策略、审计、限流和当前项目/分类过滤，单有 admin.read capability 不足以绕过角色要求。

list_plane_events 支持 status（all/pending/applied/rejected）、pending_state（all/due/delayed/version_gap）、aggregate_id（ULID）、limit（默认 25，最大 100）和 cursor；get_plane_event_receipt 必填 event_id（ULID）。pending_state 默认 all，不增加筛选；其余值只匹配 pending 行，要求 status=all/pending。due/delayed 按每次数据库读取时间判断，version_gap 表示最后记录的缺口，不能当作前置事件仍缺失的实时证明。均拒绝额外参数，不要求写入请求键，调用前清除继承的写入前置条件，标记 readOnlyHint=true、destructiveHint=false。分页保留所有筛选和页大小，改变条件或使用旧开发版本游标时重新读取第一页；时钟推进与处理可能改变页间成员，不自动续页或重放事件。返回的是元数据，不包含原始事件正文，也不加入普通 resources/list。pending/applied/rejected 是被查询事件的处理状态；成功读取 rejected 元数据不会被标为工具执行失败。详细边界见 [Plane 接收队列](plane-inbox-runtime.md)。

人工重试新增 `retry_plane_event` 与只读 `get_plane_event_retry_receipt`。前者只向可信 authenticated_client=true、admin 角色且签名 actor_type=human 的客户端显示，实际执行使用 plane.retry 策略；后者要求可信 admin/admin.read，不要求当前仍为 human。目录只是资格提示，不能替代实际授权。重试标记 readOnlyHint=false、destructiveHint=true；回执查询标记只读、非破坏，二者沿用同键同命令的幂等语义。

两者都必填原 event_id、十进制字符串 expected_revision、reason、expected_actor_id、expected_client_id。预期身份可从 get_plane_event_receipt 返回的 plane_inbox_identity 取得，必须与当前已验证令牌一致；它们是前提，不是身份覆盖。expected_revision 是队列 revision，不能用 aggregate_version、数值 expected_version 或 If-Match/If-Match-Version 代替，两个工具都拒绝数值版本头。共享解析器核对正 BIGINT 范围、可递增上界及理由/键字符。

retry_plane_event 另需 confirmed=true 和固定 idempotency_key。confirmed 只能在用户明确同意安排原事件重试后传入，它不替代签名 human/admin 校验。Idempotency-Key 请求头可补充缺失的键；同时传参数时必须相同。适配器把键转换为后端 request_key，移除客户端确认/预期身份字段，复用正常重试事务；不会把队列版本转成数值版本，不会更改事件内容或越过版本缺口。

get_plane_event_retry_receipt 使用原 request_key，拒绝 confirmed/idempotency_key 参数，清除继承的写入键，不重新安排处理。recorded 表示原安排成功，不表示当前事件已应用；not-observed 是成功查询且不设置 isError，不能证明原请求失败或作为换键依据。成功响应在输出前再次核对原范围/身份/键/命令、队列修订号关系、尝试次数、trace 和空来源；响应不符返回 GATEWAY_RESPONSE_INVALID，并保留原请求用于查询，不能据此断定事务没有提交。

示例中的事件、身份和修订号均为占位值；先读取实际处理回执，保存原参数，并由用户确认后再提交。以下示例没有执行：

```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "method": "tools/call",
  "params": {
    "name": "retry_plane_event",
    "arguments": {
      "event_id": "01J000000000000000000000001",
      "expected_revision": "7",
      "reason": "已排查前置事件到达情况，重新安排处理",
      "expected_actor_id": "operator-subject",
      "expected_client_id": "operator-client",
      "idempotency_key": "plane-retry-operator-001",
      "confirmed": true
    }
  }
}
```

响应不确定时，另行调用 get_plane_event_retry_receipt，保留同一事件/修订号/理由/预期身份，将原 idempotency_key 作为 request_key，并去掉 confirmed。该查询不需要新确认，不自动触发重试。需要当前进度时另用 get_plane_event_receipt；原回执与当前元数据不能混为同一状态。037–039 迁移仍未执行，本次仅代码与说明开发，没有运行工具调用或验证。

新增 `list_context_indexes`（context.read）元数据目录工具，支持 query/state/managed_by/limit/cursor，默认 25 条，data.next_cursor 继续。它按当前分类过滤并包含可管理的过期/删除状态，不返回索引正文；不等同于 resources/list。034 排序索引仅写文件，工作台入口与分页边界见 [旧索引管理](legacy-context-lifecycle-runtime.md)。

旧索引管理增加 `get_context_index_status`（context.read）及 `delete_context_index`、`restore_context_index`（context.write）。删除/恢复需要 id、expected_revision、reason、idempotency_key，返回历史元数据回执；恢复保留到期与分类，Plane 记录只读。本地删除不删除外部记忆副本。033 迁移仅写文件，见 [旧索引管理](legacy-context-lifecycle-runtime.md)。

旧 `search_project_context`/`context_search` 已改为 PostgreSQL FTS，budget 上限调整为 100；`context_index` 新增 classification/expires_at 和持久请求回执，默认 restricted。`wcp://context/{context_id}` 资源改为即时读库的 JSON，旧命中不再从缓存资源目录枚举。032 迁移未执行；兼容性变化、外部记忆权限和剩余补偿边界见 [旧索引持久读取](legacy-search-runtime.md)。

新增只读 `search_project_records`（context.read），搜索 PostgreSQL 中当前工作项/上下文。支持 query、type、mode、include_inactive_context、limit、cursor；新入口及与旧 search_project_context 的边界见 [项目搜索](project-search-runtime.md)。

新增只读 `get_project_overview`（context.read），无业务参数，读取当前项目可见记录的汇总及有限预览。置信度为保存值均值，proposed 不是审核就绪承诺；具体统计和快照边界见 [项目概览读取](workbench-overview-runtime.md)。

新增只读list_work_item_projections（context.read），输入query/status/priority/owner/assignment/due/due_from/due_before/sort/cursor/limit，默认25、最多100条；精确owner、assignment及UTC日期规则见顶部增量，未使用字段省略。sort默认updated_desc，可选due_asc；外层next_cursor作为cursor并保留全部筛选和排序，换条件回首页。完整响应核对所选状态/优先级/负责人/分配/日期条件，客户端不重排单页；单页数量不表示项目总数或当前Plane状态。2026-11-04增量仅源码，未运行或测试。

新增只读 `get_work_item_projection`（context.read），输入本地 item_id；返回保存的工作项投影、字符串版本和来源，与原 get_work_item_context 的上下文组合读取区分。投影版本不能作为 Plane 写入条件，详见 [工作项投影详情](work-item-projection-runtime.md)。

`tools/list` 按令牌能力和客户端身份筛选目录；实际调用仍经过 Gateway Policy、Audit 和限流。OPA 可进一步收紧策略，目录出现的工具不等于已获得最终执行许可。

| 能力 | 工具 |
| --- | --- |
| `admin.read`，且可信客户端与 admin 角色 | `get_plane_event_queue_summary`、`list_plane_events`、`get_plane_event_receipt`、`get_plane_event_diagnosis`、`get_plane_event_retry_receipt` |
| `plane.retry`，且可信客户端、admin 角色、签名 actor_type=human | `retry_plane_event` |
| `context.read` | `get_project_context`、`get_work_item_state`、`get_work_item_context`、`search_project_context`、兼容别名 `context_search`、`compile_context_pack`、`get_context_pack`、`get_context_item`、`list_context_items`、`list_proposals`、`get_proposal`、`list_sessions`、`get_session_state`、`get_session_checkpoint`、`get_session_handoff`、`list_session_runs`、`get_session_run`、`list_session_tool_calls`、`get_session_tool_call`、`list_handoffs`、`list_checkpoints`、`list_conflicts` |
| `context.write` | `context_index`、`create_context_item`、`update_context_item`、`archive_context_item` |
| `session.write` | `start_session`、`get_session_start_receipt`、`start_agent_run`、`finish_agent_run`、`record_tool_call`、`finish_tool_call`、`end_session`、`record_checkpoint`、`create_handoff`、`get_handoff_create_receipt`、`resume_session`、`get_session_command_receipt`、`get_checkpoint_receipt`、`get_resume_receipt` |
| `session.write` 或 `handoff.claim` | `accept_handoff`、`get_handoff_claim_receipt` |
| `context.read`、`session.write` 或 `handoff.claim`，且可信未过期客户端；admin 沿用既有角色语义 | `get_session_command_context`（仅自身元数据） |
| `conflict.resolve` | `resolve_conflict` |
| `conflict.resolve` 或 admin，且可信未过期客户端 | `get_conflict_command_context`（仅自身元数据）、`get_conflict_receipt`（原请求回执）、`submit_original_conflict`（固定原请求写入） |
| `sync.read` | `get_sync_changes`、`get_sync_cursor`、`acknowledge_sync`；均要求可信未过期客户端，也允许 admin；确认必填原身份 |
| `sync.write` | `upload_events`、`get_sync_command_context`、`get_sync_event_receipt` 均要求可信未过期客户端，也允许 admin；上传要求显式保存的原身份与键 |
| `proposal.write` | `create_proposal` |
| `proposal.review`，且签名 actor_type=human | `confirm_proposal`、`reject_proposal` |

目录发现、initialize 和 ping 使用 `mcp.discover` 策略动作，支持只有写能力的客户端发现自己的工具；资源和提示读取要求 `context.read`。管理员角色遵循现有 Policy 规则。资源、提示和目录请求通过内部 `/_mcp/*` 路由复用网关限流/审计；这些路径不能作为公开 HTTP API 直接请求。

工具目录提供参数 JSON Schema，必填字段、类型、枚举、范围和额外字段在分派前校验。身份字段不接受调用参数覆盖；人工事件重试的 expected_actor_id/client_id 仅与签名身份比较。

写入工具携带 `idempotency_key`；`start_agent_run`、`finish_agent_run`、`record_tool_call`、`finish_tool_call`、`end_session`、`record_checkpoint`、`accept_handoff`、`resolve_conflict` 还需 `expected_version`。`finish_agent_run` 另外要求正文中的 `expected_run_version`，`finish_tool_call` 另外要求 `expected_tool_version`。也可以由 HTTP `Idempotency-Key` / `If-Match` 头补充请求键和会话版本，参数与请求头同时出现时必须一致。只读查询不会使用写入幂等缓存。`context_index` 现在也要求请求键。

start_agent_run / finish_agent_run / record_tool_call / finish_tool_call / end_session 已增加数据库行锁与持久回执，业务与回执同事务提交；运行/工具响应 session_version 是原操作后的会话版本，重放不表示当前最新版本。保留原键、参数和版本重试，026、028、029 迁移未执行，见 [会话进度命令](session-command-runtime.md)。

`record_checkpoint` 支持可选 `context_pack_id`，与旧 `context_pack` 互斥；绑定保存包时还需上下文读取授权。`resume_session` 重查绑定并返回 `context_pack_state`，仅 checked 附带完整包回执，旧哈希标为 legacy-unverified。历史资源读取不表示包仍有效；详见 [检查点上下文绑定](checkpoint-context-runtime.md)。024 迁移仅新增文件，未执行。

2026-11-02 续接客户端增补：resume_session/get_resume_receipt 必填原 expected_identity，可带 expected_checkpoint_id 仅核对响应，两个字段不传入业务命令。只允许已验证客户端，可信 context 必须与原身份相同。保存原有效 require_claimed；普通客户端省略为 false，配置中的工作台客户端必须明确 true，适配层不再静默改写。续接禁止版本条件；回执清除继承写键/版本。共享解析核对父子关系、原 resume_origin、交接归属、检查点和包绑定，以及本次 trace/各记录来源；子会话当前状态/版本可以推进，历史回执仍固定 not-checked。无新增迁移，本增补未编译、测试或运行验证。

`record_checkpoint` 和 `get_checkpoint_receipt` 现在都要求原 expected_identity（tenant/workspace/project/actor/client），仅已验证客户端可调用。保存绑定原版本/键、六类数组及可选包/记忆引用；身份字段在适配层移除，不作为业务正文或认证来源。正常响应校验原数组、引用、scope、来源和请求 trace，历史记录 trace 可以不同。不自动修改原请求或重试。

`get_checkpoint_receipt` 为只读恢复工具，要求有效客户端和 session.write；参数 session_id、expected_identity、request_key、checkpoint（原始保存正文，补入原 expected_version）。只查同身份原请求，不返回笔记或包内容；recorded 仅证明已保存，not-observed 不能证明保存失败。共享解析校验空来源和最小历史结果；查询清除继承写条件，也不会被 HTTP 幂等成功缓存固定。此增补只有源码，未编译、测试或运行验证。

`get_session_command_receipt` 查询运行/工具/结束的原请求，参数 session_id、expected_identity、request_key、operation（run.start/run.finish/tool.call/tool.finish/end）和 command（所有原字段及原 expected_version；run.finish 还含原路径 run_id、原 expected_run_version，tool.finish 还含原路径 tool_call_id、原 expected_tool_version）。要求有效客户端和 session.write，标为只读；不执行原命令，拒绝新的 idempotency_key。recorded 返回历史版本和结果 ID/结束状态，不表示当前会话状态；not-observed 不能作为换键依据。复用 026 持久回执，run.finish / tool.finish 分别需要 028 / 029 扩展操作约束，迁移均未执行。

`get_resume_receipt` 同样为只读恢复工具，要求有效客户端和 session.write；参数为原父 session_id、handoff_id、request_key 和可选 require_claimed。recorded 证明原子会话绑定，不证明上下文新鲜或会话仍运行；not-observed / legacy-unverified 均不能作为换键依据。新 resume_origin 及 025 迁移见检查点上下文绑定文档，迁移尚未执行。

2026-11-02 领取增补：`accept_handoff` 要求原 expected_identity（tenant/workspace/project/actor/client）、handoff_id、expected_version 和 idempotency_key；新增只读 `get_handoff_claim_receipt`，参数为同一 expected_identity、handoff_id、request_key、claim（原 expected_version 与实际提供过的 client_id）。两个工具仅向已验证客户端展示，使用 session.write 或 handoff.claim；调用时对比可信 context，不以输入建立身份。查询不接受写入选项并清理继承的键/版本，仍经过正常路由/授权。成功响应使用共享解析器核对原身份、trace、归属和版本，不将结构错误的 200 当作成功。not-observed 不证明失败，旧 claimed 状态不补认原请求；不自动换键、重提或续接。042 未执行，只有源码开发，见 [领取回执](handoff-claim-runtime.md)。

`finish_agent_run` 要求 session.write、有效客户端、idempotency_key、session_id、run_id、status（completed/failed）、expected_version 和 expected_run_version。写入独立运行终态，保持会话状态及工具记录；已关闭会话仍可补记现有运行结果。回执查询 operation 新增 run.finish，command 包含原路径 run_id 和原两个版本；终态冲突、无变化与历史回执规则见进度命令文档，028 迁移未执行。

`get_session_state` 只接受 session_id，以 context.read 读取当前 status/version/ended_at；不要求写入客户端、不接收请求键或版本，并清除继承写条件。返回封套核对当前 trace、scope、唯一 session 来源和可信身份提示。当前状态不确认原命令成功，不修改恢复请求；权限/生命周期变化后仍需原请求回执。此入口仅完成源码开发，未编译、测试或运行验证，无新增迁移。

`get_session_checkpoint` 只接受 session_id/checkpoint_id，以 context.read 读取指定历史检查点，data 包含 checkpoint/created_at/context_pack_state=not-checked。不要求写入客户端、不接受键或版本；清除继承写条件并共享校验目标、范围、来源与保存时间。当前可读历史笔记不确认原请求，也不证明包当前有效。无新迁移，仅源码开发，未编译、测试或运行验证。

`get_session_run` 只接受 session_id、run_id，返回 data.session 与 data.run；两个版本由同一条查询读取，可审阅后分别用作收尾的会话/运行版本。该读取不依赖分页、不要求写入客户端身份，也不证明某个请求键成功；未知结果仍查询原回执。`finish_agent_run` 标记 destructiveHint，因为记录终态后不能切换为另一终态。

`finish_tool_call` 记录已有工具调用的 succeeded/failed，要求 session.write、有效客户端、idempotency_key、session_id、tool_call_id、status、expected_version 和 expected_tool_version。可补记已关闭运行/会话的迟到结果，保持父状态及运行版本；也标记 destructiveHint。原请求键与两个版本必须保留供重试；结果未知时查询 operation=tool.finish 的原回执。029 迁移仅写文件、未执行，未新增工具执行或输出内容验证。

`get_session_tool_call` 只接受 session_id、tool_call_id，使用 context.read 且标记只读，不要求写入客户端身份。返回同次查询的 data.session / data.run / data.tool_call；共享解析器校验所属关系、状态、版本及来源，不回退内存数据。工具收尾分别使用 session.version 和 tool_call.version；当前详情不能代替原请求回执。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "start_session",
    "arguments": {
      "idempotency_key": "session-start-001",
      "expected_identity": {
        "tenant_id": "01JAAAAAAAAAAAAAAAAAAAAAAA",
        "workspace_id": "01JBBBBBBBBBBBBBBBBBBBBBBB",
        "project_id": "01JCCCCCCCCCCCCCCCCCCCCCCC",
        "actor_id": "original-account",
        "client_id": "original-client"
      }
    }
  }
}
```

写入成功与业务错误均保留 WCP 响应封套在 `content[0].text`，业务错误设置 `isError: true`。有键/版本的命令须保留其原条件；同步确认只保存原身份/目标游标，不生成键/版本。`get_sync_changes` 不自动确认；调用方持久保存完整变化、原身份和目标后，再明确调用 `acknowledge_sync`，结果未知时可用同一原身份读取 `get_sync_cursor`，不自动重试。

## 资源与提示

会话明细读取工具 `list_session_runs` 和 `list_session_tool_calls` 要求 context.read，均只读、不需要请求键。必填 session_id；前者可传 before_sequence/limit，后者可传 run_id/before_id/limit，默认 25、最多 100。保留筛选继续分页，记录状态和 ID 顺序不代表客户端实时执行情况，见 [活动明细](session-activity-runtime.md)。

`resources/templates/list` 提供：

```text
wcp://context/{context_id}
work://project/{project_id}
work://project/{project_id}/current-state
work://project/{project_id}/overview
work://project/{project_id}/work-item/{item_id}
work://project/{project_id}/context-pack/{pack_id}
work://project/{project_id}/context-pack/latest
work://project/{project_id}/context-item/{item_id}
work://project/{project_id}/proposal/{proposal_id}
work://work-item/{work_item_id}
work://work-item/{work_item_id}/context
work://session/{session_id}/checkpoint
work://session/{session_id}/handoff
```

旧项目根地址、current-state 和 work://work-item/... 已统一为持久 Plane 观察快照读取，关联源事件、同版本索引和当前项目检查可见性，不再直读内存 Map。work-item 根地址经 workitem.state 命令授权；新增 get_work_item_state 工具使用外部/aggregate ID。overview 和项目下 work-item/{item_id} 调用持久工作台查询，后者的 item_id 为本地 ID，两种投影不自动互相同步。版本和外部记忆边界见 [Plane 观察状态](observed-state-runtime.md)。会话资源读取 PostgreSQL 中的检查点和交接记录；checkpoint 返回最新检查点，handoff 返回最多 25 条的基础首屏，有更多记录时附带 list_handoffs 续读参数，见 [交接目录分页](handoff-registry-runtime.md)。work:// 读取先检查当前父项目可见性；缺少数据或资源不属于当前项目时返回不可用。持久目录暂不重复枚举旧项目和工作项地址。

`compile_context_pack` 需要有效客户端身份和请求键，可传 `budget_tokens`、`ttl_seconds`。`get_context_pack` 可传 `pack_id`、`format`。保存包资源每次读取都会检查当前权限、来源和到期时间，返回含完整文档的 WCP JSON envelope；参数化 pack 不要求出现在静态资源列表。默认值、错误与 016 数据库迁移依赖见 [ContextPack 运行时](context-pack-runtime.md)。

`resources/list` 已改为 PostgreSQL 持久元数据目录，每页最多 100 条，使用响应 `nextCursor` 继续。依次列出项目 overview、未归档 ContextItem、有效 wcp://context/... 旧索引、可见 Proposal、本地工作项投影、有检查点的会话、有交接的会话及检查通过的保存包；每类按原始 ID 的 C 排序继续，不按编码后的 URI 排序。ID 在 URI 中经过百分号编码，应使用目录返回的完整 URI。名称只使用 URI，不复制标题、正文或来源内容。目录先过滤当前项目、分类和删除状态；旧索引额外过滤到期，Proposal 复用本地来源与派生链可见性规则。ContextItem 的过期/excluded 和 Proposal 的历史状态不影响其作为可读历史资料出现，不表示可用于确认或编译。

游标版本现为 2，绑定租户、工作空间、项目与 data.restricted.read 权限；旧内存目录和版本 1 游标失效，范围或权限变化须重新从第一页开始。单页元数据候选在一条查询内读取，保存包另作逐包读取检查；跨页为实时目录，增删和权限变化可能改变后续结果，不是快照导出。目录存储未配置/查询失败返回 MCP_STORAGE_UNAVAILABLE；不回退内存、不吞错为空目录。项目不可见返回空目录；目录出现也不保证稍后的读取成功。MCP 读取绕过 HTTP 幂等响应缓存，并移除通用 RuntimeResource 缓存短路，保留 source_refs。

会话 checkpoint 地址按会话去重，实际读取最新检查点；handoff 地址合并持久交接和旧投影交接，同 ID 的持久记录优先，与读取端保持一致。已结束会话和历史交接仍可出现，资源存在不表示仍可领取或续接。会话、检查点和交接工作台查询同样重新过滤当前父项目。会话笔记仍沿用项目级读取权限，目录不会读取或内联其绑定的 ContextPack 正文，也不把旧笔记视为当前包有效的证明。

保存包候选先过滤 read_restricted、文档存在和到期时间，再逐个通过正常 context.pack.read 的策略/审计、父项目、哈希、预算和递归来源检查；每页最多检查 8 个候选，检查通过才输出 pack_id 地址，不枚举 latest 别名。拒绝、未找到、过期或来源变化的包跳过；存储不可用和损坏记录返回错误，不伪装为空目录。继续游标按最后一个已检查候选推进，因此页面可以少于 100 条，甚至 resources 为空但仍有 nextCursor；客户端必须以 nextCursor 是否存在判断结束，不能以条目数量判断。逐包检查各自使用一致性读取，不能把整个目录当作同一快照或后续可用性承诺。

ContextItem 详情/列表、Proposal 可见性规则及本地工作项详情/列表已补充父项目过滤。ContextPack 编译、读取与绑定消费也在各自事务内检查父项目，写入消费同时持有项目共享锁。035/036 目录排序索引仅新增文件、未执行；旧索引复用 034 排序索引。未编译、类型检查、测试、启动服务或发布。

已实现六类提示：`resume_work`、`prepare_handoff`、`review_current_plan`、`analyze_blockers`、`summarize_recent_progress`、`prepare_status_report`，保留 `resume` 别名。参数为可选字符串 `context` 和 `objective`；历史内容以不可信参考数据呈现。未知提示名返回错误。提示只生成工作指引，不自动执行交接或修改业务状态。

ContextItem 提供 `get_context_item` 和 `list_context_items`（`context.read`）；修改与归档需要 `expected_version`，所有条目写入都需要请求键及客户端身份。编辑不会保留旧的 confirmed 状态，分类不可通过编辑更改；`expires_at: null` 可清除到期时间。详情与 017 迁移依赖见 [ContextItem 开发说明](context-item-runtime.md)。

`list_context_items` 支持 cursor/limit，默认 25、最大 100 条。工具返回的 WCP 信封外层提供字符串 next_cursor，继续调用时将它传入 cursor 并保留筛选；没有 next_cursor 即结束。排序保留优先级、更新时间倒序及 ID 升序。范围、restricted 权限或筛选变化后重新从第一页开始。分页为实时列表，并发编辑可能改变页位置，不能作为一致性导出。

归档管理：`list_context_items({ archived: true })` 只读取归档条目，`get_archived_context_item` 返回归档详情及 archived_at，均要求 context.read。`restore_context_item` 要求 context.write、客户端身份、expected_version 和请求键；恢复后保持 excluded 和原到期时间，不自动恢复事实确认或旧包有效性。切换归档视图需清除 cursor；普通 context-item 资源模板仍隐藏归档条目。恢复依赖 020 迁移文件，该文件尚未执行。

历史读取：`list_context_item_history(item_id, before_version?, limit?)` 返回版本摘要及 data.next_before_version；`get_context_item_version(item_id, version)` 返回只读完整快照及操作/作者/事件。两者要求 context.read，并同时检查当前条目和历史分类，未记录版本不回退到当前正文。历史中的 confirmed 不表示当前来源有效。021 迁移仅写入文件，尚未执行。

人工确认：`confirm_context_item` 仅向签名 human、有效客户端且具备 context.review（或管理员角色）的调用者展示，参数 item_id、expected_version、reason、idempotency_key 必填。确认仅针对未过期 proposed 版本，核对直接本地来源并产生新版本与确认历史；编辑撤去当前确认。原始 HTTP 和命令处理器同样检查人工身份，不能以工具发现绕过权限。`get_context_item` 增加 confirm_allowed/confirmation，历史详情可读确认理由；旧确认状态不补造审核记录。022 迁移文件尚未执行。

Proposal 查询工具 `list_proposals`、`get_proposal` 使用 `context.read`。创建必须包含来源和 model/prompt version；审核使用 expected_revision、reason 和请求键，并检查本地来源是否变化。实际身份要求、018 迁移及限制见 [Proposal 运行时说明](proposal-runtime.md)。

## 剩余开发范围

当前 `get_context_item` 响应增加 sources_current/source_check，递归检查同项目本地引用；可选 source_checks 按根来源数组位置返回逐条修复提示及可读活动来源的当前版本，不返回隐藏后代信息。not-checked 或缺失诊断不代表通过。确认、Proposal 创建/确认和持久 ContextPack 编译/读取使用同一检查。无效链不进入新包，旧包/旧建议缺少依赖摘要时不能视为来源有效。它不验证外部证据、不重写历史审核。详见 [本地来源链说明](context-source-runtime.md)。本轮未执行协议或运行验证。

具备人工确认权限的调用者读取 proposed 条目时，还可得到 confirmation_readiness，预览所有本地后代是否满足已确认/固定版本要求；confirm_allowed 依据严格预览及有效期给出。预览复用原图加载、独立评估并共享工作上限，不产生写入或代替 confirm_context_item 的事务内复查。没有此字段不表示已确认或可绕过审批。

`create_proposal` 可选 derived_from 对象（proposal_id、revision）记录新建议的修订起点；Schema 拒绝其他属性。原建议须同项目可见且版本匹配，新建议独立处于 proposed，原审核不修改、不继承。关联最多 32 次派生，读取、审核和同步沿原建议链检查可见性。客户端仍需显式提供正文、重新核对的来源和实际生成信息，工具不会自动复制或重新生成模型内容。

`list_proposals` 可选 derived_from 字符串（原建议 ULID），只返回直接修订；它不是创建工具中的关联对象。与 status/kind/before/limit 组合使用，后续分页须保留原筛选。权限检查涵盖派生链，空结果不暴露原建议或隐藏修订是否存在；没有自动递归遍历全部后代。

- Plane 工作项创建/更新、独立决策/风险/文件、通用 Approval 和受控 Memory Tools 尚未接入此目录；Proposal 的审核入口已单独接入。
- plan/timeline/decisions/risks/artifacts/Memory 页面资源仍待相应领域读取接口。
- 客户端上下文预算、文件和流式能力降级协商尚未完整接入。
- `apps/mcp-gateway` 的内嵌辅助类与此 HTTP 运行时仍需进一步统一；本文描述实际 `/mcp` 入口。
- 未产生本次改动的协议兼容、权限或端到端运行证据。

2026-11-02：context.read 工具增加 `get_session_handoff`，仅 handoff_id，GET /v1/handoffs/{handoff_id}。读取清除继承写条件且不要求写入客户端，成功结果使用共享封套校验；只展示当前记录，不能替代创建/领取/续接的原请求回执。无新迁移，未编译测试或运行验证，见 [单条交接读取](handoff-read-runtime.md)。

2026-11-02：新增 context.read 只读工具 `list_session_checkpoints`，必填 session_id ULID、可选正安全整数 before_revision，GET /v1/sessions/{session_id}/checkpoints 返回最多十条历史及可选 next_before_revision。共享校验范围/会话/trace/原笔记/顺序/游标，拒绝写入字段、清除继承写条件，不要求写入客户端、不自动翻页。原最新检查点 Resource 保留；仅源码开发，无新迁移，未编译、测试或运行验证，见 [检查点历史](checkpoint-context-runtime.md)。

2026-11-03：`list_conflicts` 迁移为元数据分页，默认 25、最多 100 条，支持 query/status/entity_type/conflict_id/limit/cursor。query 只对六项元数据做 ASCII 大小写折叠的字面搜索，按不可变 conflict_id 的 C 顺序续页；保留原筛选和 limit，失效游标显式报错。版本为十进制字符串，双方值和决策元数据改用 get_conflict。调用固定原上下文、清除继承写条件、核对成功 200/trace 及完整封套，不自动翻页。内层业务 JSON 最多 2 MiB；没有新增 MCP 二次转义/发送、准备容量或期限保证。Mock/fixture 和协议兼容性仍待补齐，未运行验证，见 [冲突目录分页](conflict-registry-runtime.md)。

2026-11-03：新增 `get_conflict_receipt`，原 identity/request_key/完整有效 command 只读核对 013 保存的决定和事件；保留额外原字段，不能根据当前详情换键或版本。发现/调用要求 verified、未过期 resolver，固定请求、清除继承写条件并校验 200/trace/完整封套。recorded 不证明源实体应用，not-observed 不是失败证明，legacy 与参数不匹配明确失败。内层成功限 2 MiB，本增量不增加 MCP 外层/发送/容量/期限保证。见 [冲突原请求回执](conflict-receipt-runtime.md)，仅源码，未运行验证。
