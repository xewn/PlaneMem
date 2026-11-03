# 发送队列档案受控恢复与原回执（开发契约）

2026-11-03：仅源码与文档，未编译、类型检查、测试、执行 CLI/Bridge/API、打开数据库、初始化扩展表、执行迁移、生成样本或发布。新增可选本地恢复回执表的显式初始化源码；无 Gateway API/依赖版本变更。此前 SQLite 升级及 PostgreSQL 016–049 均未执行，R-005 未完成。

## 入口和原请求

新增 `SqliteOutbox.restoreArchive(archive,query,trace)`、`readRestoreReceipt(query,trace)`、`parseOutboxRestoreQuery` 与 CLI `outbox restore`、`outbox restore-receipt`。恢复完整档案到指定项目的空目标，初次写入必须在目标持久暂停的同一版本下进行。恢复后保持暂停；未完成事件不会因恢复而自动领取或发送。

仅展示语法，未执行或生成请求/档案文件：

```text
workctx outbox restore --outbox existing.sqlite --archive-file original-archive.json --json-file original-restore-query.json
workctx outbox restore-receipt --outbox existing.sqlite --json-file original-restore-query.json
```

两条命令都要求显式 --outbox 已有常规文件，不使用默认目录或 WORKCTX_OUTBOX 替代目标。原查询使用互斥 --json/--json-file；restore 必须有 --archive-file，restore-receipt 禁止该参数且无需源文件。拒绝空路径、stdin、:memory:、重复/额外选项、多余位置参数。原查询限16 KiB；文件使用稳定有界常规文件读取、严格 UTF-8，可带 BOM。源码只增加入口，没有执行这些命令。

Bridge 查询严格包含以下五项，CLI 可省略 scope 并补入调用开始时固定的配置范围：

| 字段 | 含义 |
| --- | --- |
| scope | 原 tenant_id/workspace_id/project_id，须与档案及当前配置完全一致 |
| restore_id | 调用方在首次执行前选择并保存的原恢复ID，使用同步标识符规则，全队列唯一 |
| archive_sha256 | inspect-archive 返回的原 document_sha256，64位小写十六进制；不是文件字节摘要 |
| expected_control_generation | 目标 send-control 中已观察到的 paused generation；必须是非空 UUID v4 |
| reason | 非空、最多1024个 UTF-16码元，无控制字符/孤立代理项，原样保留 |

操作结果未知后保留整份原查询，读取原回执时不替换当前 generation、原因或 restore_id。CLI 在异步输入读取前复制当前配置范围，拒绝跨项目原查询；完整文件和档案范围/摘要在打开目标库前核验。restore 以 existing 模式打开已有库，receipt 以 readonly 模式打开，不创建目标数据库或升级 local_events。两条命令都不需要 Gateway 令牌、不读取当前发送者身份、不调用网络。

## 恢复状态映射

原 workctx.sync-outbox-archive v1 完整校验保持不变：已知23列、原 payload/source_refs 字符串、完整身份/命令和原正文摘要、唯一性/顺序及文档摘要均核验，不跳过坏记录、不补造旧身份。

| 档案原状态 | 恢复后本地状态 | 变更 |
| --- | --- | --- |
| sent / conflict | 保留原历史终态 | lease_token 为 null，其他原列保留 |
| pending / sending / failed | failed | lease_token 清空，last_error 改为 OUTBOX_RESTORED_REVIEW_REQUIRED |

原事件ID、项目、类型、正文/引用的原存储文本、幂等键、原账号/客户端、两种摘要、分类、游标、attempt、next_retry_at、原 trace 和既有投递字段均保留。原调度时间不重新授予租约；不把发送中的旧令牌放回可结算行。所有记录在写入时只有 sent/conflict/failed，因此默认 claim 不会自动重发这些恢复记录，即便之后只执行 resume 也不会把 failed 自动改成 pending。

被替换的状态、租约及 last_error 仍存在完整原档案中；该原档案与恢复回执同事务持久保存，不仅依赖调用方外部文件。归一后的完整文档重新使用档案解析和命令摘要核验，观察时间/导出trace改为本次恢复时间/trace，而每条原事件 trace 不变；记录新的 restored_document_sha256。此为恢复格式 v1 固定映射，后续版本不得改变旧回执的重算规则。

恢复行标为 failed 是本地待处理安排，不是远端业务失败结论。后续原回执核对、逐条显式 retry 和项目 resume 是独立操作；本功能不自动串联它们，也不证明旧队列副本/旧发送器已经停止。历史 sent/conflict 只是档案声明的旧本地状态，不是新取得的远端投递证明。

## 单事务和空目标要求

Bridge 首先完整脱离并校验输入档案，核对原项目和 archive_sha256。随后以 BEGIN IMMEDIATE 取得写事务，先查同 restore_id 的原回执：完整原查询相同则返回 already-restored/历史回执，不检查当前暂停或重新写入现有事件；相同ID的不同原查询明确拒绝。该重读不会把已经改过、已发送或已清除的队列回滚为历史内容。

