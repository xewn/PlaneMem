# FILE_INDEX.md

本文件是 `F:\PlaneMem` 工作区的文件索引。它用于让需求、设计、实现、测试、发布和供应商源码能够按统一路径被定位。

## 维护规则

- 新增、删除、移动或重命名文件时，必须在同一次变更中更新本文件。
- 从工作区根目录执行 `powershell -ExecutionPolicy Bypass -File tools/update-file-index.ps1` 重新生成索引。
- 更新时重新扫描 `F:\PlaneMem`，保持路径使用 `/` 分隔，并同步文件大小、扩展名和目录统计。
- 本索引不把自身纳入扫描统计；`.git`、`node_modules`、`.superpowers`、`.next`、`dist`、`coverage` 等内部或生成目录不纳入项目文件索引。
- 完成变更后检查本文件的文件总数、目录总数和 `git diff`，确保索引与工作区实际状态一致。

## 生成信息

- 工作区：`F:\PlaneMem`
- 生成时间：`2026-10-25 00:37:23 +08:00`
- 文件总数（不含本索引与版本控制内部文件）：`512`
- 目录总数（不含版本控制内部目录）：`171`
- 总字节数（不含本索引与版本控制内部文件）：`102767523`

## 顶层目录统计

| 顶层路径 | 文件数 | 字节数 |
|---|---:|---:|
| `.github` | 1 | 1369 |
| `(root)` | 14 | 168085 |
| `apps` | 95 | 427016 |
| `artifacts` | 108 | 9565798 |
| `assets` | 12 | 91394621 |
| `deploy` | 33 | 65830 |
| `docs` | 115 | 638463 |
| `integrations` | 6 | 3230 |
| `packages` | 56 | 96955 |
| `tests` | 36 | 140042 |
| `tools` | 29 | 257674 |
| `workers` | 7 | 8440 |

## 目录清单

目录路径均相对于 `F:\PlaneMem`，文件数包含该目录及其所有子目录中的文件。

- `.github/` — 1 files
- `.github/workflows/` — 1 files
- `apps/` — 95 files
- `apps/api-gateway/` — 8 files
- `apps/api-gateway/src/` — 6 files
- `apps/api-gateway/src/workbench/` — 1 files
- `apps/artifact-service/` — 2 files
- `apps/artifact-service/src/` — 1 files
- `apps/audit-service/` — 3 files
- `apps/audit-service/src/` — 2 files
- `apps/context-bridge/` — 5 files
- `apps/context-bridge/src/` — 4 files
- `apps/context-bridge/src/outbox/` — 2 files
- `apps/context-service/` — 5 files
- `apps/context-service/src/` — 4 files
- `apps/context-service/src/memory-adapter/` — 1 files
- `apps/context-service/src/resources/` — 1 files
- `apps/context-service/src/search/` — 1 files
- `apps/integration-orchestrator/` — 5 files
- `apps/integration-orchestrator/src/` — 4 files
- `apps/mcp-gateway/` — 3 files
- `apps/mcp-gateway/src/` — 2 files
- `apps/plane-connector/` — 8 files
- `apps/plane-connector/src/` — 6 files
- `apps/plane-connector/src/dedup/` — 1 files
- `apps/plane-connector/src/plane-client/` — 1 files
- `apps/plane-connector/src/project-sync/` — 1 files
- `apps/plane-connector/src/webhook/` — 1 files
- `apps/policy-service/` — 3 files
- `apps/policy-service/src/` — 2 files
- `apps/search-service/` — 3 files
- `apps/search-service/src/` — 2 files
- `apps/session-service/` — 6 files
- `apps/session-service/src/` — 5 files
- `apps/session-service/src/checkpoint/` — 2 files
- `apps/session-service/src/session/` — 2 files
- `apps/sync-service/` — 6 files
- `apps/sync-service/src/` — 5 files
- `apps/sync-service/src/conflict/` — 2 files
- `apps/sync-service/src/cursor/` — 2 files
- `apps/web-console/` — 35 files
- `apps/web-console/src/` — 28 files
- `apps/web-console/src/app/` — 18 files
- `apps/web-console/src/app/admin/` — 2 files
- `apps/web-console/src/app/audit/` — 1 files
- `apps/web-console/src/app/auth/` — 3 files
- `apps/web-console/src/app/auth/callback/` — 1 files
- `apps/web-console/src/app/auth/login/` — 1 files
- `apps/web-console/src/app/auth/logout/` — 1 files
- `apps/web-console/src/app/conflicts/` — 2 files
- `apps/web-console/src/app/context/` — 1 files
- `apps/web-console/src/app/handoffs/` — 2 files
- `apps/web-console/src/app/login/` — 1 files
- `apps/web-console/src/app/overview/` — 1 files
- `apps/web-console/src/app/sessions/` — 1 files
- `apps/web-console/src/app/work-items/` — 1 files
- `apps/web-console/src/components/` — 4 files
- `apps/web-console/src/lib/` — 4 files
- `apps/workctx-cli/` — 3 files
- `apps/workctx-cli/src/` — 2 files
- `artifacts/` — 108 files
- `artifacts/command-reports/` — 83 files
- `artifacts/command-reports/p8-business-recovery-current2/` — 1 files
- `artifacts/command-reports/p8-dependency-matrix-current/` — 1 files
- `artifacts/command-reports/p8-network-partition-current4/` — 1 files
- `artifacts/command-reports/p8-process-kill-current/` — 1 files
- `artifacts/command-reports/p8-vulnerability-scan-command-current2/` — 22 files
- `artifacts/command-reports/plan-audit-debug/` — 0 files
- `artifacts/command-reports/sbom-wavemate-current4/` — 1 files
- `artifacts/command-reports/trivy-images-current4/` — 21 files
- `artifacts/command-reports/trivy-wavemate-current4/` — 3 files
- `artifacts/command-reports/wavemate-k3s-ui-retry1/` — 3 files
- `artifacts/runtime/` — 1 files
- `artifacts/test-reports/` — 24 files
- `artifacts/test-reports/k3s/` — 24 files
- `artifacts/test-reports/k3s/20261022T2038-wavemate-ui/` — 24 files
- `assets/` — 12 files
- `deploy/` — 33 files
- `deploy/compose/` — 12 files
- `deploy/compose/health/` — 2 files
- `deploy/helm/` — 5 files
- `deploy/helm/planemem/` — 5 files
- `deploy/helm/planemem/templates/` — 2 files
- `deploy/images/` — 1 files
- `deploy/images/platform/` — 1 files
- `deploy/k3s/` — 2 files
- `deploy/k3s/smoke/` — 2 files
- `deploy/keycloak/` — 1 files
- `deploy/migrations/` — 8 files
- `deploy/observability/` — 1 files
- `deploy/opa/` — 1 files
- `deploy/search/` — 1 files
- `docs/` — 115 files
- `docs/design/` — 107 files
- `docs/design/00-baseline/` — 8 files
- `docs/design/01-contracts/` — 5 files
- `docs/design/02-subprojects/` — 48 files
- `docs/design/02-subprojects/P0/` — 1 files
- `docs/design/02-subprojects/P1/` — 1 files
- `docs/design/02-subprojects/P2/` — 1 files
- `docs/design/02-subprojects/P3/` — 1 files
- `docs/design/02-subprojects/P4/` — 1 files
- `docs/design/02-subprojects/P5/` — 1 files
- `docs/design/02-subprojects/P6/` — 1 files
- `docs/design/02-subprojects/P7/` — 1 files
- `docs/design/02-subprojects/P8/` — 1 files
- `docs/design/02-subprojects/tasks/` — 38 files
- `docs/design/03-integration/` — 7 files
- `docs/design/04-testing/` — 14 files
- `docs/design/04-testing/clients/` — 1 files
- `docs/design/04-testing/modules/` — 10 files
- `docs/design/05-release/` — 8 files
- `docs/design/06-planning/` — 14 files
- `docs/design/06-planning/modules/` — 9 files
- `docs/design/vendor/` — 2 files
- `docs/runbooks/` — 4 files
- `docs/superpowers/` — 3 files
- `docs/superpowers/ledgers/` — 1 files
- `docs/superpowers/plans/` — 2 files
- `docs/traceability/` — 1 files
- `integrations/` — 6 files
- `integrations/claude-code/` — 1 files
- `integrations/codex/` — 1 files
- `integrations/deepseek/` — 1 files
- `integrations/plane/` — 1 files
- `integrations/workbuddy/` — 1 files
- `packages/` — 56 files
- `packages/auth/` — 4 files
- `packages/auth/src/` — 3 files
- `packages/context-compiler/` — 5 files
- `packages/context-compiler/schemas/` — 1 files
- `packages/context-compiler/src/` — 3 files
- `packages/context-compiler/src/layers/` — 1 files
- `packages/contracts/` — 22 files
- `packages/contracts/schemas/` — 13 files
- `packages/contracts/schemas/entities/` — 12 files
- `packages/contracts/src/` — 8 files
- `packages/domain/` — 3 files
- `packages/domain/src/` — 2 files
- `packages/domain/src/memory/` — 1 files
- `packages/events/` — 5 files
- `packages/events/schemas/` — 2 files
- `packages/events/src/` — 2 files
- `packages/observability/` — 5 files
- `packages/observability/src/` — 4 files
- `packages/release/` — 5 files
- `packages/release/src/` — 4 files
- `packages/sdk/` — 4 files
- `packages/sdk/src/` — 3 files
- `packages/test-fixtures/` — 3 files
- `packages/test-fixtures/fixtures/` — 1 files
- `packages/test-fixtures/src/` — 1 files
- `tests/` — 36 files
- `tests/contract/` — 9 files
- `tests/contract/context/` — 1 files
- `tests/p0/` — 7 files
- `tests/p1/` — 1 files
- `tests/p2/` — 1 files
- `tests/p3/` — 2 files
- `tests/p4/` — 2 files
- `tests/p5/` — 3 files
- `tests/p6/` — 3 files
- `tests/p7/` — 1 files
- `tests/p8/` — 7 files
- `tools/` — 29 files
- `workers/` — 7 files
- `workers/evaluation/` — 4 files
- `workers/evaluation/datasets/` — 1 files
- `workers/evaluation/src/` — 2 files
- `workers/intelligence/` — 3 files
- `workers/intelligence/src/` — 2 files

## 索引文件

- [`FILE_INDEX.md`](FILE_INDEX.md) — 本索引文件；文件增删改名后必须同步更新。

## 全量文件清单

路径均相对于 `F:\PlaneMem`，每一项包含文件大小、扩展名和最后修改时间。供应商源码 `codes/ai-memory` 也纳入索引；生成依赖与运行产物目录按维护规则排除。

### .dockerignore

- [.dockerignore](.dockerignore) — 96 bytes; .dockerignore; 修改于 2026-10-21 13:02:48

### .github

- [.github/workflows/pr.yml](.github/workflows/pr.yml) — 1369 bytes; .yml; 修改于 2026-10-21 08:38:06

### .gitignore

- [.gitignore](.gitignore) — 60 bytes; .gitignore; 修改于 2026-10-20 23:42:04

### .gitmodules

- [.gitmodules](.gitmodules) — 201 bytes; .gitmodules; 修改于 2026-10-24 08:07:09

### .prettierignore

- [.prettierignore](.prettierignore) — 113 bytes; .prettierignore; 修改于 2026-10-24 09:07:45

### .prettierrc.json

- [.prettierrc.json](.prettierrc.json) — 73 bytes; .json; 修改于 2026-10-20 23:40:33

