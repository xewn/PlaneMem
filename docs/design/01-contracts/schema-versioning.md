# Schema、版本和迁移契约

## 版本规则

- API：`/v1`；兼容新增字段，不兼容变更升主版本；
- Event：`schema_version`，消费者至少兼容当前和上一版本；
- MCP：协议版本和 WCP 版本独立；
- 数据库：expand → migrate → contract；
- ai-memory：固定 tag/commit/digest，适配器拥有兼容矩阵。

## 兼容性

- 新增可选字段：minor；
- 修改类型、语义、必填字段或删除字段：major/迁移；
- 事件字段只追加，不重命名覆盖；
- 迁移前运行 schema diff、数据预检和备份；
- 发布清单记录所有版本和迁移号。

## 生成物

每次契约变更必须更新 OpenAPI、AsyncAPI、JSON Schema、TypeScript SDK、Mock Server、Fixtures、契约测试和 docs/traceability。
