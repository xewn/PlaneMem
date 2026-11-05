# 会话进度命令的事务与重试

2026-11-05，TODO P0-01：新增 [session-commands OpenAPI](../../../packages/contracts/openapi/session-commands.json)、[写入 Schema](../../../packages/contracts/schemas/session-command-write.json) 和 [原回执 Schema](../../../packages/contracts/schemas/session-command-receipt.json)，六路完整定义已按当前源码描述，分开原 HTTP、严格新客户端、完整历史写入成功和原查询摘要。本轮没有修改运行实现。

补充实际差异：旧 HTTP 允许未知正文字段，原路径覆盖同名正文 ID，有效版本头覆盖正文版本而不核对二者相等；原指纹仍保留未知字段，model 非字符串/空串仅在执行时被忽略。原查询保留全部原 command 字段，SDK 另检查原 actor/client；HTTP 查询不独立比较嵌套身份，且解析后忽略合法的新键/版本头。原查询仅同语句核对当前可见父会话并解析已存快照，不重读当前运行/工具；写入重放才复查当前明细关系/版本/状态。无变化收尾仍保存新回执并经过入口审计，不能当只读操作。

历史写入记录和来源扩展由持久解析器保留。运行收尾源码只校验来源条目，结束源码只要求创建身份/trace 为字符串、日期可解析、来源为合法数组；SDK 的名称/200 项限制、来源成员、parent!=self 和结束时间先后约束不冒充服务端保证。无存储配置保留本地 fixture，但已配置不支持原子命令或失败的存储不降级；原回执查询始终要求数据库。六个 POST 沿认证前 1 MiB JSON-object 解析，畸形/空/非对象/超限均 400 INVALID_JSON；URL 查询忽略，无专门媒体/编码/总响应字节/整次期限限制。P0-01/R-001 未完成、evidence 为空；仅人工源码文档审阅/指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

更新：2026-11-02。本文描述开发代码；未编译、类型检查、测试、运行迁移、部署或发布。

## 支持入口

| 路径 | 行为 |
| --- | --- |
| POST /v1/sessions/{session_id}/runs | 追加 AgentRun，推进会话版本 |
| POST /v1/sessions/{session_id}/runs/{run_id}/finish | 记录运行 completed/failed，核对会话与运行版本 |
| POST /v1/sessions/{session_id}/tool-calls | 追加 ToolCall，推进会话版本 |
| POST /v1/sessions/{session_id}/tool-calls/{tool_call_id}/finish | 补记 succeeded/failed，核对会话与工具记录版本 |
| POST /v1/sessions/{session_id}/end | 结束 running/paused 会话 |
| POST /v1/sessions/{session_id}/commands/receipt | 查询本人原始进度命令的历史保存结果，不执行命令 |

写入入口均要求原 expected_version 和稳定 Idempotency-Key；正文提供 idempotency_key 时必须与头一致。运行收尾另需 expected_run_version，工具收尾另需 expected_tool_version。继续使用 session.write 及既有签名范围/身份规则。SDK、CLI 和 MCP 已提供请求键参数；原先无键调用上述入口的自定义客户端需要补键。回执查询要求签名客户端及 session.write，原请求键放在正文 request_key，不需要新的写入键。

