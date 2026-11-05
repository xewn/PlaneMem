# 交接创建的持久回执与恢复

2026-11-05 P0-01 机器契约增补：[handoff-commands OpenAPI](../../../packages/contracts/openapi/handoff-commands.json) 和 [handoff-create Schema](../../../packages/contracts/schemas/handoff-create.json) 完整描述创建/原回执两 POST；本组另含领取两路，OpenAPI 累计 82 路。创建保持原字段及键、拒绝版本，响应含当前交接与固定版本 1 历史回执；创建查询仍检查当前完整交接、原明文键和可见父关系，旧无账号回执只作 not-observed，不补认。

来源扩展在原 HTTP 保留、SDK 规范为四字段后比较，最多 200 项且允许重复；当前 expired 可保留旧单客户端归属，claimed 则需账号/客户端齐全。内置 HTTP 无 ETag，客户端可选兼容 ETag 对应当前版本。四路沿通用认证前 1 MiB JSON-object/通用 SDK JSON，无专用响应字节或整次期限；createHandoff 拒绝构造版本但未比较构造键，详见 [HTTP/SDK 边界](../../../packages/contracts/openapi/README.md#交接创建领取与原回执)。不改运行实现；P0-01/R001 未完成、evidence 为空，仅人工源码文档审阅/指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

更新：2026-11-02。仅开发源码与文档，未编译、类型检查、测试、启动服务、执行迁移或发布；016–043 迁移保持未执行。

## 创建与重试

`POST /v1/sessions/{session_id}/handoff` 现在要求已验证 actor/client、session.write 和稳定请求键。正文包含 checkpoint_id，可选 target_client；兼容提供与路径一致的 session_id，以及与已验证客户端一致的 from_client。未知字段、无效 ULID、头部/正文键冲突、无关 expected_version/If-Match 均拒绝。发送者来自已验证声明，不允许自报另一客户端。目标字符串不在服务端规范化，重试必须保留原值与可选字段是否提供。

ContinuationService 新增 createHandoffWithReceiptAsync；PostgresSessionStore 新增 createHandoffWithReceipt。请求摘要按 actor/client/原键生成，在 tenant/workspace/project 中唯一；参数指纹保留原创建参数，统一路由 session_id，去除传输用 idempotency_key。此路径每次访问持久历史，不复用旧内存创建键映射；HTTP 原键重试也重新执行处理器，不直接返回缓存成功正文。

事务先共享锁定可见、未删除且分类有效的父项目，再按项目/client/原键取得事务锁，核对同范围检查点及父会话并共享锁定。相同账号/客户端/键已有回执时，严格核对指纹、会话、检查点、目标和持久记录，返回历史回执与当前交接，不创建第二条。当前 version=1 必须仍为 open 且未领取；更高版本可以是 claimed 或 expired，检查点、发送者和目标不得与创建历史矛盾。领取归属属于后续操作，不必等于创建者；历史创建回执不代表上下文仍可用。

新创建的 open/version=1 交接与最小成功回执在同一事务写入，失败回滚。043_handoff_create_receipts.sql 新增 wcp_handoff_create_commands，保存摘要键、参数指纹、会话/检查点/交接标识和回执 JSON；只写迁移文件、未执行。缺少数据库、事务能力或表时返回 SESSION_RECEIPT_STORAGE_UNAVAILABLE，不降级内存成功。

旧 wcp_session_handoffs 的 client/原键唯一约束保留。没有当前账号回执但已有相同 client/原键的记录时返回 HANDOFF_CREATE_LEGACY_UNVERIFIED，不给旧记录补造账号归属，也不另建交接。并发旧调用在唯一约束处抢先写入时同样拒绝补认。不同账号共用同一 client/原键也不能接管原记录。旧内部 createHandoff/createHandoffAsync 方法仍保留，但 Gateway 创建改用持久回执路径；旧键恢复需人工核对，不通过改键猜测重提。

普通创建响应保留当前 Handoff 字段，并增加 create_receipt：

```json
{
  "status": "recorded",
  "handoff_id": "01JAAAAAAAAAAAAAAAAAAAAAAA",
  "session_id": "01JBBBBBBBBBBBBBBBBBBBBBBB",
  "checkpoint_id": "01JCCCCCCCCCCCCCCCCCCCCCCC",
  "from_client": "original-client",
  "created_by_actor": "original-account",
  "handoff_version": 1
}
```

若原命令指定 target_client，回执包含相同 target_client。handoff_version 始终为创建时的 1，不是当前交接版本。回执不含笔记、上下文包正文或凭证。服务缓存仅在提交返回并校验后发布当前交接，不把历史 version=1 覆盖回当前状态。

## 只读查询

`POST /v1/sessions/{session_id}/handoff/receipt` 正文示例：

```json
{
  "request_key": "original-create-key",
  "handoff": {
    "checkpoint_id": "01JCCCCCCCCCCCCCCCCCCCCCCC",
    "target_client": "original-recipient"
  }
}
```

handoff 保留原请求实际提供的 target_client/from_client，可携带一致的 session_id；不接收新的写入键或 If-Match。查询同样要求已验证身份和 session.write，按原身份摘要、原参数指纹读取。父项目/会话/检查点不可见时拒绝；缺表返回 503。查询不创建交接、不领取、不续接、不推进会话或交接版本、不消费上下文包，且绕过 HTTP 成功缓存。

recorded 返回原最小创建回执；not-observed 只返回 status、session_id、checkpoint_id，表示目前未观察到原成功记录，不能证明失败。旧调用未保存回执、正在提交等情况仍可能存在。当前列表里相同检查点/目标的交接不是原请求成功证据。请求键属于不同参数时返回 IDEMPOTENCY_KEY_REUSED；损坏或矛盾历史为 SESSION_RECEIPT_INVALID。查询响应 source_refs 为空、trace 为本次请求，无 ETag。

## 工作台

创建使用独立 create-model/create-form 和 server action，forms.tsx 保留组件导出。原请求为 identity（tenant/workspace/project/actor/client）、sessionId、checkpointId、可选 target、key。只有首次整理草稿时处理目标空白；保存、恢复和重试不再次改写原目标。表单改动撤销确认，不生成新键；发送前固定全部字段并保存到同标签页 sessionStorage，再读回核对。存储不可用或原槽损坏时不发写入，可保留内存原请求作只读查询。

每个身份/项目只有一个未解决创建槽，切换检查点、进入另一个创建链接不替换原请求。重载或导入按未知处理、撤销确认，不自动查回执或重提。格式为 `{schema_version:1,operation:'handoff.create',request:{...}}`，限 32768 个 UTF-16 单元；只保存原请求，无成功标记、确认状态、凭证或笔记。导入必须属于相同原账号/客户端/项目，不能覆盖不同或损坏原请求；原检查点不在当前列表也能导入和查询，服务端重新判断可见性。

身份前置条件通过 x-expected-actor-id/x-expected-client-id 交给网关核对令牌。响应校验本次 trace、历史创建身份、父会话/检查点、目标、当前交接与历史的关系，以及内外层来源一致性。只有匹配 recorded 回执才显示成功；缺少 create_receipt 的旧响应不算成功证据。网络故障、响应丢失、408、5xx、键冲突或旧归属未验证保留未知；已有未知不因后续认证失败、拒绝或 not-observed 解除。

创建页面在写权限消失、原检查点不在列表或列表为空时保留恢复入口。成功后提供新标签页读取当前交接，不刷新原页、不自动领取/续接。显式“Prepare another handoff”仅在已确认成功且有写权限时准备新键，先核对原存储槽，将已确认原请求保留在导出区，再移除当前槽；不会自动提交新草稿。

### 按指定检查点准备交接

2026-11-02 源码增量：工作台新增 `/handoffs/create?session=...&checkpoint=...` 独立准备页，严格接收两个 ULID，拒绝重复或额外查询参数。会话最新检查点、历史修订、保存成功结果及检查点详情提供新标签页入口。读取当前会话取得已验证身份和权限提示，再携带该身份前置条件读取指定历史检查点；不依赖全量检查点、交接、冲突、上下文或审计列表。现有列表创建页仍保留；此前全量检查点列表没有分页截断，本增量解决定向准备对无关列表的依赖。

准备页只使用已校验的会话/检查点绑定构建选项，不从 URL 自报字段建立可写选项、不回退到其他检查点。打开页面不创建交接、不领取或续接；确认、原请求保存与读回、回执查询及明确重试继续复用原创建表单和服务端动作。读取检查点失败但当前会话身份仍可取得时显示错误，同时保留空选项的原请求恢复表单；会话不可读取时显示错误并提供通用创建/恢复页入口，不伪造身份。

原标签页中的未解决创建请求优先于新链接所选检查点，恢复格式、原键和参数保持不变。表单提供随当前选择或原请求变化的“查看检查点”链接，恢复后固定到原会话/检查点；新的准备页所展示目标不替代恢复中的目标。历史详情和当前会话读取不确认原创建结果，也不证明包当前有效。无新迁移，仅源码与文档，未编译、类型检查、测试、运行服务或发布。

### 列表读取失败时的恢复入口

2026-11-02 源码增量：交接页独立处理队列、正式汇总、审计预览和检查点选项读取。检查点请求及选项解析失败显示局部错误，但在队列提供可信身份时仍挂载空选项的创建恢复表单；不得将失败解释为没有检查点，也不从 URL 构造可提交的新选项。选项解析要求唯一检查点 ID、有效父会话 ID、正安全整数修订号及可选字符串摘要；兼容数据库返回的十进制整数串，摘要展示限 240 字符。任何异常拒绝整份选项，不静默跳过损坏行。

正常页和队列主查询失败页均提供按 handoff ID 读取详情、按 session/checkpoint ID 进入定向准备页的原生 GET 表单，严格输入 ULID 并在新标签页打开。该入口不依赖列表结果，目标页重新读取并验证身份和可见性；打开不自动创建、领取、续接或查询原回执。新标签页是否包含原 sessionStorage 由浏览器行为决定，不承诺跨标签页恢复；原请求仍可显式导出后在同身份页面导入。

原恢复槽、固定身份/参数/键、显式回执查询和未知结果规则保持不变。无新 API、事务或迁移，仅源码和文档，未编译、类型检查、测试、运行或发布。

## SDK、CLI 和 MCP

2026-11-02：共享 parseHandoffCreateBinding 固定原范围/账号/客户端、父会话、检查点、原目标和键；可选 from_client 必须与原客户端一致，session_id 必须与路径一致。parseHandoffCreateEnvelope 核对本次 trace、历史回执和当前交接，规范化来源再比较内外层，校验可选 ETag 与当前版本。普通成功必须包含 create_receipt；只读结果要求空来源、无 ETag。Web 也复用同一解析器，避免四个入口对成功采用不同规则。

SDK：`createHandoff(sessionId, handoff, {idempotency_key}, expectedIdentity?)` 保留原业务参数并发送原身份前置条件，不发送版本条件；创建选项只允许 idempotency_key，固定上下文带 expected_version/if_match 时拒绝创建。`getHandoffCreateReceipt(sessionId, {request_key,handoff}, expectedIdentity?)` 只读查询。省略原身份参数时只可使用构造实例时固定的完整 tenant/workspace/project/actor/client；缺失或与显式原身份冲突则发送前拒绝。opaque actor 可以在不配置构造 actor 的情况下显式提供。WcpHandoff 增加可选 create_receipt，createHandoff 返回类型要求有效创建回执。调用方负责在发送前持久保留原请求和身份，SDK 不自动保存或重试。

CLI：原 `handoff` 现在要求 JSON 中的 expected_identity、session_id、checkpoint_id 和原 target_client/from_client（若有），创建键可用 --key 或 idempotency_key，两者出现须一致。新增 `handoff receipt`，JSON 包含 session_id、expected_identity、request_key、handoff；禁止 --key/idempotency_key，handoff 保留原业务字段。网络调用和嵌入 runWorkctx 共用原请求适配和完整返回解析；前者支持 --json-file/--json，以身份前置条件头核对令牌，后者只支持 --json，并核对 trusted authenticated_client=true/actor/client。重复参数拒绝；嵌入查询移除外层继承的键/版本，创建遇到版本前置条件则拒绝。

MCP：create_handoff 要求 session_id、checkpoint_id、原 expected_identity、idempotency_key，可保留原 target_client/from_client；get_handoff_create_receipt 要求 session_id、原 expected_identity、request_key、handoff。两个工具都仅向已验证客户端展示，要求 session.write；查询标记只读，显式写入选项拒绝，继承的外层写入键/版本清除。适配后仍通过正常 API 路由、策略与持久事务，结构错误的 HTTP 成功响应返回工具错误。

三个入口均不从当前类似交接推断原创建成功，不在 not-observed、旧回执缺失、账号变化或错误后换键、改目标、重新创建、领取或续接。查询的 recorded 仅证明原创建，当前领取者可能已不同；继续操作应读取当前交接。旧 Web 恢复格式保持不变。

## 运行证据

SDK、CLI、MCP 的创建回执与原身份适配已接入源码，跨入口一致性尚无运行证据。旧 Web 未保存的创建请求无法从列表反推原键。事务并发、跨实例、提交后断连、权限变化、存储失败、浏览器重载和恢复均未运行验证，迁移 043 未执行；此次客户端扩展无新增迁移。

## 独立创建恢复入口增补（2026-11-03）

新增 `/handoffs/recover`，通过只读 session.command-context 取得当前可信身份及权限提示，不要求队列、原会话或检查点详情读取成功。沿用原 sessionStorage 槽位和导入/导出格式，recoveryOnly 不生成新键或轮换旧请求，重载只恢复未知状态，不自动查询或写入。入口审计/鉴权仍必须可用，回执/重试继续原授权。见 [独立恢复身份](session-command-context-runtime.md)，仅源码，未编译、测试或运行。
