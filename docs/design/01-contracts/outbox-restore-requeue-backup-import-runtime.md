# 重新排队联合备份原子导入与预览

2026-11-04，ADR-015 / T3.4 / T4.3 / R-005。仅源码文档；未编译、类型检查、测试、运行产品命令、打开数据库、初始化可选表、执行迁移、生成样本或发布。复用既有可选历史表，无 schema 或依赖版本变化；SQLite 既有扩展及 PostgreSQL 016–049 仍未执行。

## 入口与完整源绑定

Bridge 提供 `previewRestoreRequeueBackupImport(file, query, trace)` 和 `importRestoreRequeueBackup(file, query, trace)`。CLI 提供 `outbox restore-requeue-backup-import-preview` / `outbox restore-requeue-backup-import`，均必须使用 `--outbox EXISTING_FILE --archive-file BACKUP --json QUERY` 或 `--json-file QUERY_FILE`。

查询严格为 `{scope, backup_sha256}`，最多16 KiB；scope 是完整三层项目范围，摘要为原备份规范文档的64位小写SHA-256。拒绝未知字段、null及无效范围/摘要；CLI可补调用开始时固定的配置scope，显式范围必须匹配。备份导出/检查摘要新增 import_query，可直接用于本入口；独立回执的 document_sha256/requeue_id 查询与此查询不能混用。

CLI先读取稳定普通UTF-8文件并完整验证全部父历史、批次、固定v1映射、引用闭包及备份摘要，再匹配原查询；源无效或不匹配不打开数据库。预览使用原生readonly连接，实际导入只打开已有库。拒绝stdin、内存库、output、receipt-file、额外/重复选项；JSON来源必须且只能提供一个。不发起网络请求或自动执行队列操作。

## 同事务目标比较

联合导入与单批次导入共享 `restore-requeue-import-target.ts` 的父历史和批次比较器。源先完整验证，再在一个读事务或 `BEGIN IMMEDIATE` 内检查全部选中ID的全局占用；不检查或合并备份之外的历史。每个父ID在一轮完整比较中只载入一次正文，共用父历史不会按批次重复载入。

父比较先读取至多两条有界元数据，拒绝重复ID；原查询最多16 KiB、原档案最多32 MiB+8192，长度检查及预算预留完成后才读取正文。目标父历史必须通过完整源档案/恢复映射核验，再与源备份父回执和原档案深度相同。批次比较先检查全局ID、项目及原查询长度，再读取固定有界字段投影，核对原查询SHA/时间/trace/摘要结构；全部原请求、父恢复文档SHA、父回执SHA、选中前后SHA和原时间/trace必须与已验证源回执完全相同。

| relation | 含义 |
| --- | --- |
| missing | 可选表或所选ID不存在，可以补入 |
| identical | 原内容完全相同，保留 |
| different | 同项目同ID内容不同，整批导入拒绝 |
| reserved-other-project | ID由其他项目占用，整批导入拒绝 |

损坏结构/正文、重复ID或读取失败直接报错，不当作missing或可覆盖冲突。有效但不同的历史可作为预览conflict返回。目标批次与源完全一致而父历史缺失时，target_parent_binding=verified-against-source-only，允许凭完整源补回父历史；父和批次都相同为matched，其余not-matched。源比较成功不声称缺失目标父项已存在。

预览返回status、完整plan，包含两张表的存储状态、父项/批次关系列表、missing/identical/conflicting计数、关联状态和本轮读取字节。plan.compatible只有所有关系均为missing或identical时为true。预览不创建表、不预留ID；实际导入重新比较，不能将旧预览当成写入许可或已提交凭据。

## 原子补入与最终完整读回

实际导入完成整份初始比较后，遇任一冲突就整批拒绝。候选结果在任何写入前做完整容量检查，按缺失项需要才创建既有可选表；空备份不创建表。仅向缺失父项/批次插入原内容，不覆盖或删除现有历史。

1. 按备份顺序补父历史；每个计划缺失父项在插入前重新检查全局占用，必须仍为missing，每次插入恰好一行。
2. 全部父写完后再完整比较：父项必须全部identical，批次关系必须与初始计划一致，防止父写入触发器提前生成或改变批次。
3. 对计划缺失批次逐条写前检查，仍为missing才插入一次；其他批次保留。前一条写入若改变后续计划项则拒绝。
4. 全部写完后再次完整比较所有选中父历史与批次，要求全部identical，覆盖触发器改变先前项的情况；完整成功结果准备好并检查期限后才提交。

