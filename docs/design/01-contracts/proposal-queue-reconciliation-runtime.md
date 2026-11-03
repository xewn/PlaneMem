# 建议队列原创建回执与显式结算

2026-11-04，仅源码和人工审阅。未编译、类型检查、测试、运行 CLI/SDK/网关、打开数据库、执行迁移或发布。

## 入口

`proposal-worker receipt --queue EXISTING.sqlite --binding binding.json --id JOB_ID [--timeout-ms 30000] [--output NEW_RECEIPT.json]` 原生只读打开已有队列，取得指定任务的完整原请求，然后只调用 `POST /v1/proposals/creation-receipt`。不发送创建命令或更改本地任务；只有明确提供 output 才独立保存完整回执记录，见下节。

`proposal-worker reconcile` 使用相同参数，明确请求在远端返回 recorded 后结算本地任务；没有独立新请求键、草稿、版本或重试参数。仍使用 `PROPOSAL_WORKER_ACCESS_TOKEN`，读取时必须是原账号/客户端并具备当前 proposal.write/admin。可选 timeout-ms 为1–2147483647，默认30000，用于 SDK/Fetch 查询等待；不涵盖同步 SQLite 打开、读取、写事务或最终输出。库入口为 `readProposalQueueReceipt` / `reconcileProposalQueueJob`，支持固定 access_token、可选 timeout_ms/signal/fetch。

两条命令只接受原任务 ID，不按当前身份重建旧请求。复用既有 SDK 完整身份/原键/规范草稿回显校验、成功2 MiB/错误16 KiB限制，不重定向或重试。查询当前不可见、损坏、缺表或认证失败时保留原任务；not-observed 只代表这次快照没观察到回执，不证明创建失败。详情和当前来源状态未核验。

## 本地快照

在一个只读事务中核对唯一原绑定和目标任务，正文读取前限制 payload 为1 MiB、其他已知列合计16 KiB。完整检查14个 v1列的类型、状态、尝试计数、时间、租约、历史回执、规范草稿和原正文 SHA-256，并核对 job_id/request_key 唯一性。submitted 必须有规范历史回执、uncertain=0且无错误/租约；sending 必须有有效租约元数据，其他状态不得保留租约或回执。发现损坏直接拒绝，不自动隔离/修复。

返回 target 保存原网关/完整身份、job_id、状态、完整原 query，以及绑定和全部已知列形成的 snapshot_sha256。摘要包括尝试、调度、错误、trace、历史回执及租约，供本次网络等待后的比较；它不是来源认证、持久请求 ID或全库审计。网络等待期间不持有数据库事务。payload 作为 JSON 文本再次编码时使用2 MiB+64 KiB内部上限，避免将转义膨胀误认为原正文超限。

## 显式本地结算

仅 recorded 才进入 BEGIN IMMEDIATE，再读取同一绑定和完整目标行、重算摘要，核对原 query/状态。任一字段改变返回 local-changed，不采用新内容继续结算。目标 sending 返回 sending；包括过期租约也不接管，租约过期不证明旧进程已经停止。

queued/retry/blocked 且原行未变时，只更新 status=submitted、receipt、trace_id，清除 error_code/uncertain/租约；保留原键、正文/摘要、attempts、调度时间、创建时间及生成记录。receipt 保存既有最小历史创建回执，replayed=true 表示来自历史读取；完整远端封套和 server_cursor 只随本次输出返回，没有新增持久历史表。写后在同事务完整读取并对照全部已知列，随后提交才返回 submitted/committed。

原行已经 submitted 时，核对现有回执与本次远端的建议/事件/创建时间等字段一致，只忽略 replayed 的首次返回差异；一致返回 already-submitted/none，保留首次本地记录。矛盾或损坏拒绝覆盖。not-observed 不进入本地写事务，不改变已提交任务或 uncertain；当前详情的审核/过期状态不影响历史创建语义。

