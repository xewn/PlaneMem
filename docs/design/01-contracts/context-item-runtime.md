# ContextItem 录入与编辑开发说明

## 2026-11-04 SDK历史读取与双版本对比增量

现有listContextItemHistory(itemId, query?, options?)与getContextItemVersion(itemId, version, options?)改用专用历史读取器，成功仍返回完整WcpEnvelope。新增可选WcpContextHistoryReadOptions.timeout_ms/signal；默认30秒本地等待预算，允许1–2147483647毫秒。查询和选项必须普通已知平面字段，拒绝访问器/符号/额外字段，合法可选undefined省略；item与版本规则复用共享历史查询，默认limit=25、最多100。异步前固定查询、project范围及已有actor/client约束；不发送构造上下文中的写入键、expected_version或If-Match。

目录成功响应上限256KiB、版本2MiB，transport采用bounded-json并传入取消信号；默认Fetch传输继续限制错误16KiB，处理HTTP状态/trace/媒体类型/UTF-8/Content-Length。SDK对任何传输返回再次通过共享解析复制完整有界JSON，核对条目、版本、分页、来源、快照范围及历史确认。SDK业务层拿不到自定义传输的HTTP头，不声称独立验证其网络身份或头部；自定义传输必须按WcpTransport约定自行鉴权、处理错误和bounded-json。已有Fetch传输自身的timeout_ms仍可更早终止读取。

版本读取要求WebCrypto SHA-256能力；缺失时在发请求前返回CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE，摘要服务失败也用该固定错误，摘要不一致返回CONTEXT_HISTORY_HASH_MISMATCH。正文经过独立复制后才异步计算{item,archived_at}规范JSON摘要，摘要等待同样可被原预算/取消终止；没有能力时不降级返回未核对快照。目录只核对保存摘要的格式，不替代单版正文读取。已取消或超时优先于随后到达的读取/解析结果；错误不透传上游任意message/details，不自动重试。

新增compareContextItemVersions({item_id,from_version,to_version}, options?)，两个版本必须为不同的正安全整数，查询最多4KiB，方向不自动排序。构造上下文必须有完整tenant/workspace/project ULID、actor ULID及非空本地client ID；两次GET均带相同scope和expected actor/client相等条件，由真实Gateway比对已验证身份。凭据提供器可以刷新令牌，但不能因此混用不同账号/客户端结果。两份版本顺序读取，在同一个默认30秒总预算内完成传输、解析、摘要及本地比较；首读失败不发第二读，任一失败不返回部分组合。

返回WcpContextComparisonResult为SDK本地组合，不是新的Gateway封套：schema_version=1、kind=context-version-comparison、comparison_origin=local、read_consistency=separate-reads、content_state=snapshot-hashes-checked、source_state=not-checked，并含原query、identity_constraints、from/to完整读取封套和comparison。保留请求trace和比较方向；两次读取可以使用相同调用trace。摘要相符只说明快照自洽，不是来源真实性、当前确认、当前可用性或跨请求一致性快照证明。

Web比较模型提取到contracts/context-comparison，由Web和SDK共用十项属性、九项记录信息及完整正文/来源/确认比较规则。新增parseContextRevision供独立结构解析；导出的compareContextSnapshots也先复制并核对两份完整结构、同范围/同条目和不同版本，再比较普通JSON。直接调用该纯函数不执行网络、摘要算法或鉴权，不应将结果当作已验证读取。

以下仅为未执行的调用示例，client须已配置真实传输和完整项目/账号/客户端上下文：

```ts
const history = await client.listContextItemHistory(itemId, { limit: 25 }, { timeout_ms: 30_000 });
const snapshot = await client.getContextItemVersion(itemId, 3, { signal });
const comparison = await client.compareContextItemVersions(
  { item_id: itemId, from_version: 2, to_version: 3 },
  { timeout_ms: 30_000, signal },
);
```

兼容变化：原参数调用继续可用，但现在需要完整项目范围、合法本地trace/client、能提供完整匹配响应及支持bounded-json/signal的传输；非法未知字段不再忽略，失败统一为Promise拒绝。单版/比较需要WebCrypto。没有扩展Mock历史存储，CLI/MCP原通用历史入口也尚未改接此SDK读取器。无新Gateway路由/schema、数据库/迁移、依赖或写入行为。本次仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、运行SDK/Mock/CLI/MCP/API/数据库或发布；自定义传输、凭据切换、取消/期限、摘要和真实数据兼容仍待运行证据，R-003未完成、evidence为空。

## 2026-11-04 网页历史版本对比增量

