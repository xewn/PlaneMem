# 生成日志恢复到新目录

更新：2026-11-04。仅源码与文档开发、人工核对；未编译、类型检查、测试、运行 CLI/模型、访问数据库或发布。P7-01 / R-009 保持未完成。

## 使用入口

从完整 `proposal-generation-journal-backup` v1 恢复原 request/attempt/outcome 到一个全新目录，供原键状态查询、结果取回及按已有原领取补存结果。恢复目录保持生成隔离，备份里的 prepared 不能用作再次调用模型的依据。

以下仅为命令说明，本轮没有执行：

```text
pnpm proposal-worker generation-journal-restore --file BACKUP.json --binding binding.json --output NEW_JOURNAL_DIR --preview
pnpm proposal-worker generation-journal-restore --file BACKUP.json --binding binding.json --output NEW_JOURNAL_DIR --confirm-sha256 BACKUP_SHA256
pnpm proposal-worker generation-requests --journal NEW_JOURNAL_DIR --binding binding.json
pnpm proposal-worker generation-status --journal NEW_JOURNAL_DIR --binding binding.json --key ORIGINAL_KEY
pnpm proposal-worker generation-result --journal NEW_JOURNAL_DIR --binding binding.json --key ORIGINAL_KEY --output NEW_RECORD.json
```

`--preview` 与 `--confirm-sha256` 二选一；确认值必须等于完整源备份摘要。原六字段绑定须完全一致（网关、tenant/workspace/project、actor/client）。目标父目录必须已存在，目标目录本身必须不存在，包括空目录、文件、符号链接均不覆盖。预览核验源、绑定、选项和目标，报告新路径、文件数量、原备份摘要/时间与隔离策略，不创建目录或写文件。

库入口为 `restoreGenerationJournalBackup(value, binding, outputPath, { preview?, confirm_sha256? })`，由 worker 导出。入口只接收完整备份；保留的导出失败封套先用 `generation-journal-backup-recover` 另存完整文件。

## 写入顺序与读回

源备份先执行现有全部严格校验：最多100请求/32 MiB、原绑定、请求键排序、请求/领取唯一 ID、全部内外摘要、来源/provider/结果关联和四种状态。不会省略失败/未知项，不重建生成正文、领取或 outcome。

执行按以下顺序进行：

1. 独占创建全新目录（非递归 mkdir），记录目录设备/文件标识。其他进程抢先建立目标时直接失败。
2. 独占保存 `.generation-journal-restored.json` 隔离标记并完整读回；未确认此步之前不写任何原请求。
3. 独占保存 `generation-journal-source-backup.json` 完整原备份，其内容/观察时间/摘要保持。
4. 逐请求依次保存原 request、非空 attempt 和非空 outcome，文件名仍由原请求键 SHA-256 生成。所有原文、时间、ID、状态和内层摘要保持；不会为 prepared 伪造领取，attempted 保持原未知领取。
5. 复用两轮完整读取核对所有目标请求与源备份一致，另行核对原备份副本及隔离标记全文。最后核对目录文件集合、普通文件类型和目录身份，只允许应有文件及本次发布器报告的待清理临时文件；缺项、额外文件、内容变化和重复枚举均拒绝成功报告。

每次写入前后检查目录身份，写原日志前后还检查隔离仍可观察。请求/结果各3 MiB、领取8 KiB、源备份32 MiB沿用原限制，隔离标记最多64 KiB；完整读回沿用备份每轮32 MiB/10,000目录条目预算。文件发布仍使用独占临时文件、同步、完整读回、不可覆盖硬链接和最终读回。

隔离标记保留 v1 kind、restore_id、created_at、source_backup_sha256、binding、policy=block-new-generation 和 completion=not-attested。它在原日志前写入，因此仅存在标记不证明恢复成功；恢复时间也不替换任何原调用或观察时间。

