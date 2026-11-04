# 提交队列完整逻辑快照

2026-11-04，仅源码与说明、人工审阅；未编译、类型检查、测试、安装依赖、执行 CLI/SQL/数据库/服务、迁移或发布。

## 入口与范围

`proposal-worker queue-backup --queue EXISTING.sqlite --binding binding.json --output NEW_BACKUP.json` 在当前完整原绑定下导出全部已知 v1 队列逻辑状态。`proposal-worker inspect-queue-backup --file BACKUP.json` 离线检查完整文件后仅显示绑定、捕获时间、摘要、任务数/各状态数量、uncertain 数量和生成关联数。不需要访问令牌或模型凭据，离线命令不打开队列，导出不领取/续期/回收租约、不重试、不生成或发送任务、不结算回执。

CLI 拒绝未知、重复或不属于该命令的参数；导出必须有 queue/binding/output，离线核验只接受 file。输出须为已有目录中的新文件，不覆盖已有路径、不使用标准输出作为备份目标；标准输出仅为操作摘要。退出码 0 表示导出或文件核验完成，1 表示命令失败，不表示队列已提交完毕或可安全重发。

范围仅为该库的 `proposal_queue_binding`、`proposal_jobs` 与可选 `proposal_generation_records` 的已知字段。独立生成请求日志目录、保留错误文件、回执记录文件、Web 浏览器库、服务器数据不在本文件内。此格式不是数据库字节副本，也不携带索引、DDL 或 SQLite 内部统计。未知表/视图/触发器、未知或隐藏列、字段类型/空值/主键布局不符合当前已知结构时拒绝导出，不静默忽略扩展数据。

## 完整快照与边界

`SqliteProposalQueue.backup()` 要求该实例原生只读打开，并在一个只读事务中读取整个快照。CLI 同时要求既有普通队列文件；缺库、缺表不初始化，不更改 journal 模式。原绑定在快照内再次核对，不能通过导出重写目的地。

先核对已知字段，再计数和按列字节长度检查，合格后才读取对应完整正文。最多 100 个任务、100 个生成关联，合计原始数据、规范内容及最终格式化文件均受 32 MiB 上限限制；任一超限或损坏拒绝整份结果，不分页截断或跳过坏记录。单个 payload 最多 1 MiB、非 payload 元数据最多 16 KiB；生成记录最多 2 MiB，原绑定最多 16 KiB。空任务库合法，可选关联表“缺失”和“存在但空”分别记录。

完整任务保留 14 个字段：job_id、request_key、payload、payload_hash、status、attempts、next_attempt_ms、uncertain、error_code、trace_id、receipt、created_at、lease_token、lease_until_ms。payload 与 receipt 保留原字符串，检查正文摘要、规范创建请求、回执完整字段、状态/租约组合、计数/时间范围；不重新序列化正文来修复原记录。sending 的原租约保持原样，即使当前已过期也不回收；uncertain 不清零，submitted 不降级为 queued。

生成关联保留 job_id、record_sha256、schema_version、record_json、attached_at。完整生成记录须通过既有内层摘要检查，原网关/身份及生成草稿必须与父任务完全一致，原文须符合其既有规范序列化。缺失父任务、重复关联、不同生成内容、未知字段或丢失关联都不生成部分成功快照。

## 文件格式与离线核验

v1 文件 `{schema_version:1,kind:'proposal-queue-backup',captured_at,binding,jobs,generation_history_present,generation_records,sha256}`。captured_at 为本地组装时间，不声称等于服务器或任务事件时间。jobs 按 job_id 严格升序且 request_key 唯一；关联按 job_id/record_sha256 严格升序，拒绝重复、乱序、孤立关联。原绑定规范前后必须完全一致，不能加载文件时换账号或改变网关。

sha256 是去掉 sha256 字段后整个规范文档的 SHA-256，覆盖所有任务状态、正文、租约、关联原文和捕获时间。离线读取先核对普通文件身份与大小，再有界读取、核对实际长度、严格 UTF-8 和 JSON，随后逐项验证格式/内层摘要/关联及外层摘要；同时验证最终格式化文件不超过 32 MiB。摘要证明内部一致性，不是服务器签名，也不证明文件来自可信操作者、当前状态未变或某次发送未发生。

## 文件保存与失败保留

