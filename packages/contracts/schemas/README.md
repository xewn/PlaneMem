# 独立契约结构定义

这些文件是开发源码，尚未经过本轮编译、生成器、Schema校验器、测试或运行验证。`$id`是契约标识，不代表已发布网站；消费者应从工作区或包子路径加载文件，不依赖远端下载。

## 保存 ContextPack 完整读取

`context-pack-read.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/context-pack-read.json`。它自包含全部定义，根是`ContextPackReadEnvelope`，用于GET /v1/context-pack、SDK getContextPack、CLI context get和MCP保存包工具/资源内部文本中的完整成功封套，也可描述Mock中提供的完整json响应。MCP外层content/contents/JSON-RPC包装、HTTP头/状态、编译命令及Mock配置不属于此根结构。

先注册完整本地资源，再按相对于`https://planemem.local/schemas/context-pack-read.json`的片段选择结构。该标识不表示远端托管，不需要联网下载；不要拆出单个`$defs`后丢失引用上下文。

| 片段 | 对应内容 |
| --- | --- |
| `#ContextPackReadQuery` | SDK/MCP查询，pack_id与format都可省略 |
| `#ContextPackReadNormalizedQuery` | 共享解析器规范查询，format明确出现；成功封套不回显query |
| `#ContextPackReadCliQuery` | CLI四字段JSON，另含可选但必须成对的expected_actor_id/expected_client_id |
| `#ContextPackReadScope` | 保存包的租户/工作区/项目ULID |
| `#ContextPackReadSourceRef` | 完整来源对象，保留可选revision/uri，revision可为0 |
| `#ContextPackReadItem` | 完整入选条目，含原内容、来源、trace及ranked-fit理由 |
| `#ContextPackReadExclusion` | 排除项ID及policy/expired/budget/source理由 |
| `#SavedContextPack` | 完整持久包，含摘要、预算、入选/排除项、来源与到期 |
| `#ContextPackReadRendered` | markdown/mcp共用的具体包URI及完整Markdown文本 |
| `#ContextPackReadReceipt` | data内保存ID/version/created_at/used_tokens/pack及可选rendered |
| `#ContextPackReadEnvelope` | 根完整成功封套，接受json或渲染形式 |
| `#ContextPackReadJsonEnvelope` | 原format为json或省略时，禁止出现rendered |
| `#ContextPackReadRenderedEnvelope` | 原format为markdown/mcp时，必须有完整rendered |

查询pack_id省略表示latest，空串/null无效；format默认值仅为注释，实际归一化仍由共享解析器完成。CLI的--timeout-ms是命令选项，不是JSON字段；身份约束不能混入SDK/MCP查询，也不是凭据。公开GET使用URL查询，不能把这些对象放进GET正文。

每个对象字段封闭，使用当前isUlid的26字符规则、安全整数、预算128–32768、最多1000项的各候选数组和保存摘要形状。pack_version固定1代表内容格式，receipt.version才是保存版本。外层trace沿isSyncIdentifier最多255字符，包和条目保存trace及候选ID沿共享name规则最多4096字符；不得把外层trace限制套到全部保存字段。来源type/id/uri沿既有非空字符串规则，不新增trim、URL格式或长度限制；每条来源允许重复，包聚合来源不得重复。示例仅包含人工编写的查询，不伪造成功包摘要，也不是测试证据。

旧`entities/ContextPack.json`描述带sections的核心实体，不能替代此完整读取结构；本增量保留旧定义。以下规则仍必须由现有`parseContextPackReadQuery`、`parseContextPackReadEnvelope`、`contextPackReadHashJson`及调用方/服务端检查：

