# 交接领取的持久回执与恢复

更新：2026-11-02。只开发源码与文档；未编译、类型检查、测试、启动服务、执行迁移或发布。

## 带键领取

`POST /v1/handoffs/{handoff_id}/claim` 携带稳定请求键时进入持久领取路径。需要已验证 actor/client，以及 session.write 或 handoff.claim 授权；管理员仍遵守项目分类过滤。原正文为 `{expected_version,client_id?}`，路径 handoff_id 必须为 ULID；嵌入路由调用可提供同名路径字段。client_id 如有，必须与已验证客户端一致；未知字段拒绝，头部/正文请求键和版本不一致拒绝。只在 If-Match 中给版本时，回执查询仍须补入原 expected_version。

ContinuationService 新增 claimHandoffWithReceiptAsync，PostgresSessionStore 新增原子适配器方法。请求键按 actor/client/原键生成摘要，再在 tenant/workspace/project 内唯一；指纹保存完整原领取参数，删除传输用 idempotency_key 并统一有效 expected_version。不能在另一个交接或修改参数后复用同键。

事务先检查并共享锁定未删除、分类有效且当前可读的父项目，再取得范围/身份请求键锁和交接行锁。交接必须连到同范围检查点及父会话。已有回执先核对指纹和历史绑定，返回回执及当前交接，不再次领取或推进版本。当前记录不能低于回执版本，同版本必须仍为 claimed；检查点、父会话和领取身份必须与历史一致。更高版本只允许 claimed 或保留该归属的 expired 当前记录，矛盾或损坏返回 SESSION_RECEIPT_INVALID。

没有原回执时严格检查原版本。open 交接只有目标客户端可领取，写入可信 actor/client 并推进版本 1。同账号及客户端已经领取且当前版本匹配时可以保存本次 changed=false 回执；它只证明本次确认未改变归属，不证明早先哪个请求进行了领取。旧 claimed 记录没有 actor 时返回 HANDOFF_CLAIM_LEGACY_UNVERIFIED，不能补认属于当前账号。归属冲突、过期和版本冲突沿用原错误，不写成功回执。

领取更新与最小成功回执写入同一事务，失败回滚；服务缓存只在提交返回后发布当前交接，不把历史回执重新写成当前状态。普通响应保留 Handoff 字段并增加 claim_receipt。回执记录 handoff_id、session_id、checkpoint_id、expected_version、历史 handoff_version、claimed_by/claimed_by_actor、changed；changed=true 时历史版本为原版本加 1，否则等于原版本。该回执没有检查点笔记、来源正文、包内容，也不代表上下文仍有效。

042_handoff_claim_receipts.sql 新增 wcp_handoff_claim_commands，仅写文件、未执行。缺少数据库、事务能力或回执表时持久路径返回 SESSION_RECEIPT_STORAGE_UNAVAILABLE，不降级成内存成功。旧无键调用及续接内部领取保留原路径，不新增持久命令回执，不能用当前归属补造历史请求归属。历史带键请求在升级前未保存回执时也不能补认。

## 只读查询

`POST /v1/handoffs/{handoff_id}/claim/receipt` 正文为：

```json
{
  "request_key": "original-claim-key",
  "claim": { "expected_version": 1 }
}
```

claim 应保留原请求中实际提供的 client_id，允许提供一致的 handoff_id；不接收当前版本或自报 actor。查询要求已验证客户端，沿用领取授权（session.write 或 handoff.claim），按原身份摘要和参数指纹查历史记录。查询不调用领取、不推进版本、不重新检查包、不经过 HTTP 成功缓存；父项目/交接不可读时为 HANDOFF_NOT_FOUND，缺库/缺表为 503。

- recorded：严格匹配原交接、参数、身份和父会话/检查点，返回最小历史回执；不证明当前交接仍可续接。
- not-observed：当前未观察到该请求的持久成功记录。可能仍在提交，或属于未记录回执的旧调用；当前 claimed 状态不能将它转换为成功，也不能证明失败。
- IDEMPOTENCY_KEY_REUSED：原身份同键绑定了不同交接或参数。不得换键猜测重试。

带键领取的 HTTP 重试重新走持久处理，不直接复用旧成功正文，避免跳过当前可见性检查。只读查询返回空 source_refs 和本次 trace_id；领取依旧经过现有策略/审计入口。此增补不把请求审计改写成与业务同事务的成功审计。

## 工作台恢复

领取使用独立 claim-model、claim-actions、claim-form。Handoffs 的可信 session_identity 固定账号/客户端/项目；写入和回执使用原身份前置条件，页面提示权限不代替服务端鉴权。界面提交前保存并读回同标签页 sessionStorage，失败不发送写入。槽绑定身份、父会话和交接，模型另核对不可变检查点；版本不会随当前列表变化而替换。

恢复格式为 `{schema_version:1,operation:'handoff.claim',request:{identity,sessionId,handoffId,checkpointId,version,key}}`，最大 32768 个 UTF-16 单元；固定键为 `claim-{handoffId}-v{version}`，沿用旧工作台规则。导入严格校验账号、项目、父会话、交接及检查点，不能覆盖不同或损坏原请求。只保存原请求，无凭证、笔记、成功标记或勾选确认；关闭标签页前需导出文本。