成功返回 `state=restored-blocked`、`mutation=new-directory`、`verification=complete-readback`、原来源与数量、路径及 cleanup_pending/temporary_paths。不输出来源/草稿正文，不查询当前供应商或打开提交队列。

## 恢复隔离与原日志入口

当前 worker 在准备新生成请求和派发模型前，检查目录中的两个保留名称。任意一个存在（即使是损坏文件、目录或符号链接）就返回 `blocked-restored`；检查出错且不能确认不存在时返回 `blocked-unreadable`，同样拒绝派发。只有两者均明确不存在才报告 `ordinary-journal`，这个名称只说明没有观察到恢复标记，不证明原调用从未发生。

新请求创建会被拒绝；同键同内容的已有请求仍可只读重放。`generation-run` 对已保存完整成功结果仍仅返回原结果，对原已有领取继续拒绝重发；prepared 在原资格/凭据检查前即受隔离门禁。领取前和实际模型调用前还会重查，若在本次领取成功后发现隔离，则保留领取，通过原结果保存路径记录 `PROPOSAL_GENERATION_JOURNAL_QUARANTINED`、provider_dispatch=not-sent，不调用模型。

`generation-status` / `generation-result` 和请求目录返回 `journal_dispatch`，既有状态字段保持原观察含义。`generation-recover` 仍可只补存完整保留的 outcome，须符合原请求、原已存在领取及原结果冲突规则；它不释放隔离或领取。继续备份、离线核验和独立结果导出也可使用。直接 generate/generate-prepared 是用户另行显式调用的独立流程，不属于日志门禁；恢复命令不会调用它们。

两个保留文件都是隔离依据，必须和日志一起保留。没有自动解除隔离、过期释放或清理入口。已有普通目录若恰有这两个保留名称，也按隔离处理，不因为内容不符合标记格式而放行。

## 中断、失败与并发边界

整个目录不是原子发布。成功报告前可能只写入了一部分文件，任何失败均保留已创建目录、原备份和已有文件，不覆盖、回滚删除或继续向失败目录写入。应保留所有副本，重新预览并选择另一个全新目录恢复；不能通过删除隔离文件把半成品转换为可运行目录。

失败返回 `PROPOSAL_GENERATION_JOURNAL_RESTORE_FAILED`，details 包含原备份摘要、目标、restore_id、phase（create-directory/save-guard/save-source-backup/save-requests/verify）、target_created、guard_status、saved_files、active_file、temporary_paths 和 restoration=not-confirmed。实际发布错误额外保留保存阶段/发布状态/未知临时文件路径，不能将 saved_files 当作完整成功数或将失败当作未写入。guard_status 仅说明此前是否确认过隔离保存，不保证失败时文件仍存在。原始输入备份不被修改或删除。

确认、绑定和目标错误分别使用同前缀 CONFIRMATION_REQUIRED / BINDING_MISMATCH / OUTPUT_UNAVAILABLE；元数据超限为 LIMIT。隔离拒绝码为 `PROPOSAL_GENERATION_JOURNAL_QUARANTINED`，有 trace_id，并将 provider_dispatch=not-sent 明确限定到本次调用。预览/恢复成功退出0，失败退出1。

恢复命令不停止或取消原进程，不查询供应商未知结果，也不锁住外部写者；应暂停相关写者并独占新目录，完整读回仅证明当次观察。旧版本 worker 不认识隔离标记；手动搬走日志子文件、删除两个隔离文件或用旧程序操作均不受此门禁保证。外部替换目录/文件的并发行为在检测到时拒绝报告成功，不能宣称防止所有恶意文件系统竞争或断电丢失。必须保留源备份，已生成不等于远端建议已提交或审核。

已有日志补缺合并、并发原进程协调、供应商对账、显式解除隔离、联合备份和保留策略仍待开发。失败中断、普通与恢复目录门禁、原格式读回及文件系统兼容性尚无运行证据。