新输出路径在打开队列之前预检。快照读取事务完成后先关闭只读队列，关闭确认后才保存文件。沿用既有新文件发布器：同目录独占临时文件、完整写入并同步、读回核对，再以不覆盖目标的方式发布和读回；不存在覆盖、删除原队列或复制活动 WAL 的动作。文件系统须支持该既有发布流程，不扩大为目录元数据断电持久性保证。

已取得完整快照后若关闭或保存失败，CLI 返回 `PROPOSAL_QUEUE_BACKUP_EXPORT_FAILED`，保留完整 backup、输出路径、阶段及 close_state；文件发布结果可能未知，先保留输出并检查目标，不能把失败解读为原队列被回滚或被修改。快照生成前的失败不输出部分任务正文。错误封套可通过下述补存入口提取完整快照，不能直接当成备份文件交给 `inspect-queue-backup`。

## 已保留快照补存

`proposal-worker queue-backup-recover --file RETAINED_BACKUP_OR_ERROR.json --output NEW_BACKUP.json [--preview]` 接受完整 v1 备份、原导出失败 JSON 或本命令再次失败时保留的 JSON。输入必须是完整普通 UTF-8 JSON 文件，不能包含日志前缀、多段 JSON、截断正文或仅摘要；文件最多 32 MiB + 128 KiB，完整 backup 继续受原 32 MiB 与所有内外摘要/字段/状态/关联约束，输出元数据另限 64 KiB。验证后保持原捕获时间、绑定、摘要、原 payload/receipt 字符串、所有任务状态/租约/未知标记与生成关联，不重新捕获或填补丢失数据。

失败封套只允许 code、backup、output；原导出代码为 `PROPOSAL_QUEUE_BACKUP_EXPORT_FAILED`，close 阶段只接受 not-confirmed，save 阶段只接受 closed。补存失败代码为 `PROPOSAL_QUEUE_BACKUP_RECOVERY_FAILED`，prepare/save 阶段均要求 not-opened。可选文件保存阶段与发布结果必须成对且一致，非 create 保存阶段必须带临时路径；未知字段、矛盾的阶段/关闭状态/发布结果均拒绝。关闭和发布状态仅描述原错误记录，不证明当前队列状态或原文件是否存在。

先完整核验输入，再检查明确指定的新目标。`--preview` 只输出摘要、recovery_source、queue_access=none 及新目标，不创建文件，也不预留路径或保证后续写入成功。正式执行沿用独占新文件发布器并读回；目标已存在或并发出现均拒绝覆盖，输出与输入为同一文件时也不覆盖。错误中的 output_path/temporary_path 仅作元数据，不作为输入/输出，不读取、不清理、不续写旧临时文件。需要替换目的地时必须另给新的 `--output`。

准备目标或保存失败后，标准错误保留同一完整 backup 和本次阶段；原输入无效时不输出不可信的部分备份。再次失败的完整 JSON 可重新交给本命令。成功与预览的标准输出仅含原备份摘要和操作结果，不打印任务正文。原队列关闭失败的快照也可以补存，但本命令不会声称原关闭问题已解决；not-opened/queue_access=none 只说明本次没有打开队列。补存不需要凭据，不连接网关，不恢复数据库、回收租约、结算回执或重发任务。补存后的文件可用 `inspect-queue-backup` 核验。

## 备份离线目录与原查询取回

2026-11-04 增量提供三个离线入口，无需queue、binding文件、模型配置或访问令牌；不接受这些参数，也不打开SQLite或联网。所有入口复用稳定普通文件的有界UTF-8读取与完整备份核验，保留100任务/100生成关联/32 MiB及原单行预算。即使只查看一项，所有未选任务、生成关联、内外摘要和原绑定仍须有效，损坏不能通过筛选跳过。输入只能是完整备份，原导出失败封套先经已有补存入口保存。

| 命令 | 参数 | 输出 |
| --- | --- | --- |
| `queue-backup-list` | `--file BACKUP.json`；可选`--state all/queued/sending/retry/blocked/submitted`、`--limit 1..100`；续页`--before JOB_ID --sha256 BACKUP_SHA256` | 有界任务元数据页、全备份任务数/所选状态总数、get_query及next_query |
| `queue-backup-get` | `--file BACKUP.json --sha256 BACKUP_SHA256 --id JOB_ID` | 单份完整原任务与全部相关生成关联 |
| `queue-backup-receipt-query` | 同一文件、摘要及ID选择，另需`--output NEW_QUERY.json` | 独占保存原回执查询文件；标准输出仅来源、绑定和保存摘要 |