首次恢复要求控制行仍是 paused 且 generation 精确等于原查询，目标项目内没有任何原事件。其他项目可以已有记录，但本次全部原 event_id/idempotency_key 必须在整个目标队列中空缺；冲突仅报告本次原事件定位，不展示其他项目内容。预检完成后才准备归一记录和回执，创建缺失的扩展表并写入全部原记录、原查询和完整原档案。

全部写入（包括回执）结束后，再按已知23列逐行完整读回、比较原字符串和元数据，核对目标项目实际数量，完整读回原回执并重算两份文档摘要，最后确认暂停控制完整记录没有变化才提交。超限、坏原文、范围/版本/ID/键冲突、非空目标、写入或读回失败整笔回滚，不输出部分恢复成功。旧领取者无法用档案租约令牌结算这些新行，因为恢复行均不是 sending 且不保留 lease_token。

空档案也要求空项目和原暂停版本，成功时只持久记录一次零记录恢复；已有回执重复调用仍返回原历史。归一状态可能增加序列化字节，源档案有效不保证归一后的完整文档仍可容纳，超限仍整笔失败。

## 持久原回执

可选 `main.local_outbox_restore_receipts` v1 保存 schema_version、restore_id、三层 scope、query_json、archive_json、restored_at、restore_trace_id、restored_document_sha256。restore_id 全队列唯一，原查询和完整原档案按既有有界 JSON 规范存储。表只在首次实际恢复的写事务中显式初始化；构造、普通发送/读取、原回执查询均不创建它。

历史回执读取只检查这个扩展：单个只读事务内按原范围/ID查找，使用有界 SQL 投影，核验整份原查询、全部原档案和重建后的恢复文档摘要，最后比较完整原查询。缺表或无匹配记录返回 not-observed/null；重复范围行、未知版本、缺列、超长/坏JSON/摘要不符或同ID异查询明确拒绝。not-observed 仅表示该次未观察到，不能证明早先请求失败；候选目标状态和原档案必须保留。

成功回执包含原 query、archive_sha256、restored_document_sha256、总数/待处理数/历史终态数、原档案观察时间/trace、本次恢复时间/trace及当时的暂停版本。observation=committed-local-restore-history，current_queue=not-checked、server_delivery=not-checked、sender_stopped=not-proven；外层 trace 是本次查询，内层 restore_trace_id 保持原调用。查询不会把当前队列或当前控制重新标成历史状态，也不读取完整原事件表进行当前审计。

回执不返回完整正文或租约字符串，完整原档案留在本地扩展表中。摘要证明内部一致性，不认证来源、操作者或不可篡改历史；此扩展不是远端服务器回执或权限系统。后续已补 [恢复历史目录、按 ID 查询与原档案重新导出](outbox-restore-history-runtime.md)；目录只核对元数据，单条完整核验历史。清理/压缩及当前队列单条恢复来源关联仍缺。

## 不确定结果、关闭和预算

写入阶段失败保留原 query、stage、selected_event_id、事务阶段/回滚状态和 local_commit=not-committed/unknown。candidate_receipt 明确标 unconfirmed-restore-candidate，不能当成已提交；已经核验的既有 historical_receipt 则单独保留。提交抛错或回滚失败按 unknown 处理，先用同一原查询读取 restore-receipt，不自动重新生成请求或恢复发送。BEGIN 失败不回滚不属于本次的事务，确认提交后不再因本地期限改报失败。

CLI 始终尝试关闭已打开的队列，保留 close_pending、目标路径、适用原文件路径/字节摘要和原查询。关闭失败不会抹去已确认提交；读取/解析/打开前失败明确未提交。成功 restore 返回 action=restored、local_commit=committed；重复原请求返回 already-restored、historically-confirmed，只证明原操作的历史结果。

源/归一文档均最多1000行/32 MiB，完整源文件32 MiB+8192，保留共享 JSON 100000节点/深度64及逐行原内容限制。Bridge 恢复/回执查询各有固定90秒单调时钟预算，恢复包含完整原档案校验、事务、归一重核和读回，提交前检查；文件读取/库打开关闭不在该预算内。同步 SQL/解析不可硬实时中断。

## 未完成范围

非空目标合并、自动初始化新目标库、跨项目/未知列/物理数据库恢复、源发送者停机协议、网络取消、自动重试、远端核对后批量激活、历史修复、完整控制/恢复回执备份，以及运行证据仍缺。普通 purge 只处理原事件，保留恢复回执；既有档案 v1 仍不包含暂停控制和这些恢复回执，不能替代全数据库备份。

空/非空目标、全部原状态映射/原文本保留、ID/键冲突、generation竞争、旧租约结算、原回执重读/异查询/损坏、整笔回滚/提交未知、大小/复杂度/期限、CLI范围/参数/关闭失败等均未执行验证，不把源码增量等同于运行通过。