### apps

- [apps/api-gateway/package.json](apps/api-gateway/package.json) — 576 bytes; .json; 修改于 2026-10-23 07:39:32
- [apps/api-gateway/src/http.ts](apps/api-gateway/src/http.ts) — 5563 bytes; .ts; 修改于 2026-10-23 08:13:21
- [apps/api-gateway/src/index.ts](apps/api-gateway/src/index.ts) — 155 bytes; .ts; 修改于 2026-10-24 10:32:18
- [apps/api-gateway/src/oidc.ts](apps/api-gateway/src/oidc.ts) — 6439 bytes; .ts; 修改于 2026-10-24 10:32:43
- [apps/api-gateway/src/router.ts](apps/api-gateway/src/router.ts) — 2590 bytes; .ts; 修改于 2026-10-23 07:32:55
- [apps/api-gateway/src/server.ts](apps/api-gateway/src/server.ts) — 33211 bytes; .ts; 修改于 2026-10-24 10:32:43
- [apps/api-gateway/src/workbench/repository.ts](apps/api-gateway/src/workbench/repository.ts) — 8960 bytes; .ts; 修改于 2026-10-24 10:39:25
- [apps/api-gateway/tsconfig.json](apps/api-gateway/tsconfig.json) — 154 bytes; .json; 修改于 2026-10-24 09:07:03
- [apps/artifact-service/package.json](apps/artifact-service/package.json) — 329 bytes; .json; 修改于 2026-10-21 06:48:32
- [apps/artifact-service/src/index.ts](apps/artifact-service/src/index.ts) — 6959 bytes; .ts; 修改于 2026-10-21 06:54:07
- [apps/audit-service/package.json](apps/audit-service/package.json) — 363 bytes; .json; 修改于 2026-10-21 07:08:47
- [apps/audit-service/src/index.ts](apps/audit-service/src/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 07:07:52
- [apps/audit-service/src/service.ts](apps/audit-service/src/service.ts) — 3541 bytes; .ts; 修改于 2026-10-23 07:33:07
- [apps/context-bridge/package.json](apps/context-bridge/package.json) — 327 bytes; .json; 修改于 2026-10-21 06:58:43
- [apps/context-bridge/src/index.ts](apps/context-bridge/src/index.ts) — 35 bytes; .ts; 修改于 2026-10-21 06:58:13
- [apps/context-bridge/src/node-sqlite.d.ts](apps/context-bridge/src/node-sqlite.d.ts) — 390 bytes; .ts; 修改于 2026-10-21 06:58:13
- [apps/context-bridge/src/outbox/index.ts](apps/context-bridge/src/outbox/index.ts) — 29 bytes; .ts; 修改于 2026-10-21 06:58:13
- [apps/context-bridge/src/outbox/sqlite.ts](apps/context-bridge/src/outbox/sqlite.ts) — 7123 bytes; .ts; 修改于 2026-10-21 06:58:43
- [apps/context-service/package.json](apps/context-service/package.json) — 416 bytes; .json; 修改于 2026-10-21 06:48:32
- [apps/context-service/src/index.ts](apps/context-service/src/index.ts) — 122 bytes; .ts; 修改于 2026-10-21 06:43:43
- [apps/context-service/src/memory-adapter/adapter.ts](apps/context-service/src/memory-adapter/adapter.ts) — 6457 bytes; .ts; 修改于 2026-10-21 06:54:07
- [apps/context-service/src/resources/service.ts](apps/context-service/src/resources/service.ts) — 61 bytes; .ts; 修改于 2026-10-21 06:43:43
- [apps/context-service/src/search/service.ts](apps/context-service/src/search/service.ts) — 2807 bytes; .ts; 修改于 2026-10-21 06:54:07
- [apps/integration-orchestrator/package.json](apps/integration-orchestrator/package.json) — 629 bytes; .json; 修改于 2026-10-21 23:21:25
- [apps/integration-orchestrator/src/client-switch.ts](apps/integration-orchestrator/src/client-switch.ts) — 3925 bytes; .ts; 修改于 2026-10-22 06:42:24
- [apps/integration-orchestrator/src/index.ts](apps/integration-orchestrator/src/index.ts) — 100 bytes; .ts; 修改于 2026-10-21 23:21:25
- [apps/integration-orchestrator/src/plane-to-mcp.ts](apps/integration-orchestrator/src/plane-to-mcp.ts) — 5590 bytes; .ts; 修改于 2026-10-21 23:14:48
- [apps/integration-orchestrator/src/runner.ts](apps/integration-orchestrator/src/runner.ts) — 1407 bytes; .ts; 修改于 2026-10-21 07:13:18
- [apps/mcp-gateway/package.json](apps/mcp-gateway/package.json) — 368 bytes; .json; 修改于 2026-10-21 07:02:12
- [apps/mcp-gateway/src/gateway.ts](apps/mcp-gateway/src/gateway.ts) — 4987 bytes; .ts; 修改于 2026-10-21 07:03:45
- [apps/mcp-gateway/src/index.ts](apps/mcp-gateway/src/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 07:01:37
- [apps/plane-connector/package.json](apps/plane-connector/package.json) — 403 bytes; .json; 修改于 2026-10-21 06:37:45
- [apps/plane-connector/README.md](apps/plane-connector/README.md) — 652 bytes; .md; 修改于 2026-10-21 06:40:05
- [apps/plane-connector/src/compatibility.ts](apps/plane-connector/src/compatibility.ts) — 1381 bytes; .ts; 修改于 2026-10-21 06:39:07
- [apps/plane-connector/src/dedup/ledger.ts](apps/plane-connector/src/dedup/ledger.ts) — 2907 bytes; .ts; 修改于 2026-10-21 06:39:07
- [apps/plane-connector/src/index.ts](apps/plane-connector/src/index.ts) — 198 bytes; .ts; 修改于 2026-10-21 06:38:58
- [apps/plane-connector/src/plane-client/client.ts](apps/plane-connector/src/plane-client/client.ts) — 3806 bytes; .ts; 修改于 2026-10-21 06:39:07
- [apps/plane-connector/src/project-sync/projection.ts](apps/plane-connector/src/project-sync/projection.ts) — 2316 bytes; .ts; 修改于 2026-10-21 06:39:46
- [apps/plane-connector/src/webhook/security.ts](apps/plane-connector/src/webhook/security.ts) — 4448 bytes; .ts; 修改于 2026-10-21 06:39:07
- [apps/policy-service/package.json](apps/policy-service/package.json) — 364 bytes; .json; 修改于 2026-10-21 07:08:47
- [apps/policy-service/src/index.ts](apps/policy-service/src/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 07:07:40
- [apps/policy-service/src/service.ts](apps/policy-service/src/service.ts) — 4493 bytes; .ts; 修改于 2026-10-23 07:33:44
- [apps/search-service/package.json](apps/search-service/package.json) — 214 bytes; .json; 修改于 2026-10-21 07:13:18
- [apps/search-service/src/index.ts](apps/search-service/src/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 07:12:00
- [apps/search-service/src/service.ts](apps/search-service/src/service.ts) — 2638 bytes; .ts; 修改于 2026-10-21 07:13:18
- [apps/session-service/package.json](apps/session-service/package.json) — 416 bytes; .json; 修改于 2026-10-21 06:58:42
- [apps/session-service/src/checkpoint/index.ts](apps/session-service/src/checkpoint/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 06:57:24
- [apps/session-service/src/checkpoint/service.ts](apps/session-service/src/checkpoint/service.ts) — 10111 bytes; .ts; 修改于 2026-10-21 06:58:43
- [apps/session-service/src/index.ts](apps/session-service/src/index.ts) — 75 bytes; .ts; 修改于 2026-10-21 06:57:24
- [apps/session-service/src/session/index.ts](apps/session-service/src/session/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 06:57:03
- [apps/session-service/src/session/service.ts](apps/session-service/src/session/service.ts) — 8131 bytes; .ts; 修改于 2026-10-21 06:59:37
- [apps/sync-service/package.json](apps/sync-service/package.json) — 364 bytes; .json; 修改于 2026-10-21 06:58:43
- [apps/sync-service/src/conflict/index.ts](apps/sync-service/src/conflict/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 06:57:49
- [apps/sync-service/src/conflict/service.ts](apps/sync-service/src/conflict/service.ts) — 5244 bytes; .ts; 修改于 2026-10-21 06:58:43
- [apps/sync-service/src/cursor/index.ts](apps/sync-service/src/cursor/index.ts) — 30 bytes; .ts; 修改于 2026-10-21 06:57:49
- [apps/sync-service/src/cursor/service.ts](apps/sync-service/src/cursor/service.ts) — 7809 bytes; .ts; 修改于 2026-10-21 06:58:43
- [apps/sync-service/src/index.ts](apps/sync-service/src/index.ts) — 72 bytes; .ts; 修改于 2026-10-21 06:57:49
- [apps/web-console/.env.example](apps/web-console/.env.example) — 842 bytes; .example; 修改于 2026-10-24 10:24:42
- [apps/web-console/.env.hedou-shell.example](apps/web-console/.env.hedou-shell.example) — 524 bytes; .example; 修改于 2026-10-24 10:33:41
- [apps/web-console/next-env.d.ts](apps/web-console/next-env.d.ts) — 262 bytes; .ts; 修改于 2026-10-24 09:01:37
- [apps/web-console/next.config.mjs](apps/web-console/next.config.mjs) — 139 bytes; .mjs; 修改于 2026-10-24 09:20:22
- [apps/web-console/package.json](apps/web-console/package.json) — 556 bytes; .json; 修改于 2026-10-24 09:20:22
- [apps/web-console/src/app/admin/model.ts](apps/web-console/src/app/admin/model.ts) — 968 bytes; .ts; 修改于 2026-10-24 09:01:16
- [apps/web-console/src/app/admin/page.tsx](apps/web-console/src/app/admin/page.tsx) — 6654 bytes; .tsx; 修改于 2026-10-24 09:59:16
- [apps/web-console/src/app/audit/page.tsx](apps/web-console/src/app/audit/page.tsx) — 6437 bytes; .tsx; 修改于 2026-10-24 09:58:31
- [apps/web-console/src/app/auth/callback/route.ts](apps/web-console/src/app/auth/callback/route.ts) — 2410 bytes; .ts; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/app/auth/login/route.ts](apps/web-console/src/app/auth/login/route.ts) — 1564 bytes; .ts; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/app/auth/logout/route.ts](apps/web-console/src/app/auth/logout/route.ts) — 327 bytes; .ts; 修改于 2026-10-24 09:01:16
- [apps/web-console/src/app/conflicts/model.ts](apps/web-console/src/app/conflicts/model.ts) — 1386 bytes; .ts; 修改于 2026-10-24 09:01:16
- [apps/web-console/src/app/conflicts/page.tsx](apps/web-console/src/app/conflicts/page.tsx) — 5942 bytes; .tsx; 修改于 2026-10-24 10:02:38
- [apps/web-console/src/app/context/page.tsx](apps/web-console/src/app/context/page.tsx) — 7810 bytes; .tsx; 修改于 2026-10-24 10:03:13
- [apps/web-console/src/app/handoffs/model.ts](apps/web-console/src/app/handoffs/model.ts) — 2090 bytes; .ts; 修改于 2026-10-24 09:01:16
- [apps/web-console/src/app/handoffs/page.tsx](apps/web-console/src/app/handoffs/page.tsx) — 6163 bytes; .tsx; 修改于 2026-10-24 10:01:54
- [apps/web-console/src/app/layout.tsx](apps/web-console/src/app/layout.tsx) — 675 bytes; .tsx; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/app/login/page.tsx](apps/web-console/src/app/login/page.tsx) — 809 bytes; .tsx; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/app/overview/page.tsx](apps/web-console/src/app/overview/page.tsx) — 15283 bytes; .tsx; 修改于 2026-10-24 10:40:03
- [apps/web-console/src/app/page-model.ts](apps/web-console/src/app/page-model.ts) — 1886 bytes; .ts; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/app/page.ts](apps/web-console/src/app/page.ts) — 109 bytes; .ts; 修改于 2026-10-24 09:03:52
- [apps/web-console/src/app/sessions/page.tsx](apps/web-console/src/app/sessions/page.tsx) — 7247 bytes; .tsx; 修改于 2026-10-24 09:57:09
- [apps/web-console/src/app/work-items/page.tsx](apps/web-console/src/app/work-items/page.tsx) — 6324 bytes; .tsx; 修改于 2026-10-24 10:02:52
- [apps/web-console/src/components/icons.tsx](apps/web-console/src/components/icons.tsx) — 2119 bytes; .tsx; 修改于 2026-10-24 09:41:27
- [apps/web-console/src/components/page-state.tsx](apps/web-console/src/components/page-state.tsx) — 1812 bytes; .tsx; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/components/ui.tsx](apps/web-console/src/components/ui.tsx) — 2000 bytes; .tsx; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/components/workbench-shell.tsx](apps/web-console/src/components/workbench-shell.tsx) — 3083 bytes; .tsx; 修改于 2026-10-24 10:10:39
- [apps/web-console/src/index.ts](apps/web-console/src/index.ts) — 173 bytes; .ts; 修改于 2026-10-24 09:03:25
- [apps/web-console/src/lib/api.ts](apps/web-console/src/lib/api.ts) — 2468 bytes; .ts; 修改于 2026-10-24 09:01:16
- [apps/web-console/src/lib/auth.ts](apps/web-console/src/lib/auth.ts) — 3891 bytes; .ts; 修改于 2026-10-24 10:24:29
- [apps/web-console/src/lib/config.ts](apps/web-console/src/lib/config.ts) — 874 bytes; .ts; 修改于 2026-10-24 10:24:09
- [apps/web-console/src/lib/server-api.ts](apps/web-console/src/lib/server-api.ts) — 2443 bytes; .ts; 修改于 2026-10-24 09:07:59
- [apps/web-console/src/styles.css](apps/web-console/src/styles.css) — 33109 bytes; .css; 修改于 2026-10-24 10:03:25
- [apps/web-console/tsconfig.json](apps/web-console/tsconfig.json) — 530 bytes; .json; 修改于 2026-10-24 08:47:09
- [apps/web-console/tsconfig.tsbuildinfo](apps/web-console/tsconfig.tsbuildinfo) — 135151 bytes; .tsbuildinfo; 修改于 2026-10-24 10:40:09
- [apps/workctx-cli/package.json](apps/workctx-cli/package.json) — 368 bytes; .json; 修改于 2026-10-21 07:02:12
- [apps/workctx-cli/src/cli.ts](apps/workctx-cli/src/cli.ts) — 2667 bytes; .ts; 修改于 2026-10-21 07:02:33
- [apps/workctx-cli/src/index.ts](apps/workctx-cli/src/index.ts) — 26 bytes; .ts; 修改于 2026-10-21 07:01:47

