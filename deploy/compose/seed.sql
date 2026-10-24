INSERT INTO wcp_tenants (id, name, classification)
VALUES ('01HF7YAT000000000000000001', 'tenant-demo', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO wcp_workspaces (id, tenant_id, name, classification)
VALUES (
  '01HF7YAT000000000000000002',
  '01HF7YAT000000000000000001',
  'workspace-demo',
  'internal'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wcp_projects (id, tenant_id, workspace_id, name, external_id, classification)
VALUES (
  '01HF7YAT000000000000000003',
  '01HF7YAT000000000000000001',
  '01HF7YAT000000000000000002',
  'project-continuity',
  'fixture-demo-project',
  'internal'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wcp_work_items
  (id, tenant_id, workspace_id, project_id, external_id, title, status, priority, owner, progress, description, due_at, classification, source_refs, trace_id)
VALUES
  ('01HF7YAT000000000000000101', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-128', 'Implement ContextPack compiler', 'in_progress', 'P0', 'Platform Team', 60, 'Build compiler to package project context into portable ContextPack format.', '2026-11-12T00:00:00Z', 'internal', '[{"type":"plane","id":"W-128"}]', 'trace_seed_work_128'),
  ('01HF7YAT000000000000000102', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-126', 'Design handoff format v2', 'todo', 'P0', 'Platform Team', 0, 'Define the v2 handoff format for richer context capture and restore.', '2026-11-08T00:00:00Z', 'internal', '[{"type":"plane","id":"W-126"}]', 'trace_seed_work_126'),
  ('01HF7YAT000000000000000103', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-127', 'Add incremental context sync', 'in_review', 'P1', 'Security', 90, 'Synchronize changed context across sessions.', '2026-11-04T00:00:00Z', 'internal', '[{"type":"plane","id":"W-127"}]', 'trace_seed_work_127'),
  ('01HF7YAT000000000000000104', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-122', 'Implement checkpoint restore', 'blocked', 'P0', 'Platform Team', 20, 'Implement restore flow from ContextPack checkpoints.', '2026-10-29T00:00:00Z', 'internal', '[{"type":"plane","id":"W-122"}]', 'trace_seed_work_122'),
  ('01HF7YAT000000000000000105', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-119', 'Initial project setup', 'done', 'P2', 'Platform Team', 100, 'Project scaffolding and development environment.', '2026-10-20T00:00:00Z', 'internal', '[{"type":"plane","id":"W-119"}]', 'trace_seed_work_119')
ON CONFLICT (id) DO NOTHING;

INSERT INTO wcp_context_items
  (id, tenant_id, workspace_id, project_id, title, item_type, layer, classification, status, source_ref, expires_at, confidence, priority, content, source_refs, trace_id)
VALUES
  ('01HF7YAT000000000000000201', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Decision: use event-driven sync', 'Decision', 'L2', 'internal', 'confirmed', 'docs/design/00-baseline/07-architecture-decisions.md', '2026-12-31T00:00:00Z', 0.940, 'High', '{"decision":"Use canonical events as the synchronization boundary."}', '[{"type":"docs","id":"architecture-decisions"}]', 'trace_seed_context_201'),
  ('01HF7YAT000000000000000202', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Project overview and goals', 'Document', 'L0', 'internal', 'confirmed', 'docs/design/00-baseline/01-scope-and-success.md', '2026-12-31T00:00:00Z', 0.930, 'High', '{"summary":"Keep work continuous across AI clients."}', '[{"type":"docs","id":"scope-and-success"}]', 'trace_seed_context_202'),
  ('01HF7YAT000000000000000203', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Current sprint plan', 'State', 'L1', 'internal', 'confirmed', 'plans/2026-10-sprint.md', '2026-11-15T00:00:00Z', 0.860, 'Medium', '{"summary":"Finish context compiler and handoff flow."}', '[{"type":"plan","id":"sprint-2026-10"}]', 'trace_seed_context_203'),
  ('01HF7YAT000000000000000204', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Recent deployment v0.4.1', 'Activity', 'L3', 'internal', 'confirmed', 'ops/deployments/2026-10-23.md', '2026-11-05T00:00:00Z', 0.780, 'Medium', '{"summary":"Gateway deployed with audit persistence."}', '[{"type":"deploy","id":"v0.4.1"}]', 'trace_seed_context_204')
ON CONFLICT (id) DO NOTHING;

INSERT INTO wcp_sessions
  (session_id, tenant_id, workspace_id, project_id, client_id, actor_id, status, trace_id, source_refs)
VALUES
  ('01HF7YAT000000000000000301', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'codex', 'actor-demo', 'running', 'trace_seed_session_301', '[{"type":"client","id":"codex"}]'),
  ('01HF7YAT000000000000000302', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'claude-code', 'actor-demo', 'paused', 'trace_seed_session_302', '[{"type":"client","id":"claude-code"}]')
ON CONFLICT (session_id) DO NOTHING;

INSERT INTO wcp_handoffs
  (handoff_id, tenant_id, workspace_id, project_id, session_id, status, offered_to, summary, source_refs, trace_id)
VALUES
  ('01HF7YAT000000000000000401', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', '01HF7YAT000000000000000301', 'offered', 'claude-code', 'Continue ContextPack compiler implementation and resolve API changes.', '[{"type":"session","id":"01HF7YAT000000000000000301"}]', 'trace_seed_handoff_401')
ON CONFLICT (handoff_id) DO NOTHING;

INSERT INTO wcp_audit_records
  (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, action, resource, result, classification, details, trace_id, source_refs, occurred_at)
VALUES
  ('01HF7YAT000000000000000501', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-demo', 'codex', 'context.read', 'workbench:context', 'allowed', 'internal', '{"source":"seed"}', 'trace_seed_audit_501', '[{"type":"fixture","id":"seed"}]', now()),
  ('01HF7YAT000000000000000502', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-demo', 'claude-code', 'handoff.claim', 'workbench:handoff', 'allowed', 'internal', '{"source":"seed"}', 'trace_seed_audit_502', '[{"type":"fixture","id":"seed"}]', now())
ON CONFLICT (audit_id) DO NOTHING;
