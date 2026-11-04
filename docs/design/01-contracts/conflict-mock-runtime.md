# 同步冲突生命周期内存 Mock

更新：2026-11-04。仅源码和文档、人工审阅；未编译、类型检查、测试、执行 Mock/SDK/API/数据库或发布。R-001、R-006 与全路由兼容证据仍未完成。

## 开启与路由

本增量接在 [同步上传 Mock](sync-upload-mock-runtime.md) 的同一个 MockSyncStore 中。seed 必须已有 upload_sources，session 必须已有 upload_access，再显式提供 `conflict_access: {read:boolean,resolve:boolean}`。该类型以 MockSyncConflictAccess 从 SDK 导出，未知字段或非布尔值拒绝。无上传场景返回 MOCK_ROUTE_NOT_FOUND，缺少冲突权限配置返回 DENIED。配置来源与分类可见性沿用 upload_access，不能通过请求头取得权限。

| SDK 方法 | 路由 | 模拟权限 |
| --- | --- | --- |
| listConflicts | GET /v1/conflicts | conflict_access.read |
| getConflict | GET /v1/conflicts/{id} | conflict_access.read |
| getConflictCommandContext | GET /v1/conflicts/commands/context | conflict_access.resolve |
| submitConflictDecision / resolveConflict | POST /v1/conflicts/{id}/resolve | conflict_access.resolve |
| getConflictReceipt | POST /v1/conflicts/receipt | conflict_access.resolve |

冲突权限独立于 read_sync/write_sync。所有入口要求未过期模拟身份，范围头与已提供的 actor/client 前置头必须匹配；身份入口不检查项目，其他入口要求项目可读，否则目录返回 NOT_FOUND，详情/解决/回执返回 CONFLICT_NOT_FOUND。详情、解决和回执还检查关联来源 available/visible_sources 以及来源与冲突的 restricted 分类；不可见不降级为 not-observed。没有真实认证或 Policy 执行。

## 从上传创建冲突

仅本 store 接收 FieldChangeProposed 并产生 VERSION_CONFLICT 时创建记录。记录、原上传账本、批次回执、客户端序号和 ConflictDetected 流事件在完整候选/响应校验后同步提交；任一普通校验、容量、取消或到期错误不写部分批次。

初始记录为 open/version='1'/decision_state=none，保留来源实体、字段、原 base/local/server 版本、双方完整 JSON 值、上传者、原 trace 和来源引用。JSON null 保存为字符串 "null"，与没有保存值的 null 状态区分。上传产生的值均为 recorded；决策值初始为 not-recorded。种子 changes 中的 ConflictDetected 不推断成记录，也不从缺失正文构造双方值。

新增冲突必须能完整表示为既有 2 MiB 详情封套，不能截断来源值；这属于 Mock 的容量限制，不表示真实数据库不会保留更大记录。全部模拟冲突最多10000条，记录及完整原决定/事件累计16 MiB编码预算，独立于上传账本和共享流预算。无自动清理或持久恢复。

## 目录与详情

目录复用 query/status/entity_type/conflict_id/limit/cursor 六项共享查询，默认25最多100条，未知或重复参数拒绝。元数据按 conflict_id 的 Unicode scalar 顺序升序，先按来源/分类可见性及筛选过滤；query 对冲突ID、实体类型/ID、字段、当前记录actor/trace做既有ASCII折叠子串匹配，不搜索双方正文。目录省略所有值及完整来源，详情通过独立 get 读取。

续页使用既有 encodeConflictRegistryCursor 格式，SHA-256绑定当前store命名空间、完整读取身份、conflict_access、完整upload_access和规范筛选/limit；cursor本身不参与摘要。修改账号、权限、可见来源配置（含数组顺序）、筛选或store须重新从首屏读取。更换同一身份/权限的有效期不改变绑定。游标不是授权签名，也不是事务快照；页间解决状态改变可能影响后续筛选。计算摘要可能异步等待，实际有界目录观察在摘要完成后进行，返回前再核对取消/到期。

目录返回共享 ConflictRegistryEnvelope、原分页字段与 conflict_permissions.resolve 提示。为满足既有 wire 契约，source_refs 使用 `{type:'postgres',id:'wcp_conflicts'}` 的逻辑来源标识；这是模拟响应，不代表访问 PostgreSQL。详情使用 conflict 来源，完整复用 ConflictReadEnvelope：版本为十进制字符串、值为JSON文本，保留 decision_state、resolved_at/by_client/event_id。不存在或隐藏记录统一 CONFLICT_NOT_FOUND。

## 显式解决与原请求

