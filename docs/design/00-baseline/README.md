# 基线设计目录

本目录定义产品目标、权威边界、领域对象、客户端切换、记忆系统、安全治理和架构决策。实现人员必须先确认本目录的权威来源和不可违反的不变量，再使用 `01-contracts/` 中的接口契约。

## 文档索引

- [范围与成功定义](01-scope-and-success.md)
- [Plane 权威与平台边界](02-authority-and-planes.md)
- [领域模型](03-domain-model.md)
- [客户端切换与交接](04-client-switch-and-handoff.md)
- [记忆系统](05-memory-system.md)
- [安全与治理](06-security-and-governance.md)
- [架构决策](07-architecture-decisions.md)

## 基线不变量

- Plane 管理项目和工作项事实；客户端只能通过公开 WCP 入口提出变更。
- ai-memory 的 Markdown 页面是长期记忆真源，SQLite 只作为可重建派生索引；适配和版本策略见 `vendor/`。
- AI 产生的建议保持 `proposed`，必须经过有权限的人确认后才能成为 `verified`。
- 所有跨模块写入携带 scope、版本条件、幂等键、trace 和来源引用；拒绝请求不得产生副作用。
- 任何基线变更都必须同步更新契约、任务计划、独立测试、协接矩阵和需求追踪。
