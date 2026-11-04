# SDK 审计查询与导出 Mock

2026-11-05 源码增量，关联 ADR-015、T0.5、R-007。新增 `MockAuditStore`、`MockAuditSeed`、`MockAuditSession`，通过 `MockWcpServer({ audit: { store, session } })` 或直接 `store.connect(session)` 接入现有 `WcpClient.listAuditRecords`。只开发源码文档并人工审阅，未编译、类型检查、测试、执行 SDK/Mock/API/数据库或发布。

## 数据集与模拟会话

种子为 `{ scope: { tenant_id, workspace_id, project_id }, records: WorkbenchAuditRecord[] }`，固定一个项目、最多 1000 条，完整有限 JSON 最多 16 MiB；空数组明确表示空数据集。构造时同步复制并沿共享 JSON 深度、节点和属性限制，拒绝未知顶层/范围/记录字段、缺字段及重复审计 ID。记录使用既有完整审计投影解析器，时间接受有效 UTC 三位毫秒或六位微秒并规范为六位。数据集没有更新、删除、追加或后台活动。

`details_state` 和 `source_refs_state` 必须显式提供。available 保留完整有界内容，too-large 分别保留 null、空数组占位及超过字段上限的原字节数，不把它们解释为原内容为空。`details_bytes`、`source_refs_bytes` 沿共享规则校验并原样保留，不以 JavaScript 重新序列化大小替代原数据库 JSON 文本大小。元数据、详情、来源及整条记录边界沿[审计查询契约](workbench-audit-runtime.md)。

会话必须完整提供 identity、expires_at、project_readable、read_audit、read_restricted、visible_audit_ids；连接时同步复制。identity 包含 tenant/workspace/project/actor/client，项目范围必须与种子一致；三项权限都是显式布尔值。可见 ID 最多 1000 个且必须属于种子、不能重复，空集合表示无可见记录。到期使用有效 UTC 三位或六位小数；可配置已经到期的会话以模拟拒绝，读时按本机时钟判断。

每次读取检查模拟到期、项目可读和审计读取权限。范围头必须匹配固定身份，可选 expected actor/client 头只作相等约束；Authorization、历史记录作者、记录来源和其他请求头不授予权限。restricted 记录同时要求 read_restricted；所有返回记录必须在显式可见 ID 集合内。修改外部种子、会话或返回对象不会修改内部数据集。

## 查询与分页

仅接受精确 `POST /v1/workbench/query`，正文 `operation: 'audit'`；可选 resource、trace_id、action、audit_id、session_id、cursor 沿共享严格解析。五项条件全部精确相交，query.trace_id 是历史记录筛选，与本次请求 trace 独立。audit_id 必须是 ULID，不能与 cursor 同时提供；未找到或不可见均返回空页，不提供独立 get 方法或不存在证明。

可见性、restricted 和全部条件先于取页；顺序为 occurred_at 六位微秒 UTC 倒序，再按 audit_id 倒序。每页最多 200 条，读取第 201 个匹配项决定 has_more；只有有续页时才返回 next_cursor，位置严格等于本页最后一条。没有自定义 limit、自动翻页、补取超大正文或部分成功。

游标沿共享规范 Base64URL `[1,key,time,id]`，SHA-256 key 使用独立 Mock 命名空间，绑定 store 实例、项目、完整身份、到期、三项权限、排序后的可见 ID 和全部五项精确条件。trace 不参与绑定，允许新请求追踪号；可见 ID 仅重排不改变绑定。跨 store、身份、续期、权限、可见集合或筛选变化均拒绝旧游标，须显式从首屏开始。摘要不是签名或授权凭据，修改位置不能绕过每次权限和筛选；Mock 与生产游标不能互换。

## 路由、输出与等待边界

MockWcpServer 在 work_items 的 workbench 兜底前识别 audit，识别只看自有 operation 数据属性，不求值该属性的访问器；专用处理器再严格检查方法、完整路径和正文。配置 audit 不替代其他 Mock 数据集，未配置时沿原路由行为。

外层 trace 使用 x-trace-id 或备用 traceparent；记录中的原 trace 和 source_refs 保留。共享审计协议固定外层来源为 `{ type: 'postgres', id: 'wcp_audit_records' }`，Mock 为兼容完整解析保留该字面量。**这是模拟协议投影，不证明真实 PostgreSQL 读取、真实认证或持久审计。** 不可只凭来源字段将 Mock 结果计入运行证据。

