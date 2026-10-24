# P8 统一发布、质量与私有化交付 独立测试与校验规范

> 本文件是 **P8** 的独立测试门禁。实现人员只需要依赖本文列出的 Fixture、公开契约和替身，不得等待其他未完成模块的内部实现。

## 1. 测试范围和责任

- 子方案：`P8 统一发布、质量与私有化交付`。
- 覆盖任务：T8.1–T8.3。
- 需求追踪：R-005、R-008、R-010、R-011、R-013。
- 模块边界：集成/E2E/故障/性能编排、Compose/Helm、Release Manifest、备份恢复和回滚；SBOM/漏洞只作可选记录。
- 产物责任：ReleaseManifest、SBOM、安装报告、恢复报告、回滚报告、上线 smoke。

任务设计入口：

- [t8.1-integration-e2e-resilience](../../02-subprojects/tasks/t8.1-integration-e2e-resilience.md)
- [t8.2-compose-helm](../../02-subprojects/tasks/t8.2-compose-helm.md)
- [t8.3-release-rollback](../../02-subprojects/tasks/t8.3-release-rollback.md)

## 2. 独立运行边界

### 2.1 允许依赖

所有 P0–P7 版本化 artifact、Schema、migration、Fixture、Feature Flag 和 runbook。外部依赖必须通过版本固定的 HTTP/MCP Mock、事件 Fixture、Testcontainers/Compose 服务或内存替身提供；测试不得直接读取其他模块的数据库、工作目录或内部类。

### 2.2 禁止依赖

- 不依赖 `develop` 上尚未发布的包、浮动镜像或未冻结的远端数据；
- 不依赖其他模块的私有表、私有文件、私有事件处理器或测试顺序；
- 不把失败重试当作成功证据，必须保存第一次失败的请求、trace 和状态差异；
- 不用真实敏感数据，Fixture 中的 token、secret、附件和 memory 内容必须是合成值。

### 2.3 标准命令

P8 必须提供以下命令入口。命令必须在干净工作区、固定 Node/pnpm 版本和锁文件下运行，并返回非零退出码来阻断失败。

```powershell
pnpm run test:module -- P8 --isolated
pnpm run test:contract -- P8
pnpm run test:module -- P8 --isolated --reporter=junit
pnpm run test:e2e -- --chain plane-to-mcp
pnpm run test:e2e -- --chain client-switch
pnpm run test:wavemate-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 --run-id wavemate-live-current --output artifacts/command-reports/wavemate-live-current
pnpm run test:wavemate-ui-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 --wavemate-url http://127.0.0.1:3080 --planemem-url http://127.0.0.1:38081 --webdriver-url http://127.0.0.1:4445 --run-id wavemate-k3s-ui-current --wait-ms 90000 --output artifacts/command-reports/wavemate-k3s-ui-current
pnpm run test:release -- --scenario restore-rollback
pnpm run rc:readiness -- --offline
pnpm run release:manifest -- --version <version> --git-sha <sha> --output artifacts/test-reports/P8/<run_id>/release-manifest.yaml
pnpm run sbom:generate -- --output artifacts/test-reports/P8/<run_id>/sbom.cdx.json
# 漏洞扫描已冻结，不纳入标准执行顺序
pnpm run test:resilience -- --live --scenario dependency-matrix --services postgres,redis,nats,rabbitmq,keycloak,minio,ai-memory,otel-collector --run-id <run_id> --output artifacts/command-reports/<run_id>
pnpm run test:resilience -- --live --scenario process-kill --run-id <run_id> --output artifacts/command-reports/<run_id>
pnpm run test:resilience -- --live --scenario network-partition --run-id <run_id> --output artifacts/command-reports/<run_id>
pnpm run test:resilience -- --live --scenario business-recovery --services "postgres,nats,rabbitmq,ai-memory" --run-id <run_id> --output artifacts/command-reports/<run_id>
```

