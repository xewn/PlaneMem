# 当前开发与验证状态

本文记录按[总体开发计划](00-overall-development-plan.md)执行后的最新可复核结果。它只记录已经执行的命令和命令返回的状态；`offline-fixture` 通过不等于真实部署、真实服务或生产上线通过。

## 1. 运行基线

- 工作区：`F:\PlaneMem`
- 运行时间：2026-10-23（Asia/Shanghai；命令报告中的 `run_id` 是 UTC 时间序列）
- Node/pnpm 版本约束：见根目录 `package.json` 的 `engines` 和 `packageManager`
- 测试入口与状态语义：[统一测试命令与证据契约](../04-testing/command-runner-contract.md)
- 设计与任务完整性审计：[plan-audit.mjs](../../../tools/plan-audit.mjs)

## 2. 模块独立验证

每个模块均执行 `pnpm run test:module -- Pn --isolated`。下表的“通过数”来自该命令的 Node test runner 输出；模块契约测试通过 `pnpm run contract-test` 一并复核。

| 模块 | 独立测试 | 独立通过 | 失败 | 结果 | 主要证据 |
|---|---:|---:|---:|---|---|
| P0 | 20 | 20 | 0 | passed | `artifacts/test-reports/P0/20261021T233235/` |
| P1 | 5 | 5 | 0 | passed | `artifacts/test-reports/P1/20261021T064139/` |
| P2 | 7 | 7 | 0 | passed | `artifacts/test-reports/P2/20261021T065440/` |
| P3 | 6 | 6 | 0 | passed | `artifacts/test-reports/P3/20261021T070043/`、`artifacts/command-reports/sqlite-live-final/` |
| P4 | 10 | 10 | 0 | passed | `artifacts/test-reports/P4/20261021T070428/`、`tests/p4/t4-runtime.test.ts`、Plane Webhook/MCP HTTP transport 与 `server/discover` 测试 |
| P5 | 4 | 4 | 0 | passed | `artifacts/test-reports/P5/20261021T070701/` |
| P6 | 7 | 7 | 0 | passed | `tests/p6/t6-security-observability.test.ts`、`tests/p6/t6-runtime-audit.test.ts`、`artifacts/command-reports/p6-identity-audit-live-current8/`、`artifacts/command-reports/security-live-opa-current2/`、审计持久化失败 503 回归测试 |
| P7 | 4 | 4 | 0 | passed | `artifacts/test-reports/P7/20261021T071519/` |
| P8 | 25 | 25 | 0 | passed | `tests/p8/t8-wavemate-live.test.mjs`、`tests/p8/t8-k3s-wavemate-evidence.test.mjs`、`tests/p8/t8-live-gates.test.mjs`、`tests/p8/t8-image-vulnerability.test.mjs`、`tests/p8/t8-release-deploy.test.ts`、`tests/p8/t8-release-tooling.test.mjs`、`tests/p8/t8-live-platform-probe.test.mjs`、`artifacts/test-reports/k3s/20261022T2038-wavemate-ui/` |

模块独立测试合计为 **88/88**；完整 `pnpm test` 和 `pnpm run contract-test` 当前均为 **99/99**。全量输出中包含 11 个契约基线用例；`pnpm run test:contract -- --edge IF-P2-P3` 为 **23/23**，用于复核上下文、记忆适配、会话和同步边界的实际测试入口。

## 3. 计划和协接完整性

`pnpm run plan:audit` 返回 `passed`，最新结构化证据为 [`final-plan-audit-current26`](../../../artifacts/command-reports/final-plan-audit-current26/)，当前计数为：

- 任务文件 37/37；模块计划中的任务引用 37；独立验证文档中的任务引用 37；
- 模块 9 个；协接边 28 条；标准脚本 27 个（含 Keycloak/审计 live probe、workspace build、ai-memory live probe、SQLite live probe、WaveMate handshake probe 和 WaveMate UI live probe）；镜像漏洞扫描工具保留为可选历史记录；
- 缺失项为空；生产在线依赖、完整 RC 恢复和生产 Smoke 仍被明确列为外部门禁。

