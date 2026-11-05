# 旧上下文索引 SDK 与 Mock

对应 TODO **P0-02**。新增 `WcpClient.indexLegacyContext` 类型化内容写入，以及 `MockLegacyContextStore` 的内容写入、目录、状态、删除和恢复五操作。它们使用同一内存索引和原请求回执；不新增 HTTP 路由。本次仅开发源码与人工审阅，下列示例未执行，P0-02/R-001 未验收。

## SDK 内容写入

`indexLegacyContext(input, options)` 调用既有 `POST /v1/context/index`。输入沿 `IndexedContextWriteRequest`，包含 id/title/snippet/revision/score/source_refs；classification 默认 restricted、rank_source 默认 fts、expires_at 默认 null。`plane:` ID 由事件投影管理，手工写入拒绝。

options 必须显式给出 `idempotency_key`、`expected_actor_id`、`expected_client_id`；与客户端已配置身份不一致时拒绝发送。可选 `timeout_ms` 默认 30000、`signal` 取消等待。发送前保存规范输入副本，传输拿到另一份正文，原参数或传输侧修改不会改变回执核对基准；不继承全局写版本条件，不自动重试、换键或补存文件。

输入及规范化结果各限 1 MiB，完整响应限 2 MiB。SDK 与 Mock 共用 `parseIndexedContextWriteEnvelope`：检查原 trace、项目范围、schema、全部规范字段、原正文/版本/分类/到期/来源顺序，并只允许追加一条无 revision/URI 的 ai-memory capture 引用；内外来源必须相同。完整 JSON 副本拒绝循环、访问器、无穷值和过度复杂度；未知错误使用固定提示。返回 `IndexedContextWriteEnvelope`，其 data 为 `IndexedContextRecord`。

Fetch 传输沿现有 bounded-json 处理；自定义传输也须返回完整封套并支持限额和取消。超时/取消只是停止等待，可能已经写入或 capture 成功，不能据此自动换新键。该入口没有独立只读正文回执查询；同键重放仍受当前可读性/删除/到期限制，必须保留原请求。

## 五操作接线

下面是未执行的模拟用法。将传输换为配置好的真实 Gateway 传输，可使用同一个新 SDK 写入方法；示例本身不访问网络或外部记忆。

```ts
import { createUlid } from '@planemem/contracts';
import { MockLegacyContextStore, MockWcpServer, WcpClient, type IndexedContextWriteRequest } from '@planemem/sdk';

const scope = { tenant_id: createUlid(), workspace_id: createUlid(), project_id: createUlid() };
const identity = { ...scope, actor_id: createUlid(), client_id: 'mock-editor' };
const id = 'manual:design-note';
const store = new MockLegacyContextStore({
  scope, project_classification: 'internal', records: [],
  capture: { mode: 'off', required: false },
});
const session = {
  identity, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  authenticated_client: true, read_context: true, write_context: true,
  read_restricted: false, project_readable: true, visible_index_ids: [id],
};
const client = new WcpClient(
  new MockWcpServer({ legacy_context: { store, session } }),
  { ...identity, trace_id: 'trace_index_example' },
);
const content: IndexedContextWriteRequest = {
  id, title: '设计记录', snippet: '人工保存的上下文', revision: 1, score: 1,
  classification: 'internal', source_refs: [{ type: 'manual', id: 'note-1' }],
};
const options = {
  idempotency_key: 'index-original-1',
  expected_actor_id: identity.actor_id, expected_client_id: identity.client_id,
};
const saved = await client.indexLegacyContext(content, options);
const repeated = await client.indexLegacyContext(content, options);
const current = await client.getLegacyContextIndexStatus(id);
const first = await client.listLegacyContextIndexes({ query: 'design', state: 'active', limit: 25 });
const deletion = { id, expected_revision: current.data.revision, reason: '暂时移除' };
const deleted = await client.deleteLegacyContextIndex(deletion, { idempotency_key: 'delete-original-1' });
const restored = await client.restoreLegacyContextIndex({
  id, expected_revision: deleted.data.record.revision, reason: '恢复使用',
}, { idempotency_key: 'restore-original-1' });
const originalDelete = await client.deleteLegacyContextIndex(deletion, { idempotency_key: 'delete-original-1' });
const after = await client.getLegacyContextIndexStatus(id);
```

示例中重复写入保持版本 1；删除变版本 2，恢复变版本 3。最后一次原删除请求返回历史删除回执，不重新删除当前索引；`after` 仍读取版本 3。内容更新应使用新键及高于当前状态的 revision，例如 4。

## 数据、权限和原回执

