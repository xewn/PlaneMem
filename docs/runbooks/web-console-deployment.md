# PlaneMem 工作台部署清单

## 服务边界

```text
浏览器 → Workbench Next.js → API Gateway /v1/workbench/query → PostgreSQL
                    ↘ Hedou AuthServer /connect/authorize + /connect/token
```

工作台包含 8 个左侧菜单页面：Overview、Work Items、Context、Sessions、Handoffs、Conflicts、Audit、Admin。每个页面都使用同一个 scope fence（tenant/workspace/project）从 API Gateway 读取数据，页面不再依赖静态 mock。

## k3s 现场

部署资料中的三节点是：`192.168.1.231`、`192.168.1.232`、`192.168.1.233`。在 `.231` 上执行集群命令：

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes -o wide
kubectl -n planemem-test get deploy,pods,svc -o wide
kubectl -n planemem-test rollout status deploy/planemem --timeout=180s
kubectl -n planemem-test port-forward svc/planemem 33000:80
```

如果没有公开 Ingress，可暂时将 WORKBENCH_API_URL 指向可达的端口转发地址；长期部署应创建明确的 API Service/Ingress，并把其 DNS 或固定入口写入环境变量。节点 IP 本身不代表工作台、AuthServer 或 PostgreSQL 的监听地址。

现场发布已在三节点 k3s 集群完成。API Gateway 运行镜像为 `registry.hedou.top:5000/planemem/platform:0.1.0-workbench-r3`，内容摘要为 `sha256:07e3a5baaf4c9b32b8ea303b4a4eb4c6167a7cb5781d181e59c4e00f66def6cc`；`planemem` Deployment 在 192.168.1.231、192.168.1.232、192.168.1.233 上为 3/3 Ready。镜像仓库使用 k3s 节点本地受控的 TLS 信任配置，凭据只保存在 Kubernetes Secret。

## 数据库

按顺序应用 `deploy/migrations/001_*.sql` 至 `008_workbench_projection.sql`。工作台投影表包括 `wcp_work_items`、`wcp_context_items`、`wcp_context_packs`、`wcp_handoffs`，并复用既有 sessions、conflicts、audit 表。所有查询都按三段 scope 条件过滤，数据库不可达时 API 返回可追踪的 `WORKBENCH_DATABASE_UNAVAILABLE`。

## 验收

1. AuthServer discovery 可从 `AUTH_SERVER_ISSUER/.well-known/openid-configuration` 访问。
2. `PlaneMem_WebConsole` client 的 callback/logout URI 与实际工作台入口一致。
3. API Gateway 使用真实 `DATABASE_URL`，迁移和种子数据已完成。
4. 登录后 8 个页面都返回 200，并能看到对应投影数据。
5. API 请求带 Bearer token、tenant/workspace/project headers、trace id；越界 scope 返回拒绝。


## 现场验收记录（2026-10-24）

- 在 192.168.1.233 上创建了持久化 PostgreSQL 16 容器和命名卷 `planemem-postgres`，仅通过 Kubernetes Secret 注入连接串；没有把密码写入仓库或日志。
- 已执行 `deploy/migrations/001_*.sql` 至 `008_workbench_projection.sql` 以及原始 `deploy/compose/seed.sql`；随后加载真实闭环 fixture，当前 scope 的投影明细为 projects 1、work items 15、context items 10、sessions 6、handoffs 4、conflicts 4，另有 14 条 fixture audit records 和运行期审计历史。
- 通过 `kubectl -n planemem-test port-forward svc/planemem 33000:80` 访问 `/v1/workbench/query`，overview、work_items、context、sessions、handoffs、conflicts、audit、admin 八个 operation 均返回 200，响应 `source_refs` 均指向 PostgreSQL；真实 fixture 基线 overview 为 active_work_items 11、blocked_work_items 2、completed_work_items 3、active_sessions 3、open_conflicts 3。
- 恢复 `AUTH_SERVER_ISSUER=https://auth.hedou.top` 与 `AUTH_SERVER_AUDIENCE=Base` 后，缺失 Bearer 和伪造 Bearer 均返回 401；现场 Deployment 最终保持 OIDC 校验开启。
- 生产工作台的 `PlaneMem_WebConsole` AuthServer client 与 HTTPS Ingress 仍需由部署管理员按实际域名登记；当前 API、数据库和三节点滚动发布已经完成。

## 真实数据闭环验收（2026-10-25，Asia/Shanghai）

`deploy/compose/seed-realistic-workbench.sql` 是可重复执行的真实项目投影 fixture，覆盖 15 个 work items、10 个 context items、6 个 sessions、4 个 handoffs、4 个 conflicts、session run/tool telemetry、context pack、sync events 和 14 条业务 audit records。它使用现有 `project-continuity` scope，不替换迁移或生产凭据。

验收顺序：

```bash
# 远程 PostgreSQL 中加载基线 fixture
cat deploy/compose/seed-realistic-workbench.sql | docker exec -i planemem-postgres psql -v ON_ERROR_STOP=1 -U planemem -d planemem

# 本机通过端口转发调用已部署 API
pnpm run test:workbench-realistic -- --url http://127.0.0.1:33000 --phase baseline --run-id realistic-baseline

# 模拟一次真实状态变化，再验证看板聚合随数据库变化
cat deploy/compose/realistic-workbench-transition.sql | docker exec -i planemem-postgres psql -v ON_ERROR_STOP=1 -U planemem -d planemem
pnpm run test:workbench-realistic -- --url http://127.0.0.1:33000 --phase transition --run-id realistic-transition

# 恢复可重复的基线状态
cat deploy/compose/seed-realistic-workbench.sql | docker exec -i planemem-postgres psql -v ON_ERROR_STOP=1 -U planemem -d planemem
```

验收脚本检查 HTTP 200、PostgreSQL `source_refs`、每类状态覆盖、scope isolation、审计结果覆盖和 telemetry 计数。基线聚合必须为 active 11、blocked 2、completed 3、active sessions 3、open conflicts 3；状态变化后必须为 blocked 1、open conflicts 2，并检查 transition audit record。报告保存在 `artifacts/command-reports/realistic-*.json`。

验收期间曾临时关闭 OIDC issuer enforcement 以便使用受控 smoke token 访问真实数据库；基线恢复后已重新写入 `AUTH_SERVER_ISSUER` 和 `AUTH_SERVER_AUDIENCE`，Deployment 重新滚动发布，缺失或伪造 Bearer 均返回 401。生产 Deployment 使用 workbench 镜像 digest 固定，发布后必须先确认 `/v1/workbench/query` 返回 200，避免旧镜像漂移造成 404。

Web Console 真实数据 smoke 使用签名的本地测试 session 访问同一个端口转发 API，不绕过页面的数据请求。`tools/run-realistic-web-console-smoke.mjs` 逐页请求 `/overview`、`/work-items`、`/context`、`/sessions`、`/handoffs`、`/conflicts`、`/audit`、`/admin`，检查 HTTP 200 及真实 fixture 内容标记。最近一次运行报告 `realistic-ui-verified.json` 8/8 通过，页面分别读到了 `Resolve checkpoint hash mismatch`、`North-star outcome`、`github-actions`、`real-w-134` 和 `PostgreSQL projection` 等真实数据库内容。