### artifacts

- [artifacts/command-reports/p8-business-recovery-current2/p8-business-recovery-current2-resilience.json](artifacts/command-reports/p8-business-recovery-current2/p8-business-recovery-current2-resilience.json) — 3275 bytes; .json; 修改于 2026-10-23 07:08:03
- [artifacts/command-reports/p8-dependency-matrix-current/p8-dependency-matrix-current-resilience.json](artifacts/command-reports/p8-dependency-matrix-current/p8-dependency-matrix-current-resilience.json) — 6167 bytes; .json; 修改于 2026-10-23 06:37:01
- [artifacts/command-reports/p8-network-partition-current4/p8-network-partition-current4-resilience.json](artifacts/command-reports/p8-network-partition-current4/p8-network-partition-current4-resilience.json) — 1807 bytes; .json; 修改于 2026-10-23 06:58:32
- [artifacts/command-reports/p8-process-kill-current/p8-process-kill-current-resilience.json](artifacts/command-reports/p8-process-kill-current/p8-process-kill-current-resilience.json) — 1179 bytes; .json; 修改于 2026-10-23 06:55:46
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/bitnamilegacy_minio_2025.7.23-debian-12-r5.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/bitnamilegacy_minio_2025.7.23-debian-12-r5.json) — 1584034 bytes; .json; 修改于 2026-10-23 06:41:50
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/bitnamilegacy_minio_2025.7.23-debian-12-r5.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/bitnamilegacy_minio_2025.7.23-debian-12-r5.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:50
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/makeplane_plane-backend_v0.26.0.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/makeplane_plane-backend_v0.26.0.json) — 372629 bytes; .json; 修改于 2026-10-23 06:41:47
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/makeplane_plane-backend_v0.26.0.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/makeplane_plane-backend_v0.26.0.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:47
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/nats_2.10.22-alpine.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/nats_2.10.22-alpine.json) — 372625 bytes; .json; 修改于 2026-10-23 06:41:55
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/nats_2.10.22-alpine.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/nats_2.10.22-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:55
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/otel_opentelemetry-collector-contrib_0.107.0.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/otel_opentelemetry-collector-contrib_0.107.0.json) — 493674 bytes; .json; 修改于 2026-10-23 06:42:15
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/otel_opentelemetry-collector-contrib_0.107.0.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/otel_opentelemetry-collector-contrib_0.107.0.log) — 0 bytes; .log; 修改于 2026-10-23 06:42:15
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem_ai-memory_3.1.1-local.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem_ai-memory_3.1.1-local.json) — 5622 bytes; .json; 修改于 2026-10-23 06:41:51
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem_ai-memory_3.1.1-local.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem_ai-memory_3.1.1-local.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:51
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem-platform_0.1.0-wavemate.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem-platform_0.1.0-wavemate.json) — 10972 bytes; .json; 修改于 2026-10-23 06:41:45
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem-platform_0.1.0-wavemate.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/planemem-platform_0.1.0-wavemate.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:45
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/postgres_16.4-alpine.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/postgres_16.4-alpine.json) — 528241 bytes; .json; 修改于 2026-10-23 06:41:52
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/postgres_16.4-alpine.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/postgres_16.4-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:52
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/quay.io_keycloak_keycloak_26.0.5.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/quay.io_keycloak_keycloak_26.0.5.json) — 418633 bytes; .json; 修改于 2026-10-23 06:42:13
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/quay.io_keycloak_keycloak_26.0.5.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/quay.io_keycloak_keycloak_26.0.5.log) — 0 bytes; .log; 修改于 2026-10-23 06:42:13
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/rabbitmq_3.13-management-alpine.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/rabbitmq_3.13-management-alpine.json) — 353148 bytes; .json; 修改于 2026-10-23 06:41:48
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/rabbitmq_3.13-management-alpine.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/rabbitmq_3.13-management-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:48
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/redis_7.4.1-alpine.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/redis_7.4.1-alpine.json) — 496285 bytes; .json; 修改于 2026-10-23 06:41:54
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/redis_7.4.1-alpine.log](artifacts/command-reports/p8-vulnerability-scan-command-current2/redis_7.4.1-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:41:54
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/remediation.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/remediation.json) — 30627 bytes; .json; 修改于 2026-10-23 06:47:06
- [artifacts/command-reports/p8-vulnerability-scan-command-current2/summary.json](artifacts/command-reports/p8-vulnerability-scan-command-current2/summary.json) — 2600 bytes; .json; 修改于 2026-10-23 06:42:15
- [artifacts/command-reports/plan-audit-20261024025947-plan-audit.json](artifacts/command-reports/plan-audit-20261024025947-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 10:59:47
- [artifacts/command-reports/plan-audit-20261024025954-plan-audit.json](artifacts/command-reports/plan-audit-20261024025954-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 10:59:54
- [artifacts/command-reports/plan-audit-20261024030027-plan-audit.json](artifacts/command-reports/plan-audit-20261024030027-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 11:00:27
- [artifacts/command-reports/plan-audit-20261024030055-plan-audit.json](artifacts/command-reports/plan-audit-20261024030055-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 11:00:55
- [artifacts/command-reports/plan-audit-20261024030110-plan-audit.json](artifacts/command-reports/plan-audit-20261024030110-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 11:01:11
- [artifacts/command-reports/plan-audit-20261024030126-plan-audit.json](artifacts/command-reports/plan-audit-20261024030126-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 11:01:26
- [artifacts/command-reports/plan-audit-20261024030200-plan-audit.json](artifacts/command-reports/plan-audit-20261024030200-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 11:02:00
- [artifacts/command-reports/plan-audit-20261024030215-plan-audit.json](artifacts/command-reports/plan-audit-20261024030215-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 11:02:15
- [artifacts/command-reports/plan-audit-20261024035158-plan-audit.json](artifacts/command-reports/plan-audit-20261024035158-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-24 11:51:58
- [artifacts/command-reports/plan-audit-20261024162307-plan-audit.json](artifacts/command-reports/plan-audit-20261024162307-plan-audit.json) — 766 bytes; .json; 修改于 2026-10-25 00:23:07
- [artifacts/command-reports/rc-readiness-20261024025516-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024025516-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 10:55:18
- [artifacts/command-reports/rc-readiness-20261024025721-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024025721-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 10:57:21
- [artifacts/command-reports/rc-readiness-20261024025819-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024025819-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 10:58:20
- [artifacts/command-reports/rc-readiness-20261024025947-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024025947-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 10:59:47
- [artifacts/command-reports/rc-readiness-20261024025954-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024025954-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 10:59:55
- [artifacts/command-reports/rc-readiness-20261024030027-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024030027-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 11:00:28
- [artifacts/command-reports/rc-readiness-20261024030055-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024030055-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 11:00:55
- [artifacts/command-reports/rc-readiness-20261024030110-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024030110-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 11:01:11
- [artifacts/command-reports/rc-readiness-20261024030126-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024030126-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 11:01:27
- [artifacts/command-reports/rc-readiness-20261024030200-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024030200-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 11:02:00
- [artifacts/command-reports/rc-readiness-20261024030215-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024030215-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 11:02:16
- [artifacts/command-reports/rc-readiness-20261024035158-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024035158-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-24 11:51:59
- [artifacts/command-reports/rc-readiness-20261024162307-rc-readiness.json](artifacts/command-reports/rc-readiness-20261024162307-rc-readiness.json) — 1474 bytes; .json; 修改于 2026-10-25 00:23:08
- [artifacts/command-reports/realistic-baseline-final.json](artifacts/command-reports/realistic-baseline-final.json) — 8557 bytes; .json; 修改于 2026-10-25 00:25:52
- [artifacts/command-reports/realistic-baseline.json](artifacts/command-reports/realistic-baseline.json) — 8497 bytes; .json; 修改于 2026-10-25 00:15:28
- [artifacts/command-reports/realistic-reset-verified.json](artifacts/command-reports/realistic-reset-verified.json) — 8557 bytes; .json; 修改于 2026-10-25 00:17:50
- [artifacts/command-reports/realistic-transition-verified.json](artifacts/command-reports/realistic-transition-verified.json) — 8650 bytes; .json; 修改于 2026-10-25 00:17:25
- [artifacts/command-reports/realistic-transition.json](artifacts/command-reports/realistic-transition.json) — 8553 bytes; .json; 修改于 2026-10-25 00:16:41
- [artifacts/command-reports/realistic-ui-verified.json](artifacts/command-reports/realistic-ui-verified.json) — 1785 bytes; .json; 修改于 2026-10-25 00:32:06
- [artifacts/command-reports/sbom-wavemate-current4/sbom.cdx.json](artifacts/command-reports/sbom-wavemate-current4/sbom.cdx.json) — 5132 bytes; .json; 修改于 2026-10-23 06:11:16
- [artifacts/command-reports/trivy-images-current4/bitnamilegacy_minio_2025.7.23-debian-12-r5.json](artifacts/command-reports/trivy-images-current4/bitnamilegacy_minio_2025.7.23-debian-12-r5.json) — 1584479 bytes; .json; 修改于 2026-10-23 06:22:45
- [artifacts/command-reports/trivy-images-current4/bitnamilegacy_minio_2025.7.23-debian-12-r5.log](artifacts/command-reports/trivy-images-current4/bitnamilegacy_minio_2025.7.23-debian-12-r5.log) — 0 bytes; .log; 修改于 2026-10-23 06:22:34
- [artifacts/command-reports/trivy-images-current4/makeplane_plane-backend_v0.26.0.json](artifacts/command-reports/trivy-images-current4/makeplane_plane-backend_v0.26.0.json) — 373009 bytes; .json; 修改于 2026-10-23 06:22:26
- [artifacts/command-reports/trivy-images-current4/makeplane_plane-backend_v0.26.0.log](artifacts/command-reports/trivy-images-current4/makeplane_plane-backend_v0.26.0.log) — 0 bytes; .log; 修改于 2026-10-23 06:22:13
- [artifacts/command-reports/trivy-images-current4/nats_2.10.22-alpine.json](artifacts/command-reports/trivy-images-current4/nats_2.10.22-alpine.json) — 372740 bytes; .json; 修改于 2026-10-23 06:23:13
- [artifacts/command-reports/trivy-images-current4/nats_2.10.22-alpine.log](artifacts/command-reports/trivy-images-current4/nats_2.10.22-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:23:11
- [artifacts/command-reports/trivy-images-current4/otel_opentelemetry-collector-contrib_0.107.0.json](artifacts/command-reports/trivy-images-current4/otel_opentelemetry-collector-contrib_0.107.0.json) — 493683 bytes; .json; 修改于 2026-10-23 06:28:35
- [artifacts/command-reports/trivy-images-current4/otel_opentelemetry-collector-contrib_0.107.0.log](artifacts/command-reports/trivy-images-current4/otel_opentelemetry-collector-contrib_0.107.0.log) — 0 bytes; .log; 修改于 2026-10-23 06:28:26
- [artifacts/command-reports/trivy-images-current4/planemem_ai-memory_3.1.1-local.json](artifacts/command-reports/trivy-images-current4/planemem_ai-memory_3.1.1-local.json) — 5672 bytes; .json; 修改于 2026-10-23 06:22:52
- [artifacts/command-reports/trivy-images-current4/planemem_ai-memory_3.1.1-local.log](artifacts/command-reports/trivy-images-current4/planemem_ai-memory_3.1.1-local.log) — 0 bytes; .log; 修改于 2026-10-23 06:22:45
- [artifacts/command-reports/trivy-images-current4/planemem-platform_0.1.0-wavemate.json](artifacts/command-reports/trivy-images-current4/planemem-platform_0.1.0-wavemate.json) — 11562 bytes; .json; 修改于 2026-10-23 06:22:13
- [artifacts/command-reports/trivy-images-current4/planemem-platform_0.1.0-wavemate.log](artifacts/command-reports/trivy-images-current4/planemem-platform_0.1.0-wavemate.log) — 0 bytes; .log; 修改于 2026-10-23 06:21:35
- [artifacts/command-reports/trivy-images-current4/postgres_16.4-alpine.json](artifacts/command-reports/trivy-images-current4/postgres_16.4-alpine.json) — 528446 bytes; .json; 修改于 2026-10-23 06:23:06
- [artifacts/command-reports/trivy-images-current4/postgres_16.4-alpine.log](artifacts/command-reports/trivy-images-current4/postgres_16.4-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:22:52
- [artifacts/command-reports/trivy-images-current4/quay.io_keycloak_keycloak_26.0.5.json](artifacts/command-reports/trivy-images-current4/quay.io_keycloak_keycloak_26.0.5.json) — 418873 bytes; .json; 修改于 2026-10-23 06:28:26
- [artifacts/command-reports/trivy-images-current4/quay.io_keycloak_keycloak_26.0.5.log](artifacts/command-reports/trivy-images-current4/quay.io_keycloak_keycloak_26.0.5.log) — 0 bytes; .log; 修改于 2026-10-23 06:23:13
- [artifacts/command-reports/trivy-images-current4/rabbitmq_3.13-management-alpine.json](artifacts/command-reports/trivy-images-current4/rabbitmq_3.13-management-alpine.json) — 353509 bytes; .json; 修改于 2026-10-23 06:22:34
- [artifacts/command-reports/trivy-images-current4/rabbitmq_3.13-management-alpine.log](artifacts/command-reports/trivy-images-current4/rabbitmq_3.13-management-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:22:26
- [artifacts/command-reports/trivy-images-current4/redis_7.4.1-alpine.json](artifacts/command-reports/trivy-images-current4/redis_7.4.1-alpine.json) — 496470 bytes; .json; 修改于 2026-10-23 06:23:11
- [artifacts/command-reports/trivy-images-current4/redis_7.4.1-alpine.log](artifacts/command-reports/trivy-images-current4/redis_7.4.1-alpine.log) — 0 bytes; .log; 修改于 2026-10-23 06:23:06
- [artifacts/command-reports/trivy-images-current4/summary.json](artifacts/command-reports/trivy-images-current4/summary.json) — 3112 bytes; .json; 修改于 2026-10-23 06:28:44
- [artifacts/command-reports/trivy-wavemate-current4/summary.json](artifacts/command-reports/trivy-wavemate-current4/summary.json) — 504 bytes; .json; 修改于 2026-10-23 06:17:03
- [artifacts/command-reports/trivy-wavemate-current4/trivy.json](artifacts/command-reports/trivy-wavemate-current4/trivy.json) — 11562 bytes; .json; 修改于 2026-10-23 06:16:08
- [artifacts/command-reports/trivy-wavemate-current4/trivy.log](artifacts/command-reports/trivy-wavemate-current4/trivy.log) — 26792 bytes; .log; 修改于 2026-10-23 06:16:08
- [artifacts/command-reports/wavemate-k3s-ui-retry1/restore-verification.json](artifacts/command-reports/wavemate-k3s-ui-retry1/restore-verification.json) — 342 bytes; .json; 修改于 2026-10-22 20:40:44
- [artifacts/command-reports/wavemate-k3s-ui-retry1/traffic.json](artifacts/command-reports/wavemate-k3s-ui-retry1/traffic.json) — 7818 bytes; .json; 修改于 2026-10-22 20:38:13
- [artifacts/command-reports/wavemate-k3s-ui-retry1/wavemate-k3s-ui-retry1-wavemate-ui.json](artifacts/command-reports/wavemate-k3s-ui-retry1/wavemate-k3s-ui-retry1-wavemate-ui.json) — 10645 bytes; .json; 修改于 2026-10-22 20:38:13
- [artifacts/runtime/runtime-manifest.json](artifacts/runtime/runtime-manifest.json) — 830 bytes; .json; 修改于 2026-10-24 11:21:09
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/health.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/health.json) — 1974 bytes; .json; 修改于 2026-10-22 19:18:20
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/helm-rendered.yaml](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/helm-rendered.yaml) — 1341 bytes; .yaml; 修改于 2026-10-22 19:44:22
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/image-digests.txt](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/image-digests.txt) — 532 bytes; .txt; 修改于 2026-10-22 19:45:02
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/manifest.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/manifest.json) — 13228 bytes; .json; 修改于 2026-10-23 06:07:23
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/node-recovery-platform.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/node-recovery-platform.json) — 2105 bytes; .json; 修改于 2026-10-22 22:56:49
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/node-recovery.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/node-recovery.json) — 813 bytes; .json; 修改于 2026-10-22 22:57:45
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/plane-to-mcp-wavemate-current4-functional.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/plane-to-mcp-wavemate-current4-functional.json) — 17881 bytes; .json; 修改于 2026-10-23 06:06:52
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/remote-status-current.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/remote-status-current.json) — 1628 bytes; .json; 修改于 2026-10-22 22:34:19
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/rollback.txt](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/rollback.txt) — 338 bytes; .txt; 修改于 2026-10-22 19:45:02
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/rollout.txt](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/rollout.txt) — 751 bytes; .txt; 修改于 2026-10-22 19:45:02
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/test-summary.txt](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/test-summary.txt) — 835 bytes; .txt; 修改于 2026-10-22 22:57:45
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/transfer-hashes.txt](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/transfer-hashes.txt) — 433 bytes; .txt; 修改于 2026-10-22 19:45:02
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current2-restore-verification.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current2-restore-verification.json) — 421 bytes; .json; 修改于 2026-10-22 23:46:07
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current2-traffic.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current2-traffic.json) — 7838 bytes; .json; 修改于 2026-10-22 23:29:46
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current2.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current2.json) — 10686 bytes; .json; 修改于 2026-10-22 23:29:46
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current3-negative.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current3-negative.json) — 8256 bytes; .json; 修改于 2026-10-22 23:44:01
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current3-restore-verification.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current3-restore-verification.json) — 351 bytes; .json; 修改于 2026-10-22 23:44:01
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current4-restore-verification.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current4-restore-verification.json) — 351 bytes; .json; 修改于 2026-10-22 23:59:02
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current4-traffic.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current4-traffic.json) — 7838 bytes; .json; 修改于 2026-10-22 23:59:02
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current4.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-current4.json) — 10844 bytes; .json; 修改于 2026-10-22 23:59:02
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-negative-attempt.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-negative-attempt.json) — 430 bytes; .json; 修改于 2026-10-22 20:40:44
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-report.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-report.json) — 10645 bytes; .json; 修改于 2026-10-22 20:38:13
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-restore-verification.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-restore-verification.json) — 342 bytes; .json; 修改于 2026-10-22 20:40:44
- [artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-traffic.json](artifacts/test-reports/k3s/20261022T2038-wavemate-ui/wavemate-ui-traffic.json) — 7818 bytes; .json; 修改于 2026-10-22 20:38:13

### assets

- [assets/planemem-admin-4k.png](assets/planemem-admin-4k.png) — 7590272 bytes; .png; 修改于 2026-10-23 22:50:30
- [assets/planemem-architecture-4k.png](assets/planemem-architecture-4k.png) — 8942409 bytes; .png; 修改于 2026-10-21 09:13:29
- [assets/planemem-architecture-chatgpt-images-25-base.png](assets/planemem-architecture-chatgpt-images-25-base.png) — 1894798 bytes; .png; 修改于 2026-10-21 09:04:32
- [assets/planemem-audit-4k.png](assets/planemem-audit-4k.png) — 8137080 bytes; .png; 修改于 2026-10-23 22:50:29
- [assets/planemem-conflicts-4k.png](assets/planemem-conflicts-4k.png) — 8205646 bytes; .png; 修改于 2026-10-24 10:51:04
- [assets/planemem-context-4k.png](assets/planemem-context-4k.png) — 7928217 bytes; .png; 修改于 2026-10-23 22:50:27
- [assets/planemem-dashboard-overview-4k.png](assets/planemem-dashboard-overview-4k.png) — 7858877 bytes; .png; 修改于 2026-10-23 06:46:55
- [assets/planemem-handoffs-4k.png](assets/planemem-handoffs-4k.png) — 7933979 bytes; .png; 修改于 2026-10-24 10:51:03
- [assets/planemem-handoffs-conflicts-4k.png](assets/planemem-handoffs-conflicts-4k.png) — 8379172 bytes; .png; 修改于 2026-10-23 06:46:58
- [assets/planemem-sessions-4k.png](assets/planemem-sessions-4k.png) — 7374156 bytes; .png; 修改于 2026-10-23 22:50:28
- [assets/planemem-work-item-detail-4k.png](assets/planemem-work-item-detail-4k.png) — 8227251 bytes; .png; 修改于 2026-10-23 06:46:56
- [assets/planemem-work-items-4k.png](assets/planemem-work-items-4k.png) — 8922764 bytes; .png; 修改于 2026-10-23 22:50:26

### deploy

- [deploy/compose/.env.example](deploy/compose/.env.example) — 882 bytes; .example; 修改于 2026-10-21 07:16:22
- [deploy/compose/docker-compose.local-test.yml](deploy/compose/docker-compose.local-test.yml) — 3554 bytes; .yml; 修改于 2026-10-23 09:07:04
- [deploy/compose/docker-compose.opa-test.yml](deploy/compose/docker-compose.opa-test.yml) — 649 bytes; .yml; 修改于 2026-10-23 07:44:47
- [deploy/compose/docker-compose.yml](deploy/compose/docker-compose.yml) — 4996 bytes; .yml; 修改于 2026-10-23 09:07:04
- [deploy/compose/health/doctor.mjs](deploy/compose/health/doctor.mjs) — 1778 bytes; .mjs; 修改于 2026-10-21 00:26:40
- [deploy/compose/health/healthcheck.mjs](deploy/compose/health/healthcheck.mjs) — 774 bytes; .mjs; 修改于 2026-10-21 00:26:40
- [deploy/compose/Justfile](deploy/compose/Justfile) — 579 bytes; (none); 修改于 2026-10-21 00:26:40
- [deploy/compose/Makefile](deploy/compose/Makefile) — 672 bytes; (none); 修改于 2026-10-21 00:26:40
- [deploy/compose/otel-collector.yaml](deploy/compose/otel-collector.yaml) — 232 bytes; .yaml; 修改于 2026-10-21 00:26:40
- [deploy/compose/realistic-workbench-transition.sql](deploy/compose/realistic-workbench-transition.sql) — 1189 bytes; .sql; 修改于 2026-10-24 23:23:14
- [deploy/compose/seed-realistic-workbench.sql](deploy/compose/seed-realistic-workbench.sql) — 24299 bytes; .sql; 修改于 2026-10-25 00:37:15
- [deploy/compose/seed.sql](deploy/compose/seed.sql) — 6483 bytes; .sql; 修改于 2026-10-24 08:37:18
- [deploy/helm/planemem/Chart.yaml](deploy/helm/planemem/Chart.yaml) — 128 bytes; .yaml; 修改于 2026-10-21 07:12:51
- [deploy/helm/planemem/templates/deployment.yaml](deploy/helm/planemem/templates/deployment.yaml) — 1057 bytes; .yaml; 修改于 2026-10-21 13:03:27
- [deploy/helm/planemem/templates/service.yaml](deploy/helm/planemem/templates/service.yaml) — 175 bytes; .yaml; 修改于 2026-10-21 07:12:51
- [deploy/helm/planemem/values.schema.json](deploy/helm/planemem/values.schema.json) — 426 bytes; .json; 修改于 2026-10-21 07:12:51
- [deploy/helm/planemem/values.yaml](deploy/helm/planemem/values.yaml) — 390 bytes; .yaml; 修改于 2026-10-21 07:12:51
- [deploy/images/platform/Dockerfile](deploy/images/platform/Dockerfile) — 1038 bytes; (none); 修改于 2026-10-24 11:41:57
- [deploy/k3s/smoke/Dockerfile](deploy/k3s/smoke/Dockerfile) — 113 bytes; (none); 修改于 2026-10-21 09:44:27
- [deploy/k3s/smoke/nginx.conf](deploy/k3s/smoke/nginx.conf) — 358 bytes; .conf; 修改于 2026-10-21 09:23:37
- [deploy/keycloak/realm.json](deploy/keycloak/realm.json) — 307 bytes; .json; 修改于 2026-10-21 07:15:09
- [deploy/migrations/001_baseline.sql](deploy/migrations/001_baseline.sql) — 1961 bytes; .sql; 修改于 2026-10-21 00:26:40
- [deploy/migrations/002_contracts.sql](deploy/migrations/002_contracts.sql) — 1119 bytes; .sql; 修改于 2026-10-21 00:26:40
- [deploy/migrations/003_artifacts.sql](deploy/migrations/003_artifacts.sql) — 1717 bytes; .sql; 修改于 2026-10-21 06:46:29
- [deploy/migrations/004_sessions.sql](deploy/migrations/004_sessions.sql) — 1912 bytes; .sql; 修改于 2026-10-21 06:58:25
- [deploy/migrations/005_sync.sql](deploy/migrations/005_sync.sql) — 1419 bytes; .sql; 修改于 2026-10-21 06:58:25
- [deploy/migrations/006_outbox.sql](deploy/migrations/006_outbox.sql) — 846 bytes; .sql; 修改于 2026-10-21 06:58:31
- [deploy/migrations/007_audit.sql](deploy/migrations/007_audit.sql) — 1014 bytes; .sql; 修改于 2026-10-21 07:08:20
- [deploy/migrations/008_workbench_projection.sql](deploy/migrations/008_workbench_projection.sql) — 4288 bytes; .sql; 修改于 2026-10-24 08:37:18
- [deploy/observability/prometheus.yml](deploy/observability/prometheus.yml) — 173 bytes; .yml; 修改于 2026-10-21 07:08:20
- [deploy/opa/policy.rego](deploy/opa/policy.rego) — 624 bytes; .rego; 修改于 2026-10-23 07:46:40
- [deploy/release-manifest.yaml](deploy/release-manifest.yaml) — 560 bytes; .yaml; 修改于 2026-10-21 07:12:51
- [deploy/search/feature-flags.yaml](deploy/search/feature-flags.yaml) — 118 bytes; .yaml; 修改于 2026-10-21 07:12:00

### docs — 项目文档与设计

- [docs/design/00-baseline/01-scope-and-success.md](docs/design/00-baseline/01-scope-and-success.md) — 2084 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/00-baseline/02-authority-and-planes.md](docs/design/00-baseline/02-authority-and-planes.md) — 2273 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/00-baseline/03-domain-model.md](docs/design/00-baseline/03-domain-model.md) — 1845 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/00-baseline/04-client-switch-and-handoff.md](docs/design/00-baseline/04-client-switch-and-handoff.md) — 1802 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/00-baseline/05-memory-system.md](docs/design/00-baseline/05-memory-system.md) — 3397 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/00-baseline/06-security-and-governance.md](docs/design/00-baseline/06-security-and-governance.md) — 1463 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/00-baseline/07-architecture-decisions.md](docs/design/00-baseline/07-architecture-decisions.md) — 1541 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/00-baseline/README.md](docs/design/00-baseline/README.md) — 1227 bytes; .md; 修改于 2026-10-21 08:01:46
- [docs/design/01-contracts/canonical-events.md](docs/design/01-contracts/canonical-events.md) — 1851 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/01-contracts/mcp-interface.md](docs/design/01-contracts/mcp-interface.md) — 1491 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/01-contracts/README.md](docs/design/01-contracts/README.md) — 547 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/01-contracts/schema-versioning.md](docs/design/01-contracts/schema-versioning.md) — 812 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/01-contracts/wcp-api.md](docs/design/01-contracts/wcp-api.md) — 1843 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P0/README.md](docs/design/02-subprojects/P0/README.md) — 2859 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P1/README.md](docs/design/02-subprojects/P1/README.md) — 2744 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P2/README.md](docs/design/02-subprojects/P2/README.md) — 4023 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P3/README.md](docs/design/02-subprojects/P3/README.md) — 3794 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P4/README.md](docs/design/02-subprojects/P4/README.md) — 3867 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P5/README.md](docs/design/02-subprojects/P5/README.md) — 3334 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P6/README.md](docs/design/02-subprojects/P6/README.md) — 4637 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P7/README.md](docs/design/02-subprojects/P7/README.md) — 3902 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/P8/README.md](docs/design/02-subprojects/P8/README.md) — 6024 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/README.md](docs/design/02-subprojects/README.md) — 1264 bytes; .md; 修改于 2026-10-21 08:01:46
- [docs/design/02-subprojects/tasks/README.md](docs/design/02-subprojects/tasks/README.md) — 2727 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t0.1-monorepo-ci.md](docs/design/02-subprojects/tasks/t0.1-monorepo-ci.md) — 3548 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t0.2-foundation-contracts.md](docs/design/02-subprojects/tasks/t0.2-foundation-contracts.md) — 3579 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t0.3-entity-schemas.md](docs/design/02-subprojects/tasks/t0.3-entity-schemas.md) — 3513 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t0.4-event-schemas.md](docs/design/02-subprojects/tasks/t0.4-event-schemas.md) — 3495 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t0.5-sdk-fixtures.md](docs/design/02-subprojects/tasks/t0.5-sdk-fixtures.md) — 3482 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t0.6-local-infra.md](docs/design/02-subprojects/tasks/t0.6-local-infra.md) — 3530 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t1.1-plane-version-matrix.md](docs/design/02-subprojects/tasks/t1.1-plane-version-matrix.md) — 3451 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t1.2-plane-rest-client.md](docs/design/02-subprojects/tasks/t1.2-plane-rest-client.md) — 3489 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t1.3-webhook-security.md](docs/design/02-subprojects/tasks/t1.3-webhook-security.md) — 3432 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t1.4-webhook-dedup-replay.md](docs/design/02-subprojects/tasks/t1.4-webhook-dedup-replay.md) — 3480 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t1.5-plane-projection.md](docs/design/02-subprojects/tasks/t1.5-plane-projection.md) — 3497 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t2.1-artifact-metadata.md](docs/design/02-subprojects/tasks/t2.1-artifact-metadata.md) — 3509 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t2.2-memory-adapter.md](docs/design/02-subprojects/tasks/t2.2-memory-adapter.md) — 3660 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t2.3-context-layers.md](docs/design/02-subprojects/tasks/t2.3-context-layers.md) — 3496 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t2.4-context-compiler.md](docs/design/02-subprojects/tasks/t2.4-context-compiler.md) — 3548 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t2.5-fts-resources.md](docs/design/02-subprojects/tasks/t2.5-fts-resources.md) — 3494 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t3.1-session-model.md](docs/design/02-subprojects/tasks/t3.1-session-model.md) — 3477 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t3.2-checkpoint-handoff.md](docs/design/02-subprojects/tasks/t3.2-checkpoint-handoff.md) — 3519 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t3.3-sync-cursor-batch.md](docs/design/02-subprojects/tasks/t3.3-sync-cursor-batch.md) — 3401 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t3.4-sqlite-outbox.md](docs/design/02-subprojects/tasks/t3.4-sqlite-outbox.md) — 3429 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t3.5-conflict-service.md](docs/design/02-subprojects/tasks/t3.5-conflict-service.md) — 3436 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t4.1-api-gateway.md](docs/design/02-subprojects/tasks/t4.1-api-gateway.md) — 4256 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t4.2-mcp-gateway.md](docs/design/02-subprojects/tasks/t4.2-mcp-gateway.md) — 3446 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t4.3-workctx-cli.md](docs/design/02-subprojects/tasks/t4.3-workctx-cli.md) — 3413 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t4.4-client-adapters.md](docs/design/02-subprojects/tasks/t4.4-client-adapters.md) — 3500 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t5.1-workbench-query.md](docs/design/02-subprojects/tasks/t5.1-workbench-query.md) — 3411 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t5.2-workbench-handoff-conflict.md](docs/design/02-subprojects/tasks/t5.2-workbench-handoff-conflict.md) — 3425 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t5.3-workbench-admin.md](docs/design/02-subprojects/tasks/t5.3-workbench-admin.md) — 3392 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t6.1-identity-policy.md](docs/design/02-subprojects/tasks/t6.1-identity-policy.md) — 4300 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t6.2-audit-governance.md](docs/design/02-subprojects/tasks/t6.2-audit-governance.md) — 4332 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t6.3-observability.md](docs/design/02-subprojects/tasks/t6.3-observability.md) — 3965 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t7.1-golden-evaluation.md](docs/design/02-subprojects/tasks/t7.1-golden-evaluation.md) — 4112 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t7.2-intelligence-workers.md](docs/design/02-subprojects/tasks/t7.2-intelligence-workers.md) — 4030 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t7.3-search-vector.md](docs/design/02-subprojects/tasks/t7.3-search-vector.md) — 3925 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t8.1-integration-e2e-resilience.md](docs/design/02-subprojects/tasks/t8.1-integration-e2e-resilience.md) — 5832 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t8.2-compose-helm.md](docs/design/02-subprojects/tasks/t8.2-compose-helm.md) — 5757 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/02-subprojects/tasks/t8.3-release-rollback.md](docs/design/02-subprojects/tasks/t8.3-release-rollback.md) — 5209 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/03-integration/01-task-handoff-contract.md](docs/design/03-integration/01-task-handoff-contract.md) — 2421 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/03-integration/02-integration-environment.md](docs/design/03-integration/02-integration-environment.md) — 960 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/03-integration/03-end-to-end-chains.md](docs/design/03-integration/03-end-to-end-chains.md) — 1505 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/03-integration/04-module-interface-contracts.md](docs/design/03-integration/04-module-interface-contracts.md) — 20448 bytes; .md; 修改于 2026-10-23 12:13:12
- [docs/design/03-integration/05-module-contract-test-matrix.md](docs/design/03-integration/05-module-contract-test-matrix.md) — 6113 bytes; .md; 修改于 2026-10-23 12:13:12
- [docs/design/03-integration/06-wavemate-mcp-contract.md](docs/design/03-integration/06-wavemate-mcp-contract.md) — 4414 bytes; .md; 修改于 2026-10-22 20:47:33
- [docs/design/03-integration/README.md](docs/design/03-integration/README.md) — 1610 bytes; .md; 修改于 2026-10-22 13:14:12
- [docs/design/04-testing/02-fault-security-performance.md](docs/design/04-testing/02-fault-security-performance.md) — 958 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/04-testing/clients/01-wavemate-0.24.1-live-verification.md](docs/design/04-testing/clients/01-wavemate-0.24.1-live-verification.md) — 5728 bytes; .md; 修改于 2026-10-23 06:01:15
- [docs/design/04-testing/command-runner-contract.md](docs/design/04-testing/command-runner-contract.md) — 8744 bytes; .md; 修改于 2026-10-23 09:51:26
- [docs/design/04-testing/modules/P0-independent-verification.md](docs/design/04-testing/modules/P0-independent-verification.md) — 7904 bytes; .md; 修改于 2026-10-21 08:49:49
- [docs/design/04-testing/modules/P1-independent-verification.md](docs/design/04-testing/modules/P1-independent-verification.md) — 6711 bytes; .md; 修改于 2026-10-21 07:53:54
- [docs/design/04-testing/modules/P2-independent-verification.md](docs/design/04-testing/modules/P2-independent-verification.md) — 8366 bytes; .md; 修改于 2026-10-22 08:06:24
- [docs/design/04-testing/modules/P3-independent-verification.md](docs/design/04-testing/modules/P3-independent-verification.md) — 7858 bytes; .md; 修改于 2026-10-22 08:35:33
- [docs/design/04-testing/modules/P4-independent-verification.md](docs/design/04-testing/modules/P4-independent-verification.md) — 7783 bytes; .md; 修改于 2026-10-22 23:15:15
- [docs/design/04-testing/modules/P5-independent-verification.md](docs/design/04-testing/modules/P5-independent-verification.md) — 6552 bytes; .md; 修改于 2026-10-21 07:06:27
- [docs/design/04-testing/modules/P6-independent-verification.md](docs/design/04-testing/modules/P6-independent-verification.md) — 7584 bytes; .md; 修改于 2026-10-23 08:24:07
- [docs/design/04-testing/modules/P7-independent-verification.md](docs/design/04-testing/modules/P7-independent-verification.md) — 6737 bytes; .md; 修改于 2026-10-21 07:14:44
- [docs/design/04-testing/modules/P8-independent-verification.md](docs/design/04-testing/modules/P8-independent-verification.md) — 17945 bytes; .md; 修改于 2026-10-23 09:57:42
- [docs/design/04-testing/modules/README.md](docs/design/04-testing/modules/README.md) — 1367 bytes; .md; 修改于 2026-10-20 22:55:01
- [docs/design/04-testing/README.md](docs/design/04-testing/README.md) — 3397 bytes; .md; 修改于 2026-10-24 08:07:09
- [docs/design/05-release/01-release-deployment-rollback.md](docs/design/05-release/01-release-deployment-rollback.md) — 1734 bytes; .md; 修改于 2026-10-24 08:07:10
- [docs/design/05-release/02-runbook-index.md](docs/design/05-release/02-runbook-index.md) — 675 bytes; .md; 修改于 2026-10-24 08:07:10
- [docs/design/05-release/03-rc-gate-execution.md](docs/design/05-release/03-rc-gate-execution.md) — 9509 bytes; .md; 修改于 2026-10-23 09:56:36
- [docs/design/05-release/04-k3s-test-deployment.md](docs/design/05-release/04-k3s-test-deployment.md) — 14694 bytes; .md; 修改于 2026-10-23 12:14:04
- [docs/design/05-release/05-offline-image-build-transfer.md](docs/design/05-release/05-offline-image-build-transfer.md) — 12220 bytes; .md; 修改于 2026-10-23 12:14:04
- [docs/design/05-release/06-dependency-image-remediation.md](docs/design/05-release/06-dependency-image-remediation.md) — 4601 bytes; .md; 修改于 2026-10-23 09:56:13
- [docs/design/05-release/07-functional-acceptance-scope.md](docs/design/05-release/07-functional-acceptance-scope.md) — 2781 bytes; .md; 修改于 2026-10-23 09:50:49
- [docs/design/05-release/README.md](docs/design/05-release/README.md) — 2589 bytes; .md; 修改于 2026-10-23 09:50:49
- [docs/design/06-planning/00-overall-development-plan.md](docs/design/06-planning/00-overall-development-plan.md) — 24169 bytes; .md; 修改于 2026-10-23 12:14:18
- [docs/design/06-planning/03-test-data-and-functional-validation-plan.md](docs/design/06-planning/03-test-data-and-functional-validation-plan.md) — 7366 bytes; .md; 修改于 2026-10-23 09:58:06
- [docs/design/06-planning/04-current-verification-status.md](docs/design/06-planning/04-current-verification-status.md) — 23520 bytes; .md; 修改于 2026-10-23 12:39:44
- [docs/design/06-planning/05-completion-audit.md](docs/design/06-planning/05-completion-audit.md) — 11942 bytes; .md; 修改于 2026-10-23 12:42:34
- [docs/design/06-planning/modules/P0-development-plan.md](docs/design/06-planning/modules/P0-development-plan.md) — 12154 bytes; .md; 修改于 2026-10-20 23:02:34
- [docs/design/06-planning/modules/P1-development-plan.md](docs/design/06-planning/modules/P1-development-plan.md) — 11083 bytes; .md; 修改于 2026-10-20 23:02:34
- [docs/design/06-planning/modules/P2-development-plan.md](docs/design/06-planning/modules/P2-development-plan.md) — 11010 bytes; .md; 修改于 2026-10-20 23:02:34
- [docs/design/06-planning/modules/P3-development-plan.md](docs/design/06-planning/modules/P3-development-plan.md) — 10989 bytes; .md; 修改于 2026-10-20 23:02:34
- [docs/design/06-planning/modules/P4-development-plan.md](docs/design/06-planning/modules/P4-development-plan.md) — 10066 bytes; .md; 修改于 2026-10-22 08:38:28
- [docs/design/06-planning/modules/P5-development-plan.md](docs/design/06-planning/modules/P5-development-plan.md) — 9275 bytes; .md; 修改于 2026-10-20 23:02:34
- [docs/design/06-planning/modules/P6-development-plan.md](docs/design/06-planning/modules/P6-development-plan.md) — 10275 bytes; .md; 修改于 2026-10-23 08:30:56
- [docs/design/06-planning/modules/P7-development-plan.md](docs/design/06-planning/modules/P7-development-plan.md) — 9609 bytes; .md; 修改于 2026-10-21 07:57:38
- [docs/design/06-planning/modules/P8-development-plan.md](docs/design/06-planning/modules/P8-development-plan.md) — 11370 bytes; .md; 修改于 2026-10-23 12:14:33
- [docs/design/06-planning/README.md](docs/design/06-planning/README.md) — 1897 bytes; .md; 修改于 2026-10-22 07:00:13
- [docs/design/README.md](docs/design/README.md) — 2894 bytes; .md; 修改于 2026-10-24 08:07:10
- [docs/design/vendor/ai-memory-adoption.md](docs/design/vendor/ai-memory-adoption.md) — 2827 bytes; .md; 修改于 2026-10-24 08:07:10
- [docs/design/vendor/README.md](docs/design/vendor/README.md) — 867 bytes; .md; 修改于 2026-10-21 08:01:46
- [docs/runbooks/alerts.md](docs/runbooks/alerts.md) — 1027 bytes; .md; 修改于 2026-10-21 07:08:20
- [docs/runbooks/release.md](docs/runbooks/release.md) — 1032 bytes; .md; 修改于 2026-10-21 07:12:51
- [docs/runbooks/web-console-auth.md](docs/runbooks/web-console-auth.md) — 4157 bytes; .md; 修改于 2026-10-24 10:33:49
- [docs/runbooks/web-console-deployment.md](docs/runbooks/web-console-deployment.md) — 6470 bytes; .md; 修改于 2026-10-25 00:36:26
- [docs/superpowers/ledgers/2026-10-24-plane-workbench-ui-implementation.md](docs/superpowers/ledgers/2026-10-24-plane-workbench-ui-implementation.md) — 6653 bytes; .md; 修改于 2026-10-25 00:34:32
- [docs/superpowers/plans/2026-10-20-plane-work-continuity-platform.md](docs/superpowers/plans/2026-10-20-plane-work-continuity-platform.md) — 51851 bytes; .md; 修改于 2026-10-24 08:07:10
- [docs/superpowers/plans/2026-10-24-plane-workbench-ui-implementation.md](docs/superpowers/plans/2026-10-24-plane-workbench-ui-implementation.md) — 2860 bytes; .md; 修改于 2026-10-24 08:23:47
- [docs/traceability/requirements-matrix.yaml](docs/traceability/requirements-matrix.yaml) — 8071 bytes; .yaml; 修改于 2026-10-24 08:07:10

