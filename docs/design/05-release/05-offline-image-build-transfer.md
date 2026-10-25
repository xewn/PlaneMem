# 本地离线镜像构建与三节点传输

本文规定 WorkMesh/PlaneMem 正式镜像的本地离线构建、校验、传输和 k3s 导入流程。该流程只接受本地容器引擎和已存在于本地缓存的基础镜像；构建时禁止自动拉取远端基础镜像。

## 当前状态

Docker Desktop daemon 已验证可用，`tools/build-offline-image.ps1` 会自动识别用户目录下的 Docker CLI，并在构建前执行 `docker info`。正式 runtime 已落在 `apps/api-gateway/src/server.ts`，镜像入口为 `deploy/images/platform/Dockerfile`。构建工具在 `-StageRuntime` 下先运行 `pnpm build`，再执行 `tools/stage-runtime.mjs`，把 `dist/` 中的编译包复制到 `artifacts/runtime/node_modules`，因此镜像启动不依赖 workspace、pnpm 或源码目录。

已完成一次正式离线交付验证：`node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f` 作为锁定基础镜像，本地生成 `docker.io/library/planemem-platform:0.1.0`，最终镜像 digest 为 `sha256:60ebcca13ebcdb7e978897f8872d98dcc0a72dd60297411658759d542a9412e1`，压缩包 SHA256 为 `cbca01250296538cbaf40bbf9e83a6f32e9b9f7e3c4d4b1cd2fdac40fcb68341`。三台 k3s 节点均完成传输、containerd 导入和 digest 别名登记；完整证据位于 [`20261021T0955-formal`](../../../artifacts/test-reports/k3s/20261021T0955-formal/)。该版本作为历史对照，当前交付基线见下方安全修复版本。

随后针对 Trivy 镜像扫描发现的基础 npm/zlib 漏洞完成安全修复：runtime Dockerfile 升级 zlib 到 `1.3.2-r1` 并移除不参与运行的 npm 全局目录，使用 `node:24-alpine3.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d` 重建。修复后镜像 digest 为 `sha256:38070cd1c3548dc8deaeb7cf6bd45e54226ba7f75234a26486f942ecd3d69c0a`，离线包 SHA256 为 `f7c009fa56c65e7d7d7462c23b38c90080eee436426d22a7b8893a3584b5d660`，Trivy 0.58.1 漏洞数为 0；证据见 [`security-fixed`](../../../artifacts/offline-images/security-fixed/)。

为补齐 HTTP transport，基于同一离线构建流程生成 `docker.io/library/planemem-platform:0.1.0-transport`，
镜像 digest 为 `sha256:793850b00fb20cf9d291d1638f598a826029aa7b65b18e7000582e15e6b1f886`，压缩包 SHA256 为
`d4f99010fb1e3e515f8e416f58144f1d944e16808b55ee0f8486ed82e4622f9a`。该版本包含签名 Plane Webhook
和 MCP HTTP JSON-RPC runtime，已导入三台 k3s 节点并在 Helm revision 20 通过 3/3 健康和 transport 探针；
归档和 manifest 位于 [`transport-fixed`](../../../artifacts/offline-images/transport-fixed/)。

本轮继续使用 WaveMate 0.24.1 作为唯一外部客户端，构建 `docker.io/library/planemem-platform:0.1.0-wavemate`。
镜像 digest 为 `sha256:a2d2d0b50eb5ebdc51083ad331a182dd15f0018343aaf29c3c14898402297261`，离线包
`artifacts/offline-images/wavemate-mcp/planemem-platform_0.1.0-wavemate.tar.gz` 的 SHA256 为
`5031eb495ed00a32b38bb0fb60eae8912694421062761d813695b9c4d61671ed`。包已传输并导入三台 k3s
节点，Helm release `planemem` 在 `planemem-test` revision 22 为 `deployed`，3/3 副本分别位于三台
节点。k3s 平台探针和 WaveMate MCP 握手证据见 [`20261022T1111-wavemate`](../../../artifacts/test-reports/k3s/20261022T1111-wavemate/)，
WaveMate 0.24.1 WebDriver UI `tools/call` 和完成状态证据见 [`20261022T2038-wavemate-ui`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/)。