- 查询4 KiB、完整成功2 MiB、错误16 KiB；普通有限JSON、深度/节点限制、UTF-16长度、有效字符及数字有限性。Schema字符串长度按码点计数，不能替代JavaScript长度预算。
- 原请求scope/trace/指定pack_id/format匹配；所有入选条目范围一致，revision等于data.version，JSON内ETag精确对应版本，外层来源首项指向该包。latest的实际选择及权限过滤由生产者负责。
- items与exclusions合计最多1000，ID跨两个数组唯一；每条估算max(1,ceil(content.length/4))的总和恰等于used_tokens且不超budget_tokens。空内容仍计一个token。
- 包来源恰为按入选顺序取完整来源对象的首次去重并集，外层来源恰为包引用加该列表。不能只检查数量、类型或uniqueItems。
- UTC毫秒时间必须有效且可精确往返，created_at早于包到期，入选条目若含到期时间则不能更早；`format`可能只作注释。实际过期和来源变化仍由读取入口处理。
- rendered必须符合原格式，URI使用原项目和选中具体保存包，文本完整对应每条入选内容与来源；root本身不知道原查询格式，消费者可先选择格式专用锚点再做动态核对。
- 对完整包递归排序对象键、保留数组顺序，仅排除包顶层trace_id/pack_hash，然后计算真实SHA-256；条目trace仍参与摘要。Schema中的64位十六进制模式不证明摘要正确。
- 实际认证、未过期身份、当前父项目/受限内容权限、来源数据库快照及期限/容量均不由Schema授予。摘要一致也不证明来源真实性或未来可用性。

完整接入和运行边界见[保存包读取](../../../docs/design/01-contracts/context-pack-runtime.md)。本次不增加生产JSON导入、校验器依赖或生成器，不执行Schema校验、编译、类型检查、测试或发布；Schema与共享解析器的自动一致性、OpenAPI及真实客户端运行证据仍待补齐。

## 文件版本比较

`artifact-comparison.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/artifact-comparison.json`。文件自包含全部定义，根为`ArtifactComparisonResult`：SDK `compareArtifactVersions`的返回值、CLI `artifacts compare`的stdout对象，以及MCP `compare_artifact_versions`返回文本中的JSON。MCP外层JSON-RPC/content包装不属于根结构，需先取出文本并解析；旧Artifact实体Schema及目录Schema不能替代此文件。

先注册完整资源，再按相对`$id`的片段选择结构；标识`https://planemem.local/schemas/artifact-comparison.json`不代表远端托管地址，也不需要联网下载。

| 片段 | 对应内容 |
| --- | --- |
| `#ArtifactComparisonQuery` | SDK/MCP三字段输入及结果中的query；保留比较方向 |
| `#ArtifactComparisonCliQuery` | CLI五字段输入，另含expected_actor_id/expected_client_id |
| `#ArtifactComparisonIdentity` | 完整租户/工作区/项目/账号/客户端约束，不是凭据 |
| `#ArtifactComparisonSourceRef` | 完整来源引用，保留可选revision/uri，revision可为0 |
| `#ArtifactComparisonMetadata` | 完整公开保存元数据，含描述性版本ETag |
| `#ArtifactComparisonHistoricalEnvelope` | 一份指定历史读取的完整封套，没有外层ETag |
| `#ArtifactComparisonFieldRow` | 差异字段行的基础形状；精确标签/顺序在完整comparison内限制 |
| `#ArtifactComparisonSourcePosition` | 一个来源位置的两侧值及same/changed/added/removed状态 |
| `#ArtifactMetadataComparison` | 八项固定顺序字段行、完整来源位置、描述符一致性和计数 |
| `#ArtifactComparisonResult` | 本地组合结果，也是根；没有外层data或伪造的服务端聚合封套 |

CLI的账号字段沿SDK上下文要求ULID；共享身份结构允许MCP已验证账号文本。SDK自身的scope/actor构造约束仍需另外满足，Schema不把MCP身份缩窄为SDK输入。三字段查询不能带CLI身份字段，五字段CLI输入也不能当作结果中的query。

字段封闭，限定安全整数、分类、来源最多200条和八行固定key/label顺序；size行是十进制字符串。来源位置为same/changed时必须有两侧，added仅after、removed仅before；省略缺失属性，不用null。来源数组不设置去重约束，原重复项和顺序均保留。URI只作保存文本，不附加可访问或URL格式要求。查询与来源位置examples是人工编写的开发示例，未执行且不是测试证据。

仍须保留以下运行时检查；本Schema没有替代它们的动态跨字段机制：

