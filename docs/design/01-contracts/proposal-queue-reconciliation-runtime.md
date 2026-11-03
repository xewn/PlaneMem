# 建议队列原创建回执与显式结算

2026-11-04，仅源码和人工审阅。未编译、类型检查、测试、运行 CLI/SDK/网关、打开数据库、执行迁移或发布。

## 入口

`proposal-worker receipt --queue EXISTING.sqlite --binding binding.json --id JOB_ID [--timeout-ms 30000]` 原生只读打开已有队列，取得指定任务的完整原请求，然后只调用 `POST /v1/proposals/creation-receipt`。不发送创建命令，不保存查询结果或更改本地任务。

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

没有自动拦截旧 flush 重试、强制停止旧进程、过期 sending 接管、队列完整备份、持久对账历史或离线回执认证。无 schema/迁移/依赖变化；运行证据仍缺。
