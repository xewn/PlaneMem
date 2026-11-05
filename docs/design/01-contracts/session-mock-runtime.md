# 会话生命周期 Mock（TODO P0-02）

开发状态：2026-11-05 已增加实现源码，未编译、运行或测试。P0-02 的完整 WCP 覆盖和契约证据仍未完成。

`MockSessionStore` 从空项目开始，多个 `MockWcpServer` 或 `store.connect(access)` 可以共享同一份内存会话与回执。现有 `WcpClient` 可以完成普通会话启动、创建运行、记录工具调用、工具收尾、运行收尾和会话结束；读取身份、当前会话状态、运行/工具分页和详情，以及原启动/命令回执。

## 配置与流程示例

以下是开发用法说明，本轮没有执行示例。所有身份与权限由调用方显式配置；它们只模拟网关授权，不是认证凭据。

```ts
import { createUlid } from '@planemem/contracts';
import { MockSessionStore, MockWcpServer, WcpClient } from '@planemem/sdk';

const scope = {
  tenant_id: createUlid(),
  workspace_id: createUlid(),
  project_id: createUlid(),
};
const identity = { ...scope, actor_id: createUlid(), client_id: 'mock-editor' };
const store = new MockSessionStore({ scope });
const transport = new MockWcpServer({
  sessions: {
    store,
    session: {
      identity,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      permissions: { read_sessions: true, write_sessions: true, claim_handoffs: true },
      project_readable: true,
      visible_session_ids: 'all',
    },
  },
});
const client = new WcpClient(transport, { ...identity, trace_id: 'trace_mock_session_example' });

const started = await client.startSession({}, { idempotency_key: 'example-session-start' });
const sessionId = started.data.session_id;
const run = await client.startAgentRun(sessionId, { model: 'development-model' }, {
  idempotency_key: 'example-run-start', expected_version: started.data.version,
});
const tool = await client.recordToolCall(sessionId, {
  run_id: run.data.run_id, tool_name: 'read_file', status: 'started',
}, {
  idempotency_key: 'example-tool-start', expected_version: run.data.session_version,
});
const finishedTool = await client.finishToolCall(sessionId, tool.data.tool_call_id, 'succeeded', {
  idempotency_key: 'example-tool-finish',
  expected_version: tool.data.session_version,
  expected_tool_version: tool.data.version,
});
const finishedRun = await client.finishAgentRun(sessionId, run.data.run_id, 'completed', {
  idempotency_key: 'example-run-finish',
  expected_version: finishedTool.data.session_version,
  expected_run_version: run.data.version,
});
await client.endSession(sessionId, 'ended', {
  idempotency_key: 'example-session-end', expected_version: finishedRun.data.session_version,
});
const current = await client.getSessionState(sessionId);
const history = await client.listSessionRuns(sessionId, { limit: 25 });
const originalStart = await client.getSessionStartReceipt({
  request_key: 'example-session-start', session: {},
});
const originalTool = await client.getSessionCommandReceipt(sessionId, {
  request_key: 'example-tool-start', operation: 'tool.call',
  command: {
    run_id: run.data.run_id, tool_name: 'read_file', status: 'started',
    expected_version: run.data.session_version,
  },
});
```

`visible_session_ids` 可设为明确的 ID 数组，或显式的 `'all'`。数组连接只读取所列会话及本连接新建会话；重新连接时需要重新声明可见范围。会话存在于同一个项目 store，不按调用者复制。读取权限与写入权限独立；原回执查询需要读取权限。`claim_handoffs` 是当前身份协议的权限字段，本次尚未实现交接操作。

## 行为

- 五类进度命令与生产服务共用 `prepareSessionMutation` 和 `readSessionMutationReceipt`。原入口仍从 session-service 导出相同函数和类型。会话、运行、工具版本不匹配时返回原冲突错误；同终态的新请求保留原 delta-zero 规则；不同终态拒绝覆盖。会话结束不会自动结束运行或工具，已有运行/工具允许独立收尾，与原服务一致。
- 原请求键按 store、调用者、客户端、操作及会话隔离。保存有效正文的规范指纹，保留字段是否提供；路径会话 ID 纳入指纹，独立幂等键不作为业务字段。同键同文重放不推进版本，同键异文返回 `IDEMPOTENCY_KEY_REUSED`。回执查询只读，不创建记录；`not-observed` 仅表示该模拟账本未记录该键。
- 进度命令重放返回原成功结果和原记录 trace，外层使用本次请求 trace。启动重放返回当前会话和固定版本 1 的原启动回执；两者不能混作原请求时的状态。
- 每次请求核对项目范围、可选预期账号/客户端、权限、到期和可见会话。数组形式的配置、请求及响应均复制，外部修改不能直接修改 store。原父会话在启动和启动回执查询时都必须可见。
- 运行按 sequence 倒序，工具按 ID 倒序，默认每页 25、最多 100；支持原 SDK 的筛选/续页及单条详情。分页反映每次读取时的当前状态，不承诺跨页快照。
- 请求正文和头分别最多 16 KiB；完整响应最多 2 MiB，或调用者声明的更低限制。保留共享解析器中的更低限制。单 store 最多 10,000 条内部记录、16 MiB 序列化账本；容量不足拒绝整个新命令，不驱逐原回执。响应解析、容量检查、取消/30 秒期限和身份到期检查均先于同步内存提交。

这里只实现 SDK transport 级模拟，没有监听 HTTP、连接数据库、执行真实鉴权或持久审计，也没有崩溃恢复。当前不提供持久数据导入、会话目录工作台查询、检查点、交接或续接；这些仍属于 P0-02 的剩余范围。完整 OpenAPI/MCP 契约消费仍属于 P0-01。
