CREATE TABLE IF NOT EXISTS wcp_proposals (
  proposal_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'risk', 'next_step', 'blocker', 'brief')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'verified', 'rejected')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_refs JSONB NOT NULL,
  source_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_by_client TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  trace_id TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_by_client TEXT,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT,
  CHECK (jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) BETWEEN 1 AND 32),
  CHECK (jsonb_typeof(source_manifest) = 'array' AND jsonb_array_length(source_manifest) <= 32),
  CHECK (jsonb_typeof(provenance) = 'object'),
  CHECK (expires_at > created_at),
  CHECK ((status = 'proposed' AND revision = 1 AND reviewed_by IS NULL AND reviewed_by_client IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
    OR (status <> 'proposed' AND revision = 2 AND reviewed_by IS NOT NULL AND reviewed_by_client IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_proposals_scope
  ON wcp_proposals (tenant_id, workspace_id, project_id, status, proposal_id DESC);

CREATE TABLE IF NOT EXISTS wcp_proposal_commands (
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
  request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES wcp_proposals(proposal_id),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'verified', 'rejected')),
  revision BIGINT NOT NULL CHECK (revision > 0),
  event_id TEXT NOT NULL UNIQUE REFERENCES wcp_sync_events(event_id),
  server_cursor BIGINT NOT NULL CHECK (server_cursor > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, project_id, request_key)
);

INSERT INTO schema_migrations (version, checksum)
VALUES ('018_proposal_reviews', 'sha256:planemem-proposal-018')
ON CONFLICT (version) DO NOTHING;
