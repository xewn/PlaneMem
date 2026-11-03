# 发送队列持久暂停与恢复发送（开发契约）

2026-11-03：仅源码与文档，未编译、类型检查、测试、执行 CLI/Bridge/API、打开数据库、初始化控制表、执行迁移或发布。新增可选本地控制表的显式初始化源码，无 Gateway API/依赖变化；既有 SQLite 升级和 PostgreSQL 016–049 仍未执行，R-005 未完成。

## 目的和入口

档案恢复前需要协调原发送者。当前增量提供按项目持久暂停后续领取的基础，新增 `SqliteOutbox.readSendControl(scope,trace)`、`changeSendControl(input,trace)` 以及 CLI `outbox send-control`、`outbox pause`、`outbox resume`。暂停记录在队列文件内持久保存，所有使用本版 SqliteOutbox 的进程在每次领取事务中读取；不依赖进程内缓存。

仅展示语法，未执行：

```text
workctx outbox send-control --outbox existing.sqlite
workctx outbox pause --outbox existing.sqlite --json-file pause-request.json
workctx outbox resume --outbox existing.sqlite --json-file resume-request.json
```

send-control 只接受可选 --outbox，不接受 JSON。pause/resume 必须通过互斥 --json/--json-file 提供 `{expected_generation,reason}`，可选原 scope。首次读取未配置项目的 generation 为 null；首次暂停明确传 null，后续恢复/暂停必须复制刚读取的 generation。CLI 按命令设置 state，不接受 JSON 自带 state、额外字段、重复选项、额外位置参数、stdin 或 :memory:。文件/内联 JSON 上限16 KiB，文件稳定、常规且为有效 UTF-8，可带 BOM；原因必须非空且不超过1024个 UTF-16码元，不含控制字符或孤立代理项。

主程序使用当前配置三层范围，嵌入入口使用调用上下文；跨异步输入读取前复制配置，显式 scope 必须完全相同。参数和范围核验在打开队列前完成，三个命令均不需要访问令牌、不调用 Gateway、不执行 flush。只读状态以 readonly 模式打开已有库，暂停/恢复以 existing 模式打开已有库，不创建队列或升级 local_events。

## 持久控制和并发变更

可选 `main.local_outbox_send_control` v1 保存 schema_version、tenant_id、workspace_id、project_id、state、generation、reason、changed_at、trace_id，三层范围为主键。state 仅 running/paused；generation 为新的小写 UUID v4，changed_at 为规范 ISO，原原因/trace 保留。首次成功暂停在同一个 BEGIN IMMEDIATE 事务创建扩展表并写入该项目状态。正常构造、只读状态、原事件读取/导出和发送领取均不创建此表。

缺表或项目无行时，逻辑状态为 running，generation/reason/changed_at/trace_id 均为 null；缺表另标 storage=not-configured。已存控制行不得被当成未配置忽略：表名冲突、缺列、重复范围、未知行版本、非法状态/版本标识/时间/文本均拒绝相关操作。控制字段使用有界 SQL 投影，超长字段不进入 JavaScript。当前表只保存最新控制状态，不是不可修改的历史审计日志或身份授权系统。

Bridge 变更查询严格为 `{scope,state,expected_generation,reason}`。事务内先读取当前控制，再要求 expected_generation 精确相等，且目标 state 必须与当前不同。陈旧 generation 返回 OUTBOX_SEND_CONTROL_CHANGED，重复状态返回 OUTBOX_SEND_CONTROL_STATE_CONFLICT，均保留当时 current；不自动采用最新 generation、不合并或重放。每次成功变更产生新 generation，恢复时不删除行，避免 pause/resume 后旧请求重新匹配 null。更新保留范围，要求单行变化并完整读回控制记录后才提交。

失败保留原 query、已形成的 proposed（含新 generation）、事务阶段、回滚状态及 local_commit=not-committed/unknown。BEGIN 失败不回滚不属于本次的事务；提交抛错或回滚失败按 unknown 处理。调用方必须保存原请求/候选 generation 并重新读取控制，不能因报错自动恢复或重发。成功返回 local_commit=committed 和 previous_generation；提交成功后的关闭失败仅标 close_pending，不改称未提交。CLI 错误保留队列路径、原范围和关闭状态。

