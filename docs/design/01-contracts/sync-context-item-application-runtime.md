# 上下文条目生命周期同步投影（开发契约）

2026-11-03：仅修改源码和文档，未编译、类型检查、测试、执行 CLI/Bridge、打开数据库、生成样本、初始化/迁移或发布。无新增依赖或 schema，既有 SQLite 扩展和 PostgreSQL 016–049 均未执行。源码不等于运行验证完成。按用户新要求，每个开发任务完成后提交并推送 main，提交信息包含 [skip ci]。

## 来源与范围

此适配器固定为 `{name:"context-item-lifecycle",version:"1"}`，使用 Gateway `context-items.ts` 已有的五种规范事件。`sync-persistence.ts` 把有效规范封套展开为 SyncChange，并附 accepted/server_cursor；上下文 payload 只有 item_id、version、status、archived，不含 title/content。投影因此是历史生命周期元数据，不是完整条目副本、来源有效性检查或实时权限视图，也不能代替 context item 读取或确认权限检查。

共享 `parseContextItemSyncChange(value,scope)` 脱离调用方输入，验证 v1 封套、三层 ULID scope、事件/聚合 ID、正安全版本/cursor、UTC 时间、trace、分类、可选规范身份字段及四字段 payload。只允许五种类型及明确字段，绑定 aggregate_version=payload.version，以及唯一 context-item source_ref 的 ID/revision。ULID item_id 使用自身作为 aggregate_id，历史外部 ID 采用生产者的 event_id 回退规则；但本适配器不为没有规范创建事件的旧条目补造基线。创建 ID 须为 ULID、版本 1、proposed，其他事件版本至少 2。

## 投影与转换

初始值为 JSON null；仅范围外事件或空页可以继续保持 null。遇到第一条上下文创建后，投影为 `{schema_version:1,kind:"context-item-lifecycle-metadata",scope,items}`。items 按原 item_id 的二进制字符串顺序排列；每项保存 item_id、完整原创建事件 created、完整最新事件 latest。历史原 trace、scope、source_refs、分类、事件 ID、cursor 均保留，没有本地生成的伪造事件时间；中间版本由已有不可变页面/应用步骤保留。

| 事件 | 必要前态 | 结果 |
| --- | --- | --- |
| ContextItemCreated | 尚无条目、版本 1 | proposed、未归档 |
| ContextItemUpdated | 已有且未归档 | proposed 或 excluded、未归档 |
| ContextItemConfirmed | 已有且未归档、状态 proposed | confirmed、未归档 |
| ContextItemArchived | 已有且未归档 | excluded、已归档 |
| ContextItemRestored | 已有且已归档 | excluded、未归档 |

已存在条目要求事件版本严格等于 latest.version+1、cursor 严格增大、分类不变；不按时间戳排序，时间偏差不替代版本。重复创建、缺创建基线、断档、归档后普通更新/确认、非 proposed 确认、活动条目恢复等拒绝整页。权限过滤或历史缺失造成的断档不会自动跳过或用当前 API 结果覆盖；基线引导和权限变更后的重建仍待开发。

最多 512 个条目，保留归档条目，不自动裁剪。仍受 1 MiB 投影及每页 64 MiB reducer 输入/输出预算限制，可能在达到条目数量前就超限；不会保存半页、自动拆页或更换应用版本。

## 混合事件流

固定 v1 明确将以下九种类型视为本生命周期投影范围外：ClientEventRecorded、ConflictDetected、ConflictResolved、ContextPackIssued、ApprovalRequested、ApprovalCompleted、work_item.updated、context.proposed、handoff.offered。其 handler 返回原投影，不解释其业务 payload；原页及应用事件 ledger 仍保留完整事件/摘要，不能把它们称为已应用实体。尤其旧 context.proposed 不构成 ContextItemCreated 基线。任何未列出的类型拒绝整页，新增业务类型需要明确更新适配器版本，不能扩大此版本的忽略集合。