列表默认25条、最多100，默认state=all。严格限制参数和枚举，未知/重复/不适用选项拒绝；库函数查询仅允许limit/state/before/backup_sha256，输出query补入当前实际备份摘要。任务按原job_id倒序，before为排他位置，必须是这份备份内的原ID；有before时必须带摘要，即使路径相同也不能把旧位置用于新备份。首屏可带摘要明确固定文件。next_query保留state/limit/backup_sha256，仅before更新为本页末项，最后一页为null；重新选择状态时应从首屏开始。matching_jobs统计这份完整备份中该状态的所有任务，不是当前队列数量。列表只有ID、状态、attempts、uncertain、error_code、created_at、生成关联数及get_query，不输出正文、原请求键、回执、trace或租约令牌。

get和receipt-query必须传完整备份sha256与原job_id；摘要不符或缺项明确失败，不输出部分内容或创建文件。get返回原14字段、原payload/receipt字符串及所选job_id的全部原生成关联，保留原状态、时间、租约和未知标记；不凭当前时钟回收租约，也不把submitted当成刚查询过的远端结果。generation_history_present保留原可选表存在含义，即使所选任务没有关联；这份报告不是全库备份或可导入的新备份格式。输出包含原绑定、捕获时间、backup_sha256及file-consistency-only/queue_access=none/current_queue=not-checked/current_remote=not-checked/restoration=not-performed边界。备份内部一致不能认证来源或赋予发送资格。

receipt-query从备份原binding取五字段identity，从所选任务取原request_key和完整规范payload，经既有parseProposalCreateReceiptQuery重新核验，生成仅包含identity/request_key/draft的原查询。输出使用紧凑JSON，无额外封套或换行，保持既有1 MiB输入预算；原网关、备份摘要、捕获时间和任务ID在成功报告中保留，文件自身不包含gateway_url。调用者后续可在该原网关及同身份配置下显式使用`workctx proposals receipt --json-file NEW_QUERY.json`；本命令不执行查询，不生成回执、不结算队列、不清除uncertain、不修改草稿或换键，也不生成可重发授权。原查询与来源备份、成功报告应一起保留。

源和选择全部核验后才准备新目标；目标必须位于已有目录且尚不存在，不允许标准输出、覆盖源文件或并发出现的已有文件。沿用独占临时文件、完整写入/同步/读回、不覆盖目标发布及最终完整读回流程；成功只说明查询文件保存完成。准备或保存失败返回PROPOSAL_QUEUE_BACKUP_QUERY_EXPORT_FAILED，保留完整recovery.query、原绑定/摘要/ID及prepare/save阶段，底层失败另含保存阶段、可能已发布状态及临时路径。源无效或选择失败不构造不可信查询。原备份仍可重新用于另一个新输出，不自动覆盖或清理旧文件；失败JSON不是备份或纯查询文件，不能直接交给已有inspect-queue-backup或回执查询入口。退出0表示本次离线读取或文件保存完成，退出1表示失败，均不表示原任务成功或当前可重发。

纯函数listProposalQueueBackupJobs/getProposalQueueBackupJob/prepareProposalQueueBackupReceiptQuery及两种查询解析器同步重新核验输入，不访问文件、数据库或远端；CLI在其外层执行明确文件读取/保存。没有新备份格式、数据库schema、依赖或服务器API，仅源码文档及人工审阅，未编译、类型检查、测试、运行CLI/产品/SQL/数据库或发布。

## 与现有队列只读比较

`proposal-worker queue-backup-compare --queue EXISTING.sqlite --binding binding.json --file BACKUP.json` 先完整核验备份文件，再核对指定绑定与备份原网关/项目/actor/client 完全一致，随后原生只读打开已有目标。目标复用完整快照读取路径：同读事务核对原绑定、已知结构、全部任务和生成关联，计数/大小预检后完整读取；双方分别受 100 任务、100 关联、32 MiB 限制，目标超限或损坏不降级为部分比较。缺库不初始化，可选生成关联表不创建。目标关闭确认后才计算并输出比较结果。

