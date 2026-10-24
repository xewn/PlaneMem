# PlaneMem 告警运行手册

## trace 缺失或断链

按 `trace_id` 检查入口 Gateway、Policy Decision、AuditRecord 和下游 span。入口必须
重新生成 child span，不能覆盖上游 trace。若拒绝请求没有 audit-deny，先停止流量并
检查 P6 middleware。

## policy deny 之后仍有副作用

使用同一 trace 查询 outbox、event ledger、artifact version 和 ai-memory audit。Policy
拒绝应只有一条 `result=denied` 审计记录；发现写入时关闭入口 feature flag，恢复最后
一个已知版本，并保留原始 trace 和事件差异。

## 审计写入失败

关键写入按 fail-closed 处理，返回 retryable 错误但不重复业务 effect。恢复 audit-service
后用 idempotency key 重放审计，不重放已经提交的领域写入。

## 服务 degraded/down

先检查 `/health`、`/ready`、版本和 migration checksum，再检查 OTel exporter、数据库
连接和队列延迟。只有所有关键检查为 `ok` 才能把 release health 标为 ready。