应用结果包含 adapter 描述：application、projection_kind、handled_event_types、ignored_event_types、unknown_event_types=reject-page、max_items=512、item_content=not-included。所有 state 仍保留 local-reducer、server_application/source_authenticity=not-verified、full_application_history_audit=not-performed 和 acknowledgement_dispatch_state=not-sent。

## Bridge 与 CLI

`SqliteSyncInbox.applyBuiltInApplicationPage(input,trace)` 只接受上述固定名称版本，复用原 `applyApplicationPage` 的逐页事务。输入仍是完整 expected_identity/application/document_sha256/expected_previous_sha256，可选 timeout_ms；根页前驱必须显式 null。解析器 `parseInboxBuiltInApplicationApplyQuery` 可在打开库前选择适配器，不接受模块路径或可执行配置。通用 `applyApplicationPage` 仍支持调用方自己的纯 handler。

```text
workctx inbox enable-applications --inbox local-inbox.sqlite
workctx inbox application-apply --inbox local-inbox.sqlite --json-file application-page-query.json
workctx inbox application-status --inbox local-inbox.sqlite --json-file application-state-query.json
```

示例仅为文档，未执行或生成 JSON 文件。两个查询均含完整五字段 expected_identity，以及 `application:{name:"context-item-lifecycle",version:"1"}`。application-page-query 另含已导入原页的 64 位小写十六进制 document_sha256、原预期前驱 expected_previous_sha256（根 null）；状态查询不带这两个字段。可从 page-history/page-get 读取原页信息、从 application-status 查看应用头，但命令不会替调用者自动读取并刷新前置条件。

CLI 主程序和嵌入入口共用本地参数解析：必须显式 --inbox 和 --json/--json-file 二选一，输入最多 16 KiB；拒绝重复/未知参数、page-file/output/key/timeout-ms。适配器选择失败发生在打开库前；apply 打开已有可写库，但不自动创建/启用应用扩展，不请求网络或发送 ack。timeout_ms 默认 30000、范围 1–90000，只覆盖应用事务，不是文件读取或 SQLite 单次调用的硬实时取消。

成功返回 data.status=applied/already-applied、原 document_sha256、当前完整 state、adapter、local_commit_state=committed 和顶层 close_pending。重复已提交页保留当前状态，不重跑 reducer 或回退。关闭失败不改写已知提交；操作失败的 details 保留原错误/未知提交状态和原 identity/application/页面/前驱，以及关闭状态，不自动换页或重试。

## 事务校验和失败

内置投影校验在同一应用事务中检查当前头，重复原页分支还检查其历史快照，新页检查最终投影后才写入。校验包括类型/字段、scope、创建/最新事件完整契约、排序/唯一 item_id、创建与最新事件的 ID/cursor 一致性，以及所有最新 cursor 不超过快照应用边界。空页和范围外页面同样执行投影校验。校验使用独立 JSON，不改变持久内容。

业务拒绝只传播内部固定诊断，不透传任意 handler 异常正文：INBOX_CONTEXT_ITEM_EVENT_INVALID、PROJECTION_INVALID、BASELINE_REQUIRED、VERSION_GAP、TRANSITION_INVALID、LIMIT_REACHED。普通自定义 handler 失败继续归类 INBOX_APPLICATION_REDUCER_FAILED。事务提交/回滚不明仍优先返回 INBOX_APPLICATION_COMMIT_UNKNOWN/ROLLBACK_UNKNOWN，并在 cause_code 保留拒绝原因；local_commit_state=unknown 不能改为未提交。

校验不是全历史重放，也不证明投影中的每个历史事件属于所有原页面。应用名称版本依旧是调用方声明，不是代码认证；通用 API 或直接改库不能靠固定名字获得可信执行证明。application-status 是原通用读取，保留投影而不重跑本适配器；精确原页重复 apply 会执行上述内置结构校验，但仍不会重放历史 reducer。完整历史审计、投影目录/导出恢复、正文同步、旧条目基线和权限变化重建仍待补。
