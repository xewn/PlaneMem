# 附件历史版本目录（源码阶段）

2026-11-04：新增持久服务、HTTP与SDK的只读版本目录。已有当前/指定版本元数据读取只能按已知版本取回；目录提供版本发现，选中后仍显式调用原详情或下载入口。只修改源码文档，未编译、类型检查、测试、执行SDK/HTTP/数据库/SQL/迁移或发布。

## 工作台版本对比（源码阶段）

2026-11-04新增`/artifacts/compare`，只读比较同一文件的两个明确保存版本。URL仅允许artifact/from_version/to_version，拒绝重复、未知字段、孤立版本和非规范正十进制安全整数；文件ID必须为ULID。空参数或只预填文件/单边版本只显示选择表单，不读取元数据；完整选择需两个不同版本。基准可以较新或较旧，始终保留用户指定方向，不自行排序或替换为当前版本。

当前/历史详情与历史目录每项增加预填基准的新标签页链接，关闭预取。历史当前页至少两项时提供两个显式下拉选择，值来自本页实际记录，跨页比较可从单项入口自行填写另一版本；翻页改变版本集合时重置选择。对比页可重新提交两版本、在新标签页查看两份固定详情、反向比较或浏览历史。URL不携带身份、原请求键、内容或来源。

新`getWorkbenchArtifactComparison`捕获一次有效签名会话、范围与已校验Gateway地址，按用户选择顺序读取两份指定历史元数据。两次GET合计30秒（不含会话读取），每份成功2 MiB、错误16 KiB；复用artifact-read-response的200/JSON/UTF-8/长度/trace/无ETag核验及完整共享封套解析，核对同一项目/文件及各自版本。发送前、响应到达、解析后和最终比较后检查期限/到期；任一读取失败不返回部分对比、不回退当前记录或其他版本，错误固定。每次读取仍独立接受Gateway当前/历史权限检查；两个读取不是一个数据库快照，不声称跨请求权限或数据不变。

纯比较模型重新解析两份完整公开元数据并核对范围和文件一致，逐字段比较name/mime/classification/size/sha256/created_at/updated_at/trace_id；显示原值、Same/Changed及差异字段数，版本本身作为列标题。该模型与完整查询解析现提取至contracts，输入元数据各先按2 MiB普通JSON复制，Web保留自己的部分预填/URL层并复用共享完整模型。hash和size均一致仅标记保存的内容描述一致，不证明正文当前可取或实际字节已核验。ETag不作为跨版本内容差异指标。

来源数组按原位置比较完整type/id/revision/uri，保留顺序和重复项；缺失引用区分于可选字段缺失，revision=0保持零值。显示全部保存引用、位置上的相同/变化/增加/移除及双方条数，不按ID去重或把重排推断为语义增删；URI仅文本展示，不自动访问，引用对象的当前权限、版本和可用性未检查。两份元数据均完整可读才展示结果，没有截断或部分成功。

无下载正文、恢复旧版、上传、查回执、浏览器持久保存或原请求改写；沿现有读取授权审计，没有新增公共协议/Schema/依赖/数据库。仅源码文档人工审阅，未编译、类型检查、测试、浏览器渲染、运行产品/SDK/CLI/Mock/API/数据库或发布。URL/选择方向、来源顺序与重复、权限和会话到期、响应限额/总期限/错误路径及浏览器兼容仍待运行证据，R-001保持未完成。

## SDK版本对比（源码阶段）

2026-11-04新增`client.compareArtifactVersions({artifact_id, from_version, to_version}, options?)`。完整查询先按4 KiB普通JSON复制并校验，拒绝额外字段、缺字段、同版本、非正/非安全整数，保留用户方向。构造WcpClient的context须显式含project_id、actor_id和client_id；两次读取始终携带同一范围和账号/客户端相等约束，不从文件元数据或令牌文本推断调用身份。条件不是凭据，Gateway独立验证真实认证会话及每份当前/历史可见性；transport若刷新凭据，只能由相同账号/客户端继续满足这些约束，不承诺复用完全相同的令牌。

沿WcpArtifactReadOptions的timeout_ms/signal，默认30秒单调总等待预算覆盖两个顺序历史读取及本地完整比较。首次异步前捕获查询、上下文与选项，并丢弃继承的idempotency_key/expected_version/if_match；既有单份读者复用同一总预算信号，每份2 MiB成功、Fetch16 KiB错误，纯JSON复制自定义transport结果并核对scope/trace/目标/历史版本。两次请求沿调用者原trace作关联。第一份失败不派发第二份，第二份失败不返回第一份；超时或取消不发布迟到结果，不自动重试或改选当前。transport自有期限可能更短，取消不保证远端工作停止。

