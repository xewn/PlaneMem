# 发送队列档案恢复前预览

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档，未编译、类型检查、测试、执行 CLI/Bridge、打开数据库、初始化 schema、迁移、生成样本或发布。

## 入口与输入

`workctx outbox restore-preview --outbox EXISTING_FILE --archive-file ORIGINAL_ARCHIVE --json-file ORIGINAL_QUERY`

Bridge 入口为 `SqliteOutbox.previewArchiveRestore(archive, query, trace)`。输入沿用 [受控恢复](outbox-restore-runtime.md) 的严格五字段原查询：scope、restore_id、archive_sha256、expected_control_generation、reason。CLI可省略scope，使用调用开始时复制的配置范围；显式scope必须匹配。预览不生成新ID、替换原原因、选择新的控制版本或修改原文件。

显式已有队列和原档案文件必需，`--json` 与 `--json-file` 二选一；拒绝重复/未知选项、额外位置参数、stdin、内存库、空路径和 `--output`。原查询最多16 KiB，文件必须稳定、普通、UTF-8，可带BOM。CLI先完整核验源档案/项目/摘要再以已有readonly模式打开目标，沿用关闭尝试及关闭失败保留结果的规则。主程序和嵌入入口共用此流程，无网络/令牌/身份读取或router调用。

## 一次读取中的准备

预览与实际恢复共用原档案核验、原回执精确匹配、全库恢复ID占用检查、目标检查和不可变v1记录映射。完整原档案先脱离调用方输入并核验，随后在一个读事务中读取历史、控制和原事件。

1. 同项目/restore_id 已有完整核验回执且原查询精确相同，返回 `action=already-restored`、原 `historical_receipt`、`plan=null`。当前队列和控制不重新检查，也不重新准备恢复行，符合实际恢复的重复请求语义。当前队列后来已变化或控制已恢复发送不会把原请求重新解释为一次新恢复。
2. 相同ID的异查询、跨项目已占用ID、坏回执/档案/归一摘要直接拒绝，保留原错误码。
3. 新恢复要求目标控制是paused且generation与原查询相同、目标项目内没有任何事件、源档案每个event_id/idempotency_key在整个目标队列没有冲突。仅报告本次源事件ID，不返回其他项目内容。
4. 使用与实际恢复相同的v1映射生成完整预计记录，重新核验归一档案及查询/源档案序列化预算。即使源档案有效，映射后的容量不足也会使整次预览失败。缺可选回执表可预览首次恢复，但不会创建表。

这些检查通过后返回 `action=would-restore`、`current_queue=checked-empty`、本次读到的 `current_control` 和预计统计。结果仅描述本次读快照；`future_execution=rechecks-required`，实际restore仍在写事务中重新执行全部条件。

## 预计变化

| 字段 | 含义 |
| --- | --- |
| plan.records | 本次预计插入记录数，空档案为0 |
| plan.source_statuses | 档案中pending/sending/failed/sent/conflict的原数量 |
| plan.restored_statuses | 使用实际v1映射得到的预计数量，pending/sending为0 |
| plan.held_records | 预计以failed待人工处理的记录数，不表示远端失败 |
| plan.historical_terminal_records | 原sent/conflict历史状态的保留数量 |
| plan.cleared_lease_tokens | 源档案中非null租约令牌的数量；不证明旧发送者停止 |
| plan.normalized_document_bytes_at_preview | 使用本次预览时间/trace计算的归一文档字节数 |
| plan.nonterminal_policy | failed-review-required |
| plan.automatic_send | false |

所有成功结果明确 `mode=preview`、`observation=local-restore-preview`、`local_write=not-attempted`、`server_delivery=not-checked`、`sender_stopped=not-proven`，附原查询、源文档摘要及原观察时间/trace。历史分支的 current_control=null 表示未读取，不表示控制不存在。

预览不输出完整正文、租约字符串、新恢复回执或可当作提交凭据的归一摘要。预计字节数只属于本次预览，未来调用的时间/trace及库状态可能不同；不保证写权限、磁盘容量、真实写入/读回或提交一定成功。原sent/conflict仍只是本地历史，预览不会取得新的服务器投递证据。

## 失败与限制

失败保留原错误详情、query、stage、selected_event_id、已核验的historical_receipt、读事务回滚信息；明确此次预览未尝试写入。CLI再附目标/档案路径、文件摘要及close_pending；关闭失败不丢弃已经得到的预览结果。无部分计划通过，不生成候选提交回执，不自动调用恢复、pause/resume/retry或发送。

固定90秒单调时钟预算覆盖Bridge档案核验、读事务、记录准备和结果生成；共享检查在阶段边界及逐记录循环执行，同步SQL/JSON不能硬实时打断。文件读取、数据库打开/关闭在该预算之外。源/归一文档最多1000条/32 MiB，源文件32 MiB+8192，保留100000节点/深度64等既有约束；Bridge完整预览结果限128 KiB，CLI追加标准封套及本地文件信息。

本增量无新schema、依赖或Gateway API。实际写入和未知提交处理保持原恢复契约；预览不预留ID、不提供维护锁或跨命令快照。非空合并、旧发送器停机协调、远端核对后的批量激活及运行证据仍待补。空/非空目标、generation竞争、历史精确重复/异请求、源冲突、归一超限、只读/回滚/关闭失败等均未执行验证。

2026-11-03 衔接增量：新增 [新恢复请求准备与保存](outbox-restore-prepare-runtime.md)，显式提供新 restore_id/reason，读取已暂停目标的当前 generation，完整检查后独占保存五字段原查询；任何已占用ID（包括已导入历史）均拒绝。原预览、恢复及历史重复请求语义不变，实际恢复仍重新检查。本增量仅源码文档，未编译、测试或执行。
