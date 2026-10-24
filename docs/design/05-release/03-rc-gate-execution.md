# RC 与生产门禁执行步骤

本文件是外部环境可用后的唯一执行顺序。每个阶段必须保存命令输出和结构化证据；任何阶段返回 `blocked`、`failed` 或缺少批准，都停止后续阶段。

## 0. 本地前置门禁

```powershell
pnpm install --frozen-lockfile
pnpm run plan:audit
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run contract-test -- P8
pnpm run rc:readiness -- --offline
```

预期：计划审计、类型、格式和离线测试全绿；readiness 的 `local_status` 为 `passed`。`external_status: blocked` 只能说明真实环境尚未提供，不能作为 RC 通过。

## 1. Compose 集成环境

先校验基础 Compose 文件和本地集成覆盖文件都能被 Docker Compose 解析。开发机的完整本地验证
必须使用固定 digest 的覆盖文件；基础文件仍用于生产配置评审，不能因为本地兼容镜像而修改生产
镜像来源：

```powershell
docker compose -f deploy/compose/docker-compose.yml config --quiet
docker compose -p planemem-local --profile full `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.local-test.yml config --quiet
docker compose -p planemem-local --profile full `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.local-test.yml up -d --pull never
docker compose -p planemem-local --profile full `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.local-test.yml ps
pnpm run fixture:validate
pnpm run fixture:seed -- --fixture tenant-demo --version 1
pnpm run fixture:events -- --scenario duplicate-gap-delay
pnpm run test:e2e -- --chain plane-to-mcp --live
pnpm run test:wavemate-live -- --live --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 --run-id wavemate-live-<run_id> --output artifacts/command-reports/wavemate-live-<run_id>
pnpm run test:resilience -- --scenario dependency-down --live
pnpm run test:resilience -- --scenario dependency-matrix --live --services postgres,redis,nats,rabbitmq,keycloak,minio,ai-memory,otel-collector
pnpm run test:resilience -- --scenario process-kill --live
pnpm run test:resilience -- --scenario network-partition --live
pnpm run test:resilience -- --scenario business-recovery --live --services "postgres,nats,rabbitmq,ai-memory"
# 漏洞扫描已冻结，不纳入后续标准执行顺序；历史报告按 07-functional-acceptance-scope.md 归档
pnpm run test:security -- --module P6 --live
pnpm run test:identity-audit -- --live
pnpm run test:performance -- --profile release --live
```

P6 的 OPA 联动使用独立的 test-only 覆盖层，不修改默认生产 Compose：
`docker-compose.opa-test.yml` 固定 OPA 1.9.0 digest，向 Workctx 注入 `OPA_URL` 并开启 decision log；
`p6-identity-audit-live-current8/opa-decision-log.txt` 已按 trace 证明 runtime 请求实际到达
`planemem/authz`。进入 RC 时必须使用目标环境的 OPA 配置重新执行同一校验，并将审计留存/导出策略纳入批准的 Release Manifest。

`docker-compose.local-test.yml` 固定本地 Workctx runtime、ai-memory 3.1.1、Plane backend 0.26.0、
RabbitMQ 和 MinIO 兼容镜像；它还把 NATS 监控端口、Keycloak/OTel/ai-memory/Plane 的实际健康
检查方式写入覆盖层。Plane 使用生产 API entrypoint，并通过 `GUNICORN_WORKERS=1`、RabbitMQ、
MinIO bucket `uploads` 和 PostgreSQL migration 完成最小集成启动。覆盖层只允许在本地测试环境使用，
发布到 k3s 时必须使用 Release Manifest 中登记的镜像和 digest。

本轮完整本地证据位于 [`20261021T1440-compose-full-plane`](../../../artifacts/test-reports/compose/20261021T1440-compose-full-plane/)，其中包括 Compose 渲染结果、10 个服务的健康状态、
122 张 PostgreSQL public 表、Plane HTTP 200、ai-memory 状态与 Web、NATS/RabbitMQ/Redis/MinIO
校验、Workctx readiness/index/search、幂等重放和 RabbitMQ 停止/恢复报告。必须保存 Compose config、
镜像 digest、health/readiness、迁移 checksum、Fixture 版本、JUnit、trace、event IDs、ContextPack
hash、memory revision、Plane IDs 和 audit IDs。依赖重启、重复/乱序事件、断网和冲突必须检查零
丢失、零重复副作用和可恢复。本轮 Plane→MCP live 命令和 WaveMate 专用探针还对传输 runtime 执行了真实 HTTP
health/readiness/version、幂等 context index、scope search、签名 Plane Webhook 和 MCP JSON-RPC
探针，WaveMate 探针额外校验 `server/discover`、`initialize`、`notifications/initialized` 和配置恢复，
最新证据位于 `artifacts/command-reports/final-verify-plane-functional.json` 和
`artifacts/command-reports/wavemate-live-current/`；RC 级数据库/NATS
依赖业务恢复、Keycloak/OPA 联动、完整性能指标和生产 Smoke 仍须在外部 RC 环境执行。本轮 runtime 级
故障/安全/性能证据分别位于 `artifacts/command-reports/resilience-live-dependency/`、
`artifacts/command-reports/p8-process-kill-current/`、`artifacts/command-reports/p8-network-partition-current4/`、
`artifacts/command-reports/p8-business-recovery-current2/`、`artifacts/command-reports/security-live-runtime/`
和 `artifacts/command-reports/performance-live-current/`。

当前复测证据位于 [`release-live-dependency-upgrade-current14`](../../../artifacts/command-reports/release-live-dependency-upgrade-current14/)、[`resilience-matrix-dependency-upgrade-current14`](../../../artifacts/command-reports/resilience-matrix-dependency-upgrade-current14/)、[`resilience-business-dependency-upgrade-current14`](../../../artifacts/command-reports/resilience-business-dependency-upgrade-current14/)、[`release-live-current12`](../../../artifacts/command-reports/release-live-current12/)、[`security-live-current12`](../../../artifacts/command-reports/security-live-current12/) 和 [`performance-live-current12`](../../../artifacts/command-reports/performance-live-current12/)。依赖升级报告记录 PostgreSQL 16.15/RabbitMQ 4.4.0 的跨存储恢复、8 个依赖逐一恢复和 4 项恢复后业务 Smoke；既有报告记录 scope/policy deny 零副作用以及 50 请求 search p95=39.345ms。报告状态均为 `passed`；漏洞扫描报告只作历史记录，后续门禁聚焦 RC 生产身份、审计留存、生产负载、恢复后业务校验和上线批准。

## 2. Helm/k3s 预生产

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
helm lint deploy/helm/planemem
helm template planemem deploy/helm/planemem --namespace planemem --values deploy/helm/planemem/values.yaml
# 使用目标 k3s 节点提供的 kubectl/k3s kubectl，上线前禁止切换到另一套集群
kubectl apply --server-side --dry-run=server -f <rendered-manifest.yaml>
helm upgrade --install planemem deploy/helm/planemem --namespace planemem --create-namespace --values <rc-values.yaml> --wait
pnpm run rc:readiness
```

