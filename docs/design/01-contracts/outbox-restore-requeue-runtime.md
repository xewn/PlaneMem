# 恢复事件批量预览与显式重新排队

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码与文档；未编译、类型检查、测试、执行 CLI/Bridge、打开数据库、执行迁移或发布。无 schema、依赖或原事件格式变化。

## 入口和原查询

| 入口 | 用途 |
| --- | --- |
| `SqliteOutbox.previewRestoreRequeue(query, trace)` | 单次读事务检查所选原记录，返回完整批次计划 |
| `SqliteOutbox.requeueRestoredRecords(query, trace)` | 同一写事务内重新检查并将整批记录设为pending |
| `workctx outbox restore-requeue-preview --outbox EXISTING_FILE --json-file QUERY` | 原生只读打开已有队列并预览 |
| `workctx outbox restore-requeue --outbox EXISTING_FILE --json-file QUERY` | 明确要求重新排队；保持暂停控制，不执行发送 |

查询必需六字段：scope、restore_id、archive_sha256、expected_control_generation、event_ids、reason，可另加requeue_id启用[持久原回执](outbox-restore-requeue-receipt-runtime.md)。使用既有项目/同步ID/小写64位SHA/UUIDv4 generation/原因规则；event_ids为1至100个不重复的原事件ID，保留调用方顺序，整份JSON最多16 KiB。不可省略事件列表或以通配符选中全部事件，不自动跳过终态、缺失或已变化事件。

CLI可省略scope，使用调用开始时复制的配置范围；显式scope必须匹配。必须提供已有--outbox文件及一种--json/--json-file；查询文件必须稳定普通UTF-8，可带BOM。拒绝额外/重复选项、额外位置参数、stdin、空路径及内存库。不接受外部档案、回执文件或output选项，不访问Gateway、令牌或当前远端身份。

archive_sha256取已审阅恢复历史的原事件档案摘要，可通过restore-get取得。expected_control_generation必须是当前暂停版本。恢复ID仅定位原历史；reason描述本次重新排队意图，不替换历史回执中的恢复原因。

## 完整选择条件

每次预览和实际操作均在各自单个事务内执行：

1. 完整验证所选恢复回执、原查询、整份源档案及不可变v1归一摘要，要求项目、恢复ID和查询中的archive_sha256匹配。任何原历史损坏都拒绝，即使损坏事件不在所选列表。
2. 项目控制必须paused且generation精确匹配。缺表/缺行视为running；不自动创建扩展或暂停目标。
3. 每个event_id必须存在于原档案且原状态不是sent/conflict。原事件不得携带server_event_id、server_cursor或conflict_id；已有投递信息必须走独立核对流程，不能重置为待发送。
4. 以有界SQL投影读取同项目、同ID的唯一当前行，校验元数据并逐列比较全部23个已知存储列与不可变v1恢复基线，包括原JSON文本、身份、摘要、attempt、调度、状态及租约。基线状态必须是恢复映射所得failed，last_error为OUTBOX_RESTORED_REVIEW_REQUIRED，lease_token为空。没有这一完整匹配，任一条缺失、变化、损坏或重复都使整笔拒绝。

全部通过后才产生计划；不返回部分通过。未选事件可以存在且保持不变。输入不是“把当前任意failed都重试”；已逐条retry、reconcile或发送过的行需要独立审阅，不能用本入口覆盖其新状态。

## 整批更新与结果

显式写入口使用BEGIN IMMEDIATE，在全部选择条件通过后，逐条只赋值status=pending、attempt=0、last_error=null、next_retry_at=1970-01-01T00:00:00.000Z。原事件ID、正文/引用文本、项目、幂等键、原身份/trace、摘要、分类和游标保持；空租约及空投递字段保持。更新影响行数必须为1。

