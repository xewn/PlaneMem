-- Adds durable restore receipts and the archived-list ordering index.
ALTER TABLE wcp_context_item_commands
  DROP CONSTRAINT IF EXISTS wcp_context_item_commands_operation_check;
ALTER TABLE wcp_context_item_commands
  ADD CONSTRAINT wcp_context_item_commands_operation_check
  CHECK (operation IN ('create', 'update', 'archive', 'restore'));

CREATE INDEX IF NOT EXISTS wcp_context_items_archived_page_idx
  ON wcp_context_items (
    tenant_id, workspace_id, project_id,
    (CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END),
    updated_at DESC, id
  ) WHERE deleted_at IS NOT NULL;

INSERT INTO schema_migrations (version, checksum)
VALUES ('020_context_item_restore', 'sha256:planemem-context-restore-020')
ON CONFLICT (version) DO NOTHING;
