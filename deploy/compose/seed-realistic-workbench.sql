-- Deterministic realistic project fixture for closed-loop workbench validation.
-- It enriches the existing project-continuity scope without replacing the baseline seed.\n-- Run only against the controlled smoke database; the cleanup removes synthetic test audit rows.
BEGIN;

DELETE FROM wcp_audit_records
WHERE audit_id = 'real-transition-audit-01'
   OR client_id IN ('realistic-workbench-acceptance', 'web-console');

UPDATE wcp_projects
SET name = 'project-continuity',
    external_id = 'fixture-demo-project',
    classification = 'internal',
    updated_at = '2026-10-24T03:20:00Z'
WHERE id = '01HF7YAT000000000000000003';

INSERT INTO wcp_work_items
  (id, tenant_id, workspace_id, project_id, external_id, title, status, priority, owner, progress, description, due_at, classification, source_refs, trace_id, created_at, updated_at)
VALUES
  ('real-w-131', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-131', 'Define project release train', 'todo', 'P1', 'Release Engineering', 0, 'Set release gates and ownership for the November train.', '2026-11-03T00:00:00Z', 'internal', '[{"type":"plane","id":"W-131"}]', 'trace_real_work_131', '2026-10-18T09:00:00Z', '2026-10-24T02:10:00Z'),
  ('real-w-132', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-132', 'Implement tenant scope guard', 'in_progress', 'P0', 'Platform Team', 72, 'Finish request scope enforcement across REST and MCP boundaries.', '2026-10-30T00:00:00Z', 'internal', '[{"type":"plane","id":"W-132"},{"type":"review","id":"SEC-44"}]', 'trace_real_work_132', '2026-10-17T09:00:00Z', '2026-10-24T02:25:00Z'),
  ('real-w-133', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-133', 'Review ContextPack redaction', 'in_review', 'P1', 'Security', 88, 'Review the redaction policy and confirm restricted fields are excluded.', '2026-10-28T00:00:00Z', 'restricted', '[{"type":"plane","id":"W-133"},{"type":"policy","id":"POL-18"}]', 'trace_real_work_133', '2026-10-16T09:00:00Z', '2026-10-24T02:35:00Z'),
  ('real-w-134', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-134', 'Resolve checkpoint hash mismatch', 'blocked', 'P0', 'Platform Team', 35, 'Investigate divergent checkpoint hashes after a resumed session.', '2026-10-27T00:00:00Z', 'internal', '[{"type":"plane","id":"W-134"},{"type":"incident","id":"INC-77"}]', 'trace_real_work_134', '2026-10-15T09:00:00Z', '2026-10-24T02:40:00Z'),
  ('real-w-135', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-135', 'Publish operator runbook', 'done', 'P2', 'Developer Experience', 100, 'Publish the recovery and audit runbook for operators.', '2026-10-22T00:00:00Z', 'internal', '[{"type":"plane","id":"W-135"},{"type":"docs","id":"RUNBOOK-9"}]', 'trace_real_work_135', '2026-10-12T09:00:00Z', '2026-10-23T08:10:00Z'),
  ('real-w-136', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-136', 'Add connector retry budget', 'todo', 'P2', 'Integrations', 0, 'Define retry and backoff behavior for the Plane connector.', '2026-11-10T00:00:00Z', 'internal', '[{"type":"plane","id":"W-136"}]', 'trace_real_work_136', '2026-10-14T09:00:00Z', '2026-10-23T11:10:00Z'),
  ('real-w-137', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-137', 'Instrument query latency', 'in_progress', 'P1', 'Observability', 48, 'Add trace and percentile metrics to workbench queries.', '2026-11-05T00:00:00Z', 'internal', '[{"type":"plane","id":"W-137"},{"type":"metric","id":"LAT-12"}]', 'trace_real_work_137', '2026-10-13T09:00:00Z', '2026-10-23T14:10:00Z'),
  ('real-w-138', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-138', 'Verify audit export contract', 'in_review', 'P2', 'Compliance', 93, 'Check exported records against the audit schema and retention policy.', '2026-10-31T00:00:00Z', 'confidential', '[{"type":"plane","id":"W-138"},{"type":"audit","id":"AUD-31"}]', 'trace_real_work_138', '2026-10-11T09:00:00Z', '2026-10-23T17:10:00Z'),
  ('real-w-139', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-139', 'Prototype vector fallback', 'cancelled', 'P3', 'Search', 20, 'Cancelled after the deterministic lexical fallback was accepted.', '2026-10-21T00:00:00Z', 'internal', '[{"type":"plane","id":"W-139"},{"type":"decision","id":"DEC-22"}]', 'trace_real_work_139', '2026-10-09T09:00:00Z', '2026-10-22T17:10:00Z'),
  ('real-w-140', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'W-140', 'Complete initial data backfill', 'done', 'P1', 'Data Platform', 100, 'Backfill source references and verify project scope isolation.', '2026-10-23T00:00:00Z', 'internal', '[{"type":"plane","id":"W-140"},{"type":"migration","id":"MIG-8"}]', 'trace_real_work_140', '2026-10-08T09:00:00Z', '2026-10-23T18:10:00Z')
ON CONFLICT (id) DO UPDATE SET
  external_id = EXCLUDED.external_id, title = EXCLUDED.title, status = EXCLUDED.status,
  priority = EXCLUDED.priority, owner = EXCLUDED.owner, progress = EXCLUDED.progress,
  description = EXCLUDED.description, due_at = EXCLUDED.due_at, classification = EXCLUDED.classification,
  source_refs = EXCLUDED.source_refs, trace_id = EXCLUDED.trace_id,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, deleted_at = NULL;

INSERT INTO wcp_context_items
  (id, tenant_id, workspace_id, project_id, title, item_type, layer, classification, status, source_ref, expires_at, confidence, priority, content, source_refs, trace_id, created_at, updated_at)
VALUES
  ('real-c-205', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'North-star outcome', 'Goal', 'L0', 'internal', 'confirmed', 'docs/product/north-star.md', '2027-01-31T00:00:00Z', 0.970, 'High', '{"summary":"Keep project work resumable across clients with auditable context."}', '[{"type":"docs","id":"north-star"}]', 'trace_real_context_205', '2026-10-12T09:00:00Z', '2026-10-24T01:00:00Z'),
  ('real-c-206', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Release train plan', 'Plan', 'L1', 'internal', 'confirmed', 'plans/2026-11-release.md', '2026-11-30T00:00:00Z', 0.910, 'High', '{"summary":"Ship scope guard, handoff restore, and audit export in the next train."}', '[{"type":"plan","id":"release-train-2026-11"}]', 'trace_real_context_206', '2026-10-13T09:00:00Z', '2026-10-24T01:05:00Z'),
  ('real-c-207', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Decision: approval policy', 'Decision', 'L2', 'restricted', 'proposed', 'docs/policy/approval-policy.md', '2026-11-07T00:00:00Z', 0.710, 'High', '{"decision":"Require a human confirmation before restricted context is restored."}', '[{"type":"policy","id":"approval-policy"}]', 'trace_real_context_207', '2026-10-14T09:00:00Z', '2026-10-24T01:15:00Z'),
  ('real-c-208', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Legacy deployment note', 'Activity', 'L3', 'internal', 'expired', 'ops/deployments/2026-09-28.md', '2026-10-01T00:00:00Z', 0.420, 'Low', '{"summary":"Superseded by the October gateway deployment."}', '[{"type":"deploy","id":"v0.3.8"}]', 'trace_real_context_208', '2026-09-28T09:00:00Z', '2026-10-23T23:00:00Z'),
  ('real-c-209', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Plane API contract', 'Document', 'L4', 'public', 'confirmed', 'docs/integration/plane-api.md', '2027-01-15T00:00:00Z', 0.880, 'Medium', '{"summary":"Plane remains authoritative for external work-item identity and status."}', '[{"type":"docs","id":"plane-api-contract"}]', 'trace_real_context_209', '2026-10-15T09:00:00Z', '2026-10-24T01:35:00Z'),
  ('real-c-210', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'Risk register', 'Risk', 'L2', 'confidential', 'confirmed', 'risk/risk-register.md', '2026-12-15T00:00:00Z', 0.760, 'Medium', '{"summary":"Checkpoint divergence remains the highest recovery risk."}', '[{"type":"risk","id":"RISK-77"}]', 'trace_real_context_210', '2026-10-16T09:00:00Z', '2026-10-24T01:45:00Z')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, item_type = EXCLUDED.item_type, layer = EXCLUDED.layer,
  classification = EXCLUDED.classification, status = EXCLUDED.status, source_ref = EXCLUDED.source_ref,
  expires_at = EXCLUDED.expires_at, confidence = EXCLUDED.confidence, priority = EXCLUDED.priority,
  content = EXCLUDED.content, source_refs = EXCLUDED.source_refs, trace_id = EXCLUDED.trace_id,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, deleted_at = NULL;

INSERT INTO wcp_context_packs
  (pack_id, tenant_id, workspace_id, project_id, version, pack_hash, budget_tokens, used_tokens, scope, status, source_refs, trace_id, expires_at, created_at)
VALUES
  ('real-pack-01', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 4, 'sha256:real-context-pack-v4', 12000, 8450, '[{"type":"project","id":"01HF7YAT000000000000000003"},{"type":"layer","id":"L0-L4"}]', 'latest', '[{"type":"compiler","id":"context-compiler"},{"type":"docs","id":"north-star"}]', 'trace_real_pack_01', '2026-11-30T00:00:00Z', '2026-10-24T01:50:00Z')
ON CONFLICT (pack_id) DO UPDATE SET
  version = EXCLUDED.version, pack_hash = EXCLUDED.pack_hash, budget_tokens = EXCLUDED.budget_tokens,
  used_tokens = EXCLUDED.used_tokens, scope = EXCLUDED.scope, status = EXCLUDED.status,
  source_refs = EXCLUDED.source_refs, trace_id = EXCLUDED.trace_id, expires_at = EXCLUDED.expires_at,
  created_at = EXCLUDED.created_at;

INSERT INTO wcp_sessions
  (session_id, tenant_id, workspace_id, project_id, client_id, actor_id, parent_session_id, status, trace_id, source_refs, started_at, ended_at, created_at)
VALUES
  ('real-s-303', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'cursor', 'actor-reviewer', '01HF7YAT000000000000000301', 'running', 'trace_real_session_303', '[{"type":"client","id":"cursor"},{"type":"session","id":"01HF7YAT000000000000000301"}]', '2026-10-24T00:20:00Z', NULL, '2026-10-24T00:20:00Z'),
  ('real-s-304', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'github-actions', 'actor-ci', NULL, 'running', 'trace_real_session_304', '[{"type":"client","id":"github-actions"}]', '2026-10-24T00:50:00Z', NULL, '2026-10-24T00:50:00Z'),
  ('real-s-305', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'claude-code', 'actor-recovery', '01HF7YAT000000000000000302', 'ended', 'trace_real_session_305', '[{"type":"client","id":"claude-code"},{"type":"handoff","id":"real-h-403"}]', '2026-10-23T12:00:00Z', '2026-10-23T14:40:00Z', '2026-10-23T12:00:00Z'),
  ('real-s-306', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'codex', 'actor-recovery', NULL, 'failed', 'trace_real_session_306', '[{"type":"client","id":"codex"},{"type":"incident","id":"INC-77"}]', '2026-10-23T16:00:00Z', '2026-10-23T16:12:00Z', '2026-10-23T16:00:00Z')
ON CONFLICT (session_id) DO UPDATE SET
  client_id = EXCLUDED.client_id, actor_id = EXCLUDED.actor_id, parent_session_id = EXCLUDED.parent_session_id,
  status = EXCLUDED.status, trace_id = EXCLUDED.trace_id, source_refs = EXCLUDED.source_refs,
  started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, created_at = EXCLUDED.created_at;

INSERT INTO wcp_agent_runs
  (run_id, session_id, sequence_no, model, status, trace_id, source_refs)
VALUES
  ('real-run-303-1', 'real-s-303', 1, 'gpt-6.1-sol', 'running', 'trace_real_run_303_1', '[{"type":"session","id":"real-s-303"}]'),
  ('real-run-303-2', 'real-s-303', 2, 'gpt-6.1-sol', 'completed', 'trace_real_run_303_2', '[{"type":"session","id":"real-s-303"}]'),
  ('real-run-304-1', 'real-s-304', 1, 'ci-evaluator', 'completed', 'trace_real_run_304_1', '[{"type":"session","id":"real-s-304"}]'),
  ('real-run-305-1', 'real-s-305', 1, 'claude-sonnet', 'completed', 'trace_real_run_305_1', '[{"type":"session","id":"real-s-305"}]'),
  ('real-run-306-1', 'real-s-306', 1, 'gpt-6.1-sol', 'failed', 'trace_real_run_306_1', '[{"type":"session","id":"real-s-306"}]')
ON CONFLICT (run_id) DO UPDATE SET
  sequence_no = EXCLUDED.sequence_no, model = EXCLUDED.model, status = EXCLUDED.status,
  trace_id = EXCLUDED.trace_id, source_refs = EXCLUDED.source_refs;

INSERT INTO wcp_tool_calls
  (tool_call_id, session_id, run_id, tool_name, status, trace_id, source_refs)
VALUES
  ('real-tool-303-1', 'real-s-303', 'real-run-303-1', 'context.search', 'succeeded', 'trace_real_tool_303_1', '[{"type":"context","id":"real-c-210"}]'),
  ('real-tool-303-2', 'real-s-303', 'real-run-303-2', 'workbench.query', 'succeeded', 'trace_real_tool_303_2', '[{"type":"api","id":"workbench.query"}]'),
  ('real-tool-304-1', 'real-s-304', 'real-run-304-1', 'audit.export', 'succeeded', 'trace_real_tool_304_1', '[{"type":"audit","id":"real-audit-514"}]'),
  ('real-tool-305-1', 'real-s-305', 'real-run-305-1', 'handoff.resume', 'succeeded', 'trace_real_tool_305_1', '[{"type":"handoff","id":"real-h-403"}]'),
  ('real-tool-306-1', 'real-s-306', 'real-run-306-1', 'checkpoint.restore', 'failed', 'trace_real_tool_306_1', '[{"type":"conflict","id":"real-conflict-01"}]')
ON CONFLICT (tool_call_id) DO UPDATE SET
  session_id = EXCLUDED.session_id, run_id = EXCLUDED.run_id, tool_name = EXCLUDED.tool_name,
  status = EXCLUDED.status, trace_id = EXCLUDED.trace_id, source_refs = EXCLUDED.source_refs;

INSERT INTO wcp_handoffs
  (handoff_id, tenant_id, workspace_id, project_id, session_id, checkpoint_id, status, offered_to, summary, source_refs, trace_id, created_at, updated_at)
VALUES
  ('real-h-402', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'real-s-303', 'real-pack-01', 'accepted', 'claude-code', 'Restore the redaction review with the latest ContextPack.', '[{"type":"session","id":"real-s-303"},{"type":"pack","id":"real-pack-01"}]', 'trace_real_handoff_402', '2026-10-24T01:55:00Z', '2026-10-24T02:00:00Z'),
  ('real-h-403', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'real-s-305', 'real-pack-01', 'rejected', 'codex', 'Rejected restore after the checkpoint hash mismatch was detected.', '[{"type":"session","id":"real-s-305"},{"type":"conflict","id":"real-conflict-01"}]', 'trace_real_handoff_403', '2026-10-23T15:00:00Z', '2026-10-23T16:10:00Z'),
  ('real-h-404', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'real-s-304', NULL, 'offered', 'cursor', 'Offer CI validation to the review session after the release gate.', '[{"type":"session","id":"real-s-304"}]', 'trace_real_handoff_404', '2026-10-24T02:05:00Z', '2026-10-24T02:05:00Z')
ON CONFLICT (handoff_id) DO UPDATE SET
  checkpoint_id = EXCLUDED.checkpoint_id, status = EXCLUDED.status, offered_to = EXCLUDED.offered_to,
  summary = EXCLUDED.summary, source_refs = EXCLUDED.source_refs, trace_id = EXCLUDED.trace_id,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at;

INSERT INTO wcp_conflicts
  (conflict_id, tenant_id, workspace_id, project_id, entity_type, entity_id, field, base_version, local_version, server_version, local_value, server_value, status, resolution, actor_id, version, trace_id, source_refs)
VALUES
  ('real-conflict-01', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'work_item', 'real-w-134', 'status', 3, 4, 5, '{"value":"in_progress"}', '{"value":"blocked"}', 'open', NULL, 'actor-platform', 5, 'trace_real_conflict_01', '[{"type":"work_item","id":"real-w-134"},{"type":"incident","id":"INC-77"}]'),
  ('real-conflict-02', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'context_item', 'real-c-207', 'status', 1, 2, 2, '{"value":"proposed"}', '{"value":"confirmed"}', 'open', NULL, 'actor-security', 2, 'trace_real_conflict_02', '[{"type":"context","id":"real-c-207"},{"type":"policy","id":"POL-18"}]'),
  ('real-conflict-03', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'session', 'real-s-303', 'parent_session_id', 1, 2, 3, '{"value":"real-s-305"}', '{"value":"01HF7YAT000000000000000301"}', 'open', NULL, 'actor-reviewer', 3, 'trace_real_conflict_03', '[{"type":"session","id":"real-s-303"},{"type":"handoff","id":"real-h-402"}]'),
  ('real-conflict-04', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'work_item', 'real-w-133', 'priority', 2, 3, 3, '{"value":"P2"}', '{"value":"P1"}', 'resolved', 'keep_server', 'actor-security', 3, 'trace_real_conflict_04', '[{"type":"work_item","id":"real-w-133"},{"type":"decision","id":"DEC-22"}]')
ON CONFLICT (conflict_id) DO UPDATE SET
  entity_type = EXCLUDED.entity_type, entity_id = EXCLUDED.entity_id, field = EXCLUDED.field,
  base_version = EXCLUDED.base_version, local_version = EXCLUDED.local_version,
  server_version = EXCLUDED.server_version, local_value = EXCLUDED.local_value,
  server_value = EXCLUDED.server_value, status = EXCLUDED.status, resolution = EXCLUDED.resolution,
  actor_id = EXCLUDED.actor_id, version = EXCLUDED.version, trace_id = EXCLUDED.trace_id,
  source_refs = EXCLUDED.source_refs;

INSERT INTO wcp_sync_events
  (event_id, tenant_id, workspace_id, project_id, server_cursor, event_type, payload, source_refs, trace_id, created_at)
VALUES
  ('real-event-801', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 801, 'work_item.updated', '{"work_item_id":"real-w-134","status":"blocked"}', '[{"type":"plane","id":"W-134"}]', 'trace_real_event_801', '2026-10-24T02:40:00Z'),
  ('real-event-802', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 802, 'context.proposed', '{"context_id":"real-c-207"}', '[{"type":"policy","id":"POL-18"}]', 'trace_real_event_802', '2026-10-24T02:45:00Z'),
  ('real-event-803', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 803, 'handoff.offered', '{"handoff_id":"real-h-404"}', '[{"type":"handoff","id":"real-h-404"}]', 'trace_real_event_803', '2026-10-24T02:50:00Z')
ON CONFLICT (event_id) DO UPDATE SET
  server_cursor = EXCLUDED.server_cursor, event_type = EXCLUDED.event_type, payload = EXCLUDED.payload,
  source_refs = EXCLUDED.source_refs, trace_id = EXCLUDED.trace_id, created_at = EXCLUDED.created_at;

INSERT INTO wcp_audit_records
  (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, session_id, action, resource, result, classification, details, trace_id, source_refs, occurred_at)
VALUES
  ('real-audit-503', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-platform', 'codex', 'real-s-303', 'work_item.update', 'work_item:real-w-134', 'allowed', 'internal', '{"field":"status","from":"in_progress","to":"blocked"}', 'trace_real_audit_503', '[{"type":"work_item","id":"real-w-134"}]', '2026-10-24T02:40:00Z'),
  ('real-audit-504', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-security', 'claude-code', 'real-s-305', 'context.propose', 'context:real-c-207', 'allowed', 'restricted', '{"decision":"approval-policy","requires_human":true}', 'trace_real_audit_504', '[{"type":"context","id":"real-c-207"}]', '2026-10-24T02:45:00Z'),
  ('real-audit-505', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-reviewer', 'cursor', 'real-s-303', 'handoff.offer', 'handoff:real-h-404', 'allowed', 'internal', '{"offered_to":"cursor"}', 'trace_real_audit_505', '[{"type":"handoff","id":"real-h-404"}]', '2026-10-24T02:50:00Z'),
  ('real-audit-506', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-security', 'claude-code', 'real-s-305', 'conflict.resolve', 'conflict:real-conflict-04', 'allowed', 'internal', '{"resolution":"keep_server"}', 'trace_real_audit_506', '[{"type":"conflict","id":"real-conflict-04"}]', '2026-10-24T02:55:00Z'),
  ('real-audit-507', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-platform', 'codex', 'real-s-306', 'checkpoint.restore', 'checkpoint:real-pack-01', 'error', 'internal', '{"reason":"hash_mismatch","retryable":true}', 'trace_real_audit_507', '[{"type":"checkpoint","id":"real-pack-01"}]', '2026-10-24T03:00:00Z'),
  ('real-audit-508', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-ci', 'github-actions', 'real-s-304', 'audit.export', 'audit:project-continuity', 'allowed', 'confidential', '{"records":14,"format":"json"}', 'trace_real_audit_508', '[{"type":"audit","id":"real-audit-508"}]', '2026-10-24T03:05:00Z'),
  ('real-audit-509', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-ci', 'github-actions', 'real-s-304', 'policy.check', 'policy:scope-fence', 'denied', 'internal', '{"reason":"capability_missing","capability":"audit.write"}', 'trace_real_audit_509', '[{"type":"policy","id":"scope-fence"}]', '2026-10-24T03:10:00Z'),
  ('real-audit-510', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-reviewer', 'cursor', 'real-s-303', 'context.read', 'context:real-c-210', 'allowed', 'confidential', '{"source":"risk-register"}', 'trace_real_audit_510', '[{"type":"context","id":"real-c-210"}]', '2026-10-24T03:15:00Z'),
  ('real-audit-511', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-recovery', 'claude-code', 'real-s-305', 'handoff.resume', 'handoff:real-h-403', 'denied', 'internal', '{"reason":"checkpoint_rejected"}', 'trace_real_audit_511', '[{"type":"handoff","id":"real-h-403"}]', '2026-10-24T03:20:00Z'),
  ('real-audit-512', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-platform', 'codex', 'real-s-306', 'conflict.open', 'conflict:real-conflict-01', 'error', 'internal', '{"reason":"version_gap","retryable":true}', 'trace_real_audit_512', '[{"type":"conflict","id":"real-conflict-01"}]', '2026-10-24T03:25:00Z'),
  ('real-audit-513', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-platform', 'codex', 'real-s-303', 'context.pack', 'pack:real-pack-01', 'allowed', 'internal', '{"version":4,"used_tokens":8450}', 'trace_real_audit_513', '[{"type":"pack","id":"real-pack-01"}]', '2026-10-24T03:30:00Z'),
  ('real-audit-514', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-ci', 'github-actions', 'real-s-304', 'release.verify', 'release:0.1.0', 'allowed', 'internal', '{"checks":["workbench","auth","db"]}', 'trace_real_audit_514', '[{"type":"release","id":"0.1.0"}]', '2026-10-24T03:35:00Z'),
  ('real-audit-515', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-security', 'claude-code', 'real-s-305', 'policy.check', 'policy:classification', 'denied', 'restricted', '{"reason":"restricted_context"}', 'trace_real_audit_515', '[{"type":"policy","id":"classification"}]', '2026-10-24T03:40:00Z'),
  ('real-audit-516', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-reviewer', 'cursor', 'real-s-303', 'workbench.query', 'workbench:overview', 'allowed', 'internal', '{"source":"dashboard"}', 'trace_real_audit_516', '[{"type":"api","id":"workbench.query"}]', '2026-10-24T03:45:00Z')
ON CONFLICT (audit_id) DO UPDATE SET
  actor_id = EXCLUDED.actor_id, client_id = EXCLUDED.client_id, session_id = EXCLUDED.session_id,
  action = EXCLUDED.action, resource = EXCLUDED.resource, result = EXCLUDED.result,
  classification = EXCLUDED.classification, details = EXCLUDED.details, trace_id = EXCLUDED.trace_id,
  source_refs = EXCLUDED.source_refs, occurred_at = EXCLUDED.occurred_at;

COMMIT;
