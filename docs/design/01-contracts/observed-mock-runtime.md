# Plane 观察读取 Mock

TODO P0-02，2026-11-05：新增开发源码，未编译、运行或测试。这里模拟已保存的 Plane 观察，不连接 Plane、数据库或 ai-memory，不证明上游当前状态或 Webhook 已被真实接收。

`MockObservedStore` 接入 `MockWcpServer({ observed: { store, session } })`，也可将 `store.connect(session)` 直接传给现有 `WcpClient`。

| 现有 SDK 方法 | 模拟读取 |
| --- | --- |
| `getObservedProjectState()` | 当前项目的原 Plane 观察 |
| `getObservedWorkItemState(id)` | 工作项活动、删除或恢复观察，接受 external ID 或 aggregate ID |
| `getObservedWorkItemContext(id)` | 指定工作项的显式临时上下文场景 |
| `listObservedWorkItems(query)` | 从同一观察集合派生的目录，支持搜索、状态筛选和续页 |

## 配置示例

下面是未执行的源码用法。ID、观察与上下文均是人工配置的模拟资料。

```ts
import { createUlid, type ObservedSnapshot, type ObservedWorkItemContext } from '@planemem/contracts';
import { MockObservedStore, MockWcpServer, WcpClient } from '@planemem/sdk';

const scope = {
  tenant_id: createUlid(),
  workspace_id: createUlid(),
  project_id: createUlid(),
};
const project: ObservedSnapshot = {
  ...scope,
  schema_version: 1,
  entity_kind: 'Project',
  external_id: scope.project_id,
  aggregate_id: scope.project_id,
  authority: 'plane',
  plane_version: 1,
  observed_at: '2026-11-05T00:00:00.000Z',
  source_event_id: createUlid(),
  source_refs: [{ type: 'plane', id: scope.project_id }],
  classification: 'internal',
  fields: { external_id: scope.project_id, name: '开发项目' },
};
const workItem: ObservedSnapshot = {
  ...scope,
  schema_version: 1,
  entity_kind: 'WorkItem',
  external_id: 'PLANE-42',
  aggregate_id: createUlid(),
  authority: 'plane',
  plane_version: 3,
  observed_at: '2026-11-05T01:00:00.000Z',
  source_event_id: createUlid(),
  source_refs: [{ type: 'plane', id: 'PLANE-42', revision: 3 }],
  classification: 'internal',
  status: 'in-progress',
  fields: { external_id: 'PLANE-42', title: '继续开发', status: 'in-progress' },
};
const context: ObservedWorkItemContext = {
  work_item: workItem,
  context_pack: {
    schema_version: 1, query: '继续开发', trace_id: 'trace_fixture',
    degraded: true, backend: 'postgres', memory_used: false, vector_used: false,
    hits: [{
      ...scope, schema_version: 1, id: 'plane:WorkItem:PLANE-42',
      title: '继续开发', snippet: '继续开发 (in-progress)', revision: 3,
      score: 1, rank_source: 'fts', classification: 'internal',
      source_refs: workItem.source_refs,
    }],
    source_refs: workItem.source_refs,
  },
};
const store = new MockObservedStore({
  scope,
  project_classification: 'internal',
  project: { snapshot: project, event_type: 'ProjectCreated', expires_at: null },
  work_items: [{
    snapshot: workItem, event_type: 'WorkItemUpdated', expires_at: null,
    contexts: [{ read_restricted: false, data: context }],
  }],
});
const identity = { ...scope, actor_id: createUlid(), client_id: 'mock-editor' };
const transport = new MockWcpServer({ observed: { store, session: {
  identity,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  project_readable: true,
  read_context: true,
  read_restricted: false,
  visible_work_item_ids: ['PLANE-42'],
} } });
const client = new WcpClient(transport, { ...identity, trace_id: 'trace_read' });
const savedProject = await client.getObservedProjectState();
const byExternalId = await client.getObservedWorkItemState('PLANE-42');
const byAggregateId = await client.getObservedWorkItemState(workItem.aggregate_id);
const contextResult = await client.getObservedWorkItemContext('PLANE-42');
const filters = { state: 'all' as const, limit: 1 };
const first = await client.listObservedWorkItems(filters);
if (first.data.next_cursor) {
  const next = await client.listObservedWorkItems({ ...filters, cursor: first.data.next_cursor });
}
```

`project` 可以为 `null`，表示缺少已保存的项目观察；此时项目状态返回 `NOT_FOUND`，项目内工作项仍按显式 `project_readable` 和 `project_classification` 判断。它们模拟当前本地父项目，不能从旧 Plane 项目快照推导。所有种子和连接配置复制后保存，返回值也完全复制，不向调用者暴露可改写的内部对象。

