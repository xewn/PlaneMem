# 上下文历史 Mock（源码阶段）

2026-11-04详情扩展：同一store条目可选提供current_detail完整当前/归档封套，原context_history配置增加两个详情GET，四种读取共用身份/可见集合及容量。构造时核对current_detail与当前元数据和已有同版历史保存内容；没有详情不从历史推导，历史摘要验证方式保持。session可选review_access模拟human/review_context，仅影响详情中的确认就绪提示。完整约定、缺省兼容和未执行示例见[上下文详情Mock](context-item-mock-runtime.md)，仅源码，未运行。

2026-11-04后续SDK增量：contextHistoryPages支持按next逐页读取，完整身份/条目/页大小固定，每页沿本Mock的同一history GET与权限/大小/期限。迭代器不预取或自行持久化，max_pages限制到达后由调用者显式续读；Mock不新增路由或跨页快照承诺，见[SDK历史按需分页](context-item-runtime.md#2026-11-04-sdk历史按需分页增量)。仅源码接线说明，未执行迭代器或Mock。

2026-11-04新增SDK MockContextHistoryStore、MockContextHistorySeed、MockContextHistorySession和可选MockWcpServer({context_history:{store,session}})。实现既有GET /v1/context-items/{item_id}/history与GET /v1/context-items/{item_id}/versions/{version}，接入listContextItemHistory/getContextItemVersion；compareContextItemVersions沿两次指定读取得到原本地比较对象，不增加比较路由。仅源码文档人工审阅和格式/文本检查，未编译、类型检查、测试、执行SDK/Mock/API/数据库或发布。

## 固定数据集

种子结构为{scope:{tenant_id,workspace_id,project_id},items:[{item_id,current_version,current_archived,current_classification,revisions:[完整ContextItemRevision...]}]}。范围为完整ULID；最多1000条目、总1000份历史版本、完整种子16 MiB，每份版本2 MiB，并受共享JSON节点/深度限制。复制数据后拒绝额外字段、重复条目/版本、不同范围/条目、未来版本和损坏历史结构。版本必须正安全整数；每份复用parseContextRevision，保留原正文、来源、记录trace、时间、操作、作者、摘要与历史确认，不从当前状态补造。

独立当前状态用于模拟生产读取时的当前可见性；如果已记录当前版本，其分类/归档标志必须与当前状态一致。允许空历史和版本缺口，不要求当前版本已被记录；缺失的历史不能替换成最近版本或按编号补齐。构造函数只校验完整结构与摘要格式，指定版本读取时才核对保存的snapshot_hash。错误摘要不被重算后覆盖；历史目录可列出格式正确但尚未核对正文的摘要，与单版本完整性检查含义不同。

数据集是不可变的开发输入，不提供写入、归档/恢复、确认或后台同步。构造后修改外部种子或读取结果不会改变内部历史。历史中的作者和事件只是原记录字段，不授予本次调用权限，也不证明真实服务器曾保存过这些数据。

## 模拟身份与可见性

connect(session)或MockWcpServer配置需要显式{identity,expires_at,project_readable,read_context,read_restricted,visible_item_ids}。完整identity项目范围必须匹配store，actor为ULID、client为合法本地标识；三个权限均为显式布尔值。expires_at使用有效YYYY-MM-DDTHH:mm:ss.sssZ（3位毫秒、年份0001–9999），可以配置已过期时间模拟拒绝。可见ID最多1000、不重复且必须属于种子；空数组代表全部不可见。会话复制后固定，不受调用者后续修改影响。

每次请求项目头必须匹配配置身份；可选expected actor/client头逐项相等。请求头不能授予权限，Authorization不作为真实凭据使用。项目不可读、read_context=false或已到期返回DENIED。条目不在可见集合、当前分类restricted而缺少read_restricted，以及单独请求的历史版本不存在或受限，均返回CONTEXT_ITEM_NOT_FOUND。

历史列表先检查当前条目可见性，再按历史分类过滤，最后应用before_version和页大小；版本倒序，默认25最多100条，额外读取一项判断下一页。data.next_before_version是本页最后可见版本，续页需显式保留item_id和limit；不是签名游标、身份凭据或一致性快照令牌。归档当前条目仍可读取历史，前提是其他权限满足。

## 请求和完整响应

历史读取使用上述两个GET路径，无正文；新增当前/归档详情路径见详情Mock契约。完整路径/查询最多4 KiB；item段须为encodeURIComponent的规范编码，排除空标识和点路径。history查询只允许一次before_version/limit，使用无前导零的正十进制整数；version路径为相同正安全整数规则且不接受查询参数。拒绝未知/重复字段、非法编码、片段、其他方法与写路径。SDK构造的路径符合此约定。

头部纯JSON最多16 KiB，大小写重复头拒绝；trace取x-trace-id或备用traceparent且须为本地标识。写键/版本条件、缓存条件、Range、If-Range与content-encoding拒绝。默认json和显式bounded-json均支持，后者必须给出正安全整数max_response_bytes；响应受目录256 KiB或版本2 MiB与调用方更小上限共同约束，不截断或静默少返回记录。

完整封套用共享parseContextHistoryReadEnvelope再次复制/校验：schema_version/本次trace、条目/版本/范围、分页、来源及历史确认均须匹配。目录外层source_refs固定为原context-item引用；单版增加指定revision和原item.source_refs，遵守生产契约，不增加伪造Mock审计或来源标记。是否模拟由使用的store/transport配置决定，业务封套本身不认证生产来源。

指定版本在返回前对共享contextRevisionSnapshotJson的{item,archived_at}规范JSON计算WebCrypto SHA-256，缺少或异常能力返回CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE，摘要不符返回CONTEXT_HISTORY_HASH_MISMATCH。SDK仍独立检查所收到的完整版本；两次摘要各有边界，Mock自查不是SDK校验的替代。历史目录只核对保存摘要格式，不读取全部版本正文进行摘要计算。

## 期限与容量

头部捕获后创建固定30秒本地等待预算，覆盖查询、权限、筛选、摘要和输出复制；直接transport支持signal，SDK原有timeout_ms/signal可更早停止读取或整次比较。每store最多两笔在途请求，跨连接会话共享；版本摘要直接等待底层digest结束，外层取消/超时后名额仍保留到实际结束。迟到结果不会返回，模拟会话期限在工作前后再次检查。不抢占同步CPU，不提供数据库取消、真实鉴权/撤销、网络/HTTP发送或持久审计保证。

错误仅有限代码、固定消息、原trace与retryable=false，不输出底层异常或自动重试。完整输出超限可以由调用者显式降低列表limit后重读，单版超限整份失败。未配置context_history时MockWcpServer保持原路由行为；配置后支持显式提供的当前/归档详情，仍不接管创建/编辑、ContextPack、Proposal或MCP外层协议。

## 未执行的接线示例

以下recordedVersions需由调用者提供完整原版本（含正确摘要）；identity、scope、时间和当前状态也须与其匹配。没有生成、运行或验证示例数据。

```ts
import { MockContextHistoryStore, MockWcpServer, WcpClient } from '@planemem/sdk';
import { validateRequestContext, type ContextItemRevision, type SyncCommandIdentity } from '@planemem/contracts';

declare const identity: SyncCommandIdentity;
declare const recordedVersions: ContextItemRevision[];
declare const expiresAt: string;
const scope = {
  tenant_id: identity.tenant_id,
  workspace_id: identity.workspace_id,
  project_id: identity.project_id,
};
const store = new MockContextHistoryStore({
  scope,
  items: [{
    item_id: 'local-context-1', current_version: 3,
    current_archived: false, current_classification: 'internal',
    revisions: recordedVersions,
  }],
});
const transport = new MockWcpServer({
  context_history: { store, session: {
    identity, expires_at: expiresAt,
    project_readable: true, read_context: true, read_restricted: false,
    visible_item_ids: ['local-context-1'],
  } },
});
const client = new WcpClient(transport, validateRequestContext({
  ...identity, trace_id: 'trace_mock_history_example',
}));
const history = await client.listContextItemHistory('local-context-1', { limit: 25 });
const comparison = await client.compareContextItemVersions({
  item_id: 'local-context-1', from_version: 2, to_version: 3,
});
```

源码接入不等于运行验证。真实历史数据兼容、跨客户端/权限/超时表现、旧Mock调用迁移、生成数据工具及生产数据访问仍无证据；R-003保持未完成，evidence为空。