必须校验 secret 只通过 Secret reference 注入，readiness/liveness、resource limits、migration、版本和 Feature Flag 与 Release Manifest 一致。缺少 Helm/k3s 或真实服务时必须停在此阶段。

本轮指定三节点 k3s 现场已完成离线镜像传输、`k8s.io` containerd 导入、无 tag digest 别名登记和 Helm
revision 24 滚动升级；3/3 Pod 分布在 `.231/.232/.233`，平台真实探针 12/12 通过。WaveMate 0.24.1
已对该 k3s endpoint 完成真实 MCP 握手，并通过其自带 WebDriver 创建新会话、输入只读 prompt、触发
`tools/call`、收到成功响应和 UI `已完成`，证据为 [`20261022T2038-wavemate-ui`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/)。
第一次 UI 尝试遇到上游模型过载，失败报告也已保留；RC 数据库/NATS 故障、生产身份、审计留存策略、性能和生产 Smoke
仍是后续门禁，UI 通过不等同于 RC 上线批准。

## 3. 发布清单、SBOM 与恢复

```powershell
pnpm run release:manifest -- --version <rc-version> --git-sha <immutable-sha> --output artifacts/test-reports/P8/<run_id>/release-manifest.yaml
pnpm run sbom:generate -- --output artifacts/test-reports/P8/<run_id>/sbom.cdx.json
pnpm run fixture:backup -- --manifest <manifest-digest> --output artifacts/test-reports/P8/<run_id>
pnpm run test:release -- --scenario restore-rollback --live
```

RC 工具必须确认没有 `SET_BY_CI` 占位符；SBOM 可以作为可选组件清单归档，不要求执行漏洞修复或以漏洞数量阻断发布。备份必须逐文件校验 Postgres/SQLite/ai-memory/对象存储的 hash、revision、event_id 和 audit_id。恢复、升级、回滚和 smoke 的第一次失败证据必须保留。

## 4. 生产 Smoke 与放量

生产只允许使用已批准的 manifest。先执行 health/readiness/version、Plane Webhook、ai-memory capture/recall、Context Resume、Policy deny 无副作用、审计写入、事件 lag 和备份可恢复检查，再打开 Feature Flag。`proposal_enabled` 和 `vector_enabled` 默认关闭；Smoke 和观测窗口通过后才逐步放量。

## 5. 证据目录

```text
artifacts/test-reports/P8/<run_id>/
  module-verification.yaml
  environment.json
  seed.json
  health.json
  trace.jsonl
  failure-cases.json
  release-manifest.yaml
  sbom.cdx.json
  restore-report.json
  rollback-report.json
  production-smoke.json
```

所有报告必须带 `run_id`、`trace_id`、`source_refs`、scope、版本和外部门禁状态。没有完整证据、审批和回滚路径时，RC 不能转生产。