返回类型`WcpArtifactComparisonResult`是本地组合对象：schema_version=1、kind=artifact-version-comparison、comparison_origin=local、read_consistency=separate-reads、content_state=not-checked，另含完整query、identity_constraints、from/to两份既有读取封套和comparison。保留各份服务器数据/trace，不伪造新的Gateway聚合响应、审计记录、原上传结果或一致事务快照。比较结果不返回文件字节，也不下载、保存、恢复或上传。

contracts新增ArtifactComparisonQuery/ArtifactMetadataComparison、parseArtifactComparisonQuery及compareArtifactMetadata，SDK根入口一并导出。共享函数各自有界复制完整输入，拒绝非普通JSON、访问器、循环及超深/超复杂对象；比较同范围同文件的不同版本，八字段和按位置来源规则与工作台一致，不忽略重复或可选字段，也不访问URI。直接调用compareArtifactMetadata只验证所给结构并计算差异，不认证记录来自服务器，不授予权限或证明内容一致。工作台保留原页面/会话组合读取，只替换完整查询和比较模型。

```ts
// 开发用法示例，未执行。client 已配置固定 project_id、actor_id 和 client_id。
const result = await client.compareArtifactVersions(
  { artifact_id: artifactId, from_version: 2, to_version: 5 },
  { timeout_ms: 30_000, signal: cancelController.signal },
);
// result.comparison 是本地差异；from/to 是两次独立历史读取，正文仍未检查。
```

固定允许列表错误使用原trace及retryable=false、read_kind=comparison、comparison_state=not-completed、content_state=not-checked和upload_dispatch_state=not-sent；不回显transport原始异常或上游details。没有新增HTTP/MCP操作、数据库/schema/依赖或Mock专用路由；CLI接入见下节。可通过已有历史读取适配器接入，但未执行SDK、Mock或服务。共享契约自动一致性、独立比较Schema、真实客户端/取消/期限/身份变化和浏览器兼容仍待证据；本次仅源码文档人工审阅，未编译、类型检查、测试、运行产品/API/数据库或发布，R-001保持未完成。

## 命令行版本对比（源码阶段）

2026-11-04新增`workctx artifacts compare --json-file QUERY.json [--timeout-ms 30000]`，也支持`--json OBJECT`；两种输入必须且只能提供一种。网络入口的`--json -`沿既有4 KiB有界stdin读取，嵌入runWorkctx拒绝stdin；文件沿既有稳定常规文件和严格UTF-8读取。文件/stdin等待不计入SDK读取预算，也不宣称可取消。拒绝--key、--output、重复/未知参数和输入中的未知字段。

命令查询对象仅含五个必填字段：artifact_id、from_version、to_version、expected_actor_id和expected_client_id，整体最多4 KiB。前三个字段沿共享ArtifactComparisonQuery，必须两个不同正安全整数，保留方向；expected_actor_id须符合SDK context的ULID规则，expected_client_id沿完整身份文本约束。租户/工作区/项目来自原配置，不能在JSON中覆盖；预期账号/客户端只是核对条件，不替代令牌或授予读权限，也不从令牌文本推断身份。不要求artifact.write或调用上传身份接口。

```json
{
  "artifact_id": "01J000000000000000000000001",
  "from_version": 2,
  "to_version": 5,
  "expected_actor_id": "01J000000000000000000000002",
  "expected_client_id": "editor"
}
```

以上仅静态用法示例，需换成实际文件/版本/账号/客户端，未执行命令。网络主入口与callGateway复用artifact-queries和SDK compareArtifactVersions；预先捕获配置、令牌和范围，SDK上下文加两项相等约束，两次请求使用同一捕获令牌。默认30秒总期限，可设1..2147483647毫秒，覆盖两个历史读取及完整比较；成功各2 MiB、Fetch错误16 KiB。返回前完整核对封套/项目/文件/所选版本及本地比较，首读失败不派发第二读，任一失败不输出部分对比或自动重试。

