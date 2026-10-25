# 模块独立测试目录

本目录为 P0–P8 提供可独立运行、可独立验收的测试与校验规范。每个模块必须先在自己的 Fixture、Mock/Compose 替身和固定版本依赖中通过本文档，才能进入 `docs/design/03-integration/` 定义的集成阶段。

## 文档索引

- [P0 统一契约与开发平台](P0-independent-verification.md)
- [P1 Plane 连接器与工作图谱](P1-independent-verification.md)
- [P2 上下文、文件、记忆与 ContextPack](P2-independent-verification.md)
- [P3 会话、检查点、交接与离线同步](P3-independent-verification.md)
- [P4 统一 MCP、REST、CLI 与客户端连接器](P4-independent-verification.md)
- [P5 Web 工作台](P5-independent-verification.md)
- [P6 安全、治理与观测](P6-independent-verification.md)
- [P7 搜索和智能能力](P7-independent-verification.md)
- [P8 统一发布、质量与私有化交付](P8-independent-verification.md)

## 执行顺序

P0 的契约/Fixture 门禁先行；P1、P2、P6 可以使用固定替身并行验证；P3 在 P2 的 ContextPack 契约可用后验证；P4、P5、P7 依赖相应公开接口；P8 汇总全部模块报告执行统一集成、恢复、回滚和上线 Smoke。

所有模块的命令、证据目录、失败处理和报告字段必须保持一致；模块特有断言只写在对应模块文档中。