### integrations

- [integrations/claude-code/adapter.ts](integrations/claude-code/adapter.ts) — 53 bytes; .ts; 修改于 2026-10-21 07:01:59
- [integrations/codex/adapter.ts](integrations/codex/adapter.ts) — 2267 bytes; .ts; 修改于 2026-10-21 07:02:12
- [integrations/deepseek/adapter.ts](integrations/deepseek/adapter.ts) — 53 bytes; .ts; 修改于 2026-10-21 07:01:59
- [integrations/plane/compatibility.yaml](integrations/plane/compatibility.yaml) — 385 bytes; .yaml; 修改于 2026-10-21 06:40:45
- [integrations/support-matrix.yaml](integrations/support-matrix.yaml) — 419 bytes; .yaml; 修改于 2026-10-21 07:01:59
- [integrations/workbuddy/adapter.ts](integrations/workbuddy/adapter.ts) — 53 bytes; .ts; 修改于 2026-10-21 07:01:59

### LICENSE

- [LICENSE](LICENSE) — 1080 bytes; (none); 修改于 2026-10-24 08:07:09

### package.json

- [package.json](package.json) — 3631 bytes; .json; 修改于 2026-10-25 00:34:10

### packages

- [packages/auth/package.json](packages/auth/package.json) — 368 bytes; .json; 修改于 2026-10-21 07:08:47
- [packages/auth/src/classification.ts](packages/auth/src/classification.ts) — 1106 bytes; .ts; 修改于 2026-10-21 07:09:13
- [packages/auth/src/index.ts](packages/auth/src/index.ts) — 66 bytes; .ts; 修改于 2026-10-21 07:07:40
- [packages/auth/src/policy.ts](packages/auth/src/policy.ts) — 694 bytes; .ts; 修改于 2026-10-21 07:08:47
- [packages/context-compiler/package.json](packages/context-compiler/package.json) — 329 bytes; .json; 修改于 2026-10-21 06:48:32
- [packages/context-compiler/schemas/context-item.json](packages/context-compiler/schemas/context-item.json) — 1594 bytes; .json; 修改于 2026-10-21 06:53:13
- [packages/context-compiler/src/compile.ts](packages/context-compiler/src/compile.ts) — 3779 bytes; .ts; 修改于 2026-10-21 06:52:25
- [packages/context-compiler/src/index.ts](packages/context-compiler/src/index.ts) — 66 bytes; .ts; 修改于 2026-10-21 06:43:43
- [packages/context-compiler/src/layers/layers.ts](packages/context-compiler/src/layers/layers.ts) — 1333 bytes; .ts; 修改于 2026-10-21 06:53:10
- [packages/contracts/package.json](packages/contracts/package.json) — 328 bytes; .json; 修改于 2026-10-20 23:40:33
- [packages/contracts/schemas/common.json](packages/contracts/schemas/common.json) — 1149 bytes; .json; 修改于 2026-10-20 23:50:40
- [packages/contracts/schemas/entities/Approval.json](packages/contracts/schemas/entities/Approval.json) — 2227 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Artifact.json](packages/contracts/schemas/entities/Artifact.json) — 2317 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Checkpoint.json](packages/contracts/schemas/entities/Checkpoint.json) — 2193 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Conflict.json](packages/contracts/schemas/entities/Conflict.json) — 2414 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/ContextPack.json](packages/contracts/schemas/entities/ContextPack.json) — 2205 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Decision.json](packages/contracts/schemas/entities/Decision.json) — 2182 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Handoff.json](packages/contracts/schemas/entities/Handoff.json) — 2254 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Project.json](packages/contracts/schemas/entities/Project.json) — 2170 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Risk.json](packages/contracts/schemas/entities/Risk.json) — 2210 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Session.json](packages/contracts/schemas/entities/Session.json) — 2096 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/Tenant.json](packages/contracts/schemas/entities/Tenant.json) — 1974 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/schemas/entities/WorkItem.json](packages/contracts/schemas/entities/WorkItem.json) — 2205 bytes; .json; 修改于 2026-10-21 00:03:53
- [packages/contracts/src/entities.ts](packages/contracts/src/entities.ts) — 13298 bytes; .ts; 修改于 2026-10-21 00:11:11
- [packages/contracts/src/errors.ts](packages/contracts/src/errors.ts) — 2188 bytes; .ts; 修改于 2026-10-20 23:50:40
- [packages/contracts/src/idempotency.ts](packages/contracts/src/idempotency.ts) — 1628 bytes; .ts; 修改于 2026-10-20 23:50:40
- [packages/contracts/src/ids.ts](packages/contracts/src/ids.ts) — 1360 bytes; .ts; 修改于 2026-10-20 23:50:40
- [packages/contracts/src/index.ts](packages/contracts/src/index.ts) — 217 bytes; .ts; 修改于 2026-10-20 23:58:41
- [packages/contracts/src/metadata.ts](packages/contracts/src/metadata.ts) — 4807 bytes; .ts; 修改于 2026-10-20 23:51:36
- [packages/contracts/src/pagination.ts](packages/contracts/src/pagination.ts) — 1933 bytes; .ts; 修改于 2026-10-20 23:51:36
- [packages/contracts/src/versioning.ts](packages/contracts/src/versioning.ts) — 2263 bytes; .ts; 修改于 2026-10-20 23:50:54
- [packages/domain/package.json](packages/domain/package.json) — 360 bytes; .json; 修改于 2026-10-21 06:46:41
- [packages/domain/src/index.ts](packages/domain/src/index.ts) — 35 bytes; .ts; 修改于 2026-10-21 06:46:11
- [packages/domain/src/memory/index.ts](packages/domain/src/memory/index.ts) — 948 bytes; .ts; 修改于 2026-10-21 06:53:10
- [packages/events/package.json](packages/events/package.json) — 391 bytes; .json; 修改于 2026-10-21 00:13:06
- [packages/events/schemas/canonical-event.json](packages/events/schemas/canonical-event.json) — 2092 bytes; .json; 修改于 2026-10-21 00:16:49
- [packages/events/schemas/event-types.json](packages/events/schemas/event-types.json) — 1391 bytes; .json; 修改于 2026-10-21 00:16:49
- [packages/events/src/envelope.ts](packages/events/src/envelope.ts) — 9047 bytes; .ts; 修改于 2026-10-21 00:15:05
- [packages/events/src/index.ts](packages/events/src/index.ts) — 31 bytes; .ts; 修改于 2026-10-21 00:14:36
- [packages/observability/package.json](packages/observability/package.json) — 326 bytes; .json; 修改于 2026-10-21 07:08:47
- [packages/observability/src/health.ts](packages/observability/src/health.ts) — 740 bytes; .ts; 修改于 2026-10-21 07:08:47
- [packages/observability/src/index.ts](packages/observability/src/index.ts) — 87 bytes; .ts; 修改于 2026-10-21 07:08:20
- [packages/observability/src/metrics.ts](packages/observability/src/metrics.ts) — 1309 bytes; .ts; 修改于 2026-10-21 07:08:47
- [packages/observability/src/trace.ts](packages/observability/src/trace.ts) — 1549 bytes; .ts; 修改于 2026-10-21 07:08:47
- [packages/release/package.json](packages/release/package.json) — 207 bytes; .json; 修改于 2026-10-21 07:13:18
- [packages/release/src/backup.ts](packages/release/src/backup.ts) — 1259 bytes; .ts; 修改于 2026-10-21 07:13:18
- [packages/release/src/index.ts](packages/release/src/index.ts) — 91 bytes; .ts; 修改于 2026-10-21 07:12:40
- [packages/release/src/manifest.ts](packages/release/src/manifest.ts) — 2182 bytes; .ts; 修改于 2026-10-21 07:13:18
- [packages/release/src/rollback.ts](packages/release/src/rollback.ts) — 737 bytes; .ts; 修改于 2026-10-21 07:13:18
- [packages/sdk/package.json](packages/sdk/package.json) — 427 bytes; .json; 修改于 2026-10-21 00:18:53
- [packages/sdk/src/client.ts](packages/sdk/src/client.ts) — 1952 bytes; .ts; 修改于 2026-10-21 00:21:37
- [packages/sdk/src/index.ts](packages/sdk/src/index.ts) — 63 bytes; .ts; 修改于 2026-10-21 00:20:30
- [packages/sdk/src/mock-server.ts](packages/sdk/src/mock-server.ts) — 1678 bytes; .ts; 修改于 2026-10-21 00:21:47
- [packages/test-fixtures/fixtures/p0-fixture.json](packages/test-fixtures/fixtures/p0-fixture.json) — 496 bytes; .json; 修改于 2026-10-21 00:23:09
- [packages/test-fixtures/package.json](packages/test-fixtures/package.json) — 437 bytes; .json; 修改于 2026-10-21 00:18:53
- [packages/test-fixtures/src/index.ts](packages/test-fixtures/src/index.ts) — 4167 bytes; .ts; 修改于 2026-10-21 00:22:43

