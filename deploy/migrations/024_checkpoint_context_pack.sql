-- Development only: this migration has not been executed.
-- Historical client-supplied hashes remain unbound; never infer a saved ID from them.
ALTER TABLE wcp_session_checkpoints
  DROP CONSTRAINT IF EXISTS wcp_checkpoint_context_pack_binding_check;
ALTER TABLE wcp_session_checkpoints
  ADD COLUMN IF NOT EXISTS context_pack_id text;

ALTER TABLE wcp_session_checkpoints
  ADD CONSTRAINT wcp_checkpoint_context_pack_binding_check
  CHECK (context_pack_id IS NULL OR
    (context_pack_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$' AND context_pack_hash IS NOT NULL));

INSERT INTO schema_migrations (version, checksum)
VALUES ('024_checkpoint_context_pack', 'sha256:planemem-checkpoint-context-pack-024')
ON CONFLICT (version) DO NOTHING;