库内部 `captureReceiptTarget` / `applyCreationReceipt` 分别用于快照和固定目标结算；直接调用后者的受信调用方须先取得并验证实时 Gateway 响应，离线 JSON 的结构正确不证明真实性。普通调用方应使用上述完整网络入口，不能把导入文件当作远端认证。

## 未知结果与打开方式

`receipt` 退出0仅表示查询完成，查看 receipt.data.status；`reconcile` 仅 submitted/already-submitted 退出0，not-observed/sending/local-changed 退出2，错误退出1。输出含完整原建议正文、绑定和历史回执，应按原分类保存，不含令牌。命令正常关闭队列后才输出成功，close_state=closed；关闭失败保留完整结果和 mutation，不把已确认提交改称回滚。

SDK错误或本地结算错误由 `ProposalQueueReceiptError.recovery` 保留原 query/绑定/job_id/快照摘要、已取得的完整回执，以及适用的 phase/rollback/mutation。提交阶段抛错保持 not-confirmed；只有提交前异常且回滚确认才标 rolled-back。原请求捕获前失败没有可认证的完整恢复内容，不捏造回执。CLI 输出筛选后的错误和完整 recovery，先尝试关闭并单独报告关闭状态；不自动导入恢复内容或重做结算。再次明确调用会重新查询远端和当前本地记录，不能证明上次未知事务的因果历史。

新增 `{existing:true}` 打开选项，要求已有普通文件并验证原 v1布局/绑定，不建表、补绑定或改变 journal_mode；可写连接设置同步级别 FULL，receipt 额外原生 readOnly/query_only。默认 enqueue/retry/flush 行为保持。文件预检和 SQLite 打开并非原子绑定：须使用自己控制的目录，不能声称防御并发路径替换；若替换或删除后产生不完整文件，结构验证拒绝而不初始化。WAL/SHM、底层文件和旧发送者协调限制继续适用。

显式 reconcile 不接管 sending。更新后的 flush 门禁见下节；已经运行的旧版本进程不会自动获得门禁。强制停止旧进程、显式解除未知状态、队列完整备份、自动持久对账历史和离线回执认证仍缺；显式单次文件留档见“回执记录保存与离线核对”。无 schema/迁移/依赖变化；运行证据仍缺。

## 回执记录保存与离线核对

2026-11-04：receipt/reconcile 均支持 `--output NEW_RECEIPT.json`，在打开队列和调用网关前检查目标是已有目录中的新文件。正常取得远端结果、完成本地操作并确认队列关闭后，才构造和保存记录。recorded、not-observed、sending、local-changed 等正常结果都可留档；reconcile 保存完成仍保留原退出码0/2，文件存在不表示本地已结算。查询、本地事务或关闭异常仍输出既有 recovery，不自动生成“完成”记录。

v1记录含 `schema_version:1`、`kind:'proposal-queue-receipt'`、`operation:'receipt'|'reconcile'`、`recorded_at`、完整 `result` 和 `sha256`。result保留原网关/五项身份、job_id、原行snapshot_sha256、trace、完整原query/回执、local状态/mutation和close_state=closed。recorded_at只是本机封装时间，不能替代远端创建时间或精确查询时间。SHA-256覆盖除sha256外全部字段的规范JSON，递归对象键按JavaScript UTF-16顺序排序、数组顺序保持；紧凑输入及格式化记录均限4 MiB，原query1 MiB/回执2 MiB限制保持。

检查拒绝未知/缺失字段、不规范绑定、错任务ID/trace/摘要、身份或回执内容不匹配以及不可能的状态组合。receipt只能是not-requested/none；reconcile在not-observed时只能是not-observed/none，recorded时仅submitted/committed、already-submitted/none、sending/none或local-changed/none。不会补默认字段、改写时间、修复摘要或把未观察到解释为失败。

