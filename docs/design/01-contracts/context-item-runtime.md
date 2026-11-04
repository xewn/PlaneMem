# ContextItem 录入与编辑开发说明

## 2026-11-04 上下文目录完整读取与页大小增量

现有POST /v1/workbench/query的operation=context新增共享context-item-directory契约。parseContextItemDirectoryQuery先复制最多8 KiB普通JSON，沿原筛选解析并固定archived=false、limit=25默认值；默认页大小25，允许1–100。parseContextItemDirectoryPage/Envelope最多2 MiB完整JSON，拒绝未知字段、不完整记录、重复条目、无效数字/时间/来源、错序、错误归档视图、与精确筛选不符或续页位置不匹配；不截断正文或以少量记录冒充完整页。

响应仍为data数组和可选外层next_cursor，新增完整scope及规范query回显（含默认archived/limit和本次cursor）。完整封套要求schema_version、原trace、精确wcp_context_items来源，以及四个布尔context_permissions提示；restricted=false时不能含受限记录。投影保留原完整content/source_refs等字段，version规范为正安全整数、confidence为0–1数值，updated_at/expires_at/archived_at统一UTC六位微秒，后两者允许null。目录不带HTTP或正文ETag，不含实时来源诊断或人工确认授权；完整详情仍须独立读取。

Gateway沿原项目/分类可见性查询，明确High→Medium→Low、updated_at倒序、ID的C顺序，比较与排序使用同一规则。v2游标编码完整微秒位置及规范绑定摘要，绑定项目范围、restricted能力、全部筛选、归档视图和页大小；不绑定临时查询trace，也不是身份凭据。客户端可核对位置和续页格式，真实绑定由Gateway重新计算；改变页大小或筛选必须清除cursor，旧v1游标明确失效。next_cursor只能对应满页末条记录，续页首条必须严格位于原位置之后，边界记录不必仍存在。

query文本搜索继续使用原PostgreSQL lower/concat_ws和JSONB文本表示的字面包含逻辑；共享解析只核对其规范回显，不用JavaScript字符串转换重算匹配，避免Unicode大小写和JSON对象顺序/空白差异。layer/classification/status/item_type按精确保存值核对。SQL仍最多读取limit+1条完整投影后校验，响应上限不代表数据库扫描、原始结果分配或前瞻正文的成本上限；超大条目仍留在存储，但可能无法通过目录完整返回。

Web在等待会话前捕获原查询，清除写键；fetch开始后的同一30秒期限覆盖完整UTF-8/JSON、字节和契约校验，成功2 MiB、错误16 KiB。要求HTTP200或有效错误状态、匹配trace、合法媒体类型和无ETag；错误只映射固定提示。请求前、响应到达后、成功/失败交付前复核原会话期限，401或失效要求重新登录；不重新选择项目/筛选或自动重试。

网页新增Items per page数字输入，仅1–100正整数，缺省或显式25在规范链接中省略。筛选提交清除旧位置和选择，下一页、原页重试、条目链接、归档视图切换、清除筛选及历史/比较返回保留页大小；搜索返回仍遵守原item/return_to限制。目录失败保留原参数重试、同筛选首屏，并在页大小大于1时提供Smaller page with these filters：明确减半（向下取整且最小1），清除旧cursor/选择、保留筛选和指定包。不会自行缩页或返回部分列表。

SDK/CLI/MCP通用入口继续收到原data数组及新增元数据，但尚未增加专用目录客户端解析/期限；Mock目录尚未接入。旧消费方的数字字符串、毫秒时间、v1游标及无scope/query封套需要迁移，独立Schema、SQL成本与兼容证据后续处理。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行产品/浏览器/API/SQL/数据库或发布；R-003未完成、evidence为空。

## 2026-11-04 当前与归档详情Mock增量

既有MockContextHistoryStore增加可选条目current_detail，供getContextItem/getArchivedContextItem读取完整原详情；MockWcpServer原context_history配置接入，历史/版本/详情共享模拟身份、可见集合、两笔容量与30秒预算。单详情2 MiB、合计种子16 MiB，核对当前版本/归档/分类与已有同版历史保存内容；不从历史补造缺失详情或刷新来源观察。可选review_access的human/review_context均true时才保留原确认就绪，confirm_allowed仅按给定原提示、模拟权限及有效期降级，不授予写权限。外层trace随请求，保存正文/来源/原确认与诊断时间保持。配置、原历史兼容、响应边界及未执行示例见[上下文详情Mock](context-item-mock-runtime.md)。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布；R-003未完成、evidence为空。

