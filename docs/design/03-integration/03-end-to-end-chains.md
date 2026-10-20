# 集成测试主链路

## Chain A：Plane 到 MCP

1. 在 Plane 创建 Project/WorkItem；
2. Webhook 验签和去重；
3. 生成 ProjectCreated/WorkItemCreated；
4. 写入 observed projection；
5. ai-memory capture/recall 创建可检索 memory page；
6. Context Compiler 生成 ContextPack；
7. MCP `get_work_item_context` 返回带来源结果；
8. 验证重复 Webhook 不重复。

## Chain B：跨客户端切换

1. Codex adapter 创建 Session；
2. 写入 prompt、tool、test 事件；
3. SessionEnd 触发 ai-memory session page/handoff；
4. WorkMesh 生成 HandoffRef；
5. Claude Code adapter claim-once；
6. 编译 Resume Pack；
7. Claude 更新 WorkItem；
8. Plane response/webhook 回写 observed/verified；
9. 新 Checkpoint 进入时间线。

## Chain C：离线与冲突

1. 断开网络；
2. SQLite Outbox durable enqueue；
3. 客户端重启；
4. 恢复后批量 drain；
5. 同时产生服务器版本变化；
6. 返回 409/ConflictDetected；
7. UI/CLI 解决；
8. 事件和审计均只产生一次。

## 证据

每条链保存 JUnit、trace、event ids、ContextPack hash、memory revision、Plane object IDs、audit IDs 和 release manifest。