嵌入入口捕获可信context并清除继承写键/版本/条件，读取前后核对authenticated_client、有限未过期token_expires_at、实际artifact.read及五项原身份一致；admin不能替代能力。transport按原from/to顺序最多接受两次准确历史GET，检查完整路径、无正文、完整scope/trace/账号/客户端头、bounded-json及2 MiB上限，超出次数/换序/改版拒绝；再映射既有artifact.version.read并使用复制的可信context。SDK计算完成后再查权限/有效期，任一失败均不发布组合结果。没有新的artifact.compare网关操作；两次读授权审计沿原路径。

成功stdout直接输出WcpArtifactComparisonResult，保留query、identity_constraints、from/to原封套及comparison，并标明local/separate-reads/not-checked；没有外层data，不能按目录页封套读取。相同或不同都退出0，差异本身不是错误；读取/权限/参数失败沿现有退出码和固定错误路径。公共退出码判定兼容该本地对象，原artifacts receipt --output的保存失败仍退出1。不写结果文件、自动下载或读取正文，不上传/恢复旧版/查回执。

仅源码文档人工审阅；未编译、类型检查、测试、执行CLI/SDK/Mock/API/产品/数据库或发布。参数/文件/stdin边界、完整返回形状、网络/嵌入路径、身份不匹配和过期、两次请求期限/顺序及现有回执保存兼容仍待运行证据。无新公共协议、Schema、依赖或数据库变化，R-001保持未完成且evidence为空。

## 查询与续页

`GET /v1/artifacts/{artifact_id}/versions`，操作名`artifact.versions.list`，要求真实`artifact.read`。使用已验证令牌的租户、工作区、项目、账号和客户端；管理员角色不替代能力，原账号/客户端预期头仍只作相等约束。输入字段为：

| 字段 | 规则 |
| --- | --- |
| artifact_id | 路径ULID；SDK/服务输入中的必填字段 |
| limit | 可选，默认10，整数1–20 |
| at_version | 可选正安全整数，包含此版本的目录上界；不能超过当前版本 |
| before_version | 可选正安全整数，严格小于此版本；必须同时提供at_version且不大于它 |

HTTP分页参数只接受单个无前导零的正十进制整数；重复、未知、空值、负数、小数、不安全整数拒绝。GET不接受正文、Range、缓存条件、写条件或内容编码。SDK和服务输入先按4 KiB纯JSON快照校验，拒绝额外字段、访问器和非普通JSON。

未提供at_version时，在本页事务内从当前附件固定snapshot_version；提供时沿用原上界。按版本倒序读取最多limit+1条，后一条用于判断has_more。成功data保留规范query（补全默认limit）、snapshot_version、items、has_more和next_query。续页有更多时返回完整artifact_id/limit/at_version/before_version，before为本页最后版本；无更多时next_query=null。调用方原样使用next_query，不自行换成最新版本。新追加版本不会插入已固定上界的后续页，但每页仍重新验证当前可见性，权限变化可能使续页失败。at_version不是签名游标、数据库历史事务快照或当前写入预期版本。

目录列出所选范围内实际存在且可核验的历史行，返回空页不代表附件不存在，也不证明所有版本连续无缺失。目录不是全库完整性审计；没有总数，也不根据当前版本号生成虚构历史项。before_version=1可得到空页。

## 响应与内容边界

共享契约`ArtifactVersionsQuery/ArtifactVersionSummary/ArtifactVersionsPage/ArtifactVersionsEnvelope`位于`packages/contracts/src/artifact-versions.ts`。标准封套只含schema_version=1、本次trace、单个artifact来源和data，没有revision或ETag。data含完整租户/工作区/项目范围及content_state=not-checked。完整封套最多256 KiB；解析核对范围、目标、query、上界、严格倒序、条数、完整下一查询和每条元数据，失败不返回部分目录。

每项仅含version/name/mime/classification/sha256/size/trace_id/created_at/updated_at/source_ref_count。trace与时间来自历史快照，created_at是附件最初创建时间，updated_at是该版本记录时间。来源全文及元数据详情由原getArtifactVersion取回；目录不含storage_key、桶地址、下载URL、对象正文、原上传键或原命令回执。历史记录的hash/size不等于当前对象已读取，目录本身也不授予下载、恢复或写入权限。

## 持久读取与配置

`PersistentArtifactService.listVersions(access, query)`复用既有事务和项目/当前附件共享锁，先检查当前项目、当前附件及其可信版本快照；整个目录读取期间不释放这些锁。版本表使用既有artifact_id/version主键进行范围排序，不新增表、索引或迁移；没有对象存储I/O或业务数据写入。