## 2026-11-04 MCP当前上下文资源读取增量

`resources/read`的`work://project/{project_id}/context-item/{item_id}`经原mcp.resource路由进入专用context-resource处理器，直接内部资源调用也使用同一路径。处理器输入仅uri、完整普通JSON最多4 KiB；URI必须完整匹配当前条目模板，无查询串/片段/额外路径，项目与条目标识符各百分号解码一次。项目必须等于原可信项目，条目沿共享本地ID规则，拒绝空值、`.`和`..`；保留原合法URI形式，不将编码后的分隔符再解释成路径，不提供归档资源或自动视图回退。协议层仍只向内部资源操作传递uri。

要求schema v1、可信未过期客户端、实际context.read及完整项目/账号/客户端/trace，admin不替代。处理器开始时复制原上下文、清除继承写条件；父项目可见性检查与嵌套context.item.read各使用独立副本，原外层资源授权/审计和内层条目授权/审计保持。完整详情沿共享2 MiB解析，核对原项目/条目、版本/revision/JSON内ETag、完整内容/来源、当前来源诊断和确认信息，restricted内容需对应能力；旧confirmed可保留null确认。内层通过router读取，没有独立HTTP响应头，不能声称检查HTTP ETag。

保持原资源结构：外层schema_version/trace_id/source_refs，data.contents中一项原uri、application/json与完整原详情封套的JSON文本。正文不截断；转义文本与重复来源合计的完整包装封套最多6 MiB+8192字节，超限返回MCP_RESOURCE_INVALID。已知读取错误先按16 KiB完整校验，再映射固定提示，拒绝原异常正文/详情透传；未知或不匹配错误同样返回固定无效资源错误，retryable=false。

每CommandRouter独立两笔上下文资源读取名额，与tools/call容量分开。处理器从捕获输入起共用30秒期限，覆盖父项目检查、嵌套授权/审计、读取、完整解析和包装；占满返回MCP_CONTEXT_RESOURCE_BUSY，超时返回MCP_CONTEXT_RESOURCE_TIMEOUT。超时只停止等待，底层项目检查或条目读取未结束仍占槽；迟到项目检查后不再派发条目读取，迟到正文不交付。处理器前的外层mcp.resource授权/审计、网络收发和同步CPU抢占不在此保证内。

模板与资源目录仍是发现提示，不新增权限证明或全目录读取预算；其他资源、工具、包和归档路径保持。无自动重试、外部来源访问、保存或写入。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布；URI/真实资源兼容、旧身份调用迁移、来源与确认、错误/大小、超时/容量及审计行为均待运行证据，R-003未完成、evidence为空。

## 2026-11-04 MCP当前与归档详情读取增量

`get_context_item`和`get_archived_context_item`接入原context-history专用执行器，内部入口统一命名ContextRead。参数仅接受明确的item_id，严格普通JSON且最多4 KiB；视图由工具名决定，拒绝kind、调用方身份、写条件和额外字段。保留原完整成功封套，不自动切换当前/归档视图、重试、保存或读取外部来源。

发现、prepare及实际调用统一要求可信未过期客户端、实际context.read和完整项目/账号/客户端/追踪号；admin不替代读取能力。prepareMcpTool通过权限检查后明确返回MCP_TOOL_EXECUTOR_REQUIRED，调用方须使用dispatchMcp或专用执行器。HTTP客户端门槛包含两详情工具。执行前复制原可信上下文、清除继承的写条件，每次内部GET使用独立副本。

完整成功JSON最多2 MiB，错误最多16 KiB；核对HTTP 200或有效错误状态、JSON媒体类型及原trace，详情成功HTTP ETag必须匹配正文规范ETag，历史响应和所有错误禁止ETag。共享解析核对原条目、范围、版本/revision、完整正文与来源、当前来源诊断和原确认、归档状态及时间；restricted记录仍需对应能力。旧confirmed记录允许null确认，来源诊断是读取时观察，ETag是版本元数据，均不证明来源真实性或赋予写权限。

