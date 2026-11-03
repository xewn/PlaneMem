# 发送队列单条恢复记录对照

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码文档；未编译、类型检查、测试、执行 CLI/Bridge、打开数据库、执行 schema/迁移、生成样本或发布。

## 入口与查询

`workctx outbox restore-compare --outbox EXISTING_FILE --json-file QUERY_FILE`

也可用 `--json OBJECT`。Bridge 暴露 `SqliteOutbox.compareRestoreRecord(input, trace)`、`parseOutboxRestoreComparisonQuery` 和 `OutboxRestoreComparisonQuery`。

| 字段 | 规则 |
| --- | --- |
| scope | 完整 tenant_id/workspace_id/project_id；Bridge 必填，CLI 可补入调用开始时固定的配置范围；显式范围必须与配置一致 |
| restore_id | 原恢复 ID，沿用同步标识规则 |
| event_id | 原事件 ID，沿用同步标识规则 |

查询仅允许这三个字段，最多16 KiB，使用共享100000节点/深度64快照解析。CLI 必须提供一种 JSON 输入；稳定普通 UTF-8 查询文件允许 BOM。拒绝缺失/重复/未知参数、额外位置参数、stdin、内存库、空路径、档案输入和输出文件。参数和范围在打开库前核验；只通过原生 readOnly/query_only 打开已有队列，无网络或发送调用。

## 同一快照中的核验和对照

1. 检查可选历史表，按原范围/恢复 ID 有界读取完整历史，复用原查询、源档案及其逐条原身份/正文/命令摘要核验。以原恢复时间/trace及不可变 v1 映射重建文档，核对已存恢复摘要。缺表或记录报 `OUTBOX_RESTORE_HISTORY_NOT_FOUND`，不据此解释原操作失败；损坏历史直接失败。
2. 从完整核验的源档案按 event_id 选取原行。缺少该事件报 `OUTBOX_RESTORE_EVENT_NOT_FOUND`，此时不读取当前事件。复用纯函数 `outboxRestoreRecordV1` 重建所选恢复基线：清租约，sent/conflict 保留历史终态，其他状态转 failed 并标 `OUTBOX_RESTORED_REVIEW_REQUIRED`；其余已知存储列和原 JSON 字符串不改。
3. 按范围/事件 ID 的 BINARY 精确等值读取当前行，SQL 使用有界投影及 LIMIT 2。重复、元数据损坏、缺原身份、正文/引用各超1 MiB、原正文或完整命令摘要不符都拒绝，不将损坏表示为普通变化。
4. 对全部23个 `OUTBOX_STORED_COLUMNS` 逐列比较原始字符串/数字/null，用严格值相等；payload/source_refs 的空白和键顺序变化亦列为变化，不只比较语义或命令摘要。完成结果序列化及事务结束前后检查期限。

所有历史和当前读取处于一次只读事务。档案仍限1000行、文档32 MiB、文件32 MiB+8192；历史加载器最多读取两份有界候选以拒绝重复。固定90秒单调预算在各阶段前后检查，沿用 `OUTBOX_RESTORE_TIMEOUT`；同步 SQL/JSON 不能硬实时中断。输入读取、数据库打开/关闭不包含在 Bridge 期限中。

## 返回语义

结果包含完整 query、历史 receipt，以及 archived/restored_baseline/current 三份摘要。archived 标为 source-archive，其租约状态按原档案 observed_at 计算；restored_baseline 标为 reconstructed-v1-restore，按原恢复时间计算；current 标为 current-local-record，按本次读取时间计算。历史与基线已通过整份核验，当前存在时完整核验，摘要 original_content=validated。只返回既有元数据摘要，不返回 payload/source_refs 正文、完整租约值或完整原行。

| status | current | changed_columns |
| --- | --- | --- |
| identical-to-restored-baseline | 已核验当前摘要 | 空数组，全部已知列与恢复基线相同 |
| changed | 已核验当前摘要 | 相比恢复基线发生变化的列名，按固定存储列顺序 |
| current-not-observed | null | null，本次快照没有可比较的当前行 |

`compared_columns` 明列全部比较列，`comparison=exact-stored-column-values`，`consistency=single-project-read-snapshot`。变化列表比较的是当前行与恢复基线，不是原档案与基线。未观察到当前行不证明已删除、原恢复失败或远端投递情况；相同 ID、完整内容相同或摘要相同均不证明该恢复操作产生了当前行。始终 `provenance=not-proven`、`server_delivery/current_control=not-checked`、`database_integrity=not-audited`，`archive_integrity=verified` 仅描述本次所选完整历史。receipt 内的 current_queue=not-checked 保持历史回执原义，当前观察独立放在 current。

完整 Bridge 结果最多128 KiB，超限报 `OUTBOX_RESTORE_COMPARISON_TOO_LARGE`。成功为 complete=true；读事务、核验或预算失败为错误并附 complete=false、query、stage 和 requested_event_id，保留底层 cause_code、record_index、selected_event_id 和回滚信息，底层原档案损坏定位不被请求事件 ID 覆盖。CLI 继续附 outbox 路径及 close_pending；关闭失败不抹去已读结果。

## 边界与后续

本入口不写入历史/队列/控制，不恢复、重试、结算、续租或恢复发送。没有新增 schema、依赖、Gateway 接口或共享文件格式。跨项目目录/全库核验、完整恢复回执备份、历史保留策略、因果来源证明和运行证据仍缺。查询严格性、三种结果、23列精确差异、损坏拒绝、缺历史/缺原事件、时间/大小限制、错误定位与关闭路径均尚未运行验证。
