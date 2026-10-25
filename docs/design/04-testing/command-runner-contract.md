# 统一测试命令与证据契约

本文件把 `docs/design/06-planning/03-test-data-and-functional-validation-plan.md` 中的标准命令落实为可执行入口。所有命令默认使用合成 Fixture 和离线替身；真实外部环境必须显式传入 `--live`，缺少 Docker、Compose、服务或模型时返回阻断状态并使用非零退出码，不能把替身结果伪装成线上通过。

## 命令矩阵

| 命令 | 作用 | 离线状态 | `--live` 状态 |
|---|---|---|---|
| `pnpm build` | 编译所有 workspace 包并验证公开导出边界 | `passed` | 不需要 |
| `pnpm run fixture:validate` | 校验共享 Fixture schema/版本 | `passed` | 不需要 |
| `pnpm run fixture:seed -- --fixture <name> --version <v>` | 生成固定 scope/seed | `passed` | 不需要 |
| `pnpm run fixture:events -- --scenario <name>` | 生成 duplicate/gap/delay 事件形状 | `passed` | 不需要 |
| `pnpm run fixture:backup -- --manifest <digest>` | 生成逐文件 hash 的恢复样本 | `passed` | 不需要 |
| `pnpm run test:e2e -- --chain plane-to-mcp` | Plane→Webhook→Projection→ContextPack→MCP 公开包边界链路校验 | `passed`（offline-fixture，真实 Projection/ContextPack/MCP 执行） | 服务未就绪则 `blocked` |
| `pnpm run test:e2e -- --chain plane-to-mcp --live --client wavemate --wavemate-report <report>` | 用 WaveMate 0.24.1 UI 报告作为真实客户端门禁，汇总同一 runtime 的 Plane Webhook/MCP transport 与客户端 `tools/call`、UI 完成、结果/trace、自动恢复 | 本地报告缺失或运行时不匹配则 `blocked` | 平台探针、WaveMate UI 报告或 `restore-verification.json` 任一不满足即 `blocked`；不启动其他客户端 |
| `pnpm run test:e2e -- --chain client-switch` | 内部客户端会话 fixture 的 Checkpoint→Handoff→Resume 公开包边界链路校验 | `passed`（offline-fixture，真实 Session/Memory/Continuation 执行） | 外部客户端/服务未就绪则 `blocked`；本轮 live 客户端只允许 WaveMate 0.24.1 离线包 |
| `pnpm run test:wavemate-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1` | 使用指定 WaveMate 0.24.1 离线包配置真实 Streamable HTTP MCP，校验 `server/discover`、`initialize`、`notifications/initialized` 和响应错误 | 无 WaveMate/Compose 时 `blocked` | WaveMate 主机 API、PlaneMem MCP 或交互式 `tools/call` 未就绪则 `blocked` |
| `pnpm run test:wavemate-ui-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 --planemem-url http://127.0.0.1:38081 --webdriver-url http://127.0.0.1:4445` | 使用 WaveMate 0.24.1 自带 WebDriver 创建新会话，输入只读 prompt，校验 k3s 代理捕获 `tools/call`、2xx 响应、UI `已完成` 和 trace，并恢复配置 | WebDriver、WaveMate 或 k3s 隧道未就绪时 `blocked` | 无 `tools/call`、JSON-RPC error、UI 未完成或配置未恢复时非零退出 |
| `pnpm run test:contract -- --edge IF-Px-Py` | 同时运行协接边提供方与消费方测试 | `passed`（固定 edge 形状） | 真实依赖未就绪则由对应集成门禁 `blocked` |
| `pnpm run test:resilience -- --scenario <name>` | 离线冲突、单依赖故障、进程重启、网络分区、依赖矩阵或依赖恢复后业务链路 | `passed`（fixture） | `dependency-down --live` 验证 RabbitMQ；`dependency-matrix --live --services <csv>` 已验证 8 个 Compose 依赖逐一停止/恢复和 runtime readiness；`process-kill --live` 已验证 Workctx SIGKILL 后恢复；`network-partition --live` 已验证 ai-memory 断网、带 DNS alias 重连、Workctx 重建和依赖连通性恢复；`business-recovery --live --services <csv>` 已在 PostgreSQL/NATS/RabbitMQ/ai-memory 恢复后重新执行 12 步 Plane→MCP 平台链路；RC 依赖业务恢复仍是门禁 |
| `pnpm run test:vulnerability -- --images "<csv>"` | 记录固定 Trivy 版本、逐镜像 JSON 和汇总状态 | `informational`（可选） | 后续不纳入标准执行顺序；已有 `blocked` 报告只保留为历史记录，不触发镜像升级、豁免或功能发布阻断；PowerShell 下 CSV 必须整体加引号 |
| `pnpm run test:security -- --module <P>` | scope、token、deny、副作用校验 | `passed`（fixture） | `security-live-opa-current2` 已在 OPA overlay 下验证 scope 隔离、policy deny 和零副作用；RC 生产身份和审计留存仍是门禁 |
| `pnpm run test:identity-audit -- --live` | Keycloak password grant/Bearer claims、OPA REST decision、运行时审计发射/持久化和 PostgreSQL 审计表 round trip | `passed`（fixture） | `p6-identity-audit-live-current8` 已验证 Keycloak token、OPA decision log、runtime metrics 递增、按 trace 持久化/清理和 `wcp_audit_records` 合成行 round trip；RC 目标环境的生产配置、留存/导出策略仍待复核 |
| `pnpm run test:performance -- --profile release` | 检查性能阈值和报告格式 | `simulated`，不产生性能结论 | runtime live probe 已测量 HTTP search p95；数据库/NATS 指标和生产负载曲线仍是 RC 门禁 |
| `pnpm run test:evaluation -- --dataset golden-context` | Golden 评测和阈值报告 | `passed`（fixture model） | 模型/人工抽样未配置则 `blocked` |
| `pnpm run test:release -- --scenario restore-rollback` | Release/恢复/回滚报告形状 | `simulated`，不产生 RC 结论 | Compose live 已验证 PostgreSQL、SQLite、ai-memory、对象存储归档恢复；RC 节点恢复、恢复后业务 Smoke 和生产 Smoke 未齐时仍不得视为完整 RC 通过；漏洞报告不作为阻断条件 |
| `pnpm run test:sqlite-live -- --run-id <id> --output <dir>` | 文件型 SQLite outbox 关闭、备份、重开、恢复和 exactly-once drain | `passed`（本地真实 SQLite 文件） | RC 节点恢复和恢复后业务 Smoke 仍需在目标环境执行 |
| `pnpm run plan:audit` | 校验 37 个任务、P0–P8 文档、协接矩阵和标准命令 | `passed` 或 `failed` | 只报告外部门禁，不替代真实部署测试 |
| `pnpm run rc:readiness -- --offline` | 汇总计划、Compose 离线健康、部署文件和外部门禁 | `simulated`，本地门禁可审计 | Docker/Helm/kubectl/服务缺失则 `blocked` |
| `pnpm run evidence:bundle -- --module <P> --run-id <id>` | 归档 environment、seed、health、trace、failure-cases 和 manifest | `passed`（bundle 完整） | 是否通过由输入报告决定 |