当前/归档/历史/版本/比较五工具共用每ApiGateway两笔在途容量，每次调用总期限30秒；等待超时后底层读取未结束仍占槽。详情容量和超时分别返回MCP_CONTEXT_ITEM_BUSY、MCP_CONTEXT_ITEM_TIMEOUT，历史/版本/比较保留原MCP_CONTEXT_HISTORY_BUSY/TIMEOUT。详情业务结果限2 MiB，MCP转义后结果限4 MiB+4096字节；失败不返回部分内容。原历史快照摘要核验和双版本顺序保持，比较继续共用一次总期限。同步解析不能被计时器抢占，也不声称外层网络发送或全局容量保证。

本增量只覆盖tools/call详情路径；resources/read、Mock详情、包和目录仍为后续工作。未改共享契约、SDK、CLI、Web、数据库/schema或依赖。仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布；工具发现/调用权限、旧prepare调用迁移、完整真实响应、ETag/错误、共享容量/期限和历史兼容均待运行证据，R-003未完成、evidence为空。

## 2026-11-04 CLI当前与归档详情读取增量

`context read`和`context read-archived`的main网络、callGateway及runWorkctx嵌入入口统一接入SDK当前/归档详情读取。沿用原`{item_id}`输入，可选增加成对expected_actor_id/expected_client_id；账号须ULID、客户端为合法本地ID，作用只是与服务端可信身份相等，不能授予权限。只接受明确原条目，不允许kind、历史version、写键或expected_version混入。

参数要求恰一`--json OBJECT`或`--json-file PATH`，完整输入最多4 KiB，严格普通JSON和共享查询校验；可选`--timeout-ms`为1–2147483647整数，默认30000。网络支持有界`--json -`，嵌入拒绝stdin；文件复用稳定普通文件完整读取、UTF-8及大小限制。拒绝重复/未知选项、key、output和额外位置参数。文件/stdin输入先于SDK期限，等待EOF不提供取消保证。main先分发专用处理，callGateway绕开旧通用路由；已移除旧网络详情分支，嵌入在通用执行前分发。

仅派发所选视图的GET，共享SDK完整2 MiB成功与默认30秒读取期限，Fetch错误最多16 KiB。完整核对条目/范围/版本/revision/正文ETag、正文/来源、归档状态/时间及当前来源诊断与原确认；输出保留原成功封套，旧confirmed记录允许null确认。JSON正文内ETag被校验，通用WcpTransport未暴露HTTP ETag，本命令不声称验证该响应头或来源真实性。无自动回退当前/归档、重试、落盘或部分输出。

嵌入捕获原完整可信身份及token期限，要求实际context.read，admin不替代；清除继承写条件，成对预期身份若提供必须匹配。SDK每次请求核对原GET路径、顺序、完整身份头、bounded-json/大小与空正文，再调用对应context.item.read或context.item.archived.read。返回先经完整共享解析，额外复核restricted权限、期限和取消状态。当前/归档/历史/版本/比较五入口共用每router两笔在途容量，SDK停止等待后底层router未结束仍占槽；比较保留原双版本顺序与同一总预算。内部函数统一命名为ContextRead，既有context-history模块承载共用执行逻辑。

以下仅为未执行的用法示例，item-query.json保存调用方明确选择的`{"item_id":"context-note-1"}`；根据目标视图选择一个命令：

```sh
workctx context read --json-file item-query.json --timeout-ms 15000
workctx context read-archived --json-file item-query.json --timeout-ms 15000
```

用法错误沿现有退出码2，运行读取错误为1，成功为0，错误不输出成功正文。旧嵌入调用若缺可信身份/权限或只返回部分字段需要迁移；取消停止的是等待，不证明底层读取已结束。本增量不涉及包/目录、MCP/Mock、SDK、共享契约、Gateway、Web、数据库/schema或依赖改动。仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布；参数/期限/权限/并发/退出码及历史兼容仍待运行证据，R-003未完成、evidence为空。

## 2026-11-04 SDK当前与归档详情读取增量

