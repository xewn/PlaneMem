# SDK 管理快照 Mock

2026-11-05，归属 TODO **P0-02：扩充 SDK 和 Mock Server 到完整 WCP 面**，关联 ADR-015、T0.5、R-011。`MockAdminStore`、`MockAdminSeed`、`MockAdminSession` 经 `MockWcpServer({ admin: { store, session } })` 或 `store.connect(session)` 接入原 `WcpClient.getAdminSnapshot`。仅源码文档人工审阅及格式/Git 文本检查，未编译、类型检查、测试、执行 SDK/Mock/HTTP/数据库或发布。

## 显式快照场景

种子为 `{ scope, snapshots: [{ read_restricted, data }] }`。scope 固定一个 tenant/workspace/project，全部种子有限 JSON 最多 64 KiB；snapshots 必须有 1–2 项，read_restricted 必须是不同的布尔值。同一 store 可显式提供普通读取与包含受限数据的两个场景，仅提供其中一个也可用，但另一类会话不能连接；不自动复用、更改或推算另一组计数。

data 是完整 `WorkbenchAdminSnapshot`：read_at、gateway_version、database、counts、checks。构造时复制并用共享完整 16 KiB 封套及 `{audit:true,context:true}` 约束解析，因此种子中三项计数必须全部是 available 与非负安全整数；零是有效数量，not-authorized 不能代替未提供的数据。counts 不从审计、会话、冲突或其他 Mock 实例推导，也不宣称种子数量已由真实数据核验。

read_at 必须是有效四位年份 UTC 毫秒时间，版本文本、数据库状态和全部字段沿共享严格解析；未知字段拒绝。gateway/database 版本和读取时间原样保存，每次调用不生成新的观察时间。checks 的 audit_write、identity_provider、policy_service、plane_connector、telemetry、release_readiness 必须全部是 not-checked，不能配置为健康或就绪。

## 固定身份与独立权限

连接时复制完整 16 KiB 以内会话，必须提供五字段 identity、有效 UTC 毫秒 expires_at，以及七个布尔值：authenticated_client、admin_role、read_admin、project_readable、read_audit、read_context、read_restricted。完整范围必须与 store 相同，所选 read_restricted 场景必须已存在；未知/缺失字段、非法类型、重复场景或缺少对应场景返回 MOCK_ADMIN_CONFIGURATION_INVALID。可配置已经到期的会话以模拟拒绝。

每次请求先检查取消/期限；模拟客户端未认证或会话到期返回 UNAUTHENTICATED，没有管理员角色或 admin.read 返回 DENIED，项目不可读返回 NOT_FOUND。请求必须携带匹配的项目范围头；可选 expected actor/client 仅作原身份相等约束，Authorization 或其他头不授予能力。这里的 authenticated_client 是显式开发配置，未执行真实令牌或客户端校验。

入口可读后，read_audit=false 把 audit_records 改为 `{state:'not-authorized',value:null}`；read_context=false 同时隐藏 running_sessions 和 open_conflicts。来源数组同步去掉不可读计数组的引用，再用共享 expectedAccess 对完整输出复查。有权限时保留原场景中的完整数量，不截断或把缺能力显示为零；admin.read 和管理员角色不隐含 audit/context/restricted 权限。

## 请求、输出和等待边界

仅接受精确 `POST /v1/workbench/query` 与 `{operation:'admin'}`，有限 JSON 正文最多 4 KiB。禁止额外业务字段、查询/片段、其他方法和操作。MockWcpServer 在工作项兜底前按自有 operation 数据属性识别 admin，不调用该属性的访问器；与审计、上下文和既有其他 Mock 分派并存。没有 admin 配置时沿原路由行为。

头部最多 16 KiB，大小写重复头和控制/孤立代理字符值拒绝；trace 来自 x-trace-id 或备用 traceparent，非空且最多 512 字符。幂等键、版本写条件、条件缓存、Range、内容编码、传输编码和长度头拒绝。默认 JSON/json/bounded-json 可用，bounded-json 必须显式提供正安全整数 max_response_bytes，完整返回最多 16 KiB 或调用方更小限额；不返回部分结果。

完整封套先有界复制，再进行 scope/trace/计数/来源/时间/版本/checks 解析。调用方修改原种子、会话或已返回结果不会修改内部快照。`database.state='read-succeeded'` 和 runtime/api-gateway、postgres/pg_settings、postgres/wcp_projects 及计数来源是共享协议要求的字面量；**在 Mock 中它们只表示模拟投影，不证明真实数据库读取、持久审计、服务健康或发布就绪。** 固定 read_at 不是本次请求发生时间，不能把返回成功写成当前健康探测。

头部捕获后建立 30 秒本地预算，支持 signal，在同步处理前后检查期限、取消和会话到期；同步 JSON 工作不保证中途可中断。SDK 自身预算独立生效，较长 SDK 等待不会延长 Mock 上限。本实现没有异步网络、数据库、摘要或探测任务，也不注入延迟/排队/并发名额来模拟这些行为。所有读取无状态写入、无轮询、无自动重试。

## 未执行的使用示例

```ts
import { validateRequestContext } from '@planemem/contracts';
import { MockAdminStore, MockWcpServer, WcpClient } from '@planemem/sdk';

const identity = {
  tenant_id: '01J000000000000000000000001',
  workspace_id: '01J000000000000000000000002',
  project_id: '01J000000000000000000000003',
  actor_id: '01J000000000000000000000004',
  client_id: 'editor',
};
const store = new MockAdminStore({
  scope: {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  },
  snapshots: [{
    read_restricted: false,
    data: {
      read_at: '2026-11-05T00:00:00.000Z',
      gateway_version: 'mock-gateway',
      database: { state: 'read-succeeded', version: 'mock-database' },
      counts: {
        audit_records: { state: 'available', value: 12 },
        running_sessions: { state: 'available', value: 2 },
        open_conflicts: { state: 'available', value: 0 },
      },
      checks: {
        audit_write: 'not-checked', identity_provider: 'not-checked',
        policy_service: 'not-checked', plane_connector: 'not-checked',
        telemetry: 'not-checked', release_readiness: 'not-checked',
      },
    },
  }],
});
const transport = new MockWcpServer({
  admin: {
    store,
    session: {
      identity,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      authenticated_client: true,
      admin_role: true,
      read_admin: true,
      project_readable: true,
      read_audit: false,
      read_context: true,
      read_restricted: false,
    },
  },
});
const client = new WcpClient(transport, validateRequestContext({
  ...identity, trace_id: 'trace_mock_admin_read',
}));
const page = await client.getAdminSnapshot();
// audit_records 为 not-authorized/null；两个 context 计数使用种子场景的 2 和 0。
// page.data.read_at 保持种子时间，外部检查全为 not-checked。
```

以上只描述源码预期，没有运行结果。新增范围仅覆盖 P0-02 的管理快照 Mock 入口；完整 WCP 接口覆盖、fixture 兼容、真实认证/Policy/SQL/HTTP、动态变化/故障注入与运行证据仍未齐，P0-02 和 R-011 不因此标记完成。
