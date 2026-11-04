# 项目文件目录（源码阶段）

日期：2026-11-04。仅源码、文档与人工审阅；未编译、类型检查、测试、执行SDK/产品/API/SQL/数据库或发布。R-001保持未完成，本增量evidence为空。

## HTTP与查询

新增`GET /v1/artifacts`，操作名`artifact.registry.list`，与同路径POST创建区分。要求真实artifact.read、已验证且未过期客户端、完整原租户/工作区/项目和当前项目/资料可见性；admin角色不替代能力。已提供的X-Expected-Actor-Id/X-Expected-Client-Id仍只作可信身份相等约束。入口沿现有策略与授权决定审计，不新增对象下载或导出审计。

| 字段 | 规则 |
| --- | --- |
| query | 可选名称字面子串，输入最多255个JS字符，去除首尾空白后空串等同省略；拒绝控制符和无效代理字符；仅ASCII A–Z折叠，其他Unicode保持原样 |
| classification | 可选public/internal/confidential/restricted精确值，空串和未知值拒绝；显式restricted而无受限读取能力返回403 |
| limit | 默认20，正安全整数1–20；HTTP使用无前导零单值十进制 |
| cursor | 可选完整上一页next_query内的游标，规范base64url字符串，最长256字符 |

HTTP每个字段只允许一次，未知字段拒绝；GET无正文，拒绝写键/If-Match/写版本、Range/条件缓存、content-encoding、transfer-encoding和非零content-length。JSON查询仅用于SDK/内部路由，不放进HTTP GET正文。完整共享查询最多8 KiB，非法查询或不匹配游标400。

名称查询在SQL中使用参数化strpos与ASCII translate，百分号和下划线没有通配符语义。返回项通过相同共享折叠再次匹配；没有语言相关的隐式大小写规则。分页按artifact_id的C序倒序，不按updated_at排序，也不把ULID顺序描述为严格保存时间。页内不会重复ID，下一页位置排除最后一个已返回ID。

## 当前可见性和分页边界

游标保存版本标记1、SHA-256绑定值和最后artifact_id。绑定值来自固定命名空间、可信tenant/workspace/project/actor/client、当前data.restricted.read能力、规范query/classification及limit。续页逐次重算，范围/身份/能力/筛选/页大小变化须重新从首屏读取。其内容不含凭据；绑定值不是签名，也不是权限凭证，调用方构造位置不会绕过每次权限检查。

首屏与后续页都读取当时当前可见元数据，没有固定历史上界或跨页事务。新增文件、分类/权限变化、外部元数据修改可能影响后续结果；新文件需重新读取首屏，不能把一次遍历认定为全项目一致快照或全历史审计。

每页最多20项，用第21项判断has_more；探测项的元数据、范围、分类与筛选同样验证。next_query包含规范筛选、limit和新cursor；has_more=false时为null。SDK不自动翻页，调用方必须显式传递完整next_query，不能只复制位置或改用旧筛选。

## 持久读取

`PersistentArtifactService.listArtifacts(access, input={})`在既有数据库事务中锁定当前可见父项目，单语句选择当前范围、未删除、允许分类且匹配筛选的资料，并对最多limit+1条当前行FOR SHARE。复用003的范围索引和现有版本主键，不新增表/迁移；目录排序和名称筛选可能扫描更多候选，当前源码不声明大项目性能基线或严格数据库内存上限。

SELECT对to_jsonb(current row)和当前版本metadata_snapshot分别检查JSONB文本字节数，不超过2 MiB才传回完整JSON。SQL中的字节检查和参数只写入源码，没有连接数据库或执行。保留驱动返回的原时间列供既有毫秒UTC转换使用，避免将PostgreSQL JSONB带偏移日期误当作已规范的Z时间。

选中行和探测行先有界复制，复用从原current读取中提取的currentRow核验：当前元数据与可信保存快照完整一致，版本/范围/目标、storage_key、hash、size、trace和保存时间对应。快照缺失保持ARTIFACT_LEGACY_UNVERIFIED，不以当前行补造历史；损坏/超限/顺序或筛选不符整页失败。仍检查当前分类读取权限，不跳过坏记录制造部分成功。

既有当前/指定历史读取继续沿原路径，不受新目录JSON投影限额改变。目录只投影摘要，不执行对象I/O、计算正文摘要、恢复旧版本、创建原回执或写业务数据。

