# 跨任务协接规范

## 协接原则

任务之间只通过以下四类稳定物协接：

1. `packages/contracts` 生成的类型和 Schema；
2. `packages/events` 的 Canonical Event；
3. WCP REST/MCP/CLI 公共接口；
4. 测试 Fixtures、Mock Server、健康/版本端点。

禁止跨任务直接 import 内部实现、访问对方数据库、读取对方本地文件或依赖未发布的 `main` 分支。

## 任务交付包

每个任务进入集成分支时必须提交：

- artifact/image/package 版本和 checksum；
- API/事件/schema diff；
- migration、配置和 secret 列表；
- health/readiness/version 结果；
- 独立测试报告；
- 需求编号和下游影响；
- 回滚步骤和已知限制。

## 版本协接

- 契约包使用 SemVer；
- Event consumer 至少兼容当前和上一 Schema；
- API 使用 `/v1`；
- Feature Flag 默认关闭；
- 发布清单中固定所有输入版本；
- 不兼容变更必须提供双读/双写或 migration window。

## 典型链路

```text
T1.3 Webhook
→ T1.4 Dedup/Replay
→ T1.5 Projection
→ T2.3 Context Layers
→ T2.4 ContextPack
→ T3.2 Handoff
→ T4.2 MCP
→ T4.4 Client Adapter
→ T8.1 E2E
```

## 失败协接

- 上游不可用：返回 retryable error，写入 Outbox/重试队列；
- Schema 不兼容：构建失败，不进入集成；
- 权限拒绝：返回 deny reason，不产生事件副作用；
- 版本冲突：409 + ConflictDetected；
- 事件重复：ack 原 event，不再执行副作用；
- 下游落后：使用 cursor/replay，不通过直接数据库修复。

## PR 协接检查

- [ ] 输入/输出版本已写入 PR；
- [ ] 是否新增/修改事件；
- [ ] 是否新增迁移；
- [ ] 是否改变权限或敏感级别；
- [ ] 是否更新 Fixtures/Mock；
- [ ] 下游测试已运行；
- [ ] Feature Flag 和回滚已说明。