### pnpm-lock.yaml

- [pnpm-lock.yaml](pnpm-lock.yaml) — 42066 bytes; .yaml; 修改于 2026-10-24 09:09:12

### pnpm-workspace.yaml

- [pnpm-workspace.yaml](pnpm-workspace.yaml) — 86 bytes; .yaml; 修改于 2026-10-21 07:13:08

### ReadMe.md — 根目录说明

- [README.md](README.md) — 119348 bytes; .md; 修改于 2026-10-24 08:07:09

### tests

- [tests/contract/context/t2-context-contract.test.mjs](tests/contract/context/t2-context-contract.test.mjs) — 1589 bytes; .mjs; 修改于 2026-10-21 06:53:39
- [tests/contract/edge-contract-matrix.test.mjs](tests/contract/edge-contract-matrix.test.mjs) — 2101 bytes; .mjs; 修改于 2026-10-21 07:57:16
- [tests/contract/p3-session-sync-contract.test.mjs](tests/contract/p3-session-sync-contract.test.mjs) — 963 bytes; .mjs; 修改于 2026-10-21 06:59:18
- [tests/contract/p4-gateway-contract.test.mjs](tests/contract/p4-gateway-contract.test.mjs) — 782 bytes; .mjs; 修改于 2026-10-21 07:03:03
- [tests/contract/p5-workbench-contract.test.mjs](tests/contract/p5-workbench-contract.test.mjs) — 741 bytes; .mjs; 修改于 2026-10-21 07:05:39
- [tests/contract/p6-security-contract.test.mjs](tests/contract/p6-security-contract.test.mjs) — 951 bytes; .mjs; 修改于 2026-10-21 07:08:47
- [tests/contract/p7-intelligence-contract.test.mjs](tests/contract/p7-intelligence-contract.test.mjs) — 703 bytes; .mjs; 修改于 2026-10-21 07:15:09
- [tests/contract/p8-release-contract.test.mjs](tests/contract/p8-release-contract.test.mjs) — 847 bytes; .mjs; 修改于 2026-10-22 13:36:32
- [tests/contract/t0.1-workspace-contract.test.mjs](tests/contract/t0.1-workspace-contract.test.mjs) — 590 bytes; .mjs; 修改于 2026-10-20 23:41:42
- [tests/p0/t0-tooling.test.mjs](tests/p0/t0-tooling.test.mjs) — 5371 bytes; .mjs; 修改于 2026-10-21 23:33:23
- [tests/p0/t0.1-monorepo.test.mjs](tests/p0/t0.1-monorepo.test.mjs) — 1541 bytes; .mjs; 修改于 2026-10-20 23:53:57
- [tests/p0/t0.2-foundation-contracts.test.ts](tests/p0/t0.2-foundation-contracts.test.ts) — 4383 bytes; .ts; 修改于 2026-10-20 23:52:27
- [tests/p0/t0.3-entity-schemas.test.ts](tests/p0/t0.3-entity-schemas.test.ts) — 3044 bytes; .ts; 修改于 2026-10-21 00:04:40
- [tests/p0/t0.4-event-schemas.test.ts](tests/p0/t0.4-event-schemas.test.ts) — 3224 bytes; .ts; 修改于 2026-10-21 00:15:31
- [tests/p0/t0.5-sdk-fixtures.test.ts](tests/p0/t0.5-sdk-fixtures.test.ts) — 2555 bytes; .ts; 修改于 2026-10-21 00:23:18
- [tests/p0/t0.6-local-infra.test.mjs](tests/p0/t0.6-local-infra.test.mjs) — 2551 bytes; .mjs; 修改于 2026-10-21 00:24:39
- [tests/p1/t1-plane-connector.test.ts](tests/p1/t1-plane-connector.test.ts) — 5820 bytes; .ts; 修改于 2026-10-21 06:40:23
- [tests/p2/t2-context.test.ts](tests/p2/t2-context.test.ts) — 8389 bytes; .ts; 修改于 2026-10-21 06:53:50
- [tests/p3/t3-session-sync.test.ts](tests/p3/t3-session-sync.test.ts) — 9320 bytes; .ts; 修改于 2026-10-21 06:59:18
- [tests/p3/t3-sqlite-live-probe.test.mjs](tests/p3/t3-sqlite-live-probe.test.mjs) — 1161 bytes; .mjs; 修改于 2026-10-22 08:28:07
- [tests/p4/t4-gateways.test.ts](tests/p4/t4-gateways.test.ts) — 6548 bytes; .ts; 修改于 2026-10-21 19:05:41
- [tests/p4/t4-runtime.test.ts](tests/p4/t4-runtime.test.ts) — 9467 bytes; .ts; 修改于 2026-10-22 13:03:14
- [tests/p5/t5-web-console-contract.test.mjs](tests/p5/t5-web-console-contract.test.mjs) — 1337 bytes; .mjs; 修改于 2026-10-24 09:07:59
- [tests/p5/t5-workbench-repository.test.ts](tests/p5/t5-workbench-repository.test.ts) — 4530 bytes; .ts; 修改于 2026-10-24 10:32:43
- [tests/p5/t5-workbench.test.ts](tests/p5/t5-workbench.test.ts) — 3348 bytes; .ts; 修改于 2026-10-21 07:05:39
- [tests/p6/t6-identity-audit-live.test.mjs](tests/p6/t6-identity-audit-live.test.mjs) — 1726 bytes; .mjs; 修改于 2026-10-23 07:22:54
- [tests/p6/t6-runtime-audit.test.ts](tests/p6/t6-runtime-audit.test.ts) — 3111 bytes; .ts; 修改于 2026-10-23 08:33:06
- [tests/p6/t6-security-observability.test.ts](tests/p6/t6-security-observability.test.ts) — 4854 bytes; .ts; 修改于 2026-10-23 07:34:29
- [tests/p7/t7-intelligence-search.test.ts](tests/p7/t7-intelligence-search.test.ts) — 3445 bytes; .ts; 修改于 2026-10-21 07:14:07
- [tests/p8/t8-image-vulnerability.test.mjs](tests/p8/t8-image-vulnerability.test.mjs) — 4018 bytes; .mjs; 修改于 2026-10-23 09:19:15
- [tests/p8/t8-k3s-wavemate-evidence.test.mjs](tests/p8/t8-k3s-wavemate-evidence.test.mjs) — 10339 bytes; .mjs; 修改于 2026-10-23 07:08:50
- [tests/p8/t8-live-gates.test.mjs](tests/p8/t8-live-gates.test.mjs) — 12716 bytes; .mjs; 修改于 2026-10-23 07:06:59
- [tests/p8/t8-live-platform-probe.test.mjs](tests/p8/t8-live-platform-probe.test.mjs) — 4705 bytes; .mjs; 修改于 2026-10-22 08:14:15
- [tests/p8/t8-release-deploy.test.ts](tests/p8/t8-release-deploy.test.ts) — 4238 bytes; .ts; 修改于 2026-10-21 23:20:14
- [tests/p8/t8-release-tooling.test.mjs](tests/p8/t8-release-tooling.test.mjs) — 6550 bytes; .mjs; 修改于 2026-10-22 13:36:32
- [tests/p8/t8-wavemate-live.test.mjs](tests/p8/t8-wavemate-live.test.mjs) — 2484 bytes; .mjs; 修改于 2026-10-22 13:04:46