`proposal-worker inspect-receipt-record --file RECEIPT_RECORD.json` 原生读取有界普通文件，核对打开前后身份/长度与严格UTF-8 JSON，完整核验记录后只输出元数据、历史创建回执和本地状态，不输出草稿正文。拒绝标准输入、最终路径符号链接、缺失/超限/读取期间长度或身份变化及损坏内容。命令不需要令牌，不打开队列、不联网、不保存、不创建或结算任务；退出0仅表示文件内部一致。输出明确标记 verification=file-consistency-only、current_queue/current_remote=not-checked。

保存复用既有新文件发布工具：同目录独占临时文件、同步并完整读回，再以硬链接占用新目标并核对发布内容，不覆盖已有目标；目录须受调用者控制，文件系统须支持硬链接。临时文件清理失败仍保留已核验目标并报告cleanup_pending及临时路径，不删除其他文件；没有断电后的目录元数据持久性或恶意路径替换保证。

构造或保存失败返回PROPOSAL_RECEIPT_RECORD_EXPORT_FAILED与完整已关闭result、已经构造出的完整record（若有）、输出路径/阶段和可用的发布信息，退出1。保留原local.mutation，不能把已提交改称回滚。发布确认失败时目标可能已存在，应先离线核对现有文件，不覆盖或重新执行结算来弥补文件保存；完整record可由受信调用方另存新文件。缺少网关回执、未知本地事务和关闭失败仍沿用原错误恢复输出。

库导出createProposalQueueReceiptRecord、inspectProposalQueueReceiptRecord、proposalQueueReceiptRecordSummary、readProposalQueueReceiptRecord、prepareProposalReceiptRecordOutput、saveProposalQueueReceiptRecord及对应类型。创建函数的受信调用方须提供已关闭的完整原结果；函数不能认证调用者声明的数据库状态。摘要只检查所载内容一致性，不是签名或服务器证明，snapshot_sha256未包含原完整行，离线无法重新计算它。文件不认证现在或过去的实际提交、不授权重提，也不能直接传入本地结算；需要新结果时仍调用可信网关入口。

本轮只新增显式单次文件记录，没有自动历史索引、留存清理、整库备份、队列恢复导入或签名验证。文件保存失败后的独立补存见下节。无新表/迁移/依赖，仅源码人工审阅，未运行命令、文件导出、数据库或测试。

## 已保留回执记录的补存

2026-11-04：`proposal-worker receipt-record-recover --file RETAINED_RECORD_OR_ERROR.json --output NEW_RECEIPT.json [--preview]` 读取完整v1记录，或先前PROPOSAL_RECEIPT_RECORD_EXPORT_FAILED输出的完整JSON。预览完整核验输入并检查新目标路径，只输出元数据和output.state=preview；正式执行再次读取核验，以既有独占发布流程保存新文件。两种模式均无需令牌，不打开队列、不访问网关、不重新结算或查询。

恢复文件上限为8 MiB+128 KiB，因错误封套同时保留record与重复result；独立record仍受4 MiB限制，错误output元数据最多64 KiB。沿用普通文件、打开前后身份/大小、严格UTF-8及有界读取。输入必须是完整记录，或严格包含code/trace_id/result/record/output的导出错误；旧record须通过全部字段/身份/原query/回执/状态组合/摘要校验，外层result和trace必须与record完全一致。output只接受原输出路径/阶段及适用的save_phase/publication/temporary_path字段，阶段组合也须一致。

保留原operation、recorded_at、sha256、原query及完整result，不重新封装时间、重算修复摘要或推断缺失结果。没有record的构造失败、只有result的成功输出、未知查询/事务/关闭错误及矛盾封套均拒绝，不凭错误码合成“已完成”记录。成功补存仍只是复制已核验的历史文件内容，元数据继续标记file-consistency-only及当前队列/远端not-checked；not-observed或local.mutation=none不会因此变成已提交。

目标只能使用本次明确的output，须为已有目录中的新文件；已存在则拒绝，无论内容相同与否。预览不预留文件，正式保存时并发占用也不覆盖。源错误中的旧路径、临时文件路径和发布状态仅作为有界元数据检查，绝不据此访问、删除、清理或覆盖文件。若上次发布可能成功，应先inspect-receipt-record检查已有目标；需要另存时选择新路径。