本轮 P6 runtime audit persistence 变更及审计失败处理重新执行了同一离线构建流程，Compose 本地测试引用
`planemem-platform:0.1.0-wavemate@sha256:0546c722ba6b9d579d9e55b072a4500dd717f46f2e48456d84a102a7b233b9f8`，
归档位于 [`wavemate-mcp-audit-persist-v2`](../../../artifacts/offline-images/wavemate-mcp-audit-persist-v2/)，压缩包 SHA256 为
`81d574c32f0e5d28cfb5d03d9eaaf3c8e01c1914ca3ea454df5d8d625c65efe3`。镜像内包含固定版本的 `postgres` runtime
依赖；启动时若配置 `DATABASE_URL`，Gateway 会将允许/拒绝决策审计写入 `wcp_audit_records`，持久化不可用时返回带 trace_id 的 `AUDIT_PERSISTENCE_UNAVAILABLE`/HTTP 503，且不会使进程退出。
该离线包已重新传输并导入 `192.168.1.231`、`.232`、`.233`，Helm release `planemem` 在 `planemem-test` revision 24 为 `deployed`，3/3 Pod 分布于三台节点；健康、审计失败 503、metrics 和 digest 证据见 [`20261023T0005-wavemate-audit`](../../../artifacts/test-reports/k3s/20261023T0005-wavemate-audit/)。

该门禁证明正式应用 runtime、离线镜像、三节点 k3s 部署、健康探针、索引/搜索接口和 Helm 回滚恢复链路可用。

### 真实数据库闭环运行时（2026-10-24）

本次功能验收新增 `009_runtime_state` migration，创建 `wcp_projection_states` 和 `wcp_context_hits`，并将 Webhook 事件、投影、Context hit 与审计写入真实 PostgreSQL。runtime 启动前从 `wcp_events` 重放事件、从 `wcp_context_hits` 恢复搜索和 MCP resources；Workctx 重启或 k3s Deployment rolling restart 后，原事件仍返回 `duplicate`，搜索命中保持不变。

最终离线归档为 `registry.hedou.top_5000_planemem_platform_0.1.0-runtime-closure.tar.gz`，归档 SHA256 为 `42d04aa258b7724168c95c42d079cbc785b51c691559bc6406070a332ae1ab01`，镜像 digest 为 `sha256:c18888e471da048e506248b9132d9057afd5da6f4896711eb05ecd87f2c91367`。该归档已在三台节点校验、导入并建立无 tag digest alias，Helm revision 27 为 `deployed`，3 个 Pod 分布在 `hdserver1/2/3`。

真实回查由 `tests/p8/t8-real-data-closure.test.mjs` 和 `tests/p8/t8-k3s-real-data-closure.test.mjs` 完成：Compose 与 k3s 均验证首次请求 `events/projections/hits/audits=1/1/1/1`，重启后重复投递为 `1/1/1/2`，且搜索结果保留 `source_refs`。k3s 的 `DATABASE_URL` 实际指向 `.233` PostgreSQL；密码和连接串不写入报告。
本机集成验证另外使用 `deploy/compose/docker-compose.local-test.yml`，并已完成 Plane、PostgreSQL、Redis、
NATS、RabbitMQ、Keycloak、MinIO、OTel Collector、ai-memory 和 Workctx 的健康、迁移、API、对象存储
及 RabbitMQ 恢复校验。该覆盖文件和 ai-memory 本地镜像只服务于可复现的本机 Compose 测试，不改变 k3s
正式 runtime 镜像的发布边界。生产身份提供方、完整跨存储恢复和负载门禁仍由 RC 阶段单独验证；其他镜像漏洞报告只作历史记录，
不能由本次 runtime 或本地 Compose 证据替代；当前安全修复 runtime 镜像的 Trivy 扫描已为 0 个漏洞，
但完整 SBOM 策略、其他镜像、生产身份、真实恢复和负载仍是 RC 门禁。