### tools — 可重复执行的维护脚本

- [tools/build-offline-image.ps1](tools/build-offline-image.ps1) — 6023 bytes; .ps1; 修改于 2026-10-21 13:03:09
- [tools/command-utils.mjs](tools/command-utils.mjs) — 1990 bytes; .mjs; 修改于 2026-10-21 07:24:43
- [tools/evidence-cli.mjs](tools/evidence-cli.mjs) — 3885 bytes; .mjs; 修改于 2026-10-21 07:45:05
- [tools/fixture-cli.mjs](tools/fixture-cli.mjs) — 4057 bytes; .mjs; 修改于 2026-10-21 07:45:05
- [tools/generate_development_plans.mjs](tools/generate_development_plans.mjs) — 35290 bytes; .mjs; 修改于 2026-10-20 23:40:33
- [tools/generate_module_verification_docs.mjs](tools/generate_module_verification_docs.mjs) — 30484 bytes; .mjs; 修改于 2026-10-20 23:40:33
- [tools/live-platform-probe.mjs](tools/live-platform-probe.mjs) — 9165 bytes; .mjs; 修改于 2026-10-22 08:15:44
- [tools/plan-audit.mjs](tools/plan-audit.mjs) — 6186 bytes; .mjs; 修改于 2026-10-23 07:15:08
- [tools/rc-readiness.mjs](tools/rc-readiness.mjs) — 5409 bytes; .mjs; 修改于 2026-10-22 07:12:56
- [tools/release-manifest-cli.mjs](tools/release-manifest-cli.mjs) — 2530 bytes; .mjs; 修改于 2026-10-21 07:45:05
- [tools/run-ai-memory-live-probe.mjs](tools/run-ai-memory-live-probe.mjs) — 6317 bytes; .mjs; 修改于 2026-10-22 07:59:39
- [tools/run-evaluation-tests.mjs](tools/run-evaluation-tests.mjs) — 1371 bytes; .mjs; 修改于 2026-10-21 07:28:17
- [tools/run-functional-tests.mjs](tools/run-functional-tests.mjs) — 11997 bytes; .mjs; 修改于 2026-10-23 06:05:16
- [tools/run-identity-audit-live-probe.mjs](tools/run-identity-audit-live-probe.mjs) — 11765 bytes; .mjs; 修改于 2026-10-23 07:49:36
- [tools/run-image-vulnerability-scan.mjs](tools/run-image-vulnerability-scan.mjs) — 6741 bytes; .mjs; 修改于 2026-10-23 09:19:15
- [tools/run-module-tests.mjs](tools/run-module-tests.mjs) — 2231 bytes; .mjs; 修改于 2026-10-21 07:39:30
- [tools/run-performance-tests.mjs](tools/run-performance-tests.mjs) — 6187 bytes; .mjs; 修改于 2026-10-22 12:17:52
- [tools/run-realistic-web-console-smoke.mjs](tools/run-realistic-web-console-smoke.mjs) — 2920 bytes; .mjs; 修改于 2026-10-25 00:31:54
- [tools/run-realistic-workbench-acceptance.mjs](tools/run-realistic-workbench-acceptance.mjs) — 12045 bytes; .mjs; 修改于 2026-10-25 00:22:48
- [tools/run-release-tests.mjs](tools/run-release-tests.mjs) — 14128 bytes; .mjs; 修改于 2026-10-22 22:15:35
- [tools/run-resilience-tests.mjs](tools/run-resilience-tests.mjs) — 25315 bytes; .mjs; 修改于 2026-10-23 07:06:41
- [tools/run-security-tests.mjs](tools/run-security-tests.mjs) — 6847 bytes; .mjs; 修改于 2026-10-23 07:49:36
- [tools/run-sqlite-live-probe.mjs](tools/run-sqlite-live-probe.mjs) — 3883 bytes; .mjs; 修改于 2026-10-22 08:27:25
- [tools/run-wavemate-live-probe.mjs](tools/run-wavemate-live-probe.mjs) — 11008 bytes; .mjs; 修改于 2026-10-22 13:23:17
- [tools/run-wavemate-ui-live-probe.mjs](tools/run-wavemate-ui-live-probe.mjs) — 15059 bytes; .mjs; 修改于 2026-10-22 23:48:33
- [tools/sbom-cli.mjs](tools/sbom-cli.mjs) — 2413 bytes; .mjs; 修改于 2026-10-21 07:45:05
- [tools/stage-runtime.mjs](tools/stage-runtime.mjs) — 4337 bytes; .mjs; 修改于 2026-10-24 10:56:59
- [tools/transfer-offline-image.ps1](tools/transfer-offline-image.ps1) — 1837 bytes; .ps1; 修改于 2026-10-21 10:48:50
- [tools/update-file-index.ps1](tools/update-file-index.ps1) — 6254 bytes; .ps1; 修改于 2026-10-24 11:50:45