每条更新前再次全列核对其原基线，避免前一条更新触发的数据库逻辑改变后续选中行后被覆盖。全部更新后逐条完整读回23列，核对预期结果，再完整重读恢复历史并与原回执比较，最后重读暂停控制，要求完整控制记录未变化，才提交。记录或历史/控制读回失败、预算不足或业务拒绝会尝试整批回滚；不输出部分成功。与现有逐条retry使用同样的尝试次数和最早调度值，但本入口增加恢复基线和暂停版本约束。

结果包含原query、restore_receipt、observed_at、current_control、selected_records、checked_bytes，以及按请求顺序的events（ID、原attempt和原next_retry_at）。assigned_columns列出本次赋值的四列，target_status/target_attempt/target_next_retry_at说明计划结果；部分列的旧值可能本来就等于目标值。stdout不包含完整事件正文或租约值。

预览返回mode=preview、action=would-requeue、local_commit=not-attempted；写入成功提交后返回mode=requeue、action=requeued、local_commit=committed。控制在提交时仍暂停，automatic_send=false、control_changed=false；后续resume/flush及远端原回执核对是独立操作。预览不预留记录或暂停版本，实际操作始终重新检查。

archive_integrity=verified和comparison=exact-restored-baseline-columns仅证明所读内容自洽且匹配；provenance=not-proven、server_delivery=not-checked、sender_stopped=not-proven。导入的恢复历史也可用于内容比较，不证明这些当前行来自该次恢复，亦不证明旧设备或发送器已经停止。保持原幂等键不等于本次获得服务器投递证明。

## 失败、期限与边界

Bridge失败保留query、stage、selected_event_id、原错误详情及已经完成的candidate计划。写事务阶段按not-started/begin/body/commit报告；正文失败并回滚成功为not-committed，COMMIT异常或回滚失败为unknown，不能凭随后回滚成功认定提交失败。预览错误始终local_commit=not-attempted，保留读事务回滚信息。CLI在成功/失败路径均尝试关闭并保留close_pending；完整输出超限也保留已知local_commit和result。

不带requeue_id的调用没有持久重新排队回执，durable_requeue_receipt=false；reason和本次计划只随结果返回，不存入原恢复回执。此类调用输出丢失或提交未知时，应保留原查询并重新查看当前行/控制；不能把再次调用的状态不符视为原提交成功证明。正常成功后相同六字段查询再次执行会因pending不再等于恢复基线而拒绝，不自动重置重发。带ID的新调用则先核对原持久回执，精确匹配只返回历史，见后续契约。

固定90秒预算覆盖完整历史验证、目标检查、写入及读回，提交前再次检查，成功提交后不追加超时失败。同步SQL/JSON无法硬实时打断；CLI模块/文件I/O、打开/关闭不在该预算内。完整原历史遵守既有1000条/32 MiB档案限制；所选当前原记录的紧凑JSON合计最多32 MiB，逐条读取，不保留另一份全部当前正文。Bridge结果和完整CLI封套分别最多128 KiB。

非空档案合并、旧发送者协调、远端核对后的自动激活、持久批次请求/结果凭据、通用任意队列批量重试及跨端运行证据仍缺。所有参数、原历史损坏、全列变化、投递元数据、暂停竞争、读回/提交未知及关闭失败场景均未运行验证。

2026-11-03 后续增量：新增 [重新排队持久原回执](outbox-restore-requeue-receipt-runtime.md)，原查询可带requeue_id；原请求、完整父恢复回执及选中记录前后摘要与事件更新同事务保存。精确重复只返回历史，另有原查询只读回执入口；不带ID的旧调用保留原语义。可选表仅源码定义，未运行或初始化；现有事件/恢复历史备份不包含该表。

2026-11-03 后续已补 [按批次ID找回原请求](outbox-restore-requeue-selection-runtime.md)：scope/requeue_id只读选择复用完整历史/摘要验证，可返回原七字段查询和回执；CLI可显式独占保存原请求文件，缺项不创建，原完整查询校验及重复操作语义不变。仅源码文档，未编译、测试、运行或打开库。
