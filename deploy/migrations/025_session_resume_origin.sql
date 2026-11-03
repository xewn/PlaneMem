-- Development only; not executed. Do not infer a handoff from historical parent sessions.
ALTER TABLE wcp_sessions ADD COLUMN IF NOT EXISTS resume_origin JSONB;
ALTER TABLE wcp_sessions DROP CONSTRAINT IF EXISTS wcp_sessions_resume_origin_check;
ALTER TABLE wcp_sessions ADD CONSTRAINT wcp_sessions_resume_origin_check CHECK (
  resume_origin IS NULL OR (
    parent_session_id IS NOT NULL AND jsonb_typeof(resume_origin) = 'object'
    AND resume_origin ?& ARRAY['handoff_id', 'checkpoint_id', 'require_claimed']
    AND jsonb_typeof(resume_origin->'handoff_id') = 'string'
    AND jsonb_typeof(resume_origin->'checkpoint_id') = 'string'
    AND resume_origin->>'handoff_id' ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
    AND resume_origin->>'checkpoint_id' ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
    AND jsonb_typeof(resume_origin->'require_claimed') = 'boolean'
    AND resume_origin - ARRAY['handoff_id', 'checkpoint_id', 'require_claimed'] = '{}'::jsonb
  )
);
INSERT INTO schema_migrations (version, checksum)
VALUES ('025_session_resume_origin', 'sha256:planemem-session-resume-origin-025')
ON CONFLICT (version) DO NOTHING;