`WcpClient.getContextItem(itemId, options?)` / `getArchivedContextItem(itemId, options?)`接入专用完整读取，返回原`WcpEnvelope<ContextItemReadDocument>` / `WcpEnvelope<ArchivedContextItemDocument>` Promise。根入口新增导出`WcpContextItemReadOptions`及两个文档类型。options只接受timeout_ms/signal，可选undefined省略；timeout_ms默认30,000毫秒，整数1–2,147,483,647，signal沿AbortSignal形状。项目必须完整且合法，actor/client仍为可选，提供时校验并固定为请求相等条件，由Gateway检查真实身份；GET不继承任何写键或版本条件。

调用在第一次异步等待前捕获项目、原条目/视图、trace、身份和选项，查询复用共享4 KiB解析，随后建立包含凭据等待、网络、完整正文与结构校验的统一预算。只派发指定current或archived GET，不尝试另一视图、最新历史或自动重试。完整成功2 MiB，由共享解析复制普通JSON、核对原范围/条目/版本/revision/正文ETag/封套来源、完整正文、归档状态及实时诊断/原人工确认；缺字段、错误目标、不一致诊断和超限均拒绝整份。旧confirmed记录合法null确认保持，不生成来源/确认信息或快照摘要。

FetchWcpTransport沿既有bounded-json路径校验完整UTF-8/媒体类型/成功200与trace、声明长度及16 KiB错误限制，传输自己的超时可比本次更短。WcpTransport接口只返回JSON，详情适配器检查正文ETag与revision一致，不声称取得或核对HTTP ETag；自定义transport负责自身字节/HTTP读取，但返回对象仍受共享完整结构/2 MiB/深度/节点预算和独立副本检查。取消或期限超出优先于迟到结果，finally移除本次外部监听并关闭计时器；停止本地等待不证明服务器停止处理。

错误保留固定已知code与本次trace，retryable=false；未知错误或不同trace映射固定GATEWAY_UNAVAILABLE文案，输入/选项错误通过Promise拒绝为INVALID_INPUT。相比旧通用envelope路径，自定义transport须支持bounded-json/max_response_bytes/signal并返回完整原封套，不能继续使用只有少量字段的替身。历史读取/比较/迭代的原平面字段与捕获实现提取到内部context-read-input，公开签名和接受范围保持；没有新增Mock当前条目路由，也未扩展CLI/MCP专用读取。

以下仅为未执行的调用示例，client已按真实目标构造，itemId来自调用方的明确选择：

```ts
import type { WcpContextItemReadOptions } from '@planemem/sdk';

const stop = new AbortController();
const options: WcpContextItemReadOptions = { timeout_ms: 15_000, signal: stop.signal };
const current = await client.getContextItem(itemId, options);
// Only use the explicit archived view when that is the caller's intended selection.
const archived = await client.getArchivedContextItem(archivedItemId, { timeout_ms: 15_000 });
```

仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。SDK真实超时/取消/旧传输兼容、历史提取回归、CLI/MCP/Mock接入与运行证据仍待补；R-003未完成、evidence为空。

## 2026-11-04 当前与归档详情完整读取增量

新增contracts `parseContextItemReadQuery` / `parseContextItemReadEnvelope` 及公开类型、大小常量。查询最多4 KiB，只接受明确的current/archived与合法原item_id，拒绝未知字段、点路径及非普通JSON；完整成功封套最多2 MiB，核对schema、请求trace、原条目与完整租户/工作区/项目、正安全版本、revision和规范ETag。完整内容保留普通JSON语义及来源顺序/重复/可选字段，拒绝缺失正文、无效保存字段或日期，封套来源必须是当前条目版本加完整原来源。这里没有历史快照摘要，也不把ETag当成内容真实性证明。

归档入口只接受带归档时间的excluded记录；当前入口拒绝归档字段，检查来源状态与sources_current一致、检查时间/范围、可选诊断数组的唯一合法本地来源索引/状态/原因/版本。诊断允许缺省，不生成遗漏项，也不将未检查项提升为current；提供诊断且整体current时必须覆盖所有本地来源并全部current，单项current须无问题原因且当前版本匹配原固定版本。整体current不得与已过期或excluded根条目矛盾。人工确认必须匹配当前confirmed版本及前一reviewed_version，含合法原身份、事件、规范理由与时间；旧confirmed条目可合法返回null，不补造确认。可选确认就绪仅属于proposed，严格检查与普通来源检查时间一致；有效期限在观察时仍有效且不晚于根条目期限，严格current须有来源且普通观察也current，confirm_allowed为true必须有sources_current为true的就绪记录。此校验不认证权限或外部来源，提示仍只代表原读取时的观察，写入继续由服务端重新检查。

