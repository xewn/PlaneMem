# 生成日志与备份差异比较

更新：2026-11-04。仅源码与文档开发、人工审阅；未编译、类型检查、测试、运行 CLI/模型/产品、访问数据库或发布。P7-01 / R-009 保持未完成。

## 入口与范围

`generation-journal-compare` 可以比较两个完整备份，或把原备份与现有目录的一次完整观察比较。两个输入方向明确：`--file` 为 source，`--against` 或 `--journal` 为 current。以下仅为命令说明，本轮未执行：

```text
pnpm proposal-worker generation-journal-compare --file BACKUP.json --against OTHER_BACKUP.json
pnpm proposal-worker generation-journal-compare --file BACKUP.json --journal EXISTING_DIR --binding binding.json
```

`--against` 与 `--journal/--binding` 互斥；目录模式必须同时给出后两项。比较文件不接收binding覆盖，两份备份必须具备完全相同的规范原网关、tenant/workspace/project、actor/client；目录模式的显式binding也必须与源备份一致。没有状态筛选、分页、确认或输出写入参数。

库入口为 `compareGenerationJournalBackups(sourceValue, currentValue)` 和 `compareGenerationJournalDirectory(sourceValue, directory, binding)`，从 worker 导出。先完整验证双方全部 request/attempt/outcome、原关联、内外摘要、排序和大小限制，再比较；任意一份损坏都拒绝整份，不返回部分结果。单份备份仍最多100请求/32 MiB及共享JSON复杂度限制。

## 差异含义

按原request_key精确匹配，源请求保持原键摘要升序。每条分别比较 request / attempt / outcome，返回 `files`：每份状态为 absent（两侧均无）、identical、source-only、current-only 或 conflict，并列出发生变化的顶层字段名。嵌套准备记录或生成正文不同只标相应 preparation / record 等字段，不输出正文片段。逻辑文档比较不受JSON缩进或字段顺序影响。

每条源请求的总状态如下：

| 状态 | 含义 |
| --- | --- |
| identical | 同键的全部原文档完全一致，含原时间和摘要；两侧都没有的可选文件也一致。 |
| missing-in-current | current没有此原键，也没有发现源请求/领取ID被其他键占用。 |
| source-extends-current | 两侧已有文件完全一致，source另有current未保存的原文件。 |
| current-extends-source | 两侧已有文件完全一致，current另有source未保存的原文件。 |
| conflict | 已有文件不同、请求/领取ID跨键复用，或存在不能表示为单侧补全的混合差异。 |

extension只表达文件存在关系。例如source为prepared、current为attempted或generated，只有request整份相同才归为current-extends-source；它不表示已证明current更新、更可信、调用完成或允许回放。反向比较将对应状态反转。源attempted在current缺少领取时仍保持未知，不会被转换为可重新运行。

同键但request_id、created_at、preparation、provider或任意其他字段不同，均为不可变请求冲突；同一领取ID但开始时间/摘要不同也冲突。原outcome即使结果正文相同，完成时间不同仍为冲突，不挑选较新时间或拼接结果。成功与失败结果不会相互覆盖。

源request_id或attempt_id在current属于另一request_key时，即使原键不存在，也归为conflict。`identity_collisions`返回冲突字段、ID及current所有者的键摘要/请求ID；不按ID把不同键合并。同一源条目可以有两类碰撞，总计只算一条conflict。current中源未包含的键独立列入current_only_requests，即使它同时是上述碰撞所有者，也仍在该列表。

## 返回值与一致性

返回v1 kind=proposal-generation-journal-comparison、原binding、双方完整快照摘要和观察起止时间、请求条目、current独有条目、按源条目的五种状态计数、current_only计数、identical和has_conflicts。源条目的五种计数之和等于source总数。

每条只显示原请求键/键摘要、请求ID/摘要/创建时间、原状态、领取ID/摘要/时间、结果摘要/完成时间、生成记录摘要及失败code/provider_dispatch。不会输出来源摘录、生成正文、provider配置或原始错误内容。原失败的provider_dispatch保留为failure_provider_dispatch，与比较调用自己的provider_dispatch=not-sent区分。

identical表示同一范围的所有逻辑请求文档一致且current无独有键。它忽略两个备份各自的观察时间，因此可以为true而两个外层SHA-256不同；实时目录每次重新观察也会产生新的快照摘要。这些摘要绑定此次输入，不是稳定的合并确认或认证签名。

文件模式标注verification=file-consistency-comparison-only、journal_access=none、current_journal=not-checked。目录模式返回规范current_directory，复用两轮完整捕获（每轮32 MiB、每次10,000目录条目）及全部损坏/孤立文件拒绝规则；在捕获前后核对目录设备/文件标识和journal_dispatch观察一致，变化时不返回报告。它标注verification=local-journal-observation-only、journal_access=read-only、current_journal=two-pass-observed及隔离状态。

目录比较只涉及所选原绑定的规范日志；其他绑定和不规范文件遵循备份的既有范围规则。隔离状态仅检查两个保留名称的存在/可检查性，不校验恢复标记或其原备份副本内容，故显式返回restore_provenance=not-verified。相同的blocked-restored也不能证明恢复过程完成。目录比较不是事务快照或跨进程锁，写者可以在最后读取后继续修改，原目录和备份仍应保留。

两种模式均不读取凭据、调用模型/供应商、打开队列、创建/修改日志、合并、释放领取或解除恢复隔离；报告标注current_provider=not-checked、restoration=not-performed、merge_authorization=none，provider_dispatch=not-sent仅覆盖本次比较。has_conflicts=false也不授予任何写入或派发资格。

比较成功（包括有差异或冲突）退出0，无法完整核验退出1。同范围错误为PROPOSAL_GENERATION_JOURNAL_COMPARISON_BINDING_MISMATCH，目录身份/隔离观察变化为同前缀CHANGED，不可观察为UNAVAILABLE；备份的原校验/超限/孤立文件错误保持。不能把退出0当成相同，需阅读identical/has_conflicts和条目。

已有日志补缺合并、显式冲突处置/隔离解除、原进程协调和供应商对账仍待开发；本增量不新增运行证据。
