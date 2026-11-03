# 收件箱本地投影与应用进度（开发契约）

2026-11-03：只开发源码和文档，未编译、类型检查、测试、执行 Bridge/CLI、打开 SQLite、运行初始化/迁移、生成样本或发布。新可选 SQLite application 扩展 v1 仅为源码；core/ack 及其他扩展、outbox 升级和 PostgreSQL 016–049 仍未执行，无新增依赖。R-005 未完成。

## 与接收、确认的关系

原 `SqliteSyncInbox` 仍只管理完整接收页面、received_cursor 和独立确认日志。新增应用扩展在同一个 SQLite 文件内保存**调用方定义的本地 JSON 投影**，并把投影快照、原页面应用记录、事件去重 ledger 和应用头放在同一写事务。它不修改原页面/消费者接收头、服务端确认位点、outbox 或任何 Gateway 实体。

应用由完整原五字段 expected_identity 与 `{name,version}` 定位。consumer_key 复用原身份规范 JSON 摘要，application_key 为应用描述规范 JSON 摘要；读取同时核对应用原文，源页面仍完整核对原身份。名称/版本是调用方声明的本地适配器版本，不是代码签名或代码哈希；同一名称版本的 reducer 语义必须由调用方固定。改变业务逻辑或投影格式应选择新版本，从原链根页重新处理，不把旧投影当作新逻辑的起点。

只支持返回 JSON 的受信、同步、无外部副作用 reducer。初始投影为 JSON null，handler 接收独立投影和事件副本，返回下一投影。模块不暴露数据库句柄给 handler，不替 handler 访问网络、文件、执行命令或发送确认；调用方本身仍是受信进程内代码，不能通过此接口隔离恶意代码或回滚 handler 私自执行的外部副作用。事件 payload 仍是未认证引用数据，业务字段验证由具体 reducer 负责；共享同步解析只保证流结构与绑定。

## 接口

- `enableApplications(trace)`：在已有 inbox 中显式启用 application 扩展，返回 enabled/already-enabled 与 version=1。构造器、importPage 和读取不会自动启用或迁移。只读打开拒绝启用和 apply。
- `readApplicationState({expected_identity,application,timeout_ms?}, trace)`：同一只读事务返回当前完整投影、projection_sha256、head_sha256、applied_cursor、page_count、last_application_trace_id。不存在应用头且没有孤立应用步骤/事件时，recorded=false、投影为 null、游标/页数为零；这不判断源消费者链是否存在或完整。
- `applyApplicationPage({expected_identity,application,document_sha256,expected_previous_sha256,timeout_ms?}, handlers, trace)`：只处理已存在的指定完整原页面，不自动选择最新页或跳过历史。handlers 是事件类型到 reducer 函数的普通自有属性对象，最多 512 项；拒绝 accessor、symbol 或原型继承定义。

两种查询最多 16 KiB，应用名称/版本使用既有 sync identifier 规则，timeout 默认 30000、允许 1–90000 毫秒。应用输入必须显式提供 expected_previous_sha256（根页为 null），不根据稍后读取的应用头替用户重写前置条件。

state 带 schema_version=1、本次 trace、source_refs=[]、三层 scope、完整 expected_identity/application；原应用 trace 单列，不改为读取 trace。application_scope=local-reducer、server_application=not-verified、source_authenticity=not-verified、acknowledgement_dispatch_state=not-sent、full_application_history_audit=not-performed。applied_cursor 只表示所选消费者可见流经这个本地 reducer 连续处理的边界；权限过滤允许流游标跳跃，不表示已应用全部项目实体或不可见事件。

## 独立 schema

application-schema.ts 定义四张表：

- sync_inbox_application_schema：单行版本 1。
- sync_inbox_application_steps：每个应用/原页面的不可变完整投影快照、摘要、前驱、序号、next_cursor、事件数和原应用 trace；唯一页、序号、前驱以及根索引防止常规分叉。原页面及应用前驱使用复合外键。
- sync_inbox_applications：应用原描述及当前应用头；头通过复合外键引用已保存步骤。
- sync_inbox_application_events：事件 ID、cursor、完整规范事件摘要和所属原页；每个原消费者/应用独立按事件 ID 和 cursor 唯一，引用应用步骤，并有按页索引。