/context/history/compare提供同一条目两个明确历史版本的只读对比。历史页有至少两条记录时可从本页实际版本下拉选择；单版本详情的Compare this version预填基准，另一个版本可手动输入，允许跨历史页选择。未选择完整两边时不读取快照，不自动选最新。完整选择要求两个不同正安全整数并保持用户方向；选同一版会保留表单供修正、拒绝发送读取。

导航仅接受item/from/to/before/version/return_to的单值已知参数。before/version记录原历史位置，return_to复用既有同条目/context返回校验，继续保留原筛选、游标、包、归档视图和有效搜索返回链。进入比较时固定原来实际选中的历史版本；Back to history回该位置，单版详情链接保留分页/浏览返回信息，反向比较只交换from/to。重复/未知/非法参数不生成读取；失败页可提交原参数GET重试，或在原表单修改版本。

完整查询先复制为4KiB以内普通JSON，之后捕获一次登录令牌、到期时间、项目范围及Gateway地址。两次指定版本GET顺序读取，共用30秒总期限及取消信号；每次沿用完整历史响应校验、2MiB解码成功/16KiB错误上限及快照SHA-256核对。读取前后、错误路径及比较完成复核会话到期和总期限；首读失败不发送第二读，任何失败不返回部分比较、不自动重试。两份历史仍是分别授权读取，不宣称数据库一致快照或长期可读权限。

比较模型仅接收读取器已经完整校验和核对摘要的快照，复制为有界普通JSON，并再次检查同条目/tenant/workspace/project及不同版本。页面分别展示十项内容属性（标题、类型、层级、分类、状态、优先级、置信度、到期时间、来源标签、归档时间）、完整正文、完整来源列表、历史确认记录；另列操作、记录时间、作者、客户端、事件、摘要及条目创建/修改时间、保存trace。内容属性变化计数不混入记录时间/摘要变化。

正文按普通JSON结构比较，对象键顺序不影响相等，数组顺序与重复保留，文字空白不归一化；缺省、null和空文本不合并。所有正文/来源/确认内容完整按文本展示，不执行HTML或打开来源地址，也不截断后宣称相同。长值在可键盘聚焦的区域滚动，窄屏使用上下排列；此为完整值并排比较，不提供行内补丁、恢复或来源可用性检查。历史确认不改变当前状态。

范围仅Web导航/历史/比较页面与表单模型、专用读取服务及样式和文档，没有新Gateway路由、共享协议、数据库/迁移、依赖或写入动作。只做源码文档人工审阅和格式文本检查，未编译、类型检查、测试、浏览器渲染、运行产品/API/数据库或发布。双版本方向/跨页返回、权限变化/过期/总期限、JSON/大正文/来源顺序及键盘窄屏呈现仍待运行证据；R-003未完成、evidence为空。

## 2026-11-04 网页历史完整读取增量

共享context-history提供历史读取查询及完整响应解析。查询先复制为最多4KiB的普通JSON，只接受已知字段，kind=history/version；item_id沿用本地ID规则，版本和before_version为正安全整数，limit默认25、范围1–100。Web历史目录固定25条，网络等待前保存查询，非法输入不会读取会话或发送请求。

目录返回必须绑定同一item_id，current_version为正安全整数，current_archived为布尔值；versions不超过请求limit，版本严格倒序、不重复、不大于current_version且小于before_version。若包含当前版本，其归档标记须与current_archived一致。next_before_version存在时必须对应满页最后一条且大于1，不根据短页补造游标。缺失历史和基线仍允许，不要求版本连续，也不将目录当成跨请求一致性快照。既有目录没有scope回显，客户端不能凭空证明它的租户范围，权限与范围查询仍依赖Gateway。

版本快照核对请求item_id/version及tenant/workspace/project范围，检查完整文档与摘要的title/classification/status/version一致，保留普通JSON正文。元数据要求合法枚举、有限confidence、保存的规范UTC时间及归档标记一致；baseline的actor/client/event均为null，其余操作需明确作者、客户端和事件。create/update/archive/restore/confirm检查对应状态，confirm另核对前一版本、确认版本、作者/客户端/事件/记录时间和规范理由；其他操作不能携带确认对象。合法旧JSON正文、空来源数组和无作者baseline不补造信息。外层来源必须精确对应本条目，版本响应还须按序匹配完整快照来源。