- 查询4 KiB、每份完整记录/元数据2 MiB，以及普通JSON、深度/节点、UTF-16长度、实际入口字符限制。MCP另外限制组合8 MiB、转义content 16 MiB+4096；不能据此宣称SDK也有同样的聚合上限。
- `parseArtifactComparisonQuery`要求两个版本不同但不要求升序；`parseArtifactCommandIdentity`核验完整身份，真实凭据和权限由各入口检查。
- 用`parseArtifactReadEnvelope`将每份记录与原query选定版本、artifact、scope和原读取trace核对；两份须同文件同范围，外层revision和元数据version一致，来源ID匹配，metadata.etag对应保存版本。保存记录的trace可与本次读取trace不同。
- 有效且可精确往返的UTC毫秒时间、updated_at不早于created_at；`format`可能仅为注释，模式不能证明日期真实有效。
- 重新调用`compareArtifactMetadata`核对完整差异：八行原值和changed，连续从1开始的来源位置、两侧完整引用和状态、统计数量，以及size/hash描述符一致性。仅通过结构校验的外部报告仍可能填错这些内容。
- 不从结构有效推断记录真实性、实际读取权限、对象正文一致或跨请求事务快照；不据此上传、恢复版本或刷新原写请求。

运行读取、超时/取消与权限边界见[版本比较契约](../../../docs/design/01-contracts/artifact-versions-runtime.md)。本次不增加生产JSON导入、运行时Schema校验依赖、生成器或发布包；Schema与实际解析/比较函数的自动一致性及客户端兼容证据仍待补齐。

## 附件历史版本目录

文件`artifact-versions.json`采用JSON Schema 2020-12，包子路径为`@planemem/contracts/schemas/artifact-versions.json`。它自包含全部定义，根描述规范`ArtifactVersionsEnvelope`成功响应。先向支持该草案的校验器注册**完整文件**，再用以下资源片段选择结构；不要取出单个`$defs`对象后丢掉原引用上下文。

| 片段 | 对应内容 |
| --- | --- |
| `#ArtifactVersionsQuery` | SDK/CLI/MCP输入对象；必填artifact_id，limit可省略 |
| `#ArtifactVersionsNormalizedQuery` | 规范响应回显的query；明确包含limit |
| `#ArtifactVersionsNextQuery` | 完整续页输入；明确包含limit、at_version、before_version |
| `#ArtifactVersionSummary` | 一条历史元数据摘要 |
| `#ArtifactVersionsPage` | 范围、查询、上界、摘要页及下一查询 |
| `#ArtifactVersionsEnvelope` | schema_version/trace/source_refs/data完整成功响应，也是根结构 |

上述片段均相对于文件`$id`。例如完整查询标识是`https://planemem.local/schemas/artifact-versions.json#ArtifactVersionsQuery`，只用于本地已注册资源解析。文件里的examples是人工编写的开发示例，不是保存的真实数据、运行结果或测试证据。

结构拒绝未知字段，约束安全整数、页大小、分类、摘要字段和单个artifact来源。before_version依赖at_version；has_more=true要求非空items及完整next_query，false要求next_query=null。limit的default=10只描述默认值，实际归一化由共享解析器完成。输出定义描述服务器/SDK/Mock的规范结果；运行时兼容解析可先补齐省略的默认limit再比较。

HTTP使用路径中的artifact_id和URL中的分页参数，不能把整个JSON对象放进GET正文；URL单值、重复参数、无前导零十进制等规则由HTTP入口检查。参考[完整运行契约](../../../docs/design/01-contracts/artifact-versions-runtime.md)。

## 历史目录必须保留的运行时检查

这份Schema仅描述结构，不能单独确认一次响应属于当前请求。继续使用`parseArtifactVersionsQuery`、`parseArtifactVersionsPage`和`parseArtifactVersionsEnvelope`，并保留服务端实际权限/当前可见性/历史快照检查。

- 输入4 KiB、完整成功响应256 KiB，以及纯JSON对象、深度/节点/属性安全限制。
- 当前可信scope、原trace、artifact_id和完整原query相等；单个来源ID与目标一致。
- before_version不超过at_version，首轮上界不超过当前可见版本，续页上界与snapshot_version一致。
- 版本严格降序且不重复、不超过上界并小于before；页条数不超过limit，has_more时恰为limit且最后版本大于1。
- 完整next_query保持目标、limit、上界和本页最后版本，不能重新构造为最新版本。
- 时间必须是有效且可精确往返的UTC毫秒格式，updated_at不早于created_at。`format`可能仅作为注释，不能代替此检查。
- JSON Schema字符串长度与JavaScript UTF-16计数存在差别，实际字段长度、空白和无效代理字符规则仍由共享解析器决定。
- Schema中的classification不是权限授予；目录也不验证正文、下载可用性、上传回执或历史连续性。

