# 重新排队独立回执历史导入

2026-11-04，ADR-015 / T3.4 / T4.3 / R-005。仅源码与文档；未编译、类型检查、测试、执行 CLI/Bridge、打开数据库、初始化表、执行迁移或发布。

## 入口与原选择

Bridge 新增 `previewRestoreRequeueFileImport(file, query, trace)` 与 `importRestoreRequeueFile(file, query, trace)`。CLI 新增 `outbox restore-requeue-import-preview/restore-requeue-import --outbox EXISTING_FILE --receipt-file FILE --json/--json-file QUERY`。

query 严格为 `{scope, document_sha256, requeue_id}`，最多16 KiB；拒绝未知字段、null、无效摘要或ID。Bridge必填原项目scope；CLI可补调用开始时固定的配置scope，显式范围须匹配。文件摘要返回的 `import_query` 可直接用于本入口，原 `get_query` 保持两字段离线提取用途。

CLI 先读取稳定普通 UTF-8 文件，完整核验独立回执、父历史、固定v1映射及全部摘要，再匹配文件摘要、批次和项目；失败不打开库。预览原生readonly，实际导入仅打开已有库。两者拒绝stdin、内存库、输出路径、额外或重复选项，必须且只能提供一个JSON来源。无网络/令牌请求。

## 目标比较

在单次读事务或实际 `BEGIN IMMEDIATE` 内，分别检查原 restore_id 和 requeue_id 的全局占用。最多读两条元数据以拒绝歧义；跨项目占用明确标记，既有损坏结构或正文不被当成缺失。

父历史正文读取前验证存储查询不超过16 KiB、源档案不超过32 MiB+8192；同项目父历史必须通过完整源档案/恢复映射核验，再与源文件父回执及原档案深度比较。批次原查询不超过16 KiB，使用固定有界元数据投影，验证原查询SHA、scope/ID、时间trace和摘要格式，然后逐字段与已完整核验的源回执比较。

| 关系 | 含义与处理 |
| --- | --- |
| missing | 可选表或所选ID不存在，允许补入 |
| identical | 规范原内容完全相同，保留现有记录 |
| different | 同项目同ID内容不同，拒绝实际导入 |
| reserved-other-project | ID已由其他项目占用，拒绝实际导入 |

预览分别返回 parent_relation、receipt_relation、两个表的存储状态、missing_restore_histories/missing_requeue_receipts（各0或1）及compatible/status。状态为conflict的完整比较可以正常返回；结构损坏、重复ID或读取失败则报错。预览不创建可选表，不预留ID。

父历史缺失且现有批次元数据与文件完整一致时，target_parent_binding=verified-against-source-only，允许只补父历史；此标记不声称目标关联历史已完整存在。两者完整匹配为matched，其余为not-matched。该分支仍要求源文件完整验证，不能凭回执摘要猜造父历史或替换已有损坏记录。

checked_target_bytes 按本次比较实际载入的原批次查询、父查询和源档案UTF-8字节统计，包含存储空白；target_byte_basis明确per-inspection。单次比较最多两个16 KiB查询及一份有界父档案；写入前后会重复比较，结果不表示整个操作物理I/O或进程内存上限。固定元数据和重建对象不计入该计数。

## 原子补入与读回

实际导入完全复用预览比较逻辑；所有比较通过后才按需创建既有可选历史表。只补缺失父历史，再检查父历史已完全一致且批次关系未因触发器变化，最后只补缺失批次。每次插入必须恰好一行，不覆盖已有内容。

全部写入后再次比较两个ID的全局占用及完整内容，最后复用完整原查询回执读取器，对父历史/原查询/选中前后摘要和原回执完整读回。任一变化、缺失、歧义或摘要不符导致整事务失败。源恢复时间、重新排队时间、trace、原因、事件顺序与generation保持原值。

成功action为imported或already-present，返回本次插入父历史/批次计数；local_commit=committed只在本次写事务提交成功后返回。没有独立导入回执；prior_import_commit=not-proven。相同文件再次调用只证明本次目标历史内容已存在，不证明前一次未知提交的结果。

导入只涉及历史表，restored_events=0、requeued_events=0，current_queue/current_control=not-read-or-modified。不要求当前项目为空或暂停，不恢复事件、调整领取控制或自动发送。导入的原ID继续保持历史幂等语义：再次以原ID执行原恢复或重新排队操作会命中历史，不能据此推断目标当前事件已经恢复或发送。

## 限制与失败状态

Bridge从源验证到目标读回采用90秒阶段预算，成功写COMMIT之后不因后续过期而否认提交。预览读事务结束后仍检查期限。同步SQL/JSON不能硬实时中断；CLI预先完整验证和Bridge验证分别受预算约束，文件I/O、模块加载、数据库打开/关闭不在其中。完整结果与CLI封套各最多128 KiB，stdout不包含源档案正文或租约值。

失败保留query、stage、target_kind、所选批次/恢复ID、source_history/source_receipt、candidate_plan/candidate_result和底层详情。source_receipt来自已验证文件，不表示目标导入已提交；候选结果标记unconfirmed-requeue-history-import。COMMIT异常或回滚失败保持local_commit=unknown及事务阶段/回滚状态，不能把已有文件或候选计划当成提交凭据。

CLI追加原receipt_file路径/字节数/摘要、outbox和close_pending，始终尝试关闭。关闭或响应容量失败保留已知本地结果；不会重新执行导入。预览显示冲突或导入未知时保留原文件和查询，通过新的显式读取决定后续操作。

source_authenticity=not-proven、server_delivery=not-checked、database_integrity=not-audited；本操作仅覆盖所选父历史/批次，不证明其他历史、全库物理结构或来源真实性。项目全部批次联合备份/导入、保留管理、来源证明及运行证据仍缺。复用既有表定义，无数据库结构或依赖版本变化；SQLite既有扩展及PostgreSQL 016–049仍未执行，所有并发/触发器、缺项、冲突、损坏、未知提交和关闭场景尚未运行验证。

2026-11-04 后续已补 [项目重新排队历史完整备份](outbox-restore-requeue-backup-runtime.md)：单读快照收集全部批次并去重共用父历史，离线完整核验原历史、批次摘要和关联闭包；最多100批/64 MiB文档，读取预算另计且共享父每批计费。只读导出至独占新文件并最终完整读回；联合备份导入/预览、离线分页提取及运行证据仍缺。仅源码文档，未编译、测试或运行。

2026-11-04 后续已补 [备份离线目录与批次提取](outbox-restore-requeue-backup-access-runtime.md)：每次完整核验联合备份后按原摘要分页/选择，可找回并保存原请求，或导出带完整父历史的独立批次文件；该文件可衔接已有单批次导入。保留原历史与备份观察时间/trace，缺项不创建输出，保存后完整读回。联合备份原子导入/预览及运行证据仍缺；仅源码文档，未编译、测试或运行。