Web历史读取使用单独响应处理：目录成功最多256KiB、版本成功最多2MiB、错误最多16KiB（均为解码字节），结构复制另限制规范JSON字节、深度64和节点100000。响应须HTTP200或4xx/5xx、匹配请求trace、无ETag、合法JSON媒体类型、完整UTF-8及适用时匹配Content-Length；复用有界流读取，拒绝截断及超限，不裁剪内容。读取/解析/校验/摘要计算共用fetch开始时的30秒截止，不延长等待。错误正文仅提供经过验证的错误码，展示固定本地信息，不显示上游任意错误正文；401或读取前后会话过期要求重新登录。

版本通过结构校验后，将{item, archived_at}递归按对象键排序，保持数组顺序，按与Gateway fingerprint一致的JSON规则计算SHA-256，并与snapshot_hash核对。摘要只检查返回快照自洽，不是签名或外部来源真实性证明；历史确认不会成为当前确认权限或当前来源有效性的证明。失败沿用页面原版本/原页重试，不自动切换版本、部分显示或自动重试。

本次仅接入Web历史目录/版本读取及共享契约；当前正文、上下文主目录、已保存包、SDK/CLI/MCP、Gateway和数据库没有变化。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行页面/API/SQL/数据库或发布。边界、真实数据兼容、流截断、摘要、时限/会话过期及浏览器错误恢复仍无运行证据，R-003保持未完成、evidence为空。

## 2026-11-04 上下文浏览与历史返回增量

Web context/navigation统一主页面及历史导航。主页面只接受q/layer/classification/status/type/view/cursor/item/pack/return_to的单值已知字段，筛选复用parseContextItemListQuery和固定25条页大小；view仅active/archived（省略active），拒绝未知枚举、数组、重复字段、超长文本或非法游标，不再截断文本或忽略无效筛选。item沿既有历史ID规则，拒绝空白、控制字符和点路径；pack必须ULID。原搜索返回仍只允许item/return_to，绑定已验证搜索页的context_item及同一ID。

主页面目录失败时提供原参数GET重试及保留原筛选/归档视图/指定包的第一页入口；回第一页清除旧游标及选择。选中条目读取失败时显式重试固定原ID及当前浏览条件，不替换成另一条目；查找相反归档视图清除旧游标、保留其余筛选和包，继续独立读取相同ID。清除筛选保留归档视图及指定包。筛选输入标明500字符上限，非法参数仅显示固定重新浏览入口，不能构造读取或重试目标。

版本历史接受item/before/version/return_to，要求单值已知字段，before/version为正安全整数。主页面历史入口保存完整原筛选、游标、归档视图、指定包、明确选择以及可用的搜索返回链。return_to最多16384个JavaScript字符单位，只能是字面/context或/context?已知参数，不接受其他路径/外部地址/片段/重复字段；选择存在时必须与历史item相同，省略则补同一item。所有地址从固定内部路径和URLSearchParams重建，不自动跳转、不携带条目正文或权限。

历史翻页、查看指定版本和版本链接保留原返回地址；版本链接也保留当前历史分页位置。目录失败可GET重试原item/before/version/return_to，或回到该条目的最新历史；单版本失败固定实际尝试的版本重读，不因下一次目录变化改查另一版。成功/失败页面都有原结果返回入口；独立旧历史URL不要求return_to，继续可用。Open current item根据本次历史目录报告的current_archived构造独立当前读取入口，Back to results则保留原视图，不宣称原视图仍可读。原搜索返回链先回原上下文选择，再由既有Back to search results返回搜索位置。

导航只提供读取定位，访问权限仍由Gateway逐次核验，原游标因权限/范围变化可能被拒绝。历史/正文读取本身的预算及完整响应校验属于其他工作，不因导航校验获得运行保证。本任务不改写表单、命令身份/版本/键、Gateway/共享契约/数据库/依赖；仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、浏览器渲染、执行页面/API/数据库或发布。参数边界、搜索嵌套返回、版本失败重试、真实权限和浏览器证据待补，R-003仍未完成、evidence为空。

更新：2026-11-01。本文记录代码实现；未执行编译、类型检查、测试、数据库迁移、部署或发布。

## 入口

