# 保存 ContextPack Mock（源码阶段）

2026-11-04新增 `MockContextPackStore`、`MockContextPackSeed`、`MockContextPackSession`，经 `MockWcpServer({context_packs:{store,session}})` 接入 `GET /v1/context-pack` 与 SDK `getContextPack`。这是独立固定数据集，可与上下文详情/历史/目录及其他 Mock 同时配置，但不自动同步数据或核对跨数据集来源。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布；R-003未完成、`evidence: []`。

## 完整保存数据与显式场景

种子为 `{scope, packs}`，scope是tenant_id/workspace_id/project_id三个ULID。packs最多100份，整体普通JSON最多16 MiB，并受共享JSON深度/节点限制；空数组明确表示没有保存包。每项必须且只能提供：

| 字段 | 含义 |
| --- | --- |
| response | 完整json格式 `ContextPackReadEnvelope`，包含真实形状的保存包、来源、版本、ETag、游标及trace，不含rendered |
| read_restricted | 原编译权限桶的显式布尔值；即使包里没有入选restricted内容，也可以为true |
| sources_current | 模拟来源是否仍匹配保存时状态，显式布尔值；不代表已查询真实来源 |

构造时完整复制种子并逐份用共享解析器检查原scope、版本/ETag/游标、UTC毫秒时间、全部入选与排除项、预算、来源顺序等；单份封套最多2 MiB，重复pack_id拒绝。`read_restricted=false` 的包不能包含入选restricted条目；true的权限桶始终需要模拟会话的restricted读取能力，包括空包。构造时不自动计算或替换保存摘要，合法形状但摘要不匹配的种子可用于读取失败场景，读取时才以WebCrypto核对SHA-256。

不补造缺失的保存字段、历史、确认、来源清单或新包。修改原种子、会话配置或上一份响应都不会更改内部存储。包内保存trace和条目trace保留，只有响应外层trace改为当前请求trace。摘要沿共享规范内容计算，仅排除包顶层trace/hash；一致性不是来源真实性证明。

## 会话、选择与错误

会话最多64 KiB，必须提供完整五项identity、UTC毫秒expires_at、project_readable/read_context/read_restricted三个布尔值，以及最多100个不重复且存在于种子的visible_pack_ids。身份范围必须等于种子项目，actor为ULID，client为合法标识。会话复制后固定；变更模拟权限或续期需重新connect，同store的连接共用容量。请求头不能提升这些模拟权限。

每次读取检查会话期限和实际read_context，失败为DENIED；项目不可见、目标包不在可见集合或权限桶不可读时为CONTEXT_PACK_NOT_FOUND。指定pack_id精确读取；省略ID时先按可见集合与权限桶筛选，再按version降序、相同版本pack_id降序选第一份。保留版本缺口；不会使用种子输入顺序或创建时间替代版本排序。

选择后核对完整原内容与SHA-256，错误分别为CONTEXT_PACK_INVALID、CONTEXT_PACK_INTEGRITY_UNAVAILABLE、CONTEXT_PACK_HASH_MISMATCH。随后检查包的真实expires_at，再检查显式sources_current，分别返回CONTEXT_PACK_EXPIRED/STALE；返回前重查期限。latest不会先排除过期/失效包，也不回退到较旧包。sources_current只模拟来源变化结果，不遍历来源图、不访问数据库，也不跟随其他Mock存储的内容。

## 请求与完整响应

仅支持GET /v1/context-pack及其查询字符串，无正文；4 KiB路径内只接受各出现一次的pack_id/format，拒绝片段、未知键、空或非法ID/格式。缺省format为json；markdown与mcp都保留完整包并附加原协议的Markdown rendered，URI明确指向选中的具体包，即使原请求选的是latest。rendered的文本及来源来自该包完整入选内容，最终再经共享完整解析器核对。

请求头完整复制、最多16 KiB，大小写重复拒绝；项目头必须匹配原会话，可选x-expected-actor-id/x-expected-client-id逐项相等。x-trace-id或traceparent提供合法trace，同时存在须相等。拒绝请求键、写版本、缓存、Range和content-encoding等条件。没有模拟认证token解析、HTTP状态/ETag响应头或真实审计；封套中的JSON ETag仍完整校验。

默认或显式json、bounded-json可用；bounded-json必须有正安全整数max_response_bytes。完整输出最多2 MiB，调用方较小限额优先，包括rendered的重复正文；超限整份失败为GATEWAY_RESPONSE_INVALID，不截断、不自动缩小或换格式。原包json在2 MiB以内不保证加上rendered后仍能返回。

每store两笔容量及30秒本地预算，支持signal与SDK更短期限；超时/取消只结束等待，底层WebCrypto摘要真正结束才释放名额，迟到响应不交付。同步解析不能中途抢占。容量错误RATE_LIMITED，等待错误GATEWAY_REQUEST_TIMEOUT/CANCELED；内部错误转固定说明，不暴露任意原始异常。配置错误MOCK_CONTEXT_PACK_CONFIGURATION_INVALID，未配置或不支持的路径MOCK_ROUTE_NOT_FOUND；SDK可将其白名单外的Mock专用错误转为GATEWAY_UNAVAILABLE。

编译/写操作没有接入，其他Mock路由保持。该模拟返回不证明数据库事务、实时来源有效性、网络故障处理、生产权限或SQL成本。

## 未执行的接线示例

以下只展示源码用法。identity、response及sessionExpiresAt由调用者提供；response须是完整合法json封套且保存摘要正确，身份范围与包匹配，会话到期应适合所需场景。

```ts
import {
  MockContextPackStore, MockWcpServer, WcpClient,
  type ContextPackReadEnvelope,
} from '@planemem/sdk';
import { validateRequestContext, type SyncCommandIdentity } from '@planemem/contracts';

declare const identity: SyncCommandIdentity;
declare const response: ContextPackReadEnvelope;
declare const sessionExpiresAt: string;

const store = new MockContextPackStore({
  scope: response.data.pack.scope,
  packs: [{ response, read_restricted: false, sources_current: true }],
});
const transport = new MockWcpServer({
  context_packs: { store, session: {
    identity, expires_at: sessionExpiresAt,
    project_readable: true, read_context: true, read_restricted: false,
    visible_pack_ids: [response.data.pack_id],
  } },
});
const client = new WcpClient(transport, validateRequestContext({
  ...identity, trace_id: 'trace_mock_saved_pack_example',
}));
const latest = await client.getContextPack();
const rendered = await client.getContextPack({
  pack_id: response.data.pack_id, format: 'markdown',
}, { timeout_ms: 10_000 });
```

示例的read_restricted=false要求包中没有入选restricted条目。需要模拟可读restricted包时，种子与会话均显式设true。来源变化可另建sources_current=false的数据集，损坏摘要保留原错误摘要即可；不通过自动重算掩盖错误。上述示例、格式/边界、选择顺序、权限/期限、取消/容量、SDK接线及与其他Mock共存都尚无运行证据。
