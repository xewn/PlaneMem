# 开发计划目录

本目录把整体计划、P0–P8 模块计划和统一测试/真实数据/功能校验计划集中维护。设计基线、任务详细设计、独立测试、协接契约和发布手册仍是本计划的约束来源。

## 计划入口

- [整体开发计划](00-overall-development-plan.md)：波次、38 个子任务、统一 Gate 和整体完成定义。
- [统一测试、真实数据模拟与功能校验计划](03-test-data-and-functional-validation-plan.md)：TEST-001–TEST-018。
- [当前开发与验证状态](04-current-verification-status.md)：记录最新模块测试、契约审计、协接校验和 RC 外部门禁状态。
- [开发计划完成审计](05-completion-audit.md)：按需求、模块、协接、部署和发布门禁逐项判定当前证据。

## 模块计划

- [P0 统一契约与开发平台](modules/P0-development-plan.md)
- [P1 Plane 连接器与工作图谱](modules/P1-development-plan.md)
- [P2 上下文、文件、记忆与 ContextPack](modules/P2-development-plan.md)
- [P3 会话、检查点、交接与离线同步](modules/P3-development-plan.md)
- [P4 统一 MCP、REST、CLI 与客户端连接器](modules/P4-development-plan.md)
- [P5 Web 工作台](modules/P5-development-plan.md)
- [P6 安全、治理与观测](modules/P6-development-plan.md)
- [P7 搜索和智能能力](modules/P7-development-plan.md)
- [P8 统一发布、质量与私有化交付](modules/P8-development-plan.md)

## 计划维护规则

- 新增、删除或拆分子任务时，必须同时更新整体计划、所属模块计划、任务索引、测试计划和追踪矩阵。
- 任务的实际输出、测试命令、Fixture 版本、协接边和完成证据发生变化时，必须在同一提交更新对应计划。
- 计划只描述可执行步骤和证据；具体字段和接口以 `01-contracts`、`03-integration` 和任务设计为准。
