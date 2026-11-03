# 发送队列完整档案导出与离线检查（开发契约）

2026-11-03：仅源码与文档，未编译、类型检查、测试、执行 CLI/Bridge/API、打开数据库、生成样本、执行迁移或发布。新增 Bridge 档案格式/包子路径，无数据库 schema、依赖版本或 Gateway API 变化。既有 SQLite 升级和 PostgreSQL 016–049 仍未执行，R-005 未完成。

## 入口和范围

新增 `SqliteOutbox.readArchive(input,trace)`、`outbox export` 与 `outbox inspect-archive`。导出完整覆盖指定项目在一次只读快照中的全部已知本地记录；不从跨调用的 list 分页拼接备份。离线检查仅读取所选文件，不需要当前项目配置、令牌或队列文件，不打开 SQLite，也不调用 Gateway。

仅展示语法，未执行：

```text
workctx outbox export --outbox existing.sqlite --output new-archive.json
workctx outbox export --outbox existing.sqlite --json-file original-query.json --output new-archive.json
workctx outbox inspect-archive --archive-file new-archive.json
```

export 必须有 --output 新路径，可选 --outbox 与互斥 --json/--json-file，查询包含可选原 scope 和 max_events/max_bytes/timeout_ms。默认当前配置范围、1000行/32 MiB原文本/30000ms；最多1000行/32 MiB/90000ms。显式查询 scope 必须与配置范围完全相同，不替换原项目，不支持状态或续页筛选。输入文件限16 KiB，范围、预算和新目标检查先于打开队列。队列路径沿用参数/环境/默认顺序；空值、stdin、:memory:、重复/额外选项及多余位置参数拒绝。

inspect-archive 只接受 --archive-file，不能带 outbox、JSON、output 或写入选项。主程序和嵌入入口均在通用 archive-file 拒绝前接专用分支；离线分支不读取当前 scope，也不调用 router。新增 `@planemem/context-bridge/outbox-archive` 导出无 SQLite 运行时导入的文件解析器；主包仍仅在显式导出时动态加载。

## 原记录格式

文件严格为 `{document,document_sha256}`，文档严格为 schema_version=1、kind=`workctx.sync-outbox-archive`、scope、observed_at、export_trace_id 和 records。scope 为原三层 ULID；时间为规范 ISO 本地观察值，export_trace_id 保留原导出调用，单行 trace_id 保留其原记录值，不因离线检查改写。

records 每项保存现有 v1 已知23个本地列：event_id、tenant_id、workspace_id、project_id、event_type、idempotency_key、next_retry_at、checksum、status、trace_id、lease_token、sensitivity、server_event_id、conflict_id、last_error、expected_actor_id、expected_client_id、command_checksum、attempt、client_cursor、server_cursor、payload、source_refs。可空列明确为 null，缺列/额外列拒绝；metadata_valid、payload_bytes 等读取辅助字段不进入档案。未来未知扩展列、表/索引定义及数据库物理文件不包含在这个版本的逻辑档案内。

payload/source_refs 保存原 JSON 文本字符串，包括原字段顺序、空白和转义；不会先解析再重写原存储文本。读回会解析这些字符串并重新核验完整同步命令、原身份、payload checksum 和 command_checksum。字段类型/字节/安全整数规则与完整 SQL 投影共用列定义，离线重新计算有效标志与字节数，不接受文件提供的“已验证”标记。单条原正文/引用各保留1 MiB限制；行外层 JSON 可因转义增长，单行读取上限4 MiB+64 KiB，仍受完整文档上限约束。

档案按 event_id 的 UTF-8 字节顺序严格递增且唯一，本地 idempotency_key 在该档案中也必须唯一。读取快照后才按独立档案规则排序；文件解析不自动排序或去重。缺原身份旧行、部分身份、非法元数据、坏 JSON、原命令或正文摘要不符均拒绝，不用当前凭据补齐，不省略坏行。原短 FNV payload checksum 按既有兼容规则检查，同时仍要求完整命令 SHA-256。

## 完整导出、预算和摘要

导出复用 `auditOutboxRecords` 的单次 BEGIN/COMMIT 读取、实际数量核对、BINARY keyset 遍历和完整行校验，在每行校验后收集已知原列。只在完整读取事务成功后形成档案；不另开第二次读取，也不根据后来的队列状态替换内容。空项目可导出空档案；缺文件/缺列仍按已有 readonly 入口拒绝，不创建或升级数据库。

