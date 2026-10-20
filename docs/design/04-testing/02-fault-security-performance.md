# 故障、安全和性能场景

## 故障

Plane 不可用、Webhook 重复/乱序/延迟、NATS 重启、PostgreSQL 重启、ai-memory 不可用、Hook 超时、客户端崩溃、网络断开、机器断电、附件上传失败、ContextPack 超时、Policy 不可用、消费失败、迁移失败、部署回滚。

## 安全

跨租户/项目、过期 token、scope escalation、越权 MCP Tool、敏感附件导出、外部网络、命令执行、提示注入、恶意文档、恶意 WorkItem、审计缺失、脱敏失败。

## 性能

- Context Resume p95 ≤5s；
- Plane event projection p95 ≤3s；
- online command ack p95 ≤1s；
- NATS backlog 可观测；
- ai-memory recall 和 WorkMesh query 都有预算；
- 失败时有界重试，不无限排队。

## 评测样本

包括多阶段项目、旧信息失效、多个相似文件、冲突计划、未确认推断、生产审批、多客户端和跨机器恢复。
