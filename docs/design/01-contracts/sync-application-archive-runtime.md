# 收件箱应用历史归档与离线读取

2026-11-03 开发增量，仅源码和文档；未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、执行 schema/迁移、生成归档样本或发布。无新 schema/依赖，既有 SQLite 扩展和 PostgreSQL 016–049 未执行。关联 ADR-015、T0/T3.4/T4.3、R-005，运行证据为空。

## 独立应用归档 v1

共享 `SyncApplicationArchiveFile` 包含 document 和 document_sha256。document 严格字段为 schema_version=1、kind=workctx.sync-application-history、完整原 expected_identity、application={name,version} 和 steps。steps 依序保存从根到应用头的每一步：完整原 `page:SyncSavedPageFile`、`projection`、`projection_sha256`、原 `application_trace_id`。序号由数组位置加一确定，前驱和游标来自原页，避免重复定义可冲突的元数据。

文档最多 1000 页、16 MiB，文件最多 16 MiB+4096 字节，单投影最多 1 MiB。JSON 还受既有有限值、普通字段、深度 64、节点数 100000 的复杂度限制，因此未达到页/字节上限也可能被拒绝。应用描述只含合法 name/version；原应用 trace 保留既有非空、1024 字符和禁止控制/孤立代理字符规则。

结构解析核对每个原页的完整契约/原身份、从零开始的根、前驱摘要、连续游标、固定页大小、页面摘要唯一，以及跨全部页面的事件 ID 唯一。空事件页必须与上一页投影 JSON 文本相同，空根保持 JSON null。projection 的 JSON 字段顺序保留，外层结构采用固定字段顺序；应用描述与原事件内容不被当作服务器认证。

`parseSyncApplicationArchiveDocument/File` 负责严格形状和结构，**单独解析不验证 SHA-256**。文件适配器必须逐项验证原 page.document 摘要、原投影 JSON 摘要和完整 document 摘要。摘要计算分别使用 syncSavedPageDocumentJson、syncApplicationArchiveProjectionJson、syncApplicationArchiveDocumentJson 的 UTF-8 字节；文件实际字节 SHA-256 与文档摘要独立，格式化空白/UTF-8 BOM 不改变规范化文档摘要，但改变文件字节摘要。未知/额外字段、损坏页面、重复事件、空页改变投影和任何摘要不符均拒绝整个文件。

归档以原页完整事件为不可变事件绑定的来源，summary 标明 event_ledger=derived-from-original-pages，不复制 SQLite 内部键/索引/触发器。导出端先核对真实存储 ledger 的全部行数与绑定；离线文件自身不能证明它曾来自这份数据库。归档包含应用使用的接收前缀，不包含尚未应用的接收后缀、确认/派发日志、其他应用或物理数据库状态；既有页面链归档格式不变。

## Bridge 导出与 CLI 文件保存

Bridge 新增 `readApplicationArchive(input,trace)`。查询复用完整原 expected_identity/application 和可选 timeout_ms（默认 30000、最大 90000），不接受其他预算或隐式当前账号。已有应用扩展必须已启用；独立只读事务使用完整历史结构审计，核对所选应用全部步骤、原页、投影摘要、实际步骤/事件行数和 ledger，然后得到正序归档。固定审计上限为 1000 页/500000 事件/16 MiB 源文档与投影，另在收集时按完整归档字段/分隔符累计 16 MiB 文档预算，最终再次按共享契约解析和计算外层摘要。缺应用且无孤立记录可生成空 steps 归档；这不证明消费者存在或应当没有应用。

结构、预算、期限或事务结束失败不返回部分归档。沿用原本地单调期限，单次同步 SQL/解析不可硬实时抢占；该期限不覆盖后续文件保存和离线检查。结构审计不重跑 reducer，不声称业务投影语义正确。导出只读取原历史，不写回快照/应用头或启用 schema。

CLI 主程序与嵌入入口新增以下命令，示例仅供说明，未执行或生成文件：

```text
workctx inbox application-export --inbox local-inbox.sqlite --json-file application-query.json --output application-history.json
workctx inbox application-inspect --archive-file application-history.json
workctx inbox application-inspect --archive-file application-history.json --json-file archive-next-query.json
workctx inbox application-archive-get --archive-file application-history.json --json-file archive-selection-query.json
```

