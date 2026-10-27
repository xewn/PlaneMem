# P02 会话原操作协议候选

2026-10-27，`p02-continuity-v1`。这是 WCP 会话事务候选，尚不是全部记忆连续性验收或工厂零件认证。

## 入口与作用域

`GET /v1/continuity/capabilities` 返回协议、固定 `endpoint_ref` / `configuration_digest`、可用动作和观察时间。必须配置 PostgreSQL、迁移 011 和两项固定服务配置。没有配置时 `durable_operation_proof=false`、动作列表为空。当前实现仅支持 `session.start`、`session.run`、`session.tool-call`、`session.checkpoint`、`session.end`。`evidence.write` / `handoff.create` / `handoff.claim` 尚未启用；WCP 会话交接与 ai-memory 页面交接保持不同合同。

`POST /v1/continuity/execute`、`query`、`close` 使用相同请求：

- `protocol_version`、`endpoint_ref`、`configuration_digest` 固定为绑定时服务配置。
- `operation_key`、`specification_digest`、`dispatch_attempt` 固定为 P02 原意图与发送轮次。
- `action`、`payload`、`expected_revision` 描述单个动作；start 不接受 expected_revision，其他动作要求正整数，且小于 9007199254740991。
- 外部 tenant/workspace/project、actor/client 使用既有 HTTP 请求上下文头。指纹绑定完整作用域、actor/client、实际动作/载荷/版本与原规格摘要；同键变更返回冲突。

请求和载荷上限 128 KiB。payload 仅接受该动作声明字段，不能覆盖 actor/client 或 HTTP 层控制字段。session.end 的 approval_ref 仅作为原意图证据保存；独立工厂审核仍由 P02 的设备权威端口验证。

查询和重放始终执行当前路由策略。HTTP 进程 Map 不再缓存这些路由的成功或空查询，避免旧 Unknown 遮挡后来提交的事实。

## 原结果与关闭规则

结果在标准 `schema_version/trace_id/source_refs/data` HTTP 信封中，data 为原 proof 或 null。proof 含完整原键/摘要/作用域/actor/client/配置/动作/轮次、`ConfirmedEffect` 或 `ConfirmedNoEffect`、原 receipt_ref/revision/result/source_refs/observed_at。外层 trace 属于当前查询，内层 proof 保持原操作事实。

同键同轮次 execute 返回原 proof。query 找不到记录时返回 null，表示 Unknown，绝不表示可以重发。close 在与 execute 相同的事务锁内：已有结果则返回原结果；否则追加永久 NoEffect 关闭记录。迟到的原轮次 execute 只能读回此关闭记录，不再执行动作。下一轮必须紧接上一轮，且上一轮必须是 NoEffect；已有成功后不能开新轮。关闭旧轮次不能覆盖新轮次结果。

## 数据库事务及旧入口

所有升级后的 WCP 会话写入口共用 PostgreSQL advisory transaction lock `(1867584,1)`。每次在锁内从数据库装载独立领域服务，动作及原回执在同一事务提交。失败丢弃该次领域实例，不会留下可重放的内存成功。run/tool 的会话版本变更与子记录插入也在同一事务内。

旧会话入口仍保留原 URL，改为上述事务执行；提供 idempotency-key 时保存原命令结果，重放不会返回后来变化的会话。旧原始 start key 按其原 scope/actor/client 装载，保证升级兼容。end 必须检查 expected version；原请求重放依赖命令回执，不能用任意错误版本重新结束会话。

候选采用整个会话域串行锁以优先验证正确性，吞吐优化尚未实现。部署必须排空旧写入进程，旧二进制不遵循新锁，不能混跑写入。MCP 请求不能放进此 PostgreSQL 事务来冒充跨系统原子性。

## 验证边界

离线事务 fixture 只验证编排规则；真实 PostgreSQL 双进程、故障注入、响应丢失及进程重启由 `tools/p02-continuity-remote.mjs` 在远端 k3s 验收，禁止本机运行。其 scope、身份和审核引用是明确测试夹具，不证明正式工厂身份/审批。same-Pod 数据卷与进程恢复不证明节点或 PVC 容灾。没有模型推理调用。