请求头及正文各限 16 KiB，大小写重复头和非法头值拒绝；拒绝幂等键、版本条件、条件缓存、Range、内容编码和传输长度头。响应支持默认 JSON、json 或 bounded-json；bounded-json 必须给出正安全整数 max_response_bytes。完整结果最多 16 MiB，调用方更小限额同样生效；超限整页失败，不截断条数、缩短字段或返回部分 JSON。结果复制后再经共享 scope/trace/筛选/顺序/游标/字段完整解析，字节上限不代表总进程内存上限。

头部捕获后创建固定 30 秒本地预算，覆盖输入解析、游标摘要、筛选与完整输出处理；直接 transport 或 SDK 均可传取消信号，SDK 自身较短预算先到先停止，较长预算不延长 Mock 上限。同步解析不保证中途可打断，完成后仍检查期限。每 store 共用两个活动名额；取消或超时停止外层等待，底层 SHA-256 未结束时继续占位，直到其结束才释放。错误使用固定消息、请求 trace 和 retryable=false，不回显底层异常；没有自动重试。

## 接线示例

以下是未执行的开发示例，不是测试结果：

```ts
import { validateRequestContext } from '@planemem/contracts';
import { MockAuditStore, MockWcpServer, WcpClient } from '@planemem/sdk';

const identity = {
  tenant_id: '01J000000000000000000000001',
  workspace_id: '01J000000000000000000000002',
  project_id: '01J000000000000000000000003',
  actor_id: '01J000000000000000000000004',
  client_id: 'editor',
};
const auditId = '01J000000000000000000000005';
const store = new MockAuditStore({
  scope: {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  },
  records: [{
    audit_id: auditId,
    actor_id: identity.actor_id,
    client_id: identity.client_id,
    session_id: null,
    action: 'context.read',
    resource: 'context/example',
    result: 'allowed',
    classification: 'internal',
    details: null,
    details_state: 'available',
    details_bytes: 4,
    trace_id: 'trace_fixture_original',
    source_refs: [],
    source_refs_state: 'available',
    source_refs_bytes: 2,
    occurred_at: '2026-11-05T00:00:00.000001Z',
  }],
});
const transport = new MockWcpServer({
  audit: {
    store,
    session: {
      identity,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      project_readable: true,
      read_audit: true,
      read_restricted: false,
      visible_audit_ids: [auditId],
    },
  },
});
const client = new WcpClient(transport, validateRequestContext({
  ...identity,
  trace_id: 'trace_mock_audit_read',
}));
const exact = await client.listAuditRecords({ audit_id: auditId });
const first = await client.listAuditRecords({ action: 'context.read' });
if (first.has_more) {
  const next = await client.listAuditRecords({
    action: 'context.read',
    cursor: first.next_cursor,
  });
}
```

本例只有一条记录，不会实际进入续页分支；多页场景需调用方明确提供超过 200 条可见匹配记录。该读取示例没有开启导出权限；导出增量见下节。无查询种子追加、真实 HTTP 服务器、凭据校验、数据库或迁移；真实服务兼容、持久审计与运行证据仍待补充，R-007 保持未完成。

## 已审阅视图导出（2026-11-05源码增量）

既有 audit 配置新增精确 `POST /v1/audit/export`，接入 `WcpClient.exportAuditView(reviewedDocument, options)`，无需另建 transport 或改变共享协议。session 可选 `export_access: { export_data, export_restricted, policy_allowed }`，三个字段均为显式布尔值，未知字段拒绝；连接时复制，外部后续修改无效。省略此配置拒绝导出，原查询不变；导出配置不参与查询游标键，因为它不改变列表读取权限。

项目可读、read_audit 和有效会话仍必需。即使 public 也要求 export_data 或 export_restricted 至少一个为 true，policy_allowed 必须为 true；internal/confidential 同样要求任一导出能力，restricted 还必须有 read_restricted 和 export_restricted。不存在或当前不可见的原审计记录统一返回 NOT_FOUND；没有配置、无导出能力或策略拒绝返回 DENIED。policy_allowed 是开发者提供的模拟决定，不调用 Policy/OPA，也不认证来源或审阅行为。

正文只接受 `{ scope, audit_id, sha256 }`，完整有限 JSON 最多 4 KiB。方法、路径、头、原项目和已给出的账号/客户端相等条件继续严格核对，正文 scope 不同返回 DENIED；URL 查询/片段、写键、缓存/范围/编码头拒绝。输入在摘要 await 前复制，后续替换原请求对象不会改变在途选择。SDK 根据调用方已审阅 document 计算选择，Mock 不接受上传正文覆盖种子。