| 方法 | 路径 | 能力 | 结果 |
| --- | --- | --- | --- |
| POST | `/v1/context-items` | `context.write` | 新建 proposed 条目的命令回执 |
| GET | `/v1/context-items/{item_id}` | `context.read` | 当前完整条目 |
| GET | `/v1/context-items/{item_id}/archived` | `context.read` | 已归档条目及 archived_at |
| GET | `/v1/context-items/{item_id}/history` | `context.read` | 已记录版本的分页摘要 |
| GET | `/v1/context-items/{item_id}/versions/{version}` | `context.read` | 指定版本的只读快照 |
| POST | `/v1/context-items/{item_id}/update` | `context.write` | 编辑命令回执 |
| POST | `/v1/context-items/{item_id}/archive` | `context.write` | 归档命令回执 |
| POST | `/v1/context-items/{item_id}/restore` | `context.write` | 恢复命令回执，恢复后仍为 excluded |
| POST | `/v1/context-items/{item_id}/confirm` | `context.review` + 签名 human 身份 | 确认指定 proposed 版本并保存理由 |
| POST | `/v1/workbench/query`，`operation=context` | `context.read` | 当前项目可见条目列表 |

以上接口使用 Bearer 身份及租户、工作区、项目范围头。写入还要求有效客户端身份和稳定 `Idempotency-Key`。编辑、归档必须提供当前 `expected_version` 或 `If-Match: W/"version-N"`；同时提供时须一致。`item_id` 以 URL 路径为准。直接条目路由仅 history 接受 before_version/limit 查询参数，其余拒绝查询参数。

restricted 内容的新增、读取、修改、归档和恢复要求 `data.restricted.read`，管理员也须满足内容可见性限制。没有权限时，已有条目返回与不存在一致的 404。普通列表在 SQL 阶段过滤 restricted 和已归档条目；显式归档视图只返回已归档且当前可读的记录。

## 列表分页

`POST /v1/workbench/query` 的 `operation=context` 支持 query/layer/classification/status/item_type，以及 `limit`、`cursor` 和布尔值 `archived`。默认每页 25 条，limit 必须是 1–100 的整数。archived 默认为 false；true 只返回已归档条目，列表中的 archived_at 为归档时间，活动条目为 null。空筛选值表示不筛选，query/item_type 会去除首尾空白；未知字段、非法游标或超限参数返回 `INVALID_INPUT`。列表继续返回原有投影字段和正文，数据库数字仍可能为字符串。

```json
{
  "operation": "context",
  "layer": "L4",
  "status": "proposed",
  "limit": 25
}
```

响应保持 `data: [...]`，有后续条目时在**外层**增加字符串 `next_cursor`。下一次请求将它传为 `cursor`，保留同一筛选条件；没有 next_cursor 时停止。旧调用方不能再把一次列表请求当作全部数据，需要显式处理分页。该游标与同步接口 `data.next_cursor` 的数字含义不同。

排序保持优先级 High → Medium → Low，然后 updated_at 倒序、ID 升序。使用最后一条的排序位置继续，不要求边界条目仍然存在；SQL 读取最多 limit + 1 条。时间边界保留 PostgreSQL 微秒精度，避免同一毫秒内的记录被跳过。019 迁移提供匹配排序的部分索引，仅创建了迁移文件，尚未执行；列表功能不依赖该索引存在。

游标包含排序位置及范围/筛选摘要，绑定 tenant/workspace/project、restricted 读取能力、归档视图和规范化筛选条件。切换项目、权限、归档视图或筛选后应从第一页开始；limit 可改变。新增归档维度前产生的游标需要重新从第一页获取。游标不是授权凭据，每页仍独立检查鉴权、范围和当前分类。

分页展示实时数据，不提供跨请求数据库快照。翻页期间发生编辑、优先级调整或归档时，条目可能改变位置；需要刷新完整视图时从第一页重新读取并按 ID 去重。本接口不承担一致性导出或同步职责。ContextPack 的编译候选查询不使用此分页，原有候选数量限制不变。

## 新建与编辑字段

```json
{
  "title": "交接记录的保留约定",
  "content": "本条记录描述待确认的工作约定，后续仍需人工审核。",
  "source_refs": [{ "type": "meeting", "id": "notes-2026-11-01" }],
  "item_type": "note",
  "layer": "L4",
  "classification": "internal",
  "priority": "Medium",
  "confidence": 0.5,
  "expires_at": null
}
```

新建必填 `title`、`content` 和非空 `source_refs`。默认 `item_type=note`、`layer=L4`、`classification=internal`、`priority=Medium`、`confidence=0.5`、无到期时间；初始版本为 1，状态固定为 proposed。记录来源不代表网关已验证来源真实性，也不能据此将内容升级为 confirmed。

| 字段 | 限制 |
| --- | --- |
| `title` | 非空，最多 300 字符；去除首尾空白 |
| `content` | 非空文本，最多 131072 个 JavaScript 字符串长度单位；保留正文空白 |
| `item_type` | 非空，最多 64 字符 |
| `layer` | L0、L1、L2、L3、L4 |
| `priority` | High、Medium、Low |
| `confidence` | 0–1，归一化到三位小数，与存储精度一致 |
| `expires_at` | UTC ISO 时间，必须以 Z 结尾；小数秒最多三位；null 清除到期时间 |
| `source_refs` | 1–32 条；每条 type≤64、id≤255、uri≤2048；revision 为非负安全整数 |