种子固定单项目，整体最多 16 MiB、1000 条完整索引及 1000 个 capture 场景。每条记录含完整 `content`、`updated_at`、`deleted_at`，状态根据当前毫秒时间派生，支持活动、到期、删除及 Plane 管理记录。种子元数据需通过共享状态解析；未来更新时间或删除时间拒绝构造。生产内容解析允许的特殊年份到期值仍沿原内容规则写入，后续状态读取若不满足四位年份的管理契约会明确失败，不伪造正常状态。

连接配置复制后固定：完整身份、期限、有效 context.read/context.write 权限、verified-client 标志、父项目可见性、restricted 权限以及可见 ID 集合。集合可预先包含尚不存在的 ID，以允许显式创建；最多 1000 个且不能重复。手工写入/删除/恢复要求已认证客户端和有效写权限，目录/状态要求有效读权限。父项目 restricted 与记录 restricted 独立检查，状态保留记录本身分类，不通过父项目降级。请求头只能增加身份相等约束，不能授予权限。

首次写入可创建非负安全整数 revision；已有记录必须使用严格更高版本，分类不得降低，已删除记录禁止覆盖。首次写入允许已经过期的内容，与生产一致。同身份下内容原键跨 ID 唯一；相同规范输入返回原正文回执，异文拒绝。重放前核对当前项目/记录可见性；当前删除/过期、历史正文过期或历史 restricted 不可读时拒绝正文重放，不泄露旧正文。

删除/恢复按完整身份、操作和请求键隔离，与内容写入原键独立。新命令要求 expected_revision 精确匹配且删除状态正确，版本加一；恢复清除删除时间但保留 expires_at，因此恢复后仍可能 expired。Plane 管理 ID 拒绝手工生命周期命令。历史管理回执只含元数据，可在后续删除/恢复后重放，保留原 checked_at/revision，不冒充当前状态。

索引整体限 1000 条/16 MiB，全部原回执合计限 1000 条/16 MiB；满时拒绝新命令，已存键可在原权限和状态约束下重放。完整响应及容量、会话、取消检查全部通过后，同步保存索引和回执。返回数据不暴露内部引用，大小失败不会提交此次变更。提交后丢失响应仍有可能，原回执不会被清除。

## 显式 capture 场景

`capture: { mode: 'off', required: false }` 表示未配置且可选；首次写入不追加来源。`required: true` 则首次写入失败。配置模式需要完整规范输入对应的独立场景：

```ts
capture: {
  mode: 'configured', required: true,
  scenarios: [{
    input: normalizedContent,
    outcome: { kind: 'captured', page_ref: 'fixture-page-1' },
  }],
}
```

`normalizedContent` 是包含全部字段的 `IndexedContextInput`，可由共享 `parseIndexedContextWriteInput(content)` 得到。输入按规范字段精确匹配，缺场景返回 `MOCK_CONTEXT_INDEX_CAPTURE_UNCONFIGURED`，不会臆造成功。失败场景使用 `{ kind: 'failed', code }`，code 为 MEMORY_PROVIDER_OFF、MEMORY_UNAVAILABLE 或 MEMORY_SCOPE_MISMATCH；必需 provider 失败不写索引，可选失败保存原本地来源、不追加 degraded 字段。已配置 provider 的首次写入须预留一个来源槽位；原键重放不再次匹配/执行 capture。所有引用只是人工场景，不证明真实记忆调用，也不解决生产 capture 与数据库事务之间的非原子性。

## 目录和剩余范围

目录按当前可见状态及 managed_by 筛选，ID 使用 Unicode 标量升序，独立 UTF-8 游标绑定 store、完整身份/期限/权限/可见集合和筛选。沿生产旧目录规则，续页可以更改 limit，筛选改变须回首页。ID 搜索使用 JS 小写字面包含，不声称与任意 PostgreSQL locale 的 lower 完全等价。每页读取当前状态，没有跨页快照。

Mock 路径/头各限 16 KiB，内容正文 1 MiB、删除/恢复正文 16 KiB，完整输出 2 MiB 或调用方较小限额。两路在途容量/30 秒期限，游标摘要结束前保留名额；异步后重新取当前记录。直接 Mock transport 支持 signal；旧四个 SDK 方法保持原签名，新写入方法提供独立期限/取消选项。Mock 拒绝版本/缓存/范围/编码头，生命周期使用正文 expected_revision。

仍缺项目/旧索引搜索等其余 WCP Mock、动态 Plane 更新、真实记忆与持久审计/重启证据、SDK/Mock 自动消费机器契约；P0-02 保持未完成。不把本组代码或模拟回执计为真实业务验收通过。
