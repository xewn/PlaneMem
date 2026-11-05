# 公共契约目录

- [JetStream 真实事件总线](jetstream-runtime.md)：原始 TODO P0-03，业务事务 outbox、发布确认、持久消费回执、重放起点和积压观察；默认关闭，迁移未执行，未运行或测试。

- [搜索 SDK 与 Mock](search-sdk-mock-runtime.md)：原始 TODO P0-02，项目搜索/分页与旧索引写入、删除、恢复后的搜索联动；显式 FTS/记忆模拟，未运行或测试。

- [旧上下文索引 SDK 与 Mock](legacy-context-mock-runtime.md)：TODO P0-02，新增内容写入 SDK 及五操作共享模拟索引，包含历史重放、版本/分类与删除/到期规则；仅开发源码，未运行或测试。

- [Plane 收件箱 Mock](plane-inbox-mock-runtime.md)：TODO P0-02，队列列表/统计/详情/版本诊断、实际模拟重试调度及原回执，接现有 SDK；仅开发源码，未编译、运行或测试。

- [Plane 观察读取 Mock](observed-mock-runtime.md)：TODO P0-02，项目/工作项状态、临时上下文及目录的 SDK 模拟实现，含删除/恢复/可见性和分页；仅开发源码，未编译、运行或测试。

