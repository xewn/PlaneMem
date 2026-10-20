# 运行手册入口

发布前必须提供：

- `doctor`：检查版本、连接、身份、token、hooks、MCP、Plane Webhook、ai-memory Adapter；
- `backup`/`restore`：WorkMesh DB、对象存储、ai-memory wiki/index 和配置；
- `replay`：按 event_id/cursor 重放；
- `reconcile`：Plane 与 WorkMesh projection 一致性；
- `finalize-session`：补齐无 SessionEnd Hook 的客户端；
- `rotate-secrets`：Keycloak、Plane、ai-memory token；
- `rollback`：按 release manifest 恢复；
- `purge/export`：遵循 Policy、Retention 和 Audit。

每个命令必须说明权限、输入、输出、幂等、失败恢复和审计记录。
