# k3s 三节点测试部署与验证

本文是 PlaneMem 在指定局域网三节点上的 k3s 测试执行记录和可重复操作规范。它明确使用 k3s，不安装或切换到独立 Kubernetes 发行版。

## 拓扑与边界

| 节点 | 地址 | 当前角色 | 测试职责 |
|---|---|---|---|
| hdserver1 | `192.168.1.231` | k3s `control-plane,etcd` | Helm 执行、镜像构建、kubectl 入口、主验证节点 |
| hdserver2 | `192.168.1.232` | k3s `control-plane,etcd` | 跨节点调度、镜像导入和故障验证 |
| hdserver3 | `192.168.1.233` | k3s `control-plane,etcd` | 跨节点调度、镜像导入和故障验证 |

三台节点当前均为 Ubuntu 22.04、k3s `v1.36.5+k3s1`，节点状态为 `Ready`。本测试复用现有集群，不执行卸载、重装、数据清空或 etcd 重置。

## 前置检查

在 `.231` 上执行：

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
k3s --version
kubectl get nodes -o wide
kubectl get pods -A
helm version
kubectl get storageclass
```

必须满足：三节点版本一致且 `Ready`；`coredns`、`local-path-provisioner` 和 `metrics-server` 为 `Running`；存在默认 `local-path` StorageClass。

## 镜像策略

当前仓库的正式 Helm 默认值是 CI 产出的 `ghcr.io/planemem/platform:0.1.0@sha256:<digest>`，本次测试环境没有该镜像，因此不能把 smoke 镜像当作正式应用镜像。为验证 k3s 调度、Helm 模板、Service、HTTP 探针和回滚，本次使用 `deploy/k3s/smoke/` 构建的临时 nginx 健康端点镜像，镜像名必须带 `k3s-smoke` 标识。

构建后必须获取 digest，并把镜像以同一引用导入三台节点的 k3s containerd：

```bash
docker build --build-arg NGINX_BASE_IMAGE=nginx:1.27-alpine \
  -t docker.io/library/planemem-k3s-smoke:0.1.0 deploy/k3s/smoke
digest=$(docker inspect --format '{{index .RepoDigests 0}}' docker.io/library/planemem-k3s-smoke:0.1.0 | cut -d@ -f2)
docker save docker.io/library/planemem-k3s-smoke:0.1.0 | gzip > /tmp/planemem-k3s-smoke.tar.gz
scp /tmp/planemem-k3s-smoke.tar.gz root@192.168.1.232:/tmp/
scp /tmp/planemem-k3s-smoke.tar.gz root@192.168.1.233:/tmp/
ssh root@192.168.1.231 "gzip -dc /tmp/planemem-k3s-smoke.tar.gz | k3s ctr images import -"
ssh root@192.168.1.232 "gzip -dc /tmp/planemem-k3s-smoke.tar.gz | k3s ctr images import -"
ssh root@192.168.1.233 "gzip -dc /tmp/planemem-k3s-smoke.tar.gz | k3s ctr images import -"
```

如果 Docker Hub 在测试网络不可达，保留同一 Dockerfile，只替换基础镜像来源：

```bash
docker build --build-arg NGINX_BASE_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine \
  -t docker.io/library/planemem-k3s-smoke:0.1.0 deploy/k3s/smoke
```

本轮已在本机 Docker Desktop 上使用上述 DaoCloud 缓存源完成离线构建。构建命令使用
`--pull=false --provenance=false`，生成单一 `linux/amd64` manifest，镜像 digest 为
`sha256:1a32b73368d11d3062a3380a6a38269fc50512059bb9e6045f91950726d4956c`，压缩包
SHA256 为 `6ac2f6b32ea5f59af97668c4f45e316d814bb67ced2674fad774cc5bf611e7e1`。离线导入后，
每个节点还必须显式建立 digest 别名，避免 k3s 把本地 tag 当作远端 digest 解析：

```bash
k3s ctr -n k8s.io images tag \
  docker.io/library/planemem-k3s-smoke:0.1.0 \
  docker.io/library/planemem-k3s-smoke@sha256:1a32b73368d11d3062a3380a6a38269fc50512059bb9e6045f91950726d4956c