编辑正文为上述字段的局部更新，但不接受 `classification`。额外允许 `status=proposed|excluded`。至少更改请求中的一个可编辑字段；字段值与当前值相同也属于新命令，会递增版本。分类在创建后保持不变，受控重新分类尚未接入。确认通过独立的 confirm 命令完成，不能通过普通编辑授予。

除原本 excluded 且未指定新状态外，编辑后状态回到 proposed；因此修改已确认或标记过期的旧条目不会沿用确认状态。excluded 条目通过 `status=proposed` 可以重新参与后续 ContextPack 选择；时间到期仍独立生效。更新来源列表时同步维护展示用的 `source_ref`。省略来源时保留全部原始引用。

归档为软删除，同时将状态设为 excluded 并递增版本。归档后普通读取和列表不可见，新 ContextPack 不再纳入；恢复使用下文的 restore 命令，目前没有硬删除入口。若只想暂时排除但仍保留在列表中，使用编辑命令设置 `status=excluded`。

新建/编辑的文本及来源引用拒绝 NUL、未配对代理字符与未知字段。既有 JSON 正文仍可读取；局部更新未包含 content 时保留其结构，提供新 content 后按文本保存。

## 回执、并发和同步

需要已有上下文及同步表和新增的 `017_context_item_commands.sql`。迁移文件已写入，尚未执行。没有数据库或迁移缺失时返回存储不可用，不退回进程内写入。

事务先获取项目同步流锁，再锁定条目，保持与 ContextPack 编译相同的锁顺序。编辑和归档在锁内检查版本；不匹配返回 `CONTEXT_ITEM_VERSION_CONFLICT`（409），不覆盖当前内容。成功写入、同步事件、请求回执一同提交。

请求键按 actor/client 哈希后，在 tenant/workspace/project 范围内保存。指纹包含命令类型、条目 ID、原版本和规范化字段。相同键、相同请求重试返回原命令回执；不同请求复用同一键返回 `IDEMPOTENCY_KEY_REUSED`。重试前重新经过策略，并检查条目当前分类和原回执分类；不会从内存缓存返回已无权访问的内容。

写响应的 `data` 为：

```json
{
  "item_id": "01JAAAAAAAAAAAAAAAAAAAAAAA",
  "operation": "update",
  "version": 2,
  "event_id": "01JBBBBBBBBBBBBBBBBBBBBBBB",
  "occurred_at": "2026-11-01T10:00:00.000Z",
  "replayed": false
}
```

外层保留 trace、revision、ETag、server_cursor 和条目来源引用。这是历史命令回执，**不是当前完整条目**；若其他操作已修改或归档条目，重试仍可在权限允许时确认原命令完成，并返回 `replayed=true`。调用方应通过 GET 获取当前内容和版本，归档后 GET 返回 404。请求结果不确定时保留原键、原版本和原内容重试，不自动换键。

`ContextItemCreated`、`ContextItemUpdated`、`ContextItemArchived` 的同步 payload 只包含条目 ID、版本、状态和归档标记，不携带正文和外部来源。事件查询同时检查事件原分类及条目当前分类。归档保留最小事件和行，以便授权客户端收到删除标记。读取最新正文继续经过 `context.read`。

编辑/归档引起条目版本与内容指纹变化，引用它的已保存 ContextPack 在下次读取时返回 stale；不会静默修改旧包正文。新增条目不会改变既有快照，需要重新编译才能纳入。

| 错误 | HTTP |
| --- | --- |
| `INVALID_INPUT` | 400 |
| `DENIED` | 403 |
| `CONTEXT_ITEM_NOT_FOUND` | 404 |
| `CONTEXT_ITEM_VERSION_CONFLICT`、`IDEMPOTENCY_KEY_REUSED` | 409 |
| `CONTEXT_ITEM_NOT_ARCHIVED` | 409 |
| `CONTEXT_ITEM_HISTORY_CONFLICT` | 409 |
| `CONTEXT_ITEM_INVALID` | 500 |
| `CONTEXT_ITEM_STORAGE_UNAVAILABLE` | 503 |

## 客户端