Web当前/归档两个读取函数在等待会话前捕获查询，专用响应模块沿原fetch起始30秒期限完成网络、完整UTF-8读取与结构检查。HTTP成功只接受200，错误须4xx/5xx且完整正文最多16 KiB；媒体类型、长度、trace及成功HTTP ETag与正文ETag一并核对，错误不得带ETag。401取消正文并要求登录；读取前后及失败时复核会话到期。超限、缺失、错误范围或结构整份失败，固定错误文案，现有页面保留原条目/归档视图供显式重试，不自动切到当前状态、重新发送或交付局部内容。

本增量没有改动目录、ContextPack、SDK/CLI/MCP读取、写表单、Gateway路由、数据库/schema或依赖。仅源码文档人工审阅和格式文本检查；未编译、类型检查、测试、运行浏览器/产品/API/SQL或发布。旧数据兼容、大小/期限/中断/ETag、实时诊断组合和页面恢复仍待运行证据，R-003保持未完成、evidence为空。

## 2026-11-04 Web对比差异筛选增量

/context/history/compare增加Display选择和Show all/Changes only切换链接，默认全部内容。URL仅增加单值show=all|changes；省略或显式all都规范为默认，空值、其他值及重复参数在读取前报错。此字段与history参数分开解析，不传给Gateway或共享比较查询，也不进入返回浏览页的过滤条件。历史页的比较选择表单也可直接选择显示模式。

Changes only过滤未变的十项属性/九项历史记录字段，隐藏完全未变的正文、来源和确认区段；比较摘要、版本链接与读取信息始终保留。显示独立历史记录变化数，正文/属性/来源/确认均相同则明确说明历史信息仍可能不同，不将“无内容差异”误报成两个快照完全相同。字段组没有变化时显示提示，不输出空表；切回Show all可查看匹配值。变化标记始终取共享模型，文本空白、JSON对象键序、数组顺序/重复及缺省/null/空串语义保持，不做截断、模糊差异或推断来源状态。

摘要提供只指向当前可见区段的本页跳转链接，历史信息始终可达；目标可接收键盘焦点，局部样式允许区段/版本/模式链接换行并标记当前显示方式，原完整值滚动和窄屏两列堆叠保持。切换模式、重新选择版本、反向及失败重试均保留原history before/version和已验证return链，原from/to只在明确反向或重新选择时改变。返回历史或结果使用原页面地址，不将比较显示字段带入其他页面。

显示切换是显式GET导航，版本链接prefetch关闭；会按当前会话重新读取相同指定两版，仍沿既有总30秒/完整响应/SHA-256核对后再筛选呈现。区段锚点仅在当前页定位。失败不展示局部比较，重试保留显示模式；未完整选择版本时只预填表单，不隐式读取最新版本。没有新增客户端存储、外部来源访问、写操作、SDK/CLI/MCP/共享契约/Gateway/数据库/schema/依赖变化。

仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、浏览器/API/数据库运行或发布。差异筛选、重复URL、返回/反向/重试、焦点与窄屏实际表现仍待运行证据；R-003未完成，evidence为空。

## 2026-11-04 SDK历史按需分页增量

新增WcpClient.contextHistoryPages(itemId, query?, options?)，返回AsyncGenerator<WcpEnvelope<ContextItemHistoryPage>, void, unknown>；options为WcpContextHistoryPagesOptions，沿timeout_ms/signal并增加max_pages。创建时同步捕获合法普通平面字段及完整项目/actor/client上下文；actor与client均必填，在每页请求携带同一相等约束，服务端才负责验证实际身份。单页listContextItemHistory的可选身份规则保持。创建时输入/选项错误同步抛INVALID_INPUT，合法可选undefined仍省略；没有读取、计时器或后台预取。

