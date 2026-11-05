# Plane 收件箱 Mock

对应 TODO **P0-02：SDK 和 Mock Server 覆盖完整 WCP 面**。本次实现六种现有 SDK 操作的模拟行为，不新增 OpenAPI 路由，也不表示 P0-02 已完成。源码及下列示例均未编译、运行或测试。

| SDK 方法 | 模拟行为 |
| --- | --- |
| `listPlaneInboxEvents` | 状态、待处理子状态、聚合 ID 筛选，按事件 ID 降序分页 |
| `getPlaneInboxSummary` | 从同一可见队列计算统计和最早/最新时间，不受列表筛选影响 |
| `getPlaneInboxEvent` | 当前处理元数据、原身份和人工重试资格提示 |
| `getPlaneInboxDiagnosis` | 独立已提交流与当前可见回执匹配，输出版本位置及候选 |
| `retryPlaneInboxEvent` | 原版本比较后重新排队，保存原请求回执 |
| `getPlaneInboxRetryReceipt` | 只读返回原回执或 `not-observed` |

## 接线示例

这是未执行的开发用法。所有事件与权限均为显式模拟配置。

```ts
import { createUlid, type PlaneInboxRecord } from '@planemem/contracts';
import { MockPlaneInboxStore, MockWcpServer, WcpClient } from '@planemem/sdk';

const scope = {
  tenant_id: createUlid(), workspace_id: createUlid(), project_id: createUlid(),
};
const now = new Date().toISOString();
const applied: PlaneInboxRecord = {
  ...scope, schema_version: 1, event_id: createUlid(),
  event_type: 'WorkItemCreated', aggregate_type: 'work_item',
  aggregate_id: createUlid(), aggregate_version: '1',
  status: 'applied', attempts: '1', revision: '2', classification: 'internal',
  received_at: now, updated_at: now, checked_at: now,
  next_attempt_at: null, applied_at: now, last_error_code: null,
};
const waiting: PlaneInboxRecord = {
  ...applied, event_id: createUlid(), event_type: 'WorkItemUpdated',
  aggregate_version: '3', status: 'pending', revision: '1',
  applied_at: null, next_attempt_at: now, last_error_code: 'AGGREGATE_VERSION_GAP',
};
const store = new MockPlaneInboxStore({
  scope, project_classification: 'internal',
  events: [
    { record: applied, event_valid: true },
    { record: waiting, event_valid: true },
  ],
  committed_events: [{
    event_id: applied.event_id, event_type: 'WorkItemCreated',
    aggregate_type: applied.aggregate_type, aggregate_id: applied.aggregate_id,
    aggregate_version: applied.aggregate_version,
  }],
});
const identity = { ...scope, actor_id: createUlid(), client_id: 'mock-admin' };
const session = {
  identity, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  authenticated_client: true, admin_role: true, human_actor: true,
  read_admin: true, retry_plane: true,
  project_readable: true, read_restricted: false,
  visible_event_ids: [applied.event_id, waiting.event_id],
};
const client = new WcpClient(
  new MockWcpServer({ plane_inbox: { store, session } }),
  { ...identity, trace_id: 'trace_inbox_example' },
);
const filters = { status: 'pending' as const, pending_state: 'version_gap' as const, limit: 25 };
const first = await client.listPlaneInboxEvents(filters);
if (first.data.next_cursor) {
  const next = await client.listPlaneInboxEvents({ ...filters, cursor: first.data.next_cursor });
}
const summary = await client.getPlaneInboxSummary();
const diagnosis = await client.getPlaneInboxDiagnosis(waiting.event_id);
const current = await client.getPlaneInboxEvent(waiting.event_id);
const command = {
  event_id: waiting.event_id, expected_revision: current.data.revision,
  reason: '人工重新安排处理',
};
const options = {
  idempotency_key: 'retry-example-1',
  expected_actor_id: identity.actor_id, expected_client_id: identity.client_id,
};
const scheduled = await client.retryPlaneInboxEvent(command, options);
const original = await client.getPlaneInboxRetryReceipt(command, options);
```

