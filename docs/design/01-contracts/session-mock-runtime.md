# 会话生命周期 Mock（TODO P0-02）

开发状态：2026-11-05 已增加实现源码，未编译、运行或测试。P0-02 的完整 WCP 覆盖和契约证据仍未完成。

`MockSessionStore` 从空项目开始，多个 `MockWcpServer` 或 `store.connect(access)` 可以共享同一份内存会话与回执。现有 `WcpClient` 可以完成普通会话启动、创建运行、记录工具调用、工具收尾、运行收尾和会话结束；读取身份、当前会话状态、运行/工具分页和详情，以及原启动/命令回执。现已继续接入检查点保存/历史/详情/原回执、交接创建/读取/领取/原回执及另一客户端续接/原回执，均为未执行的开发源码。

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

`visible_session_ids` 可设为明确的 ID 数组，或显式的 `'all'`。数组连接只读取所列会话及本连接新建会话；重新连接时需要重新声明可见范围。会话存在于同一个项目 store，不按调用者复制。读取权限与写入权限独立；原回执查询需要读取权限。`claim_handoffs` 控制领取，创建交接和续接需要 `write_sessions`；检查点和交接的可见性沿其原会话检查。

## 客户端交接示例

下面接着前面的 `client`、`store`、`identity` 配置，新开一个会话保存交接内容。示例同样没有执行。

```ts
const source = await client.startSession({}, { idempotency_key: 'example-handoff-source' });
const notes = {
  completed: ['确认当前需求'], in_progress: ['实现下一步功能'],
  next_actions: ['继续查看待办'], decisions: [], risks: [], open_questions: [],
};
const checkpoint = await client.createCheckpoint(source.data.session_id, notes, {
  idempotency_key: 'example-checkpoint', expected_version: source.data.version,
});
const handoff = await client.createHandoff(source.data.session_id, {
  checkpoint_id: checkpoint.data.checkpoint_id, target_client: 'mock-cli',
}, { idempotency_key: 'example-handoff' });

const nextIdentity = { ...identity, client_id: 'mock-cli' };
const nextClient = new WcpClient(store.connect({
  identity: nextIdentity,
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  permissions: { read_sessions: true, write_sessions: true, claim_handoffs: true },
  project_readable: true,
  visible_session_ids: [source.data.session_id],
}), { ...nextIdentity, trace_id: 'trace_mock_recipient' });

const currentHandoff = await nextClient.getHandoff(handoff.data.handoff_id);
await nextClient.claimHandoff(handoff.data.handoff_id, {
  idempotency_key: 'example-claim', expected_version: currentHandoff.data.version,
});
const resumed = await nextClient.resumeSession(source.data.session_id, {
  handoff_id: handoff.data.handoff_id, require_claimed: true,
}, { idempotency_key: 'example-resume' });
const child = await nextClient.getSessionState(resumed.data.session.session_id);
const receipt = await nextClient.getResumeReceipt(source.data.session_id, {
  request_key: 'example-resume', handoff_id: handoff.data.handoff_id, require_claimed: true,
});
```

检查点保存只增加该会话下的检查点修订号，不推进会话版本。保存同一原请求只返回原检查点，原回执查询不加载 ContextPack。历史每页最多 10 条，使用 `next_before_revision`；详情和目录明确返回 `not-checked`，不是包的当前有效性证明。历史中的 `postgres/wcp_session_checkpoints` 是共享协议所需的模拟来源字面量，不表示访问过数据库。

交接创建重放返回当前交接及版本 1 的原创建回执。领取以预期交接版本为前提，记录原领取结果；同一账号/客户端以新键重复领取当前版本时不推进版本，其他接收者被拒绝。`require_claimed: true` 要求当前已属于该账号/客户端；false 可以在续接时同时领取。Mock 按显式参数处理，不读取生产 Web Console 的客户端环境变量。

