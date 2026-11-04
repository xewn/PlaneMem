# 向已恢复生成日志补入缺失文件

更新：2026-11-04。仅源码与文档开发、人工核对；未编译、类型检查、测试、运行 CLI/模型/产品、访问数据库或发布。P7-01 / R-009 保持未完成。

## 入口和适用目录

`generation-journal-merge` 将完整备份中目标尚未保存的原文件补入已有恢复目录。目标必须继续保留有效的恢复隔离标记和匹配的原备份，两者及所有规范日志都属于同一个原绑定。普通运行目录不适用，不会自动把它转换为隔离目录。

以下仅为命令说明，本轮没有执行：

```text
pnpm proposal-worker generation-journal-merge --file BACKUP.json --journal RESTORED_DIR --binding binding.json --preview
pnpm proposal-worker generation-journal-merge --file BACKUP.json --journal RESTORED_DIR --binding binding.json --confirm-sha256 PLAN_SHA256
```

先暂停所有可能写入目标的进程，包括原结果补存操作。`--preview` 与 `--confirm-sha256` 二选一，确认值使用预览返回的 plan_sha256，不能使用源备份摘要代替。库入口为 `mergeGenerationJournalBackup(value, directory, binding, { preview?, confirm_sha256? })`。

读取 `.generation-journal-restored.json`，严格检查现有v1八字段、原restore_id/UTC时间、block-new-generation策略和completion=not-attested；同时完整验证 `generation-journal-source-backup.json`，核对摘要及六字段绑定。标记和原备份必须为常规文件，身份/长度/修改时间/变更时间在读取前后须一致。标记不是恢复成功证明，合并只处理此次来源与可完整读取的目标；不宣称原恢复已完成。

源与目标均执行完整备份验证；目标复用两轮读取。目标的全部规范 request/attempt/outcome 文件必须恰好对应当前绑定的完整记录，拒绝混入其他绑定、孤立文件、损坏、额外规范文件或读取中变化。不规范文件和其他历史备份不合并、不删除，但计入10,000条目录枚举上限。

## 合并规则与计划

复用 [差异比较](proposal-generation-journal-comparison-runtime.md)：任意原请求/领取/结果异文或跨键ID冲突，整批预检失败，返回带comparison的CONFLICT，不保存副本或写日志。原时间或摘要不同不能因为生成正文相同而忽略。

- identical和current-extends-source保留目标全文，不覆盖更多结果。
- missing-in-current新增原request及原来存在的attempt/outcome。
- source-extends-current只新增目标缺少的attempt或outcome，已有前置文件须完全相同。
- 目标独有请求原样保留。联合结果仍须满足最多100请求、完整备份格式32 MiB和共享JSON复杂度限制；不截断、不自动移除旧内容。

计划列出来源、规范目标路径/目录设备及文件标识、原恢复标记与两份保留文件的身份信息、当前和预计联合内容摘要、逐请求新增文件种类及证据文件名。计划采用有界规范JSON和SHA-256（最多512 KiB）；内容摘要覆盖binding和所有原请求/领取/结果，不包含本次新观察的起止时间。

执行重新读取并生成同一计划，必须与确认摘要完全一致。换源备份、换目录、目录重建、原隔离证据变化或任何原日志内容变化均要求重新预览。原文档内部的时间/摘要仍参与内容比较；排除的只是本次捕获的外层观察时间。报告中的comparison和将要保存的before快照观察时间可因重读而不同，不影响已确认的原内容。

内部只借用v1备份形状检查联合结果的结构/大小，不把预计结果作为已发生的观察保存。最终报告里的快照摘要来自实际读回，不能把内部验证形状当作真实备份。

## 写入顺序和保留副本

有缺项时，先独占保存两份完整证据文件，再开始新增日志：

- `generation-journal-merge-source-<source_backup_sha256>.json`：本次来源完整备份；已有同名文件必须整份同文。
- `generation-journal-merge-before-<current_content_sha256>.json`：目标写入前的完整真实观察；已有同名文件必须具有完全相同的逻辑内容，保留首次保存的观察时间/摘要，不重新包装或覆盖。

文件名和内容受到检查；副本已有/缺失只影响create/retain动作，不改变已确认的逻辑合并范围。损坏或异文副本拒绝操作。没有任何缺项时返回unchanged，不写证据或日志，报告动作not-needed。

副本发布沿用独占临时文件、同步、完整读回、不可覆盖硬链接发布及最终读回。两份副本保存或读回失败时不开始新增日志。副本完成后再完整捕获目标、核对仍等于确认的原内容，并重新检查目录范围和原隔离证据。

每个待补请求先完整重读已有状态（新请求要求三个文件均不存在），按request→attempt→outcome顺序只发布计划中的缺项，随后重读该请求全部文件并核对预计内容。每次写入前后重查目录身份、原隔离文件身份/时间和标记全文。完整原备份在操作边界再次全文核验；不把文件元数据检查当作来源认证。

最后完整捕获并核对全部目标逻辑内容、规范文件集合、来源/原快照副本及原隔离证据，全部一致后返回merged-blocked、verification=complete-readback、新增文件/证据路径和最终观察摘要/时间。来源副本和目标原快照不自动清理，原隔离标记/原恢复备份不改写；此功能不解除生成限制。

单份读取/输出沿用原上限（request/outcome 3 MiB、attempt 8 KiB、备份32 MiB、标记64 KiB），每次完整捕获依然每轮32 MiB预算；操作可能进行多次独立捕获及证据读取，32 MiB不是整次操作总I/O上限。目录预检计入拟新增日志和新证据文件，待清理临时文件也占用后续枚举额度。

## 失败、竞争与恢复方式

多文件组不是事务，报告固定atomicity=per-file-only。任何后续失败保留所有原文件和已新增内容，不回滚删除、不覆盖冲突、不自动重试。一个请求可能只补了一部分，但写入顺序与原隔离仍阻止据此重新生成；应保留全部文件并重新比较/预览。当前状态改变后旧计划摘要失效，不能沿用旧确认继续写。

执行失败为PROPOSAL_GENERATION_JOURNAL_MERGE_FAILED，包含trace、计划/源摘要、目录、phase（preserve-evidence/recheck-target/check-request/add-files/verify-request/verify-complete）、active_file、journal_mutation、已确认新增的日志/证据路径、证据预定路径和临时文件路径。保存失败另保留publisher阶段和publication状态。journal_mutation仅说明本次调用是否开始尝试写日志，不说明其他进程未写入；已确认文件清单也不排除另有已发布但尚未确认的文件。

预检错误同前缀包含CONFIRMATION_REQUIRED、BINDING_MISMATCH、QUARANTINE_REQUIRED、TARGET_SCOPE、CONFLICT、LIMIT、EVIDENCE_CONFLICT、CHANGED、UNAVAILABLE；确认与新计划不一致为PLAN_CHANGED且不写文件。源/目标备份原有校验错误保持。预览、unchanged和合并成功退出0；冲突或任何失败退出1，预览冲突也不产生可确认计划。

命令不锁住或终止其他写者，不提供跨进程事务。并发出现相同或不同的文件都不会覆盖，写入前/后观察到变化则拒绝或报告未确认；最后读回之后仍可能有外部变化。不可检查的目录、被替换的隔离文件或损坏副本不能通过强制参数跳过。旧worker/外部手工删除隔离文件不受当前门禁保证；须保留原备份并协调进程。

整个流程不读取凭据、调用模型/供应商、打开队列、释放领取或改变原结果。普通运行目录原位合并、冲突处置、明确解除隔离、自动保留/清理、跨进程协调和运行证据仍待开发。