本轮补充 WaveMate 0.24.1 MCP live gate、k3s WebDriver UI `tools/call`、Compose 依赖矩阵、进程重启、网络分区、依赖恢复后业务探针、Keycloak/审计 live probe 和可复放镜像漏洞扫描后，`pnpm run plan:audit` 已重新执行并保持任务 37/37、模块 9 个、协接边 28 条和计划标准脚本 27 个；新增命令已通过对应模块测试，但生产在线服务/生产 Smoke 仍是外部门禁。

协接矩阵、提供方/消费方测试边界和独立验证文档由 `tests/contract/edge-contract-matrix.test.mjs` 自动校验。项目设计文档和根 ReadMe 的 Markdown 相对文件链接检查为 473 条、0 条断链（供应商原始文档不作为项目设计链接门禁）。

## 4. 本地命令门禁

以下通过门禁命令均已返回 0：

```text
pnpm build
pnpm test
pnpm run contract-test
pnpm lint
pnpm typecheck
pnpm run plan:audit
pnpm run test:functional
pnpm run test:resilience
pnpm run test:security
pnpm run test:performance
pnpm run test:evaluation
pnpm run test:release
pnpm run test:memory-live
pnpm run test:sqlite-live -- --run-id sqlite-live-final --output artifacts/command-reports/sqlite-live-final
pnpm run test:e2e -- --chain plane-to-mcp --live --client wavemate --wavemate-report artifacts/command-reports/wavemate-k3s-ui-current4/wavemate-k3s-ui-current4-wavemate-ui.json
pnpm run test:wavemate-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 --run-id wavemate-live-current --output artifacts/command-reports/wavemate-live-current
pnpm run test:wavemate-ui-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 --planemem-url http://127.0.0.1:38081 --webdriver-url http://127.0.0.1:4445 --run-id wavemate-k3s-ui-retry1 --wait-ms 90000 --output artifacts/command-reports/wavemate-k3s-ui-retry1
pnpm run test:resilience -- --live --scenario dependency-down --run-id resilience-live-dependency --output artifacts/command-reports/resilience-live-dependency
pnpm run test:resilience -- --live --scenario dependency-matrix --services postgres,redis,nats,rabbitmq,keycloak,minio,ai-memory,otel-collector --run-id p8-dependency-matrix-current --output artifacts/command-reports/p8-dependency-matrix-current
pnpm run test:resilience -- --live --scenario process-kill --run-id p8-process-kill-current --output artifacts/command-reports/p8-process-kill-current
pnpm run test:resilience -- --live --scenario network-partition --run-id p8-network-partition-current4 --output artifacts/command-reports/p8-network-partition-current4
pnpm run test:resilience -- --live --scenario business-recovery --services "postgres,nats,rabbitmq,ai-memory" --run-id p8-business-recovery-current2 --output artifacts/command-reports/p8-business-recovery-current2
pnpm run test:security -- --live --module P6 --run-id security-live-opa-current2 --output artifacts/command-reports/security-live-opa-current2
pnpm run test:identity-audit -- --live --run-id p6-identity-audit-live-current8 --output artifacts/command-reports/p6-identity-audit-live-current8 --runtime-url http://127.0.0.1:3000
pnpm run test:performance -- --live --profile release --requests 100 --concurrency 8 --run-id performance-live-current --output artifacts/command-reports/performance-live-current
pnpm run rc:readiness -- --offline
git diff --check
```

全量镜像漏洞命令的历史报告 `p8-vulnerability-scan-command-current16` 保留在 `artifacts/command-reports/`，结果为 `blocked`。按[功能验收范围调整](../05-release/07-functional-acceptance-scope.md)，该结果只作 informational 记录，不再创建升级/豁免任务，也不阻断后续功能验收。

离线命令报告统一标记为 `offline-fixture`；会话连续性 fixture 报告归档在 `artifacts/command-reports/final-client-switch/`，本轮 Plane→MCP 报告归档在 `artifacts/command-reports/final-plane-to-mcp/`，WaveMate 0.24.1 真实 MCP 报告归档在 `artifacts/command-reports/wavemate-live-current/`、`artifacts/command-reports/wavemate-k3s-current/`、`artifacts/command-reports/wavemate-k3s-ui-retry1/`、`wavemate-k3s-ui-current2/` 和最新 `wavemate-k3s-ui-current4/`；`wavemate-k3s-ui-current3/` 保留上游过载负面复测及自动恢复报告。离线性能和发布命令仍标记为 `simulated`，只证明报告、拓扑、清单、SBOM 和恢复工具的可重复行为；本地真实性能/恢复证据见 current12 live 报告，依赖升级后的恢复证据见 current14 报告。

