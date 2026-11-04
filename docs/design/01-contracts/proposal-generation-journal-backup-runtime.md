# 生成请求日志完整备份

更新：2026-11-04。仅源码与文档开发、人工核对；未编译、类型检查、运行 CLI、调用模型、测试、访问数据库或发布。P7-01 / R-009 保持未完成。

## 用途与命令

将现有生成请求日志中同一原网关、项目和身份的完整 request / attempt / outcome 合并保存到新文件。保留生成前输入、领取标记、已保存结果及未知调用状态，供独立保存和离线核验。它与提交队列备份不同：尚未入队的生成请求也包括在内。

以下为使用说明，本轮没有执行：

```text
pnpm proposal-worker generation-journal-backup --journal EXISTING_DIR --binding binding.json --output NEW_BACKUP.json
pnpm proposal-worker inspect-generation-journal-backup --file BACKUP.json
pnpm proposal-worker generation-journal-backup-recover --file BACKUP_OR_ERROR.json --output NEW_BACKUP.json --preview
pnpm proposal-worker generation-journal-backup-recover --file BACKUP_OR_ERROR.json --output NEW_BACKUP.json
```

导出前应暂停使用该日志的写者；命令本身不停止进程、不取得跨进程锁。`--binding` 沿用六字段 gateway_url / tenant_id / workspace_id / project_id / actor_id / client_id；规范化后按完整绑定选择，不接受状态筛选、分页或只选成功请求。空范围可以导出零请求备份，不代表其他范围没有日志。

三个命令均在读取队列、凭据或调用模型前独立返回。它们不打开 SQLite、不创建日志目录、不覆写或移除 request/attempt/outcome、不发起生成、不入队、不发送或审核建议。`recover` 只将已经保留的完整备份另存为新文件；不是日志恢复、领取释放或重新运行授权。

## 文件契约

`proposal-generation-journal-backup` v1 包含且仅包含：

- `schema_version: 1`、`kind`。
- `started_at` / `completed_at`：本次两轮读取的规范 UTC 毫秒时间；结束不能早于开始。不是原模型调用时间。
- `coverage: binding-canonical-v1`、`consistency: two-pass-observation`。
- 规范 `binding`。
- `requests`：按原请求键的 SHA-256 严格升序排列的完整状态，最多 100 条；每条恰为 `request`、`attempt`、`outcome`、`state`。
- `sha256`：不含此字段的完整文档按 `proposalReceiptJson` 规范序列化后的 SHA-256。

原请求键/ID、准备记录、来源正文、provider 配置、所有时间/trace/内层摘要、领取 ID、成功生成记录或失败信息原样保留。attempt/outcome 缺失用 null 表达，state 必须与内容一致；有 outcome 必须有其匹配 attempt。请求 ID 和非空领取 ID 不得重复，同键摘要不得重复或逆序。每份请求完整验证自身绑定、准备来源与 provider；每份领取和结果复用既有严格检查，关联回同一原请求及领取，成功结果必须保留同一准备和 provider。损坏的未选状态不能跳过。

请求/结果各沿用 3 MiB 限额，领取最多 8 KiB，嵌套准备/生成记录沿用原限制；整个备份按格式化 JSON 加末尾换行最多 32 MiB，同时沿用共享 JSON 的 100,000 节点/64 层复杂度限制。严格拒绝额外字段、缺字段、非规范时间/绑定/排序、重复关联或任何内外摘要不一致。摘要只证明文件内部一致，不能证明来源真实性、当时文件系统完整或当前供应商状态。

## 范围扫描与变化检测

每次目录枚举最多 10,000 个条目，无关文件也计入枚举上限。只识别小写规范文件名 `generation-<64 hex>.request.json`、`.attempt.json`、`.outcome.json`；这些条目必须是常规文件，符号链接和目录拒绝。不规范名称、临时文件和其他文件不导出，本功能不归档整个目录。

规范 attempt/outcome 找不到同键 request 时整份拒绝，且不以绑定过滤掩盖孤立文件：没有原请求就不能确定其范围。存在 request 的其他绑定先核验完整请求、原绑定、摘要及文件名与原键关系，再跳过其 attempt/outcome 内容；它们不进入备份或错误正文。其他绑定的请求损坏仍会阻止导出，但不会返回其原键或正文。

顺序为目录枚举、第一轮完整读取、再次枚举核对、第二轮完整读取、最终枚举与目录设备/文件标识核对。两轮所有规范文件名集合及选中完整状态必须一致；新增、消失或选中状态改变则拒绝整份。每轮累计正文读取预算 32 MiB（含所有已读请求、选中领取/结果及增长探测字节），两轮最多 64 MiB；达到任一限制都报错，不导出部分范围、不截断、不自动删日志来腾空间。

