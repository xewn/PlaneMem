-- Human confirmation records a new immutable version and a bounded review reason.
ALTER TABLE wcp_context_item_commands
  DROP CONSTRAINT IF EXISTS wcp_context_item_commands_operation_check;
ALTER TABLE wcp_context_item_commands
  ADD CONSTRAINT wcp_context_item_commands_operation_check
  CHECK (operation IN ('create', 'update', 'archive', 'restore', 'confirm'));

ALTER TABLE wcp_context_item_history
  ADD COLUMN IF NOT EXISTS confirmation_reason TEXT;
ALTER TABLE wcp_context_item_history
  DROP CONSTRAINT IF EXISTS wcp_context_item_history_operation_check;
ALTER TABLE wcp_context_item_history
  ADD CONSTRAINT wcp_context_item_history_operation_check
  CHECK (operation IN ('baseline', 'create', 'update', 'archive', 'restore', 'confirm'));
ALTER TABLE wcp_context_item_history
  DROP CONSTRAINT IF EXISTS wcp_context_item_history_confirmation_check;
ALTER TABLE wcp_context_item_history
  ADD CONSTRAINT wcp_context_item_history_confirmation_check CHECK (
    (operation = 'confirm' AND status = 'confirmed' AND item_version > 1
      AND confirmation_reason IS NOT NULL AND length(btrim(confirmation_reason)) BETWEEN 1 AND 2000)
    OR (operation <> 'confirm' AND confirmation_reason IS NULL)
  );

-- Existing confirmed content gets no invented reviewer or reason.
INSERT INTO schema_migrations (version, checksum)
VALUES ('022_context_item_confirmation', 'sha256:planemem-context-confirmation-022')
ON CONFLICT (version) DO NOTHING;
