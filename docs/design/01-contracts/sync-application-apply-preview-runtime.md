# 原页应用只读预览（开发契约）

2026-11-03：仅源码和文档，未编译、类型检查、测试、执行 CLI/Bridge/reducer、打开数据库、初始化 schema、迁移、生成样本或发布。无新增依赖、共享 wire 格式或 schema；R-005 仍未完成。

## 入口与原查询

`SqliteSyncInbox.previewBuiltInApplicationPage(input, trace)` 和 `workctx inbox application-apply-preview --inbox FILE --json-file QUERY`（也可用 `--json`）预览一个已经导入的精确原页。查询与 `application-apply` 相同：完整 `expected_identity`、`application:{name,version}`、`document_sha256`、显式 `expected_previous_sha256`（根页为 null），以及可选 `timeout_ms`。默认期限 30000 毫秒，范围 1–90000；查询最多 16 KiB，未知字段拒绝。返回的 `apply_query` 保留选定原页和原前驱，并含规范化期限，可作为后续显式 apply 的输入。

仅支持固定 `context-item-lifecycle/1`、`proposal-lifecycle/1`、`conflict-lifecycle/1`。CLI 在打开库之前完成查询及适配器名称版本选择，然后以 `create:false`、`readonly:true` 打开已有收件箱。必须已有完整 application 扩展；缺失或不完整明确失败，不自动创建或升级。主程序和嵌入 CLI 均本地分流，不使用当前账号、凭据、Gateway 或网络；拒绝 stdin、外部代码、重复/未知选项、`--output`、`--receipt-output`、`--page-file`、`--key` 和 `--timeout-ms`。

还未选定页面时，可用 [待应用原页发现](sync-application-pending-runtime.md) 按原身份/application 读取 `next_apply_query`，然后显式交给预览。发现列表不执行 reducer，不证明该页可成功应用；预览仍重新校验。

## 与实际应用共享的处理

预览在一次读事务中调用与 apply 相同的准备流程：完整核验当前头和快照、原页及相邻前驱、原应用前置条件、事件类型支持与事件 ID/cursor 去重；在独立 JSON 副本上依次执行当前固定内置 reducer，再校验最终投影。单份投影上限 1 MiB，单页输入投影/事件/输出投影累计最多 64 MiB。未知事件、版本断档、缺基线、非法转换、损坏、超限或超时沿用实际应用的拒绝语义，没有部分成功。

实际 apply 继续在 `BEGIN IMMEDIATE` 内准备，再写入步骤、事件 ledger 和应用头，读回后提交。预览使用 `BEGIN`，准备完成后只结束读事务，完全没有写入步骤；不通过先写再回滚来模拟。已有通用自定义 handler 应用接口保持原行为，预览仅暴露固定内置适配器。

如果指定页已经有保存的应用步骤，仍核验其原前驱、完整历史步骤/事件和投影，并核验当前头的投影。返回当前已存状态，`disposition=already-applied`、`planned_application=null`、处理事件/字节数为零；不重跑该页 reducer，也不把当前头回退到历史页。此时 `selected_page` 可能早于 `current_state`。已应用空页也遵守此规则。

## 结果

Bridge 顶层返回完整原身份/应用/scope、本次 trace 以及 `status=previewed`、`preview_completed=true`；CLI 将其放入 `data`，补充 inbox 路径，并在尝试关闭后补顶层 `close_pending`。

| 字段 | 含义 |
| --- | --- |
| `disposition` | 新页为 `would-apply`；已存页为 `already-applied`。都不是本次提交成功。 |
| `apply_query`、`adapter` | 规范化原应用查询和当前固定内置适配器描述。 |
| `current_state` | 完整已保存状态，包括原应用 trace、投影/摘要、页数/游标；无头时保持原 recorded=false/null/零值语义。 |
| `selected_page` | 指定原页摘要/前驱、原序号、next_cursor 及页内事件数，包含范围外但有显式 handler 的事件。 |
| `planned_application` | 仅新页返回预计 head_sha256/page_count/applied_cursor/projection_sha256/完整 projection；未保存，不伪造原应用 trace 或回执。 |
| `reduced_events`、`reduction_bytes` | 本次准备实际完成的 handler 调用次数和原处理字节累计；范围外显式 handler 同样计入。 |
| `budgets` | 投影和处理字节上限、本次本地事务期限。 |

两份完整投影分别遵守原 1 MiB 限额，Bridge 完整结果及 CLI 包装/关闭后的完整响应各限制 3 MiB，并沿用 JSON 深度/节点边界。超限使用 `INBOX_APPLICATION_APPLY_PREVIEW_TOO_LARGE`，不截断投影。超限不创建文件或回执。空新页仍显示下一应用步骤，即使预计投影或游标没有变化。

`local_write_state=not-performed`、`history_update=not-performed`、`application_receipt=not-created`、`acknowledgement_dispatch_state=not-sent`；`future_application=requires-revalidation` 明确后续必须重新检查。`server_application/source_authenticity/projection_semantics=not-verified`、`full_application_history_audit=not-performed` 保留局部检查的范围，不把当前快照的业务校验当作全历史重放或来源认证。

## 失败与时效

解析成功后的 Bridge 失败保留原 `apply_query`、`preview_completed=false`、处理阶段，以及适用时选中序号、当前事件 ID/cursor、已完成处理数量和累计字节；底层错误码及回滚未结束状态保留。未回传事件正文或底层异常内容。最终投影校验阶段移除单事件定位，避免将整份投影错误归到最后一个事件。

CLI 打开失败保留原查询、`stage=open` 和未写入状态；打开成功后的操作失败在尝试关闭后保留原错误并补 `inbox/close_pending`。完整 CLI 响应过大时标记 `preview_completed=true`、`response_completed=false`，表示预览读事务已结束而响应未能交付。关闭失败不覆盖已经产生的结果，也不会变成写入成功或提交未知。

预览没有冻结未来状态、预留应用头、持久预览回执或自动确认。另一个进程可能在预览后推进应用，后续 apply 必须在自己的写事务内重新解析/校验/归约；旧前驱可能失败，或同一原页已完成后按重复页语义返回当前状态。期限覆盖事务内阶段，不包含 CLI 文件读取、模块加载、打开/关闭连接；同步 SQL/归约无法被硬实时抢占。

## 待完成范围

预览不修复历史、补建业务基线、合并其他应用、更新 Gateway 源实体或替代完整重放/审计。缺失基线引导、其他业务适配器、权限变化重建、跨设备恢复及运行证据仍缺；本文没有运行通过的声明。

2026-11-04 后续新增 [客户端事件完整内容历史](sync-client-event-application-runtime.md) 固定适配器client-event-history/1，沿用本流程并接入apply/preview/pending/replay选择器。保存ClientEventRecorded原content和来源，按原账号/客户端/事件ID区分，最多512条/1 MiB；接收不表示源实体应用，不重建缺失的原上传命令。旧适配器规则不变，仅源码文档，未执行reducer、数据库、编译或测试。
