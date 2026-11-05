# 搜索 SDK 与 Mock

对应原始 TODO **P0-02：扩充 SDK 和 Mock Server 到完整 WCP 面**。本任务补旧上下文搜索 SDK、项目搜索 Mock，以及旧索引写入后的搜索联动；不代表 P2-03 向量搜索或 P0-02 整项完成。仅源码开发和人工审阅，未编译、运行、测试或发布；下方示例未执行。

## SDK

- `searchProject(input, { timeout_ms?, signal? })` 调用已有 `POST /v1/search`，保留原输入形式，返回 `ProjectSearchEnvelope`。
- `searchLegacyContext(input, { timeout_ms?, signal? })` 调用已有 `POST /v1/context/search`，返回 `LegacySearchEnvelope`。输入为 query、可选 budget 和 use_vector。

两者默认等待 30 秒，输入/规范输入各限 8 KiB，完整响应限 2 MiB，超限失败、不截断。发送前固定项目和可选 actor/client 相等约束、复制输入，不继承写入条件。SDK 上下文要求 ULID 项目范围及可选 ULID actor，客户端 ID 和 trace 沿既有 SDK 标识规则；不改变服务端较宽的身份格式。

共享 `parseProjectSearchEnvelope` 核对原查询、项目、trace、完整页面和数据库表来源；`parseLegacySearchEnvelope` 核对内外 trace、范围、本地/记忆类型、先本地后记忆、各后端 ID 去重、记忆顺序评分、降级和完整来源拼接（保留重复及记忆来源扩展）。memory_used=true 可以没有返回记忆命中。本地结果为数字 revision，项目结果保留 bigint 十进制 version。

Fetch 使用既有 bounded-json 的完整 HTTP/trace/字节读取。自定义 transport 须支持该模式和 signal；SDK 仍检查完整返回对象，但无法限制 transport 预先分配的内存。取消/超时只停止本地等待，不自动重试或翻页。

## 项目搜索

`MockProjectSearchStore` 配置固定单项目的完整记录，最多 1000 条、1000 个 FTS 查询场景、整体 16 MiB。body 是完整正文，摘要取前 360 个 Unicode 字符；工作项 external_id/owner 可为 null、expires_at 必须 null，上下文 external_id/owner 必须 null。

substring 在完整标题/正文（工作项另含 external_id/owner）上做小写字面匹配，拼接跳过 null；百分号和下划线不是通配符。JavaScript 大小写转换不保证等同所有 PostgreSQL locale。FTS 不实现数据库分词/评分；fts_queries 对每个规范 query 提供完整命中清单和 0–1 分数，清单外是非命中。未知 query 报 `MOCK_SEARCH_SCENARIO_UNCONFIGURED`，空结果需显式空 matches。

查询过滤当前权限、父项目、可见 type/id、删除、类型、上下文状态及到期；同 ID 可分别属于工作项和上下文。隐藏父项目返回空页。按分数/UTC 微秒时间降序，再按 type/id 的 Unicode 顺序升序，后两项不保证等同数据库默认排序。游标绑定 store、原范围/身份/会话到期、权限和筛选，允许改 limit，不跨 store/会话或与生产互通，也不是签名或跨页快照。

```ts
import { createUlid } from '@planemem/contracts';
import { WcpClient, MockWcpServer, MockProjectSearchStore, MockLegacyContextStore,
  type MockProjectSearchRecord, type IndexedContextInput } from '@planemem/sdk';

const scope = { tenant_id: createUlid(), workspace_id: createUlid(), project_id: createUlid() };
const identity = { ...scope, actor_id: createUlid(), client_id: 'search-demo' };
const expires_at = new Date(Date.now() + 3_600_000).toISOString();
const records: MockProjectSearchRecord[] = ['context-a', 'context-b'].map((id) => ({
  type: 'context_item', id, title: '同步设计', body: '保存断网后需要续传的内容',
  version: '1', status: 'confirmed', classification: 'internal',
  updated_at: '2026-11-01T00:00:00.000001Z', expires_at: null,
  source_refs: [{ type: 'manual', id }], external_id: null, owner: null, deleted: false,
}));
const store = new MockProjectSearchStore({
  scope, project_classification: 'internal', records,
  fts_queries: [{ query: '同步', matches: [
    { type: 'context_item', id: 'context-a', score: 0.8 },
    { type: 'context_item', id: 'context-b', score: 0.6 },
  ] }],
});
const projectClient = new WcpClient(new MockWcpServer({ project_search: {
  store, session: { identity, expires_at, read_context: true, read_restricted: false,
    project_readable: true, visible_records: records.map(({ type, id }) => ({ type, id })) },
} }), { ...identity, trace_id: 'trace_project_search' });
const first = await projectClient.searchProject({ query: '同步', limit: 1 });
if (first.data.next_cursor) {
  const next = await projectClient.searchProject({ query: '同步', limit: 20, cursor: first.data.next_cursor });
}
const bodyMatches = await projectClient.searchProject({ query: '断网', mode: 'substring' });
```

