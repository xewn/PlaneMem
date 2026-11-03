# 发送队列恢复历史与原档案找回

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档；未编译、类型检查、测试、运行 CLI/接口、打开数据库、执行 schema/迁移、生成样本或发布。

## 入口

| CLI | 输入 | 结果 |
| --- | --- | --- |
| `outbox restore-history --outbox EXISTING_FILE` | 可选 `--json` 或 `--json-file`，scope/limit/after_restore_id | 恢复历史元数据页与 next_query |
| `outbox restore-get RESTORE_ID --outbox EXISTING_FILE` | 指定原恢复 ID；不接受 JSON | 完整核验历史回执，包含原恢复 query |
| `outbox restore-export RESTORE_ID --outbox EXISTING_FILE --output NEW_FILE` | 指定原恢复 ID 和新文件；不接受 JSON | 保存完整原档案，返回历史回执及文件摘要 |

三者均显式指定已有队列，使用配置中的 tenant/workspace/project；目录 JSON 的显式 scope 必须与配置相同。拒绝重复/未知选项、额外位置参数、stdin、内存库、空路径。输入文件为稳定普通 UTF-8 文件，允许 BOM，最多16 KiB；JSON对象严格字段解析，沿用共享节点/深度限制。没有 token、router 或网络调用，也不触发 flush。

Bridge 暴露 `listRestoreReceipts(input, trace)`、`readRestoreRecord(input, trace)`、`readRestoreArchive(input, trace)`；查询解析器分别为 `parseOutboxRestoreHistoryQuery` 与 `parseOutboxRestoreSelection`。选择器仅含 scope/restore_id。已有 `restore-receipt` 仍要求完整原查询并精确比较，不因新增按 ID 查询而放宽。

## 目录语义

目录默认10条，limit允许1–20；after_restore_id 为有效同步标识。单次只读事务按 restore_id 的 BINARY 升序选择 limit+1 条，逐条校验元数据及前瞻项；下一页游标取最后返回项，保留原范围和页大小。按 UTF-8 字节比较拒绝所选相邻重复/倒序 ID。顺序不表示时间先后，各次读取不共享冻结快照；续页之前的插入或删改可能改变可见目录。

SQL 有界投影：restore_id最多1020字节，原查询16 KiB，时间64字节，trace4096字节，恢复摘要64字节；schema_version须为整数1。原查询完整解析并核对原范围/ID，时间要求规范 ISO，trace规则与原恢复一致。仅读取 archive_json 的类型和字节长度（不超过既有完整档案上限），不把正文加载到目录或计算其 SHA。选中损坏记录使整页失败，不跳过或返回部分通过。

返回 original_query、原恢复时间/trace、原档案摘要、归一后的恢复摘要及 archive_bytes。明确 observation=local-restore-history-metadata、archive_integrity=not-verified、current_queue/server_delivery=not-checked。这些摘要是元数据声明；需单条 get/export 完整核验后才能作为已核验历史使用。目录响应限制512 KiB，不宣称全表完整性或正文有效。

## 完整读取与导出

单个只读事务按 scope/restore_id 有界读取最多两条，复用既有完整回执核验：原查询、完整源档案、逐条原内容与命令摘要、原范围/源摘要，以及不可变 v1 状态映射重建后的 restored_document_sha256。原恢复的非终态映射和历史 sent/conflict 规则保持不变。回执保留 committed-local-restore-history 标识和原 query，不把当前队列、控制或服务器重新解释成历史状态。

缺扩展视作没有历史；已有扩展缺列/类型冲突明确报错，不初始化或修复。get 缺记录返回 not-observed/null，这不证明原恢复失败；export 缺记录拒绝且不创建文件。

export 返回的 source 和 receipt 来自同一事务。CLI 在打开数据库前预检新输出路径，读取事务完成并尝试关闭后，复用档案独占保存逻辑写入新文件，再从最终路径完整读取核对文件字节数、文件 SHA 和文档 SHA。输出是回执中保存的原 source 档案，包含原始状态、正文/引用字符串及租约历史；不是当前队列或恢复归一后的记录。文件采用既有规范 JSON 编码，保留原 document_sha256，但不承诺与最初外部输入文件的空白/BOM/字节摘要相同。可交给既有 inspect-archive 离线核验。

stdout 只含历史回执、原查询、文件位置/摘要/字节数及 close_pending，不输出 source 正文。文件失败保留 history、query、输出路径、摘要/记录数和关闭状态，保留已有写入器的发布不确定/清理详情。不能因最终读取失败声称未生成文件；已生成但未确认时保留 published-unconfirmed 信息。

## 边界与后续

Bridge 查询各有90秒单调时钟预算，在事务工作前后及目录逐项检查；同步 SQL/JSON 操作不能硬实时中断，打开/关闭/文件读写不包含在此预算中。错误保留原查询及事务回滚/关闭信息。原档案保持最多1000条、文档32 MiB、文件32 MiB+8192及共享100000节点/深度64限制。

读取不写队列、控制或回执，不重新恢复、不自动重试/恢复发送。SHA只证明内部一致性，不认证来源或远端投递；原档案可能包含敏感正文，显式导出仍应由操作者管理文件。后续已补 [restore-audit完整范围核验](outbox-restore-audit-runtime.md)，目录附audit_query={scope}，用于全项目核验而非当前页；目录本身仍不核验正文。后续已补 [单条恢复记录对照](outbox-restore-comparison-runtime.md)，可显式选择恢复 ID/事件 ID 对照原档案、恢复基线和当前摘要及变化列，内容相同不证明来源。跨项目目录、回执文件独立备份、清理/压缩、因果来源证明与运行证据仍缺。

上述分页、所选损坏/超限、空历史、原查询找回、旧精确比较、归一摘要重核、文件竞争/失败、关闭失败与错误详情均仅完成源码审阅，尚无执行验证。