预检或保存再次失败时保留同一完整record/result，并输出同一PROPOSAL_RECEIPT_RECORD_EXPORT_FAILED封套，export_phase为prepare或save，可再次作为本命令输入。已知的原本地mutation保持，文件保存失败不要求重做网关操作。输入读取/核验失败返回对应RECOVERY_UNAVAILABLE/RECOVERY_INVALID，不回写源文件；文件写入仍受既有硬链接/目录可信及断电持久性边界约束。

返回0表示预览完成或新文件保存完成，不表示建议已成功创建或队列已结算；失败返回1。库新增inspectProposalReceiptRecordRecovery、readProposalReceiptRecordRecovery和ProposalReceiptRecordRecovery，返回规范原record与source=record/export-error，调用方可组合既有prepare/save函数。没有恢复目录扫描、历史索引、自动失败归档或数据库导入。仅源码文档和人工审阅，未执行命令、导出、网关、数据库或测试。

## flush 未知结果门禁

2026-11-04：`flushProposalQueue` 在领取前复用完整原任务校验，正文上限1 MiB、其他已知列合计16 KiB，核对原绑定、规范正文/摘要、原键唯一性、状态、时间、计数和租约。可定位的损坏行隔离为 blocked/PROPOSAL_QUEUE_CORRUPT，uncertain 保守置1，保留原文/键；无效任务 ID 无法安全定位时直接拒绝本次操作。attempts 到达安全整数上限也隔离，不继续递增。

未知任务（uncertain=true）和回收的过期 sending 任务只调用 SDK 原创建回执入口，不预检后重发创建。recorded 经完整身份/键/草稿/历史回执校验后，使用本次租约保存既有最小历史回执，replayed=true；not-observed 以 PROPOSAL_SUBMISSION_NOT_OBSERVED 进入退避 retry，保留 uncertain。权限或内容冲突进入 blocked；临时、损坏响应或存储不可用可再次查询。任何失败都不清除已有未知标记、不替换草稿/键、不回退创建。retry 只重新安排原任务，未知状态不解除。

没有未知标记的任务保持原身份预检和创建流程，改用完整有界 JSON：预检成功16 KiB、创建成功64 KiB、错误16 KiB，每请求20秒。查询使用 SDK 成功2 MiB/错误16 KiB和20秒期限。令牌每次领取只获取一次、最多等待5秒，同次请求共用；整个网络和读取过程受期限约束，不重定向。同步数据库操作和事件循环阻塞不受该期限保证。

取得令牌后在发起任何请求前检查原 job_id/状态/租约未过期/键/正文/摘要/attempts；创建前再次检查。失去领取时返回 lease_lost，停止本次派发，不改他人领取。complete/fail 在单条更新中比较原状态、租约令牌、键、正文/摘要和 attempts；租约过期但尚未被他人回收时仍允许原持有者结算。数据库结算失败向上传播，原 sending 可由后续 flush 回收并查询，不把远端成功改称确定失败。这与显式 reconcile 拒绝所有 sending 的规则分别适用。

结果新增 creation_attempts/receipt_queries，表示进入相应调用的次数，不证明请求已经到达服务端；每项 action 为 none/create/receipt，none 可能已经做过身份预检。processed 含领取/隔离任务，持久 attempts 是领取次数，也含查询、令牌失败及后续失去领取。单次只处理开始时到期任务，不等待退避；后续 flush 对未知任务仍只查回执。

门禁不撤销已发送请求，也不能证明旧进程已退出。旧版本 flush 仍可能创建，已过期但未停止的发送也可能迟到；需在外部协调停止旧发送者。not-observed 永远不授权重提；目前没有显式解除未知或强制重提命令。没有新增表/迁移/依赖，只有源码和人工审阅，无运行验证。