命令参数、离线/真实环境语义、退出码和证据目录约定统一见[测试命令执行契约](../command-runner-contract.md)。本机集成验证使用基础 Compose 文件叠加固定 digest 的
`deploy/compose/docker-compose.local-test.yml`，已覆盖 Docker/数据库/Plane/ai-memory/对象存储/消息
队列/Workctx 的真实容器健康、迁移、API 和依赖恢复；证据见
[`20261021T1440-compose-full-plane`](../../../../artifacts/test-reports/compose/20261021T1440-compose-full-plane/)。
当前 `restore-rollback --live` 已在同一 Compose 环境完成 PostgreSQL、ai-memory 和对象存储的备份归档、恢复抽取与清理验证；证据见
[`release-transport-sqlite`](../../../../artifacts/command-reports/release-transport-sqlite/)。该命令在 Compose 恢复范围内返回 `passed`，含 PostgreSQL 122 张表、SQLite 2 行关闭重开、ai-memory 和对象存储；安全修复后的正式 runtime 归档已通过 Trivy 0.58.1 扫描（0 个漏洞），证据见 [`vulnerability-verification.txt`](../../../../artifacts/offline-images/security-fixed/vulnerability-verification.txt)。当前 WaveMate k3s 发布镜像又生成了 26 组件 CycloneDX SBOM，并按 `CRITICAL,HIGH`、`ignore-unfixed` 策略完成 Trivy 0.58.1 扫描，证据见 [`sbom-wavemate-current4`](../../../../artifacts/command-reports/sbom-wavemate-current4/) 和 [`trivy-wavemate-current4`](../../../../artifacts/command-reports/trivy-wavemate-current4/)。RC 节点恢复、所有依赖镜像的完整 SBOM 策略、生产身份、负载和生产 Smoke 仍待执行；本机 Helm v3.9.0 和目标 k3s Helm 门禁已通过。
随后对本地 Compose/发布拓扑的 10 个镜像形成历史报告，分别见 [`trivy-images-current4`](../../../../artifacts/command-reports/trivy-images-current4/) 与 [`p8-vulnerability-scan-command-current16`](../../../../artifacts/command-reports/p8-vulnerability-scan-command-current16/)，其中的 [`remediation.json`](../../../../artifacts/command-reports/p8-vulnerability-scan-command-current16/remediation.json) 只作 informational 记录。该报告不再触发镜像升级、豁免审批或功能 RC 阻断。
本地 Compose 与三节点 k3s 已执行签名 Plane Webhook→Projection→MCP HTTP JSON-RPC transport 探针；
Compose runtime 还完成 RabbitMQ 停止/恢复、8 个依赖逐一停止/恢复、scope/policy deny 和 100 请求并发 p95 探针。指定
WaveMate 0.24.1 离线包的真实 MCP 会话和 WebDriver UI `tools/call` 均已由专用探针覆盖；RC 级
数据库/NATS/Keycloak/OPA 联动、生产负载和生产 Smoke 仍必须在 RC 环境执行；其他镜像漏洞策略不再纳入功能验收。
当前复测另外保存了 [`release-live-current12`](../../../../artifacts/command-reports/release-live-current12/)、[`resilience-matrix-current12`](../../../../artifacts/command-reports/resilience-matrix-current12/)、[`resilience-business-current12`](../../../../artifacts/command-reports/resilience-business-current12/)、[`security-live-current12`](../../../../artifacts/command-reports/security-live-current12/)、[`performance-live-current12`](../../../../artifacts/command-reports/performance-live-current12/) 和 [`wavemate-live-current13`](../../../../artifacts/command-reports/wavemate-live-current13/)；恢复、8 个依赖矩阵、4 个依赖业务 Smoke、安全零副作用、50 请求 search p95=39.345ms 以及 WaveMate 0.24.1 handshake 均为 `passed`，但仅覆盖本地 Compose/transport 边界。

当前自动化映射：