## 状态与上下文

种子最多 1000 个工作项、总计 16 MiB。单条状态/上下文最多 2 MiB；同一 external ID、来源事件 ID 或同一上下文权限桶重复时拒绝构造。观察字段、来源、版本和恢复标记使用现有共享解析器；不生成新观察时间、事件或 Plane 版本。

删除种子必须使用 `WorkItemDeleted`、内层版本 2、与观察时间相等的 `deleted_at`、仅包含 `external_id` 的 fields，不带 status 或上下文场景。其状态和目录可读，context 返回 `OBSERVED_RECORD_DELETED`；活动索引 `expires_at` 不隐藏删除标记。恢复种子必须使用 `WorkItemRestored`、版本 1、`restored_from` 及相同 fields 标记，引用紧邻的前一删除版本。这里只核验引用结构，不证明真实删除事件链存在。

工作项读取接受 external ID 或 aggregate ID。可见集合只配置 external ID；选择前先过滤可见性、restricted 权限和活动索引有效期。若一个 ID 命中两条当前可见观察，返回 `OBSERVED_STATE_INVALID`，不任意选择其中一条。活动索引过期后状态/上下文不可读，目录不再列出；时间判断发生在本次模拟读取时。

每个活动工作项可配置两个 `contexts` 权限桶。完整上下文必须描述同一观察，首条本地命中的版本、来源、分类、标题、查询与 snippet 需匹配生产组装规则。`read_restricted: false` 桶禁止任何 restricted 命中和 `memory_used: true`；外部记忆命中始终属于 restricted。访问时严格选择当前权限桶，缺少场景返回 `MOCK_OBSERVED_CONTEXT_UNCONFIGURED`，不从另一桶截取或生成结果。可以显式配置无记忆的降级场景，或有权限时配置完整记忆结果。

返回时只将上下文当前请求 trace 改为调用方 trace，原观察和来源信息保留。旧字段 `context_pack` 表示临时搜索摘要，不是已保存的 ContextPack；其中 `backend: postgres`、`memory_used` 等仅描述模拟场景，不能作为真实数据库或记忆服务调用的证据。

## 目录与权限

目录由同一状态生成，不另存可能失真的列表。删除项不保留标题或状态；活动项标题按 Unicode 字符截到 2000 个、状态截到 255 个，空标题回退 external ID。目录分类取父项目与观察分类中更严格者；状态正文仍保留原观察分类，同时对当前父项目实施权限过滤。

目录默认 `state=active`、每页 25、最多 100。共用 `matchesObservedWorkItemQuery` 的 ASCII 大小写折叠及字面匹配，只搜索 external ID、aggregate ID 和活动标题；删除记录不按旧标题命中。共用 Unicode 标量排序，支持中文及非 BMP 外部 ID；游标按 UTF-8 编码并核验规范形式。

游标 SHA-256 绑定独立 store、完整范围/身份/到期、权限/可见集合及规范 query/state/limit，不与生产游标或其他 store 互通；改变筛选/身份/页大小后必须从第一页开始。摘要不是签名或权限凭据。`checked_at` 是当前模拟页的读取时间；过期记录可能在后续页消失，分页不保证跨页快照，不自动重试或补页。

四路均要求显式 `read_context`、未到期会话及可读父项目。父项目 restricted 而缺少实际 restricted 权限时统一 `NOT_FOUND`；请求头只核对范围和可选账号/客户端，不能授予访问权。隐藏项目/工作项不因 aggregate 别名、目录或上下文场景泄露。

## 读取限制与剩余范围

单请求路径和头各最多 16 KiB，成功完整响应最多 2 MiB，调用方可选择更低上限。仅 GET/JSON，拒绝正文、重复查询参数、写入/缓存/范围/编码/长度条件；路径 ID 使用一次解码及规范转义核对。30 秒总等待和取消覆盖目录摘要，原生摘要未结束前继续占用每 store 两路容量；第三笔返回 `RATE_LIMITED`，会话到期或取消后的迟到结果不返回成功。这些是 Mock 的读取边界，不声称现有生产四路已具备同样限制。

当前为固定内存种子，没有 Webhook 写入、跨版本历史、动态刷新、持久回放、真实来源联表或记忆查询。未增加生产路由或机器契约；完整 WCP Mock、机器契约消费和运行兼容证据仍未完成，P0-02/R-001 保持开放。