最终读回重新核验每个不同父历史的完整正文及固定恢复映射，并逐字段核对全部批次与已完整验证的源回执。源验证已证明每个批次与其父项、原查询、前后摘要之间的关系，因此最终全部相同构成完整关联读回，无需每个批次再载入一遍相同父正文。任一缺失、变化、歧义、超限或读回失败导致整个写事务失败。

成功action为imported或already-present，返回本次新增和初始已存在父历史/批次数，readback=all-selected-parent-histories-and-batch-bindings。local_commit=committed仅在实际COMMIT成功后对外返回；提交成功后不因后续过期或关闭失败改称未提交。空备份成功属于already-present，只描述该空集合。

## 容量、期限与失败详情

源仍受100批/100父项、64 MiB文档、64 MiB+8192文件和共享100000节点/64层约束。目标每一轮比较最多64 MiB，整个操作所有比较最多256 MiB。统计原父query_json/archive_json及批次query_json的UTF-8存储字节，包括外层空白；同一轮共享父只算一次，后续轮次重新累计。写前单项检查也计入对应轮次及总预算。固定元数据、重复内部元数据查询、源文件验证、序列化副本不在此计数内；不是物理I/O或内存上限。

预览plan.checked_target_bytes是完整初始轮次计数；实际成功checked_target_bytes是最终读回轮次，total_target_bytes累计所有比较。错误用read_pass/pass_reserved_bytes/total_reserved_bytes和checked_parents/checked_receipts区分正文预算已预留与项已完成验证；读前超限保留requested_target_bytes，不载入超限正文。规范源文件很小仍可能因目标存储空白或不同的大历史触及读取限制。

Bridge从源完整验证到目标比较、写入、读回采用90秒阶段预算；同步SQL/JSON不能硬实时中断。CLI预先验证与Bridge验证有各自预算，文件I/O、模块加载、数据库打开/关闭不计入其中。完整plan、成功数据及CLI封套各最多128 KiB，超限不截断。stdout不含原档案正文或租约。

失败保留原query、source_history摘要、candidate_plan、标为unconfirmed-requeue-backup-import的candidate_result、当前selected_source_receipt、stage、目标恢复/批次ID、读取轮次/字节和进度；内层原事件定位及ContractError.details继续保留。selected_source_receipt是已验证源历史，不代表目标提交。COMMIT异常或回滚失败保留local_commit=unknown及事务phase/rollback，不把候选计数或备份文件当成提交证明。

CLI始终尝试关闭，追加backup_file路径/文件大小/SHA、outbox和close_pending；关闭失败保留已知结果。封套超限仍保留result和local_commit，不重新导入。没有独立持久导入回执，prior_import_commit=not-proven；重复导入只证明本次目标内容存在，不能证明先前未知提交的结果。

## 历史语义与剩余范围

只写历史表，restored_events=0、requeued_events=0，current_queue/current_control=not-read-or-modified。保留全部原ID、事件顺序、原因、generation、时间/trace和摘要；不要求当前队列为空或暂停，不恢复当前事件、不调整发送控制、不激活或发送。导入后原restore_id/requeue_id仍具有历史幂等语义，使用原ID执行原操作会命中历史，不能据此认定当前事件已恢复。

预览observation=current-requeue-backup-import-preview，实际成功=current-local-requeue-backup-import；source_authenticity=not-proven、server_delivery=not-checked、database_integrity=not-audited。其他项目或备份外历史保留，不证明全库健康、历史来源真实性或远端投递。跨项目备份、保留管理、来源证明、跨端完整恢复及运行证据仍缺，R-005未完成。

本轮仅源码文档；正常/空备份、相同父重复引用、缺父修复、混合缺失/相同、冲突/损坏、全局重复ID、触发器影响先前/后续项、期限/容量、回滚/未知提交、关闭及响应失败均尚无运行验证。单批次入口复用比较器后仍保留原精确查询和最终关联读取语义。
