# 模块集成与协接目录

本目录定义 P0–P8 之间如何交换稳定契约、事件、API、Fixture 和发布物。模块可以并行开发，但只有通过本目录规定的契约测试和交付包，才能合并到 `develop` 或进入发布候选。

## 文档索引

- [跨任务协接规范](01-task-handoff-contract.md)：任务级交付包、版本和 PR 门禁。
- [集成环境和合并策略](02-integration-environment.md)：分支、Compose、合并顺序和环境初始化。
- [集成测试主链路](03-end-to-end-chains.md)：Plane、跨客户端、离线冲突三条端到端链路。
- [模块接口与协接契约](04-module-interface-contracts.md)：P0–P8 的边界、公共上下文、错误、版本和直接依赖边。
- [模块契约测试矩阵](05-module-contract-test-matrix.md)：每条协接边由谁验证、保存什么证据、在哪个门禁运行。
- [WaveMate 0.24.1 MCP 协接契约](06-wavemate-mcp-contract.md)：指定离线客户端的配置、握手、scope、工具资源和证据规则。

## 维护规则

- 模块只能使用本目录和 `01-contracts` 声明的公开接口；不得读取其他模块的数据库、内部文件或未发布分支。
- 输入、输出、事件、Schema、权限和 Feature Flag 任一变更，都必须同时更新接口契约、测试矩阵、需求追踪和发布清单。
- 协接契约的提供方与消费方必须各有一条契约测试；只有提供方通过不能证明消费方兼容。
- 每条协接边都必须能由 `trace_id`、版本、事件 ID、revision 或 digest 关联到独立测试证据。