- SDK：`createContextItem`、`getContextItem`、`listContextItems`、`updateContextItem`、`archiveContextItem`；类型和写入字段解析位于 `@planemem/contracts`。列表保留投影视图格式，其中数据库数字可能为字符串，编辑前应转为安全正整数，或直接 GET 获取已规范化版本。
- CLI：`context create/read/list/update/archive`；`context get` 继续表示读取 ContextPack，避免与来源条目混淆。
- MCP：`create_context_item`、`get_context_item`、`list_context_items`、`update_context_item`、`archive_context_item`；资源模板为 `work://project/{project_id}/context-item/{item_id}`。
- 工作台 `/context`：授权用户可新增、编辑、排除和归档；每页 25 条，下一页保留筛选，修改筛选回到第一页，层级统计仅反映当前页。指定 item 的详情通过独立 GET 读取，可以打开其他页或不匹配筛选的可见条目；不可见/归档时展示读取错误，不替换为另一条。编辑与归档入口位于条目详情，不依赖保存包存在。新增和编辑均支持 1–32 条来源的类型、标识、固定 revision 与 URI，编辑保持原分类。只提交实际编辑字段，未改动的旧 JSON 正文和来源保持原结构。网络结果不确定时锁定原草稿并允许重试；版本冲突时保留草稿，显式重新加载后才替换为最新数据。

### 工作台来源修复

来源编辑器可添加、删除及撤销本次来源修改。新来源列表或修改后的列表通过共享创建/更新解析器校验；本地 `context-item` 引用还要求有效标识及正安全整数 revision，拒绝直接引用自身或同一条目的冲突版本。上述本地限制是工作台的录入辅助；存储契约继续兼容旧引用，网关确认和使用时仍执行递归检查，不把表单校验当作当前有效性的保证。

未修改来源时不会提交 `source_refs`，只修改其他字段不强制修复旧来源；一旦修改来源列表，则完整列表需满足录入要求。撤销来源修改恢复打开编辑器时的列表，不读取或替换为最新来源。共享解析器仅校验实际补丁，避免未改动的旧 JSON 正文或旧引用触发浏览器字段校验并阻塞其他字段修改。

有效本地标识提供当前条目和指定固定版本的历史链接，在新标签打开。历史尚未捕获或不可见时仍显示原有读取错误，不回退到当前内容。用户自行核对并填写版本，不自动刷新固定版本。外部 URI 作为原文保存，不生成任意地址的跳转链接或主动抓取。

活动详情增加可选 `source_checks`，按来源原位置显示逐条状态、处理提示及可读活动来源的当前版本；缺失、未检查或不可用结果不会被显示为检查通过。诊断与总来源检查来自同一次遍历，不暴露隐藏后代信息，不写入内容版本。具体字段和权限边界见 [本地来源链说明](context-source-runtime.md)。

保存来源修改沿用预期版本、历史快照和持久请求回执，并撤去当前确认；不会刷新旧包或修改旧建议。未知结果锁定正文及完整来源列表，保留同一草稿和请求键供重试。本轮仅开发代码和说明，未运行编译、类型检查、测试或发布。

列表复用工作台查询，已开发筛选和分页。外部来源自动摄取、分类变更审批、后台失效通知、历史保留清理策略和完整运行验证仍待后续开发。本轮不提供运行正确性或兼容性验证结论。

## 人工确认

`POST /v1/context-items/{item_id}/confirm` 接受 `{ "expected_version": 1, "reason": "已核对会议原文及当前内容。" }` 和稳定 Idempotency-Key；If-Match 可以提供原版本，两处同时给出时必须一致。reason 必填、去除首尾空白、最多 2000 个 JavaScript 字符串长度单位，不允许 NUL 或未配对代理字符。未知字段拒绝。

确认要求通过验证的 `actor_type: "human"`、明确认证的客户端和 `context.review`（或管理员角色）；context.write、模型 provenance 或客户端名称不能代替这些条件。管理员也不能绕过 human、版本或 restricted 可见性。网关策略审计、命令处理器和 MCP 均保留人工身份限制；OPA 策略增加 context.review 动作，但本轮没有修改外部身份系统或给账户自动授予能力。

仅活动、未过期的 proposed 条目可确认；confirmed/excluded/expired 状态返回 `CONTEXT_ITEM_NOT_PROPOSED`（409），时间到期返回 `CONTEXT_ITEM_EXPIRED`（410）。排除或过期内容需先经过编辑，重新成为 proposed，再明确确认新版本。正文、来源、分类、层级、置信度和到期时间保持不变，状态变为 confirmed、版本加一。后续任意编辑仍按既有规则撤去该版本的确认，归档/恢复也不沿用确认。