```

本轮传输、containerd 导入、Helm revision 7、三节点 Pod imageID 和探针结果见
[`20261021T0244 离线镜像证据`](../../../artifacts/test-reports/k3s/20261021T0244/test-summary.txt)。

## 正式 runtime 镜像

正式 runtime 使用 `deploy/images/platform/Dockerfile`，入口为
`node dist/apps/api-gateway/src/server.js`，并通过 `tools/stage-runtime.mjs` 将编译后的
workspace 包复制到镜像内的 `node_modules`。本轮本机构建参数如下：

```powershell
& ./tools/build-offline-image.ps1 `
  -DockerfilePath deploy/images/platform/Dockerfile `
  -ContextPath . `
  -ImageReference docker.io/library/planemem-platform:0.1.0 `
  -BuildArgument 'NODE_BASE_IMAGE=node:24-alpine3.24@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d' `
  -StageRuntime `
  -BundleDirectory artifacts/offline-images
```

正式镜像最终 digest 为
`sha256:60ebcca13ebcdb7e978897f8872d98dcc0a72dd60297411658759d542a9412e1`，压缩包 SHA256
为 `cbca01250296538cbaf40bbf9e83a6f32e9b9f7e3c4d4b1cd2fdac40fcb68341`。在三台节点导入后，
必须为 k3s containerd 显式建立 digest 引用：

```bash
k3s ctr -n k8s.io images tag \
  docker.io/library/planemem-platform:0.1.0 \
  docker.io/library/planemem-platform@sha256:60ebcca13ebcdb7e978897f8872d98dcc0a72dd60297411658759d542a9412e1
