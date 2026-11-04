# 生成日志备份离线取用契约

更新：2026-11-04。仅源码和文档开发、人工审阅；未编译、类型检查、测试、执行 CLI/模型/数据库或发布。R-009 尚未完成，运行证据待补。

## 命令与输入

```text
proposal-worker generation-journal-backup-list --file BACKUP.json [--state all|prepared|attempted|generated|failed] [--limit 10] [--after REQUEST_KEY_SHA256 --sha256 BACKUP_SHA256]
proposal-worker generation-journal-backup-get --file BACKUP.json --sha256 BACKUP_SHA256 --key ORIGINAL_KEY
proposal-worker generation-journal-backup-result --file BACKUP.json --sha256 BACKUP_SHA256 --key ORIGINAL_KEY --output NEW_RECORD.json
proposal-worker generation-journal-backup-outcome --file BACKUP.json --sha256 BACKUP_SHA256 --key ORIGINAL_KEY --output NEW_RECOVERY.json
```

输入为完整的 [生成日志备份](proposal-generation-journal-backup-runtime.md)，最多 100 请求、32 MiB。每次先验证全部内外摘要、原绑定、排序、唯一身份和请求/领取/结果关联，再筛选；未选中的记录损坏也会拒绝整份。命令不接受 journal、queue、binding 或 provider 参数，不打开日志目录/队列，不读取凭据或联网。CLI 仍有共享静态依赖加载，不承诺无原生模块加载。

库查询/选择解析器使用 4096 字节快照，拒绝未知字段。CLI 拒绝重复或不属于命令的参数。摘要为 64 位小写十六进制；原键沿用可见 ASCII 1–255 字符及既有幂等键校验。

## 目录与完整读取

list 默认每页 10 条，允许 1–20 条；state 默认 all，按原 request_key 的 SHA-256 升序。after 是原键的摘要，不是 request 文档摘要；非空 after 必须同时提供原备份摘要，且位置必须属于同一完整备份。首屏也可指定 sha256 固定版本，换文件摘要拒绝。

返回 total_requests、matching_requests 和 entries。每条含原键及其摘要、request_id/request_sha256、created_at、preparation_sha256、观察状态、attempt_id/摘要/时间、outcome摘要/时间、record_sha256 和原 failure 元数据；不输出来源、草稿或供应商配置正文。get_query 给出固定 backup_sha256/request_key。

query 与 next_query 保留 state、limit、backup_sha256、after；后续使用相同文件并将这些字段映射到命令参数。末页 next_query=null；空备份/没有匹配项返回空 entries。修改筛选条件应从首屏开始，位置本身不是签名或权限凭证。

get 必须提供准确的原备份摘要和原键，返回完整 entry={request,attempt,outcome,state} 及来源。不存在不返回空成功，不用 ID、摘要前缀或相似键猜测记录。输出含原来源正文、模型配置和草稿，应按原数据范围保管。

所有报告均保留备份观察起止时间、coverage、consistency、完整 binding、backup_sha256，并标注 verification=file-consistency-only、journal_access/queue_access=none、current_journal/current_provider=not-checked、restoration=not-performed。provider_dispatch=not-sent 只描述本次离线调用，不覆盖历史 failure.provider_dispatch，不证明 prepared 从未调用或 attempted 已失败。

## 两种原内容导出

result 要求原 outcome.record 存在，保存原 proposal-generation 文档，沿用 2 MiB 独立记录校验与发布。原来源准备、模型输入/结果、草稿、时间及所有摘要保持；prepared、attempted、failed 不生成替代结果。新文件可供 inspect-generation 核验，以及之后显式执行 enqueue-generated 使用；导出自身不入队、不提交。

outcome 要求完整原 attempt 和 outcome，支持 generated 与 failed。保存文件严格只有三个字段：request、attempt、outcome；使用原绑定与原键通过 inspectGenerationRecovery 校验，8 MiB 上限。保留原 finished_at、失败类别、provider_dispatch 和 outcome 摘要，不用当前时间重建结果。报告元数据、state、outcome_preserved 不写入该文件。

该三字段文件可在后续显式 generation-recover 中使用，但目标必须已存在完全一致的原 request 与原获胜 attempt；导出本身不创建新的领取、不改变日志中的未知状态。隔离目录的生成限制不因导出而改变。完整 get 报告、完整备份和导出错误外层都不是三字段恢复文件。

## 保存与失败

目标必须为现有父目录内的新文件。沿用独占临时文件、同步写入、完整读回、不可覆盖硬链接发布与最终读回；成功仅打印来源、所选请求摘要及 output，不打印 content。目标检查或保存失败返回退出码 1 和紧凑 JSON：code=PROPOSAL_GENERATION_JOURNAL_BACKUP_ENTRY_EXPORT_FAILED、recovery、output。

recovery 保留来源和完整 content；output 保留 output_path、export_phase=prepare|save，保存错误还含 save_phase、publication、可能的 temporary_path。linked-but-not-verified 表示已发布但读回未确认，不声称没有写入。保留完整原备份和失败信息，换新路径重新导出；不自动删除、覆盖或重试。缺结果/选择不符/备份无效在输出准备前拒绝，不返回伪造候选。

失败封套不能整体交给 generation-recover。outcome 导出失败时仅 recovery.content 的完整三字段对象兼容原恢复解析器；result 的 content 则是独立生成记录。优先保留原备份并重新显式导出，失败封套路径只是报告，不自动读取或执行。

主要错误后缀为 QUERY_INVALID、SELECTION_INVALID、CHANGED、POSITION_INVALID、REQUEST_NOT_FOUND、RESULT_UNAVAILABLE、OUTCOME_UNAVAILABLE；前缀为 PROPOSAL_GENERATION_JOURNAL_BACKUP_。成功退出 0，失败退出 1。

## 库入口与未完成范围

worker 导出 parseGenerationJournalBackupQuery、parseGenerationJournalBackupSelection、listGenerationJournalBackupRequests、getGenerationJournalBackupRequest、prepareGenerationJournalBackupResult、prepareGenerationJournalBackupOutcome 及查询/选择类型。prepare 只返回完整候选与来源，不保存文件。每个读取/提取入口均重新全量核验输入，不信任此前调用的结果。

普通运行目录合并、冲突处置、解除隔离、供应商未知调用对账、旧进程协调、联合备份和保留清理仍缺。分页边界、全量损坏拒绝、格式兼容、原时间/摘要保留及文件系统失败处理尚无运行证据。
