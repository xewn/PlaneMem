# 恢复事件重新排队的持久原回执

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码与文档；未编译、类型检查、测试、执行CLI/Bridge、打开数据库、初始化表或迁移、生成样本、发布。新增可选SQLite表定义仅写入源码，无依赖版本变化。

## 原请求身份

原 [批量重新排队](outbox-restore-requeue-runtime.md) 六字段查询新增可选 `requeue_id`，使用既有同步标识符规则。原scope、restore_id、archive_sha256、expected_control_generation、event_ids及reason全部保留；规范序列化顺序固定，event_ids的顺序也属于原请求。整份查询仍最多16 KiB，重复或未知字段规则不变，明确的null/空ID会拒绝。

不带ID的旧请求继续原行为，不自动创建或补录回执；带ID的首次显式操作要求ID在全库未占用，和所选事件更新在同一事务保存原请求/结果。调用方必须事先保存自己选择的ID和完整原查询；已有未知请求不能通过更换ID、原因、事件顺序、原档案摘要或暂停版本来“重试”。

Bridge新增 `readRestoreRequeueReceipt(query, trace)`，CLI新增：

`workctx outbox restore-requeue-receipt --outbox EXISTING_FILE --json-file ORIGINAL_QUERY`

此查询要求完整原七字段（包括requeue_id）；使用与原操作相同的范围规则，CLI可取配置scope但必须等于原项目。只读打开已有队列，拒绝未知/重复选项、额外位置参数、stdin、内存库和档案/输出文件选项，无网络/令牌访问。缺ID在打开库前拒绝。

## 原回执核验与重复调用

带ID的预览和实际操作在当前事务中先查原回执，尚未读取当前事件或暂停控制：

1. 无表或无该ID：继续原基线检查；只读回执入口返回status=not-observed、receipt=null，不生成候选回执。
2. ID由其他项目占用：OUTBOX_REQUEUE_ID_UNAVAILABLE；不读取或返回对方正文。
3. 同项目ID的原查询不同：OUTBOX_REQUEUE_ID_REUSED，包括原因、顺序或暂停版本变化。
4. 同一原查询：完整校验存储版本、原查询摘要、时间/trace、关联的原恢复回执与完整源档案、不可变v1恢复摘要，按原事件顺序重新计算选中记录的变更前后完整列摘要。坏行/缺失关联历史/摘要不符报OUTBOX_REQUEUE_RECEIPT_INVALID，不解释为未提交。

完整匹配后，原预览/实际操作均返回action=already-requeued、local_commit=historically-confirmed、receipt，current_queue/current_control/server_delivery=not-checked，不再要求当前暂停或旧行仍为failed，不修改/重新排队/发送当前记录。队列后来已经发送、清理或恢复控制，不改变原历史结果。

只读回执入口返回status=recorded和完整receipt，外层local_commit=not-attempted表示本次只读取。status=not-observed只说明在本次快照未看到原记录，不能证明先前未知提交回滚，亦不授权自动重试或改写原请求。

## 可选持久表与不可变结果

`main.local_outbox_requeue_receipts` v1包含schema_version、全库唯一requeue_id、三层项目scope、query_json、query_sha256、restore_document_sha256、restore_receipt_sha256、before_sha256、after_sha256、requeued_at、requeue_trace_id。只在首次带ID的实际重新排队事务中创建缺表；普通构造、原六字段操作、预览、原回执读取都不创建它。检查已有表时要求唯一table类型及必要列，读行使用有界SQL投影及LIMIT 2检测歧义。

query_sha256绑定完整规范原查询；restore_document_sha256绑定原恢复归一档案；restore_receipt_sha256绑定完整原恢复回执（包含原恢复查询和原因），防止依赖历史被替换后仍接受旧批次。before_sha256/after_sha256分别是按请求event_ids顺序排列的全部23列记录数组的规范JSON摘要，每份数组最多32 MiB。