条目须包含 1–32 条来源。本地 context-item 来源链递归检查固定正整数 revision、同项目可见性、活动/confirmed 状态、到期时间和分类，拒绝循环或超限。条目分类不能低于子来源；不满足时返回 `CONTEXT_ITEM_SOURCE_STALE` 或 `CONTEXT_ITEM_SOURCE_UNAVAILABLE`（409），不泄露不可见来源信息。检查在项目流锁及行锁内进行，等待来源后再次核对过期时间。其他类型的引用不由网关抓取验证，须由审核人核实。

确认记录某人在该版本上的明确批准，不代表外部证据已自动验证或永久有效。来源后来编辑/过期，不会自动重写条目的历史批准或存储状态；活动详情增加 sources_current/source_check，递归检查使用时有效性。无效链不能进入新保存包或新的有效建议，旧保存包和建议的依赖摘要也会重新核对。确认不重写旧包、不调整层级、不修改 Plane 或 Proposal。检查边界、容量上限及旧快照兼容见 [本地来源链说明](context-source-runtime.md)。

新增 `022_context_item_confirmation.sql` 扩展命令/历史操作约束并增加 confirmation_reason；只写入迁移文件，未执行。确认状态、`ContextItemConfirmed` 最小同步事件、历史快照、理由、actor/client 和命令回执在同一事务内保存。所有新的条目写入现在依赖 022 的历史列；上线前需由后续运维流程安排依赖迁移。快照哈希仍覆盖 `{ item, archived_at }`，确认理由与 actor/client 一样是独立历史元数据。

幂等指纹包含确认理由和原版本；同键异理由拒绝，同键同请求返回历史 confirm 回执，不重新确认后来编辑的内容。写回执只含操作、条目/事件 ID、版本、时间和 replayed，不含理由。活动 GET 的 data 增加 `confirm_allowed` 提示及 `confirmation`，后者包含 reviewed_version、confirmed_version、actor_id、client_id、reason、confirmed_at 和 event_id。提示不是授权保证；实际确认仍检查所有条件。

已认证且具备审核权限的 human 读取活动 proposed 条目时，另返回 `confirmation_readiness`，在同一批来源数据上执行严格确认检查，包含 sources_current、source_check、逐条 source_checks 和有效链最早到期时间 effective_expires_at。confirm_allowed 依据严格结果及有效期给出，普通来源链有效但仍有 proposed 依赖时不显示确认表单；页面先提示需确认的来源及重新核对固定版本。严格预览共享原节点/深度/工作上限，不增加逐条查询，不改变普通 sources_current，也不代表提前批准或锁定来源。

`GET .../versions/{version}` 的 data 同样增加 confirmation，历史列表只显示操作和摘要，不返回理由。旧 confirmed 记录没有可证明的审核元数据时返回 null，不补造审批；当前已编辑/归档后的旧确认只能通过对应历史版本查看。当前条目和其确认元数据使用同一个可重复读事务读取，真实确认记录还需匹配当前内容快照哈希。

SDK：`confirmContextItem(id, reason, { expected_version, idempotency_key })`。CLI：`context confirm`，JSON 提供 item_id/expected_version/reason 并传 `--key`。MCP：`confirm_context_item`，只向具备能力的签名 human 客户端展示；expected_version、reason 和 idempotency_key 必填。工作台活动详情在 confirm_allowed=true 时显示确认表单，填写理由并明确勾选；确认记录和历史理由可读。未知结果锁定原理由和请求键重试，即使随后发生鉴权错误也保留未知状态；版本或来源冲突需重新加载。

## 版本历史

迁移 `021_context_item_history.sql` 新增版本快照表，依赖现有上下文条目和同步事件表；仅写入文件，尚未执行。代码部署时需先完成该迁移，之后新增、编辑、归档和恢复都必须在原事务内保存对应完整快照、操作人/客户端、事件 ID 及记录时间。历史存储失败时整笔写入回滚，不出现条目已更新但对应快照缺失的成功结果。幂等回放直接使用旧回执，不额外创建历史记录或替原作者重新署名。

快照以项目范围、item_id、version 唯一保存，包含完整条目和该版本的归档时间。SHA-256 基于规范化的 `{ item, archived_at }` 计算，读取具体版本时检查范围、版本、分类/状态、来源和哈希一致性；这是一致性校验，不是数字签名。查询列表只读取摘要列，不返回所有版本的正文。历史读取响应不提供可用于当前编辑的 ETag；编辑前仍需重新获取当前条目版本。

