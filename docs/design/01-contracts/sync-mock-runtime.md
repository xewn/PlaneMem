# 同步消费内存 Mock

2026-11-04 开发增量。仅源码与文档；未编译、类型检查、测试、调用 Mock、生成数据文件或发布。P0-02 的全路由覆盖与真实兼容证据仍未完成。

`@planemem/sdk` 导出 `MockSyncStore`、`MockSyncSeed`、`MockSyncSession`。既有 `MockWcpServer` 新增可选 `sync: { store, session }`；也可通过 `store.connect(session)` 取得默认含下列四个路由的 `WcpTransport`。未配置同步时，既有项目创建 Mock 行为保持。新增可选 [同步上传与原事件回执](sync-upload-mock-runtime.md)：显式 upload_sources 与 upload_access 配置后开启另两个路由，追加事件进入同一下载/确认流；配置字段和容量见该契约。

| SDK 方法 | 模拟路由 | 行为 |
| --- | --- | --- |
| `getSyncCommandContext` | `GET /v1/sync/commands/context` | 返回配置的身份、到期时间和上传权限提示；要求 `write_sync` |
| `getSyncChanges` / `syncPages` | `GET /v1/sync/changes` | 按会话可见集合分页；要求 `read_sync` 和可读项目 |
| `getSyncCursor` | `GET /v1/sync/cursor` | 返回该消费者的当前模拟确认状态 |
| `acknowledgeSync` | `POST /v1/sync/ack` | 原身份完全匹配后单调更新内存确认位点 |

## 配置与隔离

`MockSyncSeed` 必须包含 `scope`、`server_cursor`、`changes`，可含 `acknowledgements: [{identity,cursor}]`。范围只有 tenant/workspace/project 三项。事件按正的安全整数 `server_cursor` 严格升序，事件 ID 全流唯一，游标不能超过高水位；允许游标有间隙或空流具有非零高水位。每条事件复用完整同步页解析，保留全部 payload、来源及额外历史字段；只验证同步流契约，不代替各业务事件的 reducer 或真实性检查。

构造时复制完整输入；不自动排序、修复、截断、生成事件或推断上传回执。最多 10000 条事件、16 MiB 种子 JSON、1000 个已记录消费者。种子中的确认身份须属于本范围、无重复且位点不超过高水位。确认零位点也算已记录；未记录的零位点与之区分。启用上传后总流仍受10000条/16 MiB限制，原种子事件不产生上传回执。

每个 `MockSyncSession` 必须显式提供完整 `identity`、规范 UTC 毫秒 `expires_at`、三个布尔值 `read_sync/write_sync/project_readable` 和 `visible_event_ids`。集合允许为空，但不能重复或包含当前流中不存在的事件 ID，最多 10000 项；会话 JSON 最多 4 MiB。配置不从请求头猜测账号或权限，不把 `expected_identity` 当作授权凭据。过期时间允许已过去，以便开发拒绝分支；请求开始和返回前按当前时间检查。

调用 `connect` 或构造 `MockWcpServer` 时复制会话。更换身份或可见集合须显式创建新连接。相同 store 的连接共享事件和内存确认状态；不同 store 互不影响。确认键是原 tenant/workspace/project/actor/client 的 JSON 元组，避免字符串拼接碰撞；同一客户端名称下的不同账号仍相互隔离。修改种子、会话或返回结果不会修改 store。既有 `onRequest` 钩子仍在路由处理前收到调用，供开发者观察或显式改变请求，不构成隔离的安全边界。

## 下载与确认

查询只接受 `cursor` 和 `limit`，拒绝重复、未知参数和非规范非负十进制整数。limit 默认 100、范围 1–500；省略 cursor 使用原消费者已确认位点，尚未记录时为零，显式 `cursor=0` 可从头重新读取。高于流高水位返回 `CURSOR_GAP`。

先按固定会话可见集合过滤，再取 limit 加一个可见前瞻。仍有下一页时，`next_cursor` 是当前最后一条可见事件的游标；末页（包括空页）使用整个流高水位，因而可以越过不可见事件。响应保留原事件 trace，封套使用本次请求 trace；封套来源是返回事件来源的有序拼接，不去重。读取不会更新确认、保存收件箱或应用业务状态。