重载或导入撤销确认并显示未知，不自动查询或重试。只读查询无需确认；显式重试使用原版本和原键。响应丢失、网络故障、408、5xx、键冲突、旧归属未验证或无效成功响应保留未知；此后拒绝、权限变化、版本冲突或未查到不会解除。当前归属及列表状态不能证明某次请求已成功。

领取已不再限定在 open 状态挂载表单；只要交接仍可读取，关闭/权限变化后仍有导入、导出和原回执入口。保存失败时仍可使用内存原请求做只读查询，不覆盖损坏存储。成功后保留历史回执，提供新标签页读取当前交接的链接；不刷新原页、不自动续接。未保存的旧领取请求需要用户自行保留其原版本和键，当前页无法从 claimed 版本反推原请求。

2026-11-03 独立恢复增补：`/handoffs/recover` 使用可信调用者元数据，不要求当前交接详情成功。用户明确按原会话/交接 ID 读取本标签页精确保存槽，或导入 32768 字符内的既有原文本；原身份、版本和键通过校验后固定，恢复为未知。只加载本地内容，不扫描存储、不自动查询或提交；原表单保存读回、确认重试、存储冲突保护及显式回执查询继续复用。详情成功和失败视图均提供同标签页入口。完整边界见 [独立交接恢复](session-command-context-runtime.md#领取与续接独立恢复增补2026-11-03)；仅源码，无新 API/迁移，未编译、测试或运行。

## SDK、CLI 和 MCP

2026-11-02：三个入口共用 parseHandoffClaimBinding 和 parseHandoffClaimEnvelope。expected_identity 含原 tenant_id、workspace_id、project_id、actor_id、client_id，必须与当前配置范围一致；它是原请求前置条件，不是令牌，也不能建立身份。HTTP 发送 x-expected-actor-id/x-expected-client-id，由网关对比已验证声明；MCP 和嵌入 CLI 则直接与可信 context 比较，发送业务请求时去除客户端恢复字段。

SDK：`claimHandoff(handoffId, {idempotency_key,expected_version}, expectedIdentity?)` 现在校验完整持久领取响应。`getHandoffClaimReceipt(handoffId, {request_key,claim}, expectedIdentity?)` 只读查询。省略第三参数时仅使用构造 SDK 实例时固定的完整 scope/actor/client；没有完整身份则在发请求前拒绝。显式原身份与已配置身份或范围不同也拒绝。不要在结果未知时以新账号重建原请求；保留原身份、版本和键。普通领取响应必须含有效 claim_receipt，不把旧网关缺失回执当作成功证据。

CLI：`workctx handoff claim --json-file claim.json --key claim-001` 的 JSON 包含 handoff_id、expected_version 和 expected_identity，可保留原 client_id；`workctx handoff claim-receipt --json-file claim-receipt.json` 包含 handoff_id、request_key、claim（原 expected_version 及原可选字段）、expected_identity。回执查询拒绝 --key 或 idempotency_key。网络和嵌入 runWorkctx 两种路径共用适配器及返回解析；嵌入调用只接收 --json，并核对可信 authenticated_client/actor/client，移除继承的新写入键及版本。查询只用原 claim 中的版本，不采用当前交接版本。

MCP：accept_handoff 现在要求 expected_identity、handoff_id、原 expected_version 和 idempotency_key；get_handoff_claim_receipt 要求 expected_identity、handoff_id、request_key、claim。两个工具仅为已验证客户端展示，沿用 session.write 或 handoff.claim 权限；查询标为只读，不接受写入选项，不因外层 context 中存在键而变成写入。适配后仍通过正常 API 路由/策略与持久事务。MCP 成功结果也经过共享解析，不直接把结构错误的 HTTP 200 转成工具成功。

共享响应解析核对本次 trace、原交接、身份、版本关系、检查点、当前归属及来源。当前版本不能低于回执版本，同版本必须为 claimed；更高版本的 expired 只作为仍保留原归属的当前记录。回执查询要求空 source_refs，不接受 ETag 或伪装成当前详情。普通响应来源须包含同一检查点并与外层一致；可选 ETag 须等于当前版本。无效响应返回 GATEWAY_RESPONSE_INVALID，保留原请求查回执；not-observed 原样返回，三个入口均不自动换键、提高版本、重提、领取或续接。

本次只修改客户端/共享解析和文档，不改变 042 业务事务或执行迁移；缺少持久回执的旧成功响应仍需人工核对，不以当前 claimed 状态替代。

## 尚待补齐

SDK/CLI/MCP 专门领取回执入口已接入源码，跨入口身份/参数一致性仍缺运行证据。创建交接随后补入独立原请求恢复和 043 持久创建回执，见 [创建交接恢复](handoff-create-runtime.md)。事务并发、提交后断连、旧记录、权限变化、浏览器恢复等均缺运行验证证据；016–043 迁移继续保持未执行。