第一次及后续next才派发一页，调用方显式for await消费才会连续读取。默认limit=25、最多100，保留原item_id、limit与可选起始before_version。每页沿原完整256 KiB/trace/来源/版本排序/分页校验和默认30秒本地预算；timeout_ms不是整个遍历总时限，消费者处理或等待期间不运行读取计时器。返回页面前捕获next_before_version并要求比上一位置严格降低，调用方修改返回对象/原参数或原构造上下文不会改变之后请求。新记录、权限变化及当前版本信息以各页读取为准，不能将遍历当作跨页一致性快照或历史完整性证明。

max_pages默认100、允许1–1000正安全整数。达到上限时先正常交付最后一份完整页；若它还有续页，下一次next抛CONTEXT_HISTORY_PAGE_LIMIT，retryable=false，不再发请求。若该页已无续页，下一次正常结束。调用方保留最后完整页及data.next_before_version，可明确决定另建迭代器继续；不会自动重置页数、跳过页或换身份。续页读取失败不返回半页，也不撤销先前交付的页面，原位置需要调用者保留。

每页请求复用原signal；仍有待读页面时，取消发生在空闲期会让下一次next在派发前拒绝。并发next由异步生成器按请求顺序排队处理，不并发拉取；break/return停止尚未发起的页，原生生成器return不能抢占已经等待的next，调用者应使用AbortController取消在途读取。错误固定、不自动重试、不保存、不读取单版本正文或确认当前状态。目录摘要仍只是记录字段，若需核对快照必须另调getContextItemVersion。

以下为未执行示例，client已配置完整项目、actor/client上下文；调用者自行处理页数上限或读取失败，并保留最后完整页的续页位置：

```ts
const pages = client.contextHistoryPages(itemId, { limit: 25 }, {
  timeout_ms: 30_000, max_pages: 10, signal: controller.signal,
});
const first = await pages.next(); // 此时才读取第一页
if (!first.done) {
  const continuation = first.value.data.next_before_version;
  // 处理完整页，并按需要保存原 continuation。
}
await pages.return(); // 不再读取下一页
```

MockContextHistoryStore沿相同GET与原分页自然接入，每store固定30秒期限可比SDK预算更早结束。无Gateway/CLI/MCP/共享Schema/数据库/依赖变化；capture收拢原timeout/signal形状校验以便创建时发现非法选项，单页/比较接受范围保持。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行SDK/Mock/API/数据库或发布。迭代器取消/排队/可变输入、页数上限及生产数据兼容仍无运行证据，R-003未完成。

## 2026-11-04 上下文历史Mock增量

SDK新增可选MockContextHistoryStore及MockWcpServer context_history配置：固定单项目当前可见状态和完整原历史版本，允许空历史/版本缺口，显式完整模拟身份/到期/权限/可见集合。目录和单版沿共享封套与分页规则，指定快照WebCrypto SHA-256核对保存摘要；SDK比较沿两次指定读取接入，不增加比较路由或伪造版本。种子16 MiB/最多1000条目与总1000版本，目录256 KiB/版本2 MiB、固定30秒等待及每store两笔容量，超时后保留名额直到摘要结束。仅源码文档，未编译、测试、执行或发布；完整边界和未执行示例见[上下文历史Mock](context-history-mock-runtime.md)。模拟响应不是生产认证、来源真实性或持久审计证明，R-003仍缺运行/真实数据/客户端证据。

## 2026-11-04 MCP上下文历史与对比增量

list_context_item_history({item_id,before_version?,limit?})与get_context_item_version({item_id,version})保留原输入及完整WCP封套JSON文本，改接专用context-history执行器。新增compare_context_item_versions({item_id,from_version,to_version})，两版本必须不同的正安全整数，方向不排序。共享查询限制4 KiB并拒绝未知/身份/范围/写字段、kind及非普通JSON；目录默认25、最多100，下一页保留item_id/limit并使用data.next_before_version。不新增资源模板或自动翻页。

发现、客户端要求判断及直接执行均要求schema_version=1、authenticated_client=true、有限且未过期token_expires_at、实际context.read、完整tenant/workspace/project/actor ULID和本地client/trace标识；admin不能替代实际能力。身份由可信上下文一次复制，参数不能覆盖。清除继承idempotency_key/expected_version/if_match，每次读取使用独立上下文与参数副本，经既有ApiGateway进入相同Policy/Audit；内部GET查询字段放body，外部REST仍沿URL参数。每份完整结果再次检查restricted权限，第一份失败不继续第二份。

