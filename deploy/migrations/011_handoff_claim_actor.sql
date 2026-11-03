-- Existing claims recorded only the receiving client. New claims also identify
-- the person using that client, including people sharing one workbench app.
ALTER TABLE wcp_session_handoffs ADD COLUMN IF NOT EXISTS claimed_by_actor TEXT;

INSERT INTO schema_migrations (version, checksum)
VALUES ('011_handoff_claim_actor', 'sha256:planemem-handoff-011')
ON CONFLICT (version) DO NOTHING;