`pnpm build` 使用根目录 `tsconfig.build.json`，实际生成编译产物到被排除的 `dist/`，并确认源码目录没有编译副产物。
P0 工具门禁还会校验根 `build` 脚本指向该配置且 `noEmit` 为 `false`，防止构建配置回归为假通过。

## 5. 真实门禁状态

最新真实模式 readiness 报告为 [`rc-readiness-current26`](../../../artifacts/command-reports/rc-readiness-current26/)，`local_status=passed`、`external_status=ready`、`release_blockers=[]`，Docker Compose 的 10 个 live services、Docker、Helm v3.9.0 和 kubectl 均已探测为 `available`。`tools/rc-readiness.mjs` 会自动发现用户本地 `LOCALAPPDATA\PlaneMem\tools\helm-v*`，不要求每次手动修改 PATH；本机 Helm 与目标 k3s 节点版本一致。此前报告仍保留在 [`rc-readiness-current10`](../../../artifacts/command-reports/rc-readiness-current10/) 和 [`rc-readiness-identity-audit-current`](../../../artifacts/command-reports/rc-readiness-identity-audit-current/)。本机 Docker Desktop CLI 位于用户目录；`tools/build-offline-image.ps1` 已自动识别该路径并完成正式 runtime 镜像离线构建、导出、三节点传输、containerd 导入和 Helm 部署。传输镜像和 k3s 证据见 [`20261023T0005-wavemate-audit`](../../../artifacts/test-reports/k3s/20261023T0005-wavemate-audit/)，安全修复镜像历史证据见 [`20261022T0745-security-fixed`](../../../artifacts/test-reports/k3s/20261022T0745-security-fixed/)。

本地 Compose 集成已另行完成：项目 `planemem-local` 的 10 个服务全部 healthy，完成 Plane 根路径、PostgreSQL 122 张 public 表、ai-memory 3.1.1、MinIO `uploads` bucket、NATS/Redis/RabbitMQ、Workctx index/search/幂等重放和 RabbitMQ 故障恢复。随后新增依赖矩阵，逐一停止并恢复 PostgreSQL、Redis、NATS、RabbitMQ、Keycloak、MinIO、ai-memory、OTel，8/8 服务恢复且每次 runtime readiness 仍为 200，证据见 [`p8-dependency-matrix-current`](../../../artifacts/command-reports/p8-dependency-matrix-current/)。完整集成证据见 [`20261021T1440-compose-full-plane`](../../../artifacts/test-reports/compose/20261021T1440-compose-full-plane/)，本轮 live service/config 复核见 [`20261022T0653-current`](../../../artifacts/test-reports/compose/20261022T0653-current/)。随后通过 `pnpm run test:memory-live` 对实际 ai-memory 3.1.1 服务执行写入 Markdown page、FTS 搜索、删除和删除后零命中复查，证据见 [`ai-memory-live-probe-current`](../../../artifacts/command-reports/ai-memory-live-probe-current/)。

指定的三节点远程 k3s 测试环境已经完成 smoke 和正式 runtime 两套验证：k3s `v1.36.5+k3s1`、Helm `v3.9.0`，正式镜像 3 个副本运行在三台节点上，健康探针、Service endpoints、context index/search、cordon 后重建和 Helm rollback/恢复均通过。smoke 证据见 [`20261021T0244 离线镜像报告`](../../../artifacts/test-reports/k3s/20261021T0244/test-summary.txt)，正式 runtime 证据见 [`20261021T0955-formal`](../../../artifacts/test-reports/k3s/20261021T0955-formal/)。

本轮再次从 `.231` 现场核验三节点均为 `Ready`，安全修复后的正式 runtime digest 在三台节点均已导入，Helm revision 19 为 deployed，Deployment 为 3/3，`/health`、`/health/ready`、`/version` 均返回预期结果；当前核验记录见 [`20261022T0745-security-fixed`](../../../artifacts/test-reports/k3s/20261022T0745-security-fixed/)。旧 revision 16 证据保留在 [`20261022T0650-current`](../../../artifacts/test-reports/k3s/20261022T0650-current/) 作为历史对照。