示例的版本诊断为缺少第 2 版；重试只使队列修订加一、清除上次错误，并把下一次处理时间设为当前时间。它不会补造第 2 版、增加 `attempts` 或使第 3 版进入 `applied`。之后的列表和统计立即读取这个更新后的队列。`committed_events` 与观察 Mock 都不会随调度改变。

## 种子、身份与版本诊断

单 store 固定一个项目，种子整体最多 16 MiB、1000 条队列记录和 1000 条已提交事件。构造和连接均保存独立副本，所有返回封套也复制。队列元数据沿共享解析器检查；`record.classification` 需由配置者提供事件和当前索引的最高分类，store 再与 `project_classification` 取最高值。缺失/非法敏感性应明确配置为 `restricted`。`event_valid` 仅模拟生产对原事件的校验结果：`false` 时仍可读取合法队列元数据，但调度和原回执查询失败；`true` 不证明真实 payload、HMAC 或来源有效。

`committed_events` 必须独立配置，不能从 `applied` 行自动推导。它可以包含没有队列回执的事件；同一事件同时存在于两种种子时，其流、类型和版本必须一致。每个流取最高版本的最多两条事件，只有全部都有可见、匹配的 `applied` 回执时才给出基线。缺少或隐藏实际最高版本回执，返回 `baseline_unavailable`，不回退较低版本。多个最高版本返回 `ambiguous_stream`。版本比较复用共享规则，包含删除流限制；同版本/下一版本候选按 ID 升序最多十条，并提供 `has_more`。所有诊断记录使用同一次 `checked_at`。

每个连接显式给出完整 scope/actor/client、到期时间、认证和管理员标志。读操作及原回执查询要求 `read_admin`，新调度要求 `human_actor` 和 `retry_plane`；管理员角色不替代这些授权。`visible_event_ids`、项目可见性和 restricted 权限共同过滤全部读取。项目不可见时列表/统计为空，详情/诊断/重试找不到目标。`plane_inbox_permissions.retry` 与生产详情一致，只是人工身份提示，不保证命令授权。

请求范围必须与连接相等；可选 expected 身份头只能约束当前身份，两个重试入口必须包含完整 expected 头。共享一个 store 的多个连接可看到同一队列的调度变化，但原键按完整 scope/actor/client 隔离。修改调用者的原配置不会改变已建立连接。

## 重试与读取边界

原键在身份范围内跨事件唯一；不同事件、理由或原修订复用同键返回 `IDEMPOTENCY_KEY_REUSED`。同命令重放保留第一次回执的时间、修订和之前状态，不再写队列；随后用新键再次调度，也不改变早先回执。查询缺失键返回 `not-observed`，不执行重试或校验当前 CAS 是否仍相等。未知结果应查询原键；不自动生成新键重发。

首次调度必须满足当前 `revision == expected_revision` 且为 pending/rejected。原 Plane 版本、事件、接收时间和尝试次数保持，队列修订加一，`updated_at == next_attempt_at`，状态 pending、错误和 applied 时间清空。原回执最多 1000 条/16 MiB，满时拒绝新写，不淘汰旧键；既有键仍可查询或重放。完整响应、容量、取消和会话期限检查后，同步保存状态与回执，中间没有异步等待。若调用方在提交后失去响应，已保存的回执仍可查询。

分页绑定 store、身份、到期、权限、可见集合、筛选及页大小；换条件必须回首页，生产游标不可混用。每页重新读取当前状态，不提供跨页快照。到期与延迟使用当前毫秒时间，`version_gap` 是 pending 内的子集。

路径和请求头各 16 KiB，重试正文 16 KiB，完整响应 2 MiB 或调用方更小额度。每 store 共用两个在途名额和单请求 30 秒预算；列表计算 SHA-256 游标时仍占用名额，取消后底层计算结束才释放。摘要后重新读取队列。直接 `WcpTransport` 请求可传 `signal`/`max_response_bytes`；现有六个 SDK 方法没有新增取消/超时选项。模拟预算不证明 HTTP 传输或生产服务期限。

这次仍未覆盖 Webhook 动态入队、worker 执行、故障注入、跨进程持久回执和审计、自动补拉缺失版本及其他 WCP Mock 缺口；P0-02/R-001 保持未完成，验收证据为空。