先精确读取可见记录并检查导出分类，再用共享 `auditExportDocumentJson` 生成完整规范视图，沿 96 KiB、深度 64、节点 10000 等规则。Web Crypto 重新计算 SHA-256，必须等于已审阅选择；随后重读固定种子、重新检查会话/可见性/导出决定，并比较完整规范文本。摘要或视图不一致返回 AUDIT_EXPORT_CONFLICT，不自动替换已审阅内容。too-large 详情/来源继续保留占位和原字节数，不补取省略原文；普通查询可读而规范化过于复杂的记录允许导出失败。

成功返回共享完整导出封套，包括原 document、规范 document_bytes/document_sha256、独立 release_audit_id、原审计和放行两个 source_refs、release-recorded 与 client_delivery_state=not-confirmed。默认 JSON/json/bounded-json 规则沿查询；完整封套最多 128 KiB，并遵守调用方更小限额。字段与规范内容、响应复制、完整解析、释放 ID 冲突、元数据容量及取消/到期都在模拟记录提交前检查。超限、权限、摘要或提交前取消失败不新增放行记录，不交付部分内容。

导出独立占用每 store 两个名额，第三笔返回 AUDIT_EXPORT_BUSY，不消耗查询名额。头部捕获后固定 75 秒本地期限，覆盖输入/摘要/完整响应处理；SDK 90 秒默认期限不会延长 Mock 上限。取消/超时停止外层等待，底层摘要真正结束才释放导出名额，不返回迟到结果。同步校验只能在结束后检查期限。模拟提交与返回之间没有 await；提交后外层等待仍可能失败，已保存记录不回滚。Mock 错误若已经获知放行 ID 则保留该 ID；SDK 自身先停止等待时可能只得到 unconfirmed，不能据此推断没有模拟记录或重新发送。

每次成功准备保存一个 `MockAuditExportRelease`，含 schema_version、simulation:true、独立 audit_id、完整 identity、原 selection、classification、document_bytes、details_state/source_refs_state、请求 trace、当前 occurred_at 及 client_delivery_state=not-confirmed。不再复制审计正文，也不插入查询种子或改变原查询分页。不同请求包括相同选择的再次成功准备都生成独立记录，没有幂等缓存。最多 1000 条、累计 16 MiB 编码元数据，每条最多 16 KiB；容量不足或 ID 碰撞返回 AUDIT_PERSISTENCE_UNAVAILABLE，已有记录保留。

持有 store 的开发者可调用 `getExportRelease(auditId)` 取得独立完整副本；非法 ULID 拒绝，合法未知 ID 返回 undefined。此方法属于可信配置端，无公开 WCP 路由、不自动授予普通客户端审计读取，也不确认客户端通过 SDK 校验、接收或保存。**本 Mock 的 release-recorded 仅表示上述内存模拟记录存在，不代表生产要求的持久放行审计。** 它也不模拟生产审计分类脱敏或故障恢复，不应把这份开发元数据当作数据库审计内容。

以下示例复用前文的 store、identity、auditId；仅是未执行的使用说明，调用前须由使用者审阅返回记录和省略状态：

```ts
import { auditExportDocument } from '@planemem/contracts';

const exportClient = new WcpClient(new MockWcpServer({
  audit: {
    store,
    session: {
      identity,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      project_readable: true,
      read_audit: true,
      read_restricted: false,
      visible_audit_ids: [auditId],
      export_access: {
        export_data: true,
        export_restricted: false,
        policy_allowed: true,
      },
    },
  },
}), validateRequestContext({ ...identity, trace_id: 'trace_mock_audit_export' }));
const page = await exportClient.listAuditRecords({ audit_id: auditId });
const selected = page.data[0];
if (!selected) throw new Error('No visible audit record');
const reviewedDocument = auditExportDocument(page.scope, selected);
// 使用者先审阅 reviewedDocument，再显式准备；此调用只返回内存封套。
const prepared = await exportClient.exportAuditView(reviewedDocument);
const simulatedRelease = store.getExportRelease(prepared.data.release_audit_id);
```

没有自动保存、拒绝审计、finished/交付观察、真实认证/Policy/数据库/HTTP 或动态记录/权限变更，未运行上述代码。读取与导出均只有源码和文档，完整 WCP Mock 与运行兼容证据仍未完成。