application-export 要求 inbox、原应用 JSON（--json/--json-file 二选一）和新 output；拒绝 archive-file、重复/其他参数、令牌、写键、stdin 和命令行 timeout-ms。查询解析与输出路径预检均发生在只读打开已有库前。成功读取并结束事务后尝试关闭连接，再保存归档；关闭失败保留 close_pending，不改变已经取得的完整读取结果。

保存前再验证全部摘要，复用独占临时文件、文件同步、内容读回和独占硬链接发布；不覆盖已有文件/链接，不提供复制替代。最终路径再次完整读取，核对实际文件大小/文件 SHA-256/文档 SHA-256，全部通过才返回摘要、local 路径/字节/摘要和可直接用于检查的 inspect_query。文件系统须支持既有硬链接策略；不新增抵御恶意并发路径替换或断电持久性保证。

保存失败保留输出/可能遗留临时路径、清理状态、close_pending、原归档摘要和摘要信息；最终文件已发布但读回失败标为 published-unconfirmed，不删除最终目标或称其保存成功。失败时不回显整份业务正文，也不自动改路径重试。CLI 的文件成功不构成导入、数据库恢复或跨设备恢复证据。

## 离线检查与精确快照选择

application-inspect 只需 archive-file；可选 JSON 中的 limit（默认 20、最多 50）、after_sequence（默认 0）、archive_document_sha256。续页 after_sequence>0 必须带原归档摘要；超出归档末项拒绝，等于末项返回空页。每次先完整有界读取归档并验证所有层级摘要，再返回整体摘要和本页步骤摘要，包括序号、原页/前驱/投影摘要、应用游标、事件数和原两类 trace。next_query 绑定原归档摘要和末项位置，selection_query 绑定归档/原页两个摘要。不自动翻页，完整 CLI 响应限 512 KiB，超限可降低 limit。

application-archive-get 必须提供 archive-file 和 JSON 中精确 archive_document_sha256/document_sha256。先验证整个归档，再选择该原页对应的历史快照，返回摘要与完整 projection；不存在则 found=false、snapshot=null。内容变更与找不到快照分别处理，不把旧页换成当前头，也不提取/保存新文件。完整 CLI 响应限 2 MiB。

离线命令均禁止 inbox/output；既不加载 Bridge 运行时/SQLite，也不读取令牌、当前身份或网络。查询最多 16 KiB，输入文件须稳定普通文件且有界 UTF-8 读取。归档整体身份/应用来自已核对内容，后续摘要绑定覆盖该身份/应用；不同身份的文件即使同名也不能用旧摘要继续。结果同时保留实际文件路径/字节摘要、归档文档摘要、原消费者/应用/范围与 archive_scope=consumer-application-history。

## 错误与剩余范围

查询/参数错误使用 USAGE_ERROR、INBOX_APPLICATION_ARCHIVE_QUERY_UNAVAILABLE/QUERY_INVALID 或对应历史/选择查询错误；导出查询保留既有应用查询错误。INBOX_APPLICATION_ARCHIVE_LIMIT_REACHED 表示归档收集超限，结构审计自身预算可先报 INBOX_APPLICATION_AUDIT_LIMIT_REACHED；最终格式/复杂度不符报 INBOX_APPLICATION_ARCHIVE_INVALID。下层 schema/原页/ledger/事务错误保留原类别与关闭状态。

文件读取/内容错误分别为 INBOX_APPLICATION_ARCHIVE_FILE_UNAVAILABLE/FILE_INVALID；输出预检/保存/最终读回分别为 OUTPUT_UNAVAILABLE/SAVE_FAILED/READBACK_FAILED（同一前缀）。续页或详情摘要不符为 INBOX_APPLICATION_ARCHIVE_CHANGED，越界为 POSITION_INVALID，完整返回超限为 RESPONSE_TOO_LARGE。所有路径保留 acknowledgement_dispatch_state=not-sent。

summary 明确 received_suffix/acknowledgement_history=not-included、server_application/source_authenticity/projection_semantics=not-verified、provenance=local-archive-not-authenticated。档案摘要仅检查内容自洽，不认证来源、旧执行代码或业务语义。显式空应用/完整相同历史恢复已补 Bridge/CLI 源码，见 [应用归档原子恢复](sync-application-restore-runtime.md)；只读目标关系比较与预计写入数量已补 [恢复预览](sync-application-restore-preview-runtime.md)，不预留目标状态；不同历史合并、旧版本迁移、跨设备完整恢复及真实故障证据仍未完成。本轮未实际导出、检查归档、执行命令或生成样本，R-005 继续保持未完成。
