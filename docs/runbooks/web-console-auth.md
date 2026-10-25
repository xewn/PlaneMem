# PlaneMem 工作台认证与部署连接

工作台是 Next.js 服务端渲染应用。浏览器只访问工作台，工作台通过 `WORKBENCH_API_URL` 调用 PlaneMem API Gateway；PostgreSQL 只由 API Gateway 访问。登录采用现有 Hedou AuthServer 的 OpenIddict authorization code + PKCE 流程。

## 三节点地址的含义

当前部署资料将以下地址定义为 k3s 节点，而不是固定的数据库或认证端点：

| 节点 | 地址 | 角色 |
|---|---|---|
| hdserver1 | `192.168.1.231` | control-plane、etcd、kubectl/Helm 入口 |
| hdserver2 | `192.168.1.232` | control-plane、etcd、跨节点调度 |
| hdserver3 | `192.168.1.233` | control-plane、etcd、跨节点调度 |

因此不能直接把这三个地址填入 `AUTH_SERVER_ISSUER`、`WORKBENCH_API_URL` 或 `DATABASE_URL`。应先从集群中确认公开 Service、Ingress、端口或 DNS，再把实际端点写入环境变量。现有平台 Service 将容器 `3000` 暴露为 Service `80`；当前部署验证使用 `kubectl port-forward svc/planemem 33000:80`。

## 工作台环境变量

复制 `apps/web-console/.env.example` 后填写：

```dotenv
DEPLOYMENT_CLUSTER_NODES=192.168.1.231,192.168.1.232,192.168.1.233
AUTH_SERVER_ISSUER=https://<authserver-ingress>
AUTH_SERVER_CLIENT_ID=PlaneMem_WebConsole
AUTH_SERVER_CLIENT_SECRET=
AUTH_SERVER_SCOPE=openid profile email roles offline_access Base
WEB_CONSOLE_URL=https://<workbench-ingress>
WORKBENCH_API_URL=http://<planemem-service-or-ingress>
WORKBENCH_TENANT_ID=01HF7YAT000000000000000001
WORKBENCH_WORKSPACE_ID=01HF7YAT000000000000000002
WORKBENCH_PROJECT_ID=01HF7YAT000000000000000003
DATABASE_URL=postgresql://<user>:<password>@<postgres-endpoint>:5432/<database>
```

`DATABASE_URL` 只需要配置给 API Gateway；工作台进程本身不会直连数据库。`DEPLOYMENT_CLUSTER_NODES` 用于保留部署拓扑信息，不会自动猜测服务端点。

## AuthServer client 登记

### 已验证的 Hedou 本地配置

当前可访问的 https://auth.hedou.top/.well-known/openid-configuration 返回 OpenID Connect discovery，issuer 为 https://auth.hedou.top/，JWKS 地址和 authorization/token endpoint 均可用。现有客户端 HdWeb_Shell 已验证能够把授权请求重定向到 AuthServer 登录页；它的本地回调固定为 http://localhost:43123/auth/callback，注销回调为 http://localhost:43123/。

可以直接复制 apps/web-console/.env.hedou-shell.example 做本地登录联调：

    Copy-Item apps/web-console/.env.hedou-shell.example apps/web-console/.env.local

PlaneMem_WebConsole 当前尚未在这个线上 AuthServer 中登记，使用它会得到 400。生产环境仍应为实际工作台域名登记独立的 public client，并把该 client 的回调地址替换为实际 HTTPS Ingress。

在 `E:\myclaw\codes\hedou-abp-auth-server` 的环境配置/DbMigrator 中登记一个 public web client。不要把 client secret 放入浏览器环境变量：

```json
"PlaneMem_WebConsole": {
  "ClientType": "public",
  "ApplicationType": "web",
  "ConsentType": "implicit",
  "DisplayName": "PlaneMem Workbench",
  "RequireProofKeyForCodeExchange": true,
  "GrantTypes": [ "authorization_code", "refresh_token" ],
  "Scopes": [ "openid", "profile", "email", "roles", "offline_access", "Base" ],
  "RedirectUris": [ "https://<workbench-ingress>/auth/callback" ],
  "PostLogoutRedirectUris": [ "https://<workbench-ingress>/login" ]
}
```

本地开发时将两个 URI 改为 `http://localhost:3001/auth/callback` 和 `http://localhost:3001/login`。实际生产 URI 必须与 discovery、Ingress TLS 和 AuthServer 中登记的 URI 完全一致。

## 启动与验证

```powershell
pnpm install --ignore-scripts
pnpm --filter @planemem/web-console build
$env:PORT = '3001'
$env:HOSTNAME = '0.0.0.0'
pnpm --filter @planemem/web-console start
```

生产构建使用 Next.js `.next` 产物和 `next start`。API Gateway 需要先完成迁移 `deploy/migrations/001` 到 `008`，并使用 `deploy/compose/seed.sql` 或等价的受控数据导入；工作台页面在未登录时会回到 `/login`，API 连接失败时会显示带 trace id 的错误状态。