```

本轮 Helm revision 14 部署含幂等处理的正式镜像，revision 15 回滚到上一正式镜像，revision 16
恢复当前正式镜像；恢复后 3/3 副本 Ready，三个 Pod 的 imageID 一致，健康、版本、索引、搜索
和重复写入复放均通过。删除一个 Pod 并 cordon `hdserver3` 后，副本在其他 Ready 节点自动
重建，随后已 uncordon。完整历史证据见 [`20261021T0955-formal`](../../../artifacts/test-reports/k3s/20261021T0955-formal/)，当前现场复核见 [`20261022T0650-current`](../../../artifacts/test-reports/k3s/20261022T0650-current/)。

安全修复后的 runtime 镜像 digest 为
`sha256:38070cd1c3548dc8deaeb7cf6bd45e54226ba7f75234a26486f942ecd3d69c0a`，离线包和 Trivy 0.58.1
扫描证据见 [`security-fixed`](../../../artifacts/offline-images/security-fixed/)。该归档 SHA256 为
`f7c009fa56c65e7d7d7462c23b38c90080eee436426d22a7b8893a3584b5d660`；重新部署三节点时必须将该 digest
导入每台 k3s containerd，并用 Helm values 覆盖同一 digest；旧 digest 证据保留用于历史回滚对照。

本轮已将安全修复归档传输并导入 `192.168.1.231`、`.232`、`.233`，三台节点 hash 一致；在
`.231` 以已有 `planemem-smoke-secrets` Secret 执行 Helm upgrade，revision 19 为 deployed，3/3
副本分布在三台节点且 Pod imageID 均为上述 digest。`/health`、`/health/ready` 和 `/version`
均返回预期结果；证据见 [`20261022T0745-security-fixed`](../../../artifacts/test-reports/k3s/20261022T0745-security-fixed/)。
revision 17/18 的失败证据也保留在同一目录，分别记录了节点未导入镜像和错误 Secret 名称这两个可复现原因。

随后为补齐公开 transport 边界，本机构建了 `planemem-platform:0.1.0-transport`，镜像 digest 为
`sha256:793850b00fb20cf9d291d1638f598a826029aa7b65b18e7000582e15e6b1f886`，离线包 SHA256 为
`d4f99010fb1e3e515f8e416f58144f1d944e16808b55ee0f8486ed82e4622f9a`。该归档已传输并导入三台节点，
并以 Helm revision 20 部署；三台节点 Pod 3/3 Ready 且分布在 `hdserver1`、`hdserver2`、`hdserver3`。
签名 Plane Webhook、MCP HTTP JSON-RPC initialize/tools/resources、health/readiness/version、幂等
index 和 scope search 探针均通过，结构化证据见 [`20261022T0024-transport`](../../../artifacts/test-reports/k3s/20261022T0024-transport/)。
该 revision 仍只代表 transport 和 runtime 边界已验证；WaveMate 0.24.1 UI 工具调用已在当前 k3s
现场单独通过，RC 业务 Smoke 继续作为外部门禁。

### WaveMate 0.24.1 k3s 当前现场

本轮在本地 Docker 完成本地构建和离线导出后，将 `planemem-platform:0.1.0-wavemate` 包传输到
`.231/.232/.233`，三台节点的归档 SHA256 均为
`5031eb495ed00a32b38bb0fb60eae8912694421062761d813695b9c4d61671ed`。镜像 digest 为
`sha256:a2d2d0b50eb5ebdc51083ad331a182dd15f0018343aaf29c3c14898402297261`；导入时在每台节点的
k3s containerd `k8s.io` namespace 建立了不带 tag 的 digest 别名
`docker.io/library/planemem-platform@sha256:a2d2d0b50eb5ebdc51083ad331a182dd15f0018343aaf29c3c14898402297261`。

第一次 Helm revision 21 因缺少该别名进入超时和 `ImagePullBackOff`；事件显示 kubelet 对 registry
发出 HEAD 请求并收到 403。补齐三台节点别名后重新升级，revision 22 为 `deployed`，3/3 Pod
分别运行在 `hdserver1`、`hdserver2`、`hdserver3`，imageID 一致。平台真实探针 12/12 通过，
包括 health/readiness/version、幂等 index、scope search、签名 Plane Webhook、MCP initialize、
tools/list、tools/call 和 resources/read；平台证据见 [`20261022T1111-wavemate`](../../../artifacts/test-reports/k3s/20261022T1111-wavemate/)，
WaveMate UI 证据见 [`20261022T2038-wavemate-ui`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/)。

WaveMate 0.24.1 离线包的真实 MCP 握手已指向 k3s 隧道并通过 `server/discover`、`initialize`、
`notifications/initialized`、`tools/list`；随后通过 WaveMate 0.24.1 自带 WebDriver 创建新会话，
提交只读 prompt，捕获 `tools/call` 和 2xx 响应，并在 UI 看到 `已完成`、命中结果和 trace。完整
证据见 [`20261022T2038-wavemate-ui`](../../../artifacts/test-reports/k3s/20261022T2038-wavemate-ui/)，
探针报告见 [`wavemate-k3s-ui-retry1`](../../../artifacts/command-reports/wavemate-k3s-ui-retry1/)，
成功复测和上游过载负面复测见 [`wavemate-k3s-ui-current2`](../../../artifacts/command-reports/wavemate-k3s-ui-current2/)
和 [`wavemate-k3s-ui-current3`](../../../artifacts/command-reports/wavemate-k3s-ui-current3/)。
探针会保留失败尝试，并由 `restore-verification.json` 证明结束时已将 WaveMate 配置恢复为本地 Compose endpoint；
这项 UI 门禁通过不等同于完整 RC 上线批准。

随后为验证 P6 审计持久化失败处理，本地重新构建并导出同名 `planemem-platform:0.1.0-wavemate` 镜像，
新 digest 为 `sha256:0546c722ba6b9d579d9e55b072a4500dd717f46f2e48456d84a102a7b233b9f8`，归档 SHA256 为
`81d574c32f0e5d28cfb5d03d9eaaf3c8e01c1914ca3ea454df5d8d625c65efe3`。该包重新传输并导入三台节点，
补齐 `docker.io/library/planemem-platform@sha256:0546c722ba6b9d579d9e55b072a4500dd717f46f2e48456d84a102a7b233b9f8`
digest 别名后，以 Helm revision 24 部署，3/3 Pod 分布在三台节点且 imageID 一致。`/health`、`/health/ready`、
`/version` 均通过；当 smoke Secret 的 `DATABASE_URL` 不可达时，`/v1/context/search` 返回
`AUDIT_PERSISTENCE_UNAVAILABLE`、HTTP 503、原始 trace_id，Pod 无重启，证据见
[`20261023T0005-wavemate-audit`](../../../artifacts/test-reports/k3s/20261023T0005-wavemate-audit/)。

当前工作区 chart 已复制到 `.231` 并使用目标 k3s 的 Helm v3.9.0 完成 `helm lint`、`helm template`
和 `kubectl --server-side --dry-run=server`；渲染清单和校验结果见 [`20261022T0656-current-helm`](../../../artifacts/test-reports/k3s/20261022T0656-current-helm/)。
本机随后安装用户目录 Helm v3.9.0，并使用正式 runtime digest 完成同一 chart 的 `helm lint` 和
`helm template`；本地渲染 hash 与命令结果见 [`20261022T0710-local-helm`](../../../artifacts/test-reports/k3s/20261022T0710-local-helm/)。

## Helm 部署

本机统一门禁使用与目标节点一致的 Helm v3.9.0。Windows 无包管理器时可下载到用户目录，避免修改仓库：

```powershell
$helmRoot = Join-Path $env:LOCALAPPDATA 'PlaneMem\tools\helm-v3.9.0'
New-Item -ItemType Directory -Force $helmRoot | Out-Null
Invoke-WebRequest https://get.helm.sh/helm-v3.9.0-windows-amd64.zip -OutFile (Join-Path $helmRoot 'helm.zip')
Expand-Archive (Join-Path $helmRoot 'helm.zip') -DestinationPath $helmRoot -Force
$env:PATH = "$(Join-Path $helmRoot 'windows-amd64');$env:PATH"
helm version --short
```

先在工作区渲染和校验 chart：

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
helm lint deploy/helm/planemem
helm template planemem deploy/helm/planemem \
  --namespace planemem-test --create-namespace \
  --set image.repository=docker.io/library/planemem-k3s-smoke \
  --set image.tag=0.1.0 \
  --set image.digest=<sha256-digest> \
  --set secrets.existingSecret=planemem-smoke-secrets
```

