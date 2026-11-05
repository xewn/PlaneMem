# 检查点的持久上下文绑定

2026-11-05 P0-01 机器契约增补：[checkpoint-commands OpenAPI](../../../packages/contracts/openapi/checkpoint-commands.json) 与 [checkpoint-write Schema](../../../packages/contracts/schemas/checkpoint-write.json) 描述保存/原回执两个 POST，分别建模原 HTTP、严格客户端、完整历史保存和最小查询结果。不改运行实现；OpenAPI 累计 78 路，P0-01/R001 未完成、evidence 为空。

此次源码对照明确：保存只增加检查点 revision，不改变会话 version；当前 Postgres MAX+1 没有 JavaScript 安全整数溢出检查。旧未绑定保存允许无键，选中键只检查非空、头键覆盖正文且不比较；SDK/查询使用更严格原键。保存包当前检查先于持久回执重放；原查询只核对指纹、ID、正安全 revision 和可选包 ID，不读取笔记、来源、状态哈希、记忆或当前包。旧 state_hash 为 `sha256:` 前缀加 8 位十六进制的 32 位算法，不能当成 SHA-256 内容证明；持久包 context_pack_hash 与之独立。

普通保存返回完整历史记录但未经过服务器完整记录解析，SDK 会进一步核对原笔记/引用/来源/身份，仍不重算状态哈希。两个 POST 的通用 1 MiB 正文、无专用响应字节/整次期限和错误包装差异见 [完整 HTTP 说明](../../../packages/contracts/openapi/README.md#检查点保存与原回执)；GET 全文 2/8 MiB 预算不扩展到这些 POST。仅人工源码文档审阅/指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

2026-11-03 全文读取增补：详情完整封套最多 2 MiB、十条历史页最多 8 MiB；SQL 输出前限制正文，超限 HTTP 413 且不返回截断记录。SDK/Web/CLI 网络接入有界读取和本地期限，CLI/MCP 共享完整解析，页面失败保留查找及原请求恢复。读取限制不影响既有保存回执的业务语义，不证明写入成功或失败；详见 [检查点全文读取边界](checkpoint-read-runtime.md)。仅源码与文档，未编译或测试。

更新：2026-11-02。仅开发代码与文档；未编译、未执行类型检查、测试、迁移、部署或发布。

项目可见性增量：持久检查点与旧领取/续接内部写入先在事务内锁定可见父项目，检查点原键重试每次经过数据库，不提前返回内存成功。持久交接/检查点读取重查项目，缓存缺失或不可见时清除旧条目。检查点和续接回执先确认可见父会话，权限变化返回 SESSION_NOT_FOUND，不伪装成 not-observed。续接和旧领取只使用已验证 actor/client，自报不一致拒绝。无新迁移或运行证据，见 [会话项目可见性](session-project-access-runtime.md)。

## 创建检查点

### 历史检查点单条读取（2026-11-02，仅源码）

新增 `GET /v1/sessions/{session_id}/checkpoints/{checkpoint_id}`，映射 `session.checkpoint.read`；参数仅路径里的两个 ULID，拒绝所有查询参数。要求签名令牌及 context.read，无写入客户端要求，也不接收保存请求键。读取绕过写入成功缓存，返回 private/no-store；单条 SQL 同时检查父会话范围、父项目未删除/有效分类及 restricted 读取权限，并关联该会话的指定检查点。父会话不可读返回 SESSION_NOT_FOUND，可见会话下没有目标检查点返回 CHECKPOINT_NOT_FOUND；不会用空数据或“最新检查点”代替。

data 为 `{checkpoint,created_at,context_pack_state:'not-checked'}`。checkpoint 包含原六类笔记数组、检查点 revision、原 scope/session/ID、state_hash、可选 context_pack_id/context_pack_hash/memory_ref、原 trace/source_refs；外层 trace 属于当前读取，来源只标识目标 checkpoint。共享解析核对目标、范围、数组、引用与时间；不提供写入 ETag、不验证原请求键、不访问外部记忆，也不读取或验证当前包。历史记录可被审阅，但不能解除原请求未知结果。

SDK `getSessionCheckpoint(sessionId,checkpointId)`、CLI `checkpoints get`（JSON 只含 session_id/checkpoint_id，禁止 --key）、MCP `get_session_checkpoint` 统一接入。嵌入 CLI 和 MCP 清除继承写条件，MCP 标记只读并使用 context.read。工作台 `/sessions/checkpoint?session=...&checkpoint=...` 独立显示六类原笔记、保存时间、引用、记录/读取 trace；保存成功、历史列表、会话最新/续接来源、交接详情和续接成功结果均可新标签页直达。包链接另行读取并重新检查其有效性；查看页面不修改恢复草稿或执行续接。

无新增迁移，复用已有检查点表；016–044 均未执行。本增补未编译、类型检查、测试、浏览器/服务运行或发布。

`POST /v1/sessions/{session_id}/checkpoint` 新增可选 `context_pack_id`（ULID），与旧 `context_pack` 内嵌对象互斥。六类进度数组、`expected_version` 和原请求键沿用；不提供包时仍可保存普通进度检查点。

使用持久包绑定必须携带稳定请求键；旧无绑定入口保留原有兼容规则。

绑定 ID 时，网关复用 `context.pack.read` 的策略和审计入口，除会话写入授权外还要求上下文读取授权。restricted 包仍要求 `data.restricted.read`，管理员不绕过内容过滤。服务端读取当前项目内的完整持久包，检查 scope、哈希、预算、寿命、来源指纹和递归依赖摘要。

检查点保存 `context_pack_id` 和服务端读出的 `context_pack_hash`，来源引用包含包 ID。状态哈希纳入包 ID；旧无 ID 的状态哈希序列化保持原样。请求指纹仍由原始 HTTP 输入计算，服务端补入的包文档不进入指纹。

需要 `024_checkpoint_context_pack.sql`，本次只新增迁移文件，未执行。新增列可空，不从历史哈希推测或补造包 ID。

## 工作台检查点历史分页（2026-11-02，仅源码）

沿用 `POST /v1/workbench/query` 的 `operation: checkpoints`。按会话读取时正文仅允许 operation、ULID session_id 和可选正安全整数 before_revision；不提供 session_id 时仅接受 operation，保留原全量创建选项读取。额外字段、无会话的游标、错误 ID/类型拒绝为 INVALID_INPUT。

按会话分页改为从可见父会话出发，在同一 SQL 语句中读取父会话及最多 11 条较旧检查点。父项目必须未删除、分类已知且满足 restricted 读取能力；检查点按 tenant/workspace/project/session 关联。缺失或不可见父会话返回 SESSION_NOT_FOUND，不伪装为空历史。可见父会话确实没有符合游标的记录时才返回空数组。仍按 revision 降序、每页最多十条，第十一条仅判断是否还有下一页；before_revision 为排他上界。

封套保留 schema_version/data 数组/trace/source_refs/next_before_revision，增加 session_id；每行也包含 session_id。查询层附加可信 session_identity（若有）与 session_permissions.write_sessions，供独立历史页展示准备入口；这些提示不授予后续命令权限。共享 checkpoint-history 解析器在 Gateway 和 Web 核对会话、唯一 ID、正安全整数修订、严格降序及游标边界、六类原字符串数组、创建时间、记录 trace 和包引用；next_before_revision 只能等于满页最后一条 revision 且大于一。数据库返回的规范十进制修订串在 Gateway 转为数字，时间规范化为 ISO，旧无包 ID 的非空哈希继续保留，不赋予有效性。损坏的任一记录（包括额外读取的一条）返回 SESSION_ACTIVITY_INVALID，不跳过或生成错误游标。

新增 `/sessions/history?session=...&before=...` 独立页面，严格校验 URL，仅请求当前会话历史，不读取全量会话或另行请求当前状态。会话状态、检查点详情和注册表入口接入；旧 registry history 参数仍支持内嵌显示，内嵌翻页在新标签页打开独立历史以保留表单。独立页翻页保持会话 ID，可回到最新修订；空页、无权限/不可见、响应损坏分别处理。历史组件将读取与解析都纳入局部错误处理，显示本次读取 trace 与每条记录的历史 trace。笔记保留原顺序/空白/重复项，不自动展开包、创建交接或续接。

跨页是分别读取，不承诺固定导出快照；新保存记录在回到最新页后可见。历史不确认原请求键，不修改现有恢复槽或检查当前包有效性。本批不新增 HTTP 路由、写事务或迁移，016–044 仍未执行；仅源码和文档，未编译、类型检查、测试、浏览器/服务运行或发布。

MCP 的 `work://session/{id}/checkpoint` 复用同一持久读取，仍返回最新一条。资源 ID 非 ULID、父会话缺失/不可见或无检查点映射为原资源缺失结果；数据库和结构错误继续返回错误。单条资源不携带列表的 next_before_revision，不能将它误当成分页响应。

## 历史分页的 REST、SDK、CLI 和 MCP 入口（2026-11-02，仅源码）

新增 `GET /v1/sessions/{session_id}/checkpoints?before_revision=...`，内部操作为 session.checkpoints.list。只接受可选 before_revision，重复、未知或非正安全整数查询参数拒绝；会话 ID 必须为 ULID。要求签名令牌与 context.read，不要求 session.write 或写入客户端身份，沿用策略/审计/限流及 private, no-store，并绕过写入幂等缓存。复用上一节的同语句父会话可见性和十条分页实现，不复制存储逻辑或创建新事务。

公共封套在原历史页字段之外包含 tenant_id/workspace_id/project_id；共享 parseCheckpointHistoryEnvelope 核对请求范围，再校验目标会话、trace、来源、记录、排序与游标。与工作台入口相同，缺失/不可见父会话不是空历史，结构损坏和存储错误不降级；本次读取不验证历史命令键或当前包有效性。

- SDK：`listSessionCheckpoints(sessionId, {before_revision?})` 返回已校验封套及 data 数组/next_before_revision。只读请求不带写入键、版本或正文；调用者显式使用下一游标，不自动拉取全部历史。原 `listCheckpoints` 工作台查询继续保留。
- CLI：`workctx checkpoints history --json '{"session_id":"01JBBBBBBBBBBBBBBBBBBBBBBB"}'`；下一页正文增加上次返回的 `before_revision` 数字。网络入口支持 --json-file，嵌入 runWorkctx 使用 --json；均拒绝 --key、JSON 写入字段和重复参数。嵌入调用清除继承的 idempotency_key/expected_version，正常成功必须通过同一封套校验。原 `checkpoints list`/`checkpoints get` 继续保留。
- MCP：新增只读工具 `list_session_checkpoints`，必填 session_id，可选 before_revision；只需 context.read。目录 Schema 拒绝写入字段，适配层清除继承写条件，经相同路由/策略读取；成功结果校验请求路径、scope/session/trace/分页，异常成功响应返回工具错误。最新单条资源仍保留原语义。

本次仅接入源码和用法文档，无新增迁移，016–044 未执行；未编译、类型检查、测试、网络调用、服务运行或发布，跨入口和分页运行证据待补。

## 续接与事务

续接先读取交接对应的不可变检查点，核对项目、来源会话和领取资格，预读不修改领取状态。绑定包必须通过当前读取授权、完整性、寿命、来源检查，且匹配检查点哈希，才能领取交接并创建子会话。

绑定路径在同一事务内取得项目同步流锁，检查包/来源，再写检查点或领取交接并创建子会话。存储复用事务，不在单连接池内申请第二个连接，也不启动嵌套事务。事务使用独立服务缓存；提交后才将返回的子会话加入长期缓存，避免回滚留下虚假成功记录。

使用项目流锁的上下文写入不能插入校验与续接写入之间；不协调人工数据库改写，也不保证返回后的来源永久有效。返回的是本次检查时可用的快照。

成功响应保留 `session`、`checkpoint`、`handoff`，增加：

| 字段/值 | 含义 |
| --- | --- |
| `context_pack_state: checked` | 本次重新检查了绑定包；`context_pack` 为完整 `ContextPackReceipt` |
| `context_pack_state: legacy-unverified` | 只有旧客户端提供的哈希/来源；不返回包正文，不宣称当前有效 |
| `context_pack_state: none` | 检查点没有上下文包 |

旧内嵌 `context_pack` 保留历史语义：仅记录哈希和来源引用，未验证为服务端保存的包。旧检查点仍可续接进度，但其哈希不是当前有效知识的证明。此功能不验证人工进度笔记或外部 MemoryRef 内容。

## 重试和失效

检查点保存与续接重试不直接返回 HTTP 层缓存的成功正文，仍保留原始请求指纹检查，并重新读取持久包。不可见、来源失效、过期或内容不一致分别返回 `CONTEXT_PACK_NOT_FOUND`、`CONTEXT_PACK_STALE`、`CONTEXT_PACK_EXPIRED`、`CONTEXT_PACK_INVALID`，不自动换包或换键。

这些错误表示本次未完成绑定后的写入，但**不能证明更早的同键请求未成功**：包校验先于检查点/子会话幂等回执读取。先前结果不明时，保留原参数与键，核对检查点或子会话历史，不直接当成“未保存”创建第二条。明确存在的旧检查点不能原地替换绑定；重新编译包、核对内容后保存新检查点并创建新交接。

## 查询历史保存回执

新增只读 `POST /v1/sessions/{session_id}/checkpoint/receipt`。要求有效客户端和 `session.write`，只能查当前 tenant/workspace/project、actor、client 对应的原请求。正文为 `{ request_key, checkpoint }`；`checkpoint` 是原始保存正文，包含六类进度数组及原 `expected_version`（原本只放在 If-Match 头时也要补入该字段），其余原字段原样保留。可省略原正文中的 `session_id`，路由会补入；若提供则必须一致。

查询复用保存时的请求键摘要和请求指纹，不修改检查点、交接或会话，也不读取上下文正文及来源。即使原包过期或不可读，仍可确认本人原先的保存记录；此授权仅允许读取回执元数据，不授予旧包读取权。

- `recorded`：返回 `session_id`、`checkpoint_id`、`revision`、可选 `context_pack_id`，以及固定 `context_pack_state: not-checked`。不返回笔记、包哈希或来源引用；说明原请求已保存，不表示包仍有效。
- `not-observed`：当前查询未看到记录，不能推断原请求未提交或已失败。可能仍有请求在途，或当前身份与原提交者不同；不自动解除未知状态、换键或重发新草稿。
- 同键原文不一致返回 `IDEMPOTENCY_KEY_REUSED`；无数据库或结构不可用返回 `SESSION_RECEIPT_STORAGE_UNAVAILABLE`（503），不伪造内存查询结果。

HTTP 层不缓存回执查询结果，避免一次 not-observed 遮住稍后提交的记录。接口不接受分页或批量枚举。复用现有检查点回执字段和索引，本次无新增迁移。

SDK：`getCheckpointReceipt(sessionId, { request_key, checkpoint }, expectedIdentity?)`。CLI：`checkpoint receipt --json-file receipt.json`，正文额外提供路由用的 `session_id`、原 `expected_identity`，原键放 `request_key`，禁止新的 `--key`。MCP：`get_checkpoint_receipt` 同样要求原 expected_identity，标记只读并要求有效客户端。

工作台保存失败后提供“Check whether this checkpoint was saved”。使用原笔记、版本、包 ID 和请求键查询，只有匹配的 recorded 回执才转为成功并显示历史检查点入口；暂未查到、无权、断网或无效响应不会解除已有未知状态。

## 工作台原请求恢复

2026-11-03 独立入口增补：新增 `/sessions/recover`，原会话/检查点详情失败时仍可通过可信身份元数据按原 session_id 精确加载本标签页原请求，或导入现有格式。固定原笔记数组、包、版本和键，不假造当前会话、不自动查询或重试；明确保存/读回、回执、确认重试和结果解析复用现有模型/动作。存储冲突禁止覆盖或写入，内存原请求仍可导出或显式查询，服务端仍检查访问。见 [独立恢复边界](session-request-recovery-runtime.md)。仅源码，无新 API/迁移，未编译、测试或运行。

2026-11-02 检查点客户端增补：新增 contracts/checkpoint-clients，共享原身份/范围/会话/键绑定、保存命令及正常/历史封套解析，SDK、CLI 网络/嵌入、MCP、Web 复用。新保存限定声明字段；六类数组逐项保留，不修改空白、顺序和重复项，调用方的原对象在发送前深拷贝。历史查询保留所有原额外字段；它不验证包当前有效，也不重做保存命令规范化。SDK 可显式传 expectedIdentity，省略仅从固定完整构造器身份取得；CLI/MCP 必须提供 expected_identity，并与可信 context 或身份前置头绑定。保存的正文键、选项键、版本条件须一致；查询不继承新写入条件。

正常保存响应核对本次 trace、record schema/scope/session、原六类笔记、正安全 revision、原包绑定和 memory_ref、唯一且匹配的来源及可选 ETag。记录 trace 可以属于原提交；revision 是检查点序号，不按会话 expected_version 推算。saved pack 必须有规范包哈希，旧内嵌包匹配原 pack_hash；现有 state_hash 保留兼容，不把它当作重新计算过的密码学证明。保存包来源可额外包含网关解析到的包引用。最小历史回执拒绝未知字段，固定 not-checked，不携带来源或 ETag。

工作台正常响应先完整解析再投影为既有最小回执，保留原恢复格式、数组、未知状态和手动查回执流程；损坏回执明确按未知处理。此增补无新数据库迁移，016–044 仍未执行；未编译、类型检查、测试、网络调用、启动服务或发布。SDK/CLI/MCP 不自动保存本地恢复文件或重新发送，调用方应先保留原身份和正文。

2026-11-02 / ADR-015：检查点表单改用独立 checkpoint-model、checkpoint-actions 和 checkpoint-form。提交之前将原请求保存并读回同标签页 sessionStorage，存储槽绑定浏览器 origin、tenant/workspace/project、actor/client 和 session_id。保存失败不发送写请求；已在内存中的原请求允许在存储写入失败时继续只读查回执。损坏或不同请求不被覆盖，可重新检查存储。保存结果不触发整页刷新，原表单保持可用。

恢复 JSON 为 `{schema_version:1,operation:'checkpoint.save',request:{identity,key,sessionId,version,notes,contextPackId?}}`，不记录成功状态、确认、令牌或包正文，但**包含原检查点笔记和账号标识**。界面导出到文本框，用户自行保留；完整重载后恢复同一会话的原请求，关闭标签页或清除浏览器数据可能丢失，关闭前需导出。导入核对相同身份/项目/会话，已有原请求只能导入完全相同内容；另一个原请求或损坏存储不能覆盖。导入也不会覆盖尚未提交的笔记，需先复制并明确清空这些编辑。

新草稿沿用一行一项，首次准备请求时去除每行首尾空白和空行。已发送/导入的六类数组保存原始字符串、顺序和条目边界，重试及回执查询不再 trim/split 或重新读表单拼正文。工作台请求每类最多 200 个非空条目，按换行拼接最长 16384 个 UTF-16 单元；拒绝危险控制字符和孤立代理项，保留制表符及原条目内部换行。恢复 JSON 最多 262144 个 UTF-16 单元。这些是工作台恢复格式限制，不缩减已有 SDK/CLI/MCP 的 Gateway 接口。旧内嵌 context_pack、memory_ref 等额外正文不属于此恢复格式，不自动丢字段后重放。

重载或导入统一显示结果待确认，取消保存确认，不自动查询或重试。仅手动查询返回匹配 recorded 或有效保存响应，才能显示历史检查点 ID/revision。浏览器丢失 Server Action 响应、网络故障、408、5xx、请求键复用冲突或无效响应保留未知结果；以后包失效、拒绝、缺回执或会话已关闭均不能清除。未知时笔记/包 ID/版本/键锁定，用户可查原回执，或再次确认并按原请求重试。恢复成功不证明笔记已审核或包仍有效。

保存、查询回执和原地读取当前会话状态均使用原身份前置条件。server-api 先核对当前登录项目，再发送 x-expected-actor-id/x-expected-client-id，网关与已验证声明比对；不能在新身份或范围下误用原键。身份来自 sessions 的可信 session_identity；只读用户可保留/导出/导入恢复信息，实际写入和回执查询仍要求当前 session.write。

Refresh current session state 复用独立单会话读取，只更新表单的当前状态、版本和权限，不替换原请求，也不刷新列表或统计。会话关闭/权限消失后仍显示原请求及当前页未发送笔记供复制，未发送编辑只在内存中。已知失败可在确认可编辑后修改草稿或明确采用当前版本，新请求换键并取消确认。保存成功后 Write another checkpoint 必须先成功读取当前会话、确认仍活动且版本不低于原版本；随后明确清除已确认请求的恢复槽、使用当前版本和新键。查询结果未知时此入口不可用。

此增补仅修改源码与文档，无新增迁移，不编译、类型检查、测试、启动服务或浏览器验证。存储限额、权限变化、响应丢失、导入保真和关闭会话恢复等场景均待运行证据。

## 续接来源与子会话回执

新子会话保存不可变 `resume_origin = { handoff_id, checkpoint_id, require_claimed }`，其中 require_claimed 为该次实际采用的领取要求。工作台客户端统一强制 true；其他客户端未提供时为 false，非布尔输入拒绝。此信息由续接服务从交接和检查点生成，不允许普通 session.start 正文自报。

会话创建的幂等键仍绑定 tenant/workspace/project/actor/client；重放现在同时核对父会话和上述三个来源字段。另一个交接或不同领取要求不能复用键取得原子会话。父会话相同但旧记录缺少来源时返回 `SESSION_RESUME_LEGACY_UNVERIFIED`（409），不推测绑定或创建第二个会话；普通会话创建也不能把已绑定的续接键当作普通父子关系重放。

025 迁移新增可空 JSONB 来源列及结构约束，仅写文件、未执行，不为历史行补造数据。数据库读取/写入和重启恢复保留来源；即使未绑定上下文包，持久续接也在同一事务内领取交接并创建子会话。事务失败不将未提交子会话发布到长期缓存；离线内存路径没有持久回执查询能力。

新增只读 `POST /v1/sessions/{session_id}/resume/receipt`，路径 ID 为原父会话。正文 `{ request_key, handoff_id, require_claimed? }` 使用原键和原交接，要求有效客户端、session.write，按当前身份/范围读原会话创建记录，不执行领取、续接或包读取，不经过 HTTP 成功结果缓存。

| status | 含义 |
| --- | --- |
| recorded | 父会话、交接和有效领取要求匹配；返回原子会话 ID、检查点 ID、require_claimed，以及固定 context_pack_state: not-checked |
| not-observed | 当前未查到同身份原键，不能推断请求失败或允许换键 |
| legacy-unverified | 同键父会话匹配，但旧记录无交接来源；不披露其为已确认续接，不自动迁移 |

另一个父会话、交接或领取要求使用原键时返回 IDEMPOTENCY_KEY_REUSED。该查询不要求原包仍有效或原交接仍可领取，只证明历史创建结果；不表示子会话仍运行，也不返回旧笔记或包正文。历史无来源记录仍需核对会话历史，不能用查询补认。

SDK `getResumeReceipt`、CLI `resume receipt` 和 MCP `get_resume_receipt` 已接入。工作台“Check previous resume result”使用固定原键，recorded 才显示原子会话入口；未知结果后登录失败、包失效或未查到记录不解除未知状态，不刷新丢失状态。普通续接响应还核对父子关系、交接、检查点和来源字段，再显示成功。会话详情显示已记录的交接入口和检查点编号。

## 工作台续接原请求恢复

2026-11-02 客户端增补：共享 resume-clients 绑定原 scope/actor/client、父会话、handoff_id、有效 require_claimed 和 request_key。SDK resumeSession/getResumeReceipt 新增可选 expectedIdentity、expectedCheckpointId；缺省身份只能来自完整固定构造器。CLI/MCP 的 resume/回执入口要求 expected_identity，可传 expected_checkpoint_id，两个字段在适配层剥离，预期检查点只约束结果。普通客户端 require_claimed 默认 false，工作台客户端必须保留原有效 true；MCP/嵌入 CLI 拒绝不一致的值而不静默改写。续接不接受 expected_version/If-Match，查询清除继承写条件，不自动重试或保存恢复文件。

普通响应核对 session/checkpoint/handoff 的 scope 与父子关系、原身份、原 resume_origin 和可选预期检查点；交接须由当前客户端领取，require_claimed=true 时还必须记录当前账号。子会话可已经关闭或版本推进，不能要求重试时仍 version=1/running；记录 trace 可以是原提交 trace。来源封套等于三个记录来源的连接，允许不同记录之间的重复来源。checkpoint 的六类笔记、引用和来源单独解析。checked 包必须匹配检查点的包 ID/哈希，包结构、条目范围、来源、去重和预算估计经共享 context-pack-response 解析；该客户端解析不重算内容哈希、不重做授权、不用本地时钟宣称实时新鲜。其余分支严格区分 legacy-unverified/none，不接受意外包正文。

最小历史回执拒绝额外字段、同父子 ID、错误交接/领取要求或预期检查点；not-observed/legacy-unverified 始终不能证明失败。工作台 server-api 携带原身份和原 checkpointId 作响应约束，仍沿用下述固定键及恢复格式。完整响应先校验再投影最小历史成功结果，SESSION_RECEIPT_INVALID 保留未知状态。无新增迁移，016–044 未执行；本轮仅源码与文档，未编译、类型检查、测试、网络请求、服务运行或发布。

2026-11-02 / ADR-015：续接改用独立 resume-model、resume-actions 和 resume-form。Handoffs 查询补入只有已验证客户端才获得的 session_identity 和 session_permissions；工作台校验身份范围、trace 和权限提示。表单按身份、父会话、交接和检查点固定；写入和回执查询携带原身份前置条件，当前项目或账号变化不能用另一身份重发原请求。

恢复格式为 `{schema_version:1,operation:'session.resume',request:{identity,parentSessionId,handoffId,checkpointId,key,requireClaimed:true}}`，最多 32768 个 UTF-16 单元。key 必须严格等于 `workbench-resume-{handoffId}`，保留旧工作台使用的固定键，无换键/重新创建入口。checkpointId 只绑定预期成功结果，不加入 HTTP 业务命令；正文仍为 `{handoff_id,require_claimed:true}`。

发送前保存并读回同标签页 sessionStorage，槽绑定身份、父会话和交接。保存失败不发送写入，损坏或不匹配内容不能覆盖，可重读存储；只读回执仍可用当前页内的固定原请求查询。重载/导入只恢复请求并按未知显示，取消确认，不自动查回执或重试，不保存成功标记、确认、笔记或包正文。导出含账号及请求标识，无凭证；关闭标签页或清除浏览器数据前需自行导出。

原交接仍可读取时，即使领取状态或写权限变化，详情内的恢复入口继续显示；未发新写入也能用固定键查询历史续接。服务端仍检查当前访问权限，回执要求 session.write，不通过界面恢复扩大授权。初次续接只在当前领取提示允许时开放，已有未知原请求可在有写权限并重新确认后重试。2026-11-03 增补 `/handoffs/recover`：当前详情失败时，仍可通过可信调用者元数据加载本标签页精确原槽或导入原文本，无须读取交接详情；这不豁免原命令/回执的服务端访问检查。加载固定原父会话、交接、检查点、键和 requireClaimed=true，初始未知且不自动发送，不允许从当前状态补造请求；详见 [独立交接恢复](session-command-context-runtime.md#领取与续接独立恢复增补2026-11-03)。仅源码，未编译、测试或运行。

网络故障、408、5xx、键冲突、历史来源未验证、无效响应或浏览器丢失操作响应保持未知；已有未知结果不会因包失效、认证失败或拒绝而解除。未查到及 legacy-unverified 一律不能证明失败。仅匹配父会话、交接、原检查点及 require_claimed=true，且子会话不同于父会话的 recorded 回执可显示成功。普通响应另核对父子关系及 resume_origin；后续行动最多 200 项、按换行拼接最多 16384 个 UTF-16 单元。成功回执固定 not-checked；普通响应的包检查提示仅属于该次响应，重载后不保留为当前有效依据。

操作结果不刷新整页。确认成功后保留原请求和子会话链接，重载仍需重新查服务端回执。此轮续接仅源码与文档，无新迁移，不编译、类型检查、测试、启动服务或发布。领取和创建随后获得各自独立恢复格式及 042/043 持久回执，见 [交接领取恢复](handoff-claim-runtime.md) 与 [创建交接恢复](handoff-create-runtime.md)；这些迁移均未执行。

## 客户端

- SDK `createCheckpoint` 支持包 ID 与旧内嵌对象的互斥类型并检查 ID；续接结果暴露绑定和校验状态，旧网关缺少状态应视为未验证。
- CLI `checkpoint` JSON 可携带包 ID；MCP `record_checkpoint` Schema 声明对应字段，服务端按绑定执行额外授权。
- 工作台提供可选包 ID 和新标签页上下文入口。未知保存结果锁定笔记、包 ID、版本与请求键；后续权限或失效错误不解除未知状态，不刷新丢弃草稿。回执的 ID、版本、会话、绑定及哈希格式通过后才显示成功。
- 检查点历史显示包入口或旧引用未验证提示，不把历史读取当作新鲜度检查；续接成功显示检查状态和包链接。

2026-11-02 目录增补：MCP resources/list 可发现已有检查点和交接的会话，分别返回 checkpoint/handoff 地址，并按会话 ID 去重。工作台与 MCP 读取会话、检查点、交接时重新过滤父项目；保存包消费也在事务内复查父项目并持共享锁。历史笔记可读不表示其绑定包当前有效，领取/续接仍走原授权和包检查。036 目录索引仅写文件，未编译、类型检查、测试或执行迁移。

自动重新绑定、后台过期通知、历史包迁移及运行验证仍待后续开发。
