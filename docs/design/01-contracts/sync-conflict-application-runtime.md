# 冲突生命周期同步投影

2026-11-03 开发增量，关联 ADR-015、T0.5、T3.4、T4.3、R-005。仅源码和文档，未编译、类型检查、测试、执行 reducer/CLI/Bridge/API、打开数据库、执行扩展/迁移、生成样本或发布。无新依赖、schema 或 Gateway 网络格式，evidence 为空。

固定应用 `{name:"conflict-lifecycle",version:"1"}` 消费 Gateway sync-upload/conflict-persistence 已有的 ConflictDetected/ConflictResolved。它建立本地历史冲突目录，保留原检测、原决策及决策值；不更新工作项、上下文或会话字段，不执行远端冲突决策，不代替原请求回执查询。

## 事件契约

新增共享 `parseConflictSyncChange(value,scope)`，验证 v1 封套、aggregate_type=Conflict、正安全 aggregate_version/server_cursor、accepted=true、完整三层 ULID scope、事件/聚合 ID、UTC 时间、原 trace、分类和 client_id。accepted 仅表示该事件进入同步流；ConflictDetected 对应的原上传可能因 VERSION_CONFLICT 被拒绝，不能据此结算上传为成功。

payload actor_id 必须是有效同步标识；它为 ULID 时，封套 actor_id 必须与之相同，否则封套省略 actor_id，匹配现有生产者规则。检测者和决策者可以不同，也不要求等于读取该流的消费者。其他可选规范 actor/session/correlation/causation 标识仍检查其格式。

检测 payload 严格九字段：conflict_id、entity_type、entity_id、field、base_version、local_version、server_version、client_event_id、actor_id。conflict_id 是 ULID 且等于 aggregate_id，aggregate_version=1；base_version 为可安全递增的正整数，local_version=base_version+1，server_version>base_version。v1 固定对应当前上传字段：

| entity_type | field |
| --- | --- |
| work_item | title、status、priority、owner、progress、description、due_at |
| context_item | title、status、priority、content、layer、expires_at |
| session | status、parent_session_id |

所有 source_refs 通过共享 SourceRef 校验；检测末两项须精确为 `{type:'client-event',id:client_event_id}` 和 `{type:entity_type,id:entity_id}`，保留此前原上传来源，不去重或重排。

决策 payload 严格十字段：原 conflict/entity/field/三版本和 actor_id，加 resolution（local/server/merge）及显式 resolved_value。resolved_value 保留完整有限 JSON，JSON null 合法，字段缺失拒绝；不会补造检测事件中没有的 local_value/server_value。决策第一项来源必须精确为 `{type:'conflict',id:conflict_id}`。共享解析器允许当前决策生产者兼容的旧外部 conflict_id（聚合 ID 使用原 event_id 回退）与安全非负字段版本，aggregate_version 至少 2；这不为缺失检测基线的旧冲突赋予可应用状态。

## 投影与转换

初始投影为 null。遇到首条检测后为 `{schema_version:1,kind:'conflict-lifecycle-history',scope,conflicts}`，按原 ULID conflict_id 排序。每项仅含 conflict_id、status、完整 detected 原事件和完整 latest 原事件。

| 当前状态 | 输入 | 结果 |
| --- | --- | --- |
| 无记录 | ConflictDetected/version1 | open，detected 与 latest 完全相同 |
| open | 匹配的 ConflictResolved/version2 | resolved，保留原 detected，latest 为原决策 |
| 无记录 | ConflictResolved | 拒绝：缺检测基线 |
| resolved | 后续检测或决策 | 拒绝：当前 v1 终态不能再次转换 |

决策必须保持 conflict_id、entity_type、entity_id、field 及 base/local/server 三版本，且其来源去掉首项后与 detected.source_refs 完全对应。分类不得低于检测分类，但允许上调：现有 Gateway 决策读取会用当前源分类和冲突历史分类的较高者。actor/client/trace/时间不要求与检测者相同，保留各自原值；server_cursor 必须增大，版本连续，不能按发生时间覆盖或重排。

快照校验同时核对 status 与最新事件一致、严格字段/scope/排序、唯一冲突 ID、所有保留事件 ID/cursor 唯一、检测/决策不同事件 ID，以及 latest cursor 不超过快照应用边界。已有头、重复原页的历史快照和待写入快照均沿用同一事务内校验，空页及范围外页也执行。

最多 512 个冲突，终态保留；仍受每份投影 1 MiB、每页 reducer 输入/输出累计 64 MiB 限制。决策值或原来源较大时可能更早触发字节限制，不截断决策值或提交半页。原事件完整保留；检测没有 local/server 原值，因此本地不能独立证明 local/server 决策选择的值等于源记录，也不声称当前实体已经应用 resolved_value。

## 混合流、应用和重放

v1 明确忽略其余 12 类：ClientEventRecorded、ContextPackIssued、ApprovalRequested、ApprovalCompleted、ContextItemCreated、ContextItemUpdated、ContextItemConfirmed、ContextItemArchived、ContextItemRestored、work_item.updated、context.proposed、handoff.offered。它们保留在原页和事件 ledger 中，但不改变此冲突投影。未知类型拒绝整页；旧内存 ConflictService 的非规范输出不伪装成当前 Gateway 封套。

集中选择器为 apply/replay 新增本适配器；原 context-item-lifecycle/1 和 proposal-lifecycle/1 的规则、忽略集合及错误码不变。每个应用有独立应用头和历史，同一原消费者可从原根页分别构建它们。不能换名称复用其他应用的已保存投影或跳过前页。

以下仅为文档示例，未执行或生成文件：

```text
workctx inbox application-apply --inbox local-inbox.sqlite --json-file conflict-page-query.json
workctx inbox application-status --inbox local-inbox.sqlite --json-file conflict-state-query.json
workctx inbox application-replay --inbox local-inbox.sqlite --json-file conflict-replay-query.json
```

查询均指定完整原 expected_identity 和 application={name:'conflict-lifecycle',version:'1'}。apply 要求原 document_sha256/expected_previous_sha256（根 null），可带 timeout_ms；replay 使用已有完整结构审计和 max_replay_bytes 预算，先完整审计再从 null 逐页重算并比较保存投影，全程只读、不修复。主程序/嵌入入口共用原本地流程，适配器选择在打开库前完成，无新命令开关或模块加载配置。

通用状态、目录、历史、精确快照、归档、离线查看和显式恢复按应用名称版本复用；结构校验本身不运行冲突 reducer。恢复后可另行要求只读 replay。descriptor 表明 conflict_values=recorded-resolved-value-only、source_application/current_resolution_authority=not-verified、original_request_binding=not-included，不把历史 resolved 状态当作授权、服务器认证或原请求键绑定证明。

## 失败与剩余工作

固定诊断为 INBOX_CONFLICT_EVENT_INVALID、PROJECTION_INVALID、BASELINE_REQUIRED、VERSION_GAP、TRANSITION_INVALID、LIMIT_REACHED（后五项同前缀）。未知类型、通用 reducer 异常、预算、前驱、提交/回滚未知与关闭错误沿用原处理；未知写入状态优先保留，并带安全 cause_code。replay 失败保留具体页/事件与进度，不回写状态或自动重试。

本次没有执行任何 reducer、数据库或接口。旧冲突基线引导、源字段应用/正文同步、权限变化重建、其他业务适配、跨设备恢复和实际并发/崩溃/兼容证据仍缺。R-005 保持未完成。