| 测试 | 文件 | 覆盖 |
|---|---|---|
| P8-C01/T8.2 | `tests/p8/t8-release-deploy.test.ts` | manifest digest、审批和部署拓扑边界 |
| P8-C02/T8.2 | `tests/p8/t8-release-tooling.test.mjs` | Compose doctor/health、无占位符 Release Manifest、CycloneDX SBOM、Helm 模板分隔符 |
| P8-C03/T8.3 | `tests/p8/t8-release-tooling.test.mjs` | RC readiness 汇总本地门禁和 Docker/Helm/kubectl/live-services 阻断原因 |
| P8-E01/T8.1 | `tests/p8/t8-release-deploy.test.ts`、`tools/run-functional-tests.mjs --chain plane-to-mcp` | 实际执行 Plane event→Projection→ContextPack→MCP Resource、trace/source_refs、重复事件和 scope fence |
| P8-E02/T8.1 | `tests/p8/t8-release-deploy.test.ts`、`tools/run-functional-tests.mjs --chain client-switch` | 实际执行内部客户端会话 fixture 的 session→ai-memory capture→checkpoint→handoff claim→resume、memory page ref 和父子 session 关系；本轮不启动外部 Codex/Claude 进程 |
| P8-E05/T8.1 | `tests/p8/t8-wavemate-live.test.mjs`、`tools/run-wavemate-live-probe.mjs`、`pnpm run test:wavemate-live -- --live` | 使用 WaveMate 0.24.1 离线包配置真实 Streamable HTTP MCP，校验 `server/discover`、`initialize`、`notifications/initialized`、scope headers、响应错误和配置恢复 |
| P8-E06/T8.2 | `tests/p8/t8-k3s-wavemate-evidence.test.mjs`、`artifacts/test-reports/k3s/20261023T0005-wavemate-audit/`、`artifacts/test-reports/k3s/20261022T2038-wavemate-ui/` | 校验三节点 k3s 离线镜像归档、无 tag digest 别名、Helm revision 24（审计持久化失败回归）和历史 revision 22、跨节点 Pod imageID、12 步平台探针、WaveMate k3s 握手和 WebDriver UI `tools/call`/完成状态；另执行真实节点 `cordon → 删除单个 Pod → rollout → uncordon` 并复跑 12 步平台探针；第一次模型过载失败作为负面证据保留 |
| P8-E03/T8.2 | `tests/p8/t8-live-platform-probe.test.mjs`、`tools/live-platform-probe.mjs`、`tools/run-functional-tests.mjs --live` | 对真实 Compose/k3s runtime 执行 health/readiness/version、幂等 context index retry、scope search、签名 Plane Webhook、MCP JSON-RPC tools/resources；RC 依赖仍是外部门禁 |
| P8-E04/T8.1 | `tests/p8/t8-live-gates.test.mjs`、`tools/run-resilience-tests.mjs --live` | Compose RabbitMQ stop/start、8 个依赖矩阵 stop/start、Workctx SIGKILL 重启、ai-memory 网络分区/带 alias 重连/Workctx 重建、PostgreSQL/NATS/RabbitMQ/ai-memory 恢复后各执行 12 步 Plane→MCP 业务探针；current12 复测证据已保存，RC 生产依赖业务恢复仍是外部门禁 |
| P8-S01/T8.1 | `tests/p8/t8-live-gates.test.mjs`、`tools/run-security-tests.mjs --live` | runtime scope 隔离、policy deny、拒绝请求零副作用；Keycloak/OPA 和持久审计仍是外部门禁 |
| P8-P01/T8.1 | `tests/p8/t8-live-gates.test.mjs`、`tools/run-performance-tests.mjs --live` | 既有 100 请求/8 并发和 current12 的 50 请求 runtime HTTP search p95 均通过；数据库/NATS 指标和生产负载曲线仍是外部门禁 |
| P8-R01/T8.3 | `tools/run-release-tests.mjs --scenario restore-rollback --live`、`tools/run-sqlite-live-probe.mjs` | Compose live 的 PostgreSQL 122 张 public 表、SQLite 2 行关闭重开、ai-memory 归档、对象存储归档均完成 hash 和 restore 校验；RC 节点和恢复后业务校验仍是外部门禁 |
| P8-R02/T8.3 | 同上 | 未审批回滚拒绝、已审批回滚步骤 |
| P8 contract | `tests/contract/p8-release-contract.test.mjs` | release package、Compose、Helm 和 values schema |

