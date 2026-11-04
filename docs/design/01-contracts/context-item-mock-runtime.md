# 上下文当前与归档详情 Mock（源码阶段）

2026-11-04目录增量：原种子可选directory和各条目directory_record，详情/同版历史共有保存字段与完整目录投影核对，时间以可表达毫秒精度比对而目录保留微秒。目录启用时覆盖全部条目，与原四类读取共享两容量/30秒；缺详情仍不可用，不从目录补造。原review_access保持，新增directory_access只提供目录显示提示。配置、显式文本搜索与路由共存见[上下文目录Mock](context-directory-mock-runtime.md)，仅源码文档，未编译、测试、执行或发布。

2026-11-04扩展既有MockContextHistoryStore、MockContextHistorySeed和MockContextHistorySession，沿MockWcpServer的context_history配置支持GET /v1/context-items/{item_id}与GET /v1/context-items/{item_id}/archived。SDK的getContextItem/getArchivedContextItem使用原有完整读取入口；历史列表、版本、比较和逐页读取仍使用同一数据集。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/Mock/API/产品/数据库或发布。

## 可选完整详情

每个seed.items条目可增加current_detail: ContextItemReadEnvelope，必须提供完整schema_version/trace_id/source_refs/revision/etag/data。current_archived=false时data为完整ContextItemReadDocument，true时为完整ArchivedContextItemDocument；必须与同条目的item_id、current_version、current_classification和seed.scope一致。未知字段、不完整正文/来源、损坏诊断/确认、错误JSON内ETag或归档状态均拒绝。

共享parseContextItemReadEnvelope在构造和每次返回时校验完整2 MiB封套。当前详情必须显式给出confirm_allowed、confirmation（允许旧confirmed记录为null）、sources_current和source_check；可选source_checks/confirmation_readiness按共享规则核对。归档详情必须含archived_at且status=excluded，不接受当前诊断和确认字段。观察时间是调用者提供的固定数据，不替换为当前时钟，也不访问来源目标。

若revisions含current_version，还比较完整保存条目与archived_at：正文对象键顺序不影响比较，数组顺序、重复来源、正文空白、记录trace和时间必须一致；当前诊断和可确认提示不属于历史快照。已记录历史确认时，当前详情确认的原版本、账号、客户端、理由、时间及事件也必须一致。历史未记录确认不证明不存在，不据此补造或删除当前确认。保存摘要仍只在指定版本读取时核对，不因详情读取而重写或认证历史摘要。

旧种子可省略current_detail，历史读取行为保持；可以提供详情但revisions为空或缺少当前版本。详情缺失、请求视图与current_archived不符、条目不可见或restricted权限不足均返回CONTEXT_ITEM_NOT_FOUND，不能使用最新历史或另一视图替代。归档条目的历史仍可读取。整个种子仍限16 MiB、1000条目和总1000份历史；详情计入同一字节预算，不另设无限存储。

## 模拟会话与确认提示

原identity、expires_at、project_readable、read_context、read_restricted、visible_item_ids要求保持。连接时复制会话与显式可见集合；请求项目头必须匹配完整原身份，可选预期账号/客户端头各自相等。请求头和原详情作者不授予权限，模拟会话也不代表真实认证。

新增可选review_access: MockContextReviewAccess，包含两个必填布尔字段human与review_context，只有都为true才视为模拟人工审核者；省略时无审核能力，提供不完整/未知字段时拒绝配置。review_access不替代read_context、项目可见性、到期或restricted权限。

当前详情给非模拟审核者时移除confirmation_readiness并设置confirm_allowed=false。模拟审核者可以看到种子原有就绪信息；confirm_allowed必须原本为true且原就绪有效期为null或尚未到期，才保留true。原false不升级、不生成缺失就绪、不更改来源诊断、不提供确认写操作。给定观察中的sources_current即使为true，也只是原checked_at时的模拟观察，不证明读取时来源仍有效；confirm_allowed同样不是未来写入授权或有效期保留。

## 请求、响应和期限

详情只接受无正文GET，完整路径最多4 KiB。item段使用encodeURIComponent的规范编码并只解码一次，拒绝空ID、点路径、非规范编码、查询参数、片段、额外路径及写方法。历史/版本路径规则保持，Mock路由分类器增加两详情路径；未配置context_history时不改变原MockWcpServer路由。

复用16 KiB普通JSON头捕获、大小写重复头检测、trace验证和写/缓存/Range条件拒绝。支持缺省json或显式bounded-json，后者必须提供正安全整数max_response_bytes。完整成功限2 MiB或调用者提供的更小限额，超限整份失败。输出外层trace使用本次请求，保存data.trace_id、正文、来源序列、版本/ETag、归档时间、原确认和诊断时间保持；仅按上节规则限制确认提示。返回独立完整副本，修改种子、会话或先前响应不改变store。

详情、归档、历史、版本四类请求共用每store两笔容量及每次30秒本地预算；显式signal和SDK更短timeout_ms可停止等待。会话权限/到期、预算与取消在工作前后核对，迟到结果不交付；历史摘要仍等待底层digest结束才释放名额。同步解析不能被抢占，Mock不提供真实HTTP状态/ETag响应头、网络交付、数据库取消或持久审计。错误沿原有限代码与固定提示、原trace和retryable=false，不自动重试或保存。

## 未执行的接线示例

current和archived须由调用者提供完整合法封套，分别为当前和归档视图，使用两个不同本地ID，范围均匹配identity。以下仅展示接线，没有生成、运行或验证示例数据；空revisions明确表示没有提供历史，不能据此判断真实历史不存在。

```ts
import { MockContextHistoryStore, MockWcpServer, WcpClient } from '@planemem/sdk';
import { validateRequestContext, type ContextItemReadEnvelope, type SyncCommandIdentity } from '@planemem/contracts';

declare const identity: SyncCommandIdentity;
declare const current: ContextItemReadEnvelope;
declare const archived: ContextItemReadEnvelope;
declare const sessionExpiresAt: string;

const store = new MockContextHistoryStore({
  scope: {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  },
  items: [current, archived].map((detail) => ({
    item_id: detail.data.id,
    current_version: detail.revision,
    current_archived: 'archived_at' in detail.data,
    current_classification: detail.data.classification,
    current_detail: detail,
    revisions: [],
  })),
});
const transport = new MockWcpServer({
  context_history: { store, session: {
    identity, expires_at: sessionExpiresAt,
    project_readable: true, read_context: true, read_restricted: false,
    visible_item_ids: [current.data.id, archived.data.id],
    // Omit review_access for a reader without simulated review authority.
  } },
});
const client = new WcpClient(transport, validateRequestContext({
  ...identity, trace_id: 'trace_mock_context_detail_example',
}));
const activeDetail = await client.getContextItem(current.data.id);
const archivedDetail = await client.getArchivedContextItem(archived.data.id);
```

本增量不模拟创建、编辑、确认、归档/恢复、目录或ContextPack，也不提供MCP外层协议。真实数据兼容、旧Mock使用方、同版一致性、模拟权限/就绪、大小/编码、取消/期限/共享容量尚无运行证据；R-003保持未完成，evidence为空。