原文本预算沿用 outbox audit 定义；另有独立1000行/32 MiB完整文档、32 MiB+8192完整文件以及共享 JSON 100000节点/深度64限制。收集时累加每行转义后 JSON 字节，最终完整文档再核验封套开销；多份分别有效的行不保证合并后可导出。任何超限不输出局部档案。导出期限覆盖 Bridge 读取、收集、完整文档重核和摘要，查询解析/CLI文件处理、库打开关闭及文件保存不在该期限内；同步 SQL/解析不能硬实时中断。

文档使用规范封套及固定已知列顺序序列化，保留每个原文本字符串，计算 SHA-256；文件记录64位小写十六进制摘要。离线检查同时核对文档摘要和逐行原有内容/命令摘要。改变状态/租约等本来不在命令摘要中的字段也会改变文档摘要，但外部可重算摘要，所以此档案不认证来源、历史真实性或远端结果。

`original.ts` 抽取原 fromRow、checkedOriginalEvent、uploadEvent、checksum、intact 和 commandContent；发送、入队、单条读取、audit、reconcile 和离线检查复用同一原算法。列定义从 SQL 投影提取后保留其字段/顺序/条件；没有修改旧存储、发送状态机或原命令指纹规则。

## 文件保存与结果

CLI 先完整读取并尝试关闭队列，再准备完整文件字节，复用独占临时文件写入/同步/摘要读回与硬链接新路径发布，不覆盖已有文件或链接。最后通过稳定有界文件读取重新核验整个档案及文件大小/文件摘要/文档摘要。最终路径读回失败保留 published-unconfirmed/content_state=unconfirmed、目标/适用临时路径和清理标记；不会自动删除或覆盖目标重试。工作期间实际未生成文件或运行这些操作。

成功只输出摘要：原范围、记录总数、原文本字节、历史状态与租约统计、旧短摘要计数、observed_at、export_trace_id、document_sha256、observation=archived-local-state、server_delivery=not-checked、lease_ownership=not-granted，以及文件路径/字节/摘要/保存或读回状态。文件中含完整原正文和租约标识，应由用户保管；stdout 不展开这些正文。

读取失败保留 audit 的原查询、阶段、进度、合法事件定位及回滚信息；完成读事务后档案准备失败标 stage=archive、audit_complete=true、complete=false，区别完整内容核验与完整档案交付。CLI 始终尝试关闭，保留 close_pending；文件保存失败保留原队列/目标路径、档案摘要和条数，不抹去已知文件状态。离线失败保留原文件路径、适用行索引和事件定位，无部分成功结论。

## 限制与待补

档案是原快照的逻辑副本，包含当时的 sending/lease_token 不意味着当前拥有租约、原发送器已停止或可以再次发送。没有恢复、合并、重置租约、删除队列、修复、旧身份绑定、上传、远端回执查询或确认；队列恢复必须另外处理旧发送者协调和未知投递，不能直接重灌档案触发自动发送。

跨项目全库/未知列备份、更大流式档案、档案记录选择/原查询提取、受控恢复和历史修复仍待补。字段/顺序/原文本保留、空库/缺库/重复边界、大小/复杂度/期限、共享校验兼容、独占保存/路径竞争/关闭失败与损坏文件等均无运行证据；仅记录开发进展。

2026-11-03 后续增量：[持久发送控制](outbox-send-control-runtime.md) 已补按项目暂停新领取和版本绑定恢复发送；已领取工作仍可完成，旧发送者协调未解决。档案 v1 继续只保存原23列，不包含 local_outbox_send_control 或暂停状态，导出不自动暂停；后续恢复必须独立建立目标控制，不能把历史租约或源队列暂停当成目标发送授权。

2026-11-03 后续增量：[受控恢复与原回执](outbox-restore-runtime.md) 已补将完整原档案恢复到暂停版本匹配的空项目；未完成行转为failed待处理并清除旧租约，原档案与回执同事务保存，重复原请求不重灌。档案 v1 格式不变，仍不包含控制表或恢复回执；非空合并、原发送者停机与自动激活不在此增量内。