步骤和事件 ledger 的 UPDATE/DELETE 触发器拒绝常规改写/删除；只允许通过应用头指向新步骤。启用前检查所有预定表/索引/触发器名称，只要任何对象已存在就要求完整版本、对象种类和列集合，不补部分 schema。检查不比对完整 SQL 定义、不代替物理完整性/外键审计，不能抵抗直接恶意数据库篡改。

## 原页事务

每笔 apply 使用 BEGIN IMMEDIATE，先核验当前应用头、完整源页、快照规范 JSON/摘要、直接应用前驱及当前页的全部事件绑定；源页继续复用既有 received 链头/所选历史页检查。不会因当前源接收头已前进而改选其他页面。

如果该原页已有应用步骤，重新核对完整步骤/事件绑定和原预期前驱，返回 already-applied 及**当前**应用状态，不调用 reducer、不回退旧投影。单次调用前仍校验 handlers 形状，但重复已提交页无需再次支持其事件类型。只核对已保存结果，不重新执行旧版本代码来“验证”历史语义。

新页必须满足：预期前驱等于当前应用头；源页前驱等于同一摘要；源序号等于应用页数加一；源 query.cursor 等于当前 applied_cursor。首个应用页因此必须来自源链根页/零游标。整页先检查所有事件类型均有显式 handler，并检查事件 ID/cursor 未在其他应用页出现；不支持类型或复用事件直接拒绝，绝不默认忽略。想忽略某个已理解的事件，调用方须为它显式提供返回原投影的 handler。

按源事件顺序逐一调用 reducer，每次输入都是 JSON 副本。返回 Promise/thenable、抛错、非法 JSON 或过大投影都拒绝；异步返回的后续拒绝被接收以避免无处理 rejection，但其结果绝不用于推进。处理全页后才插入完整最终快照及事件 ledger，再以旧头和完整应用描述作为更新条件推进应用头。首个步骤/事件/头也同事务创建；完整读回新快照、原页和全部事件绑定后，COMMIT 成功才返回 applied。

空终页仍记录一个应用步骤，可能保持相同游标和投影；序号与摘要保证它不会与“尚未应用”混淆。不同进程使用同一写事务及唯一约束协调同一应用。未提交失败可能在重试时重新调用纯 handler；保证范围是本地已提交投影/ledger 的逐页一致性，不是任意外部副作用的 exactly-once。

## 边界与失败

单份投影规范 JSON 最多 1 MiB，沿用共享深度/节点规则。单页最多 500 个变化，源页仍按既有约 4 MiB 完整边界读取。每次 reducer 的输入投影、事件和输出投影按 UTF-8 长度累计，整页处理预算为 64 MiB；超限拒绝完整页，不保存部分结果。大投影和多事件组合可能超过此预算，应由适配器采用可容纳的状态设计；没有自动拆页或改变既有接收链的逻辑。

SQL 对投影/元数据做类型和字节投影保护；精确查找最多读两行识别歧义，页事件计数最多观察 501 行，逐个原事件核对摘要/cursor/所属页。读取核验当前头和直接前驱、所选页事件，并检查头之后的应用步骤；未遍历全部应用历史、投影业务正确性、其他应用或数据库物理状态。孤立步骤/事件、损坏投影或不匹配的本地绑定明确失败，不补空状态或修复。

从 BEGIN 前开始采用单调时间，主要循环及 COMMIT 前检查期限。SQLite 忙碌等待、单次 SQL、同步 reducer/解析不能被硬实时抢占；函数返回后才可继续其他进程内工作。COMMIT 已成功不再因随后超时把已知结果改成失败；提交异常返回 INBOX_APPLICATION_COMMIT_UNKNOWN，即使后续 ROLLBACK 成功也不能声称未提交。body 失败且回滚失败返回 INBOX_APPLICATION_ROLLBACK_UNKNOWN。未知错误保留原因码和事务阶段/回滚状态；调用方应重新打开并读取同一应用，再用同一原页/前驱显式核对，不能换页跳过。

常规前置条件、未知事件、重复事件、handler、限额、损坏及存储错误使用 INBOX_APPLICATION_*；回滚成功时 local_commit_state=not-committed。原查询/应用版本由调用方保留，不自动重试或调用服务器。现有 ack API 仍按自己的契约运作，本增量没有把 ack 自动绑定到某个应用，调用方不能把接收进度当作此应用进度。

## 本地 CLI 状态入口

2026-11-03 增补：`workctx inbox enable-applications --inbox FILE` 显式启用既有 application v1，只有 --inbox 一个选项；不创建原收件箱，也不注册或执行应用。成功返回 data.status=enabled/already-enabled、data.version=1 和 local_commit_state=committed，外层 scope=null。已有扩展仍校验完整结构，部分 schema 不自动修复。