导出的完整 BACKUP.json 可直接比较；保存失败封套须先用 `queue-backup-recover` 补存为备份文件。命令不接受 output/preview/key/timeout 等无关参数，不需要访问令牌或模型配置。退出码 0 表示比较完整完成，仍可能存在差异；读取、核验、绑定或关闭失败返回错误，不输出部分差异。此命令不保存比较文件，不变更目标队列，不发送任务或查询远端回执。

报告以备份为左侧、目标快照为右侧，输出双方摘要/捕获时间、原绑定、分类计数、逐项标识与 changed_fields，任务仅显示编号、状态、attempts 与 uncertain。完整 payload、request_key、receipt、lease_token 和生成原文不输出。字段比较覆盖全部已知字段并保留字符串精确差异；对象属性顺序不构成差异。数组按已验证的原编号/摘要排序，包含所有条目而不截断。

- 任务同时按 job_id 和 request_key 查找。两者都未见才标 missing；优先比较同编号目标，否则比较同原键目标。任务编号、原键、原 payload 或摘要任一不同均标 conflict；原请求完全相同但其他字段不同标 changed；所有 14 个字段一致标 identical。matched_by 与 request_key_owner_job_id 显示匹配依据及原键当前所有者，双方交叉占键也不会被当成缺失任务。
- current_only_jobs 独立列出所有备份中没有该编号的目标任务。同键不同编号的目标既可出现在冲突匹配中，也属于这个目标独有清单；计数不是互斥的全局任务合计。备份侧 identical/missing/changed/conflict 四类互斥且总数等于备份任务数。
- 生成关联按原 job_id/record_sha256 精确配对，比较全部五个字段，分 identical/missing/changed；另列目标独有关联。parent_job_state 同时标明父任务比较结果，不把“关联同文”解释为父任务状态相同，也不把同键异编号任务的关联自动重映射。
- generation_history 单独比较关联表是否存在，缺表与存在但空表不同。总 identical 只有所有任务/关联一致、无目标独有项且可选表存在状态一致才成立；捕获时间与因此变化的外层快照摘要不参与内容相等判定。

`compareProposalQueueBackups` 也提供两份完整快照的纯比较入口，重新验证双方格式、内外摘要和原绑定后返回相同结构，不访问文件或数据库。比较只证明给定本地快照的差异：captured_at 不证明先后因果，missing 不证明从未发送，changed 不表示可覆盖或该采用哪一份，identical 不证明远端同步或可重发。报告明确标记 local-snapshot-comparison-only、current_remote=not-checked、restoration=not-performed；目标在读取后仍可能改变。现有队列补缺合并使用下文独立的完整计划和再次核对，不能直接把本比较报告当成写入授权或恢复计划；新文件恢复也不消费本报告。

## 从备份恢复新队列

预览：`proposal-worker queue-backup-restore --file BACKUP.json --binding binding.json --output NEW_QUEUE.sqlite --preview`。正式执行使用相同入口，将 preview 换为 `--confirm-sha256 BACKUP_SHA256`，摘要来自完整备份或预览报告。preview 与确认参数互斥；正式执行必须与本次重新核验的完整备份摘要完全相等。每次重新检查原绑定和新目标，预览不预留路径。未知/重复/不适用参数拒绝，不接受 queue 参数，因此没有原地覆盖或合并模式。

输入仅为完整 v1 备份，错误封套先经补存入口保存为备份文件。解析、摘要/关联核验、绑定匹配、确认和状态转换的全量校验都在创建目录/数据库之前完成。预览只读取备份/绑定及目标路径信息，不打开数据库、不创建文件。库入口 `restoreProposalQueueBackup` 同样重新核验输入，操作类型在异步路径检查前固定。双方必须保持原网关/tenant/workspace/project/actor/client，不允许恢复时改身份或换请求键。

恢复策略固定为 quarantine-unconfirmed：

- 原 submitted 任务的全部 14 个字段保持一致，包括原历史回执。历史 submitted 仍不等于本次已查询远端。
- 原 queued/retry/blocked/sending 全部转为 blocked、uncertain=1、error_code=PROPOSAL_QUEUE_RESTORED_UNKNOWN，lease_token/lease_until_ms 清空。即使原 queued 的 attempts=0，也不能据旧备份证明备份之后没有发送。
- 原 job_id/request_key/payload/payload_hash、attempts、next_attempt_ms、trace_id、created_at 以及全部生成关联原文/摘要/attached_at 保留。原错误与租约等被转换的字段仍在输入备份中，必须保留该文件；新数据库不包含备份文件的完整原状态档案。
- 可选生成关联表缺失或存在但空的区别保留。没有可选表就不建该表，有表则连同全部关联恢复，不跳过任何条目。

