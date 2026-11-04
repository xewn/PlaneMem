# 上下文目录 Mock（源码阶段）

2026-11-04为既有MockContextHistoryStore增加可选目录配置，经MockWcpServer的context_history接入POST /v1/workbench/query、operation=context。SDK listContextItems和contextItemPages沿原完整解析/按需读取使用同一存储，不新增生产路由或执行任何Mock。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布；R-003未完成、evidence为空。

## 显式完整数据集

MockContextHistorySeed可增加directory: MockContextDirectorySeed，形状为`{searches:[{query,item_ids}]}`。`searches: []`启用无文本查询的目录；省略directory保留旧详情/历史行为，目录读取不可用。每个seed.items条目可增加directory_record: ContextItemDirectoryRecord；开启directory时全部条目都必须提供，不能因缺记录而悄悄漏项。可用空items显式表示空模拟项目。

directory_record为完整共享目录投影：id/title/item_type/layer/classification/status/source_ref/expires_at/confidence/priority/content/source_refs/trace_id/updated_at/version/archived_at。保存完整正文和来源，版本是正安全整数，confidence为0–1数值，时间必须为UTC六位微秒，expires_at/archived_at允许null。每条复用共享完整页解析（单条limit=1），id/版本/分类/归档视图必须匹配所属条目的current_*元数据；归档记录必须excluded。

若已提供current_detail，核对目录与详情的共有保存字段；若revisions包含current_version，同样核对该版本保存正文和归档时间。不比较实时诊断、确认就绪、权限提示或详情独有的created_at。对象键顺序不影响正文/来源对象比较，数组顺序和正文空白保持。当前详情与历史只表达毫秒，时间一致性比对以双方转换为毫秒后的时间为准，不能证明末三位微秒；目录仍完整保留给定微秒用于排序和游标。缺详情或当前历史允许，但不从目录补造详情/历史/确认。

种子整体沿16 MiB、最多1000条目/总1000历史版本及共享普通JSON深度/节点上限。directory_record和searches计入同一预算；单条最多2 MiB，完整返回封套也最多2 MiB，因此能存储的记录不保证能与其它记录同页返回。超限整页失败，不自动截断正文或缩小limit。修改传入种子不影响存储。

## 查询与分页

输入正文最多8 KiB，固定operation=context及原共享筛选；无路径查询参数或片段。query/layer/classification/status/item_type/archived/limit/cursor规范化沿共享解析，archived默认false、limit默认25且允许1–100。精确字段筛选、显式会话visible_item_ids及restricted可见性都在分页之前应用。排序为High/Medium/Low、六位微秒updated_at倒序、ID按Unicode码点顺序（匹配UTF-8 PostgreSQL C排序）；最多取limit+1个匹配条目生成完整一页。

文本查询使用searches中的**显式完整命中集合**。每个配置query须为非空、已去首尾空白且符合共享长度/文本规则的字符串；最多1000个不同query，每组最多1000个已存在且不重复的item_ids。匹配使用规范化后的完整query键，大小写不同的查询需分别配置；没有query不使用命中集合。命中集合再与精确字段、归档和权限交集后排序，不按给定ID列表顺序返回。配置空item_ids可显式表示已知无命中；未配置query返回INVALID_INPUT，不能当作空结果。这里不模拟PostgreSQL lower、concat_ws或JSONB输出，不访问真实数据库验证命中集合。

游标使用共享v2位置格式，SHA-256绑定mock专用标记、store随机标识、完整五项身份、会话到期、项目/读取/restricted决定、规范可见集合、目录权限提示、所有规范筛选及limit。绑定不包含本次trace；同store及相同配置可以继续，换store/身份/可见性/权限/到期/筛选/页大小必须回首页，生产游标不可混用。续页校验绑定及严格后续位置，末条位置对应next_cursor，真正末页省略续页。仅内存固定数据集，不持久保存游标或冒充生产跨页一致性保证。

## 模拟会话与响应