## 3. 固定 Fixture 和环境

clean install、upgrade、故障注入、备份包、旧版本 manifest、生产 smoke tenant。每次运行生成唯一 `run_id`，但业务实体 ID 使用固定前缀 `p8-fixture-*`，以便比较不同运行的事件、revision、hash 和审计结果。

环境必须输出：

- `environment.json`：镜像、包、Schema、migration、ai-memory/Plane 版本；
- `seed.json`：Fixture 版本、scope、初始 revision 和权限；
- `health.json`：health/readiness/version 结果；
- `trace.jsonl`：所有关键请求、事件、策略决策的 trace/span 关联。

## 4. 独立测试矩阵

| 测试 ID | 层级 | 校验目标 | 输入/故障 | 必须断言 | 证据 |
|---|---|---|---|---|---|
| P8-C01 | 集成 | clean Compose | 空目录、固定 manifest、本地测试覆盖层 | 所有依赖启动、migration、health/readiness、Plane 根路径、ai-memory、对象存储和 Workctx API 通过；RabbitMQ 故障可恢复 | [`20261021T1440-compose-full-plane`](../../../../artifacts/test-reports/compose/20261021T1440-compose-full-plane/) |
| P8-C02 | 集成 | 发布工具和部署前置校验 | Compose doctor/health、Release Manifest、可选 SBOM | 离线拓扑检查通过；清单无 `SET_BY_CI` 占位符；CycloneDX 组件可选生成；漏洞报告只作历史信息，不影响功能 Gate | manifest + health report + optional SBOM |
| P8-E01 | E2E | Plane→MCP | Webhook、projection、memory、ContextPack、MCP | 事件/trace/source_refs/revision 全部可关联 | [`final-plane-to-mcp`](../../../../artifacts/command-reports/final-plane-to-mcp/) |
| P8-E02 | E2E fixture | 会话连续性 | 固定 Session→Memory→Checkpoint→Handoff→Resume fixture | claim-once、resume、权限和审计全部通过；不代表外部客户端进程通过 | [`final-client-switch`](../../../../artifacts/command-reports/final-client-switch/) |
| P8-E05 | Live client | WaveMate→PlaneMem MCP | 指定 WaveMate 0.24.1 离线包、Streamable HTTP MCP、固定 scope headers | `server/discover`、`initialize`、`notifications/initialized` 均有成功 JSON-RPC 响应；无协议错误；配置最终恢复为本地 Compose 直连；UI 工具调用报告必须包含恢复文件，恢复失败时返回 `blocked` | [`wavemate-live-current`](../../../../artifacts/command-reports/wavemate-live-current/)、[`wavemate-k3s-current`](../../../../artifacts/command-reports/wavemate-k3s-current/)、[`wavemate-k3s-ui-current2`](../../../../artifacts/command-reports/wavemate-k3s-ui-current2/)、[`wavemate-k3s-ui-current3`](../../../../artifacts/command-reports/wavemate-k3s-ui-current3/)、[`wavemate-k3s-ui-current4`](../../../../artifacts/command-reports/wavemate-k3s-ui-current4/) |
| P8-E06 | Live deployment evidence | 三节点 k3s + WaveMate | 离线归档、containerd `k8s.io`、无 tag digest alias、Helm revision 24、三节点 Pod、WaveMate WebDriver UI、节点 cordon/Pod 重建恢复 | 归档 hash、digest、节点 Ready、3/3 副本、平台 12 步探针、WaveMate 握手、`tools/call`、成功响应、UI `已完成`、结果/trace 命中、自动配置恢复、节点恢复后的 rollout 和 12 步探针均可追溯；审计存储不可用时 HTTP 503/trace 且 Pod 不退出；成功复测与上游过载负面复测都必须保留；WaveMate 专用 live E2E 汇总必须返回 `passed` | [`20261023T0005-wavemate-audit`](../../../../artifacts/test-reports/k3s/20261023T0005-wavemate-audit/)、[`20261022T2038-wavemate-ui`](../../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/)、[`wavemate-ui-current4.json`](../../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current4.json)、[`plane-to-mcp-wavemate-current4-functional.json`](../../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/plane-to-mcp-wavemate-current4-functional.json) |
| P8-E03 | Live probe | runtime HTTP boundary | Compose/k3s runtime health、context index、context search、Plane Webhook、MCP JSON-RPC | HTTP 状态、版本、scope、幂等 retry、source_refs、MCP URI 和 resource contents 可核对 | [`final-verify-plane-functional.json`](../../../../artifacts/command-reports/final-verify-plane-functional.json) |
| P8-R01 | 恢复 | 备份恢复 | Postgres、SQLite、ai-memory Markdown、对象存储、manifest | 恢复后 hash、revision、event ids 可核对；RC 节点和恢复后业务 Smoke 另行门禁 | [`release-transport-sqlite`](../../../../artifacts/command-reports/release-transport-sqlite/) |
| P8-R02 | 恢复/性能 | 升级回滚和关键 SLO | 迁移中断、应用回退、Resume/projection/ack 并发 | 无丢失；runtime HTTP search p95 ≤1s；完整 Resume/projection/ack 和生产负载仍需 RC 证据 | rollback + performance report |