目录成功256 KiB、单版成功2 MiB、错误16 KiB，核对整数HTTP状态（成功仅200、失败400–599）、JSON媒体类型、匹配trace且无ETag，再共享解析整个有界响应，校验原目标/版本/分页/来源及快照范围与历史确认。单版先核对Node SHA-256下{item,archived_at}规范JSON摘要；不一致返回CONTEXT_HISTORY_HASH_MISMATCH，摘要能力异常返回CONTEXT_HISTORY_INTEGRITY_UNAVAILABLE，不返回未经检查的快照。历史目录仅检查保存摘要格式，不能代替单版正文核验。

三个工具每ApiGateway共用两笔在途容量及每调用30秒本地总期限；比较的两次读、解析、摘要、比较及序列化共用原期限。MCP_CONTEXT_HISTORY_BUSY/TIMEOUT为固定不自动重试错误；本地超时后占用保留直到底层读取/工作真正结束，迟到结果丢弃，不继续第二读。同步解析/摘要/序列化前后检查期限，但不会抢占同步CPU工作；不承诺数据库取消、外层HTTP发送期限或全局进程容量。

比较JSON文本保留与SDK一致的本地对象：schema_version=1、kind=context-version-comparison、comparison_origin=local、read_consistency=separate-reads、content_state=snapshot-hashes-checked、source_state=not-checked，含原query、可信identity_constraints、完整from/to封套及共享comparison，无额外data封套。正文/属性/历史字段/来源/确认比较规则沿共享模型。组合业务JSON上限16 MiB，MCP content转义结果上限32 MiB+4096；单读转义上限为对应业务上限两倍加4096。超限整次失败，不截断或返回部分比较。固定同trace错误只保留有限代码及本地消息，丢弃上游详情与重试建议。

兼容变化：prepareMcpTool对三个工具均返回MCP_TOOL_EXECUTOR_REQUIRED，调用方需使用dispatchMcp或executeContextHistoryTool以完成整个读取和结果校验；旧缺真实客户端/期限/完整封套或提供非安全版本的fixture需迁移。工具来源和正文是不可信历史参考，摘要自洽不认证来源或当前有效性，也不是两次读取一致性证明。没有新增SDK依赖、REST操作、数据库schema/迁移或写行为。仅源码文档人工审阅和格式/文本检查，未编译、类型检查、测试、执行MCP/API/数据库或发布；Mock源码适配见上述独立增量，运行证据待补，R-003仍未完成。

## 2026-11-04 CLI上下文历史与对比增量

CLI网络main、直接callGateway及嵌入runWorkctx三入口使用专用context-history适配器。context history/version从通用读取迁到SDK完整有界读取，新增context compare复用compareContextItemVersions；没有新增服务端比较操作。每次恰一--json或--json-file（最多4 KiB，严格UTF-8、稳定普通文件），网络可用有界--json -，嵌入不读取进程stdin。文件/stdin读取在SDK预算前完成；--timeout-ms为1–2147483647毫秒，默认30000。拒绝重复/未知参数、--key、--output、写字段和输入kind。

history输入为{item_id,before_version?,limit?}，默认25最多100；version为{item_id,version}；compare为{item_id,from_version,to_version,expected_actor_id,expected_client_id}。两版本必须不同的正安全整数，保留原方向，不排序。history/version可提供成对expected_actor_id/expected_client_id，compare必须提供；账号为ULID、客户端为本地ID。项目范围沿原配置，身份只作相等约束，网络固定本次token并发送SDK读取头，服务端核对实际已验证身份。下一页保留原条目、页大小与身份，并使用data.next_before_version，不自动续页。

沿SDK目录256 KiB、单版2 MiB、Fetch错误16 KiB限制及完整trace/版本/来源/范围/分页校验。版本读取必须核对快照SHA-256；两版本在同一预算内依次读取、校验及比较，首读失败不发第二读，任一失败不返回部分结果。history/version输出完整WCP封套；compare输出原WcpContextComparisonResult本地对象，无额外data包装：query/identity_constraints/from/to/comparison及local/separate-reads/snapshot-hashes-checked/not-checked标记保留。摘要相符不是来源真实性、当前有效性或两次读取一致性证明。

