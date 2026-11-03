# 会话开始的持久回执与恢复

更新：2026-11-02。仅开发源码与文档，未编译、类型检查、测试、启动服务、执行迁移或发布。016–044 迁移均未执行。

## 普通开始与重试

`POST /v1/sessions`（session.start）要求已验证 actor/client、session.write 和稳定请求键。正文可为空对象，也可携带 parent_session_id、actor_id、client_id；父会话必须为同项目有效 ULID，自报 actor/client 必须与已认证身份一致。未知字段、resume_origin、版本条件和头部/正文键冲突均拒绝。原可选字段是否提供及其原值参与指纹，恢复时不得补造或删掉这些字段。

SessionService.startSessionWithReceiptAsync 使用独立的持久路径，不从旧开始内存映射推断成功。PostgresSessionStore.startSessionWithReceipt 在事务中共享锁定未删除、分类有效且当前可见的项目；按 tenant/workspace/project/actor/client/原键取得事务锁，若有父会话则核对范围并共享锁定。原身份摘要键存在时比较参数指纹、最小历史回执和当前会话，返回原回执和当前会话；不存在时创建 running/version=1 会话，并在同一事务保存回执。

044_session_start_receipts.sql 新增 wcp_session_start_commands，保存 scope、actor/client/原键的 SHA-256 摘要、原参数指纹、会话 ID 和最小回执 JSON。只有会话记录和回执一起提交才返回成功；数据库或表不可用返回 SESSION_RECEIPT_STORAGE_UNAVAILABLE，不降级为内存成功。该迁移只有文件，未执行。

现有 wcp_sessions 的 scope/actor/client/原键唯一约束保留。旧记录缺少新开始回执时返回 SESSION_START_LEGACY_UNVERIFIED（409），不补造历史、不将续接误认成普通开始、不另外创建会话。并发旧路径抢先占用唯一键时同样保留未知。历史键需要核对原记录，不能凭未查到回执而换键重提。

旧 startSession/startSessionAsync 继续用于内部流程，续接保持自己的 resume_origin 和专门回执。普通 HTTP 开始的原键重试重新进入持久处理器；只读查询绕过成功缓存。服务缓存只发布校验通过的当前会话，不能把原 version=1 回执覆盖到已经推进的会话。

普通成功响应保留当前 Session 字段，并增加 start_receipt：

```json
{
  "status": "recorded",
  "session_id": "01JAAAAAAAAAAAAAAAAAAAAAAA",
  "actor_id": "original-account",
  "client_id": "original-client",
  "started_at": "2026-11-02T00:00:00.000Z",
  "session_version": 1
}
```

原请求若含 parent_session_id，回执必须包含同一父会话，且创建会话不能等于父会话。started_at 是原创建时间，session_version 恒为 1；回执不证明会话当前仍在运行。当前会话必须同范围、同账号/客户端、同父会话、同开始时间、无 resume_origin；当前 version=1 必须仍为 running。更高版本可为运行、暂停或终态，终态结束时间不可早于开始时间。数据库时间先规范化为 UTC ISO 毫秒格式再比较，保留来源和当前版本。

## 只读查询

`POST /v1/sessions/start/receipt`（session.start.receipt）正文：

```json
{
  "request_key": "original-start-key",
  "session": {}
}
```

session 必须完整保留原开始正文的业务字段；原开始若显式提供 actor_id/client_id/parent_session_id，查询也需原样提供。查询不接收新的写入键或版本条件。要求原已认证身份、session.write 和当前项目可见性；有原父会话时同样核对父会话范围。单条 SQL 快照读取项目、父会话、回执及当前会话，核对摘要、指纹、原始键与当前历史一致性。

已观察到的结果为上面的最小 recorded 回执。未观察到的结果只有 `{ "status": "not-observed" }`，不能证明请求失败，原请求可能仍在提交或早于专门回执。不同参数占用原键返回 IDEMPOTENCY_KEY_REUSED，矛盾或损坏历史返回 SESSION_RECEIPT_INVALID；项目/父会话不可见时拒绝，存储缺失返回 503。查询不会创建或结束会话、推进版本、续接交接，也不会补写回执。响应保留本次 trace_id，source_refs 为空且没有 ETag。

共享 session-start 契约同时校验原身份/范围、原可选字段和回执，普通响应还校验当前会话、内外层来源与可选 ETag。仅存在 session_id 的旧成功响应不能作为新的恢复成功证据。

## 工作台

Sessions 页新增独立开始/恢复面板，按已确认 identity（tenant/workspace/project/actor/client）固定组件和 sessionStorage 槽，与当前会话选择和筛选无关。无写权限或会话列表为空时仍保留恢复入口；整个注册表页面依然需要目录可读取。2026-11-03 补入 `/sessions/recover`，只读可信身份后即可明确加载同一开始槽或导入原文本，无须知道新会话 ID、读取目录或父会话详情。保留原 session 可选字段与键，不虚构版本，匹配原回执后才提供新会话详情入口。不是离线鉴权旁路；查询/重试仍按原身份重新授权。详见 [会话与活动独立恢复](session-request-recovery-runtime.md)，仅源码，未编译、测试或运行。

