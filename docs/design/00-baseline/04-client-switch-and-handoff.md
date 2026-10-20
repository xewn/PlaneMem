# 客户端切换与恢复设计

## 正常工作流

1. 客户端注册能力并创建 Session；
2. 读取 Project、WorkItem、Plan、Decision、Risk、Artifact 和上一个 Checkpoint；
3. 生命周期 Hook 将用户提示、ToolCall、测试和会话边界发送到 ai-memory；
4. WorkMesh 同时记录标准事件、权限决策和操作审计；
5. SessionEnd 触发 ai-memory 生成 session page 和 claim-once handoff；
6. WorkMesh 生成不可变 Handoff 引用和 ContextPack；
7. 新客户端声明能力和上下文预算；
8. Gateway 按权限返回 Resume Pack；
9. 新客户端接受 Handoff 后继续执行；
10. 新结果通过同一 Gateway 回写 Plane 和 WorkMesh。

## Handoff 内容

- `handoff_id`、`source_session_id`、`work_item_id`；
- completed、in_progress、next_actions；
- decisions、risks、open_questions、required_confirmation；
- artifact_refs、test_results、source_refs；
- owner、claim_status、claimed_by、claimed_at、expires_at；
- ai-memory `handoff_id`/page path 和 memory revision。

## claim-once 规则

同一自动 Handoff 只能被一个目标 Session claim。手工 Handoff 优先；旧的自动 Handoff 可以过期但不可篡改。领取失败返回已被领取的会话和可读原因。

## 降级

- MCP：Resources/Tools/Prompts；
- REST：完整管理和命令面；
- CLI：本地 resume/checkpoint/handoff/sync；
- Markdown：客户端不支持协议时的最小恢复包；
- 无 SessionEnd Hook 的客户端：提供显式 `finalize-session`。

## 恢复失败

ContextPack 生成超时、记忆服务不可用、Plane 不可用或权限服务异常时，必须返回可诊断错误、trace_id、retryable 和最近可用版本；不允许返回未经授权的旧数据。