随后将 WaveMate 兼容离线镜像传输并导入三台 k3s 节点，补齐无 tag digest 别名后 Helm revision 22 为 `deployed`，3/3 副本分布在三台节点；真实 k3s 平台探针 12/12 通过，现场证据见 [`20261022T2038-wavemate-ui`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/)。WaveMate 0.24.1 真实握手和 WebDriver UI `tools/call` 报告见 [`wavemate-k3s-ui-retry1`](../../../artifacts/command-reports/wavemate-k3s-ui-retry1/)，此前成功复测见 [`wavemate-k3s-ui-current2`](../../../artifacts/command-reports/wavemate-k3s-ui-current2/)，最新成功复测见 [`wavemate-k3s-ui-current4`](../../../artifacts/command-reports/wavemate-k3s-ui-current4/)，均为 5 个请求、1 次 `tools/call`、5 个 2xx、0 个 JSON-RPC error，UI 显示已完成并命中结果/trace；[`wavemate-k3s-ui-current3`](../../../artifacts/command-reports/wavemate-k3s-ui-current3/) 保留一次真实上游过载负面复测。探针现在自动写出恢复证据并恢复到本机 Compose endpoint，恢复报告为 `restore-verification.json`。随后对 `hdserver2 (192.168.1.232)` 执行受控 `cordon → 删除单个 Pod → 等待 Deployment rollout → uncordon`，3 个节点重新 Ready、3/3 副本恢复，并在恢复后再次通过 12/12 平台探针；节点恢复证据见 [`node-recovery.json`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/node-recovery.json) 和 [`node-recovery-platform.json`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/node-recovery-platform.json)。本轮 live 客户端只使用 WaveMate 0.24.1 离线包，其他客户端名称仅保留在内部 fixture 设计中，没有启动或接入外部进程。

当前 chart 已在目标 k3s 节点用 Helm v3.9.0 重新执行 `helm lint`、`helm template` 和 `kubectl --server-side --dry-run=server`，三项均通过；证据见 [`20261022T0656-current-helm`](../../../artifacts/test-reports/k3s/20261022T0656-current-helm/)。

完整 RC 仍未通过，剩余门禁为：

- Plane→Webhook→Event→ContextPack→MCP 的生产 Smoke；WaveMate 0.24.1 k3s UI `tools/call` 已在本地目标拓扑通过；
- RC 级数据库/消息依赖业务恢复和性能负载；Compose 网络分区/进程重启及 k3s 节点 cordon/Pod 重建恢复已通过；
- 生产 Smoke、事件延迟、运行时审计发射和恢复后业务校验；Keycloak Bearer claims 与 PostgreSQL 审计表存储 round trip 已在本地通过。

所有真实模式命令（例如 `pnpm run test:e2e -- --chain plane-to-mcp --live`）在依赖缺失时均返回 `blocked` 和非零退出码。外部环境准备好后，必须按[RC 门禁执行步骤](../05-release/03-rc-gate-execution.md)逐阶段运行，并把真实报告追加到对应模块的 `artifacts/test-reports/<module>/<run_id>/`。
本轮真实模式 Plane→MCP 已确认本地 Compose 服务 `live_services=available`，并通过安全 runtime 的真实 HTTP 探针；WaveMate 0.24.1 握手和 k3s WebDriver UI `tools/call` 均已通过，最新成功复测报告见 [`wavemate-k3s-ui-current4`](../../../artifacts/command-reports/wavemate-k3s-ui-current4/)，其自动恢复报告证明配置回到本机 Compose。随后以 `--client wavemate` 汇总同一 k3s runtime 的平台探针和 WaveMate UI/恢复证据，专用 live E2E 返回 `passed`，报告见 [`plane-to-mcp-wavemate-current4`](../../../artifacts/command-reports/plane-to-mcp-wavemate-current4/)。三节点 k3s 同一 transport 镜像验证见 [`20261022T2038-wavemate-ui`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/)。