提交要求原 Idempotency-Key、If-Match 和完整有效 resolution。merge 必须且只能有 merged_value；local/server 使用已保存的对应原值。路由ID与正文conflict_id、If-Match与正文expected_version若同时出现必须相同；兼容 resolveConflict 的精简正文时，用有效路由ID与头版本形成完整命令。其他原命令字段保留并参与比较，显式身份/from_client字段必须匹配模拟会话。

未解决记录的 expected_version 必须等于当前version；不匹配返回 VERSION_CONFLICT，不补新版本。成功只把冲突改成resolved、version+1，保存原请求、决策值、解决者/client、原时间/trace，并向共享流追加一条完整 ConflictResolved；不修改来源实体字段或版本，不撤销原ConflictDetected，也不把原上传回执的accepted=false改成true。同步上传回执与冲突决定回执保持独立。

原请求比较按完整身份、原键和有效命令进行，规范JSON忽略对象键顺序但保留数组顺序和额外字段；沿用真实 commandReceipt 规则，命令内已匹配的 idempotency_key 不参与指纹。同一冲突同键同文重放原事件/游标/决定，外层使用本次trace，历史event.trace_id保持。已解决记录换身份或换键返回 CONFLICT_ALREADY_RESOLVED，同身份同键改命令返回 IDEMPOTENCY_KEY_REUSED。此绑定是每个冲突的原决定，不提供跨冲突的全局键唯一约束。

完整写响应通过共享 parseConflictSubmissionResponse 与 canonical event 校验。新 submitConflictDecision 仍返回 unconfirmed，并要求之后显式查询原回执；Mock没有绕过这一客户端边界。旧 resolveConflict 保留原完整写封套。重放不追加事件、不增加当前流高水位，也不改变已确认游标。

## 原决定回执与同流可见性

查询正文严格为原 `{identity,request_key,command}`，禁止外层写条件。原身份必须等于配置的可信模拟身份，并且仍有解决权限。记录open或已由另一原键/身份解决时返回not-observed；本次没有匹配回执不能证明从未发送或允许换键重发。同键异文拒绝，不返回另一请求的结果。找不到冲突或来源不可见返回CONFLICT_NOT_FOUND。

匹配时返回recorded，保留原version/resolution/event_id/server_cursor、原actor/client、recorded_at/original_trace_id，source_application固定not-checked；外层trace使用本次查询，回显调用方完整原请求。查询不改变状态，不生成事件，也不代表来源字段已应用。

ConflictResolved 与上传事件共用流容量、游标和已有下载/确认入口。include_own_uploads=true 的原上传者可发现自己冲突的后续解决事件，仍受来源/分类约束；其他账号（包括解决者）可在新连接的 visible_event_ids 显式选择已生成事件，再通过相同权限检查。该开关不自动暴露其他上传者的历史。流读取依赖read_sync及upload_access，不由conflict_access自动授予；不自动确认或应用历史事件。

## 保存边界与限制

详情、目录、回执和完整解决响应各受共享2 MiB上限；提交/原请求按既有1,000,000字节与JSON复杂度限制，身份16 KiB，响应再取调用方更小max_response_bytes。请求路径最多4096字符，不接受fragment；除目录外不接受查询参数。只允许解决入口携带幂等键/If-Match，其他版本/缓存/范围/编码条件拒绝。

解决候选先检查完整详情、原请求响应、canonical事件、共享流身份/排序/10000条和16 MiB上限、冲突账本16 MiB预算，再检查完整输出与取消/到期，最后在无异步让出的同步步骤中更新记录和流。一般可报告失败不会保留部分决定；进程崩溃、内存耗尽与真实网络提交未知不在模拟保证内。所有返回值分离复制，外部修改不会更新store。

## 接线与未完成范围

以下为未执行的示例；沿用上传契约的scope/source/session配置，并先从原上传回执或目录取得冲突ID、审阅详情。

```ts
const server = new MockWcpServer({
  sync: { store, session: { ...session, conflict_access: { read: true, resolve: true } } },
});
const client = new WcpClient(server, { ...seed.scope, trace_id: 'trace_conflict_mock' });
const page = await client.listConflicts({ status: 'open', limit: 25 });
const detail = await client.getConflict(conflictId);
const authority = await client.getConflictCommandContext();
// original须由调用方先准备和保存，不能由详情自动替换旧版本或旧请求键。
await client.submitConflictDecision(original, { reviewed: true });
const receipt = await client.getConflictReceipt(original);
```

动态来源更新、旧外部冲突/旧决定种子导入、持久化、真实认证/Policy/审计、网络未知与其余公开路由仍缺。源码不证明SDK/客户端运行兼容；分页绑定、可见性、原值保留、版本/键冲突、原回执、同流历史和失败不部分写入等运行证据待获准后补充。
