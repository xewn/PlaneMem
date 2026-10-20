# 测试设计总览

## 测试层

- 单元：纯逻辑和状态机；
- 契约：OpenAPI、AsyncAPI、JSON Schema、MCP、ai-memory Adapter；
- 集成：Compose 中真实 Plane/Postgres/NATS/Keycloak/Object Storage/ai-memory；
- E2E：跨客户端闭环；
- Resilience：重复、乱序、延迟、断网、重启、故障注入；
- Security：租户隔离、越权、注入、敏感导出、审计；
- Performance：Resume、事件延迟、命令确认、并发；
- Intelligence：Golden Context、来源、下一步、过期和幻觉。

## 共享测试数据

`tenant-demo/workspace-demo/project-continuity/workitem-webhook` 是所有子方案的主 Fixture。它包含已确认决策、未确认候选、过期记忆、风险、附件、冲突和两个客户端 Session。

## 测试不变量

- duplicate event = 0 duplicate effect；
- forbidden request = 0 side effect；
- durable outbox = 0 loss；
- ContextPack = permission filtered + source referenced + hash stable；
- proposal != verified；
- every mutation = audit + trace；
- schema incompatible = build failure。

## 质量目标

Context resume ≥95%；关键下一步 ≥95%；来源完整 ≥98%；过期混入 ≤2%；未确认误标 ≤1%；切换继续成功 ≥95%；重复事件副作用 0；越权副作用 0。