## 配置与响应

Gateway新增可选`artifact_registry: ArtifactRegistryReader`，只要求listArtifacts并负责当前可见性、完整快照和游标绑定；与artifact_storage互斥。配置artifact_storage时自动使用同一持久服务。旧artifact_reader、artifact_versions、artifact_content不会自动宣称支持项目目录；未配置返回503 ARTIFACT_STORAGE_UNAVAILABLE。提供自定义reader时也必须遵守全部查询/身份/权限约束，Gateway再次有界验证完整输出和restricted项。

`ArtifactRegistryEnvelope`只含schema_version=1、本次trace、与项逐一对应的artifact来源及data。data包含tenant/workspace/project、规范query、items、has_more、next_query和content_state=not-checked。每项是artifact_id加共享ArtifactVersionSummary：当前版本/名称/类型/分类/hash/大小/原trace/时间/来源数量，无完整来源列表、存储地址、正文、ETag或上传回执。

完整响应最多256 KiB，单条摘要解析另限16 KiB。共享parseArtifactVersionSummary从原历史目录解析中提取，两个目录使用相同字段校验，历史排序与上界仍在原版本目录解析器中检查。当前目录解析核对范围、原query、ID倒序/排他位置、筛选、条数和完整next_query；续页游标绑定值必须与原cursor相同。客户端不从哈希推导权限，首屏绑定由可信服务端负责。

响应private/no-store，无HTTP或外层ETag。常见错误：参数/游标400；真实能力/客户端/受限读取不足403；当前项目不可见404；缺可信快照409；损坏500；未配置/存储不可用503。错误不带部分列表，空列表只有成功读取且没有当前可见匹配项时返回，不证明项目历史中从无文件。

## SDK

`client.listArtifacts(input?, options?)`导出ArtifactRegistryQuery/Item/Page/Envelope，复用WcpArtifactReadOptions默认30秒本地等待及signal。异步前捕获完整查询、范围与可选账号/客户端前置约束，构造GET路径；成功256 KiB，Fetch错误16 KiB，自定义transport结果也做有界完整解析。错误沿固定有限消息、retryable=false和read_kind=registry，不回显底层内容，不自动重试或下载。

```ts
// 开发示例，未执行；实际账户必须具有artifact.read。
const page = await client.listArtifacts({ query: 'report', classification: 'internal', limit: 20 });
// 用户选择下一页时，保留全部筛选和游标。
if (page.data.next_query) {
  const next = await client.listArtifacts(page.data.next_query);
}
// 选中某项后明确读取当前/历史详情，不将目录摘要用作写条件。
const selected = page.data.items[0];
if (selected) {
  const detail = await client.getArtifactVersion(selected.artifact_id, selected.version);
}
```

取消或本地超时丢弃迟到结果，不能保证底层数据库工作停止。目录不会保存本地文件、获取对象正文、查询上传结果或修改原写请求。

OpenAPI、Schema自动一致性、性能与权限/并发/错误运行证据后续补齐；独立Schema源码及工作台、CLI/MCP和Mock接入见后续章节。不新增依赖或数据库schema，不编译、测试、运行服务、执行SQL/迁移或发布。

## 工作台目录（源码阶段）

新增`/artifacts/browse`服务端页面，从文件ID查询页及版本目录页可在新标签页进入。默认读取当前认证项目首屏，名称、分类和每页数量以GET表单提交；查询仅接受query/classification/limit/cursor，拒绝未知字段、重复值、非规范页大小及非法游标。界面空分类表示全部可读分类，在共享查询前省略；名称沿共享规则规范化，默认20且最多20条。

搜索表单不携带cursor，因此提交后从首屏读取；清除筛选表单重新读取默认首屏。下一页只使用服务端完整next_query，不把未提交字段混入续页；翻页后表单恢复为当前查询。游标无效时尽可能保留有效筛选，用户可显式重新搜索。没有自动翻页、后台预取或自动下载。

`getWorkbenchArtifacts`沿既有会话与当前项目请求GET /v1/artifacts，复用历史目录有界读取分支：无缓存、默认30秒本地期限、成功256 KiB/错误16 KiB、匹配trace、200 JSON且无ETag，再核对完整共享封套、范围、原查询及续页。底层错误只映射为固定提示，不回显上游细节；认证/权限错误沿工作台既有处理，项目不可见、旧快照缺失、参数/游标失效及服务不可用分别说明，失败不显示部分列表。超时不保证底层服务停止。

