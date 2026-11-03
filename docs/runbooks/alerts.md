# PlaneMem 告警运行手册

## Plane 接收队列（仅开发，尚未启用）

2026-11-02 新增源码与 `deploy/observability/plane-inbox-alerts.yml`。没有编译、测试、规则校验、服务启动、迁移或部署证据，也没有配置 Alertmanager 接收者或发出通知。以下为拟部署行为与处置说明，不表示已经运行。Compose 本身尚未包含 Prometheus 服务；现有 scrape 示例已指向同网络中的模块化平台 `workctx:3000`，使用时需将规则文件挂载为 `/etc/prometheus/plane-inbox-alerts.yml`，并另行接通监控服务和通知投递。

`PLANE_INBOX_METRICS_ENABLED` 默认为 false；开启会在现有 `/metrics` 暴露整个数据库的队列统计，包括当前业务用户不可见、父项目已删除或受限分类的接收记录。这是运维数据；启用前必须限制无认证 `/metrics` 的网络访问。指标没有 tenant/project/event/actor/trace 标签或事件原文。需要事件详情时仍使用当前身份下的管理员队列，不能从运维指标推导某项目缺失或绕过分类权限。

采集通过独立单连接池执行只读事务，1 秒锁超时、5 秒语句超时；每轮完成后等待 30 秒再采集，不并发叠加。HTTP 抓取仅输出缓存。每轮的计数和时间来自同一 SQL 快照；超过 90 秒（单调时钟计时）、最新采集失败或尚无样本时，不输出队列计数与最早接收时间，snapshot_fresh=0。last_success_timestamp_seconds 保留最后一次成功的网关时间，不把过去结果伪装成当前结果。采集故障不修改业务状态、不触发重试，也不单独改变服务 readiness。

| 指标 | 含义 |
| --- | --- |
| planemem_plane_inbox_metrics_enabled | 是否显式开启；关闭时唯一导出的队列指标，值为 0 |
| planemem_plane_inbox_collection_success | 最近完成的采集是否成功；启动尚未采集为 0 |
| planemem_plane_inbox_snapshot_fresh | 最新采集成功且快照未超过 90 秒 |
| planemem_plane_inbox_last_success_timestamp_seconds | 最后一次成功采集的网关时间；没有成功为 0 |
| planemem_plane_inbox_snapshot_timestamp_seconds | 当前有效快照的数据库时间；无有效快照时缺失 |
| planemem_plane_inbox_events{state=…} | total/pending/applied/rejected/due/delayed/version_gap 当前数据库 gauge；不是累计 counter |
| planemem_plane_inbox_oldest_received_timestamp_seconds{state=…} | pending/due/version_gap/rejected 各集合最早接收时间；集合为空为 0，样本无效时缺失 |
| planemem_plane_inbox_worker_running | 本实例处理循环是否启动；不是数据库任务进度证明 |
| planemem_plane_inbox_worker_poll_failed | 本实例最近完成的轮询是否失败；不是事件失败数 |
| planemem_plane_inbox_worker_last_poll_timestamp_seconds | 本实例最近完成轮询时间（成功或失败）；尚未完成为 0 |

计数在数据库读取和文本导出中保留 BIGINT 十进制字符串；Prometheus 数值采样为浮点，不作为精确财务/审计计数。pending=due+delayed，version_gap 是 pending 子集，不应将各 state 相加。多个网关观察同一数据库，不应对副本的 gauge 求和；规则按实例评估，通知端应按部署/数据库及告警名分组去重，不能把不同数据库混合。运维总数与某个用户的可见项目概览不必相等。

规则默认阈值：采集不可用持续 2 分钟、worker 最近轮询失败持续 2 分钟、到期数至少 100 持续 5 分钟、存在接收超过 15 分钟的到期记录持续 10 分钟、存在接收超过 30 分钟且最后记录缺口的 pending 持续 10 分钟、存在 rejected 持续 10 分钟。worker 最近完成时间超过 10 分钟或循环未启动，持续 10 分钟才告警；启动时没有完成时间同样给予 10 分钟。数值告警均要求有效快照；采集失效使数值规则不再满足，不代表积压恢复，应同时检查采集与 scrape 告警。阈值是开发默认值，未用实际负载校准。

处置时先区分抓取故障、采集故障、worker 轮询故障与事件积压，再以授权管理员身份进入队列。到期查看 pending_state=due，缺口查看 pending_state=version_gap，拒绝查看 status=rejected。比较事件计划时间、最后错误和当前回执；接收年龄不是连续到期/连续缺口时长，前置版本可能已经到达，零积压不证明上游完整。保留原事件、delivery ID、人工重试键和回执。人工重试必须经现有明确确认流程，不能批量清空队列、改写版本或仅为消除告警而重新排队。监测只读，没有自动恢复动作。

Plane 版本缺口进一步排查可用只读 `getPlaneInboxDiagnosis` / `plane-events diagnose` / `get_plane_event_diagnosis` 或事件详情中的新标签页诊断入口。先区分可读的当前已提交基线、下一版本候选和目标同版本候选；无法判断基线时不替换为较低可见版本，不将空结果当作事件丢失。诊断只比较版本，不能据 next_version 自动重试。该入口仍只有源码，没有执行证据。

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