所有命令支持 `--output <directory>`。输出必须是 JSON 或 JSONL，至少包含 `status`、`run_id`、`mode`、`trace_id` 或等价关联字段、`source_refs`、`external_gates`。命令失败必须返回非零退出码；`blocked` 表示需要外部状态，不等于通过。

真实 E2E 命令会先探测固定 Compose 覆盖层的 10 个服务，并对传输 runtime 执行 health/readiness/version、幂等 context index、scope search、签名 Plane Webhook 和 MCP JSON-RPC HTTP 探针；ai-memory 真实服务探针使用 `pnpm run test:memory-live`，覆盖 Markdown page 写入、FTS 命中、删除和删除后零命中。WaveMate 握手探针和 UI 探针均使用 `E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1`，通过 WaveMate 主机 MCP 管理 API 临时写入转发 URL；UI 探针再通过内置 WebDriver 输入只读 prompt，捕获 `server/discover`、`initialize`、`notifications/initialized`、`tools/list`、`tools/call`、成功响应和 UI 完成状态，结束时自动恢复本地 Compose `http://127.0.0.1:3000/mcp`，并写出 `restore-verification.json`；恢复失败时返回 `blocked`。UI 工具调用门禁已在三节点 k3s 目标拓扑通过；RC 级依赖故障和生产 Smoke 仍可作为外部门禁，不能把本地拓扑结果升级为完整生产 E2E 通过。最新成功复测报告位于 `artifacts/command-reports/wavemate-k3s-ui-current4/`，`wavemate-k3s-ui-current3/` 保留上游过载负面复测，`wavemate-k3s-ui-current2/` 为此前成功复测。SQLite/跨存储恢复证据位于 `artifacts/command-reports/release-transport-sqlite/`；运行 Helm 相关命令时需确保 Helm v3.9.0 已在 PATH 中。

## 证据目录

```text
artifacts/test-reports/<module>/<run_id>/
  module-verification.yaml
  environment.json
  seed.json
  health.json
  trace.jsonl
  failure-cases.json
  test-summary.txt
```

模块报告只能在独立测试、契约测试和命令报告都存在后标记 `passed`。性能、真实集成、备份恢复和生产 Smoke 若仍是 `simulated` 或 `blocked`，必须保留状态并阻断功能 RC，不得手工改为 `passed`。漏洞扫描报告按[功能验收范围调整](../05-release/07-functional-acceptance-scope.md)处理，不参与功能阻断。