本地 Compose 的 ai-memory 镜像来自用户指定的 `codes/ai-memory` 源码，版本为 `v3.1.1-233-g11ab1003`，
测试引用 `planemem/ai-memory:3.1.1-local@sha256:ba2f799441acb0c165d042f8655fddc30e2a8f8cceca3c873538247931c784fa`，
HTTP 监听 `49374`，使用 Bearer token、`/usr/local/bin/ai-memory status` 健康检查和独立 `/data` volume。
镜像 digest、配置和运行结果必须登记到 Compose 证据目录；生产发布不得把 `:3.1.1-local` 作为未审查
的远端镜像来源。

## 本地构建

PowerShell 示例：

```powershell
pnpm install --offline --frozen-lockfile
& ./tools/build-offline-image.ps1 `
  -DockerfilePath deploy/images/platform/Dockerfile `
  -ContextPath . `
  -ImageReference planemem/platform:0.1.0 `
  -BuildArgument 'NODE_BASE_IMAGE=node:24-alpine3.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d' `
  -StageRuntime `
  -BundleDirectory artifacts/offline-images
```

若 Dockerfile 的基础镜像使用内部缓存源，通过 `-BuildArgument NAME=value` 显式指定，不能在构建中隐式联网拉取：

```powershell
& ./tools/build-offline-image.ps1 `
  -DockerfilePath deploy/k3s/smoke/Dockerfile `
  -ContextPath deploy/k3s/smoke `
  -ImageReference planemem/k3s-smoke:0.1.0 `
  -BuildArgument NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine `
  -BundleDirectory artifacts/offline-images
```

`tools/build-offline-image.ps1` 会依次执行 `docker info`、`pnpm run build`、可选的 runtime staging、`docker build --pull=false --provenance=false`、`docker image inspect` 和 `docker save`。关闭 provenance attestation 是为了让离线导入后 k3s containerd 为单一 `linux/amd64` manifest 建立可解析的 digest 别名。它会输出：

- `*.tar.gz`：Docker image archive；
- `*.manifest.json`：image ID、repo digest、archive SHA256、构建时间、Dockerfile/context 和 source commit。

任何一个前置检查失败都会停止，不能生成可交付的半成品。若已经由外部流程完成代码检查，可显式传入 `-SkipChecks`，但仍会执行本地引擎、构建和导出检查。

基础镜像必须事先导入本地缓存，并在 `docker images --digests` 中可见。生产构建禁止使用 `latest`、未锁定 digest 或隐式联网下载。

## 传输到服务器

传输脚本只接受 SSH key 或 SSH agent，不把密码写入命令行、脚本、manifest 或报告。用户提供的 root 密码只可用于交互式 SSH 登录，不得保存到仓库。

```powershell
& ./tools/transfer-offline-image.ps1 `
  -BundlePath artifacts/offline-images/planemem_platform_0.1.0.tar.gz `
  -Server @('192.168.1.231','192.168.1.232','192.168.1.233') `
  -RemoteUser root `
  -SshKeyPath $env:PLANEMEM_SSH_KEY
