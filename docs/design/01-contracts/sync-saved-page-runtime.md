# 本地同步页面文件与显式恢复（开发契约）

2026-11-03：仅源码与文档，未编译、类型检查、测试、运行 CLI/SDK/API、实际保存样本、打开数据库、迁移或发布。无新依赖或数据库 schema，PostgreSQL 016–049 及先前 SQLite 升级仍未执行。R-005 未完成。

## 保存完整页面

`workctx sync changes --json-file consumer-query.json --output NEW_PAGE.json` 沿用专用有界下载，只保存一页。输入为 `{expected_identity,cursor,limit?}`；保存模式要求原五字段身份和显式非负安全起始 cursor，缺少任一项在请求前拒绝。limit 为 1–500，省略按既有协议固定保存 100。普通打印模式仍允许省略 cursor，从当前服务端确认读取；这种依赖当前状态的起点不能直接归档。

--output 必须指向已有目录下的新文件，发送前检查目标，拒绝任何已存在的文件、目录或链接。完整页面经 SDK 和共享分页解析后，连同原查询/身份构造本地文件。网络/嵌入均支持，返回仅为本地保存摘要，完整事件保存在文件里；不自动确认、应用事件或翻页。未指定 --output 的旧行为保留，打印完整业务封套且不保存。

## 文件格式与校验

文件精确为 `{document,document_sha256}`。document 精确包含：

- schema_version=1、kind=`workctx.sync-page`；
- expected_identity，原 tenant/workspace/project/actor/client 五字段，不包含令牌或权限到期；
- query=`{cursor,limit}`，两个字段均显式存在；
- previous_page_sha256，初次明确查询为 null，从旧页面续读时为其 document_sha256；
- page，原下载完整封套，保留原请求 trace、全部事件和来源、next_cursor/has_more。

共享 `parseSyncSavedPageDocument` 核对精确结构、原范围、有效查询及完整分页语义。`syncSavedPageDocumentJson` 固定 document、身份、query 和页面封套的字段顺序，保留事件 payload/附加字段的原键顺序。document_sha256 是这份 JSON 的 UTF-8 SHA-256，小写 64 位十六进制。共享 `parseSyncSavedPageFile` 只检查结构和摘要形状；CLI 读取必须另算摘要并比对，不能仅调用结构解析就认为文件完整。

页面本身仍限 4 MiB；document 最多 4 MiB + 32 KiB；完整文件最多 4 MiB + 36 KiB。完整文件及 document 各自沿用有限 JSON、深度 64/节点 100000 检查，因此嵌套封装额外占用复杂度；边界无法表示就整页失败，不截断。读取文件还受实际字节上限、普通文件、前后大小/修改时间检查、严格 UTF-8 和可选 BOM 约束。额外字段、缺字段、无效分页、摘要不符和跨项目输入均拒绝。

摘要只用于发现内容变化，不是服务端签名。用户能同时改写内容与摘要；任意导入文件不能据此证明来自 Gateway、当前有权读源数据或事件已应用。page 的历史 trace 留在文件里；本次 inspect/保存摘要使用当前 trace，二者不能混淆。

## 不覆盖保存与失败状态

复用现有 Artifact 文件保存实现：同目录独占临时文件，完整写入、文件同步、读取校验、关闭后，以硬链接发布最终目标，拒绝覆盖竞争期间出现的目标。不支持硬链接时失败，不回退覆盖式 rename；临时文件名继续使用 `.workctx-artifact-*.part`。随后对最终路径重新执行完整页面/摘要/范围核验，并与准备的 document 比较。

成功摘要 data 包含原身份、原起点、下一游标、事件数、has_more、原 page_trace_id、document_sha256、前页摘要，以及本地 path/file_bytes/file_sha256/cleanup_pending。file_sha256 描述实际文件字节，document_sha256 描述规范 document；二者用途不同。local.state=saved 是本次文件写入同步/读回/发布成功；不代表服务器确认或事件应用。清理临时文件失败保留 cleanup_pending/temporary_path，已知保存成功不改为失败。

准备目标失败为 SYNC_PAGE_OUTPUT_UNAVAILABLE；不能完整表示为 SYNC_PAGE_INVALID；保存失败为 SYNC_PAGE_SAVE_FAILED 并保留阶段、目标和可能的临时路径。最终路径创建后核验失败为 SYNC_PAGE_READBACK_FAILED、local_state=published-unconfirmed，保留文件，不删除或覆盖。以上均未发送确认，带 acknowledgement_dispatch_state=not-sent。输出失败或进程关闭后先检查原路径，不能直接重新选择文件并假定先前没有保存。

本地权限沿用目录 ACL/现有实现，选择自己控制的目录。前后 stat 不是抵御恶意并发替换的快照协议；未新增目录 fsync、目录掉电恢复保证、文件加密、跨设备备份或长期保留策略。所谓本地恢复是重新读取明确指定的完整文件，不是全局消费事务。

## 离线检查与恢复命令

`workctx sync inspect --page-file PAGE.json` 只读指定文件，重新核验完整页面与摘要，显示原身份、起止游标、页数统计和恢复参数。它不需要 WORKCTX_* 环境变量/令牌，不使用 router/网络，也不会打印全部事件。只接受一次 --page-file，不接受 JSON、timeout、output、键或 stdin；结果 local.state=read-and-verified 只表示此次读取通过，event_application=not-verified，不报告历史确认状态。

changes、ack、cursor 的 --page-file 与 --json/--json-file 三选一，不能覆盖文件里的身份、游标或页大小：

- `sync changes --page-file PAGE.json --output NEXT.json` 从该页 next_cursor 按保存的 limit/身份续读，保存时记录前页 document 摘要。输出路径必须新建；省略 output 只打印下一页。has_more=false 仍可显式调用，表示从该位点读取后来可见的新变化，不是自动轮询。
- `sync ack --page-file PAGE.json` 仅从完整核验文件派生 `{expected_identity,cursor:next_cursor}` 并明确确认。调用方应先完成所需本地消费/应用；CLI 不替调用方证明这些动作。
- `sync cursor --page-file PAGE.json` 从文件原身份读取当前服务端确认位点，用于未知确认后的显式核对，不替换原文件或推断原请求历史结果。

网络范围仍与 WORKCTX_* 一致，Gateway 对原账号/客户端和当前权限核对；嵌入要求可信未过期 sync.read/admin。不允许使用另一账号补认。--timeout-ms 默认 30000，同时配置 SDK/HTTP，计时不包括输入读取/目标准备/成功后的本地保存。确认沿用本次 not-sent/派发后 unknown 处理；超时不自动查询或重发，也不改写页面文件来宣称已确认。

前页摘要只是显式调用的局部关联；本轮没有遍历旧文件验证整个链、禁止分叉、判断最新文件或验证从零连续覆盖。即使保存从 cursor=100 开始的页面，也不证明 0–100 已保存。消费者应用事务、全局单调本地检查点、历史权限变化后的重放、旧调用方迁移和真实跨进程/并发/断电证据仍待补齐。
2026-11-03 连续接收增补：独立 SqliteSyncInbox/CLI inbox 已另接按原身份隔离的连续页面保存与头读取，首篇从零、后续绑定头摘要/游标/页大小，事务推进 received_cursor；可导出保存头复用本文恢复命令，见 [本地同步收件箱](sync-inbox-runtime.md)。单独页面文件仍不证明整链连续或事件应用；收件箱不全量审计旧正文，也不保存服务器确认。新收件箱 schema v1 仅源码未初始化。
