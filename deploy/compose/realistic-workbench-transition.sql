-- One real state transition used by the closed-loop dashboard acceptance.
BEGIN;
UPDATE wcp_work_items
SET status = 'in_progress', progress = 60, updated_at = '2026-10-24T04:00:00Z'
WHERE id = 'real-w-134';

UPDATE wcp_conflicts
SET status = 'resolved', resolution = 'keep_server', actor_id = 'actor-platform'
WHERE conflict_id = 'real-conflict-01';

INSERT INTO wcp_audit_records
  (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, action, resource, result, classification, details, trace_id, source_refs, occurred_at)
VALUES
  ('real-transition-audit-01', '01HF7YAT000000000000000001', '01HF7YAT000000000000000002', '01HF7YAT000000000000000003', 'actor-platform', 'realistic-acceptance', 'conflict.resolve', 'conflict:real-conflict-01', 'allowed', 'internal', '{"from":"open","to":"resolved","work_item":"real-w-134"}', 'trace_real_transition_01', '[{"type":"conflict","id":"real-conflict-01"},{"type":"work_item","id":"real-w-134"}]', '2026-10-24T04:00:00Z')
ON CONFLICT (audit_id) DO UPDATE SET
  result = EXCLUDED.result, details = EXCLUDED.details, trace_id = EXCLUDED.trace_id,
  source_refs = EXCLUDED.source_refs, occurred_at = EXCLUDED.occurred_at;
COMMIT;
