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

## 必须保留的运行时检查

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