页面显示实际返回的项目和筛选、当页数量、名称/版本、分类、类型、字节数、来源数量及保存时间；数量不是项目总数。名称链接打开所见保存版本，另提供当前详情和截至所见版本的历史，均新标签页且关闭预取。元数据摘要不代表正文可用或可导出，内容需在详情页另行请求。明确说明按文件ID倒序、每页只反映当次可见记录，不能作为跨页快照；租户、工作区和本次trace收在读取信息中。

该增量无新服务端目录协议、数据库schema、依赖或浏览器持久存储，不写文件/上传回执，也不修改任何原写请求。仅源码文档与人工审阅；未编译、类型检查、测试、浏览器渲染、执行SDK/产品/API/数据库或发布。R-001仍未完成，浏览器行为、无缓存重读、权限与错误呈现、响应边界及无预取行为尚无运行证据。

## 命令行与 MCP（源码阶段）

2026-11-04新增`workctx artifacts list --json-file QUERY.json [--timeout-ms 30000]`。也可用`--json '{}'`读取首屏，两种JSON来源必须且只能提供一种；没有隐式读取整个项目的模式。输入是共享`ArtifactRegistryQuery`，仅允许query/classification/limit/cursor，全部可选；名称去首尾空白、空串省略，分类必须为明确枚举值，不能传空分类。默认20最多20，输入最多8 KiB；未知字段、无效游标、重复参数、`--key`、`--output`及外层`--limit`均拒绝。

文件读取沿既有稳定常规文件检查和严格UTF-8，网络`--json -`使用有界stdin；嵌入runWorkctx不读取进程stdin。文件与stdin读取在查询预算前完成，不宣称这些等待可取消。主命令入口、网络callGateway与嵌入均经artifact-queries复用SDK listArtifacts，完整成功响应256 KiB，HTTP错误16 KiB，默认30秒本地期限，可显式--timeout-ms 1..2147483647。registry失败现在有独立固定提示：项目不可见、目录存储/期限异常、保留完整next_query或去掉cursor重读；其他读取类别的错误文案和所有错误码保持。

嵌入入口先复制可信上下文，清除继承的idempotency_key/expected_version/if_match，派发前后检查已验证、未过期且具有实际artifact.read。SDK产生的GET、规范URL、无正文、范围/trace头与256 KiB限制必须匹配预先捕获的查询，再调用artifact.registry.list；SDK最终核对完整scope/trace/query/排序/筛选/next_query。网络HTTP与嵌入使用相同返回契约，但本地超时不能保证路由或数据库操作停止。

成功stdout为完整`ArtifactRegistryEnvelope`，不附本地保存包装。下一次将data.next_query完整对象作为查询，不只复制cursor或传整个响应；next_query=null表示当次条件下没有更多可见结果。变更原账号/客户端/范围/权限/筛选/页大小需移除cursor重新读取首屏。目录按ID倒序且各页反映当时当前记录，不能证明全项目一致快照。摘要里的artifact_id和version可交给`artifacts version`明确读取所见版本；目录自身不获取正文、保存文件或授予写条件。

MCP新增`list_artifacts`，参数与共享查询相同，允许空对象首屏查询。目录schema说明名称长度、分类、页大小及游标形状，实际完整解析仍校验8 KiB输入和规范游标。工具发现、prepareMcpTool和专用执行器均检查schema_version=1、完整可信范围/账号/客户端、有效trace、authenticated_client=true、有效令牌及实际artifact.read；admin不替代。显式restricted分类还需data.restricted.read，返回项再核对该权限。最终工具名沿HTTP已验证客户端检查，普通MCP正文限额保持，无大正文扩容资格。

专用执行器首次异步前捕获查询/身份，清除继承写条件；内部ApiGateway通过固定GET /v1/artifacts及body中的查询字段路由，公开HTTP仍使用URL参数。每个ApiGateway独立最多两笔项目目录读取，与历史目录各自计数；固定30秒单调本地等待，超时返回后底层工作继续占槽直到实际结束。没有自动重试、共享全进程容量或对底层数据库的取消保证。

