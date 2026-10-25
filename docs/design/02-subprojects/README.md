# 子方案设计目录

本目录把平台拆分为 P0–P8 九个可并行开发的子方案。每个子方案都有目标、边界、依赖、任务清单、测试门禁、协接方和交付条件；任务级设计位于 `tasks/`，实现级模块计划位于 `../06-planning/modules/`。

## 子方案索引

- [P0 统一契约与开发平台](P0/README.md)
- [P1 Plane 连接器与工作图谱](P1/README.md)
- [P2 上下文、文件、记忆与 ContextPack](P2/README.md)
- [P3 会话、检查点、交接与离线同步](P3/README.md)
- [P4 统一 MCP、REST、CLI 与客户端连接器](P4/README.md)
- [P5 Web 工作台](P5/README.md)
- [P6 安全、治理与观测](P6/README.md)
- [P7 搜索和智能能力](P7/README.md)
- [P8 统一发布、质量与私有化交付](P8/README.md)

## 任务与交付规则

- [T0–T8 任务设计索引](tasks/README.md)列出全部 37 个独立任务。
- 每个任务必须先确认公开输入契约，再编写失败测试、实现、运行独立测试并生成版本化证据。
- 子方案之间只能通过 `03-integration/` 声明的接口、事件、Fixture 和 Release Manifest 协接。
- 任何任务完成都必须同步更新对应模块计划、独立测试文档、协接矩阵和 `FILE_INDEX.md`。