续接把领取变化、新子会话、原键及固定来源一起提交，输出/容量失败不留下半次领取。普通启动与续接共用原键空间；旧普通子会话没有续接来源时返回 `legacy-unverified`，写入拒绝接管。正常续接重放复用同一子会话，保留其当前进度；原回执只读且 `context_pack_state` 为 `not-checked`，不重复领取或加载包。

## 已保存 ContextPack

构造 store 时可传入已有 `MockContextPackStore`：`new MockSessionStore({ scope, context_packs: packStore })`。每个连接另行显式配置：

```ts
context_packs: {
  project_readable: true,
  read_context: true,
  read_restricted: false,
  visible_pack_ids: [savedPackId],
}
```

账号、客户端、项目和到期时间沿用会话连接，不能在该配置内改写。已有包 Mock 校验可见性、受限内容权限、模拟来源状态、有效期和完整 SHA-256；保存检查点和续接都加载指定包，重放写入也不绕过检查。等待包读取后重新读取当前会话、交接归属和原键；取消/超时后的迟到结果不得提交。未配置包 store 或该连接的包权限时，含 `context_pack_id` 的写入失败，不降级为无包成功。

不绑定包的续接返回 `none`；旧内联包只保存原引用/摘要，续接返回 `legacy-unverified`；已保存包经上述读取校验后返回 `checked` 和完整包。这里的来源检查仍是显式 Mock 场景，不证明真实后端来源。检查点 `state_hash` 与生产服务共用旧 32 位摘要算法，保留历史 `sha256:` 前缀，不能当作密码学 SHA-256；保存包的摘要使用其原完整算法。

## 工作台查询

同一个 store 现在同时接收 `/v1/workbench/query` 的下列只读操作。通过 `MockWcpServer({ sessions: { store, session } })` 或 `store.connect(access)` 都可访问，操作在工作项 Mock 的兜底分派前识别；其余工作台操作仍交给各自配置。

| 操作 | 现有 SDK 用法 | 读取内容 |
| --- | --- | --- |
| `sessions` | `client.listSessions(query)` | 当前可见会话，含运行/工具计数、最新检查点、父会话与续接来源 |
| `session` | transport 的显式 POST；SDK `getSessionState` 仍使用原 GET | 指定会话当前状态和写入权限提示 |
| `handoffs` | `client.listHandoffs(query)` | 当前交接、接收方、领取归属与检查点摘要 |
| `checkpoints`，不含 `session_id` | `client.listCheckpointRegistry(query)` 或 `listCheckpoints(query)` | 项目可见检查点目录和摘要 |
| `checkpoints`，含 `session_id` | `client.listCheckpoints({ session_id, before_revision })` | 指定会话的完整历史笔记，与专用 GET 共用同一投影 |

下例接前述跨客户端交接示例，仅为开发用法，未执行：

```ts
const filters = { status: 'running' as const, limit: 1 };
const firstPage = await nextClient.listSessions(filters);
if (firstPage.next_cursor) {
  const nextPage = await nextClient.listSessions({
    ...filters,
    cursor: firstPage.next_cursor,
  });
}
const claimed = await nextClient.listHandoffs({
  session_id: source.data.session_id,
  status: 'closed',
});
const checkpoints = await nextClient.listCheckpointRegistry({
  checkpoint_id: checkpoint.data.checkpoint_id,
});
const history = await nextClient.listCheckpoints({ session_id: source.data.session_id });
```

目录从当前会话账本直接读取；启动、活动写入、保存检查点、领取交接和续接后，新查询可见其更新。先按连接的 `read_sessions`、项目和会话可见范围过滤，检查点/交接不能绕过父会话可见性；项目不可读时拒绝读取。活动计数包含所有状态，最新检查点按修订号选择。交接 `closed` 筛选包含已领取或已到期，不代表重新关闭了会话；接收方匹配与“当前账号已领取”按本次身份生成。