```

脚本在每台服务器上创建 `/var/lib/planemem/offline-images`，复制压缩包，并比较本地与远端 SHA256；任意节点校验失败都会终止。

## k3s containerd 导入

在每台节点执行，或通过受控 SSH 批量执行：

```bash
sha256sum /var/lib/planemem/offline-images/planemem_platform_0.1.0.tar.gz
gzip -dc /var/lib/planemem/offline-images/planemem_platform_0.1.0.tar.gz | k3s ctr images import -
k3s ctr -n k8s.io images list | grep 'planemem/platform'
```

三台节点必须出现同一个 image reference 和同一个 digest。Helm values 必须使用导入时的 repository、tag 和 digest，不能依赖 registry pull：

导入后必须在 `k8s.io` namespace 同时登记不带 tag 的 digest 引用。kubelet 解析
`repository:tag@sha256:<digest>` 时会按 `repository@sha256:<digest>` 查找本地 content；只登记
带 tag 的别名会导致 `ImagePullBackOff` 并尝试访问 registry。每台节点执行：

```bash
k3s ctr -n k8s.io images tag \
  docker.io/library/planemem-platform:0.1.0-wavemate \
  docker.io/library/planemem-platform@sha256:<digest>
```

```bash
helm upgrade --install planemem deploy/helm/planemem \
  --namespace planemem-test --create-namespace \
  --set image.repository=planemem/platform \
  --set image.tag=0.1.0 \
  --set image.digest=sha256:<digest> \
  --set replicaCount=3 \
  --set secrets.existingSecret=planemem-secrets
```

部署前要确认 Pod 使用 `imagePullPolicy: IfNotPresent` 或 `Never`，并在三台节点均已导入镜像。若 digest 不一致、Pod 尝试访问 registry、探针失败或 Service endpoints 不完整，发布必须停止。

## 验证和证据

导入后按以下顺序生成证据：

1. `k3s ctr images list`：三个节点的 image reference、digest 和 size；
2. `helm template`：最终 Deployment 的 image、pull policy、replicas、secretRef、资源限制和探针；
3. `kubectl rollout status`：期望副本、Pod nodeName、container imageID；
4. `curl /health`、`curl /health/ready` 和 `curl /version`：状态码、版本和 trace/source_refs（如适用）；
5. `kubectl get endpoints`：Service 后端完整；
6. 重启一个 Pod、cordon 一个节点并确认重调度；
7. 执行 Helm rollback，再次核对 digest、探针、endpoints 和版本。

本地 Compose 集成证据另外固定为：

```text
artifacts/test-reports/compose/20261021T1440-compose-full-plane/
  compose-rendered.yaml
  compose-ps.txt
  image-digests.txt
  postgres-table-count.txt
  plane-root-status.txt
  ai-memory-status.txt
  workctx-ready.json
  workctx-index.json
  workctx-search.json
  workctx-idem-replay.json
  fault-rabbitmq-*.txt
  test-summary.json
  evidence-manifest.json
```

`test-summary.json` 的 `status=passed` 只表示本地 Compose 集成范围通过；其中的 `external_gates`
仍必须逐项在 RC 环境执行并保留首次失败证据。

证据目录必须包含 `manifest.json`、`image-digests.txt`、`transfer-hashes.txt`、`helm-rendered.yaml`、`rollout.txt`、`health.json` 和 `rollback.txt`，并加入 `FILE_INDEX.md`。正式发布还必须由 P8 Release Manifest 记录 Plane、PostgreSQL、NATS、ai-memory、migration 和可选 SBOM；漏洞报告不作为功能 gate。

## 失败处理

- 本机缺少容器引擎：停止，不改用服务器远程构建；
- 基础镜像不在本地缓存：停止，先把经过审查的基础镜像包导入本机；
- 正式 Dockerfile/入口不存在：停止，不把 smoke 镜像冒充正式镜像；
- 传输 SHA256 不一致：删除目标节点不完整文件，重新传输并重新校验；
- k3s 导入后 digest 不一致：停止 Helm 升级，检查 tar、架构和 containerd namespace；
- 只登记带 tag 的 digest 别名：先补登记 `repository@sha256:<digest>`，确认三台节点均存在后再重试 Helm；
- 探针或回滚失败：保留现状和证据，按 [k3s 测试部署](04-k3s-test-deployment.md) 的回滚流程处理。
