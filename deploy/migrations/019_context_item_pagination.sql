-- Supports the context list's priority/update/id keyset ordering.
-- This migration is supplied for a later authorized database upgrade.
CREATE INDEX IF NOT EXISTS wcp_context_items_page_idx
  ON wcp_context_items (
    tenant_id, workspace_id, project_id,
    (CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END),
    updated_at DESC, id
  ) WHERE deleted_at IS NULL;