`workctx inbox application-status --inbox FILE --json-file QUERY.json`（或 --json）接受上述读取查询，必须含完整 expected_identity 与 application 的 name/version，可选 timeout_ms。输入最多 16 KiB；稳定普通 UTF-8 文件可含 BOM。完整解析发生在打开库之前，然后 readonly 打开已有收件箱并调用 readApplicationState；不会初始化或升级扩展。预算覆盖 Bridge 读取事务，不含文件读取、模块载入或打开数据库。状态位于 data.state，保留完整投影/摘要/原应用 trace 及所有未验证边界，外层 scope 取查询原身份。

两个命令均通过主程序与嵌入式 CLI 本地分流，不需要环境身份/令牌，不调用路由器或网络。拒绝 stdin、重复/未知选项及 page-file/output/key/timeout-ms 等混用；JSON 中 timeout_ms 与远端 --timeout-ms 参数不同。操作后尝试关闭连接，成功保留完整结果和顶层 close_pending；失败保留原错误 code/details，补 inbox/close_pending，未知提交不能因关闭失败或包装错误而变成未提交。打开库前的失败没有连接关闭阶段。

上述状态入口仅新增 CLI 源码与文档，没有执行示例、打开数据库或启用 schema。后续同日增补已接 `inbox application-apply` 与固定 context-item-lifecycle/1 内置适配器，详见 [上下文生命周期投影](sync-context-item-application-runtime.md)；状态读取仍不重跑 reducer、推进游标或发送确认。

## 原页应用预览

`previewBuiltInApplicationPage` / `inbox application-apply-preview` 复用实际 apply 的准备阶段，在单次读事务返回当前完整状态和独立预计投影，支持三个固定内置适配器；已应用页保留当前状态且不重跑。完整响应上限 3 MiB，失败保留原查询与阶段；后续实际应用重新校验，不自动写入或确认。详见 [原页应用只读预览](sync-application-apply-preview-runtime.md)。仅源码文档，无 schema/依赖变化，未运行或测试。

## 尚未完成

目前提供 Bridge 可编程投影事务、读取基础、上下文/建议生命周期元数据与冲突历史适配器，以及 CLI 显式启用/读取/指定原页应用。新增 auditApplicationHistory/CLI application-audit 已提供同一只读快照的完整历史结构覆盖，详见 [应用历史结构审计](sync-application-audit-runtime.md)，不执行 reducer 或核对业务语义。readApplicationHistory/readApplicationSnapshot 与 CLI application-history/application-get 已补固定双边界分页和指定历史投影读取，见 [历史浏览契约](sync-application-history-runtime.md)，仅核验选中步骤与边界，不继承完整历史审计状态。replayBuiltInApplicationHistory/CLI application-replay 已补固定 context-item-lifecycle/1、proposal-lifecycle/1 和 conflict-lifecycle/1 的逐页正序重放比对，见 [内置历史重放核对](sync-application-replay-runtime.md)，不回写原状态，也不认证旧执行代码。readApplicationCatalog/CLI application-list 已提供原消费者下的应用名称/版本目录和后续读取查询，见 [应用目录](sync-application-catalog-runtime.md)；仅逐项核验当前头，不扫描缺描述的孤立行。readApplicationArchive 与 CLI application-export/application-inspect/application-archive-get 已补完整原页和逐页投影的独立归档及离线读取，见 [应用历史归档](sync-application-archive-runtime.md)，不包含未应用后缀/确认日志。restoreApplicationArchive/CLI application-restore 已补单写事务内的缺失原页和空应用恢复，以及完整相同历史的重复恢复，见 [应用归档恢复](sync-application-restore-runtime.md)；兼容较新接收后缀保留，分叉/部分应用历史拒绝。previewApplicationArchiveRestore/CLI application-restore-preview 已补只读目标关系和预计写入数量，见 [恢复预览](sync-application-restore-preview-runtime.md)，与恢复共用比较规则但不保留目标锁。其他业务适配器、完整正文、版本管理、其他适配器的历史重放、不同历史合并、跨设备迁移，以及真实并发/重启/崩溃证据仍待补。既有页面链归档只包含接收页，不包含此应用头/投影/ledger；恢复原页面不会自动恢复或重建应用状态。所有 schema、SQLite 事务和 reducer 路径均未实际运行。
