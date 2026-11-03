# 建议生命周期同步投影

2026-11-03 开发增量，关联 ADR-015、T0.5、T3.4、T4.3、R-005。仅源码和文档，未编译、类型检查、测试、执行 reducer/CLI/Bridge/API、打开数据库、执行 schema/迁移、生成样本或发布。无新依赖、schema 或 Gateway 网络格式，运行 evidence 为空。

## 现有事件与消费契约

固定应用 `{name:"proposal-lifecycle",version:"1"}` 消费 Gateway `proposals.ts` 已有的 ApprovalRequested/ApprovalCompleted，且要求 aggregate_type=Proposal。共享 `parseProposalSyncChange(value,scope)` 验证展开后的 v1 规范封套、accepted=true、正安全 server_cursor、三层 ULID scope、事件/聚合 ID、UTC occurred_at、原 trace、分类及可选规范身份字段。

payload 严格只有 proposal_id、status、revision、kind。proposal_id 必须等于 aggregate_id，revision 等于 aggregate_version。source_refs 恰有一项，type=proposal、id=proposal_id、revision=payload.revision，并通过共享 SourceRef 校验。kind 固定接受 decision、risk、next_step、blocker、brief，不自动扩展 v1 的种类集合。其他聚合的同名审批事件不当作建议，也不静默忽略。

| 事件 | 事件约束 | 必要前态 |
| --- | --- | --- |
| ApprovalRequested | revision=1、status=proposed | 尚无相同 proposal_id |
| ApprovalCompleted | revision=2、status=verified 或 rejected | 原请求已存在且仍为 revision=1 |

完成事件必须保持原 kind 和 sensitivity，server_cursor 严格递增。重复创建、缺请求基线、重复完成、种类/分类变化或版本缺口均拒绝整页。不同事件不能依靠时间戳覆盖或重排；权限过滤导致缺创建历史时也不会从当前 API 补造基线。

## 历史投影

初始投影为 null，空页或只有范围外事件时可保持 null。第一条请求后为 `{schema_version:1,kind:"proposal-lifecycle-metadata",scope,proposals}`。每项只含 proposal_id、完整原 requested 事件和完整 latest 事件，按 ULID proposal_id 的二进制顺序排序。

revision=1 时 requested/latest 必须完全相同；revision=2 时核对请求/完成关系、不同事件 ID 与递增 cursor。快照校验还要求严格字段、相同 scope、唯一 proposal_id、已保留事件 ID/cursor 全局唯一、latest cursor 不超过快照应用边界。当前头、重复原页的历史快照及待写入投影均在既有应用事务内校验；空页和范围外页同样检查。

最多 512 个建议，终态保留，不自动淘汰。既有每份投影 1 MiB、每页 reducer 输入/输出累计 64 MiB 上限继续适用；可在达到 512 项前先触发字节限制，不提交半页。

投影不包含 title/content、审阅理由、expires_at、来源清单或派生链。verified/rejected 是原事件中的历史决定，不能证明建议目前仍有效、未过期、来源仍可读，或当前调用者可以审阅。保留原事件中的 trace、scope、source_refs、分类和 cursor，不生成本地伪造时间。它不替代 proposal.read 或授权检查，不向服务端发起确认/拒绝操作。

## 混合页面与固定版本

v1 明确将以下 12 类作为范围外事件，保持原投影：ClientEventRecorded、ConflictDetected、ConflictResolved、ContextPackIssued、ContextItemCreated、ContextItemUpdated、ContextItemConfirmed、ContextItemArchived、ContextItemRestored、work_item.updated、context.proposed、handoff.offered。原页面和应用事件 ledger 仍保存它们，但本投影不声称应用这些业务实体。未知类型拒绝整页，新增类型或变化的状态规则需要显式版本决策。

成功 adapter 描述包含 application、projection_kind、handled_event_types、ignored_event_types、unknown_event_types=reject-page、max_proposals=512、proposal_content=not-included、source_validity/current_review_authority=not-verified。普通状态保留 local-reducer、server_application/source_authenticity=not-verified、acknowledgement_dispatch_state=not-sent。

## 逐页应用、重放和恢复

集中内置选择器供 apply/replay 共用，固定支持 context-item-lifecycle/1 和 proposal-lifecycle/1，未知名称或版本拒绝。原 context 适配器的投影、忽略集合、错误码和规范 JSON 不变。两者应用键不同，同一原消费者可以对相同接收页分别建立投影；不能直接把 context 应用头改名为 proposal。启用新应用需要从自己的根页顺序处理。

以下只说明入口，未执行或生成文件：

```text
workctx inbox application-apply --inbox local-inbox.sqlite --json-file proposal-page-query.json
workctx inbox application-status --inbox local-inbox.sqlite --json-file proposal-state-query.json
workctx inbox application-replay --inbox local-inbox.sqlite --json-file proposal-replay-query.json
```

三份查询均使用完整原 expected_identity 和 application={name:"proposal-lifecycle",version:"1"}。apply 还要求原 document_sha256 和 expected_previous_sha256（根为 null），可选 timeout_ms；status 不接受这两个字段；replay 接受既有完整历史预算和 max_replay_bytes。严格查询/适配器选择在 CLI 打开库前完成，不接受模块路径、执行配置、输出文件或自动选最新页。

`applyBuiltInApplicationPage` 复用已有原页/投影/ledger/头的同一写事务，原前驱检查和精确原页重复行为不变，业务失败回滚。`replayBuiltInApplicationHistory` 只读完成全历史结构审计后，从 null 正序使用相同建议适配器重算，逐页比较完整保存投影；当前已保存快照不会被当作计算基线，也不修复状态。详见[历史重放](sync-application-replay-runtime.md)。

通用 application-list/history/get/audit/export、离线归档查看及显式 restore 继续按原名称/版本处理。它们的结构核验不等于执行建议 reducer；恢复后可另行请求只读 replay 核对语义。应用名称并非代码认证，自定义 handler 或被改写存储不会因使用同一名字获得可信执行证明。

## 错误与剩余范围

建议规则只暴露固定 INBOX_PROPOSAL_EVENT_INVALID、PROJECTION_INVALID、BASELINE_REQUIRED、VERSION_GAP、TRANSITION_INVALID、LIMIT_REACHED（后五项同前缀）。普通自定义 handler 异常仍用原 reducer 失败码，未知事件仍用 INBOX_APPLICATION_EVENT_UNSUPPORTED。提交或回滚不明确时，既有 COMMIT_UNKNOWN/ROLLBACK_UNKNOWN 优先保留 unknown，并保存安全 cause_code；不能用业务错误把未知写入改为未提交。CLI 保留原身份/应用/页/前驱及关闭状态，重放失败保留页/事件位置和进度。

本次未执行任何 reducer 或数据库路径。建议正文、历史缺口引导、权限变化重建、其他业务适配器、跨设备恢复及并发/崩溃/兼容运行证据仍待补。R-005 保持未完成。