确认正文必须是完整 `{expected_identity,cursor}`。完整身份与配置会话完全匹配，已提供的预期身份头也必须匹配，ack 的身份头须成对；请求范围头必须等于会话范围。允许确认高水位以内的任意安全位点，不要求此前实际下载，这与 Gateway 的游标接口一致。相同位点重复成功；低于当前确认返回 `CURSOR_REGRESSION`，高于高水位返回 `CURSOR_GAP`。第 1001 个消费者返回 `RATE_LIMITED`，已有消费者仍可确认。

确认结果先完整构造、解析、复制并检查限制/取消/过期，再更新单个 Map 项；处理中没有异步让出。模拟调用失败前不写入确认。真实 Gateway 与网络仍可能出现已提交但响应未知，调用方不能将此 Mock 的顺序保证推广到网络调用。

身份读取只要求配置写权限和未过期身份，不读取项目或确认记录；因此 `project_readable=false` 时仍可读身份。其余三个消费路由要求读权限与可读项目，分别以 `DENIED` 和 `NOT_FOUND` 拒绝。未配置上传场景时，`write_sync=true` 只产生身份接口的权限提示；已配置时上传/原事件回执另要求明确 upload_access 与可读项目。

## 输入和输出限制

请求头按不区分大小写处理，拒绝重复头名；头 JSON 最多 16 KiB。trace 使用 `x-trace-id`，缺省时兼容 `traceparent`，必须是有效非空 trace。路由必须为上述精确方法/路径，不接受片段；路径最多 4096 个字符。GET 不接受正文，非 changes 路由不接受查询参数，四个路由均拒绝幂等键/版本条件。支持缺省 JSON、`json`、`bounded-json`；后者必须提供正安全整数 `max_response_bytes`，不支持 bytes。

共享契约限制完整下载响应 4 MiB、当前游标及确认响应 32 KiB、身份响应 16 KiB；调用方提供更小大小限制时取更小值。超限整页失败，事件不截断，确认不变。JSON 快照沿用 100000 节点、64 深度限制；字节限制不代表全局内存或 CPU 上限。预先取消与返回前取消返回 `GATEWAY_REQUEST_CANCELED`。同步处理没有网络等待、计时器或人为延迟，不模拟网络中途取消。

构造或连接配置无效返回固定 `MOCK_SYNC_CONFIGURATION_INVALID` 与配置 trace；请求错误使用固定文案及本次 trace（无法解析请求头时为 `trace_unknown`），不回显正文或隐藏事件。响应通过对应共享解析器完整校验并返回独立副本。SDK 自身仍执行原有请求预算和第二次响应解析。

## 开发接线示例

以下为文档示例，未执行。`seed` 和 `session` 由调用方提供，包含上述必填字段及事件可见集合。

```ts
import { MockSyncStore, MockWcpServer, WcpClient } from '@planemem/sdk';

const store = new MockSyncStore(seed);
const server = new MockWcpServer({ sync: { store, session } });
const client = new WcpClient(server, {
  ...seed.scope,
  trace_id: 'trace_sync_development',
});
const page = await client.getSyncChanges(
  { cursor: 0, limit: 25 },
  { expected_identity: session.identity },
);
// 开发场景中显式确认；该调用只改变当前 store 的内存位点。
await client.acknowledgeSync(page.data.next_cursor, {
  expected_identity: session.identity,
});
```

## 剩余范围与证据

已补可选上传、原事件回执及同流事件追加，详见独立上传契约；另已补[冲突生命周期](conflict-mock-runtime.md)五路由及同流解决历史。会话等其余 Mock 路由、真实鉴权/Policy/审计/数据库事务、权限变化主动清理、网络故障注入和持久恢复仍未模拟。显式可见集合只表达开发者配置的情景，不证明 Gateway 权限过滤正确。原项目 Mock 的历史行为及限制未扩展为真实项目创建服务。

尚无运行证据：待后续获准执行时覆盖空流与隐藏尾部、跨账号/客户端确认隔离、缺省/显式游标、重复确认和回退、过期/权限拒绝、原身份头与正文不一致、重复参数、响应/节点/深度上限、取消、外部修改隔离与 SDK 分页衔接。未修改依赖、Gateway 协议或数据库结构。
