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

## 模块独立校验

P0–P8 的独立测试门禁、Fixture、测试矩阵、通过阈值和报告模板分别维护在 [modules/](modules/README.md)。每个模块先在自己的替身依赖中验证，再进入 [模块接口与协接契约](../03-integration/04-module-interface-contracts.md) 定义的集成边。

指定客户端的真实验证规范见 [WaveMate 0.24.1 真实客户端独立验证](clients/01-wavemate-0.24.1-live-verification.md)。当前真实客户端门禁只允许使用用户指定的离线 WaveMate 产物。

开发波次、测试责任人、标准命令、真实形状数据和功能校验的统一执行入口是 [整体开发计划](../06-planning/00-overall-development-plan.md) 和 [统一测试、真实数据模拟与功能校验计划](../06-planning/03-test-data-and-functional-validation-plan.md)。

统一命令：

```powershell
pnpm build
pnpm run test:module -- P2 --isolated
pnpm run test:contract -- P2
pnpm run test:contract -- --edge IF-P2-P3
pnpm run test:wavemate-ui-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 --planemem-url http://127.0.0.1:38081 --webdriver-url http://127.0.0.1:4445
```

T0.1 必须把命令接入 CI；命令的退出码、JUnit、trace、health、Fixture 和 manifest 证据格式对所有模块保持一致。

每次修改任务、模块计划、协接矩阵或标准命令后，必须先运行 `pnpm run plan:audit`，确认 37 个任务和 P0–P8 文档仍然完整，再执行模块测试。

模块文档的公共模板和矩阵生成器位于 `tools/generate_module_verification_docs.mjs`。修改模块测试模板或公共断言时，先运行：

```powershell
node tools/generate_module_verification_docs.mjs
```

然后重新执行本目录和 `03-integration/` 的链接、接口边和追踪矩阵校验。

## 共享测试数据

`tenant-demo/workspace-demo/project-continuity/workitem-webhook` 是所有子方案的主 Fixture。它包含已确认决策、未确认候选、过期记忆、风险、附件、冲突和两个客户端 Session。

标准 Fixture、E2E、韧性、安全、性能、评测、发布和证据命令的参数、退出码和证据目录见 [统一测试命令与证据契约](command-runner-contract.md)。

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
