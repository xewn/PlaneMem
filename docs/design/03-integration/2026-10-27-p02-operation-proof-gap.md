# P02 连续性原操作证明：实际缺口与实现边界

2026-10-27。基于PlaneMem c9fae3636ca7e61c81ddd01116c81c8103de4dd0与其已锁定ai-memory子模块11ab1003d9ef3788f5fc40b87fff54abf7f17dc0源码审计。本记录不代表这些版本已通过P02真实连续性验收。

## 已修正的交接结果误判

ai-memory的`memory_handoff_accept`成功返回`status=claimed`及包含原handoff id的对象；`none_pending`、`consumed_by_hook`和空handoff不证明本次请求成功。原MCP适配器把所有非claimed状态映射为already_claimed，会让消费者继续使用没有领取证明的上下文。

当前候选要求claimed和精确handoff id同时成立，否则返回MEMORY_HANDOFF_UNCONFIRMED（HTTP 503，retryable=false）；这不是NoEffect证明。内存测试提供方只向同一client重放already_claimed，其他client返回HANDOFF_ALREADY_CLAIMED（HTTP 409）。原测试中不同client也成功的断言已改为同client重放，并新增不同client反例。

三个行为反例及HTTP状态映射RED→GREEN；P2与纯P4网关共20项离线测试、TypeScript类型检查、改动文件格式检查通过。未运行本地Host或数据库；本修复尚未部署，也未实现持久原操作查询。

## 必须补齐的持久性

- `ApiGateway.idempotentResponses`为进程内Map，成功缓存不能代替数据库证明，也不能在重放时跳过当前策略。
- `SessionService.startSessionAsync`先写内存/幂等Map再saveSession，持久化失败后同进程可能返回不存在于数据库的会话。run/tool-call/checkpoint/end也有内存先行或分步持久；必须把原操作回执与对应聚合事实作为同一数据库事务提交。
- `PostgresSessionStore.saveSession`的version≤新版本条件不足以证明多个写入者只有一个胜出；新协议必须采用已读版本CAS/适当数据库锁，并处理旧HTTP写入口的并发影响。
- context.index先调用外部memory，再写搜索/数据库投影；不能把后一步失败解释为没有外部副作用。MCP capture使用trace派生create_only路径有一定幂等性，但仍须证明原结果而非读取最新页面替代原版本。
- ai-memory交接创建没有调用方operation key，领取后普通列表只列open对象；当前公开合同不能证明响应丢失后的原创建/领取结果。需要上游公开持久回执增量或等价的、逐动作可验证的恢复合同，不能直读其SQLite/内部wiki来补证明。

## 后续协议必须保持的条件

每条操作固定完整外部scope、actor/client、动作、原operation key、规格/请求摘要、发送轮次与原结果。查询保留原external id、revision、source refs和证明时间；不能回传最新会话状态代替历史结果。P02内部四维scope及设备映射仍由P02拥有，外部Project/Session权威留在PlaneMem。

Unknown/404/空列表不能转NoEffect。NoEffect若允许重试，还必须永久关闭原发送轮次，使迟到的原发送不能在证明之后产生副作用；仅声明“查询时尚不存在”不够。旧轮次证明不能作用于下一轮。外部MCP副作用跨越PostgreSQL事务，必须在实际外部系统取得对应操作证明才能宣称可恢复。

能力探测逐动作报告实际可用的持久执行/原操作查询合同。旧health、内存提供方或测试替身不能启用真实连续性。P02端口候选协议名为`p02-continuity-v1`；本轮已增加五种 WCP 会话动作的公开 execute/query/close 及 PostgreSQL 原回执，详见[会话协议候选](p02-session-operation-protocol.md)。外部 ai-memory 三种动作仍未实现持久原操作证明。

WCP 子阶段事实：31 项选定纯模块测试和 1 项原会话生命周期测试通过，TypeScript 类型/构建/格式检查通过。远端 232 的 session-r3 在真实 PostgreSQL 完成 10 项验收：五动作原回执、同键与作用域冲突、双进程争领、receipt/run 插入故障原子回滚、NoEffect 关闭与迟到发送、主动中断响应后的原结果查询、新旧入口并发和双 API 进程重启。r1 验收脚本模式值错误、r2 JSON 二次编码失败均保留；修正为驱动 json 参数，并从事务内存储读回首次响应，使后续查询保持完全相同的 proof JSON。

P02实际客户端子阶段：113项P02离线检查与远端232/client-r2的8项实际ABP/PlaneMem/PostgreSQL检查通过，覆盖五项session动作、原结果恢复、明确close后重试、双Host争领、超时和双方重启。能力路由逐次检查原回执表，缺表时返回不可用；实际缺表探针通过。修复.NET自动traceparent覆盖固定X-Trace-Id的集成缺口，明确操作关联号优先。

下一步：ai-memory公开操作恢复、非空召回及八动作端到端验收，然后岗位消费者。全部模块回归另行记录，不以34项选定纯测试代替。scope/身份/审批仍为明确夹具，同Pod数据卷不证明节点容灾。上游Rust子仓仍只读，gitlink未改变；本候选不推送到上游生产分支。Task3未完成。