嵌入入口先复制可信上下文并清除idempotency_key/expected_version/if_match，要求明确认证、有限且未过期的token_expires_at和实际context.read。显式身份须与可信actor/client相同；每次SDK派发核对实际GET路径、顺序、全部头、无正文及响应模式/大小，调用前后及输出前再检查期限与权限。完整解析后的restricted摘要/版本要求data.restricted.read，包括比较第一份结果，拒绝后不继续第二份。每router最多两笔在途历史读取，SDK本地超时后仍占用槽位直到底层router实际结束，迟到结果不返回。

未执行的输入文件示例（条目与身份需替换成实际值）：

```json
{"item_id":"context-example","from_version":2,"to_version":3,"expected_actor_id":"01ARZ3NDEKTSV4RRFFQ69G5FAV","expected_client_id":"workctx-cli"}
```

仅源码文档人工审阅及格式/文本检查，未编译、类型检查、测试、执行CLI/SDK/Mock/API/数据库或发布。没有自动重试、下载、保存或修改记录；MCP/Mock源码接入见上述独立增量，运行证据仍待补，R-003未完成。

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

兼容变化：原参数调用继续可用，但现在需要完整项目范围、合法本地trace/client、能提供完整匹配响应及支持bounded-json/signal的传输；非法未知字段不再忽略，失败统一为Promise拒绝。单版/比较需要WebCrypto。CLI复用SDK、MCP复用共享契约及Mock历史存储的专用接入见上述独立增量。无新Gateway路由/schema、数据库/迁移、依赖或写入行为。本次仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、运行SDK/Mock/CLI/MCP/API/数据库或发布；自定义传输、凭据切换、取消/期限、摘要和真实数据兼容仍待运行证据，R-003未完成、evidence为空。

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

Web context/navigation统一主页面及历史导航。主页面只接受q/layer/classification/status/type/view/cursor/limit/item/pack/return_to的单值已知字段，筛选复用parseContextItemListQuery，页大小默认25、可选1–100（后续目录增量）；view仅active/archived（省略active），拒绝未知枚举、数组、重复字段、超长文本或非法游标，不再截断文本或忽略无效筛选。item沿既有历史ID规则，拒绝空白、控制字符和点路径；pack必须ULID。原搜索返回仍只允许item/return_to，绑定已验证搜索页的context_item及同一ID。

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

`POST /v1/workbench/query` 的 `operation=context` 支持 query/layer/classification/status/item_type，以及 `limit`、`cursor` 和布尔值 `archived`。默认每页 25 条，limit 必须是 1–100 的整数。archived 默认为 false；true 只返回已归档条目，列表中的 archived_at 为归档时间，活动条目为 null。空筛选值表示不筛选，query/item_type 会去除首尾空白；未知字段、非法游标或超限参数返回 `INVALID_INPUT`。列表继续返回原有投影字段和正文；完整目录增量将version规范为安全整数、confidence为数值，并统一UTC微秒时间。

```json
{
  "operation": "context",
  "layer": "L4",
  "status": "proposed",
  "limit": 25
}
```

响应保持 `data: [...]`，增加原scope/query回显，有后续条目时在**外层**增加字符串 `next_cursor`。下一次请求将它传为 `cursor`，保留同一筛选条件和页大小；没有 next_cursor 时停止。旧调用方不能再把一次列表请求当作全部数据，需要显式处理分页。该游标与同步接口 `data.next_cursor` 的数字含义不同。

排序保持优先级 High → Medium → Low，然后 updated_at 倒序、ID按C顺序升序。使用最后一条的排序位置继续，不要求边界条目仍然存在；SQL 读取最多 limit + 1 条。时间边界保留 PostgreSQL 微秒精度，避免同一毫秒内的记录被跳过。019 原排序部分索引仅创建了迁移文件，尚未执行；C排序下的索引计划尚无运行证据，列表功能不依赖该索引存在。

v2游标包含排序位置及范围/筛选摘要，绑定 tenant/workspace/project、restricted 读取能力、归档视图、规范化筛选条件和limit。切换项目、权限、归档视图、筛选或页大小后应从第一页开始；旧v1游标也需要重新从第一页获取。游标不是授权凭据，每页仍独立检查鉴权、范围和当前分类。

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
