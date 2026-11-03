# 按批次ID找回重新排队原请求

2026-11-03，关联 R-005 / T3.4 / T4.3。仅源码与文档；未编译、类型检查、测试、执行CLI/Bridge、打开数据库、初始化schema、迁移、生成样本或发布。无schema、依赖或回执格式变化。

## 入口与选择查询

Bridge新增 `SqliteOutbox.readRestoreRequeueRecord(selection, trace)`；CLI新增：

`workctx outbox restore-requeue-get --outbox EXISTING_FILE --json-file SELECTION [--output NEW_QUERY_FILE]`

selection严格只有scope和requeue_id，沿用既有项目范围/同步ID及16 KiB输入限制，不接受原恢复ID、原因、暂停版本、事件列表等替代字段。CLI可省略scope，取调用开始时复制的配置项目；显式scope必须匹配。必须提供已有--outbox文件和一种--json/--json-file；查询文件为稳定普通UTF-8，可带BOM。拒绝重复/未知参数、额外位置参数、stdin、空路径、内存库和档案/回执输入文件。

原 `restore-requeue-receipt` 仍要求完整原七字段，精确重复写操作仍比较全部原查询；新增选择入口只负责发现，不放宽原请求一致性约束。原请求丢失而仍知道requeue_id时，可以按本入口取回并保存。

## 只读发现与完整核验

在单个读事务中，复用原回执的有界表/行读取与全局ID唯一性检查。按项目和requeue_id取得原query_json并完整解析，验证存储scope/ID、原查询SHA、原时间trace和版本；再完整核验关联的父恢复回执、整份源档案、父回执及归一摘要，重算请求顺序下全部选中记录的变更前后摘要。

此入口不需要调用方事先提供完整原查询，读取到的原七字段仍经相同校验。ID在其他项目占用时拒绝，不返回对方正文；重复ID、坏元数据、缺失父历史或摘要不符都拒绝，不能返回未验证的原请求。旧精确查询和写前重放检查通过共享读函数显式传入expectedQuery，继续要求全字段相等。

成功返回scope、selection、status=recorded、original_query和完整receipt，以及observation=original-requeue-request-lookup、本次observed_at。无表/未观察到ID时返回status=not-observed、original_query=null、receipt=null。两种情况均local_commit=not-attempted，current_queue/current_control/server_delivery=not-checked；只读打开已有队列，不建表、不修改当前事件、不改变暂停版本、不访问网络或发送。

original_query保留原事件顺序、原因、档案摘要、暂停版本、范围及两个ID。原回执的requeue_trace_id/requeued_at是历史信息，本次查询trace/观察时间不会替代它们。未观察到记录不证明未知提交失败；内容一致和回执仍不是当前队列、服务器投递或来源签名证明。

## 可选原请求文件

只有get允许--output；该参数在打开库前预检为已有目录中的新文件。完成全部核验和读事务后，CLI尝试关闭数据库，再保存original_query；找不到记录则报OUTBOX_REQUEUE_RECORD_NOT_FOUND，不创建文件。没有output时，缺记录以结构化not-observed结果返回。

共享原请求保存助手冻结紧凑UTF-8 JSON字节，最多16 KiB，独占临时文件、同步、读回后硬链接发布，不替换已有文件。最终有界读回核对字节数、逐字节、SHA和JSON。输出只含原七字段，可直接作为restore-requeue-receipt或原操作的--json-file；不会生成新ID、刷新generation或包装成另一种命令。

local成功结果包含path、file_bytes、file_sha256、format=outbox-restore-requeue-query-json、verification=exact-final-file-bytes-and-json及清理状态；未选择保存时local=null。此文件保存原请求，不是完整历史备份或服务器回执文件。

Bridge失败保留selection、原错误详情和已经完整核验的historical_receipt。CLI追加输入选择、目标路径、输出路径及close_pending；文件保存失败保留完整history（含原查询和回执）及底层文件/临时路径、发布和清理状态。最终读回失败明确published-unconfirmed，不删除目标；响应超限保留已保存local。关闭失败不丢弃读取结果或阻止后续文件保存，始终报告close_pending。

Bridge固定90秒预算，完整结果和CLI封套分别最多128 KiB，原回执/父历史/数组摘要继续遵守既有限制；模块/文件I/O/数据库打开关闭在预算之外，同步SQL/JSON不能硬实时打断。

未知ID的分页目录、独立回执文件和联合备份/跨设备导入、保留管理、来源认证及运行证据仍缺。本增量所有缺记录、跨项目、损坏历史、路径竞争、发布/读回/清理及关闭失败场景均未运行验证。