## 旧索引写后搜索

已有 `MockLegacyContextStore` 增加可选 search；旧配置仍支持原五操作，未配置搜索时查询明确失败。search.queries 每个 query 最多 1000 个 evaluations，为准确 id/title/snippet 加 score（0–1 命中或 null 非命中）。可预置未来新建/编辑内容；每个当前可见、未删除、未到期索引都须有当前正文的评价，遗漏即失败。单条索引的不同正文可配置多份评价，相同正文不允许重复。

结果 revision、分类、到期、来源和排序更新时间读同一可变索引。删除后退出搜索，恢复后按保留的到期时间判断；更新正文需要新评价，不把写入时的历史 score 当作当前搜索分数。下面沿用上方 scope/identity/expires_at，展示未执行的写入/删除/恢复查询：

```ts
const content: IndexedContextInput = {
  id: 'manual:resume', title: '续接记录', snippet: '保留同步进度', revision: 1,
  score: 0, rank_source: 'fts', classification: 'internal', expires_at: null,
  source_refs: [{ type: 'manual', id: 'resume-note' }],
};
const indexStore = new MockLegacyContextStore({
  scope, project_classification: 'internal', records: [], capture: { mode: 'off', required: false },
  search: { queries: [{ query: '同步',
    evaluations: [{ id: content.id, title: content.title, snippet: content.snippet, score: 0.7 }],
    memory: { mode: 'off', required: false },
  }] },
});
const legacyClient = new WcpClient(new MockWcpServer({ legacy_context: {
  store: indexStore, session: { identity, expires_at, authenticated_client: true,
    read_context: true, write_context: true, read_restricted: false, project_readable: true,
    visible_index_ids: [content.id] },
} }), { ...identity, trace_id: 'trace_legacy_search' });
await legacyClient.indexLegacyContext(content, { idempotency_key: 'search-create-1',
  expected_actor_id: identity.actor_id, expected_client_id: identity.client_id });
const afterWrite = await legacyClient.searchLegacyContext({ query: '同步' }); // revision 1
const deletion = await legacyClient.deleteLegacyContextIndex({
  id: content.id, expected_revision: 1, reason: '暂时移除',
}, { idempotency_key: 'search-delete-1' });
const afterDelete = await legacyClient.searchLegacyContext({ query: '同步' }); // 无本地命中
await legacyClient.restoreLegacyContextIndex({
  id: content.id, expected_revision: deletion.data.record.revision, reason: '恢复使用',
}, { idempotency_key: 'search-restore-1' });
const afterRestore = await legacyClient.searchLegacyContext({ query: '同步' }); // revision 3
```

记忆配置为 mode:off，或 mode:configured 加 recalled/failed outcome；required 决定失败是否可降级。recalled 提供 id/snippet/revision/source_refs，整批最多 1000 条；构造时完整校验，再允许运行时去重/截取。坏范围/来源等用显式错误 outcome 表达，不构造跨范围成功。全部记忆按 restricted 处理，父项目不可见的拒绝发生在可选失败降级前。成功空召回仍 used=true；未配置且可选不降级，有配置但无权/失败且可选则降级。use_vector=true 返回 degraded=true/vector_used=false。

最终先本地、后记忆，截至 budget；本地已满也处理记忆场景，必需记忆失败仍报错。不跨后端去重、不按分数混排，来源按最终命中顺序拼接。capture 和 recall 是独立场景，写入不会推导外部记忆内容。

## 边界与剩余项

两种 Mock 都要求固定模拟身份、read_context、有效会话和明确可见范围，身份头不授予权限。项目 store 独立于其他工作项/上下文 Mock，构造后固定；旧搜索与原索引 store 共用写状态、两笔容量和默认 30 秒期限。项目搜索也独立限制两笔并发，底层摘要未结束时仍占槽位。输入、输出及种子是有界 JSON 副本，修改返回对象不改变内部记录。

响应中的 postgres/backend 和表来源只保持生产协议形状，不证明访问了数据库。未调用真实 FTS、记忆或身份服务。Mock 更严格地拒绝无关写入/缓存头、URL 查询及非法 framing，生产边界见原运行契约。P0-02 仍缺其他公开操作、机器契约消费和兼容证据；项目 Mock 与其他写入 store 的动态联动、生产 pgvector/重建等也不由本任务完成。
