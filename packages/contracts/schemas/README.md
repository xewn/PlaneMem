# 独立契约结构定义

这些文件是开发源码，尚未经过本轮编译、生成器、Schema校验器、测试或运行验证。`$id`是契约标识，不代表已发布网站；消费者应从工作区或包子路径加载文件，不依赖远端下载。

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
