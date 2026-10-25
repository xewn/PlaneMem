# PlaneMem Workbench UI implementation plan

## Outcome

Turn the five 4K design references into one runnable Next.js workbench with all eight left-navigation views, pixel-aligned dark neon visual tokens, a real PostgreSQL read path, and OpenIddict login against the existing Hedou AuthServer.

## Approach

Use Next.js App Router inside `apps/web-console` as the presentation boundary. Keep all database access in the PlaneMem API Gateway, exposed through a versioned workbench query endpoint; the browser never connects directly to PostgreSQL. Use an authorization-code + PKCE adapter whose issuer/client values come from environment variables, so the existing AuthServer remains the identity authority and is not forked into this repository.

## Tasks

1. **Persistence and gateway query contract**
   - Add migration `008_workbench_projection.sql` for scoped work items, context items, context packs, decisions, risks and handoffs, plus deterministic demo seed rows.
   - Add a typed `WorkbenchRepository` that queries those tables and existing sessions, conflicts and audit rows with tenant/workspace/project filters.
   - Add `POST /v1/workbench/query` to the gateway with trace/source refs and explicit bearer/header context validation.
   - Add red tests for scope fencing and empty/error envelopes, then implement.

2. **Web console shell and authentication**
   - Convert `apps/web-console` to a Next.js app with App Router, a shared 8-item sidebar, top bar, command search, project selector and live sync status.
   - Add `/login`, `/auth/callback`, `/auth/logout`, server-side session cookie handling, PKCE state/nonce checks and configurable AuthServer issuer/client settings.
   - Add route-level loading, empty, denied and stale states.

3. **Pixel-aligned page views**
   - Implement Overview, Work Items, Context, Sessions, Handoffs, Conflicts, Audit and Admin routes using a shared card/table/chart token system and the provided design images as visual references.
   - Use server components for initial data and client components only for filters, drawers, tabs, confirmation flows and refresh polling.

4. **Verification and runbook**
   - Add component/contract tests for navigation, auth redirects, API scope headers and render states.
   - Run typecheck, lint, package tests, migration syntax checks and a local API smoke test against PostgreSQL when `DATABASE_URL` is supplied.
   - Document environment variables, AuthServer client registration and startup commands.

## Completion evidence

- `pnpm --filter @planemem/web-console build` succeeds.
- Gateway tests prove scoped SQL queries and trace-preserving responses.
- A browser smoke route can load a real project from PostgreSQL after AuthServer login.
- Every design route is reachable from the eight-item sidebar and uses the shared 4K-derived spacing, color and panel tokens.