## 对发送的影响

pause 和 claim 都取得 BEGIN IMMEDIATE 写锁，因此本版领取要么在暂停提交前完成，要么在其后观察到暂停。`drainBatch(scope,...)` 在选择行之前遇到 paused 就返回 OUTBOX_SEND_PAUSED，带当前控制；无范围 `drain` 在 SQL LIMIT 之前排除所有暂停项目，继续选择其他项目，不被前面的暂停记录占满窗口。候选记录所属项目再次读取并校验控制，非法运行控制阻止本次领取；已被过滤的暂停项目不被解释为控制完整审计。缺控制表时沿用原领取行为。

控制只影响后续领取：暂停前已领取的整批工作仍可能调用 publisher、等待响应和结算，甚至在暂停已返回后才开始网络派发。暂停不撤销租约、不取消请求、不修改原 payload/身份/键/attempt/next_retry_at/状态；既有发送完成后可结算。入队、显式 retry 调度、reconcile 和 purge 沿用原行为；暂停不是禁止写入的维护锁或档案恢复锁。resume 只允许后续领取，实际发送仍由显式调用/既有发送循环触发，原重试与租约到期规则保持。

旧版本发送器、不使用本版 SqliteOutbox 的程序、其他队列文件及已离线副本不会遵守该控制，不能仅凭 paused 开始重灌档案。它不授予用户身份、不确认原投递、不证明所有发送进程已停止。不得把租约过期或 sending=0 作为跨进程停机证明。

## 状态读取和预算

readSendControl 在单次只读事务返回原范围、control、storage、observed_at，以及当前 sending 元数据统计。最多1000条，读取第1001条仅作超限判断；字段有界，不读取原正文。正常 in_flight.state=complete，返回 sending_records/active_leases/expired_leases/without_lease；无令牌记录独立计数。超过限制返回 limit-exceeded，非法ID/时间/令牌或重复ID返回 invalid-metadata，四项计数均为 null，不伪装为空或部分完整统计；控制状态仍可读取。暂停/恢复写入不依赖这些诊断，原记录数量大或元数据坏不会单独阻止暂停。

响应始终标 coordination=cooperating-claimers-only、sender_stopped=not-proven、server_delivery=not-checked。只读状态另外标 original_content=not-validated、database_integrity=not-audited；控制变更结果的 in_flight=not-inspected，需要另外显式读取。计数只是本地历史状态的当前观察，没有查询远端或核验原事件摘要。

控制读写在 Bridge 内使用固定30秒单调时钟预算，检查事务开始、读取/写入处理和提交前；已确认提交后不补报超时。同步 SQL 无法硬实时中断，文件输入/库打开关闭和调用方处理不在期限内。只读诊断 SQL 出错返回失败，不替换为零；rollback/close 信息单独保留。

## 与档案及后续恢复的关系

workctx.sync-outbox-archive v1 仍只保存23个原事件列，不包含控制表或暂停状态，也不会因控制发生变更而重写档案。导出本身不自动暂停；后续受控恢复必须独立处理目标暂停、原发送者协调、原租约与未知投递、全事务数据恢复和显式激活。当前没有档案恢复、跨版本停机协议、网络取消、全局写入锁或完整控制历史。

持久性、首次初始化/回滚、版本竞争、重复/未知提交、跨项目选择、暂停与领取顺序、旧在途结算、异常元数据/数量上限、CLI范围/参数/关闭失败等均待后续运行证据。此增量不将 R-005 或 T3.4 标记完成。

2026-11-03 后续增量：[受控档案恢复](outbox-restore-runtime.md) 已以原 paused generation 作为空项目恢复的事务前置条件。恢复保留暂停，未完成原行转为failed待处理，原历史与回执同事务保存；仅resume不会调度这些failed行。暂停仍不是旧发送者停机证明，非空合并/跨版本协调及自动激活另待补。