成功需200、JSON、原trace响应头且无ETag，完整封套256 KiB，错误16 KiB且trace一致；共享解析完整核对范围/查询/摘要/ID顺序/筛选/续页。返回前再次核对身份期限和本地期限；返回单项文本JSON，MCP转义后content整体再限512 KiB+4096字节。失败只保留有限代码与固定消息、retryable=false、read_kind=registry、content_state=not-checked、upload_dispatch_state=not-sent，沿协议isError=true输出，不泄露上游message/details或返回部分目录。

CLI/MCP不会自动翻页、下载正文、上传、查询原回执、写本地文件或恢复旧版，也没有新增资源URI。无服务端目录、数据库schema、迁移或依赖变化；仅源码文档人工审阅，未编译、类型检查、测试、执行CLI/MCP/SDK/API/数据库或发布。OpenAPI、Schema自动一致性及运行证据待补，Mock和独立Schema源码见后续章节，R-001保持未完成，evidence为空。

## Mock目录接入（源码阶段）

2026-11-04新增MockArtifactStore项目目录GET，既有MockWcpServer的artifacts配置可直接接SDK listArtifacts。只读同一store已上传的当前版本，固定模拟会话与共享范围/查询/分页规则，默认20最多20；名称ASCII字面子串、精确分类及可读权限在分页前过滤，完整next_query绑定原身份/受限能力/筛选/页大小。

项目目录GET允许8192字符路径以容纳Unicode编码，内层查询8 KiB；其他路径仍限512。Web Crypto仅计算游标绑定，沿同一命名空间和字段顺序，摘要后再检查取消/到期并同步选择当前记录；每store独立最多两笔目录读取，底层摘要未结束仍占名额。当前与探测记录各先在2 MiB内复制并核对当前版本Map一致，摘要独立16 KiB、完整封套256 KiB及更低调用方限额；不读取正文、不增加版本/回执/释放记录或自动翻页。详见[Mock项目文件目录](artifact-mock-runtime.md#项目文件目录)。

模拟数据仍从空store的实际模拟上传产生，没有缺失/损坏历史种子、动态权限/分类、真实数据库锁或持久审计；同形游标不证明不同store数据相同，当前分页不是跨页快照。只开发源码与文档，不运行SDK/Mock或测试，不编译、类型检查、执行API/数据库或发布。OpenAPI、Schema自动一致性、真实服务兼容性及运行证据仍缺，独立Schema源码见下节，R-001保持未完成且evidence为空。

## 独立JSON Schema（源码阶段）

2026-11-04新增自包含JSON Schema 2020-12文件`packages/contracts/schemas/artifact-registry.json`及显式包子路径`@planemem/contracts/schemas/artifact-registry.json`。根为规范ArtifactRegistryEnvelope，提供ArtifactRegistryQuery、ArtifactRegistryNormalizedQuery、ArtifactRegistryNextQuery、ArtifactRegistryItem、ArtifactRegistryPage和ArtifactRegistryEnvelope锚点。先注册完整资源再解析片段；$id仅是契约标识，不是托管网址。详见[Schema使用说明](../../../packages/contracts/schemas/README.md#项目文件目录)。

输入四字段可省略，limit注释默认20；规范回显必须包含limit，名称若存在则非空且没有外围空白；续页还必须包含cursor。闭合对象限制未知字段，约束分类、页大小、安全整数、公开摘要、来源形状及has_more-next_query关系。静态示例包括空页与结束单项页，均为手工开发示例，没有上传、查询、游标生成或运行校验。

Schema不会执行base64url元组解码、身份/权限绑定、原scope/trace/query比较、名称与分类匹配、ID倒序及排他位置、来源逐项对应、完整next_query比较、UTF-16/字节限额或日期精确往返。这些继续由共享解析及真实服务端处理；仅满足cursor字符模式并不代表有效游标，结构通过也不表示有读取/下载/写权限或正文可用。

资源不依赖历史目录Schema，不修改旧Artifact实体或生产解析器；无新依赖、数据库schema、生成SDK或发布包。此次只修改Schema源码、包路径和文档，未编译、类型检查、测试、执行生成器/校验器/SDK/Mock/API/数据库或发布。完整OpenAPI、自动生成/兼容性及运行证据仍待补齐，R-001保持未完成，evidence为空。