三类目录默认每页 25、最多 100，分别按开始/更新时间/创建时间倒序、同时间 ID 升序。内部写入时间原为毫秒，目录仅补零到协议要求的六位小数。游标以 SHA-256 绑定当前 store、完整身份/期限/权限/可见集合、操作、规范筛选及页大小，跨 store、改变筛选或可见集合后须重开第一页；该摘要不是签名或授权凭据。摘要期间新增可见会话会使当前读取拒绝并要求重新开始，避免页与游标的范围不一致。每页在摘要结束后同步读取当前内存状态，跨页不保证快照，不自动去重或补页。

文本筛选对生产目录对应字段做不区分大小写的字面子串匹配，保留 `%`、`_` 等字符本义；使用 JavaScript Unicode 转小写，不宣称与数据库所有语言排序规则完全等价。交接/检查点摘要取第一条 `next_actions`，其次 `in_progress`、`completed`，空字符串仍是有效摘要；缺失为 `missing`，超过 8 KiB 返回 `too-large` 和 `null`，筛选仍使用完整原摘要。当前只有由写入产生的 `origin=session` 交接，`origin=projection` 返回空页；尚未提供旧投影或异常历史数据种子。

工作台正文最多 8 KiB、头最多 16 KiB；目录/状态完整响应最多 2 MiB，会话历史最多 8 MiB，调用者可声明更低限额。拒绝写入条件、缓存/范围/编码/长度请求头，沿 30 秒/取消和身份到期检查；每 store 最多两笔工作台读取在途，取消后待底层摘要真正结束才释放名额，第三笔返回 `RATE_LIMITED`。目录保留协议要求的 `postgres` 来源标签，仅指本地模拟投影，没有访问 PostgreSQL 或进行持久审计。

## 行为

- 五类进度命令与生产服务共用 `prepareSessionMutation` 和 `readSessionMutationReceipt`。原入口仍从 session-service 导出相同函数和类型。会话、运行、工具版本不匹配时返回原冲突错误；同终态的新请求保留原 delta-zero 规则；不同终态拒绝覆盖。会话结束不会自动结束运行或工具，已有运行/工具允许独立收尾，与原服务一致。
- 原请求键按 store、调用者、客户端、操作及会话隔离。保存有效正文的规范指纹，保留字段是否提供；路径会话 ID 纳入指纹，独立幂等键不作为业务字段。同键同文重放不推进版本，同键异文返回 `IDEMPOTENCY_KEY_REUSED`。回执查询只读，不创建记录；`not-observed` 仅表示该模拟账本未记录该键。
- 进度命令重放返回原成功结果和原记录 trace，外层使用本次请求 trace。启动重放返回当前会话和固定版本 1 的原启动回执；两者不能混作原请求时的状态。
- 每次请求核对项目范围、可选预期账号/客户端、权限、到期和可见会话。数组形式的配置、请求及响应均复制，外部修改不能直接修改 store。原父会话在启动和启动回执查询时都必须可见。
- 运行按 sequence 倒序，工具按 ID 倒序，默认每页 25、最多 100；支持原 SDK 的筛选/续页及单条详情。分页反映每次读取时的当前状态，不承诺跨页快照。
- 普通会话请求正文和头分别最多 16 KiB；检查点/交接/续接正文最多 1 MiB，头仍为 16 KiB。普通响应最多 2 MiB，连续工作响应最多 8 MiB，另受共享解析器和调用者更低限制；检查点详情最多 2 MiB，历史最多 8 MiB。单 store 最多 10,000 条内部记录、16 MiB 序列化账本；容量不足拒绝整个新命令，不驱逐原回执。响应解析、容量检查、取消/30 秒期限和身份到期检查均先于同步内存提交；提交后的等待超时仍须按原键查询结果。

这里只实现 SDK transport 级模拟，没有监听 HTTP、连接数据库、执行真实鉴权或持久审计，也没有崩溃恢复。当前不提供持久数据导入、旧交接投影/历史异常数据种子或交接到期调度；其余公开 WCP 面和运行契约证据仍需完成。完整 OpenAPI/MCP 契约消费仍属于 P0-01。