新库没有可直接领取的 restored queued/retry/sending 任务，恢复过程不生成或发送请求。当前 worker 显式 retry 会保留 uncertain；后续 flush 对这些任务只查询原创建回执，not-observed 保留未知而不重发。也可通过现有 receipt/reconcile 处理原请求；恢复本身不调用这些命令。未发送任务如何解除未知并重新允许创建仍待独立开发，不能以手改 uncertain、换键或旧版本发送器替代。新库不会撤销或终止旧进程的租约；旧源队列完全不打开，跨版本发送器协调仍不在本次范围。

完整备份、转换后的完整逻辑状态各受 100 任务/100 关联/32 MiB 及原单行预算约束，转换后超限也在写入前拒绝。SQLite 新文件另限 64 MiB，以容纳页和索引；完整读回前不发布目标。新文件必须位于已有且由调用方控制的目录，已有目标、符号链接、同名 -wal/-shm/-journal 均拒绝，目标名称本身也不能以这些日志后缀结尾。原备份路径作为目标同样因已存在而拒绝覆盖。

正式恢复在目标目录下独占创建临时子目录与空文件，使用共享的既有 v1 建表定义，不加载来自备份的 SQL/DDL。新库采用 DELETE 日志模式、FULL 同步和外键检查；同事务插入原绑定、全部转换后任务与关联并提交，关闭写连接后再原生只读打开，在同读事务完整抓取并逐字段比较预期状态。读回必须包含所有任务、关联和可选表，之后关闭读连接。此处新库内的事务执行仅是实现代码，本轮没有实际执行 SQL 或数据库操作。

随后同步文件，按文件身份/大小/修改时间有界读取文件摘要；目标与日志路径再次检查后，以不替换已有路径的硬链接保存新文件，再核对目标身份、大小和完整文件摘要。全部 SQLite 连接在目标出现前已关闭，不搬运活动 WAL。文件系统需支持同卷硬链接；不承诺目录元数据断电持久性，也不把文件校验解释为发布后无人修改的证明。

确认目标后只清理本次同身份的临时文件链接与已空的临时目录，不递归删除。清理失败仍保留已验证的新队列并返回 cleanup_pending 与本次临时路径；临时路径可能已删除而仅目录待清理，不能把临时副本当第二个活动数据库同时打开。成功报告含原备份摘要/时间/绑定、保留提交数、隔离数、新增未知数、解除旧租约数、逐项隔离摘要及新文件摘要/字节数，不打印任务正文/原键/租约令牌。

路径准备、导入、提交、关闭、读回、同步或目标保存失败返回 `PROPOSAL_QUEUE_RESTORE_FAILED`，保留操作摘要、目标路径、阶段、临时导入状态、关闭状态、未知发布状态及本次临时路径。未完成的目标或临时文件不自动覆盖/删除/续写；原输入仍需保留，确认现场状态后另选新目标。临时导入已提交不代表目标已保存，linked-but-not-verified 也不代表成功。预览/成功返回0，失败返回1；成功只表示本次新库恢复和文件读回完成，不表示任务已提交、可重发或远端状态一致。

## 向已有队列补入缺失内容

`queue-backup-merge --queue EXISTING.sqlite --binding binding.json --file BACKUP.json --preview` 原生只读预览。正式执行以 `--confirm-sha256 PLAN_SHA256` 替换 preview；此处确认的是合并计划 plan_sha256，不是原备份摘要或 queue-backup-compare 的结果。两种模式互斥，不接受 output 等无关选项，不需要凭据。打开队列之前重新核验备份与原绑定，缺失库不创建，已有未知结构/损坏拒绝。preview 的全部目标读取在同读事务中完成，不创建可选表。

纯入口 `planProposalQueueMerge`、队列方法 `previewBackupMerge` 和 `mergeBackup` 共用同一计划器。计划覆盖备份和完整目标的所有逻辑字段、全部目标独有任务/关联及可选表存在状态。target_content_sha256 仅排除每次读取变化的 captured_at 与外层 sha256，原任务/关联时间、状态、正文、租约都参与摘要；源 backup_sha256、完整目标摘要、预期结果摘要和固定 missing-only-quarantine-v1 策略共同生成 plan_sha256。摘要绑定内容而不绑定路径或远端状态，不能充当锁；操作仍以本次显式 queue 路径为目标。