- [Plane Webhook OpenAPI](../../../packages/contracts/openapi/README.md#plane-webhook) 与 [完整Schema](../../../packages/contracts/schemas/README.md#plane-webhook)：TODO P0-01，七类Canonical观察的签名接收、四态持久回执与独立错误；明确原文本验签、接收/处理/交付审计不同事务及503未知结果。新增一条后累计91路；P0-01/R-001未完成、evidence为空，仅源码。

- [工作台统一查询 OpenAPI](../../../packages/contracts/openapi/README.md#工作台统一查询) 与 [完整 Schema](../../../packages/contracts/schemas/README.md#工作台统一查询)：TODO P0-01，补齐审计/管理并复用冲突目录，组合全部11操作与检查点双模式，完整请求、响应与原操作映射；统一入口新增一条后累计90路。只完成源码描述，P0-01/R-001未完成，evidence为空。

- [工作台交接与检查点完整 Schema](../../../packages/contracts/schemas/README.md#工作台交接与检查点查询)：TODO P0-01，新增handoffs与checkpoints双模式，覆盖当前/旧投影、摘要三态、归属提示、目录分页和完整历史；该轮统一查询准备八种操作模型；当前完整入口进度见上项，仅源码。

- [工作台上下文与会话完整 Schema](../../../packages/contracts/schemas/README.md#工作台上下文与会话查询)：TODO P0-01，新增context/sessions/session完整查询、记录、分页和身份权限封套；明确页大小绑定、原微秒/归档/保存来源及目录与单会话差别。统一入口进度见上项。

- [工作台概览与工作项完整 Schema](../../../packages/contracts/schemas/README.md#工作台概览与工作项投影)：TODO P0-01，统一查询的三种完整模型，记录统计/预览/规范筛选/原微秒游标及实际客户端差异；完整统一入口进度见上项，不计新增OpenAPI路由。

- [原始会话来源取证 OpenAPI](../../../packages/contracts/openapi/README.md#原始会话来源取证) 与 [公开运行边界](../03-integration/p02-session-origin-http-v1.md)：TODO P0-01，完整选件/原证明/迁移清单/当前投影及双权威封套，记录同库快照、三次来源批准、三种摘要和实际错误/期限；仅源码，未运行校验。

- [当前会话来源读取 OpenAPI](../../../packages/contracts/openapi/README.md#当前会话来源读取) 与 [运行边界](../03-integration/p02-session-current-v1.md)：TODO P0-01，完整原请求/目标授权/会话原文与摘要封套，描述独立当前权威、双审计、直接存储/原来源桥接和实际错误/期限；仅源码，未运行校验。

- [单条审计视图导出 OpenAPI](../../../packages/contracts/openapi/README.md#单条审计视图导出)：TODO P0-01，完整审阅选择/有界记录/document/持久放行封套，明确双读双授权、未知送达和实际大小/期限/SDK 边界；仅源码，未运行校验。

- [旧记忆交接 OpenAPI](../../../packages/contracts/openapi/README.md#旧记忆交接) 与 [运行边界](memory-handoff-runtime.md)：TODO P0-01，旧创建/领取两路完整契约，记录原始头身份、内存/远端引用和进程幂等的实际限制；仅源码，未运行校验。

- [会话续接与原回执 OpenAPI](../../../packages/contracts/openapi/README.md#会话续接与原回执)：TODO P0-01，两路完整父子会话/交接/保存包及历史绑定契约，区分旧 HTTP、严格 SDK 和三态原查询；仅源码，未运行校验。

- [交接创建领取与原回执 OpenAPI](../../../packages/contracts/openapi/README.md#交接创建领取与原回执)：TODO P0-01，四路原命令/当前交接/历史回执完整契约，区分旧无键领取、原身份键、当前记录核对和真实 SDK 边界；仅源码，未运行校验。

- [检查点保存与原回执 OpenAPI](../../../packages/contracts/openapi/README.md#检查点保存与原回执)：TODO P0-01，两路完整原笔记/引用/历史摘要契约，区分原 HTTP、严格客户端、独立修订、保存包重查和仅元数据回执；仅源码，未运行校验。

- [会话进度命令 OpenAPI](../../../packages/contracts/openapi/README.md#会话进度命令与原回执)：TODO P0-01，运行/工具创建与收尾、结束和原命令查询六路完整契约，区分原 HTTP、严格客户端、历史成功与当前状态；仅源码，未运行校验。

- [会话启动与原回执 OpenAPI](../../../packages/contracts/openapi/README.md#会话启动与原回执)：TODO P0-01，当前命令身份、启动与原回执三路完整契约，区分当前会话和历史创建、原可选字段及真实读取预算；仅源码，未运行校验。

- [检查点历史与交接详情 OpenAPI](../../../packages/contracts/openapi/README.md#检查点历史与交接详情)：TODO P0-01，三路完整历史笔记/引用与当前交接状态契约，明确读取预算、分页与原请求回执的区别；仅源码，未运行校验。

- [会话状态与活动读取 OpenAPI](../../../packages/contracts/openapi/README.md#会话状态与活动读取)：TODO P0-01，当前状态、运行/工具目录与详情五路完整契约，保留数字版本、原始翻页位置、当前身份提示和来源扩展；仅源码，未运行校验。

- [Plane 收件箱与原重试回执 OpenAPI](../../../packages/contracts/openapi/README.md#plane-收件箱与原重试回执)：TODO P0-01，四类元数据读取与调度/原回执六路完整契约，区分队列版本、真实水位及历史排队回执；仅源码，未运行校验。

- [旧索引内容与管理 OpenAPI](../../../packages/contracts/openapi/README.md#旧索引内容与管理)：TODO P0-01，目录/状态/写入/删除/恢复五路完整契约，区分当前身份权限提示、保存正文和历史元数据回执；仅源码，未运行校验。

- [项目与旧索引搜索 OpenAPI](../../../packages/contracts/openapi/README.md#项目与旧索引搜索)：TODO P0-01，两类搜索完整请求/命中/成功封套，明确版本/分页/记忆差异；仅源码，未运行校验。

- [Plane观察读取 OpenAPI](../../../packages/contracts/openapi/README.md#plane观察读取)：TODO P0-01，项目/工作项状态、临时上下文及观察目录四路，活动/删除/恢复与记忆/分页完整Schema；仅源码，未运行校验。

- [建议写入与原回执 OpenAPI](../../../packages/contracts/openapi/README.md#建议写入与原回执)：TODO P0-01，创建/确认/拒绝/原创建回执/原审核回执五路，完整写入与原查询Schema；建议八路源码已描述，未运行校验。

- [建议读取与提交身份 OpenAPI](../../../packages/contracts/openapi/README.md#建议读取与提交身份)：TODO P0-01，目录/完整详情/当前提交身份三路，含分页、来源观察、派生可见性及权限提示；仅机器契约源码，未运行校验。

- [冲突读取与原决定 OpenAPI](../../../packages/contracts/openapi/README.md#冲突读取与原决定)：TODO P0-01，目录/详情/身份/解决/原回执五路及完整Schema，区分HTTP事件与客户端unconfirmed、当前详情与原键决定；仅源码，未运行校验。

- [同步上传与原投递 OpenAPI](../../../packages/contracts/openapi/README.md#同步上传与原投递)：TODO P0-01，上传/发送身份/原事件回执三路及完整 Schema；区分旧 HTTP 逐条拒绝、客户端完整批次与只读历史投递，仅源码，未运行校验。

- [同步消费与确认 OpenAPI](../../../packages/contracts/openapi/README.md#同步消费与确认)：TODO P0-01，变化分页、当前位点与显式确认三路及完整 Schema；区分流高水位、消费者确认和本地持久化，仅描述现有实现，未执行运行校验。

- [上下文条目五类写入 OpenAPI](../../../packages/contracts/openapi/README.md#上下文条目写入)：TODO P0-01，原正文/完整命令回执、键/版本约束与人工确认语义；仅描述现存实现及缺口，未执行写入或运行校验。

- [当前与归档上下文详情 OpenAPI](../../../packages/contracts/openapi/README.md#当前与归档上下文详情)：TODO P0-01，两路详情及完整来源检查/确认准备/ETag Schema；仅描述既有实现，未运行接口或校验器。

- [上下文版本历史 OpenAPI](../../../packages/contracts/openapi/README.md#上下文版本历史)：TODO P0-01，历史目录与指定版本两路 GET、完整快照/确认/分页 Schema；只记录现有实现和共享解析边界，未执行运行校验。

- [指定版本文件下载 OpenAPI](../../../packages/contracts/openapi/README.md#指定版本文件下载)：TODO P0-01，固定版本/摘要/长度请求、原始字节响应及放行审计头；只记录现有实现，没有运行下载或校验。

- [文件创建与追加上传 OpenAPI](../../../packages/contracts/openapi/README.md#文件创建与追加上传)：TODO P0-01，两路 multipart 上传与完整首次/重放成功 Schema；只记录现有实现，未执行上传或运行校验。

- [文件上传身份与原请求回执 OpenAPI](../../../packages/contracts/openapi/README.md#文件上传身份与原请求回执)：TODO P0-01，两路已有读取及完整原命令/回执/身份 Schema；仅源码，完整机器契约接线与运行证据仍缺。

- [文件目录、版本目录与完整详情 OpenAPI](../../../packages/contracts/openapi/README.md#文件元数据读取)：TODO P0-01，四路现有 GET 的源码描述及详情 Schema；完整 WCP/SDK/Mock 机器契约接线与运行证据仍缺。

所有并行任务只能使用以下契约；任何私有 payload 都必须被拒绝。契约变更流程：ADR → Schema → generated SDK → Mock/Fixtures → compatibility test → downstream migration plan。

- [重新排队回执元数据目录](outbox-restore-requeue-history-runtime.md)
- [重新排队完整历史审计](outbox-restore-requeue-audit-runtime.md)
- [重新排队独立回执文件](outbox-restore-requeue-file-runtime.md)
- [重新排队回执历史导入](outbox-restore-requeue-import-runtime.md)
- [项目重新排队历史完整备份](outbox-restore-requeue-backup-runtime.md)
- [重新排队备份离线目录与批次提取](outbox-restore-requeue-backup-access-runtime.md)
- [重新排队联合备份原子导入与预览](outbox-restore-requeue-backup-import-runtime.md)
- [客户端事件完整内容同步历史](sync-client-event-application-runtime.md)
- [SDK 同步消费内存 Mock](sync-mock-runtime.md)
- [SDK 工作项目录与详情 Mock](work-item-mock-runtime.md)
- [SDK 审计查询 Mock](audit-mock-runtime.md)
- [SDK 管理快照 Mock](admin-mock-runtime.md)
- [Canonical Event v1 与 CloudEvents 双格式 AsyncAPI 消息目录](../../../packages/events/asyncapi/README.md)
- [CanonicalEvent 的 CloudEvents 结构化配置](canonical-cloudevents.md)
- [SDK 上下文历史与版本 Mock](context-history-mock-runtime.md)
- [浏览器历史同步回执完整备份与恢复](sync-browser-receipts-backup-runtime.md)
- [浏览器原同步查询完整备份与恢复](sync-browser-originals-backup-runtime.md)
- [浏览器同步保存副本移除](sync-browser-storage-removal-runtime.md)
- [待应用原页发现](sync-application-pending-runtime.md)
- [原页应用只读预览](sync-application-apply-preview-runtime.md)
- [WCP API](wcp-api.md)
- [保存包生成与完整读取 OpenAPI 源码与使用说明](../../../packages/contracts/openapi/README.md#保存包生成与完整读取)
- [保存身份与历史回执 OpenAPI 源码与使用说明](../../../packages/contracts/openapi/README.md#保存身份与历史回执)
- [保存包元数据目录 OpenAPI 源码与使用说明](../../../packages/contracts/openapi/README.md)
- [附件历史版本目录](artifact-versions-runtime.md)
- [文件版本比较独立 Schema](../../../packages/contracts/schemas/artifact-comparison.json)
- [文件版本比较 Schema 使用说明](../../../packages/contracts/schemas/README.md#文件版本比较)
- [项目文件目录](artifact-registry-runtime.md)
- [项目文件目录独立 Schema](../../../packages/contracts/schemas/artifact-registry.json)
- [附件目录独立 JSON Schema 使用说明](../../../packages/contracts/schemas/README.md)
- [Canonical Event](canonical-events.md)
- [MCP Interface](mcp-interface.md)
- [Schema/version/error](schema-versioning.md)
- [冲突元数据分页](conflict-registry-runtime.md)
- [冲突独立完整详情](conflict-read-runtime.md)
- [冲突决策原请求回执](conflict-receipt-runtime.md)
- [冲突原请求保存与恢复](conflict-recovery-runtime.md)
- [固定原冲突请求提交](conflict-submission-runtime.md)
- [同步上传与完整批次回执](sync-upload-runtime.md)
- [同步变化完整分页与有界读取](sync-changes-runtime.md)
- [原消费者确认与当前游标读取](sync-cursor-runtime.md)
- [本地同步页面文件与显式恢复](sync-saved-page-runtime.md)
- [本地同步收件箱与连续接收游标](sync-inbox-runtime.md)
- [收件箱本地投影与应用进度](sync-inbox-application-runtime.md)
- [收件箱应用历史结构审计](sync-application-audit-runtime.md)
- [收件箱应用历史浏览与指定快照](sync-application-history-runtime.md)
- [收件箱内置应用历史重放核对](sync-application-replay-runtime.md)
- [收件箱已保存应用目录](sync-application-catalog-runtime.md)
- [收件箱应用历史归档与离线读取](sync-application-archive-runtime.md)
- [收件箱应用归档原子恢复](sync-application-restore-runtime.md)
- [收件箱应用归档恢复预览](sync-application-restore-preview-runtime.md)
- [应用恢复预览的目标历史绑定](sync-application-restore-target-runtime.md)
- [应用恢复预览的原请求文件保存](sync-application-restore-request-runtime.md)
- [应用恢复持久回执](sync-application-restore-receipt-runtime.md)
- [按请求 ID 找回应用恢复原查询](sync-application-restore-receipt-selection-runtime.md)
- [应用恢复回执目录](sync-application-restore-receipt-catalog-runtime.md)
- [应用恢复回执文件与离线原查询提取](sync-application-restore-receipt-file-runtime.md)
- [跨消费者、跨应用的恢复回执目录](sync-application-restore-receipt-scopes-runtime.md)
- [应用恢复回执完整范围审计](sync-application-restore-receipt-audit-runtime.md)
- [上下文条目生命周期同步投影](sync-context-item-application-runtime.md)
- [建议生命周期同步投影](sync-proposal-application-runtime.md)
- [冲突生命周期同步投影](sync-conflict-application-runtime.md)
- [收件箱原确认日志、显式观察与重试](sync-inbox-ack-runtime.md)
- [本地确认凭据文件与页面恢复](sync-ack-evidence-runtime.md)
- [确认调用结果文件与离线查看](sync-ack-result-runtime.md)
- [原同步身份与离线队列](sync-identity-runtime.md)
- [原同步事件回执查询](sync-event-receipt-runtime.md)
- [发送队列档案受控恢复与原回执](outbox-restore-runtime.md)
- [发送队列档案恢复前预览](outbox-restore-preview-runtime.md)
- [发送队列新恢复请求准备与保存](outbox-restore-prepare-runtime.md)
- [恢复事件批量预览与显式重新排队](outbox-restore-requeue-runtime.md)
- [恢复事件重新排队的持久原回执](outbox-restore-requeue-receipt-runtime.md)
- [按批次ID找回重新排队原请求](outbox-restore-requeue-selection-runtime.md)
- [发送队列恢复历史与原档案找回](outbox-restore-history-runtime.md)
- [发送队列恢复历史全范围核验](outbox-restore-audit-runtime.md)
- [发送队列单条恢复记录对照](outbox-restore-comparison-runtime.md)
- [发送队列完整恢复历史备份与离线核验](outbox-restore-backup-runtime.md)
- [发送队列恢复历史备份导入与预览](outbox-restore-backup-import-runtime.md)
- [恢复历史备份离线目录、回执读取与档案提取](outbox-restore-backup-access-runtime.md)
- [发送队列持久暂停与恢复发送](outbox-send-control-runtime.md)
- [发送队列完整档案与离线检查](outbox-archive-runtime.md)
- [发送队列完整原记录核验](outbox-audit-runtime.md)
- [离线队列原投递核对与结算](outbox-reconciliation-runtime.md)
- [MCP 原同步身份与事件回执](sync-mcp-runtime.md)

共享最小元数据：`id`、tenant/workspace/project scope、version、etag、source_refs、classification、created_at、updated_at、trace_id。