固定mapping=restore-requeue/1：before使用已验证源档案的不可变恢复v1映射，拒绝终态和带投递元数据的选择；after仅将status/attempt/last_error/next_retry_at赋为pending/0/null/1970-01-01T00:00:00.000Z。实际写入与回执重算共用这一选择/映射，未来版本不得改变旧回执含义。

回执还返回schema_version、完整query、selected_records、原requeued_at/requeue_trace_id、control_at_requeue，以及observation=committed-local-restore-requeue-history。它不保存第二份事件正文，而依赖原恢复历史；查询需要保留该历史。current_queue/current_control/server_delivery=not-checked，sender_stopped/source_authenticity=not-proven。内容摘要和本地原回执不提供来源签名、数据库实例认证或远端投递证明。

## 同事务保存和失败处理

新请求继续完整预检、逐条写前比对，并在写入全部事件后插入一份回执。所有写入完成后才逐条完整读回事件，核对原恢复历史、重新读取并验证原回执与候选完全一致，最后核对完整暂停控制，再提交；回执插入触发的意外行变化也会被最终读回发现。任一失败尝试整笔回滚，事件和回执不独立提交。

初次预览会准备及检查回执摘要/容量但不保存，不输出候选为提交凭据。计划receipt_requested=true表示请求启用；未提交预览durable_requeue_receipt=false、receipt=null。带ID首次成功durable_requeue_receipt=true并附完整receipt；旧无ID成功仍为false/null。精确重复返回原持久receipt。

错误继续保留query、stage、selected_event_id、candidate计划和事务/关闭状态；candidate_receipt明确observation=unconfirmed-requeue-candidate，只有已经完整核验的旧回执放入historical_receipt。COMMIT异常或回滚失败仍是unknown，不因回执候选存在就声称提交成功。已读取历史后本次只读/重复事务失败，历史回执与本次事务失败分别保留。完整读取预算到期保留超时码，不误报历史损坏。

单笔固定90秒覆盖查询、原历史核验、选中数组摘要和写入读回；同步SQL/JSON不能硬实时打断。单份回执最多64 KiB，Bridge完整结果及CLI封套各128 KiB。CLI始终尝试关闭；关闭或输出失败保留已知原回执/本地结果。新表定义未执行，先前SQLite升级及PostgreSQL 016–049同样未执行。

现有事件档案/恢复历史备份不包含重新排队回执表；不能把旧备份当作这项操作的完整备份。按ID发现原查询、分页目录、独立回执文件/备份及跨设备导入、历史保留管理、来源认证和运行证据仍待补。所有精确重复、异请求/跨项目占用、历史损坏、触发器/读回失败和未知提交恢复场景均未执行验证。

2026-11-03 后续已补 [按批次ID找回原请求](outbox-restore-requeue-selection-runtime.md)：scope/requeue_id只读选择复用完整历史/摘要验证，可返回原七字段查询和回执；CLI可显式独占保存原请求文件，缺项不创建，原完整查询校验及重复操作语义不变。仅源码文档，未编译、测试、运行或打开库。

2026-11-03 后续已补 [重新排队回执元数据目录](outbox-restore-requeue-history-runtime.md)：按项目只读分页发现批次，默认10最多20，返回get_query/next_query；目录只校验有界原查询与元数据，关联历史和事件内容仍须单条完整核验。无schema/依赖变化，仅源码文档，未运行、编译、测试或打开库。

2026-11-03 后续已补 [重新排队完整历史审计](outbox-restore-requeue-audit-runtime.md)：目录新增audit_query，单读事务核验整个项目全部批次和完整父历史/前后摘要；先按数量及存储查询/档案字节预检，共享父历史逐次计费，失败保留阶段/ID/进度，不返回部分通过。目录自身仍只验证元数据。无schema/依赖变化，仅源码文档，未运行、编译、测试或打开库。