## 5. 通用断言和不变量

每个测试都必须根据适用范围执行以下断言：

- 所有输出含 `schema_version`、`trace_id`、scope、revision/version 和 `source_refs`。
- 所有写入带 `Idempotency-Key` 和 `expected_version`/`If-Match`，重复请求的 effect 数为 0。
- Policy deny、Schema 不兼容和校验失败不产生事件、投影、审计正文或其他副作用。
- 事件只追加不覆盖，消费者记录 `event_id` 和 aggregate version。
- 失败必须能区分 retryable/non-retryable，并可由 trace_id 定位。
- 测试证据中不得出现明文 secret、跨租户正文或未经授权的附件。

## 6. 通过阈值和失败处理

clean install 100%；本地 Compose 集成通过；关键 E2E 全绿；PostgreSQL/SQLite/ai-memory/对象存储备份恢复可用；回滚不丢事件/记忆/审计；manifest 可重放。Compose live 的恢复通过只能证明当前可达服务的数据包可恢复，不替代 RC 节点、恢复后业务校验和生产 Smoke。任何一个安全、权限、数据完整性或契约兼容测试失败，整个模块不得进入集成。非关键性能波动可以重跑一次，但必须保留第一次结果，并由测试负责人在报告中说明原因；功能失败不得通过重跑掩盖。

失败报告至少包含：失败测试 ID、提交 SHA、manifest、Fixture 版本、请求/响应摘要、trace_id、数据库或事件差异、是否产生副作用、修复链接和复测结果。

## 7. 进入模块集成的门禁

- [ ] 本文矩阵中的所有必选测试通过；
- [ ] 测试证据已保存到 `artifacts/test-reports/P8/<run_id>/`；
- [ ] 公开 Schema/API/Event diff 与本模块输出一致；
- [ ] health/readiness/version、migration、配置和回滚说明齐全；
- [ ] 需求追踪矩阵中的测试 ID 已更新；
- [ ] 下游协接方使用本模块发布的版本和 Fixture 完成契约测试；
- [ ] 模块负责人签署独立验证报告，才允许合并到 `develop`。

## 8. 独立报告模板

```yaml
module: P8
run_id: <uuid>
commit: <sha>
manifest: <digest>
fixture_version: <semver>
status: passed|failed|blocked
required_tests: []
failed_tests: []
side_effect_check: passed|failed
contract_diff: none|approved|breaking
artifacts:
  junit: <path>
  trace: <path>
  health: <path>
  evidence: <path>
owner: <team>
verified_at: <timestamp>
```