本页最多取21条历史记录，SQL在返回metadata_snapshot前检查其JSONB文本字节数，每份不超过2 MiB；超限报存储无效，空历史快照报ARTIFACT_LEGACY_UNVERIFIED。全部返回及探测行都复用versionRow检查完整历史快照、原范围/目标/版本、storage_key、SHA-256/size、原trace、创建时间及记录时间，然后投影摘要。自定义数据库适配器的快照也做有界纯JSON复制。所有项及探测项都需要历史分类读取权限；不跳过无权或坏记录制造部分成功。当前附件读取沿用既有current方法，它的字段读取不受上述每份历史投影限制；目录行限额不代表整个数据库操作的严格内存上限。

同一服务内的追加/当前修改与此处共享锁协调；跨页不是一个数据库事务，不对绕过服务的外部改库提供不可变保证。服务依赖历史行原有不可变约定，不锁定整个版本表、不开展全历史扫描或修复。缺失可信旧快照继续拒绝，不从当前元数据补造历史。

Gateway新增可选`artifact_versions: ArtifactVersionReader`，要求实现listVersions并负责当前/历史权限及完整性；与artifact_storage互斥。配置artifact_storage时自动使用同一个持久服务。只配置旧artifact_reader或artifact_content不会推断目录能力，未配置目录读者返回503 ARTIFACT_STORAGE_UNAVAILABLE；旧读者接口必需方法不变。共享返回解析再次核验并阻止未授权restricted项，仍沿原路由授权决定审计，不把该审计当作内容读取或下载完成证据。

常见错误保持原Artifact封套：非法参数400、缺能力/历史分类权限403、当前项目或附件不可见404、缺可信历史快照409、存储快照损坏500、目录存储未配置/不可用503。失败不返回部分items，不自动重试。成功与错误使用private/no-store；返回历史元数据不会更新版本、上传或触发恢复。

## SDK

`client.listArtifactVersions(input, options?)`复用`WcpArtifactReadOptions`的timeout_ms/signal，默认30秒本地等待；成功256 KiB，Fetch错误16 KiB。异步前固定完整查询、范围和可选账号/客户端相等约束，只构造必要GET头，不继承写键/版本。自定义transport返回也做完整有界JSON复制和共享解析，取消/超时的迟到响应不能成为成功；底层操作可能继续。

```ts
const page = await client.listArtifactVersions({ artifact_id: artifactId, limit: 10 });
// 只在用户明确要求下一页时执行；不会自动翻页。
if (page.data.next_query) {
  const older = await client.listArtifactVersions(page.data.next_query);
}
// 选定版本后另行读取完整元数据，不将目录上界作为写入条件。
const detail = await client.getArtifactVersion(artifactId, selectedVersion);
```

错误使用现有有限错误码与固定信息、retryable=false，details.read_kind=versions及upload_dispatch_state=not-sent；不回显底层响应、不自动下载/查回执/恢复/上传。SDK根入口导出上述四个契约类型。

独立JSON Schema源码及CLI、MCP、工作台与Mock接入见后续章节；自动生成/一致性及跨存储/并发/权限/分页运行证据仍待补齐，R-001保持未完成且本增量evidence为空。现有指定版本各客户端读取仍保留。无依赖或数据库schema变更。

## 命令行与 MCP（源码阶段）

2026-11-04新增 `workctx artifacts versions --json-file QUERY.json [--timeout-ms 30000]`；查询也可用`--json`，两种方式必须且只能选择一种。JSON为共享ArtifactVersionsQuery：必填artifact_id，可选limit/at_version/before_version；before必须携带原at且不超过它。单份输入最多4 KiB，文件沿用稳定常规文件检查和严格UTF-8；网络入口的`--json -`沿有界stdin读取，嵌入runWorkctx不读取进程stdin。拒绝`--key`、`--output`、额外字段、重复/无关选项；页大小在JSON里，不能传外层--limit。文件/stdin读取在网络预算前，不宣称可取消或包含在查询期限内。

网络callGateway与CLI主入口均接现有artifact-queries；嵌入入口复制可信上下文，清除继承的idempotency_key/expected_version/if_match，并在路由调用前后检查真实artifact.read、已验证客户端和有效期限。两者统一通过SDK listArtifactVersions；嵌入transport严格比对预先固定的规范分页URL、GET、空正文、范围/trace头和256 KiB上限，再用已捕获完整查询调用artifact.versions.list。客户端不会把at_version写入expected_version。