所有备份任务均须参与预检。job_id 和 request_key 两者均未见才允许添加，添加行沿用新队列恢复的共享隔离策略：submitted完整保留，其他转blocked/uncertain并清空复制的租约。已有同编号任务必须与备份原行全部14列相同（keep-original），或与该原行经过相同隔离策略的结果全部相同（keep-restored），才保持原样。后者让已补入且尚未变化的隔离任务可再次识别。其他编号占用同键、不同正文、回执、计数、时间或租约等差异均为 conflict；即使差异可能来自正常进度，也不据捕获时间自动覆盖或采用某一份。

生成关联按原任务编号和记录摘要配对，缺失才补，存在时五列必须完全相同；attached_at不同也冲突。父任务存在冲突时整批停止，不能单独补入其关联。目标独有任务/关联原样保留；可选表在目标已有时保留，在目标缺失且备份标记存在时才按共享v1定义创建，即使该表为空也保留其存在含义。不存在任何 UPDATE/DELETE/重排任务/释放已有租约的步骤；本命令也不停止目标原有的发送活动。

预览输出每项 add/keep-original/keep-restored/conflict、任务原/现状态、原键当前所有者编号、冲突原因/字段名及关联差异、数量和可选表计划，不输出正文、请求键原文、回执或租约令牌。任一冲突使 can_merge=false、plan_sha256=null、expected_content_sha256=null；列出的添加数量只是假设冲突解决后的候选，不会部分执行。格式损坏或无冲突时合并后的总量超过100任务/100关联/32 MiB及原单行限制，则报错而不生成可执行计划。

正式执行仅打开已有可写队列，使用 BEGIN IMMEDIATE 取得本地写事务后完整重读目标并重新生成计划。所有冲突和旧摘要确认都在首次写入之前拒绝；预览后包括目标独有项在内的任何逻辑内容变化都会使旧确认失效。全部预检后才按计划创建可选表、插入缺失任务及关联，不使用覆盖型插入。插入后在同事务重新读取整个队列，逐字段比较完整预期结果，最后提交。所有写入都在一个事务中；执行本身不调用模型、网关、retry、flush 或回执接口。

预览后无需写入的计划也可明确确认，返回 state=unchanged、mutation=none；实际补入成功返回 state=merged、mutation=committed。有补入或建表的合并成功后目标摘要改变，旧计划不能再次使用；提交结果未知时须保留原备份并重新预览，不能直接重用旧确认。新预览能识别同文已存项，但已有任务后来正常执行而变化时仍报告冲突，不能把它当成缺失再插入。

事务失败返回 PROPOSAL_QUEUE_MERGE_FAILED、原备份摘要、已构造计划、阶段、回滚状态及 mutation。写入尚未尝试为none；提交前且明确回滚为rolled-back；提交或回滚无法确认时为not-confirmed。CLI总会尝试关闭连接后才报告；关闭失败使用 PROPOSAL_QUEUE_MERGE_CLOSE_FAILED并保留原操作结果/错误，已明确提交的mutation=committed不会被改写成未写入。预览完整完成即使有冲突也返回0，具体资格见can_merge；执行失败或关闭失败返回1。只读预览与事务实现均仅写入源码，本轮没有执行CLI/SQL/数据库。

本次完成严格的整批补缺合并，不支持覆盖不同内容、挑选冲突字段、在不同原绑定之间搬运、放宽容量或解除未知状态。原始备份必须保留；恢复新增的未知任务仍只能经当前worker查询原回执，已有任务的发送策略维持原状。

## 剩余工作

已完成完整备份导出、离线核验/目录/单任务审阅/原查询导出、保留快照文件补存、现有目标只读比较、新文件恢复及已有队列严格补缺合并源码。冲突内容处置、显式解除未知、旧版本进程协调、自动备份/保留/清理、超大队列分卷、独立生成日志联合备份、文件签名及运行证据仍缺。R-009/P7-01 保持未完成；沿用原 v1 schema，无实际 SQL/数据库执行、迁移或依赖变化。
