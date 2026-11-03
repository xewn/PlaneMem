# 客户端事件完整内容同步历史

2026-11-04，ADR-015 / T0.5 / T3.4 / T4.3 / R-005。仅源码文档；未编译、类型检查、测试、执行reducer/CLI/Bridge/API、打开数据库、执行扩展或迁移、生成样本或发布。无新依赖、数据库结构或Gateway网络格式，evidence为空。

固定应用 `{name:'client-event-history',version:'1'}` 消费Gateway已有 `ClientEventRecorded`，建立按原账号/客户端/事件ID区分的完整内容历史。它记录同步流中已接收的客户端内容，不更新源实体、不结算outbox、不确认接收位点，也不把字段建议提升为当前业务状态。

## 共享事件校验

新增 `parseClientEventSyncChange(value, scope)`，最大沿用同步页面4 MiB预算。严格v1封套，event_type=ClientEventRecorded、aggregate_type=ClientEvent、aggregate_id=event_id、aggregate_version=1、accepted=true，server_cursor为正安全整数。服务器事件ID和三层scope必须是ULID，scope与读取项目完全一致；client_id为有效同步标识。未知封套字段拒绝；规范可选actor/session/correlation/causation标识仍检查ULID格式，时间、trace和分类复用现有规则。

普通payload严格为 `{event_type, content, client_event_id, actor_id}`。content必须是完整JSON对象，保留任意原业务字段；event_type、原client_event_id和原actor_id均为有效同步标识。原actor_id为ULID时封套actor_id必须相同，否则封套必须省略actor_id；不要求生产者账号/客户端等于下载该项目流的消费者。内容和原来源另经既有上传规则校验，拒绝不可表示的NUL/孤立代理项及非有限JSON，不用其默认值改写历史。

所有source_refs经过共享来源校验。普通事件最后一项必须精确为 `{type:'client-event',id:client_event_id}`；其前面的原来源完整保留，包括顺序和重复。原业务event_type可以是任意合法标识，适配器不会将其作为可执行处理器名称。

原event_type=FieldChangeProposed时，payload还必须且仅多出observed_version；普通事件出现该字段拒绝。content保留原完整对象和额外业务字段，但必需字段遵守当前生产者v1规则：

| entity_type | field |
| --- | --- |
| work_item | title、status、priority、owner、progress、description、due_at |
| context_item | title、status、priority、content、layer、expires_at |
| session | status、parent_session_id |

entity_id为有效同步标识，value必须显式存在且可为JSON null，base_version为正安全整数且可安全递增。observed_version为正安全整数并且不小于base_version；来源末两项必须分别精确绑定原client-event和对应entity_type/entity_id。不得删除或自动补造字段，不根据当前服务端数据修改原content。

生产者在基线版本相同或所提值与服务器值相同时可以记录该事件，因此observed_version可能大于base_version。事件不携带当时服务器字段值，离线校验不能独立证明二者相等；更不代表该建议曾应用到源实体。版本冲突记录是ConflictDetected，由独立冲突适配器处理。

## 投影与身份

初始投影为null。首条有效记录后为 `{schema_version:1,kind:'recorded-client-event-history',scope,entries}`；每项严格为 `{actor_id,client_id,client_event_id,event}`，event保留完整原规范同步事件及content。

entries按原actor_id、client_id、client_event_id三元组逐字段UTF-8字节顺序严格递增，不拼接成可能碰撞的字符串，也不按发生时间排序。同一项目不同账号或客户端可以使用相同client_event_id；相同三元组再次出现新的服务器事件时拒绝，不覆盖既有历史。每个server event_id和server_cursor在投影中唯一，新事件cursor须大于已保存记录的最大cursor。固定聚合版本1不是业务字段版本，也不是连续客户端游标。

快照校验重核每项完整事件、三元组与事件的一致性、scope、字段集合、顺序、唯一性和应用边界；所有事件cursor不得超过快照applied_cursor。当前头、重复原页的历史快照及待提交投影均走已有事务内校验。精确重复原页仍由通用应用页/事件ledger处理，不新建第二条历史。

最多512条，完整投影最多1 MiB，单页reducer输入/输出累计最多64 MiB；完整内容较大时可能先达到字节上限。不能截断正文、丢弃旧项或部分提交以绕过限制。该视图是有界本地历史，其他记录仍在原接收页中；容量管理和可扩展目录存储未在本轮实现。

## 混合流与应用入口

v1固定忽略13种其他事件：ConflictDetected、ConflictResolved、ContextPackIssued、ApprovalRequested、ApprovalCompleted、ContextItemCreated、ContextItemUpdated、ContextItemConfirmed、ContextItemArchived、ContextItemRestored、work_item.updated、context.proposed、handoff.offered。它们继续保留于原页和事件ledger，不改变本投影；未知外层event_type拒绝整页。旧三个内置适配器规则不变。

集中选择器将本适配器接入 `inbox application-apply`、`application-apply-preview`、`application-pending` 和 `application-replay`。apply/preview使用原expected_identity、application、document_sha256和expected_previous_sha256；pending只发现原页窗口，不运行reducer；replay在单只读事务中先审计完整结构，再从null按原页顺序重算并逐页比较保存投影。

同一消费者下各应用有独立应用头。不能改名字复用其他投影或跳过前页；普通应用状态/目录/历史/快照/归档/离线查看及显式恢复按名称版本沿用现有流程，结构恢复本身不运行新适配器，之后可显式replay。CLI帮助列出新应用，无新命令或模块加载开关。

以下仅为用法说明，未执行命令或生成查询文件：

```text
workctx inbox application-apply-preview --inbox local-inbox.sqlite --json-file client-event-page-query.json
workctx inbox application-apply --inbox local-inbox.sqlite --json-file client-event-page-query.json
workctx inbox application-replay --inbox local-inbox.sqlite --json-file client-event-replay-query.json
```

查询application固定为 `{name:'client-event-history',version:'1'}`；实际应用仍完整重查原页与前驱。重放成功只证明保存历史与当前固定实现重算一致，不是当前服务端状态或来源签名证明。

## 语义、失败与后续

descriptor声明recorded_content=complete、source_application/current_source_state=not-verified、source_authenticity=not-proven、original_upload_command=not-reconstructed、upload_receipt_binding=not-included，producer_identity说明身份来自事件记录。同步流未保存原上传client_cursor、批次幂等键或分类上调前的原sensitivity，不能据此重建完整原命令或自动调用回执结算。content保留服务端JSON值，不保证最初上传文件的空白、字节序或对象键书写顺序。

专用固定诊断为INBOX_CLIENT_EVENT_EVENT_INVALID、PROJECTION_INVALID、VERSION_GAP、TRANSITION_INVALID、LIMIT_REACHED（后四项同前缀）。非法记录、重复原身份、游标回退、坏投影、容量超限均拒绝整页；通用超时、前驱、未知类型、事务提交/回滚与关闭失败沿用原逻辑。原页/事件位置、历史或候选结果及未知提交状态继续保留，不自动重试或修复。

完整当前源实体同步、其他业务适配、旧历史基线引导、权限变化重建/清理、更大历史容量、跨端完整恢复及运行证据仍缺；R-005保持未完成。本轮没有执行正常/边界/损坏/并发、原页重复、重放或恢复验证。
