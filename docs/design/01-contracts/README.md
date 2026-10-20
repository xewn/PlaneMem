# 公共契约目录

所有并行任务只能使用以下契约；任何私有 payload 都必须被拒绝。契约变更流程：ADR → Schema → generated SDK → Mock/Fixtures → compatibility test → downstream migration plan。

- [WCP API](wcp-api.md)
- [Canonical Event](canonical-events.md)
- [MCP Interface](mcp-interface.md)
- [Schema/version/error](schema-versioning.md)

共享最小元数据：`id`、tenant/workspace/project scope、version、etag、source_refs、classification、created_at、updated_at、trace_id。