本轮已恢复 WaveMate 0.24.1 离线包的嵌入式 WebDriver，并将同一 UI 门禁复跑到当前 Compose `http://127.0.0.1:3000/mcp`：真实 MCP 配置、`server/discover`、`initialize`、`notifications/initialized`、`tools/list`、`tools/call`、结果与 `trace_id` 展示、配置恢复全部通过，报告见 [`wavemate-compose-ui-current24`](../../../artifacts/command-reports/wavemate-compose-ui-current24/)。随后使用同一 UI 报告汇总 Plane→Webhook→Event→ContextPack→MCP 全链路，`live_services=available`、平台 12 步探针、幂等响应、WaveMate gate 和 restore 均通过，报告见 [`plane-to-mcp-wavemate-functional-current25`](../../../artifacts/command-reports/plane-to-mcp-wavemate-functional-current25/)。此前 `wavemate-compose-ui-current21` 的 WebDriver 缺失记录保留为历史阻断证据，不再代表当前状态。

本轮使用 transport runtime 镜像再次执行 Compose live `restore-rollback`：报告 [`final-release-restore-autohelm`](../../../artifacts/command-reports/final-release-restore-autohelm/) 中 `compose.health`、PostgreSQL 备份/恢复（122 张 public 表前后计数一致）、ai-memory、对象存储和 SQLite outbox 备份/恢复均为 `passed`，SQLite 恢复前后均为 2 行且 drain exactly-once；Helm 已由工具自动发现用户目录 v3.9.0。随后在目标 k3s 对 `hdserver2` 完成一次受控节点恢复并复跑 12/12 平台探针，证据见 [`node-recovery.json`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/node-recovery.json)。当前可达的本地 Compose 与三节点 k3s 功能门禁均已通过；仍未执行的部分仅是需要额外 RC/生产环境、批准和真实生产数据的外部门禁，漏洞报告不计入该状态。

本轮新增 Compose runtime 级门禁：[`resilience-live-dependency`](../../../artifacts/command-reports/resilience-live-dependency/)
验证 RabbitMQ stop/start 和恢复健康；[`p8-dependency-matrix-current`](../../../artifacts/command-reports/p8-dependency-matrix-current/)
逐一验证 8 个依赖 stop/start、runtime readiness 和恢复健康；[`security-live-runtime`](../../../artifacts/command-reports/security-live-runtime/)
验证同 scope 命中、跨 project 零命中、缺 capability 返回 403 和拒绝零副作用；
[`performance-live-current`](../../../artifacts/command-reports/performance-live-current/) 完成 100 请求/8 并发，
search p95 为 41.385ms、失败 0。随后新增并实际执行 [`p8-process-kill-current`](../../../artifacts/command-reports/p8-process-kill-current/)，
验证 Workctx SIGKILL 后重新启动、健康检查和 `/health/ready` 均通过；新增 [`p8-network-partition-current4`](../../../artifacts/command-reports/p8-network-partition-current4/)，
验证 ai-memory 从 Compose 网络断开后请求确实失败、带 `ai-memory` DNS alias 重连、Workctx 强制重建和依赖连通性恢复，随后 runtime readiness 仍为 200。
随后在 PostgreSQL、NATS、RabbitMQ、ai-memory 各自 stop/start 后重新执行 12 步 Plane→MCP 业务探针，证据见 [`p8-business-recovery-current2`](../../../artifacts/command-reports/p8-business-recovery-current2/)，四项均通过。以上仅覆盖本地 runtime/Compose 边界，RC 级 Keycloak/OPA、依赖业务恢复、生产负载曲线和完整指标仍是外部门禁。
身份与审计存储 live probe [`p6-identity-audit-live-current8`](../../../artifacts/command-reports/p6-identity-audit-live-current8/) 已通过 Keycloak password grant、Bearer claims、OPA 1.9.0 REST decision、运行时审计指标递增、`wcp_audit_records` 按 trace 持久化/清理和合成写入/读取/删除后 `count=0` 复查；OPA decision log 证据见同目录 `opa-decision-log.txt`。新增审计持久化不可用回归测试验证 HTTP 503、trace_id 和 Pod 不退出，三节点证据见 [`20261023T0005-wavemate-audit`](../../../artifacts/test-reports/k3s/20261023T0005-wavemate-audit/)。目标 RC 的生产 OPA 配置、审计留存策略和生产身份仍需复核。