成功stdout是完整ArtifactVersionsEnvelope，保留历史摘要和content_state=not-checked；本次命令只读一页。下一次把`data.next_query`完整对象作为输入，不能仅保留before_version、改成最新上界或将整个响应当作查询。next_query=null即本次范围没有更多行；不等于历史连续性审计成功或文件正文可读。输出不保存文件，成功退出0，参数/读取失败沿既有错误路径，不输出部分页。

MCP新增 `list_artifact_versions`，参数与共享查询相同；发现schema公开ULID、limit 1–20默认10和正安全整数版本，跨字段关系由完整共享解析强制检查。工具只读、可重复查询，不自动跟随next_query。发现、prepareMcpTool及专用执行器均要求schema_version=1、完整可信范围/账号/客户端、有效trace、authenticated_client=true、未过期令牌及实际artifact.read；admin角色不能替代。HTTP MCP沿既有普通正文限额，不新增大正文扩容资格；最终工具名要求验证客户端，内层查询另限4 KiB。

专用执行器在首次异步前捕获查询/上下文，清除写条件；内部ApiGateway按GET路径加body中的查询字段派发，与公开HTTP的URL参数是不同的内部表示。调用仍经过相同policy/audit和持久目录reader。每个ApiGateway独立最多两笔目录读取，默认固定30秒单调本地等待；超时及时返回固定错误，底层未结束继续占槽，不能因超时反复释放名额制造无限后台读取。无自动重试，底层活动不能由本地期限保证取消。

成功必须是200、JSON、原trace响应头且没有ETag，完整封套256 KiB；错误封套16 KiB且trace必须一致。共享解析核对范围、原query、历史摘要、顺序、条数及完整next_query；无restricted权限的摘要再拒绝。返回前重查期限和身份有效期，MCP文本转义后的content整体另限512 KiB+4096字节；这不是网络传输完成或客户端收到的证明。失败仅保留有限错误码和固定消息、retryable=false、read_kind=versions、content_state=not-checked、upload_dispatch_state=not-sent，不回显底层message/details；调用结果沿标准isError=true输出。

两个入口均不读取对象正文、授予下载/恢复/写入权限、查询原上传回执或更改历史状态。选定版本后需另行读取完整元数据/下载，历史目录上界不能当成当前写条件。运行证据仍缺，工作台与Mock源码接入见后续章节；无数据库schema、依赖或目录服务逻辑变化，仅源码文档人工审阅，未编译、类型检查、测试、执行CLI/MCP/SDK/API/SQL/数据库或发布。

## 工作台历史目录（源码阶段）

2026-11-04新增`/artifacts/versions`，使用现有工作台会话和当前选定项目，只接受单值`artifact`、`limit`、`at_version`、`before_version`。空查询显示查找表单；文件ID必须为ULID，数值必须为无前导零正安全整数，limit默认10且范围1–20，before必须带原at且不超过它。重复、未知或不完整参数在页面读取前拒绝，不默默重置游标。

`getWorkbenchArtifactVersions`在异步前复制共享查询，构造规范GET URL，复用gatewayRequest的可信范围/令牌/本次trace、no-store与30秒请求期限。该目录专门沿有界读取器获取完整JSON：成功200且最多256 KiB，错误最多16 KiB；要求原trace响应头且无ETag，完整封套再次核对scope/query/排序/摘要/next_query。读取或解析期间超时不显示迟到成功，401走登录提示；失败只显示固定错误信息，不回显上游message/details。沿用Fetch取消语义，不能据此保证服务端事务已停止。

页面按版本倒序显示名称、类型、分类、字节数、保存时间、来源计数，可展开原hash/记录trace和首次记录时间。页面说明正文与下载可用性未检查、目录不证明历史连续性；历史摘要不作为当前写版本。每项通过`/artifacts?artifact=ID&version=N`在新标签页打开既有完整详情/显式下载入口；目录自身没有下载或恢复操作。

“Older versions”完整传递服务端next_query，固定原上界和页大小；“First page through version N”仅移除before并保持上界。查找表单的“Read latest history”使用明确GET提交，移除旧at/before，重新获取最新上界；不依赖点击同URL的缓存导航。文件详情提供截至所读版本的目录入口，文件主页面提供空查询入口。所有相关Link关闭预取；分页由用户点击，不自动翻页，不写localStorage/IndexedDB或保存下载文件。