这不是事务快照：两轮读取之间可能发生再恢复的变化，最后一次读取后也可能有新结果；其他绑定结果正文不作一致性比较。备份中的 prepared 只表示两轮观察未读到领取，不能据此认定供应商从未接收请求。attempted 保持未知，成功/失败也只是日志当时保存的结果，不能推断远端当前状态。输出不附带任何可以重发的资格。

## 新文件保存、核验与失败补存

全部采集/核验成功后才检查目标，沿用既有独占临时文件、同步写入、完整读回、硬链接不可覆盖发布和最终完整读回。目标必须为现有目录内的新文件；原日志、已有输出和未知临时文件不被覆盖或自动删除。文件系统不支持此发布方式时明确失败。

成功输出只含原绑定、备份摘要、观察时间/范围、请求总数及四种状态计数、文件保存结果，不打印来源/草稿正文。离线 inspect 返回同样元数据，并标注 `verification=file-consistency-only`、`current_journal=not-checked`、`current_provider=not-checked`、`restoration=not-performed`。`provider_dispatch=not-sent` 的范围仅为当前备份/核验调用，不改写历史失败中的 provider_dispatch。

采集失败没有完整候选，返回错误且不生成部分备份。完整候选已构造后的目标检查或保存失败，stderr 返回紧凑 JSON：`code`、完整 `backup`、`output`。code 为 `PROPOSAL_GENERATION_JOURNAL_BACKUP_EXPORT_FAILED` 或副本补存时的 `...RECOVERY_FAILED`；output 保留 `output_path`、`export_phase=prepare|save`，实际保存错误另带 `save_phase`、`publication` 和可能的 `temporary_path`。发布后读回失败明确保留 `linked-but-not-verified`，不声称未写入；应保留整个封套。

recover 输入可以是原备份文件，也可以是上述两类完整失败封套。最大输入为 32 MiB + 128 KiB；历史输出元数据最多 64 KiB，严格核对字段、保存阶段与发布状态的对应关系，再完整验证 backup。路径只当历史文本，不访问封套所列目标/临时文件，不信任其保存成功与否，也不要求源日志仍存在。

预览只核验输入和新目标，报告 source=backup/export-error/recovery-error 对应的 `recovery_source` 及预览路径，不写文件。显式补存保留原观察时间、排序、状态和摘要；不重新采集目录或创造新领取/结果。失败继续输出相同完整候选以便另存，成功仍应保留原备份和原目录，备份不能解除未知调用。

主要错误前缀为 `PROPOSAL_GENERATION_JOURNAL_BACKUP_`：`LIMIT` 为条目/请求/字节超限，`ORPHAN` 为缺原请求，`CHANGED` 为检测到变化，`UNAVAILABLE` 为采集不可用，`INVALID` 为文件内容不一致，`FILE_UNAVAILABLE` 为输入文件不可读。恢复输入对应 `RECOVERY_INVALID` / `RECOVERY_UNAVAILABLE`。成功退出 0，失败退出 1。

## 库入口与剩余工作

已有恢复目录可使用 [补缺合并](proposal-generation-journal-merge-runtime.md)，完整核验原隔离证据并确认计划后只新增缺项，保留来源和目标原快照；普通运行目录不接受，既有内容与生成限制保持。

已补 [备份与现有日志差异比较](proposal-generation-journal-comparison-runtime.md)：可以比较两份完整备份，或只读完整观察现有目录。按原键区分同文、缺失、单侧更多文件与原身份/文档冲突，current独有键单列；不合并或赋予重发资格。

`captureGenerationJournalBackup(directory, binding)`、`inspectGenerationJournalBackup(value)`、`generationJournalBackupSummary(value)`、`readGenerationJournalBackup(path)`、`prepareGenerationJournalBackupOutput(path)` / `saveGenerationJournalBackup(preparedOutput, value)`，以及 `inspectGenerationJournalBackupRecovery(value)` / `readGenerationJournalBackupRecovery(path)` 从 worker 导出。

已补 [恢复到新隔离目录](proposal-generation-journal-restore-runtime.md)：先预览并确认源摘要，再完整保存原请求/领取/结果和原备份，保留生成隔离；恢复后的查询、结果导出及原领取结果补存可用，不把 prepared 观察转为再次派发资格。普通运行目录原位合并仍未提供，也不直接从备份文件选择生成记录导出。跨队列/日志联合一致备份、供应商未知调用对账、原进程协调、保留/清理策略、签名/加密及全局审计仍缺。目录并发、文件系统失败、格式兼容和真实运行证据待后续获准后补充，现阶段没有执行结果。