本轮补充执行本地 `pnpm audit --prod`，报告 [`pnpm-audit-prod.json`](../../../artifacts/command-reports/security-audit-20261021231640/pnpm-audit-prod.json) 未报告漏洞；由于当前生产依赖图为 0，该结果仅作为包管理器层面的辅助证据。随后对安全修复后的正式 runtime 归档执行 Trivy 0.58.1 扫描，报告 [`vulnerability-verification.txt`](../../../artifacts/offline-images/security-fixed/vulnerability-verification.txt) 为 0 个漏洞，容器/OS 镜像门禁已通过；完整 SBOM 策略、其他镜像和生产 Smoke 仍待执行。
本轮又对当前 WaveMate 0.24.1 k3s 发布镜像生成了 26 组件 CycloneDX SBOM（[`sbom.cdx.json`](../../../artifacts/command-reports/sbom-wavemate-current4/sbom.cdx.json)），并按 `CRITICAL,HIGH`、`ignore-unfixed` 策略执行 Trivy 0.58.1 扫描（[`summary.json`](../../../artifacts/command-reports/trivy-wavemate-current4/summary.json)，0 个漏洞）。随后使用 `E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1` 对当前本地 transport runtime 重新执行 WaveMate live MCP handshake，4 个请求、4 个 2xx、0 个 JSON-RPC error，证据见 [`wavemate-live-current13`](../../../artifacts/command-reports/wavemate-live-current13/)。这证明当前 runtime 的 WaveMate 0.24.1 握手和离线证据链可重放，但不替代 UI tools/call、所有依赖镜像、生产策略和 RC 环境扫描。
本轮对 PostgreSQL/RabbitMQ 候选版本完成真实 Compose 回归：[`release-live-dependency-upgrade-current14`](../../../artifacts/command-reports/release-live-dependency-upgrade-current14/) 的跨存储备份恢复、[`resilience-business-dependency-upgrade-current14`](../../../artifacts/command-reports/resilience-business-dependency-upgrade-current14/) 的 4 项恢复后业务 Smoke 和 [`resilience-matrix-dependency-upgrade-current14`](../../../artifacts/command-reports/resilience-matrix-dependency-upgrade-current14/) 的 8 项依赖故障矩阵均为 `passed`。这两项升级已经固化到本地 Compose；后续不再为了漏洞数量升级其他镜像，历史候选记录见 [功能验收范围调整](../05-release/07-functional-acceptance-scope.md)。
随后在同一当前 Compose runtime 上重新执行了可在本地完成的 RC 前置探针：[`release-live-current12`](../../../artifacts/command-reports/release-live-current12/) 的 `restore-rollback` 真实备份/恢复步骤全部通过，PostgreSQL 恢复前后均为 122 张表、SQLite 恢复前后均为 2 行；[`performance-live-current12`](../../../artifacts/command-reports/performance-live-current12/) 以 50 请求、0 失败完成 HTTP search，p95 为 39.345ms；[`security-live-current12`](../../../artifacts/command-reports/security-live-current12/) 的同 scope、跨 scope、策略拒绝和拒绝副作用均通过；[`resilience-matrix-current12`](../../../artifacts/command-reports/resilience-matrix-current12/) 对 PostgreSQL、Redis、NATS、RabbitMQ、Keycloak、MinIO、ai-memory、OTel 逐一 stop/start 后均恢复健康；[`resilience-business-current12`](../../../artifacts/command-reports/resilience-business-current12/) 在 PostgreSQL、NATS、RabbitMQ、ai-memory 恢复后重新执行 12 步业务探针并全部通过。上述证据只关闭本地 Compose 边界的验证项，不能替代 RC/生产环境的身份、负载曲线、审计留存和审批门禁。
随后按同一策略扫描本地 Compose/发布拓扑的 10 个依赖镜像，报告 [`p8-vulnerability-scan-command-current16`](../../../artifacts/command-reports/p8-vulnerability-scan-command-current16/) 和 [`remediation.json`](../../../artifacts/command-reports/p8-vulnerability-scan-command-current16/remediation.json) 作为历史记录保留。RabbitMQ 已升级到 4.4.0、PostgreSQL 已升级到 16.15-alpine3.24，二者功能回归均通过；其余漏洞数量不再触发镜像升级、豁免或功能发布阻断。

## 6. 继续执行规则

在真实门禁完成前，模块的离线独立测试可以作为开发基线，但不能把 RC 或生产状态改为通过。外部环境可用后，按 P8 运行真实 Compose、Helm、恢复、性能、安全和生产 Smoke；任何失败都回到对应模块的独立验证和协接边复测，并保留失败与修复后的两份证据。