空页、缺可信旧快照、当前文件不存在、403拒绝与503未配置/不可用各沿独立提示，失败不会伪装为空目录。页面刷新或项目切换后重新沿当前会话授权；URL只有目标和分页参数，没有身份凭据。跨页仍不是一个数据库事务，目录读取也不确认上传请求结果。

范围仅工作台源码、协调与契约文档；无依赖、数据库schema或服务端目录行为变化。未编译、类型检查、测试、渲染浏览器、执行SDK/CLI/Mock/产品/API/数据库或发布；R-001保持未完成，evidence为空，Schema一致性和运行证据仍待补齐。Mock目录与独立Schema源码见后续章节。

## Mock目录接入（源码阶段）

2026-11-04新增`MockArtifactStore`目录GET，与同路径POST追加分别识别。固定模拟会话、当前项目与资料可见性沿既有规则，目录要求read_artifacts，逐条核对历史分类读取权限；不从请求头或上传身份推导能力。仅目录GET允许limit/at_version/before_version，使用与HTTP一致的解码后单值正安全整数约束和共享查询解析；默认10、最多20，拒绝正文、写/缓存/范围条件、transfer-encoding及非零content-length。其余Mock路由继续拒绝查询参数。

复用现有上传生成的不可变内存历史，当前记录和最多limit+1条选中/探测记录先在2 MiB内复制再完整核对，按原上界倒序投影摘要。当前记录还须对应同版本的历史对象，探测行的分类/内容描述同样有效才生成has_more；共享ArtifactVersionsEnvelope解析全部query/scope/trace/items/next_query，整页限256 KiB或调用方更低上限。返回前检查取消/会话到期，SDK仍有独立默认30秒本地期限；所有数据读取与投影同步完成，不发生状态写入。

既有`MockWcpServer({artifacts:{store,session}})`自动接线`listArtifactVersions`，无新配置或导出类型。完整next_query用于显式续页；新版本追加不会改变旧查询上界。目录不读字节、不计算内容摘要、不查询上传回执、不产生下载释放记录，也不自动遍历或保存文件。详见[Mock历史版本目录](artifact-mock-runtime.md#历史版本目录)。

模拟历史只能来自同一store中的既有上传，仍不提供历史损坏/缺失种子、动态权限/分类、SQL共享锁、持久事务或真实审计。此接入不能证明真实服务与Mock运行一致；Schema一致性及运行/并发/存储证据仍缺，R-001和P0-02不因此完成，evidence为空。仅源码文档人工审阅，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

## 独立JSON Schema（源码阶段）

2026-11-04新增`packages/contracts/schemas/artifact-versions.json`，自包含JSON Schema 2020-12，根为规范成功ArtifactVersionsEnvelope；显式包子路径`@planemem/contracts/schemas/artifact-versions.json`可由消费者加载。资源`$id`仅标识契约，不保证存在远程文件。先注册完整Schema，再通过ArtifactVersionsQuery、ArtifactVersionsNormalizedQuery、ArtifactVersionsNextQuery、ArtifactVersionSummary、ArtifactVersionsPage或ArtifactVersionsEnvelope锚点选择结构，见[使用说明](../../../packages/contracts/schemas/README.md)。

输入query允许省略limit，规范回显与next_query必需limit；next_query还必需at_version/before_version且二者至少为2。结构约束未知字段、正安全整数、1–20条页大小、摘要字段、分类、来源计数和单个artifact来源；before依赖at，has_more=true要求非空摘要及完整next_query，false要求null。default=10是描述性注释，不替调用方修改输入。静态examples是人工编写的开发样例，没有实际上传、查询或验证。

JSON结构不表达实际授权、字节限额、原请求范围/trace/目标相等、before与at大小关系、严格倒序/条数与limit关系及完整next绑定，也不保证字符串按JS UTF-16长度限制或日期精确往返；这些仍由共享解析器和实际读路径执行。format在部分校验器里仅为注释。HTTP仍由路由验证单值URL参数、十进制形式、请求头及空正文。通过Schema不代表共享解析/权限/正文核验通过。

旧`entities/Artifact.json`有不同核心实体字段，不能用于当前历史摘要；本次不改旧实体，也不把JSON导入生产运行路径。仅Schema源码、包子路径与文档，不安装依赖、生成SDK或发布包。完整OpenAPI目录、Schema自动生成/一致性及运行证据仍待补齐；R-001保持未完成且evidence为空，未编译、类型检查、测试、运行生成器/校验器/SDK/Mock/API/数据库或发布。