新的草稿正文为 `{}`。发送前固定 identity、session 原业务正文和 key，保存后读回一致才发送；存储失败不发写入。原请求不可因响应丢失、相似会话、当前终态、后续拒绝、原键冲突或 not-observed 而自动换键。损坏的槽或不同原请求不能被导入/提交覆盖；已有内存请求仍可明确查询只读回执，服务端重新鉴权。

同标签页重载和显式导入都恢复为未知、撤销确认，不自动查询或提交。导出格式为 `{schema_version:1,operation:'session.start',request:{identity,session,key}}`，最多 32768 个 UTF-16 单元；不存凭证、确认或成功标记。只接收相同原账号/客户端/项目，完整保留原可选父会话和身份字段。关闭标签页前需导出并自行保存。

只有匹配 recorded 回执才显示确认成功。成功后提供新标签页读取当前会话，原页面不自动重定向或刷新；“Prepare another session”仅在成功且有写权限时核对旧槽、把旧请求保留在导出区、清除当前槽并生成新草稿键，不自动发送。Web 请求附原账号/客户端前置条件，响应本次 trace 与 start_receipt 都须匹配；已有未知状态不会被后续明确拒绝解除。

## SDK、CLI 和 MCP

2026-11-02：三个入口已在源码中接入 parseSessionStartBinding / parseSessionStartEnvelope，与 Web 共用原身份、原字段和成功判定。普通开始必须返回匹配 start_receipt；解析后只暴露已知字段。历史回执与当前会话的不可变字段、当前状态/版本、内外层来源、可选 ETag 和本次 trace 都须一致。只读查询要求空来源和无 ETag，不把原 session_version=1 当作当前版本。

SDK：`startSession(session, {idempotency_key}, expectedIdentity?)` 保留原可选 parent_session_id/actor_id/client_id。`getSessionStartReceipt({request_key,session}, expectedIdentity?)` 只读查询。expectedIdentity 包含 tenant/workspace/project/actor/client；省略时只可使用构造实例时固定的完整身份，缺字段或与显式身份冲突时发送前拒绝。显式身份可携带 opaque actor，构造上下文仍遵守既有 ULID actor 契约；不需在构造上下文补造该字段。开始选项只允许 idempotency_key，构造上下文含 expected_version/if_match 时也拒绝开始；查询不继承键或版本条件。两者发送 x-expected-actor-id/x-expected-client-id。WcpSession 增加可选 start_receipt；startSession 的返回类型要求有效回执。SDK 不自动保存、换键或重试，调用方负责发送前保存完整原请求。

CLI：`sessions start` 的 JSON 要求 expected_identity，并可包含原 parent_session_id/actor_id/client_id；请求键可用 --key、正文 idempotency_key 或嵌入调用的原上下文，出现多个时必须一致。新增 `sessions start-receipt`，JSON 为 `{expected_identity,request_key,session}`；session 是原开始的完整业务正文，查询禁止 --key/idempotency_key 和未知字段。网络调用使用身份前置条件核对令牌；嵌入 runWorkctx 核对可信 authenticated_client=true 及原身份，开始拒绝继承版本，查询清理继承的写入键/版本。网络入口支持 --json/--json-file，嵌入入口只使用 --json；重复命令选项拒绝。两个入口共享适配和成功解析，不修改调用方原请求文件、不自动重提。

MCP：start_session 要求原 expected_identity 和 idempotency_key，可保留原 parent_session_id/actor_id/client_id；get_session_start_receipt 要求 expected_identity、request_key、session。两个工具仅向已验证客户端展示，并沿用 session.write 策略；输入身份只作为与可信 context 比较的前置条件。开始可由外层 Idempotency-Key 补充缺失参数键，同时出现则必须一致，拒绝版本条件；查询拒绝显式写入参数并清理继承的键/版本。查询标记 readOnlyHint=true、destructiveHint=false，仍通过正常路由、鉴权和只读存储查询。响应异常返回工具错误 GATEWAY_RESPONSE_INVALID；合法 not-observed 是成功查询，但不能证明开始失败。

CLI 的最小原开始文件示例（所有标识须替换为准备请求时确认的实际身份，示例未执行）：

```json
{
  "expected_identity": {
    "tenant_id": "01JAAAAAAAAAAAAAAAAAAAAAAA",
    "workspace_id": "01JBBBBBBBBBBBBBBBBBBBBBBB",
    "project_id": "01JCCCCCCCCCCCCCCCCCCCCCCC",
    "actor_id": "original-account",
    "client_id": "original-client"
  },
  "idempotency_key": "original-start-key"
}
```

发送前保留这份文件；查询文件保留同一个 expected_identity，将原 idempotency_key 改放在 request_key，session 为 `{}`。若原文件带 parent_session_id/actor_id/client_id，必须在查询的 session 内原样保留，而不能直接把整个 CLI 文件当作 session。原身份、键和参数不从现有会话反推。相同原则适用于 SDK/MCP。

## 运行证据

SDK、CLI、MCP 的专用开始/回执适配已接入源码，跨入口一致性、身份切换、未验证客户端、畸形响应和原可选字段恢复仍缺运行证据。本次客户端扩展无新增迁移，没有新增或运行测试。

待获得用户运行授权后再收集事务并发、跨实例重试、旧键碰撞、提交后断连、项目权限变更、时间格式、浏览器存储故障及重载/导入证据。迁移 044 及先前未执行的迁移仍未执行，本文件不是可运行或发布的验收证明。
