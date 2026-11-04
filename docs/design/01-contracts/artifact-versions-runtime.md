# 附件历史版本目录（源码阶段）

2026-11-04：新增持久服务、HTTP与SDK的只读版本目录。已有当前/指定版本元数据读取只能按已知版本取回；目录提供版本发现，选中后仍显式调用原详情或下载入口。只修改源码文档，未编译、类型检查、测试、执行SDK/HTTP/数据库/SQL/迁移或发布。

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

CLI、MCP、工作台版本目录与Mock接入、JSON Schema生成物及跨存储/并发/权限/分页运行证据仍待开发，R-001保持未完成且本增量evidence为空。现有指定版本各客户端读取仍保留。无依赖或数据库schema变更。