### tsconfig.base.json

- [tsconfig.base.json](tsconfig.base.json) — 331 bytes; .json; 修改于 2026-10-20 23:40:33

### tsconfig.build.json

- [tsconfig.build.json](tsconfig.build.json) — 376 bytes; .json; 修改于 2026-10-24 09:07:03

### tsconfig.json

- [tsconfig.json](tsconfig.json) — 219 bytes; .json; 修改于 2026-10-24 09:07:03

### turbo.json

- [turbo.json](turbo.json) — 405 bytes; .json; 修改于 2026-10-20 23:40:33

### workers

- [workers/evaluation/datasets/golden-v1.json](workers/evaluation/datasets/golden-v1.json) — 366 bytes; .json; 修改于 2026-10-21 07:13:18
- [workers/evaluation/package.json](workers/evaluation/package.json) — 210 bytes; .json; 修改于 2026-10-21 07:13:18
- [workers/evaluation/src/evaluate.ts](workers/evaluation/src/evaluate.ts) — 3075 bytes; .ts; 修改于 2026-10-21 07:13:18
- [workers/evaluation/src/index.ts](workers/evaluation/src/index.ts) — 31 bytes; .ts; 修改于 2026-10-21 07:12:00
- [workers/intelligence/package.json](workers/intelligence/package.json) — 212 bytes; .json; 修改于 2026-10-21 07:13:18
- [workers/intelligence/src/index.ts](workers/intelligence/src/index.ts) — 32 bytes; .ts; 修改于 2026-10-21 07:12:00
- [workers/intelligence/src/proposals.ts](workers/intelligence/src/proposals.ts) — 4514 bytes; .ts; 修改于 2026-10-21 07:13:18