工作台已在源码接入 run.start/tool.call 独立创建页，支持原请求保存、重载、导入/导出、原键回执和明确重试。恢复不自动发请求，当前状态不证明原键成功；新草稿需审阅当前状态。详见 [活动创建入口](session-activity-runtime.md#工作台创建运行与工具记录)。无新后端事务或迁移，尚未执行验证。

## 数据库写入

项目可见性增量：持久进度命令先在事务中共享锁定未删除、有效分类且本次可见的父项目，再锁定会话；历史成功重放也重查该边界。可信 read_restricted 从 Gateway capability 传入，不从业务正文获得。回执查询同语句检查父项目/会话，缺少可见父记录返回 SESSION_NOT_FOUND，只有可见父会话无回执时返回 not-observed。写入要求已验证客户端，显式自报 actor/client 必须一致。无新迁移或运行证据，详见 [会话项目可见性](session-project-access-runtime.md)。

PostgresSessionStore 的 mutateSession 在同一事务内按 tenant/workspace/project/session 锁定会话行。先查成功回执；若没有，再以锁内当前状态校验版本和生命周期，读取所需运行记录，计算纯状态转换，条件更新会话，插入明细和成功回执。任一步失败，全部回滚。无事务支持的持久适配器不会退回分步保存，而是返回 SESSION_STORAGE_UNAVAILABLE；未配置存储的离线 fixture 保留内存实现。

同一会话的并发命令串行取得行锁，旧 expected_version 无法覆盖已推进的版本。运行序号取数据库 MAX(sequence_no)+1，不依赖进程内记录数量；上限按数据库 INTEGER 约束检查。工具调用必须引用同一会话的现有运行。会话版本推进前检查安全整数上限，变化同时记录本次 trace。

更新计算不修改长期缓存；仅事务返回后发布已提交结果。重放历史回执时同时读取当前数据库会话，运行回执还读取当前运行；避免把历史 running 状态重新发布为最新缓存。当前运行版本不可落后于回执，同版本状态必须一致，收尾回执的终态也必须与当前运行一致，否则返回 SESSION_RECEIPT_INVALID。低层 saveSession 更新也改为仅允许紧邻版本且范围、创建身份、父会话和续接来源匹配；进度命令走专门的事务更新路径。

会话创建与父会话读取结果也按版本更新缓存，较晚返回的旧创建结果不能覆盖新进度；起始回执保留独立快照。返回值与缓存深复制，调用方修改嵌套 source_refs 不会改变已缓存的来源记录。

## 回执与版本语义

2026-11-02 收尾客户端增补：新增共享 `session-finish-clients`，用于 run.finish/tool.finish/end 的新写输入与完整成功封套。SDK 的三个收尾方法增加可选 expectedIdentity，缺省仅从固定完整构造身份取得；CLI/MCP 相应命令必须提供 expected_identity。所有入口对比原范围/账号/客户端，保留原键、原会话版本和收尾所需原明细版本；新写只接受已声明字段，历史查询仍保留全部原 command 字段。共享解析供 Web 同步复用，旧恢复文件不变。

成功解析核对封套与记录 schema/trace/source_refs、原目标/状态、可选 ETag，以及会话/明细共同增加 0 或 1 的关系。已有同终态且原版本匹配时允许无变化成功，包括安全整数上限处的 delta=0；不把所有成功都解释为一次状态转换。运行来源需包含所属会话，工具来源绑定所属运行；模型和工具名称仅作为历史记录保留，不伪造新的执行事实。结束响应核对三层范围、正安全版本、开始/结束时间先后、可选父会话和续接来源结构；actor_id/client_id 是原创建者，可与本次结束操作者不同。操作者仍由原请求身份前置条件和网关授权约束。

无效成功响应进入未知结果恢复，不能用新键或当前版本自动替代。Web 额外将 SESSION_RECEIPT_INVALID 明确保留为未知；normal response 的封套 trace 是本次调用，记录 trace 允许保持原提交值。此增量不改变后端状态机/事务/持久回执，无新增迁移，016–044 未执行；只修改源码文档，未编译、类型检查、测试、服务运行或发布。

026_session_command_receipts.sql 创建 wcp_session_commands，主键为 session_id / operation / request_key。请求键摘要包含 actor/client；会话 ID 和锁定查询绑定项目范围。指纹沿用原始请求与有效 expected_version，剔除正文请求键；操作种类单独参与主键。

回执与业务写入在同一事务保存，包含当时的会话与结果快照。相同操作、键和原参数重试，在当前状态校验之前返回原结果，不重复插入、不推进版本；改参数复用键返回 IDEMPOTENCY_KEY_REUSED。即使会话后来结束，仍可重放当时成功追加的运行/工具回执。HTTP 不直接返回内存缓存正文，持久回执在重启和不同实例间是权威来源；返回前核对其类型、范围、版本、来源结构及原操作字段，损坏返回 SESSION_RECEIPT_INVALID。

AgentRun / ToolCall 命令响应新增 session_version，表示该次写入完成后的会话版本；其自身 version 仍是明细版本。重放时 session_version 是原始历史值，不是当前版本保证。下一条新命令通常可用刚获得的 session_version；若会话已有其他写入，应重新读取当前会话版本并审阅后提交新命令。SDK 将此字段设为可选以兼容旧网关，调用方不可用 run.version 替代会话版本。

结束到相同状态仍需匹配当前版本；提供匹配版本时为不推进版本的成功请求。重试原结束请求必须保留原键与原版本，不能因状态已经相同而跳过版本校验。同键成功回执则先于该校验返回。

## 只读结果恢复

`POST /v1/sessions/{session_id}/commands/receipt` 的正文包含 `request_key`、`operation`（`run.start` / `run.finish` / `tool.call` / `tool.finish` / `end`）和 `command`。command 必须保留原始正文的所有字段，并补入原 If-Match 对应的 expected_version；run.finish 还要补入原路径 run_id，tool.finish 则补入原路径 tool_call_id。各自原 expected_run_version / expected_tool_version 也需保留。若原正文带 session_id 或 idempotency_key，须与查询目标和原键一致。不得使用当前会话版本替换原版本，也不要重新整理 model、tool_name 或其他原始值。查询不采纳新请求头中的版本或键作为原操作条件。

示例为原 run.start 请求的查询正文，仅为说明，未执行：

```json
{
  "request_key": "run-start-001",
  "operation": "run.start",
  "command": { "model": "example-model", "expected_version": 3 }
}
```

查询使用与写入相同的身份键摘要和原参数指纹，在项目范围内读取 026 中的持久成功记录；不会调用状态转换、创建明细或推进版本。HTTP 查询绕过成功响应缓存，因此早先的 not-observed 不会固定后续结果。即使当前会话已结束，也可以查询历史成功操作。

- `recorded`：返回 session_id、operation 和历史 session_version。run.start 另有 run_id / sequence；run.finish 另有 run_id / run_version / run_status / changed；tool.call 另有 run_id / tool_call_id；tool.finish 另有 run_id / tool_call_id / tool_version / tool_status / changed；end 另有 ended_status。返回前校验完整持久快照与原操作匹配，但不披露快照正文、来源引用或其他参与者身份。
- `not-observed`：当前查询未观察到匹配记录，可能仍在提交或为旧无回执操作；不能据此判断失败、换键或重复创建。保留原内容和键继续查询或重试原命令。
- 同键改参数返回 IDEMPOTENCY_KEY_REUSED；损坏回执为 SESSION_RECEIPT_INVALID；未配置持久库、缺表或存储不可用返回 SESSION_RECEIPT_STORAGE_UNAVAILABLE，不把内存状态当作持久成功证据。

客户端入口为 SDK `getSessionCommandReceipt(sessionId, query, expectedIdentity?)`、CLI `sessions receipt` 和 MCP `get_session_command_receipt`。均绑定原 tenant/workspace/project/actor/client；SDK 省略显式身份时须在构造上下文固定完整身份，CLI/MCP 要求 expected_identity。共享解析核对响应 trace、空来源、无当前 ETag，以及原操作、会话、历史版本和结果标识。recorded 只确认原操作，历史版本不保证可用于下一次写入；会话当前状态需另行读取。

2026-11-02 / ADR-015 活动创建客户端增补：共享 session-command-clients 提供原命令绑定、新创建字段解析、创建响应和历史回执封套解析。SDK startAgentRun/recordToolCall、CLI runs start/tool-calls record、MCP start_agent_run/record_tool_call 和 Web 创建页复用；创建核对 version=1、session_version=原版本+1、原 model 或 run/tool_name/status、合法标识/序号及精确来源。封套 trace 是本次调用，记录 trace 可以是最初提交；可选 ETag 只能是明细版本 1。返回原创建记录，不以当前终态推定原请求失败。

SDK 只接受方法声明的业务字段和 key/version 选项，CLI/MCP 保留实际发送的 session_id 及 idempotency_key；身份字段 expected_identity 在适配时移出业务正文。CLI 可显式提供一致的原 actor_id/client_id，它们参与原正文；MCP 的字段集合由工具目录限定。新创建 model/tool_name 不 trim，名称有界且非空白；历史查询仍允许全部原 command 字段以恢复旧请求。查询复制原数据，避免调用方异步改写绑定；不得自动换身份、版本或键，也不接续执行命令。嵌入 CLI/MCP 直接对比已验证 context，HTTP 使用 expected 身份头；查询不继承写入键或版本。无新增路由、事务或迁移，016–044 仍未执行，源码未编译、类型检查、测试或运行验证。

## 运行收尾

`POST /v1/sessions/{session_id}/runs/{run_id}/finish` 正文为 `{ status: 'completed' | 'failed', expected_version, expected_run_version }`。expected_version 来自会话，expected_run_version 来自运行记录。客户端根据已观察到的结果提交；此操作不会执行、取消或验证实际模型任务。

会话与运行版本均匹配且运行仍 running 时，运行转入选定终态，两个版本各推进 1，同时保存 trace 与成功回执。running / paused / ended / abandoned / failed 会话均可补记现有运行的最终结果；会话状态及 ended_at 保持原值，因此不会重开已关闭会话。运行已处于相同终态且两个版本均匹配时为成功无变化，两个版本不推进；不同终态返回 RUN_STATE_CONFLICT。版本不符分别返回 SESSION_VERSION_CONFLICT / RUN_VERSION_CONFLICT。同键成功回执先于当前状态及版本检查返回，因此重试仍保留原始两个版本。

事务先锁会话，再锁运行，条件更新运行及会话并保存回执；失败全部回滚。历史 run.start 回执重放会同时读取当前运行供缓存发布，不能将已完成运行恢复成 running。新的工具记录只接受仍 running 的运行；已保存工具回执仍可原键重放。运行收尾不批量修改工具记录，也不要求其全部成功；现有工具记录的结果通过独立 tool.finish 补记。

普通响应仍为 AgentRun，version 是运行版本，session_version 是该次命令后的历史会话版本。只读 run.finish 回执包含 run_id、run_version、run_status、changed 及 session_version；changed=false 对应两个版本都未推进。查询时 command 包含原 run_id、status、expected_run_version 和 expected_version，完整原字段参与指纹。

SDK 入口为 finishAgentRun(sessionId, runId, status, { idempotency_key, expected_version, expected_run_version }, expectedIdentity?)；CLI 为 runs finish；MCP 为 finish_agent_run。结果未知可通过原 sessions receipt / get_session_command_receipt / getSessionCommandReceipt 查询 operation=run.finish。028_session_run_finish.sql 扩展 026 的操作约束，仅写文件、未执行；缺少该迁移时回执写入失败，业务事务也回滚。

工作台运行详情现已接入收尾确认、原请求重试和回执查询。详情按 run_id 独立读取，原地刷新不会改变原请求版本或解除未知状态；成功后保留历史回执，当前记录需手动刷新。运行与工具收尾新增同标签页原请求恢复、导出/导入及原身份前置条件；完整流程见 [活动明细](session-activity-runtime.md#运行和工具原请求恢复)。恢复不自动提交，也不以浏览器缓存代替服务端回执。

## 工具调用收尾

`POST /v1/sessions/{session_id}/tool-calls/{tool_call_id}/finish` 接受 `{ status: 'succeeded' | 'failed', expected_version, expected_tool_version }`。expected_version 来自当前会话，expected_tool_version 来自工具记录自身 version。它更新原 tool_call_id，不再为同一次调用新增另一条结果记录；工具名称、所属运行、来源引用保持原值。

两个版本均匹配且工具为 started 时，会话和工具版本各推进 1，更新 trace 并原子保存回执。工具已处于相同终态时，仍要求两个当前版本匹配，然后返回无变化成功；不同终态返回 TOOL_STATE_CONFLICT。版本不符分别返回 SESSION_VERSION_CONFLICT / TOOL_VERSION_CONFLICT，找不到当前会话内且关联同一会话运行的工具记录返回 TOOL_CALL_NOT_FOUND（404）。

允许在运行或父会话结束之后补记迟到结果。会话状态、ended_at，以及运行状态和运行版本均保持原值；记录成功并不证明真实工具执行成功，也不会补出输出正文或时间。新工具调用仍遵守活跃会话和运行的限制，收尾入口只更新已存在的调用。

事务先锁会话，再锁目标工具行；条件更新工具、会话和回执在同一事务中完成。重试先读取历史回执，保留原键与原两个版本，不重复推进。tool.call / tool.finish 重放同时读取当前工具记录供缓存发布；旧 started 回执不能覆盖当前终态，同版本状态矛盾或已记录终态与当前状态矛盾时返回 SESSION_RECEIPT_INVALID。

普通响应仍为 ToolCall，version 是工具版本，session_version 是原命令后的历史会话版本。只读回执 operation=tool.finish，command 必须包含原路径 tool_call_id、status、expected_tool_version、expected_version 及其他原字段；recorded 返回 tool_call_id、run_id、tool_version、tool_status、changed 和 session_version。未查到仍不代表失败，不应自动换键。

SDK 为 `finishToolCall(sessionId, toolCallId, status, { idempotency_key, expected_version, expected_tool_version }, expectedIdentity?)`，CLI 为 `tool-calls finish`，MCP 为 `finish_tool_call`。工具列表可以读取更新后的状态，工作台独立工具详情页已接入结果确认、原请求重试和回执查询，见 [工具调用结果](session-activity-runtime.md#工作台工具调用结果)。029_session_tool_finish.sql 扩展操作约束，文件仅开发、未执行；缺少该约束扩展会导致回执写入及业务事务一起回滚。

## 工作台结束入口

2026-11-03 独立恢复增补：`/sessions/recover` 使用可信调用者元数据，支持在当前会话详情不可读时精确加载或导入 end 原请求。原 outcome/version/key/identity 固定，加载初始未知，不生成当前会话快照，不自动发送；明确保存、原回执及确认重试复用既有动作，存储失败不发送写入。会话查找面板提供同标签页导航，详见 [检查点与收尾独立恢复](session-request-recovery-runtime.md)。仅源码和文档，未编译、类型检查、测试、运行或发布。

2026-11-02：除会话注册表选中详情外，新增 `/sessions/detail?session=...` 独立状态与恢复页，通过已有 GET 单会话接口接入同一结束表单和检查点表单。注册表不可读时可按 ID 进入；不从 URL 推断身份/版本，不需要读取全部会话。状态卡片标注为页面打开时的快照，表单内显式读取仍只更新该表单。原恢复键、身份、参数、回执和未知状态不变，无新增 API/事务/迁移；仅开发，未编译、测试、运行或发布。入口与边界见 [独立会话状态与恢复页](session-activity-runtime.md#独立会话状态与恢复页)。

会话详情为有 session.write 能力的 running/paused 会话提供 Close session，选择 ended / abandoned / failed 并确认后提交。修改所选结果或采用新版本时撤销确认并换用新请求键；服务端仍按签名身份、权限及数据库当前版本判定。详情同时显示会话版本和关闭时间。关闭的是会话记录，不会停止已连接客户端，也不会自动保存检查点；需保留的进度应先写检查点。

结束请求的键、会话、状态和原 expected_version 保留在当前表单，并在发送前保存至绑定原身份/项目/会话的同标签页恢复槽、读回确认；保存失败不发送写请求。网关网络异常、408、5xx、无效成功响应或浏览器未收到服务端操作响应，都会保持结果未知；之后即使遇到认证错误、版本冲突或未观察到回执，也不解除锁定。未知时不能修改状态或采用新版本，但可以查询原回执、确认后原键重试或原地刷新状态。即使当前记录已关闭，原请求恢复入口仍保留。

只读查询无需勾选关闭确认；recorded 必须匹配原会话、操作、结果及历史版本，方可显示原关闭已保存。普通写入响应同时检查会话编号、schema、终态、版本和结束时间，再由共享回执解析器复核。不再因提交结果自动重载列表；成功反馈保留历史回执。Refresh current session state 只读取固定会话并更新结束表单内状态/版本/关闭时间/权限，页面其他列表及统计保持原读取值，可在新标签页查看完整详情。无未知结果且状态仍活动时，版本变化后可明确采用当前版本并重新确认。

2026-11-02：会话结束已复用运行/工具的恢复组件。格式为 `{schema_version:1,request:{operation:'end',identity,key,sessionId,version,outcome}}`，outcome 仅 ended/abandoned/failed；不保存 resourceId/resourceVersion，也不补造它们。旧运行/工具格式继续可读。重载/导入后按未知处理并撤销确认，不读取缓存成功标记、不自动查询或提交；用户可查询原回执或重新确认原键重试。支持有界 JSON 导出/导入，损坏或不同请求不能覆盖；关闭标签页前需先导出。同标签页重新选择原会话可恢复其请求，列表筛选或默认选中另一会话不会把旧请求带到新会话。

工作台 sessions 查询新增与活动详情一致的可信 session_identity，签名客户端和写入提示必须匹配。表单按 scope/actor/client/session 固定，提交、回执和原地刷新携带原身份前置条件，当前账号/项目改变后不能误用另一身份发送。新的 `POST /v1/workbench/query` 正文 `{operation:'session',session_id}` 用于独立读取 `{session_id,status,version,ended_at}`，不依赖列表当前筛选；session_id 必须为 ULID，拒绝额外字段。现有 context.read、令牌、策略/审计和只读缓存豁免仍生效。SQL 按当前项目可见性及已知分类过滤，缺失/不可见为 SESSION_NOT_FOUND；版本为正安全整数，活动 ended_at 为 null，关闭状态必须带规范 UTC 时间，损坏返回 SESSION_ACTIVITY_INVALID。

本轮无新迁移，仅源码开发；会话结束依赖 026，仍未执行。没有编译、类型检查、浏览器、服务或测试验证。检查点已通过后续增补获得独立原请求恢复格式，见 [检查点恢复](checkpoint-context-runtime.md#工作台原请求恢复)；其余表单仍需各自接入。

## 边界

- 026 迁移仅写文件、未执行；缺表不返回假成功。历史操作没有新的持久回执，不从现有 run/tool/结束状态补造其请求归属。
- 新操作使用新键，结果未知时保留原键、内容和版本重试；已有历史记录但缺回执时，旧版本冲突不能证明原操作未成功。
- 原本的同步内存方法只作离线实现，内存回执随进程丢失；配置数据库后异步方法要求适配器提供原子 mutateSession。
- tool.call 仍追加独立记录；tool.finish 更新既有记录，运行/工具详情及会话结束表单已开发并补入同标签页原请求恢复。026/028/029 分别承载基础回执、运行收尾和工具收尾操作；均未执行。额外同步事件和运行验证仍未完成；尚未提交的表单编辑和确认不会持久化。
