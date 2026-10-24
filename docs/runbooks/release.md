# 发布、备份恢复与回滚 Runbook

1. 由 CI 生成 `deploy/release-manifest.yaml`，替换所有 `SET_BY_CI` digest 并保存 SBOM、迁移 checksum、测试证据和批准记录。
2. 执行 preflight：契约、P6 安全、P7 评测、迁移兼容性、备份恢复和健康检查全部通过后才允许打开 Feature Flag。
3. 发布顺序为 expand migration → 部署应用 → readiness/smoke → replay outbox → 启用非默认能力。`proposal_enabled` 与 `vector_enabled` 默认关闭。
4. 回滚前冻结写入、选择上一份已批准 manifest、恢复 Postgres/SQLite/ai-memory 备份，校验 hash、revision、event_id 和 audit_id，再重放 outbox 并运行 smoke。
5. 任意关键检查失败都停止发布并保留 trace、状态差异和第一次失败证据；不能在生产临时修改 schema 或接口。

Docker、Helm、PostgreSQL、ai-memory 和真实 OTel 的运行结果必须归档到 `artifacts/test-reports/P8/<run_id>/`，本地无对应工具时只能标记为 external gate。

## CI 与 k3s 发布入口

`.github/workflows/pr.yml` 分成两个门禁：`verify` 执行源码、契约、模块和离线发布检查；`release-contract`
在通过后构建不推送的 runtime 镜像，生成镜像 digest、Helm 渲染结果、Release Manifest 和 SBOM，并校验
Compose 与 Helm 配置。CI 只把这些文件作为 artifact 保存，不会因为缺少私有集群凭据而自动修改集群。

现场或受控 runner 使用同一个 Node 发布入口，所有镜像必须显式带 digest：

```bash
pnpm run deploy:k3s -- preflight \
  --image-repository registry.example/planemem/platform \
  --image-tag 0.1.0-rc.1 \
  --image-digest sha256:<64-lowercase-hex> \
  --namespace planemem-test \
  --secret planemem-runtime-secrets \
  --replicas 3

pnpm run deploy:k3s -- deploy \
  --image-repository registry.example/planemem/platform \
  --image-tag 0.1.0-rc.1 \
  --image-digest sha256:<64-lowercase-hex> \
  --namespace planemem-test \
  --secret planemem-runtime-secrets \
  --replicas 3 \
  --expected-nodes hdserver1,hdserver2,hdserver3 \
  --health-url http://127.0.0.1:33000 \
  --output artifacts/test-reports/P8/<run_id>/k3s-deploy.json
```

`deploy` 使用 `helm upgrade --install --atomic --wait`，随后检查 Deployment 副本、Pod Ready 状态、三节点分布、
Service endpoints 和 digest；任一步失败都会返回非零状态。`verify` 只做同样的无写入检查，适合发布后的复验。
回滚必须指定已批准的 Helm revision，并在回滚后重复所有检查：

```bash
pnpm run deploy:k3s -- rollback --revision <revision> \
  --image-repository registry.example/planemem/platform \
  --image-tag 0.1.0-previous \
  --image-digest sha256:<64-lowercase-hex> \
  --namespace planemem-test \
  --secret planemem-runtime-secrets \
  --replicas 3 \
  --health-url http://127.0.0.1:33000
```

命令输出会写入 JSON 报告，包含 `run_id`、`trace_id`、镜像、revision、节点、endpoints 和健康检查结果；报告与
Release Manifest、SBOM 一起归档。不得把数据库 URL、OIDC 密钥或 SSH 私钥作为命令行参数传入。
