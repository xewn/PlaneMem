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

## Chain B：WaveMate MCP 连续工作

1. 启动或复用 WaveMate 0.24.1 离线包；
2. 通过 WaveMate 主机 MCP 管理 API 写入 PlaneMem Streamable HTTP 配置和固定 scope headers；
3. WaveMate 发送 `server/discover`、`initialize`、`notifications/initialized`，PlaneMem 返回无错误响应；
4. WaveMate 获取 `tools/list` 和 `resources/list`；
5. 用户在 WaveMate 中触发 `context_search` 或 `context_index`，验证工具响应、trace、audit 和幂等；
6. 读取 `resources/read`，确认只返回当前 project scope 的 `wcp://context/` 内容；
7. 探针结束后恢复 PlaneMem 直连配置并保存版本化报告。

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
