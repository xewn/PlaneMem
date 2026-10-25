# SDD ledger — plan: docs/superpowers/plans/2026-10-24-plane-workbench-ui-implementation.md

Pre-flight: current branch is a managed worktree copied from the user workspace; no committed application baseline exists, so verification will use package and integration commands against the copied source tree.

Implementation evidence (2026-10-24):

- Added `apps/web-console` Next.js App Router with the eight requested views and shared dark-neon visual system.
- Added API-side OIDC verification and a signed server-only session cookie.
- The verifier discovers issuer metadata, loads and caches RSA JWKS, validates RS256 signatures, issuer, audience, subject, expiry and not-before claims, and returns a traceable 401 for invalid workbench tokens when AUTH_SERVER_ISSUER is configured.
- Verified the existing live Hedou AuthServer discovery and the HdWeb_Shell public client. A real Next start on port 43123 redirected /auth/login to the live authorize endpoint with the expected callback, PKCE challenge and Base scope; PlaneMem_WebConsole was confirmed absent from that live registration and remains documented as a production registration step.
- Final verification passed after these changes: pnpm run lint, web-console typecheck/build, root build, P5 tests (10/10), and git diff --check. No temporary listener or .env.local remains.
- Added separate ChatGPT Images 2.5 visual references for Handoffs and Conflicts; all eight menu pages now have individual 3840x2160 PNG references in assets, alongside the architecture diagram.
- Full module verification now passes 105/105 tests. The offline RC readiness report is locally passed but externally blocked because Docker is installed without a running daemon and the current workstation has no k3s kubeconfig or production database credentials; this remains an explicit deployment prerequisite.
- Added `apps/api-gateway/src/workbench/repository.ts`, `POST /v1/workbench/query`, migration `008_workbench_projection.sql`, and scoped seed rows.
- Added configurable OpenIddict authorization-code + PKCE routes and documented the required `PlaneMem_WebConsole` client registration.
- Verified `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm run test -- --directory tests/p5`, the web-console production build, a `next start` route smoke for all eight pages, and a bearer/trace/source-ref API smoke.
- The supplied `.231/.232/.233` addresses are k3s nodes. The live cluster did not expose a documented PlaneMem/AuthServer endpoint or credentials in this workspace, so endpoint values remain environment-driven and no node address is guessed as a database or issuer URL.
- Reworked all eight routes against the supplied 4K references: the overview now has the three-row dashboard composition; work items, context, sessions, handoffs, conflicts, audit and admin now include the reference-level filters, metrics, tables, drawers, timelines, confirmations, diff/JSON and health panels.
- Verified each route through a local authenticated proxy with scoped response-shaped data and inspected the rendered UI at the browser viewport. Temporary proxy processes and `.env.local` were removed after verification; no demo endpoint or cookie is part of the worktree.


Live deployment evidence (2026-10-24):

- Connected to the supplied k3s cluster through 192.168.1.233 and verified nodes 192.168.1.231, 192.168.1.232, and 192.168.1.233 are Ready on k3s v1.36.5+k3s1.
- Built and pushed `registry.hedou.top:5000/planemem/platform:0.1.0-workbench-r3` with digest `sha256:07e3a5baaf4c9b32b8ea303b4a4eb4c6167a7cb5781d181e59c4e00f66def6cc`; the Deployment is 3/3 Ready with one pod on each node.
- Added Docker image ownership on staged `dist` and runtime directories so the unprivileged Node process can read the compiled API. The registry TLS trust configuration is present on all three k3s nodes; credentials remain in Kubernetes Secret only.
- Started a persistent PostgreSQL 16 container on .233 with a named volume, applied migrations 001 through 008 plus seed, and verified real rows: projects 1, work items 5, context items 4, sessions 2, audit records 2.
- Live `/v1/workbench/query` calls for all eight operations returned 200 with PostgreSQL `source_refs`; overview returned active 4, blocked 1, completed 1, active sessions 1 and open conflicts 0.
- Temporarily disabled issuer enforcement only for the database proof, then restored `AUTH_SERVER_ISSUER=https://auth.hedou.top` and `AUTH_SERVER_AUDIENCE=Base`, restarted the Deployment, and verified missing and malformed Bearer tokens return 401. No secret values were logged or committed.

Realistic closed-loop evidence (2026-10-25, Asia/Shanghai):

- Added `deploy/compose/seed-realistic-workbench.sql`, a deterministic fixture covering 15 work items, 10 context items across L0-L4, 6 sessions, 4 handoffs, 4 conflicts, 5 agent runs, 5 tool calls, a latest context pack, 3 sync events, and 14 business audit records.
- Added `deploy/compose/realistic-workbench-transition.sql` to model a real state change: `real-w-134` moves from blocked to in_progress, `real-conflict-01` moves from open to resolved, and a transition audit record is persisted.
- Added `tools/run-realistic-workbench-acceptance.mjs` and `test:workbench-realistic`. It validates all eight API operations, PostgreSQL source references, per-row provenance, telemetry, status coverage, audit result coverage, scope isolation, and expected aggregate counts.
- Live baseline run passed through the deployed API: 15 work items, 10 context items, 6 sessions, 4 handoffs, 4 conflicts, overview active 11 / blocked 2 / completed 3 / active sessions 3 / open conflicts 3.
- Live transition run passed after applying the SQL transition: overview blocked changed to 1 and open conflicts changed to 2; the transition audit record was present. Reapplying the fixture passed a final baseline reset check.
- The deployed image had drifted to an older `runtime-closure` tag during validation and returned 404 for `/v1/workbench/query`; it was restored and pinned to the verified workbench digest, then rolled out 3/3 across .231/.232/.233. OIDC issuer and audience were restored afterward, with malformed and missing Bearer requests returning 401.
- Added `tools/run-realistic-web-console-smoke.mjs` and `test:workbench-ui-realistic`; the local production Next server rendered all eight routes with the same real API and fixture scope. The 8/8 route smoke passed and matched real markers for work items, context, sessions, handoffs, conflicts, audit and PostgreSQL admin health. The temporary `.env.local`, signed smoke cookie, Next process and port-forward were removed afterward.
