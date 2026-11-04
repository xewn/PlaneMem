# 保存 ContextPack Mock（源码阶段）

2026-11-05新增[原保存请求历史回执](#原保存请求历史回执2026-11-05源码增量)：显式compilations场景接入只读POST /v1/context-pack/save-receipt和SDK查询，pending/未知键仅未观察到，saved/已激活返回历史标量，不重新保存或核验当前内容。仅源码文档，未编译、类型检查、测试、执行Mock/SDK/API或发布。

2026-11-05新增GET /v1/context-pack/save-context及SDK getContextPackSaveContext接线，沿原显式会话返回完整身份/期限/compile和read_restricted提示；无需compilations、项目可读或可见包，不读取/摘要核验/激活任何包。完整16 KiB或调用方更小限额、原身份条件及过期检查，沿30秒/signal但不占读包或保存槽。仅源码文档，未执行Mock/SDK/API、编译、类型检查、测试或发布。协议及限制见[保存前可信身份读取](context-pack-runtime.md#保存前可信身份读取2026-11-05源码增量)。

2026-11-05新增[显式保存与重放](#显式保存与重放2026-11-05源码增量)：可选compilations把预置完整包绑定到原请求，pending包在提交核验后激活，读取与目录共享状态。仅源码文档，未执行Mock/SDK、保存请求、编译、类型检查、测试或发布。

2026-11-05新增[保存包元数据目录](#保存包元数据目录2026-11-05源码增量)：同一store和会话提供GET /v1/context-packs，接入SDK listContextPacks/contextPackPages，不新增配置字段。列表只使用预先提取的六字段元数据，来源变化/过期记录仍可出现；仅源码文档，未执行Mock/SDK、编译、类型检查、测试或发布。

2026-11-04新增 `MockContextPackStore`、`MockContextPackSeed`、`MockContextPackSession`，经 `MockWcpServer({context_packs:{store,session}})` 接入 `GET /v1/context-pack` 与 SDK `getContextPack`。这是独立固定数据集，可与上下文详情/历史/目录及其他 Mock 同时配置，但不自动同步数据或核对跨数据集来源。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布；R-003未完成、`evidence: []`。

## 完整保存数据与显式场景

基础种子为 `{scope, packs}`，另可提供下文的compilations。scope是tenant_id/workspace_id/project_id三个ULID。packs最多100份，含可选场景的整体普通JSON最多16 MiB，并受共享JSON深度/节点限制；空数组明确表示没有保存包。每项必须且只能提供：

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

完整包读取使用GET /v1/context-pack及其查询字符串，无正文；4 KiB路径内只接受各出现一次的pack_id/format，拒绝片段、未知键、空或非法ID/格式。缺省format为json；markdown与mcp都保留完整包并附加原协议的Markdown rendered，URI明确指向选中的具体包，即使原请求选的是latest。rendered的文本及来源来自该包完整入选内容，最终再经共享完整解析器核对。新增复数路径GET /v1/context-packs返回元数据目录，见下文。

请求头完整复制、最多16 KiB，大小写重复拒绝；项目头必须匹配原会话，可选x-expected-actor-id/x-expected-client-id逐项相等。x-trace-id或traceparent提供合法trace，同时存在须相等。拒绝请求键、写版本、缓存、Range和content-encoding等条件。没有模拟认证token解析、HTTP状态/ETag响应头或真实审计；封套中的JSON ETag仍完整校验。

默认或显式json、bounded-json可用；bounded-json必须有正安全整数max_response_bytes。完整输出最多2 MiB，调用方较小限额优先，包括rendered的重复正文；超限整份失败为GATEWAY_RESPONSE_INVALID，不截断、不自动缩小或换格式。原包json在2 MiB以内不保证加上rendered后仍能返回。

每store两笔容量及30秒本地预算，支持signal与SDK更短期限；超时/取消只结束等待，底层WebCrypto摘要真正结束才释放名额，迟到响应不交付。同步解析不能中途抢占。容量错误RATE_LIMITED，等待错误GATEWAY_REQUEST_TIMEOUT/CANCELED；内部错误转固定说明，不暴露任意原始异常。配置错误MOCK_CONTEXT_PACK_CONFIGURATION_INVALID，未配置或不支持的路径MOCK_ROUTE_NOT_FOUND；SDK可将其白名单外的Mock专用错误转为GATEWAY_UNAVAILABLE。

未提供compilations时保存路由仍未启用，其他Mock路由保持。显式保存场景见下文；该模拟返回不证明数据库事务、实时来源有效性、网络故障处理、生产权限或SQL成本。

## 保存包元数据目录（2026-11-05，源码增量）

同一`MockContextPackStore`通过既有`MockWcpServer`的context_packs配置处理GET /v1/context-packs；SDK `listContextPacks`和`contextPackPages`使用该完整目录，不回退到来源条目目录或读取latest。种子与会话字段保持，最多100包、整体16 MiB及会话64 KiB边界保持，不新建/编辑包。

构造时在完整种子结构校验之后，把pack_id/version/created_at/expires_at/budget_tokens/used_tokens及内部read_restricted复制到独立目录数组。六字段按共享2 KiB记录规则验证；不新增或猜测字段，也不重算保存摘要。列表阶段仅处理这个数组，不再遍历包正文、排除项、hash、来源或sources_current。合法形状但保存摘要错误、包过期或模拟sources_current=false，均仍可在权限允许的目录中出现；另行getContextPack才执行原完整内容检查并可能失败。

- 路径最多4 KiB，仅单值pack_id/limit/cursor；limit为无前导零的正整数文本、默认25、最大100，精确pack_id须ULID。未知/重复参数、片段、format/latest或写字段为INVALID_INPUT。无正文；沿原头部16 KiB/大小写重复/trace/项目/可选身份相等检查，禁止写/缓存/Range/content-encoding；目录还拒绝transfer-encoding及非零content-length。
- 每次先检查原模拟会话到期和read_context，失败DENIED；project_readable=false为CONTEXT_PACK_NOT_FOUND。先按visible_pack_ids及read_restricted过滤，再按版本降序、相同版本ULID的ASCII顺序降序取limit+1；精确ID不在当前可见集合时返回空页，权限过滤无隐藏总数。next_cursor仅在多取一条时存在，不自动翻页。
- 游标沿共享规范base64url位置格式，绑定摘要输入最多64 KiB，包含Mock专用域、每store随机ID、五项固定identity、项目/读取/restricted布尔权限、排序后的完整可见集合、limit与精确pack_id。身份/权限/集合/条件或store改变即INVALID_INPUT；可见ID配置重排不改变绑定。会话expires_at不进入绑定，同store按相同场景重新connect续期可继续，但每次仍检查新会话期限。游标不是签名或授权，不能在生产目录、其他store或其他Mock目录之间复用；本Mock无角色模型，仅使用这些显式权限布尔值。
- WebCrypto SHA-256只计算上述游标绑定，不使用包hash或内容。不可用、异常或非32字节摘要返回CONTEXT_PACK_INVALID，不伪造游标；即使空数据页也需要绑定计算。完整JSON响应限256 KiB，遵守调用方更小正安全整数max_response_bytes；json/bounded-json沿原协议，后者必须显式限额。共享封套解析器核对原scope/query/trace、固定目录来源标记、metadata-only/not-checked、记录/顺序/唯一性/续页，结果完全复制，不暴露内部数组。source_refs的context-pack-directory标记仅符合协议，不代表真实SQL读取。
- 目录与完整包读取共享每store两容量/30秒本地预算及signal，不另增容量池。目录绑定摘要直接等待实际Promise完成，SDK或外层超时后仍占槽，底层结束才释放；取消/超时不交付迟到页面，返回前再检查会话和预算。容量/取消/超时沿RATE_LIMITED、GATEWAY_REQUEST_CANCELED/TIMEOUT；超限为GATEWAY_RESPONSE_INVALID，结构或内部错误为CONTEXT_PACK_INVALID。同步筛选/解析只能阶段性检查期限，不能中途抢占。

数据集固定，无法覆盖生产并发变更、实时来源图、SQL成本、HTTP状态/响应头或真实授权审计。目录游标边界与生产共享，绑定内容有意隔离；没有把Mock游标当作跨系统凭据或生产快照。下方示例沿既有client，仅展示接线，未执行：

```ts
const firstPage = await client.listContextPacks({ limit: 1 });
if (firstPage.next_cursor) {
  const nextPage = await client.listContextPacks({
    ...firstPage.query,
    cursor: firstPage.next_cursor,
  });
}
for await (const page of client.contextPackPages({ limit: 10 }, { max_pages: 10 })) {
  // Consume each complete metadata page; open selected IDs separately.
}
```

R-003未完成、`evidence: []`。SDK单页/迭代/其他Mock共存、排序与精确空页、权限桶/可见集合、会话续期与store隔离、错误hash/过期/来源变化只在完整读失败、较小限额及摘要取消后容量保留仍缺运行证据。本轮仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行Mock/SDK/产品/API/数据库或发布；无新种子/会话字段、生产接口、依赖或迁移。

## 显式保存与重放（2026-11-05源码增量）

`MockContextPackSeed.compilations`为可选数组，最多100项；根导出`MockContextPackCompilation`。不提供该字段时，原只读种子/会话/读取及目录行为保持，POST保存返回MOCK_ROUTE_NOT_FOUND。提供空数组表示已启用但没有任何可匹配保存场景。整个种子含场景仍限16 MiB，包总数仍最多100，不因保存增加新对象或扩大容量。

每项必须且只能包含以下字段：

| 字段 | 约束 |
| --- | --- |
| actor_id | 原账号ULID，项目范围沿store.scope |
| client_id | 原客户端合法标识，与模拟会话逐字相等 |
| idempotency_key | 原键1–255 UTF-16单元，拒绝空白/C0/DEL/孤立代理项；不trim、不生成 |
| parameters | 显式budget_tokens/ttl_seconds，沿共享128–32768/60–86400整数边界，两项都必须提供 |
| pack_id | 指向packs中已提供的完整json结果；一个包只能绑定一个场景 |
| initial_state | 必须为pending或saved；描述初始状态，激活后不改写配置字段 |

同一actor/client/key三元组只能有一项，使用JSON元组作内部索引，避免分隔符碰撞；每store固定项目范围自然隔离不同项目。构造时复制全部配置，核对包预算等于场景预算、保存到到期时长不超过原TTL，以及完整封套结构。摘要仍在请求阶段核验，构造时不会重算或替换，所以形状正确但摘要损坏的包仍可明确模拟失败。没有增设会话字段；原visible_pack_ids必须包含将要提交的目标ID，它表示可访问的候选集合，不代表所有候选都已保存。

pending包在指定读取、latest选择和目录中都隐藏；saved或未绑定场景的种子包保持原可见行为。成功激活只移除该包的pending状态，同store所有现有和重新connect的会话都看到同一保存状态，但各自的身份、期限、项目、visible_pack_ids及restricted过滤仍然生效。目录继续只读预先提取的六字段元数据，不为激活重新读取正文或来源。保存时不改写ID、版本、游标、created_at、expires_at、包内trace、hash或内容；调用方应提供所需顺序和有效时间的完整场景，不能用该模拟证明生产版本分配或时间行为。

保存接线经既有MockWcpServer的context_packs配置及路径识别，入口严格为POST /v1/context-pack/compile，不接受查询或片段。头部沿16 KiB复制、大小写重复拒绝、trace/三范围/可选原身份相等检查；必须有application/json（允许UTF-8 charset）及原idempotency-key。拒绝写版本/缓存/Range/content-encoding和传输层content-length/transfer-encoding；这里的传输正文是对象，SDK不会自行添加传输层长度。正文只接受共享4 KiB普通JSON budget_tokens/ttl_seconds，缺省值规范为4096/3600；正文键、身份覆盖或其他字段均拒绝。返回沿json/bounded-json，后者仍需显式正安全整数max_response_bytes。

先检查未过期模拟会话、read_context、项目可读，再按真实模拟会话的actor/client和原键查找场景，不能通过请求头改换身份。未匹配为MOCK_CONTEXT_PACK_SCENARIO_NOT_FOUND，不猜测最接近场景、不自动生成包或换键。目标不在visible_pack_ids时为CONTEXT_PACK_NOT_FOUND；规范预算/TTL或原包read_restricted桶与当前会话不同，返回IDEMPOTENCY_KEY_REUSED，包括获得或失去restricted权限。即使pending尚未激活，也必须遵守预先声明的场景参数；这是固定场景约束，不是声称生产已记录该请求。

匹配后复用完整2 MiB封套与canonical WebCrypto SHA-256读取核验，检查原范围/版本/ETag/来源/用量/预算、真实expires_at及显式sources_current，并再次按场景预算/最大TTL核对。只有全部通过且当前会话/预算仍有效，才同步激活该包。并发相同请求核验同一不可变结果、激活同一ID，不会创建两个包；重放仍检查权限、摘要、到期和来源状态，外层trace替换为当前请求trace，包内保存trace和时间保持。pending失败不自动生成替代结果；该sources_current开关不模拟首次编译时的真实来源筛选图。

激活后才检查调用方更小的响应字节限额并交付独立完整封套，超限为GATEWAY_RESPONSE_INVALID；这类返回失败以及之后的取消/期限或会话错误不会回滚已保存状态。同键显式重试或后续读取可以恢复原包，不能因错误换键推断原保存失败。直接Mock传输只给固定错误，SDK compileContextPack继续给派发后unknown诊断；MOCK_ROUTE_NOT_FOUND、MOCK_CONTEXT_PACK_SCENARIO_NOT_FOUND等SDK白名单外错误会转为GATEWAY_UNAVAILABLE，仍不清除unknown。

每store保存独立两笔容量，与原读取/目录共用的两笔容量分开；一个保存占槽直到底层摘要实际完成，即使30秒本地预算或外部signal先结束等待也不提前释放。摘要完成后检查取消/期限再激活，迟到结果不交付；停止等待不是生产服务器撤销保证。同步解析只能阶段性检查期限。相同store续期可重放原场景；进程退出或重建store会失去激活状态，除非调用者另提供saved初始场景，不提供磁盘恢复或自动持久化。

目录游标仍绑定store、身份、权限、可见候选集合与查询，不绑定pending状态。跨页期间激活新包可能改变结果，游标页不是快照；若需要查看所有新保存包，应显式从第一页重新查询。只读场景的数据仍固定。本增量不提供真实编译器、动态来源、数据库事务、审计、HTTP响应头/状态、认证token解析或任意新请求的自动结果。

以下示例仅展示源码接线，未执行。调用方须提供合法且适合当前时间的完整response、相等scope/identity、有效会话到期，以及与response预算/有效期一致的parameters；read_restricted=false要求包不含入选restricted内容。

```ts
import {
  MockContextPackStore, MockWcpServer, WcpClient,
  type ContextPackReadEnvelope, type ContextPackCompileParameters,
} from '@planemem/sdk';
import { validateRequestContext, type SyncCommandIdentity } from '@planemem/contracts';

declare const identity: SyncCommandIdentity;
declare const response: ContextPackReadEnvelope;
declare const parameters: ContextPackCompileParameters;
declare const sessionExpiresAt: string;
const originalKey = 'explicit-mock-save-1';
const store = new MockContextPackStore({
  scope: response.data.pack.scope,
  packs: [{ response, read_restricted: false, sources_current: true }],
  compilations: [{
    actor_id: identity.actor_id, client_id: identity.client_id,
    idempotency_key: originalKey, parameters,
    pack_id: response.data.pack_id, initial_state: 'pending',
  }],
});
const transport = new MockWcpServer({ context_packs: { store, session: {
  identity, expires_at: sessionExpiresAt,
  project_readable: true, read_context: true, read_restricted: false,
  visible_pack_ids: [response.data.pack_id],
} } });
const client = new WcpClient(transport, validateRequestContext({
  ...identity, trace_id: 'trace_mock_save_example',
}));
const before = await client.listContextPacks(); // pending fixture is hidden
const saved = await client.compileContextPack(parameters, { idempotency_key: originalKey });
const replay = await client.compileContextPack(parameters, { idempotency_key: originalKey });
const read = await client.getContextPack({ pack_id: saved.data.pack_id });
const after = await client.listContextPacks(); // activated fixture is now visible
```

R-003未完成、evidence为空。旧配置兼容、首次激活/重放、跨连接可见性、并发/取消/容量、摘要/到期/来源失败、响应超限后的恢复、目录跨页变化及SDK实际接线仍待运行证据。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行校验器/Mock/SDK/API/保存请求、数据库或发布；无生产接口、共享契约、依赖或迁移变化。

## 原保存请求历史回执（2026-11-05源码增量）

MockContextPackStore直接connect和MockWcpServer的原context_packs配置均接入POST /v1/context-pack/save-receipt，SDK getContextPackSaveReceipt沿相同共享格式调用。必须显式提供compilations；空数组表示已配置但没有原命令历史，省略则仍为MOCK_ROUTE_NOT_FOUND，不把尚未配置的模拟能力当作查询成功。未绑定compilations的普通可读种子包不自动生成原命令回执；不增加种子/会话字段，16 MiB数据集和100项限制保持。

请求路径必须精确且无查询/片段，正文沿共享4 KiB严格原查询，含完整五字段identity、精确read_restricted、原request_key和明确budget_tokens/ttl_seconds。沿原16 KiB头复制、大小写重复拒绝、trace优先级/一致性和三范围/可选身份检查，回执trace另拒绝DEL；要求JSON类型，拒绝idempotency-key、版本/缓存/Range/编码及传输层长度头。Mock接收对象正文，因此content-length/transfer-encoding均不接受，这不等于生产HTTP收包规则。response_type仅json/bounded-json，bounded-json需正安全整数max_response_bytes，最终同时受16 KiB和调用方较小限额约束。

先要求会话未过期、实际read_context及项目可读，原查询五字段身份和restricted必须精确匹配当前配置会话；参数不能改换身份或权限。按actor/client/key查找固定项目下的场景，读取行为如下：

| 记录状态 | 查询结果 |
| --- | --- |
| compilations未提供 | 路由未配置，不产生观察回执 |
| 已配置但无对应原键 | not-observed，空source_refs |
| 对应场景仍pending | not-observed，不预留键或激活包 |
| 初始saved或提交后已激活 | 检查可见ID、原预算/TTL与保存权限桶后返回recorded |
| 已保存但目标不在可见集合 | CONTEXT_PACK_NOT_FOUND |
| 已保存但原参数或保存权限桶与查询不同 | IDEMPOTENCY_KEY_REUSED |
| 查询身份或权限桶与当前会话不同 | DENIED |

pending场景的预置参数只约束将来的模拟保存，不属于已记录命令，所以回执查询不会对其返回参数冲突。not-observed仅表示这次内存状态中没有记录，不能证明生产保存失败，也不会授权或执行重发。当前查询与另一个保存的激活可能先后发生，没有等待进行中的保存、自动重查或原键替换。

构造时从完整已解析种子中额外提取包ID/版本/时间/预算用量/hash/server_cursor等独立历史标量。回执查询只读这些标量、原场景和pending状态，不访问正文、渲染、计算WebCrypto摘要或检查sources_current，也不因包已过期而拒绝历史；输出content_state/source_state均为not-checked，source_refs仅标识对应包和历史版本。元数据自身仍必须通过共享完整回执解析器，参数/TTL/原查询回显/trace/来源引用相互核对。形状合法但内容摘要不正确的saved场景仍可返回历史元数据；它不意味着当前完整包读取会成功。

回执查询不改变pending、目录、场景参数、包版本/时间/游标或任何保存状态，也不调用compile路径。显式保存已激活但响应因调用方限额等原因失败时，后续原请求回执仍可返回recorded；读取失败不会回滚激活。返回封套由共享解析器独立复制，调用方修改结果不改变store。进程退出/重建store仍不保留激活状态，历史范围限显式模拟内存，无真实数据库、认证/审计或HTTP响应头/状态保证。

每store回执查询独立两笔容量，与读包/目录和保存容量分开，沿30秒本地预算与外部signal；请求阶段及交付前再次检查取消/会话到期，底层读取返回后释放槽。标量读取是同步有界工作，只能阶段性检查期限，SDK外层更小期限仍可先结束等待。完整响应超限为GATEWAY_RESPONSE_INVALID，历史元数据不合法为CONTEXT_PACK_RECEIPT_INVALID；其余沿既有固定错误，不泄漏种子正文。Mock专用未配置错误经过SDK可能映射为GATEWAY_UNAVAILABLE。

在前述保存示例中，可构造`{ identity, read_restricted: false, request_key: originalKey, parameters }`并显式调用`client.getContextPackSaveReceipt(query)`：pending时观察not-observed，成功激活后观察recorded。此处仅说明源码用法，没有执行示例或Mock。

R-003未完成、evidence为空。直接/路由/SDK接线、空/省略配置、pending与已激活/初始saved、原身份/权限/参数/可见性拒绝、旧种子兼容、响应限额/取消/容量及保存返回失败后的历史观察均缺运行证据。嵌入CLI在线回执、独立Schema/OpenAPI与真实客户端兼容待补。本轮仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行Mock/SDK/API/产品/数据库或发布；无生产接口、共享契约、其他客户端、依赖或迁移变化。

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