创建测试 Secret 并部署：

```bash
kubectl create namespace planemem-test --dry-run=client -o yaml | kubectl apply -f -
kubectl -n planemem-test create secret generic planemem-smoke-secrets \
  --from-literal=DATABASE_URL=postgresql://smoke.invalid/planemem \
  --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install planemem deploy/helm/planemem \
  --namespace planemem-test \
  --set image.repository=docker.io/library/planemem-k3s-smoke \
  --set image.tag=0.1.0 \
  --set image.digest=<sha256-digest> \
  --set secrets.existingSecret=planemem-smoke-secrets \
  --wait --timeout 180s
```

## 独立验证

```bash
kubectl -n planemem-test get deploy,pods,svc -o wide
kubectl -n planemem-test rollout status deploy/planemem --timeout=180s
kubectl -n planemem-test get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.nodeName}{"\t"}{.status.phase}{"\n"}{end}'
kubectl -n planemem-test port-forward svc/planemem 33000:80
curl -fsS http://127.0.0.1:33000/health
curl -fsS http://127.0.0.1:33000/health/ready
curl -fsS http://127.0.0.1:33000/version
```

验收要求：Deployment 可用副本达到期望值；Pod 在三节点间按测试值调度；`/health`、`/health/ready`
和 `/version` 返回预期版本；Service 端口 80 能转发到容器 3000；正式 runtime 的索引/搜索
请求保持 scope、trace_id 和 source_refs；报告记录 nodeName、镜像 digest、release revision
和命令返回码。

## 故障与回滚

1. 删除当前 Pod，确认 Deployment 自动重建并再次通过探针；
2. `kubectl cordon hdserver1` 后删除 Pod，确认 Pod 可在其他 Ready 节点重建；
3. `kubectl uncordon hdserver1`；
4. 用 `helm history planemem -n planemem-test` 记录 revision；使用上一 revision 执行 `helm rollback planemem <revision> -n planemem-test --wait --timeout 180s`；
5. 回滚后重复健康检查，并核对镜像 digest、Service endpoints 和 Pod nodeName；
6. 测试完成后执行 `helm uninstall planemem -n planemem-test`，保留报告和失败证据，不删除现有 k3s 集群或其系统数据。

## 正式上线阻断

正式 runtime 与 WaveMate 发布镜像的离线传输和三节点功能部署门禁已通过；WaveMate 镜像曾生成 26 组件 CycloneDX SBOM。对本地 Compose/发布拓扑的 10 个镜像扫描结果作为历史记录保留，证据见 `artifacts/command-reports/trivy-images-current4/`；漏洞数量不再影响功能验收。仍需在
该三节点上补做 Plane、PostgreSQL、NATS、ai-memory、生产身份、备份恢复、性能
和生产 Smoke 门禁；smoke 镜像继续作为独立拓扑基线，不进入正式发布清单。