原MockContextHistorySession的identity/expires_at/project_readable/read_context/read_restricted/visible_item_ids继续控制目录、详情和历史。新增可选directory_access: MockContextDirectoryAccess，必须包含compile/write/propose三个布尔字段；省略时全false。完整目录context_permissions包含这三项及原read_restricted布尔值。它们只是显示场景，不启用编译/建议/写入路由，也不替代读取授权、可见集合或review_access。

返回完整schema_version/原trace/scope/规范query/data/可选next_cursor/context_permissions/source_refs；条目内trace和完整保存内容保持。为兼容真实目录共享契约，外层来源标签仍为`[{type:'postgres',id:'wcp_context_items'}]`，仅表示模拟的协议形状，**不表示访问了PostgreSQL或具有真实来源证明**。共享解析再次检查完整记录、原查询/范围、排序/续页/权限一致性后返回独立普通JSON副本；修改上一页不会改变存储或下一页。

请求头复用原16 KiB捕获、大小写重复检测、原项目和可选账号/客户端相等约束，拒绝写/缓存/Range等条件。支持默认json或显式bounded-json，后者需正安全整数max_response_bytes；实际完整输出限制取调用者限额和2 MiB中较小者。目录、当前/归档详情、历史列表和指定版本五类读取共用每store两笔容量及30秒预算；显式signal或SDK更短期限可停止等待。目录摘要直接等待底层WebCrypto SHA-256，超时后未结束仍占槽，迟到结果不交付；同步解析不能中途抢占。

目录未配置返回MOCK_ROUTE_NOT_FOUND；错误输入、未知文本query和跨绑定游标返回INVALID_INPUT；配置损坏仍为MOCK_CONTEXT_HISTORY_CONFIGURATION_INVALID，目录解析/摘要不可用为CONTEXT_ITEM_INVALID，调用者输出限额为GATEWAY_RESPONSE_INVALID；权限/容量/取消/超时沿原固定代码。SDK可能将不在它白名单内的Mock专用错误转成固定GATEWAY_UNAVAILABLE，不透传上游文案。没有真实HTTP状态/ETag头、网络故障、认证、审计、SQL成本或持久化保证。

MockWcpServer先识别workbench路径正文的operation=context普通数据属性并分派context_history，其余工作项operation仍走work_items；两种配置可共存。分类器不调用operation访问器，实际输入完整普通JSON仍由目标存储校验，错误不会回退另一数据集。

## 未执行的接线示例

records由调用者提供完整合法投影，scope与identity匹配，sessionExpiresAt为未来有效模拟期限。以下只展示源码用法，未生成或执行数据。

```ts
import {
  MockContextHistoryStore, MockWcpServer, WcpClient,
  type ContextItemDirectoryRecord,
} from '@planemem/sdk';
import { validateRequestContext, type SyncCommandIdentity } from '@planemem/contracts';

declare const identity: SyncCommandIdentity;
declare const records: ContextItemDirectoryRecord[];
declare const sessionExpiresAt: string;

const store = new MockContextHistoryStore({
  scope: {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  },
  directory: { searches: [] },
  items: records.map((record) => ({
    item_id: record.id,
    current_version: record.version,
    current_archived: record.archived_at !== null,
    current_classification: record.classification,
    directory_record: record,
    revisions: [],
  })),
});
const transport = new MockWcpServer({
  context_history: { store, session: {
    identity, expires_at: sessionExpiresAt,
    project_readable: true, read_context: true, read_restricted: false,
    visible_item_ids: records.map((record) => record.id),
  } },
});
const client = new WcpClient(transport, validateRequestContext({
  ...identity, trace_id: 'trace_mock_directory_example',
}));
const first = await client.listContextItems({ limit: 10 });
// 如first.next_cursor存在，保留原limit/筛选和身份显式续读。
// 或调用client.contextItemPages({limit:10}, {max_pages:10})按需逐页读取。
```

上述空revisions明确表示未提供历史，不能据此判断真实历史不存在；没有current_detail的条目详情仍不可用。SDK单页/迭代、共享工作项路由、身份/期限/容量、微秒/Unicode顺序、文本场景和旧种子兼容均缺运行证据。