现有`entities/Artifact.json`描述旧核心实体，具有不同字段和ETag语义，不能用于目录摘要或封套。此次新增不修改旧实体契约、不引入JSON导入到生产运行路径、不安装校验依赖、不生成或发布包。Schema与解析器的自动一致性证据仍待补齐。

## 项目文件目录

文件`artifact-registry.json`同样采用JSON Schema 2020-12，自包含全部定义；包子路径为`@planemem/contracts/schemas/artifact-registry.json`。根是规范`ArtifactRegistryEnvelope`，用于GET /v1/artifacts及其SDK/CLI/MCP/Mock对应响应。先注册完整资源，再解析下表中的锚点；无需加载历史目录Schema，文件摘要字段与共享ArtifactVersionSummary保持同一约定。

| 片段 | 对应内容 |
| --- | --- |
| `#ArtifactRegistryQuery` | 输入查询；四字段均可省略，名称允许待trim或空串 |
| `#ArtifactRegistryNormalizedQuery` | 规范回显；必填limit，名称若存在则非空且无外围空白 |
| `#ArtifactRegistryNextQuery` | 完整续页；必填limit和cursor，其余原筛选须保持 |
| `#ArtifactRegistryItem` | 文件ID加当前保存版本摘要 |
| `#ArtifactRegistryPage` | 项目范围、原查询、摘要页和下一查询 |
| `#ArtifactRegistryEnvelope` | schema_version/trace/source_refs/data完整成功响应，也是根结构 |

片段相对于`https://planemem.local/schemas/artifact-registry.json`，该标识不要求远端托管或下载。默认limit=20仅为描述性注释，结构不修改输入；实际查询由parseArtifactRegistryQuery规范化。输入中的空名称可归一化为省略，空分类始终无效。Schema的规范响应定义比可先归一化输入的兼容解析更严格；不要把未规范化输入当作响应回显。

字段均封闭，安全整数、分类、摘要、条数及来源类型有限制；has_more=true要求至少一项和完整next_query，否则next_query必须为null。uniqueItems限制整个对象重复，不能单独检查不同摘要中的同一文件ID。示例是人工编写的空页和已结束单项页，不含真实查询记录或自行伪造的服务端续页游标，也不作为运行证据。

项目目录没有历史目录的artifact_id输入、snapshot_version或at_version；其每项自带artifact_id且source_refs按项逐一对应，可以为空。字段name/hash/trace/time描述当次可见的保存版本，目录并不读取正文。旧entities/Artifact.json和artifact-versions.json不能替代本资源。

必须继续使用`parseArtifactRegistryQuery`、`parseArtifactRegistryPage`、`parseArtifactRegistryEnvelope`与服务端当前权限/快照检查：

- 输入8 KiB、完整响应256 KiB、摘要部分16 KiB，纯JSON和深度/节点/属性限制。
- scope、trace与完整规范query必须匹配原请求；来源数量、顺序和ID与items完全一致。
- cursor必须是规范base64url编码的原元组，精确往返；模式匹配不证明游标可用或已授权。服务端重新绑定原范围/账号/客户端/受限读取能力/筛选/limit。
- ID严格倒序、不重复且低于原游标位置，名称匹配ASCII折叠字面子串、分类精确匹配；条数不超limit，has_more时等于limit。
- next_query完整保留原筛选和limit，位置是本页最后ID，续页绑定摘要保持；不能只保留cursor或把游标当签名。
- JavaScript UTF-16长度、空白/无效代理字符、有效UTC毫秒时间往返及时间先后仍需运行时确认；format可能只是注释。

HTTP URL单值、十进制数值、空正文、请求条件及响应状态/头部另行校验；JSON查询不能作为公开GET正文。详见[项目目录运行契约](../../../docs/design/01-contracts/artifact-registry-runtime.md)。此次仅增加Schema源码、包路径和说明，不引入生产JSON导入或新依赖、不执行生成器/校验器/测试或发布包；自动一致性、OpenAPI和运行证据仍缺。