已有条目在第一次成功修改前保存当前版本作为 `baseline`，actor/client/event 均为空，不把当前操作者标为历史作者。recorded_at 表示捕获时间，item.updated_at 保留原条目更新时间。不会回填或猜测更早的正文。绕过这些网关写入路径的数据库修改不会自动生成完整历史；如果当前版本与已记录快照不一致，下一次网关修改返回 `CONTEXT_ITEM_HISTORY_CONFLICT`，保留原历史并回滚本次请求。

`GET .../history` 默认 25 条、limit 范围 1–100，按版本倒序。data 包含 item_id、current_version、current_archived、versions，存在下一页时包含 next_before_version，继续请求将其传为 before_version。版本号是正安全整数，URL 参数不接受重复值。历史缺口或权限过滤可能导致版本跳号；列表不是全历史快照导出。

`GET .../versions/{version}` 返回 `ContextItemRevision`，其中 item 为历史完整条目，另含 operation、archived_at、recorded_at、actor_id/client_id/event_id 和 snapshot_hash。不存在、未记录或不可见的版本统一返回 404，不回退到当前正文。历史行及当前条目同时按当前项目和 restricted 能力过滤，在同一次可重复读事务里确定可见性。当前条目缺失/移出范围/不可读时不可通过历史入口读取旧正文；当前分类降低也不会让原 restricted 快照变得可读。归档条目的历史可通过此显式入口查看。

SDK：`listContextItemHistory(id, { before_version?, limit? })` 和 `getContextItemVersion(id, version)`；CLI：`context history`、`context version`；MCP：`list_context_item_history`、`get_context_item_version`。工作台条目详情提供历史入口 `/context/history?item=...`，支持分页、操作/作者/时间查看和指定版本链接。快照页面只读，历史中的 confirmed 仅表示当时状态，不恢复旧正文、不重新授予确认、不改变来源有效性。

## 归档读取与恢复

归档是保留记录的生命周期状态，不是物理删除或保密屏障。具备 context.read 的同项目身份可显式查询 `archived: true`，或者读取 `/v1/context-items/{item_id}/archived`；restricted 读取限制照常生效。普通 GET 仍对归档条目返回 404，归档 GET 只返回归档条目，对活动条目也返回 404。归档详情在完整条目上增加 UTC 字符串 archived_at，不允许原地编辑，需先恢复。

恢复需要 context.write、明确认证的客户端、稳定请求键及归档后的 expected_version（或匹配 If-Match）。项目同步流锁、条目行锁、版本校验、状态写入、`ContextItemRestored` 事件及 restore 命令回执在同一事务完成。恢复清除 deleted_at、增加版本，并保持 excluded；正文、来源、分类和到期时间不变。不会重新授予 confirmed，也不会自动纳入新包；如需启用，先检查内容，再通过普通 update 显式改为 proposed，并按需更新到期时间。

对活动条目发起新 restore 请求返回 `CONTEXT_ITEM_NOT_ARCHIVED`，版本不匹配优先返回版本冲突。原 restore 请求可重复回放历史回执，后续即使被再次编辑或归档也不会重复恢复；当前权限仍必须满足。删除和恢复均增加版本，引用归档前版本的旧 ContextPack 仍 stale；引用它的 Proposal 可能重新可见，但 sources_current 仍为 false，不能直接确认。

迁移 `020_context_item_restore.sql` 扩展命令表的操作约束并增加归档列表索引，依赖 017；仅新增文件，未执行。实际使用 restore 前需要执行该迁移。已有归档条目无需回填，读取原 deleted_at 作为归档时间；硬删除或缺失记录不能通过此命令恢复。

客户端入口：SDK `getArchivedContextItem`、`restoreContextItem` 和 `listContextItems({ archived: true })`；CLI `context read-archived`、`context restore`；MCP `get_archived_context_item`、`restore_context_item` 和列表 archived 参数。普通资源模板仍只表示活动条目。

工作台筛选提供 Active/Archived 视图，归档详情显示归档时间及恢复确认表单。归档成功后转到归档详情，恢复成功后转到活动详情；归档视图不显示编辑、再次归档或创建建议入口。写入结果未知时固定原参数和请求键，后续权限/404 等错误不直接解除该未知状态，保留原请求重试；不自动换键恢复。

具备 proposal.write 和客户端身份时，条目详情提供创建建议入口。跳转后重新读取当前条目，将 ID/revision/分类带入 Proposal 草稿；建议仍需填写正文和 provenance 并显式提交。该操作不会确认原条目，参见 [Proposal 提交流程](proposal-runtime.md)。
