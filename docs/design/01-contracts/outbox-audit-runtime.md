# 发送队列完整原记录核验（开发契约）

2026-11-03：仅源码和文档，未编译、类型检查、测试、执行 CLI/Bridge/API、打开 SQLite、执行 schema/迁移或发布。无新 schema/依赖/共享 wire/Gateway API 变化；已有 SQLite 身份列升级和 PostgreSQL 016–049 仍未执行，R-005 未完成。

## 本地入口与完整范围

Bridge 新增 `SqliteOutbox.auditRecords(input,trace)` 与 `parseOutboxAuditQuery`；CLI 新增 `outbox audit`，主程序和嵌入 `runWorkctx` 共用 `outbox-read.ts`。只读打开已有正规队列文件，沿用 query_only/列检查，不创建目录、数据库、表或自动升级，不调用令牌、router、Gateway 或发送器。

仅展示语法，未执行：

```text
workctx outbox audit --outbox existing.sqlite
workctx outbox audit --outbox existing.sqlite --json '{"max_events":5000,"max_bytes":134217728,"timeout_ms":60000}'
workctx outbox audit --outbox existing.sqlite --json-file original-audit-query.json
```

查询严格为 `scope:{tenant_id,workspace_id,project_id}` 加可选 `max_events`、`max_bytes`、`timeout_ms`；三层范围须 ULID。默认 1000 行/64 MiB/30000 ms，上限 10000 行/512 MiB/90000 ms，均为正安全整数。拒绝 status、after_event_id、limit 等部分范围过滤，不能把筛选窗口声称为完整核验。

CLI 可省略 JSON，此时使用配置范围和默认预算；保存查询若包含 scope，必须与当前配置完全一致，不悄悄换项目。--json/--json-file 互斥，文件须为稳定正规 UTF-8 JSON，最多16 KiB。拒绝重复/未知选项、stdin、写键、output、额外位置参数；预算只放在 JSON 中。解析和范围比较先于打开数据库，路径沿用 --outbox、WORKCTX_OUTBOX、默认路径的顺序。

## 单次读快照的覆盖检查

`auditOutboxRecords` 在一个 BEGIN/COMMIT 只读事务中先对选定项目做最多 max_events+1 行的计数。超过预算立即明确未完成；预算内的计数是该事务范围的完整实际行数。随后按 SQLite BINARY event_id 递增、每批最多20条读取完整有界投影，第一批无下界，后续比较同样在 SQLite 中进行，不用 JavaScript UTF-16 顺序替代。

复用既有 `outboxReadProjection(true)`，元数据先在 SQL 中限制类型和字节数，payload/source_refs 各最多1 MiB才返回正文。复用 `outboxRecordSummary` 核对完整范围、状态、调度、租约、元数据和原身份；复用 `checkedOriginalEvent` 核对完整 JSON、同步命令、原身份绑定、payload checksum 和 command_checksum。缺原身份旧行失败并保留，不能按当前凭据补齐；非法/损坏内容不改为空 payload/refs。

所有已读 event_id 和本地 idempotency_key 在选定项目内须唯一，既有唯一约束缺失造成的重复也拒绝。终点要求成功核验条数与同事务实际数量一致，防止重复边界被 keyset 略过后报完整。空项目返回零条完整结果。此次只覆盖原范围；其他项目中的坏行、跨项目重复键、表约束/索引完整性或数据库物理完整性不在本结果内。

`max_bytes` 限制已核验记录的原存储文本列 UTF-8 总量，包括 payload/source_refs 的原 JSON 文本（含原空白）、范围/身份、事件/本地键、摘要、trace、调度/状态、租约和适用投递/诊断文本；不包括数值列的磁盘占用、页面/索引/WAL或输出封套。错误行不增加 checked_events/checked_bytes。读取时最多一个有界批次已进入内存后才检查累计预算，不承诺磁盘读取量或进程内存等于该数值。

每次 SQL 操作前后、逐条完整解析之后和只读提交之后检查单调期限。预算从 Bridge 核验开始，不包含 CLI 文件读取、库打开/列检查和关闭；同步 SQL/JSON 不能硬实时抢占，无新增索引，不保证扫描/排序成本固定。超过期限、行数/字节预算、解析失败或存储异常均没有部分成功，也不提供跨快照继续核验游标。

## 结果与失败保留

成功 data 包含规范 query、scope、`status:complete`、checked_events/checked_bytes、`byte_basis:stored-text-columns-utf8`、五种状态统计、active/expired/none 租约统计、legacy_payload_checksums、observed_at、`consistency:single-project-read-snapshot`、`original_content:validated`、`server_delivery:not-checked` 和 `database_integrity:not-audited`。Bridge 数据限制16 KiB，无正文或完整键清单；CLI 沿用版本/trace/source_refs/scope 封套并附原队列路径。

observed_at 是本次核验开始时的本地观察时间，也是全部租约分类的统一时间，不是可信存储时间或提交时间。活跃发送可读取，但不抢占、续租、停止、重试或结算；过期租约也不证明网络已结束。状态统计描述本地记录，sent/conflict 不自动证明远端当前结果。legacy_payload_checksums 单独统计早期标为 sha256 的八位 FNV payload checksum；仍需已有完整命令 SHA-256 校验通过，不将旧弱摘要当作来源认证。

错误保留原具体代码（如 OUTBOX_IDENTITY_REQUIRED、CHECKSUM_MISMATCH、CORRUPT_RECORD、OUTBOX_RECORD_CORRUPT），预算报 OUTBOX_AUDIT_LIMIT_EXCEEDED，期限报 OUTBOX_AUDIT_TIMEOUT。details 保留规范 query、complete=false、stage（count/records/read-commit）、已成功核验的数量/字节和合法时的 selected_event_id；非法事件 ID 不透传原坏值，数量仅诊断进度，不代表部分通过。

仅对本次成功开启的读事务尝试回滚，失败保留 rollback_pending。CLI 打开错误增加 stage=open 和原查询；读取错误/成功都尝试关闭，失败补 close_pending，成功结果不因关闭失败被抹去。审阅参数错误发生在核验之前，没有伪造的进度。用法错误退出2，核验/文件/存储失败退出1，完整核验成功退出0。

## 待补范围与证据

此核验不导出备份、恢复/修复、补绑定旧身份、不认证来源/远端投递、不修改租约或形成自动发送门禁。全数据库跨项目核验、完整队列备份/恢复、旧发送者协调、显式放弃及容量/历史修复仍待补。项目范围/重复边界/Unicode、缺身份、摘要/JSON损坏、预算/锁/提交回滚关闭异常、并发发送及 CLI 主程序/嵌入兼容均无运行证据；源码进展不视为运行通过。

后续 [发送队列完整档案](outbox-archive-runtime.md) 已复用此单次完整遍历增加原记录收集，普通 audit 不收集/导出档案；原算法抽取到 original.ts 共用，核验结果/预算保持。档案文件保存与离线检查已有源码，受控恢复及运行证据仍待补。
